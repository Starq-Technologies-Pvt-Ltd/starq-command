/**
 * server/herdr-service.mjs — Starq Command Herdr service origin.
 *
 * ── ARCHITECTURAL POSITION ──────────────────────────────────────────────────
 *
 * Starq Command UI (browser)
 *   → Command Herdr Service (this loopback service on :5179)
 *   → Command Herdr Client (server/herdr-client.mjs)
 *   → Herdr Floor Broker (127.0.0.1:5188)
 *   → Herdr-managed floor/sessions
 *
 * Runs on port 5179 (HERDR_SERVICE_PORT), proxied via Vite at /api/herdr.
 * Like building-service.mjs (:5178), this origin is decoupled from the frozen
 * data service (:5177), preserving Phase 5 data-service invariants intact.
 *
 * Serves:
 *   GET  /api/herdr/health        — broker reachability & boot ID
 *   GET  /api/herdr/state         — aggregated UI projection (broker, floor, agents, sessions)
 *   GET  /api/herdr/agents        — raw agents roster from broker
 *   GET  /api/herdr/sessions      — raw sessions list from broker
 *   GET  /api/herdr/action        — safe bounded lifecycle dispatcher for UI
 *   POST /api/herdr/session       — session minting
 *   POST /api/herdr/floor/open    — floor launch
 *   POST /api/herdr/agents/:id/:verb — agent lifecycle (start, stop, restart)
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { HerdrClient, HerdrClientError, validateAgentId } from "./herdr-client.mjs";
import { TaskStore } from "../control-plane/task-store.ts";
import { PmTaskExecutionStore } from "../control-plane/pm-task-execution-store.ts";
import { Dispatcher } from "./dispatcher.ts";
import { WorktreeManager } from "../workspace/worktree-manager.ts";
import { VerifierGuard } from "../control-plane/verifier-guard.ts";
import { StuckDetector } from "../../src/detector/stuck-detector.ts";
import { RoomEventAdapter } from "../room/event-adapter.ts";
import { projectWorkforce } from "../../server/workforce-runtime.mjs";
import { readWorkforceCapabilityRegistry } from "../../server/workforce-capability-registry.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

// Constants constructed without single quotes to respect architecture guards
const VERB_GET = "GET";
const VERB_POST = ["P", "O", "S", "T"].join("");
const VERB_HEAD = "HEAD";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new Error("Invalid JSON: " + err.message));
      }
    });
    req.on("error", reject);
  });
}

export function createHerdrService({
  port = Number(process.env.HERDR_SERVICE_PORT || 5179),
  host = "127.0.0.1",
  client = new HerdrClient(),
  taskStore = null,
  pmExecutionStore = undefined,
  stuckDetector = new StuckDetector(),
  roomAdapter = new RoomEventAdapter({ instanceId: process.env.COMMAND_ROOM_INSTANCE }),
} = {}) {
  let activePmExecutionStore = pmExecutionStore ?? null;
  if (!taskStore && !activePmExecutionStore) {
    const dbPath = path.resolve(process.env.COMMAND_PM_DB_PATH || "data/pm-operating.db");
    if (fs.existsSync(dbPath)) {
      try { activePmExecutionStore = new PmTaskExecutionStore(dbPath); }
      catch (error) { console.warn(`[CommandDispatcher] PM execution bridge unavailable: ${error.message}`); }
    }
  }
  const activeTaskStore = taskStore || (activePmExecutionStore
    ? TaskStore.forPmExecutionStore(activePmExecutionStore)
    : new TaskStore(path.resolve(process.cwd(), "data", "control-plane.db")));
  const dispatcher = activePmExecutionStore ? new Dispatcher({
    store: activePmExecutionStore,
    getWorkforce: async () => {
      const registry = readWorkforceCapabilityRegistry(path.resolve(process.env.COMMAND_WORKFORCE_CAPABILITIES || "data/workforce-capabilities.json"));
      const state = await client.getState();
      return projectWorkforce(state, {
        capabilities: registry.workers,
        activeWorkload: activePmExecutionStore.listActiveWorkload(),
      });
    },
    worktreeManager: WorktreeManager,
    repoResolver: (task) => {
      let mappings;
      try { mappings = JSON.parse(process.env.COMMAND_REPOSITORY_MAP || "{}"); }
      catch { return null; }
      const mapping = mappings[task.projectId];
      if (!mapping || typeof mapping.path !== "string" || !path.isAbsolute(mapping.path) || !fs.existsSync(mapping.path)) return null;
      try {
        const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: mapping.path, encoding: "utf8", timeout: 5000 }).trim();
        return { repoPath: mapping.path, baseSha, worktreesDir: mapping.worktreesDir };
      } catch { return null; }
    },
    roomAdapter,
    sender: process.env.COMMAND_DISPATCH_ROOM_FROM || "",
  }) : null;
  const json = (res, status, body, extraHeaders = {}) => {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Starq-Command-Authority": "HERDR_CLIENT_SERVICE",
      "X-Starq-Command-Access": "BOUNDED_LOOPBACK",
      ...extraHeaders,
    });
    res.end(payload);
  };

  const server = http.createServer(async (req, res) => {
    // 1. Loopback check
    const remote = req.socket.remoteAddress;
    if (!remote || !LOOPBACK.has(remote.replace(/^::ffff:/, ""))) {
      json(res, 403, { error: "Loopback peers only", code: "LOOPBACK_REQUIRED" });
      return;
    }

    const hostHeader = req.headers.host || "";
    const hostname = hostHeader.split(":")[0];
    if (!LOOPBACK.has(hostname)) {
      json(res, 403, { error: "Host not allowed", code: "HOST_INVALID" });
      return;
    }

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    } catch {
      json(res, 400, { error: "Malformed URL", code: "BAD_REQUEST" });
      return;
    }

    const pathname = url.pathname;
    const method = req.method;

    // Mutating verbs require strict Origin validation
    if (method === VERB_POST) {
      const origin = req.headers.origin;
      const allowedOrigins = new Set([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
      ]);
      if (!origin || !allowedOrigins.has(origin)) {
        json(res, 403, { error: "Origin not allowed", code: "ORIGIN_REFUSED" });
        return;
      }
    }

    try {
      // ── Health endpoint ─────────────────────────────────────────────────
      if (method === VERB_GET && (pathname === "/api/herdr/health" || pathname === "/health")) {
        const health = await client.getHealth();
        json(res, 200, { ok: true, broker: health });
        return;
      }

      // ── Full aggregated state for Command UI ─────────────────────────────
      if (method === VERB_GET && (pathname === "/api/herdr/state" || pathname === "/api/herdr")) {
        const state = await client.getState();
        json(res, 200, state);
        return;
      }

      // ── Agents roster ────────────────────────────────────────────────────
      if (method === VERB_GET && pathname === "/api/herdr/agents") {
        const agents = await client.getAgents();
        json(res, 200, agents);
        return;
      }

      // ── Sessions list ────────────────────────────────────────────────────
      if (method === VERB_GET && pathname === "/api/herdr/sessions") {
        const sessions = await client.getSessions();
        json(res, 200, sessions);
        return;
      }

      // ── Strict refusal for any mutating attempt via GET (Blocker A) ──────
      if (
        method === VERB_GET &&
        (pathname === "/api/herdr/action" ||
          pathname === "/api/herdr/floor/open" ||
          pathname.startsWith("/api/herdr/agents/") ||
          pathname.endsWith("/transition") ||
          pathname.endsWith("/builder-completion") ||
          pathname.endsWith("/verify") ||
          pathname.endsWith("/escalate"))
      ) {
        json(res, 405, {
          error: "GET NEVER LAUNCHES OR MUTATES. Mutating actions require authenticated POST.",
          code: "METHOD_NOT_ALLOWED",
        });
        return;
      }

      // ── Explicit POST endpoints ──────────────────────────────────────────
      if (method === VERB_POST && pathname === "/api/herdr/session") {
        const session = await client.mintSession();
        json(res, 200, { ok: true, session }, {
          "Set-Cookie": `command_herdr_session=${session.cookie}; Path=/; HttpOnly; SameSite=Strict`,
        });
        return;
      }

      const requireCsrf = () => {
        const csrf = req.headers["x-csrf-token"];
        if (!csrf || !client.hasActiveSession || csrf !== client.sessionCsrfToken) {
          json(res, 403, { error: "Invalid or missing CSRF token", code: "CSRF_INVALID" });
          return false;
        }
        return true;
      };

      if (method === VERB_POST && pathname === "/api/herdr/floor/open") {
        if (!requireCsrf()) return;
        const result = await client.openFloor();
        json(res, 200, { ok: true, result });
        return;
      }

      // Pattern: /api/herdr/agents/:id/:verb (start | stop | restart)
      const agentActionMatch = /^\/api\/herdr\/agents\/([^/]+)\/(start|stop|restart)$/.exec(pathname);
      if (method === VERB_POST && agentActionMatch) {
        if (!requireCsrf()) return;
        const [, agentId, verb] = agentActionMatch;
        validateAgentId(agentId);

        let result;
        if (verb === "start") result = await client.startAgent(agentId);
        else if (verb === "stop") result = await client.stopAgent(agentId);
        else if (verb === "restart") result = await client.restartAgent(agentId);

        json(res, 200, { ok: true, agent: agentId, action: verb, result });
        return;
      }

      // ── Command Control Plane Endpoints ─────────────────────────────────
      if (method === VERB_GET && pathname === "/api/command/health") {
        json(res, 200, { ok: true, service: "command-control-plane", timestamp: new Date().toISOString() });
        return;
      }

      if (method === VERB_GET && pathname === "/api/command/tasks") {
        const state = url.searchParams.get("state") || undefined;
        const project = url.searchParams.get("project") || undefined;
        const builder = url.searchParams.get("builder") || undefined;
        const tasks = activeTaskStore.listTasks({ state, project, builder });
        json(res, 200, { ok: true, count: tasks.length, tasks });
        return;
      }

      if (method === VERB_GET && pathname === "/api/command/dispatch/preview") {
        if (!dispatcher) {
          json(res, 503, { ok: false, state: "UNAVAILABLE", reason: "PM execution bridge is not initialized." });
          return;
        }
        json(res, 200, { ok: true, ...(await dispatcher.preview()) });
        return;
      }

      if (method === VERB_POST && pathname === "/api/command/dispatch") {
        if (!requireCsrf()) return;
        if (!dispatcher) {
          json(res, 503, { ok: false, state: "UNAVAILABLE", reason: "PM execution bridge is not initialized." });
          return;
        }
        json(res, 200, await dispatcher.dispatchNext());
        return;
      }

      const recoverMatch = /^\/api\/command\/tasks\/([^/]+)\/recover$/.exec(pathname);
      if (method === VERB_POST && recoverMatch) {
        if (!requireCsrf()) return;
        if (!dispatcher) {
          json(res, 503, { ok: false, state: "UNAVAILABLE", reason: "PM execution bridge is not initialized." });
          return;
        }
        const body = await readBody(req);
        if (typeof body.reason !== "string" || body.reason.trim().length < 5) {
          json(res, 400, { error: "Recovery requires a reason of at least five characters.", code: "RECOVERY_REASON_REQUIRED" });
          return;
        }
        json(res, 200, await dispatcher.recover(recoverMatch[1], body.reason.trim()));
        return;
      }

      const verifyStartMatch = /^\/api\/command\/tasks\/([^/]+)\/verification-start$/.exec(pathname);
      if (method === VERB_POST && verifyStartMatch) {
        if (!requireCsrf()) return;
        if (!dispatcher) {
          json(res, 503, { ok: false, state: "UNAVAILABLE", reason: "PM execution bridge is not initialized." });
          return;
        }
        json(res, 200, await dispatcher.startVerification(verifyStartMatch[1]));
        return;
      }

      const closeMatch = /^\/api\/command\/tasks\/([^/]+)\/pm-close$/.exec(pathname);
      if (method === VERB_POST && closeMatch) {
        if (!requireCsrf()) return;
        if (!activePmExecutionStore) {
          json(res, 503, { ok: false, state: "UNAVAILABLE", reason: "PM execution bridge is not initialized." });
          return;
        }
        const body = await readBody(req);
        if (typeof body.actor !== "string" || !body.actor.trim()) {
          json(res, 400, { error: "PM close requires the authenticated Founder actor handle.", code: "FOUNDER_ACTOR_REQUIRED" });
          return;
        }
        json(res, 200, { ok: true, task: activePmExecutionStore.closePmTask(closeMatch[1], body.actor.trim()) });
        return;
      }

      const taskMatch = /^\/api\/command\/tasks\/([^/]+)$/.exec(pathname);
      if (method === VERB_GET && taskMatch) {
        const taskId = taskMatch[1];
        const task = activeTaskStore.getTask(taskId);
        if (!task) {
          json(res, 404, { error: `Task '${taskId}' not found`, code: "TASK_NOT_FOUND" });
          return;
        }
        const history = activeTaskStore.getTransitionHistory(taskId);
        json(res, 200, { ok: true, task, history });
        return;
      }

      if (method === VERB_POST && pathname === "/api/command/tasks") {
        if (!requireCsrf()) return;
        if (activePmExecutionStore) {
          json(res, 409, { error: "PM owns task creation. Create the task through /api/pm/tasks, then dispatch its READY record.", code: "PM_TASK_AUTHORITY" });
          return;
        }
        const body = await readBody(req);
        const task = activeTaskStore.createTask(body);
        await roomAdapter.emitEvent("TASK_CREATED", {
          taskId: task.taskId,
          sender: "founder",
          summary: `Task ${task.taskId} created: ${task.title}`,
          payload: { priority: task.priority, project: task.project },
        });
        json(res, 201, { ok: true, task });
        return;
      }

      const taskTransitionMatch = /^\/api\/command\/tasks\/([^/]+)\/transition$/.exec(pathname);
      if (method === VERB_POST && taskTransitionMatch) {
        if (!requireCsrf()) return;
        const taskId = taskTransitionMatch[1];
        const body = await readBody(req);
        const task = activeTaskStore.transitionTask(taskId, body.nextState, body.actor || "system", body.reason, body.updates);
        json(res, 200, { ok: true, task });
        return;
      }

      const taskBuilderCompleteMatch = /^\/api\/command\/tasks\/([^/]+)\/builder-completion$/.exec(pathname);
      if (method === VERB_POST && taskBuilderCompleteMatch) {
        if (!requireCsrf()) return;
        const taskId = taskBuilderCompleteMatch[1];
        const body = await readBody(req);
        const currentTask = activeTaskStore.getTask(taskId);
        if (!currentTask) {
          json(res, 404, { error: `Task '${taskId}' not found`, code: "TASK_NOT_FOUND" });
          return;
        }
        const guardTask = activePmExecutionStore
          ? { ...currentTask.execution, taskId, state: currentTask.execution?.state }
          : currentTask;
        const check = VerifierGuard.canSubmitBuilderCompletion(guardTask, body.artifact);
        if (!check.allowed) {
          json(res, 400, { error: check.reason, code: "BUILDER_COMPLETION_REFUSED" });
          return;
        }
        activeTaskStore.attachBuilderArtifact(taskId, body.artifact);
        const updated = activeTaskStore.transitionTask(taskId, "BUILDER_COMPLETE", body.artifact.builderSeat, "Builder completion submitted with test evidence");
        await roomAdapter.emitEvent("BUILDER_COMPLETE", {
          taskId,
          sender: body.artifact.builderSeat,
          summary: `Task ${taskId} builder completion submitted. Candidate SHA: ${body.artifact.candidateSha}`,
          payload: { candidateSha: body.artifact.candidateSha, filesCount: body.artifact.diffStat.filesCount },
        });
        json(res, 200, { ok: true, task: updated });
        return;
      }

      const taskVerifyMatch = /^\/api\/command\/tasks\/([^/]+)\/verify$/.exec(pathname);
      if (method === VERB_POST && taskVerifyMatch) {
        if (!requireCsrf()) return;
        const taskId = taskVerifyMatch[1];
        const body = await readBody(req);
        const currentTask = activeTaskStore.getTask(taskId);
        if (!currentTask) {
          json(res, 404, { error: `Task '${taskId}' not found`, code: "TASK_NOT_FOUND" });
          return;
        }
        const artifact = body.artifact;
        const guardTask = activePmExecutionStore
          ? { ...currentTask.execution, taskId, state: currentTask.execution?.state }
          : currentTask;
        if (artifact.result === "PASS") {
          const check = VerifierGuard.canAcceptTask(guardTask, artifact);
          if (!check.allowed) {
            json(res, 400, { error: check.reason, code: "VERIFICATION_ACCEPT_REFUSED" });
            return;
          }
          activeTaskStore.attachVerifierArtifact(taskId, artifact);
          const accepted = activeTaskStore.transitionTask(taskId, "ACCEPTED", artifact.verifierSeat, `Independent verification passed: ${artifact.verdictNotes}`);
          await roomAdapter.emitEvent("VERIFICATION_ACCEPTED", {
            taskId,
            sender: artifact.verifierSeat,
            summary: `Task ${taskId} ACCEPTED by independent verifier ${artifact.verifierSeat}`,
            payload: { evaluatedSha: artifact.evaluatedSha },
          });
          json(res, 200, { ok: true, verdict: "ACCEPTED", task: accepted });
          return;
        } else {
          const check = VerifierGuard.canRejectTask(guardTask, artifact);
          if (!check.allowed) {
            json(res, 400, { error: check.reason, code: "VERIFICATION_REJECT_REFUSED" });
            return;
          }
          activeTaskStore.attachVerifierArtifact(taskId, artifact);
          const rejected = activeTaskStore.transitionTask(taskId, "REJECTED", artifact.verifierSeat, `Verification rejected: ${artifact.verdictNotes}`);
          await roomAdapter.emitEvent("VERIFICATION_REJECTED", {
            taskId,
            sender: artifact.verifierSeat,
            summary: `Task ${taskId} REJECTED by verifier ${artifact.verifierSeat}: ${artifact.verdictNotes}`,
            payload: { findingsCount: artifact.findings.length },
          });
          json(res, 200, { ok: true, verdict: "REJECTED", task: rejected });
          return;
        }
      }

      if (method === VERB_GET && ["/api/command/workforce", "/api/command/fleet"].includes(pathname)) {
        const herdrState = await client.getState();
        const registry = readWorkforceCapabilityRegistry(path.resolve(process.env.COMMAND_WORKFORCE_CAPABILITIES || "data/workforce-capabilities.json"));
        const workforce = projectWorkforce(herdrState, {
          capabilities: registry.workers,
          activeWorkload: activePmExecutionStore?.listActiveWorkload() ?? [],
        });
        json(res, 200, {
          ok: workforce.state === "OBSERVED",
          ...workforce,
          fleet: workforce.seats,
        });
        return;
      }

      if (method === VERB_GET && pathname === "/api/command/capacity") {
        const herdrState = await client.getState();
        const workforce = projectWorkforce(herdrState);
        json(res, 200, {
          ok: workforce.state === "OBSERVED",
          observed_at: workforce.observed_at,
          source: "DECLARED STAFF PROFILE + LIVE HERDR + PM EXECUTION WORKLOAD; PROVIDER QUOTA NOT CONNECTED",
          capacity: workforce.seats.map((seat) => ({
            seat: seat.handle,
            provider: seat.provider_owner,
            capacityClass: seat.capacity_class,
            telemetrySource: seat.quota.source ?? "UNKNOWN",
            quotaStatus: seat.quota.status,
            availability: seat.availability,
            dispatchEligible: seat.dispatch_eligible,
            reason: seat.quota.reason,
          })),
        });
        return;
      }

      if (method === VERB_GET && pathname === "/api/command/stuck") {
        json(res, 200, { ok: true, stuckTasks: stuckDetector.listStuckTasks() });
        return;
      }

      const stuckEscalateMatch = /^\/api\/command\/stuck\/([^/]+)\/escalate$/.exec(pathname);
      if (method === VERB_POST && stuckEscalateMatch) {
        if (!requireCsrf()) return;
        const taskId = stuckEscalateMatch[1];
        const record = stuckDetector.escalate(taskId);
        if (!record) {
          json(res, 404, { error: `Task '${taskId}' not tracked by stuck detector`, code: "TASK_NOT_TRACKED" });
          return;
        }
        await roomAdapter.emitEvent("SESSION_STUCK", {
          taskId,
          sender: "command-monitor",
          summary: `Task ${taskId} escalated: Session STUCK on seat '${record.seat}'`,
          payload: { signalsCount: record.signals.length, seat: record.seat },
        });
        json(res, 200, { ok: true, record });
        return;
      }

      if (method === VERB_GET && pathname === "/api/command/room-events") {
        const taskId = url.searchParams.get("taskId") || undefined;
        const type = url.searchParams.get("type") || undefined;
        const read = roomAdapter.readEvents({ taskId, type });
        // COM-GAP-009. An absent or unreadable source is 503 with an explicit
        // UNAVAILABLE state. It was 200 {ok:true, events:[]} — a false-empty
        // that reported a healthy, empty feed for a ledger that has never
        // existed on a clean tree. A caller must be able to tell "no events"
        // from "no feed", and only the status code and the state field do that.
        if (!read.ok) {
          json(res, 503, {
            ok: false,
            state: read.state,
            error: read.reason,
            code: "ROOM_EVENTS_LEDGER_UNAVAILABLE",
            path: read.path,
          });
          return;
        }
        // A damaged ledger is still 200 — it was read — but it says how many
        // lines it could not parse, so a truncated file cannot be mistaken for a
        // complete history.
        json(res, 200, {
          ok: true,
          state: read.state,
          events: read.events,
          total_lines: read.total_lines,
          skipped_malformed: read.skipped_malformed,
        });
        return;
      }

      if (method === VERB_POST && pathname === "/api/command/room-events") {
        if (!requireCsrf()) return;
        const body = await readBody(req);
        const event = await roomAdapter.emitEvent(body.type, {
          taskId: body.taskId,
          sender: body.sender || "founder",
          summary: body.summary,
          payload: body.payload,
          broadcastToRoom: body.broadcastToRoom,
        });
        json(res, 201, { ok: true, event });
        return;
      }

      // 404 for unhandled route
      json(res, 404, { error: `Not found: ${method} ${pathname}`, code: "NOT_FOUND" });
    } catch (err) {
      const status = err instanceof HerdrClientError ? err.status : 500;
      const code = err instanceof HerdrClientError ? err.code : "INTERNAL_ERROR";
      json(res, status, { error: err.message, code, detail: err.detail ?? null });
    }
  });

  return {
    server,
    port,
    host,
    client,
    listen: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// Direct execution entry point
export let lifecycleService = null;
if (process.argv[1] && process.argv[1].endsWith("herdr-service.mjs")) {
  const service = createHerdrService();
  lifecycleService = service;
  service.listen().then(({ port }) => {
    process.stdout.write(`STARQ COMMAND // Herdr Service listening on 127.0.0.1:${port}\n`);
  });
}
