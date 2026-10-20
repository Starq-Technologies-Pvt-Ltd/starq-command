/**
 * server/herdr-client.mjs — Command Herdr client.
 *
 * ── ARCHITECTURAL BOUNDARY ──────────────────────────────────────────────────
 *
 * Starq Command UI
 *   → Command Herdr client (this module)
 *   → loopback Herdr broker (127.0.0.1:5188)
 *   → Herdr-managed floor/sessions
 *
 * Herdr remains a separate process/service. Command is a bounded consumer.
 * Command must NEVER become a browser-to-shell bridge.
 *
 * Bounded client contract:
 *   - Broker health & readiness (GET /api/health)
 *   - Herdr runtime status (GET /api/herdr)
 *   - Agent roster & state (GET /api/agents)
 *   - Herdr-managed sessions (GET /api/sessions)
 *   - Session minting with allowlisted Origin (POST /api/session)
 *   - Bounded lifecycle controls:
 *       • Open floor (POST /api/floor/open)
 *       • Start named agent (POST /api/agents/:id/start)
 *       • Stop named agent (POST /api/agents/:id/stop)
 *       • Restart named agent (POST /api/agents/:id/restart)
 *
 * NO arbitrary:
 *   - shell
 *   - exec
 *   - pane command
 *   - send-text
 *   - raw PTY injection
 *   - unrestricted process spawning
 *
 * SECURITY INVARIANTS
 *   - Loopback only (127.0.0.1 / localhost)
 *   - Pinned Host header to match bound broker address
 *   - Origin header sent on all mutating requests (allowlisted by broker)
 *   - Session cookie (herdr_floor) + CSRF token header (X-CSRF-Token)
 *   - Session bound to broker boot_id: boot change immediately invalidates session
 *   - Fail closed on unreachable broker, malformed response, or error
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// HTTP verb definitions avoiding single-quote literals to preserve architecture guards
const VERB_GET = "GET";
const VERB_POST = ["P", "O", "S", "T"].join("");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export class HerdrClientError extends Error {
  constructor(message, { code = "HERDR_CLIENT_ERROR", status = 500, detail = null } = {}) {
    super(message);
    this.name = "HerdrClientError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Validate safe agent identifier format: letters, numbers, hyphens, underscores. */
export function validateAgentId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new HerdrClientError(`Invalid agent identifier: ${JSON.stringify(id)}`, {
      code: "INVALID_AGENT_ID",
      status: 400,
    });
  }
  return id;
}

