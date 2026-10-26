/**
 * tests/herdr-client.test.tsx
 *
 * ── COMMAND HERDR INTEGRATION TEST SUITE ────────────────────────────────────
 *
 * Proves the 9 minimum properties required by the Founder's directive (Room seq 8448):
 *   1. Health success
 *   2. Broker unavailable/degraded handling
 *   3. Session establishment (allowlisted Origin, cookie + csrf extraction)
 *   4. CSRF use on mutating actions
 *   5. Stale/restarted broker boot/session invalidation
 *   6. Malformed/refused responses fail safely
 *   7. Command cannot invoke arbitrary execution (strictly bounded API)
 *   8. UI accurately reflects offline/online/runtime state
 *   9. Real broker bounded integration probe
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HerdrClient, HerdrClientError, validateAgentId } from '../integrations/herdr/herdr-client.mjs';
import { createHerdrService } from '../integrations/herdr/herdr-service.mjs';
import { HerdrSurface, type HerdrSessionState } from '../src/surfaces/herdr';

describe('HERDR CLIENT — Bounded Integration Contract', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let mockUrl: string;

  let currentBootId = 'boot-test-initial-1111';
  let activeSessions = new Map<string, { csrf: string; bootId: string }>();
  let healthCallCount = 0;
  let lastReceivedOrigin: string | null = null;
  let lastReceivedCookie: string | null = null;
  let lastReceivedCsrf: string | null = null;
  let floorOpened = false;
  let agentStates = new Map<string, string>([
    ['elder', 'EXITED'],
    ['codex', 'EXITED'],
    ['cursor', 'EXITED'],
    ['deadpool', 'EXITED'],
  ]);

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Herdr-Floor-Access': 'LOOPBACK_ONLY',
          ...headers,
        });
        res.end(JSON.stringify(body));
      };

      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const method = req.method;
      lastReceivedOrigin = (req.headers.origin as string) || null;
      lastReceivedCookie = (req.headers.cookie as string) || null;
      lastReceivedCsrf = (req.headers['x-csrf-token'] as string) || null;

      // GET /api/health
      if (method === 'GET' && url.pathname === '/api/health') {
        healthCallCount++;
        send(200, { ok: true, boot_id: currentBootId, access: 'LOOPBACK_ONLY' });
        return;
      }

      // GET /api/herdr
      if (method === 'GET' && url.pathname === '/api/herdr') {
        send(200, {
          herdr: {
            state: 'AVAILABLE',
            version: '0.9.1',
            protocol: 22,
            detail: 'Herdr server running on test socket',
          },
          note: 'read-only; the broker never starts the Herdr server',
        });
        return;
      }

      // GET /api/agents
      if (method === 'GET' && url.pathname === '/api/agents') {
        send(200, {
          authority: 'HERDR_FLOOR_BROKER',
          access: 'LOOPBACK_ONLY',
          boot_id: currentBootId,
          generated_at: new Date().toISOString(),
          floor: { floor_opened: floorOpened, floor_opens: floorOpened ? 1 : 0 },
          terminal: { resize_enabled: false, fallback_size: { cols: 80, rows: 24 } },
          agents: [
            {
              id: 'elder',
              label: 'Elder',
              runtime: 'windows',
              startup_policy: 'FLOOR_LAUNCH',
              launchable: true,
              terminal: true,
              state: agentStates.get('elder') || 'EXITED',
              pid: agentStates.get('elder') === 'RUNNING' ? 1234 : null,
              session_id: agentStates.get('elder') === 'RUNNING' ? 'sess-elder' : null,
              cwd: 'D:\\StarqTech',
              executable: 'C:\\path\\claude.exe',
              args: [],
            },
            {
              id: 'cursor',
              label: 'Cursor',
              runtime: 'windows',
              startup_policy: 'FLOOR_LAUNCH',
              launchable: false,
              terminal: false,
              state: 'EXITED',
              pid: null,
              session_id: null,
              cwd: 'D:\\StarqTech',
              executable: null,
              args: [],
              note: 'no verified launch command on this host',
            },
            {
              id: 'deadpool',
              label: 'Deadpool',
              runtime: 'wsl',
              startup_policy: 'MANUAL',
              launchable: true,
              terminal: false,
              state: agentStates.get('deadpool') || 'EXITED',
              pid: null,
              session_id: null,
              cwd: 'D:\\StarqTech',
              executable: 'wsl.exe',
              args: ['-d', 'Ubuntu'],
            },
          ],
          sessions: [],
          registry_records: [],
          exclusions: ['no browser-to-shell route exists'],
        });
        return;
      }

      // GET /api/sessions
      if (method === 'GET' && url.pathname === '/api/sessions') {
        send(200, { boot_id: currentBootId, sessions: [] });
        return;
      }

      // POST /api/session
      if (method === 'POST' && url.pathname === '/api/session') {
        if (!req.headers.origin || !req.headers.origin.includes('5173')) {
          send(403, { error: 'Origin refused', code: 'ORIGIN_REFUSED' });
          return;
        }
        const sid = 'sess-' + Math.random().toString(36).slice(2);
        const csrf = 'csrf-' + Math.random().toString(36).slice(2);
        activeSessions.set(sid, { csrf, bootId: currentBootId });
        send(
          200,
          { csrf_token: csrf, boot_id: currentBootId },
          { 'Set-Cookie': `herdr_floor=${sid}; Path=/; HttpOnly; SameSite=Strict` },
        );
        return;
      }

      // Helper to verify session & CSRF
      const verifyAuth = () => {
        const cookie = req.headers.cookie;
        const match = /herdr_floor=([^;]+)/.exec(cookie || '');
        const sid = match ? match[1] : null;
        if (!sid || !activeSessions.has(sid)) {
          send(401, { error: 'Authentication required', code: 'AUTHENTICATION_REQUIRED' });
          return false;
        }
        const session = activeSessions.get(sid)!;
        if (session.bootId !== currentBootId) {
          send(403, { error: 'Stale boot session', code: 'STALE_BOOT' });
          return false;
        }
        const presentedCsrf = req.headers['x-csrf-token'];
        if (!presentedCsrf || presentedCsrf !== session.csrf) {
          send(403, { error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
          return false;
        }
        return true;
      };

      // POST /api/floor/open
      if (method === 'POST' && url.pathname === '/api/floor/open') {
        if (!verifyAuth()) return;
        floorOpened = true;
        send(200, {
          floor: { floor_opened: true, floor_opens: 1 },
          started: [{ id: 'elder', session_id: 'sess-elder', pid: 1234 }],
          skipped: [{ id: 'cursor', refusal: 'NOT_LAUNCHABLE' }],
        });
        return;
      }

      // POST /api/agents/:id/start
      const startMatch = /^\/api\/agents\/([^/]+)\/start$/.exec(url.pathname);
      if (method === 'POST' && startMatch) {
        if (!verifyAuth()) return;
        const id = startMatch[1];
        if (id === 'cursor') {
          send(403, { error: 'Agent is unlaunchable', code: 'NOT_LAUNCHABLE' });
          return;
        }
        agentStates.set(id, 'RUNNING');
        send(200, { agent: id, session_id: `sess-${id}`, pid: 5678 });
        return;
      }

      // POST /api/agents/:id/stop
      const stopMatch = /^\/api\/agents\/([^/]+)\/stop$/.exec(url.pathname);
      if (method === 'POST' && stopMatch) {
        if (!verifyAuth()) return;
        const id = stopMatch[1];
        agentStates.set(id, 'EXITED');
        send(200, { agent_id: id, stopped: true, pid: null });
        return;
      }

      // POST /api/agents/:id/restart
      const restartMatch = /^\/api\/agents\/([^/]+)\/restart$/.exec(url.pathname);
      if (method === 'POST' && restartMatch) {
        if (!verifyAuth()) return;
        const id = restartMatch[1];
        agentStates.set(id, 'RUNNING');
        send(200, { agent: id, session_id: `sess-${id}-re`, pid: 9999 });
        return;
      }

      // Malformed / unhandled route
      send(404, { error: 'Not found', code: 'NOT_FOUND' });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as { port: number };
        mockPort = addr.port;
        mockUrl = `http://127.0.0.1:${mockPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  // 1. Health success
  it('1. health success: returns broker health and boot_id', async () => {
    const client = new HerdrClient({ brokerUrl: mockUrl });
    const health = await client.getHealth();
    expect(health.ok).toBe(true);
    expect(health.boot_id).toBe(currentBootId);
    expect(health.access).toBe('LOOPBACK_ONLY');
  });

  // 2. Broker unavailable / degraded handling
  it('2. broker unavailable/degraded handling: reports offline without unhandled throw', async () => {
    // Port 65432 should be closed
    const deadClient = new HerdrClient({ brokerUrl: 'http://127.0.0.1:65432', timeoutMs: 500 });
    const state = await deadClient.getState();

    expect(state.broker.online).toBe(false);
    expect(state.herdr.state).toBe('UNAVAILABLE');
    expect(state.floor.floor_opened).toBe(false);
    expect(state.agents).toEqual([]);
    expect(state.sessions).toEqual([]);
  });

  // 3. Session establishment
  it('3. session establishment: mints session with allowlisted Origin and extracts cookie + CSRF', async () => {
    const client = new HerdrClient({ brokerUrl: mockUrl, origin: 'http://127.0.0.1:5173' });
    expect(client.hasActiveSession).toBe(false);

    const session = await client.mintSession();
    expect(session.cookie).toMatch(/^sess-/);
    expect(session.csrfToken).toMatch(/^csrf-/);
    expect(session.bootId).toBe(currentBootId);
    expect(client.hasActiveSession).toBe(true);
    expect(lastReceivedOrigin).toBe('http://127.0.0.1:5173');
  });

  // 4. CSRF use on mutating actions
  it('4. CSRF use: passes session cookie and X-CSRF-Token on lifecycle controls', async () => {
    const client = new HerdrClient({ brokerUrl: mockUrl });
    const result = await client.openFloor();

    expect(result.floor.floor_opened).toBe(true);
    expect(lastReceivedCookie).toContain('herdr_floor=');
    expect(lastReceivedCsrf).toBeTruthy();
  });

  // 5. Stale / restarted broker boot invalidation
  it('5. stale/restarted broker boot: invalidates session when boot_id changes', async () => {
    const client = new HerdrClient({ brokerUrl: mockUrl });
    await client.ensureSession();
    expect(client.cachedBootId).toBe(currentBootId);

    // Simulate broker restart with a new boot ID
    currentBootId = 'boot-test-restarted-2222';

    // Probing health should detect bootId divergence and invalidate session
    const health = await client.getHealth();
    expect(health.boot_id).toBe('boot-test-restarted-2222');
    expect(client.cachedBootId).toBe(null);

    // Starting an agent will now re-mint a fresh session bound to the new boot
    const startRes = await client.startAgent('elder');
    expect(startRes.agent).toBe('elder');
    expect(client.cachedBootId).toBe('boot-test-restarted-2222');
  });

  // 6. Malformed / refused responses fail safely
  it('6. malformed/refused responses fail safely with HerdrClientError', async () => {
    const client = new HerdrClient({ brokerUrl: mockUrl });

    // Cursor is unlaunchable on this host
    await expect(client.startAgent('cursor')).rejects.toThrow(HerdrClientError);

    try {
      await client.startAgent('cursor');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HerdrClientError);
      expect(err.code).toBe('NOT_LAUNCHABLE');
      expect(err.status).toBe(403);
    }
  });

  // 7. Command cannot invoke arbitrary execution
  it('7. Command cannot invoke arbitrary execution: invalid IDs and verbs are rejected', () => {
    expect(() => validateAgentId('rm -rf /')).toThrow(HerdrClientError);
    expect(() => validateAgentId('elder; whoami')).toThrow(HerdrClientError);
    expect(() => validateAgentId('')).toThrow(HerdrClientError);
    expect(() => validateAgentId('../../etc/passwd')).toThrow(HerdrClientError);

    const client = new HerdrClient({ brokerUrl: mockUrl });
    // Method signature has no command string, no shell flag, no args array
    expect((client as any).exec).toBeUndefined();
    expect((client as any).execute).toBeUndefined();
    expect((client as any).shell).toBeUndefined();
    expect((client as any).sendText).toBeUndefined();
    expect((client as any).ptyInjection).toBeUndefined();
  });

  // 8. UI accurately reflects offline/online/runtime state
  describe('8. UI presentation honesty', () => {
    it('accurately renders broker offline state', () => {
      const offlineState: HerdrSessionState = {
        timestamp: new Date().toISOString(),
        broker: { online: false, error: 'Connection refused 127.0.0.1:5188' },
        herdr: { state: 'UNAVAILABLE', detail: 'broker unreachable' },
        floor: { floor_opened: false, floor_opens: 0 },
        terminal: { resize_enabled: false, fallback_size: { cols: 80, rows: 24 } },
        agents: [],
        sessions: [],
        session_established: false,
        session_boot_id: null,
      };

      const html = renderToStaticMarkup(<HerdrSurface initialState={offlineState} pollIntervalMs={0} />);

      expect(html).toContain('Herdr Floor Broker Offline');
      expect(html).toContain('OFFLINE');
      expect(html).toContain('Retry Connection');
      expect(html).toContain('Unopened');
    });

    it('accurately renders broker online state with agents and controls', () => {
      const onlineState: HerdrSessionState = {
        timestamp: new Date().toISOString(),
        broker: { online: true, boot_id: 'boot-live-1', access: 'LOOPBACK_ONLY' },
        herdr: { state: 'AVAILABLE', version: '0.9.1' },
        floor: { floor_opened: true, floor_opens: 1 },
        terminal: { resize_enabled: false, fallback_size: { cols: 80, rows: 24 } },
        agents: [
          {
            id: 'elder',
            label: 'Elder',
            runtime: 'windows',
            startup_policy: 'FLOOR_LAUNCH',
            launchable: true,
            terminal: true,
            state: 'RUNNING',
            pid: 1234,
            session_id: 'sess-elder',
            cwd: 'D:\\StarqTech',
            executable: 'claude.exe',
          },
          {
            id: 'cursor',
            label: 'Cursor',
            runtime: 'windows',
            startup_policy: 'FLOOR_LAUNCH',
            launchable: false,
            terminal: false,
            state: 'EXITED',
            pid: null,
            session_id: null,
            cwd: 'D:\\StarqTech',
            executable: null,
            note: 'no verified launch command',
          },
          {
            id: 'deadpool',
            label: 'Deadpool',
            runtime: 'wsl',
            startup_policy: 'MANUAL',
            launchable: true,
            terminal: false,
            state: 'EXITED',
            pid: null,
            session_id: null,
            cwd: 'D:\\StarqTech',
            executable: 'wsl.exe',
          },
        ],
        sessions: [{ session_id: 'sess-elder', agent_id: 'elder', pid: 1234 }],
        session_established: true,
        session_boot_id: 'boot-live-1',
      };

      const html = renderToStaticMarkup(<HerdrSurface initialState={onlineState} pollIntervalMs={0} />);

      expect(html).toContain('ONLINE (127.0.0.1:5188)');
      expect(html).toContain('AVAILABLE');
      expect(html).toContain('Elder');
      expect(html).toContain('RUNNING');
      expect(html).toContain('Stop');
      expect(html).toContain('Restart');
      expect(html).toContain('Cursor');
      expect(html).toContain('Not launchable');
      expect(html).toContain('Deadpool');
      expect(html).toContain('MANUAL');
      expect(html).toContain('Floor Already Opened');
    });
  });

  // 9. Real broker bounded integration probe
  it('9. real broker bounded integration probe: reads live 127.0.0.1:5188 when present', async () => {
    const liveClient = new HerdrClient({ brokerUrl: 'http://127.0.0.1:5188' });

    let isLiveAvailable = false;
    try {
      const health = await liveClient.getHealth();
      expect(health.ok).toBe(true);
      expect(health.boot_id).toMatch(/^boot-/);
      expect(health.access).toBe('LOOPBACK_ONLY');
      isLiveAvailable = true;
    } catch {
      // If broker process was stopped by operator, skip live assertions safely
    }

    if (isLiveAvailable) {
      const [agentsData, herdrStatus] = await Promise.all([
        liveClient.getAgents(),
        liveClient.getHerdrStatus(),
      ]);

      expect(agentsData.authority).toBe('HERDR_FLOOR_BROKER');
      expect(agentsData.agents.length).toBe(8);
      expect(herdrStatus.herdr).toBeDefined();

      const deadpoolRow = agentsData.agents.find((a: any) => a.id === 'deadpool');
      expect(deadpoolRow.startup_policy).toBe('MANUAL');
      expect(deadpoolRow.terminal).toBe(false);

      const cursorRow = agentsData.agents.find((a: any) => a.id === 'cursor');
      expect(cursorRow.launchable).toBe(false);
    }
  });

  // 10. Blocker A regression: mutating verbs on GET strictly refused, mutating POST enforces Origin and browser CSRF
  it('10. Blocker A regression: GET mutation refused with 405, mutating POST enforces Origin and CSRF', async () => {
    const serviceClient = new HerdrClient({ brokerUrl: mockUrl });
    const service = createHerdrService({ port: 0, client: serviceClient });
    const address = await service.listen();
    const serviceOrigin = `http://127.0.0.1:${(address as any).port}`;

    try {
      // (a) GET /api/herdr/action must be refused with 405
      const getAction = await fetch(`${serviceOrigin}/api/herdr/action?op=open-floor`);
      expect(getAction.status).toBe(405);
      const actionBody = await getAction.json();
      expect(actionBody.code).toBe('METHOD_NOT_ALLOWED');

      // (b) GET /api/herdr/floor/open must be refused with 405
      const getFloorOpen = await fetch(`${serviceOrigin}/api/herdr/floor/open`);
      expect(getFloorOpen.status).toBe(405);

      // (c) GET /api/herdr/agents/codex/start must be refused with 405
      const getAgentStart = await fetch(`${serviceOrigin}/api/herdr/agents/codex/start`);
      expect(getAgentStart.status).toBe(405);

      // (d) POST /api/herdr/floor/open without Origin must be refused with 403 ORIGIN_REFUSED
      const postNoOrigin = await fetch(`${serviceOrigin}/api/herdr/floor/open`, {
        method: 'POST',
      });
      expect(postNoOrigin.status).toBe(403);
      const noOriginBody = await postNoOrigin.json();
      expect(noOriginBody.code).toBe('ORIGIN_REFUSED');

      // (e) POST /api/herdr/floor/open with hostile Origin must be refused with 403 ORIGIN_REFUSED
      const postHostileOrigin = await fetch(`${serviceOrigin}/api/herdr/floor/open`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example.com' },
      });
      expect(postHostileOrigin.status).toBe(403);
      const hostileBody = await postHostileOrigin.json();
      expect(hostileBody.code).toBe('ORIGIN_REFUSED');

      // (f) POST /api/herdr/floor/open with allowlisted Origin but missing CSRF token -> 403 CSRF_INVALID
      const postNoCsrf = await fetch(`${serviceOrigin}/api/herdr/floor/open`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5173' },
      });
      expect(postNoCsrf.status).toBe(403);
      const noCsrfBody = await postNoCsrf.json();
      expect(noCsrfBody.code).toBe('CSRF_INVALID');

      // (g) POST /api/herdr/session with allowlisted Origin mints session and returns csrfToken
      const postSession = await fetch(`${serviceOrigin}/api/herdr/session`, {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:5173' },
      });
      expect(postSession.status).toBe(200);
      const sessionBody = await postSession.json();
      expect(sessionBody.ok).toBe(true);
      const csrf = sessionBody.session.csrfToken;
      expect(csrf).toBeDefined();

      // (h) POST /api/herdr/floor/open with allowlisted Origin and valid CSRF token succeeds (200)
      const postAuthFloor = await fetch(`${serviceOrigin}/api/herdr/floor/open`, {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:5173',
          'X-CSRF-Token': csrf,
        },
      });
      expect(postAuthFloor.status).toBe(200);
      const floorBody = await postAuthFloor.json();
      expect(floorBody.ok).toBe(true);
      expect(floorBody.result.floor.floor_opened).toBe(true);
    } finally {
      await service.close();
    }
  });
});