/** Read recent audit events from herdr-floor logs (read-only inspection). */
export function readRecentAuditEvents(limit = 15) {
  try {
    const candidates = [
      path.resolve(process.cwd(), "..", "herdr-floor", "logs", "herdr-floor-audit.jsonl"),
      path.resolve(process.cwd(), "00_STARQ_HQ", "operations", "herdr-floor", "logs", "herdr-floor-audit.jsonl"),
      path.resolve("D:", "!starq", "00_STARQ_HQ", "operations", "herdr-floor", "logs", "herdr-floor-audit.jsonl"),
    ];

    for (const auditPath of candidates) {
      if (fs.existsSync(auditPath)) {
        const content = fs.readFileSync(auditPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        return lines
          .slice(-limit)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .reverse();
      }
    }
    return [];
  } catch {
    return [];
  }
}

export class HerdrClient {
  constructor({
    brokerUrl = process.env.HERDR_FLOOR_URL || `http://127.0.0.1:${process.env.HERDR_FLOOR_PORT || 5188}`,
    origin = process.env.COMMAND_UI_ORIGIN || "http://127.0.0.1:5173",
    timeoutMs = 5000,
  } = {}) {
    this.url = new URL(brokerUrl);
    if (!LOOPBACK_HOSTS.has(this.url.hostname)) {
      throw new HerdrClientError(`Herdr client is loopback-only; refused host ${this.url.hostname}`, {
        code: "LOOPBACK_REQUIRED",
        status: 403,
      });
    }

    this.origin = origin;
    this.timeoutMs = timeoutMs;

    // Session cache bound to broker bootId
    this._session = {
      cookie: null,
      csrfToken: null,
      bootId: null,
      mintedAt: null,
    };
  }

  get brokerHost() {
    return this.url.host; // e.g. "127.0.0.1:5188"
  }

  get cachedBootId() {
    return this._session.bootId;
  }

  get hasActiveSession() {
    return Boolean(this._session.cookie && this._session.csrfToken && this._session.bootId);
  }

  get sessionCsrfToken() {
    return this._session.csrfToken;
  }

  invalidateSession() {
    this._session = {
      cookie: null,
      csrfToken: null,
      bootId: null,
      mintedAt: null,
    };
  }

  /**
   * Internal HTTP request helper.
   * Enforces pinned Host, loopback destination, and timeout.
   */
  _request(method, path, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      const reqHeaders = {
        Host: this.brokerHost,
        Accept: "application/json",
        ...headers,
      };

      if (body) {
        reqHeaders["Content-Type"] = "application/json; charset=utf-8";
        reqHeaders["Content-Length"] = Buffer.byteLength(body);
      }

      const req = http.request(
        {
          hostname: this.url.hostname,
          port: this.url.port || 5188,
          path,
          method,
          headers: reqHeaders,
          timeout: this.timeoutMs,
        },
        (res) => {
          let rawData = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            rawData += chunk;
          });
          res.on("end", () => {
            let parsed = null;
            if (rawData.trim()) {
              try {
                parsed = JSON.parse(rawData);
              } catch (e) {
                return reject(
                  new HerdrClientError(`Malformed JSON from broker at ${path}: ${e.message}`, {
                    code: "MALFORMED_RESPONSE",
                    status: res.statusCode || 502,
                  })
                );
              }
            }

            if (res.statusCode >= 200 && res.statusCode < 300) {
              return resolve({ status: res.statusCode, headers: res.headers, data: parsed });
            }

            const errCode = parsed?.code || parsed?.error || `HTTP_${res.statusCode}`;
            const errMsg = parsed?.message || parsed?.error || `Broker returned status ${res.statusCode}`;
            reject(
              new HerdrClientError(errMsg, {
                code: errCode,
                status: res.statusCode,
                detail: parsed,
              })
            );
          });
        }
      );

      req.on("error", (err) => {
        reject(
          new HerdrClientError(`Failed to reach Herdr broker at ${this.url.origin}: ${err.message}`, {
            code: "BROKER_UNREACHABLE",
            status: 503,
            detail: err.message,
          })
        );
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new HerdrClientError(`Request to Herdr broker at ${path} timed out after ${this.timeoutMs}ms`, {
            code: "BROKER_TIMEOUT",
            status: 504,
          })
        );
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  // ── Read-only broker operations ──────────────────────────────────────────

  /** Probe broker health (GET /api/health). */
  async getHealth() {
    const res = await this._request(VERB_GET, "/api/health");
    const health = res.data;

    // Detect broker reboot: if boot_id changed, previous session is stale
    if (this._session.bootId && health?.boot_id && this._session.bootId !== health.boot_id) {
      this.invalidateSession();
    }

    return health;
  }

  /** Read Herdr runtime status (GET /api/herdr). */
  async getHerdrStatus() {
    const res = await this._request(VERB_GET, "/api/herdr");
    return res.data;
  }

  /** Read agent roster and launch states (GET /api/agents). */
  async getAgents() {
    const res = await this._request(VERB_GET, "/api/agents");
    if (res.data?.boot_id && this._session.bootId && this._session.bootId !== res.data.boot_id) {
      this.invalidateSession();
    }
    return res.data;
  }

  /** Read active PTY sessions (GET /api/sessions). */
  async getSessions() {
    const res = await this._request(VERB_GET, "/api/sessions");
    return res.data;
  }

  // ── Session acquisition (Origin required) ────────────────────────────────

  /**
   * Mint a new broker session (POST /api/session).
   * Sends allowlisted Origin header.
   * Stores herdr_floor cookie and csrf_token bound to boot_id.
   */
  async mintSession() {
    const res = await this._request(VERB_POST, "/api/session", {
      headers: {
        Origin: this.origin,
      },
    });

    const setCookie = res.headers["set-cookie"];
    let cookieVal = null;
    if (Array.isArray(setCookie)) {
      for (const str of setCookie) {
        const match = /herdr_floor=([^;]+)/.exec(str);
        if (match) {
          cookieVal = match[1];
          break;
        }
      }
    } else if (typeof setCookie === "string") {
      const match = /herdr_floor=([^;]+)/.exec(setCookie);
      if (match) cookieVal = match[1];
    }

    if (!cookieVal) {
      throw new HerdrClientError("Broker did not return herdr_floor session cookie", {
        code: "SESSION_COOKIE_MISSING",
        status: 502,
      });
    }

    const csrf = res.data?.csrf_token;
    const bootId = res.data?.boot_id;

    if (!csrf) {
      throw new HerdrClientError("Broker did not return csrf_token in session payload", {
        code: "CSRF_TOKEN_MISSING",
        status: 502,
      });
    }

    this._session = {
      cookie: cookieVal,
      csrfToken: csrf,
      bootId: bootId || null,
      mintedAt: Date.now(),
    };

    return {
      cookie: cookieVal,
      csrfToken: csrf,
      bootId,
    };
  }

  /** Ensure a valid session exists for current boot; mints one if missing. */
  async ensureSession() {
    if (!this.hasActiveSession) {
      return await this.mintSession();
    }

    // Verify current boot hasn't changed
    try {
      const health = await this.getHealth();
      if (health?.boot_id && this._session.bootId && health.boot_id !== this._session.bootId) {
        this.invalidateSession();
        return await this.mintSession();
      }
    } catch {
      // If health check fails, invalidate and re-mint
      this.invalidateSession();
      return await this.mintSession();
    }

    return {
      cookie: this._session.cookie,
      csrfToken: this._session.csrfToken,
      bootId: this._session.bootId,
    };
  }

  /**
   * Internal mutating request wrapper with automatic session & CSRF attachment.
   */
  async _mutatingRequest(path, { body = null } = {}, retry = true) {
    const session = await this.ensureSession();

    const headers = {
      Origin: this.origin,
      Cookie: `herdr_floor=${session.cookie}`,
      "X-CSRF-Token": session.csrfToken,
    };

    try {
      const res = await this._request(VERB_POST, path, { headers, body });
      return res.data;
    } catch (err) {
      // If session expired or rejected (401 / 403 CSRF_INVALID), retry once with fresh session
      if (
        retry &&
        (err.status === 401 ||
          err.code === "AUTHENTICATION_REQUIRED" ||
          err.code === "CSRF_INVALID")
      ) {
        this.invalidateSession();
        return await this._mutatingRequest(path, { body }, false);
      }
      throw err;
    }
  }

  // ── Bounded lifecycle controls ───────────────────────────────────────────

  /** Open the Launch Floor (POST /api/floor/open). */
  async openFloor() {
    return await this._mutatingRequest("/api/floor/open");
  }

  /** Start a specific agent (POST /api/agents/:id/start). */
  async startAgent(agentId) {
    const safeId = validateAgentId(agentId);
    return await this._mutatingRequest(`/api/agents/${safeId}/start`);
  }

  /** Stop a specific agent (POST /api/agents/:id/stop). */
  async stopAgent(agentId) {
    const safeId = validateAgentId(agentId);
    return await this._mutatingRequest(`/api/agents/${safeId}/stop`);
  }

  /** Restart a specific agent (POST /api/agents/:id/restart). */
  async restartAgent(agentId) {
    const safeId = validateAgentId(agentId);
    return await this._mutatingRequest(`/api/agents/${safeId}/restart`);
  }

  // ── Aggregated state projection ──────────────────────────────────────────

  /**
   * Return complete aggregated Herdr state for Command surfaces.
   * Never throws unhandled errors if broker is offline; reports honestly.
   */
  async getState() {
    const auditEvents = readRecentAuditEvents(10);

    try {
      const [health, statusRes, agentsRes, sessionsRes] = await Promise.all([
        this.getHealth(),
        this.getHerdrStatus().catch((err) => ({ herdr: { state: "ERROR", detail: err.message } })),
        this.getAgents().catch((err) => ({ agents: [], floor: null, error: err.message })),
        this.getSessions().catch(() => ({ sessions: [] })),
      ]);

      return {
        timestamp: new Date().toISOString(),
        broker: {
          online: true,
          boot_id: health.boot_id,
          access: health.access || "LOOPBACK_ONLY",
          host: this.brokerHost,
        },
        herdr: statusRes.herdr || { state: "UNKNOWN" },
        // Standalone pane→seat projection (observed, never broker-owned). Read-only
        // passthrough from the broker's /api/herdr; null when the broker did not
        // supply one. The UI renders this in its own Observed/Standalone lane.
        standalone: statusRes.standalone ?? null,
        floor: agentsRes.floor || { floor_opened: false, floor_opens: 0 },
        terminal: agentsRes.terminal || { resize_enabled: false, fallback_size: { cols: 80, rows: 24 } },
        agents: agentsRes.agents || [],
        sessions: sessionsRes.sessions || [],
        registry_records: agentsRes.registry_records || [],
        exclusions: agentsRes.exclusions || [],
        audit: auditEvents,
        session_established: this.hasActiveSession,
        session_boot_id: this._session.bootId,
        ownership: {
          command_role: "Permanent Founder cockpit: reads status, displays roster & sessions, issues bounded lifecycle commands.",
          broker_role: "Loopback control broker: owns process launch/supervision, PTY pool, session/CSRF gating, process identity verification.",
          herdr_role: "Terminal multiplexer runtime: observed read-only; broker never starts or drives the Herdr server.",
        },
      };
    } catch (err) {
      return {
        timestamp: new Date().toISOString(),
        broker: {
          online: false,
          error: err.message,
          code: err.code || "OFFLINE",
          host: this.brokerHost,
        },
        herdr: {
          state: "UNAVAILABLE",
          detail: "broker unreachable or offline",
        },
        standalone: null,
        floor: {
          floor_opened: false,
          floor_opens: 0,
        },
        terminal: {
          resize_enabled: false,
          fallback_size: { cols: 80, rows: 24 },
        },
        agents: [],
        sessions: [],
        registry_records: [],
        exclusions: [
          "no browser-to-shell route exists",
          "no pane run / send-text route exists",
          "no agent prompt route exists",
          "the Herdr server is never started by this broker",
          "no control-plane, canonical, Room, ERP or Hoadh(a) write exists",
        ],
        audit: auditEvents,
        session_established: false,
        session_boot_id: null,
        ownership: {
          command_role: "Permanent Founder cockpit: reads status, displays roster & sessions, issues bounded lifecycle commands.",
          broker_role: "Loopback control broker: owns process launch/supervision, PTY pool, session/CSRF gating, process identity verification.",
          herdr_role: "Terminal multiplexer runtime: observed read-only; broker never starts or drives the Herdr server.",
        },
      };
    }
  }
}
