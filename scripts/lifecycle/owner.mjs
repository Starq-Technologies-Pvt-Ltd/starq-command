/**
 * STARQ // COMMAND lifecycle OWNER — the only component that starts, stops or
 * recovers the control plane, and the only place that decides whether a
 * recorded process may be signalled.
 *
 * Ownership of a control-plane child is proven by ALL of:
 *   - exact executable path == the configured D: node runtime,
 *   - exact OS creation time == the creation time captured right after spawn,
 *   - the per-launch instance proof over the child's control pipe (HMAC of the
 *     launch token, which never leaves the owner/child pair).
 * Command-line text is never ownership evidence.
 *
 * Graceful stop is the only stop. Forced termination exists solely in
 * recover({force:true}), re-proves executable + creation time immediately
 * before each forced signal, and never touches a pid it cannot prove.
 *
 * Every OS seam is injectable (deps) so the whole decision table runs offline.
 */
import { spawn, execFile } from 'node:child_process';
import { openSync, closeSync, appendFileSync, writeSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, findEnvOverrides, findObservationEnvHazards, topoOrder, componentEnv, standaloneHerdr, REQUIRED_COMPONENTS, OBSERVATION_PROFILE, COMMAND_LOCAL_PROFILE, COMMAND_LOCAL_REQUIRED } from './config.mjs';
import { readState, writeState, archiveState, appendEvent, STATE_SCHEMA } from './state.mjs';
import { inspectProcesses, inspectDeclaredInfrastructure, listListeners, osVerdict, sameExe, InspectionError, classifyInfrastructureProcess } from './inspect.mjs';
import { proveInstance, proveBoundAddress, boundOnPort, requestShutdown } from './control.mjs';
import { checkHealth } from './health.mjs';
import { buildHealthPreflight, buildRepositoryPreflight } from './preflight.mjs';
import { acquireLock, releaseLock, readLock, LockedError } from './lock.mjs';
import { readGates, readObservationGates, readDevelopmentGates, readStandaloneHerdrGate, readCommandLocalGates } from './gates.mjs';
import { importExternalComponent } from '../../server/external-components.mjs';
import { evaluateHistoricalCloseoutHandoff, evaluateRecordedHistoricalCloseoutRecovery } from './historical-closeout-handoff.mjs';
import { provablyGoneAcrossBoot } from './boot-closeout.mjs';

const [herdrStatusComponent, herdrLauncherComponent, herdrContainmentComponent] = await Promise.all([
  importExternalComponent('herdr-floor', 'src/herdr-status.mjs'),
  importExternalComponent('herdr-floor', 'src/launcher.mjs'),
  importExternalComponent('herdr-floor', 'src/containment-config.mjs'),
]);
const unavailableOperation = (component, exportName) => () => {
  throw new Error(component.reason ?? `${component.name} module does not export ${exportName}`);
};
const readHerdrStatus = herdrStatusComponent.module?.readHerdrStatus ?? unavailableOperation(herdrStatusComponent, 'readHerdrStatus');
const nativeContainment = herdrLauncherComponent.module?.nativeContainment ?? unavailableOperation(herdrLauncherComponent, 'nativeContainment');
const resolvePid = herdrLauncherComponent.module?.resolvePid ?? unavailableOperation(herdrLauncherComponent, 'resolvePid');
const containmentOptions = herdrContainmentComponent.module?.containmentOptions ?? unavailableOperation(herdrContainmentComponent, 'containmentOptions');

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHILD_HOST = path.resolve(HERE, '..', 'lifecycle-child.mjs');

export const RESULT = Object.freeze({
  READY: 'READY', STOPPED: 'STOPPED', REFUSED: 'REFUSED', START_FAILED: 'START_FAILED',
  ROLLBACK_INCOMPLETE: 'ROLLBACK_INCOMPLETE', STOP_INCOMPLETE: 'STOP_INCOMPLETE',
});
export const EXIT = Object.freeze({
  READY: 0, STOPPED: 0, REFUSED: 1, START_FAILED: 2, STOP_INCOMPLETE: 2, ROLLBACK_INCOMPLETE: 3,
});

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

function brokerRequestReal(host, port, method, pathname, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-Starq-Lifecycle-Token': token };
    if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = '2'; }
    const req = http.request({ host, port, method, path: pathname, headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('broker request timeout')));
    req.on('error', reject);
    if (method === 'POST') req.write('{}');
    req.end();
  });
}

function forceKillReal(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, timeout: 15000 },
      (err, stdout, stderr) => resolve({ ok: !err, detail: String(stdout || stderr || err?.message || '').trim() }));
  });
}

/**
 * Native containment, split by what the caller is about to do.
 *
 * `containmentOptions` runs, by default, a RUNTIME PROBE: it launches a
 * disposable child, waits for its signed started receipt, and proves a Job
 * Object really contains it. That is the right precondition before LAUNCHING a
 * new child on a machine - "can we contain what we are about to start?"
 *
 * It is the wrong precondition for acting on a descriptor that was ALREADY
 * issued. `stop`, `status`, the closeout proof and forced recovery only need the
 * pinned guardian and the recorded descriptor; the kernel answers `owned`,
 * `closed`, `active` and `root_gone` itself and the guardian reply is validated
 * strictly. Re-running the probe there added nothing to ownership, yet made
 * stopping running services depend on a brand new child spawning and writing a
 * receipt inside a fixed 2.5 s window - so a service that was up could fail to be
 * stopped through the supported path, with an error about a probe child rather
 * than about the service. `waitGone` polls, so it paid that cost, about 0.8 s
 * and a spawned process, on every iteration.
 *
 * `verifyRuntime: false` is the companion's own supported option. It skips only
 * the throwaway-child experiment; the guardian binary pin, source pin, build
 * schema and dependency-drift checks still run. Nothing about ownership is
 * relaxed: instance proof over the control pipe, the HMAC receipt and the
 * kernel's own `owned` verdict are untouched.
 *
 * The recorded-descriptor accessor deliberately exposes no `launch`, so the
 * unprobed path cannot be used to start anything.
 */
export function createContainmentAccessors({ containmentOptions: options, nativeContainment: native, resolve }) {
  const build = (verifyRuntime) => {
    const { workspace, stateDir, tier } = resolve();
    return native(options(workspace, stateDir, { tier, verifyRuntime }));
  };
  return {
    forLaunch: () => build(true),
    forRecorded: () => {
      const { status, stop, receipt } = build(false);
      return { status, stop, receipt };
    },
  };
}

export function createOwner({ configFile, runtimeDir, lockFile = path.join(runtimeDir, 'lifecycle.lock'), env = process.env, configOptions = {}, inspectionTools = null, deps = {}, tier = null }) {
  const containment = createContainmentAccessors({
    containmentOptions: deps.containmentOptions ?? containmentOptions,
    nativeContainment: deps.nativeContainment ?? nativeContainment,
    resolve: () => ({ workspace: cfgOf().workspace_root, stateDir: runtimeDir, tier: effectiveTier() }),
  });
  const jobs = containment.forLaunch;       // launch only: proves a new child can be contained
  const recorded = containment.forRecorded; // everything else: acts on an already-issued descriptor
  const effectiveTier = () => tier ?? (cfgOf().profile?.tier ?? 'development');
  const inspectionOptions = inspectionTools ? { powershellExe: inspectionTools.powershell } : {};
  const listenerOptions = inspectionTools ? { netstatExe: inspectionTools.netstat } : {};
  const d = {
    inspect: deps.inspect ?? ((pids) => inspectProcesses(pids, inspectionOptions)),
    inspectInfrastructure: deps.inspectInfrastructure ?? ((pins) => inspectDeclaredInfrastructure(pins, inspectionOptions)),
    listListeners: deps.listListeners ?? (() => listListeners(listenerOptions)),
    spawnChild: deps.spawnChild ?? (async (exe, args, opts, reserve) => {
      const child = jobs().launch({ argv: [exe, ...args], ...opts }, reserve);
      if (!await resolvePid(child)) throw new Error('contained launch has no authenticated root receipt; reservation retained');
      return child;
    }),
    proveInstance: deps.proveInstance ?? ((child) => proveInstance(child)),
    proveBoundAddress: deps.proveBoundAddress ?? ((child) => proveBoundAddress(child)),
    requestShutdown: deps.requestShutdown ?? ((child) => requestShutdown(child)),
    gracefulStopContained: deps.gracefulStopContained ?? ((child, graceMs) => child.containment
      ? recorded().stop(child.containment, { force: false, graceMs })
      : Promise.resolve({ outcome: 'UNKNOWN', detail: 'contained graceful stop requires the recorded job descriptor' })),
    historicalCloseoutHandoff: deps.historicalCloseoutHandoff ?? evaluateHistoricalCloseoutHandoff,
    recordedHistoricalCloseoutRecovery: deps.recordedHistoricalCloseoutRecovery ?? evaluateRecordedHistoricalCloseoutRecovery,
    recoverOwnedJob: deps.recoverOwnedJob ?? ((descriptor, graceMs) => recorded().stop(descriptor, { force: true, graceMs })),
    checkHealth: deps.checkHealth ?? ((host, comp) => checkHealth(host, comp)),
    brokerRequest: deps.brokerRequest ?? brokerRequestReal,
    readFile: deps.readFile ?? ((f) => readFileSync(f, 'utf8')),
    forceKill: deps.forceKill ?? forceKillReal,
    sleep: deps.sleep ?? sleepReal,
    pollMs: deps.pollMs ?? 250,
    selfPid: deps.selfPid ?? process.pid,
    treeClosed: deps.treeClosed ?? (async (child) => {
      if (!child.containment) return false;
      if ((await recorded().status(child.containment)).closed === true) return true;
      // The guardian can only prove closeout from its `closed.json` receipt,
      // which an unclean shutdown never writes — so its `closed:false` means
      // "still open" OR "cannot tell", indistinguishably. Consult the reboot
      // proof, which needs no receipt, and journal its basis either way so a
      // settled child always says why it was settled.
      const cfg = cfgOf();
      const verdict = await provablyGoneAcrossBoot(child, {
        expectedExe: cfg.node,
        port: comp(cfg, child.name)?.port ?? null,
        inspect: d.inspect,
        listListeners: d.listListeners,
      });
      journal('closeout.boot_proof', { name: child.name, proven: verdict.proven, reason: verdict.reason, ...verdict.basis });
      return verdict.proven;
    }),
    treeSignalSafe: deps.treeSignalSafe ?? (async (child) => child.containment ? (await recorded().status(child.containment)).owned === true : false),
    prerequisites: deps.prerequisites ?? ((cfg) => {
      if (cfg.profile?.name === OBSERVATION_PROFILE) return readObservationGates(cfg.workspace_root, cfg);
      if (cfg.profile?.name === COMMAND_LOCAL_PROFILE) return readCommandLocalGates(cfg.workspace_root, cfg);
      if (effectiveTier() === 'development') return readDevelopmentGates(cfg.workspace_root, cfg);
      return readGates(cfg.workspace_root);
    }),
    standaloneHerdrGate: deps.standaloneHerdrGate ?? ((cfg) => readStandaloneHerdrGate(cfg.workspace_root)),
    // Read-only `herdr status` through the pinned binary; reached only after G-PROFILE resolves.
    probeStandaloneHerdr: deps.probeStandaloneHerdr ?? ((entry) => readHerdrStatus({ bin: entry.executable })),
  };
  const statePath = path.join(runtimeDir, 'state.json');
  const lockPath = lockFile;
  const logsDir = path.join(runtimeDir, 'logs');
  const journalPath = path.join(runtimeDir, 'lifecycle-journal.jsonl');

  const journal = (event, data = {}) => {
    try {
      mkdirSync(runtimeDir, { recursive: true });
      appendFileSync(journalPath, `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`, 'utf8');
    } catch {}
  };
  const refuse = (reason, extra = {}) => { journal('refused', { reason, ...extra }); return { result: RESULT.REFUSED, reason, ...extra }; };
  const save = (doc) => writeState(statePath, doc);
  const cfgOf = () => loadConfig(configFile, configOptions);
  const comp = (cfg, name) => cfg.components.find((c) => c.name === name);
  const transitivelyDependsOn = (components, name, target, seen = new Set()) => {
    if (name === target || seen.has(name)) return name === target;
    seen.add(name);
    const current = components.find((c) => c.name === name);
    return (current?.depends_on ?? []).some((dependency) => dependency === target
      || transitivelyDependsOn(components, dependency, target, seen));
  };

  async function withLock(op, fn) {
    let lock;
    try {
      lock = await acquireLock(lockPath, op, { inspect: d.inspect, selfPid: d.selfPid });
    } catch (err) {
      if (err instanceof LockedError || err instanceof InspectionError) return refuse(err.message, { code: 'LOCKED' });
      throw err;
    }
    try { return await fn(); } finally { releaseLock(lock); }
  }

  // ── Ownership ───────────────────────────────────────────────────────────
  /** @returns {Promise<Map<string,{verdict, detail}>>} verdict: OWNED|UNPROVEN|GONE|FOREIGN|UNKNOWN */
  async function classify(cfg, children, { prove = true } = {}) {
    const out = new Map();
    const live = children.filter((c) => c.status !== 'EXITED');
    let infos;
    try {
      infos = await d.inspect(live.map((c) => c.pid));
    } catch (err) {
      for (const c of live) out.set(c.name, { verdict: 'UNKNOWN', detail: `inspection failed: ${err.message}` });
      return out;
    }
    for (const c of live) {
      const v = osVerdict(c, infos.get(c.pid), cfg.node);
      if (v.verdict !== 'MATCH') { out.set(c.name, v); continue; }
      if (!prove) { out.set(c.name, { verdict: 'MATCH', detail: v.detail }); continue; }
      const proof = await d.proveInstance(c);
      out.set(c.name, proof.ok ? { verdict: 'OWNED', detail: `${v.detail}; ${proof.detail}` } : { verdict: 'UNPROVEN', detail: proof.detail });
    }
    return out;
  }

  async function waitGone(cfg, child) {
    if (child.containment && !deps.treeClosed) {
      const deadline = Date.now() + cfg.timeouts_ms.graceful_exit;
      for (;;) {
        const proof = await recorded().status(child.containment);
        if (proof.owned && proof.closed && proof.active === 0) return 'GONE';
        if (!proof.owned || Date.now() >= deadline) return proof.owned ? 'STILL_RUNNING' : 'UNKNOWN';
        await d.sleep(d.pollMs);
      }
    }
    const deadline = Date.now() + cfg.timeouts_ms.graceful_exit;
    let last = 'UNKNOWN';
    for (;;) {
      try {
        const v = osVerdict(child, (await d.inspect([child.pid])).get(child.pid), cfg.node).verdict;
        last = (v === 'GONE' || v === 'FOREIGN') ? 'GONE' : v === 'MATCH' ? 'STILL_RUNNING' : 'UNKNOWN';
      } catch { last = 'UNKNOWN'; }
      if (last === 'GONE') return await d.treeClosed(child) ? 'GONE' : 'UNKNOWN';
      if (Date.now() >= deadline) return last;
      await d.sleep(d.pollMs);
    }
  }

  // ── Broker lifecycle channel ────────────────────────────────────────────
  function brokerToken(cfg) {
    try { return d.readFile(cfg.abs(comp(cfg, 'herdrBroker').lifecycle_token)).trim() || null; } catch { return null; }
  }
  async function broker(cfg, method, pathname, timeoutMs = cfg.timeouts_ms.broker_request) {
    const token = brokerToken(cfg);
    if (!token) return { status: 0, body: null, error: 'broker lifecycle token unavailable' };
    try {
      return await d.brokerRequest(cfg.host, comp(cfg, 'herdrBroker').port, method, pathname, token, timeoutMs);
    } catch (err) {
      return { status: 0, body: null, error: err.message };
    }
  }

  /** Graceful stop of one owned child. Never forces. */
  async function stopChild(cfg, doc, child, { historicalCloseoutHandoff = null } = {}) {
    const [v] = [(await classify(cfg, [child])).get(child.name)];
    if (v.verdict === 'GONE' || v.verdict === 'FOREIGN') {
      if (!await d.treeClosed(child)) return { outcome: 'UNKNOWN', detail: 'root absent; descendant closeout unproven' };
      Object.assign(child, { status: 'EXITED', tree_closeout_verified: true, exited_at: new Date().toISOString(), exit_note: v.detail });
      appendEvent(doc, 'child.already_gone', { name: child.name, detail: v.detail }); save(doc);
      return { outcome: 'GONE', detail: v.detail };
    }
    if (v.verdict !== 'OWNED') return { outcome: v.verdict, detail: v.detail };
    child.status = 'STOPPING'; appendEvent(doc, 'child.stopping', { name: child.name }); save(doc);
    if (child.name === 'herdrBroker') {
      const token = brokerToken(cfg);
      if (token) {
        await broker(cfg, 'POST', '/api/lifecycle/drain');
        const r = await broker(cfg, 'POST', '/api/lifecycle/shutdown');
        if (r.status !== 202) {
          if (r.status === 409 && r.body?.code === 'NOT_DRAINED' && historicalCloseoutHandoff?.applied === true) {
            const latest = await broker(cfg, 'GET', '/api/lifecycle');
            const floor = await broker(cfg, 'GET', '/api/agents');
            const stateDir = path.dirname(cfg.abs(comp(cfg, 'herdrBroker').lifecycle_token));
            const current = latest.status === 200 && floor.status === 200
              ? await d.historicalCloseoutHandoff({ stateDir, lifecycleView: latest.body, registryProjection: floor.body?.registry_records })
              : { applied: false, reason: 'live lifecycle or registry projection unavailable for final recheck' };
            if (current?.applied !== true || !child.containment) {
              return { outcome: 'SHUTDOWN_REFUSED', detail: `historical exception recheck failed; no fallback signal: ${current?.reason ?? 'containment descriptor missing'}` };
            }
            const proof = await d.gracefulStopContained(child, cfg.timeouts_ms.graceful_exit);
            if (proof?.outcome !== 'GONE' || proof.closed !== true || proof.active !== 0 || proof.owned !== true || proof.forced === true) {
              return { outcome: proof?.outcome ?? 'UNKNOWN', detail: `non-forced JobGuardian closeout did not prove the broker job closed: ${proof?.error ?? proof?.detail ?? 'incomplete proof'}` };
            }
            appendEvent(doc, 'child.historical_closeout_exception_graceful_handoff', {
              decision: current.decision,
              session_ids: current.session_ids,
              historical_closeout: 'UNKNOWN',
              broker_boot_id: current.broker_boot_id,
              command_child_job_closed: true,
              forced: false,
            });
            save(doc);
            journal('child.historical_closeout_exception_graceful_handoff', { decision: current.decision, session_ids: current.session_ids, broker_boot_id: current.broker_boot_id, forced: false });
          } else {
            return { outcome: 'SHUTDOWN_REFUSED', detail: `broker refused shutdown: ${r.status} ${r.body?.code ?? r.error ?? ''}` };
          }
        }
      } else {
        return { outcome: 'SHUTDOWN_REFUSED', detail: 'broker lifecycle channel required for agent closeout' };
      }
    } else {
      const ack = await d.requestShutdown(child);
      if (!ack.ok) return { outcome: 'SHUTDOWN_REFUSED', detail: ack.detail };
    }
    const outcome = await waitGone(cfg, child);
    if (outcome === 'GONE') {
      Object.assign(child, { status: 'EXITED', tree_closeout_verified: true, exited_at: new Date().toISOString() });
      appendEvent(doc, 'child.exited', { name: child.name }); save(doc);
    }
    return { outcome, detail: outcome === 'GONE' ? 'exited gracefully' : 'did not exit within grace' };
  }

  // ── START ───────────────────────────────────────────────────────────────
  async function start() {
    return withLock('start', async () => {
      let cfg;
      try { cfg = cfgOf(); } catch (err) { return refuse(err.message, { code: 'CONFIG_INVALID' }); }
      const localProfile = cfg.profile?.name === COMMAND_LOCAL_PROFILE;
      const optionalNames = new Set(localProfile ? (cfg.profile?.optional_components ?? []) : []);
      if (cfg.profile?.name === OBSERVATION_PROFILE) {
        const hazards = findObservationEnvHazards(env);
        if (hazards.length) return refuse(`observer environment is contaminated: ${hazards.join(', ')}`, { code: 'OBSERVATION_ENV_UNSAFE', hazards });
      }
      const gates = await d.prerequisites(cfg);
      if (!Array.isArray(gates) || !gates.length || gates.some((g) => g.resolved !== true)) return refuse('verified lifecycle prerequisites are unresolved', { code: 'PREREQUISITES', gates });
      const overrides = findEnvOverrides(env, cfg);
      if (overrides.length) return refuse(`runtime overrides are rejected; lifecycle.config.json is the only port truth: ${overrides.join(', ')}`, { code: 'PORT_OVERRIDE_REJECTED' });

      // Full-floor startup retains its broker manifest guard unchanged. The
      // observation profile has no broker by schema, so there is no admission
      // mechanism or worker manifest in its component graph.
      if (cfg.profile?.name === OBSERVATION_PROFILE) {
        const names = cfg.components.map((c) => c.name);
        if (JSON.stringify(names) !== JSON.stringify(['data', 'building', 'ui'])) {
          return refuse('observation profile component graph changed after validation', { code: 'OBSERVATION_COMPOSITION' });
        }
      } else if (!localProfile) {
        try {
          const man = JSON.parse(d.readFile(cfg.abs(comp(cfg, 'herdrBroker').manifest)));
          const auto = (man.agents ?? []).filter((a) => a.startup_policy === 'AUTO').map((a) => a.id);
          if (auto.length) return refuse(`manifest has AUTO rows that would launch at broker boot: ${auto.join(', ')}`, { code: 'AUTO_AGENT' });
          if (path.resolve(man.workspace_root ?? '').toLowerCase() !== path.resolve(cfg.workspace_root).toLowerCase()) {
            return refuse(`manifest workspace_root ${man.workspace_root} != ${cfg.workspace_root}`, { code: 'MANIFEST_ROOT' });
          }
        } catch (err) { return refuse(`herdr manifest unreadable: ${err.message}`, { code: 'MANIFEST_UNREADABLE' }); }
      }

      const prior = readState(statePath);
      if (prior.kind === 'CORRUPT' || prior.kind === 'UNREADABLE') return refuse(`state file ${prior.kind}: ${prior.reason}`, { code: 'STATE_' + prior.kind });
      if (prior.kind === 'OK') {
        const s = prior.state;
        const settled = !(s.pending_launches?.length) && ['STOPPED', 'START_FAILED'].includes(s.state) && s.children.every((c) => c.status === 'EXITED' && c.tree_closeout_verified === true);
        if (!settled) return refuse(`previous runtime is ${s.state} with unsettled children; run stop or recover first`, { code: 'NOT_STOPPED' });
      }

      let listeners;
      try { listeners = await d.listListeners(); } catch (err) { return refuse(`listener inspection failed: ${err.message}`, { code: 'INSPECTION_FAILED' }); }
      // Required ports still fail closed on any pre-launch occupant. An occupied
      // OPTIONAL port (local profile) is not a global blocker: that optional
      // service is simply skipped at launch time.
      const ports = new Set(cfg.components.filter((c) => !optionalNames.has(c.name)).map((c) => c.port));
      const busy = listeners.filter((l) => ports.has(l.port));
      if (busy.length) return refuse(`ports occupied: ${busy.map((b) => `${b.port}<-pid ${b.pid}`).join(', ')}`, { code: 'PORT_CONFLICT', busy });

      if (prior.kind === 'OK' || prior.kind === 'LEGACY_STOPPED') archiveState(statePath, 'previous');
      const doc = {
        schema: STATE_SCHEMA, version: 2, state: 'STARTING', attempt_id: randomBytes(8).toString('hex'),
        config_sha256: cfg.sha256, profile: cfg.profile?.name ?? null, workspace: cfg.workspace_root,
        ports: Object.fromEntries(cfg.components.map((c) => [c.name, c.port])),
        started_at: new Date().toISOString(), ready_at: null, stopped_at: null, children: [], readiness: [], events: [],
      };
      appendEvent(doc, 'start.begin', { order: topoOrder(cfg.components).map((c) => c.name) });
      save(doc);
      journal('start.begin', { attempt: doc.attempt_id });

      let failure = null;
      for (const c of topoOrder(cfg.components)) {
        try {
          await launchOne(cfg, doc, c);
        } catch (err) {
          if (optionalNames.has(c.name)) {
            // Optional service: tolerate, but gracefully stop any half-started
            // child of this launch so nothing is left running unproven, then
            // continue. Local readiness never depends on an optional service.
            const halfStarted = doc.children.find((x) => x.name === c.name && x.attempt_id === doc.attempt_id && x.status !== 'EXITED');
            if (halfStarted) {
              const r = await stopChild(cfg, doc, halfStarted);
              appendEvent(doc, 'start.optional_unwound', { name: c.name, ...r }); save(doc);
            }
            (doc.optional_skipped ??= []).push({ name: c.name, reason: err.message });
            appendEvent(doc, 'start.optional_skipped', { name: c.name, reason: err.message }); save(doc);
            journal('start.optional_skipped', { name: c.name, reason: err.message });
            continue;
          }
          failure = { component: c.name, error: err.message };
          appendEvent(doc, 'start.component_failed', failure); save(doc);
          break;
        }
      }
      if (!failure) {
        doc.state = 'READY'; doc.ready_at = new Date().toISOString(); appendEvent(doc, 'start.ready'); save(doc);
        journal('start.ready', { attempt: doc.attempt_id });
        return { result: RESULT.READY, state: doc };
      }

      // Unwind ONLY what this attempt created, newest first, gracefully, through proven ownership.
      const unwound = [];
      let clean = true;
      for (const child of doc.children.filter((c) => c.attempt_id === doc.attempt_id && c.status !== 'EXITED').reverse()) {
        const r = await stopChild(cfg, doc, child);
        unwound.push({ name: child.name, ...r });
        if (r.outcome !== 'GONE') clean = false;
      }
      doc.state = clean ? 'START_FAILED' : 'ROLLBACK_INCOMPLETE';
      appendEvent(doc, 'start.rolled_back', { clean, unwound }); save(doc);
      journal('start.failed', { failure, unwound, clean });
      return { result: clean ? RESULT.START_FAILED : RESULT.ROLLBACK_INCOMPLETE, failure, unwound, state: doc };
    });
  }

  async function launchOne(cfg, doc, c) {
    if (!deps.spawnChild) {
      const current = await d.prerequisites(cfg);
      if (!Array.isArray(current) || !current.length || current.some((g) => g.resolved !== true)) throw new Error(`${c.name}: pre-launch policy/profile proof changed or remains UNKNOWN`);
    }
    mkdirSync(logsDir, { recursive: true });
    const log = path.join(logsDir, `${c.name}.log`);
    appendFileSync(log, `\n--- ${new Date().toISOString()} attempt ${doc.attempt_id} ---\n`, 'utf8');
    const fd = openSync(log, 'a');
    const instance = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('base64url');
    const observationOnly = cfg.profile?.name === OBSERVATION_PROFILE;
    const childEnv = observationOnly
      ? {
        SystemRoot: cfg.system_root,
        WINDIR: cfg.system_root,
        PATH: path.join(cfg.system_root, 'System32'),
        TEMP: path.join(cfg.system_root, 'Temp'),
        TMP: path.join(cfg.system_root, 'Temp'),
      }
      : { ...env };
    for (const k of Object.keys(childEnv)) if (k.startsWith('STARQ_LC_')) delete childEnv[k];
    delete childEnv.COMMAND_OBSERVATION_ONLY;
    for (const k of Object.keys(childEnv)) if (k.startsWith('PM_')) delete childEnv[k];
    if (observationOnly) {
      for (const k of Object.keys(childEnv)) if (k.startsWith('HERDR_') || k === 'COMMAND_UI_ORIGIN') delete childEnv[k];
    }
    Object.assign(childEnv, componentEnv(cfg, c.name), {
      STARQ_WORKSPACE: cfg.workspace_root,
      STARQ_LC_NAME: c.name, STARQ_LC_INSTANCE: instance, STARQ_LC_TOKEN: token, STARQ_LC_KIND: c.kind,
      STARQ_LC_ENTRY: cfg.abs(c.entry), STARQ_LC_PORT: String(c.port), STARQ_LC_HOST: cfg.host,
      STARQ_LC_ROOT: cfg.abs(c.cwd), ...(c.vite_config ? { STARQ_LC_VITE_CONFIG: cfg.abs(c.vite_config) } : {}),
    });
    let child;
    try {
      child = await d.spawnChild(cfg.node, [CHILD_HOST], {
        cwd: cfg.abs(c.cwd), env: childEnv, shell: false, windowsHide: true, detached: true, stdio: ['ignore', fd, fd],
      }, (containment) => {
        doc.pending_launches ??= [];
        doc.pending_launches.push({ name: c.name, instance_id: instance, containment });
        save(doc); // before the trusted bootstrap can create a workload
      });
    } finally { closeSync(fd); }
    if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error(`${c.name}: spawn produced no pid`);
    child.unref?.();
    const rec = {
      name: c.name, attempt_id: doc.attempt_id, instance_id: instance, token, pid: child.pid,
      exe: null, created_at: null, launched_at: new Date().toISOString(), status: 'LAUNCHED', log,
      containment: child.containment ?? null,
    };
    doc.children.push(rec);
    doc.pending_launches = (doc.pending_launches ?? []).filter((p) => p.instance_id !== instance);
    appendEvent(doc, 'child.launched', { name: c.name, pid: child.pid }); save(doc); // persisted before anything else

    const info = (await d.inspect([rec.pid])).get(rec.pid); // InspectionError propagates as a launch failure
    if (!info?.found) throw new Error(`${c.name}: pid ${rec.pid} exited immediately (see ${log})`);
    if (!info.exe || !info.created) throw new Error(`${c.name}: pid ${rec.pid} is not inspectable`);
    if (!sameExe(info.exe, cfg.node)) throw new Error(`${c.name}: pid ${rec.pid} runs ${info.exe}, not ${cfg.node}`);
    Object.assign(rec, { exe: info.exe, created_at: info.created, status: 'IDENTIFIED' });
    appendEvent(doc, 'child.identified', { name: c.name, pid: rec.pid, created_at: rec.created_at }); save(doc);

    const until = (ms) => Date.now() + ms;
    let deadline = until(cfg.timeouts_ms.identity);
    let proof;
    for (;;) {
      proof = await d.proveInstance(rec);
      if (proof.ok || Date.now() >= deadline) break;
      await d.sleep(d.pollMs);
    }
    if (!proof.ok) throw new Error(`${c.name}: instance not proven: ${proof.detail}`);

    /*
      READINESS: ask the component, not the OS.

      This used to require a LISTENING row from the OS TCP table owned by the
      launched pid. On this machine that table does not reliably report loopback
      listeners even while the service is answering HTTP, so a healthy child
      could never be marked ready and `start` failed at the first component
      whose row was missing.

      Ownership is now established the way it was always meant to be: the child
      is proven over the MAC-authenticated control pipe (above), and that same
      proven instance reports the addresses its own server objects are bound to.
      Only a process holding the launch token can answer, so a port claimed this
      way is claimed by OUR child by construction.

      The OS table is still consulted, but only as a NEGATIVE signal: if it does
      report a row on this port owned by someone else, that is a real conflict
      and still refuses. Its silence is no longer treated as evidence.
    */
    deadline = until(cfg.timeouts_ms.health);
    let health;
    let bound = { ok: false, supported: true, addresses: [], detail: 'not yet asked' };
    const summarizeListeners = (list) => list.map((r) => `${r.address ?? '?'}:${r.port}<-pid ${r.pid}`).join(', ') || 'none';
    const foreignOwner = (list) => list.some((l) => l.pid !== rec.pid && l.pid !== 0);
    const confirmsPort = () => bound.ok && boundOnPort(bound.addresses, c.port);
    for (;;) {
      health = await d.checkHealth(cfg.host, c);
      if (health.ok) {
        const rows = (await d.listListeners().catch(() => [])).filter((l) => l.port === c.port);
        if (foreignOwner(rows)) {
          throw new Error(`${c.name}: port ${c.port} listener is owned by another process (${summarizeListeners(rows)})`);
        }
        bound = await d.proveBoundAddress(rec);
        if (confirmsPort()) break;
        // A child host that predates the bound op cannot answer; fall back to
        // the health contract alone rather than refusing a working component.
        if (!bound.supported) break;
      }
      if (Date.now() >= deadline) break;
      const still = osVerdict(rec, (await d.inspect([rec.pid])).get(rec.pid), cfg.node);
      if (still.verdict !== 'MATCH') throw new Error(`${c.name}: process ${still.verdict} before healthy (${still.detail})`);
      await d.sleep(d.pollMs);
    }
    if (!health.ok) throw new Error(`${c.name}: health contract not met: ${health.detail}`);
    if (bound.supported && !confirmsPort()) {
      throw new Error(`${c.name}: the proven instance does not report itself bound to port ${c.port} (${bound.detail})`);
    }
    rec.status = 'READY';
    rec.bound_addresses = bound.ok ? bound.addresses : null;
    doc.readiness = [...(doc.readiness ?? []).filter((r) => r.name !== c.name), {
      name: c.name,
      port: c.port,
      ready: true,
      detail: health.detail,
      ownership: bound.ok ? 'control-pipe' : 'health-contract-only',
    }];
    appendEvent(doc, 'child.ready', { name: c.name }); save(doc);
  }

  // ── STOP (graceful only) ────────────────────────────────────────────────
  async function stop({ stopAgents = false } = {}) {
    return withLock('stop', async () => {
      let cfg;
      try { cfg = cfgOf(); } catch (err) { return refuse(err.message, { code: 'CONFIG_INVALID' }); }
      if (cfg.profile?.name === OBSERVATION_PROFILE && stopAgents) return refuse('worker admission is absent from the observation profile; --stop-agents is not applicable', { code: 'OBSERVATION_NO_AGENTS' });
      const st = readState(statePath);
      if (st.kind === 'ABSENT' || st.kind === 'LEGACY_STOPPED') return { result: RESULT.STOPPED, note: `no owned runtime (${st.kind})` };
      if (st.kind !== 'OK') return refuse(`state file ${st.kind}: ${st.reason}; nothing signalled`, { code: 'STATE_' + st.kind });
      const doc = st.state;
      if (doc.pending_launches?.length) return { result: RESULT.STOP_INCOMPLETE, phase: 'pending-launch', note: 'pre-execution reservations unresolved; nothing signalled' };
      const live = doc.children.filter((c) => c.status !== 'EXITED');
      if (doc.children.some((c) => c.status === 'EXITED' && c.tree_closeout_verified !== true)) return { result: RESULT.STOP_INCOMPLETE, phase: 'historical-closeout', note: 'historical EXITED roots lack descendant closeout proof' };
      if (!live.length) {
        if (doc.children.some((c) => c.tree_closeout_verified !== true)) return { result: RESULT.STOP_INCOMPLETE, phase: 'historical-closeout', note: 'historical EXITED roots lack descendant closeout proof' };
        if (doc.state !== 'STOPPED') { doc.state = 'STOPPED'; doc.stopped_at = new Date().toISOString(); appendEvent(doc, 'stop.settled'); save(doc); }
        return { result: RESULT.STOPPED, note: 'nothing running' };
      }
      const verdicts = await classify(cfg, live);
      const unknown = live.filter((c) => verdicts.get(c.name).verdict === 'UNKNOWN' || verdicts.get(c.name).verdict === 'UNPROVEN');
      if (unknown.length) {
        return refuse(`ownership cannot be proven; nothing signalled: ${unknown.map((c) => `${c.name}(${verdicts.get(c.name).detail})`).join('; ')}`, { code: 'OWNERSHIP_UNPROVEN' });
      }
      const previousState = doc.state;
      let historicalCloseoutHandoff = null;
      const brokerChild = live.find((c) => c.name === 'herdrBroker' && verdicts.get(c.name).verdict === 'OWNED');
      if (brokerChild) {
        const view = await broker(cfg, 'GET', '/api/lifecycle');
        if (view.status !== 200) return refuse(`broker lifecycle channel unavailable (${view.status} ${view.error ?? view.body?.code ?? ''}); agents cannot be drained; nothing signalled`, { code: 'BROKER_UNAVAILABLE' });
        if (view.body.running.length && !stopAgents) {
          return refuse(`live agents: ${view.body.running.map((r) => `${r.agent_id}(pid ${r.pid})`).join(', ')}. Ensure closeout is posted, then stop with --stop-agents`, { code: 'LIVE_AGENTS', agents: view.body.running });
        }
        doc.state = 'STOPPING'; appendEvent(doc, 'stop.begin', { stop_agents: stopAgents }); save(doc);
        const drain = await broker(cfg, 'POST', '/api/lifecycle/drain');
        if (drain.status !== 200 || drain.body?.admission !== 'DRAINING') {
          doc.state = 'STOP_INCOMPLETE'; appendEvent(doc, 'stop.drain_failed', { status: drain.status }); save(doc);
          return { result: RESULT.STOP_INCOMPLETE, phase: 'drain', detail: drain.error ?? drain.body };
        }
        if (drain.body.running.length) {
          const r = await broker(cfg, 'POST', '/api/lifecycle/stop-agents', cfg.timeouts_ms.agent_stop);
          if (r.status !== 200 || !r.body?.complete) {
            doc.state = 'STOP_INCOMPLETE'; appendEvent(doc, 'stop.agents_incomplete', { body: r.body }); save(doc);
            journal('stop.agents_incomplete', { body: r.body });
            return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', detail: r.body ?? r.error, note: 'broker left DRAINING and up so it keeps ownership; use recover --force only as explicit recovery' };
          }
        }
        const after = await broker(cfg, 'GET', '/api/lifecycle');
        if (after.status !== 200) {
          doc.state = 'STOP_INCOMPLETE'; save(doc);
          return { result: RESULT.STOP_INCOMPLETE, phase: 'drain-verify', detail: after.body ?? after.error };
        }
        if (!after.body?.drained) {
          const floor = await broker(cfg, 'GET', '/api/agents');
          const stateDir = path.dirname(cfg.abs(comp(cfg, 'herdrBroker').lifecycle_token));
          historicalCloseoutHandoff = floor.status === 200
            ? await d.historicalCloseoutHandoff({ stateDir, lifecycleView: after.body, registryProjection: floor.body?.registry_records })
            : { applied: false, reason: 'broker registry projection unavailable' };
          if (historicalCloseoutHandoff?.applied !== true) {
            doc.state = 'STOP_INCOMPLETE'; appendEvent(doc, 'stop.drain_incomplete', { detail: after.body, historical_closeout_exception: historicalCloseoutHandoff?.reason ?? 'not authorized' }); save(doc);
            return { result: RESULT.STOP_INCOMPLETE, phase: 'drain-verify', detail: after.body, historical_closeout_exception: historicalCloseoutHandoff?.reason ?? 'not authorized' };
          }
          appendEvent(doc, 'stop.historical_closeout_exception_verified', {
            decision: historicalCloseoutHandoff.decision,
            session_ids: historicalCloseoutHandoff.session_ids,
            historical_closeout: 'UNKNOWN',
            broker_boot_id: historicalCloseoutHandoff.broker_boot_id,
          });
          save(doc);
        } else {
          appendEvent(doc, 'stop.drained'); save(doc);
        }
      } else {
        doc.state = 'STOPPING'; appendEvent(doc, 'stop.begin', { stop_agents: stopAgents, broker: 'not live' }); save(doc);
      }

      const reverseTopological = topoOrder(cfg.components).map((c) => c.name).reverse();
      const order = historicalCloseoutHandoff?.applied === true
        ? [
          ...reverseTopological.filter((name) => transitivelyDependsOn(cfg.components, name, 'herdrBroker')),
          'herdrBroker',
          ...reverseTopological.filter((name) => name !== 'herdrBroker' && !transitivelyDependsOn(cfg.components, name, 'herdrBroker')),
        ]
        : reverseTopological;
      const steps = [];
      for (const name of order) {
        const child = doc.children.find((c) => c.name === name && c.status !== 'EXITED');
        if (!child) continue;
        const r = await stopChild(cfg, doc, child, { historicalCloseoutHandoff });
        steps.push({ name, ...r });
        if (r.outcome !== 'GONE') {
          doc.state = 'STOP_INCOMPLETE'; appendEvent(doc, 'stop.incomplete', { name, ...r }); save(doc);
          journal('stop.incomplete', { name, ...r });
          return { result: RESULT.STOP_INCOMPLETE, phase: 'control-plane', steps, previous_state: previousState };
        }
      }
      doc.state = 'STOPPED'; doc.stopped_at = new Date().toISOString(); appendEvent(doc, 'stop.done'); save(doc);
      journal('stop.done', { steps });
      return { result: RESULT.STOPPED, steps, verification: await verifyStopped(cfg, doc) };
    });
  }

  async function verifyStopped(cfg) {
    try {
      const ports = new Set(cfg.components.map((c) => c.port));
      const left = (await d.listListeners()).filter((l) => ports.has(l.port));
      return { complete: true, ports_free: left.length === 0, foreign_listeners: left };
    } catch (err) {
      return { complete: false, error: err.message };
    }
  }

  // ── RECOVER --force (explicit, separate) ────────────────────────────────
  async function recoverForce() {
    return withLock('recover-force', async () => {
      let cfg;
      try { cfg = cfgOf(); } catch (err) { return refuse(err.message, { code: 'CONFIG_INVALID' }); }
      if (cfg.profile?.name === OBSERVATION_PROFILE) return refuse('forced recovery is disabled for the observation-only profile', { code: 'OBSERVATION_NO_FORCE_RECOVERY' });
      const localProfile = cfg.profile?.name === COMMAND_LOCAL_PROFILE;
      const st = readState(statePath);
      if (st.kind !== 'OK') return refuse(`state file ${st.kind}${st.reason ? `: ${st.reason}` : ''}; recovery needs a provable record`, { code: 'STATE_' + st.kind });
      const doc = st.state;
      if (doc.pending_launches?.length) return { result: RESULT.STOP_INCOMPLETE, phase: 'pending-launch', note: 'pre-execution reservations unresolved; nothing signalled' };
      appendEvent(doc, 'recover.force.begin'); save(doc);
      if (doc.children.some((c) => c.status === 'EXITED' && c.tree_closeout_verified !== true)) return { result: RESULT.STOP_INCOMPLETE, phase: 'historical-closeout', note: 'historical EXITED roots lack descendant closeout proof; no forced signals' };
      const steps = [];
      let recordedHistoricalCloseout = null;
      const brokerChild = doc.children.find((c) => c.name === 'herdrBroker' && c.status !== 'EXITED');
      if (brokerChild) {
        const v = (await classify(cfg, [brokerChild], { prove: false })).get('herdrBroker');
        const jobOwned = Boolean(brokerChild.containment) && v.verdict !== 'FOREIGN';
        if (v.verdict === 'MATCH' || jobOwned) {
          const view = await broker(cfg, 'GET', '/api/lifecycle');
          if (view.status !== 200 && v.verdict === 'GONE') {
            const listeners = await d.listListeners();
            const brokerPort = comp(cfg, 'herdrBroker').port;
            if (listeners.some((listener) => listener.port === brokerPort)) {
              return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: 'broker API is unavailable but its port has a listener; historical recovery cannot bypass the current broker owner' };
            }
            const stateDir = path.dirname(cfg.abs(comp(cfg, 'herdrBroker').lifecycle_token));
            const recorded = d.recordedHistoricalCloseoutRecovery({ stateDir, events: doc.events });
            if (recorded?.applied !== true) {
              return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: recorded?.reason ?? 'broker channel unavailable and no exact historical recovery evidence' };
            }
            recordedHistoricalCloseout = recorded;
          } else if (view.status === 200 && view.body.running.length) {
            await broker(cfg, 'POST', '/api/lifecycle/drain');
            const r = await broker(cfg, 'POST', '/api/lifecycle/force-stop-agents', cfg.timeouts_ms.agent_stop);
            steps.push({ name: 'agents', result: r.body ?? r.error });
            if (r.status !== 200 || !r.body?.complete) {
              save(doc);
              return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: 'the broker could not prove/terminate every agent; it is left up so ownership is not orphaned' };
            }
          } else if (view.status !== 200 && v.verdict !== 'GONE') {
            return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: 'broker channel unavailable; refusing all force recovery without agent closeout proof' };
          }
          const drain = view.status === 200 ? await broker(cfg, 'POST', '/api/lifecycle/drain') : null;
          if (drain) {
            if (drain.status !== 200 || drain.body?.admission !== 'DRAINING') {
              return { result: RESULT.STOP_INCOMPLETE, phase: 'drain', steps, note: 'pending, orphaned, terminal or agent ownership remains unresolved' };
            }
            if (!drain.body?.drained) {
              const floor = await broker(cfg, 'GET', '/api/agents');
              const stateDir = path.dirname(cfg.abs(comp(cfg, 'herdrBroker').lifecycle_token));
              const handoff = floor.status === 200
                ? await d.historicalCloseoutHandoff({ stateDir, lifecycleView: drain.body, registryProjection: floor.body?.registry_records })
                : { applied: false, reason: 'broker registry projection unavailable' };
              if (handoff?.applied !== true) {
                return { result: RESULT.STOP_INCOMPLETE, phase: 'drain', steps, note: handoff?.reason ?? 'pending, orphaned, terminal or agent ownership remains unresolved' };
              }
              appendEvent(doc, 'recover.historical_closeout_exception_verified', {
                decision: handoff.decision,
                session_ids: handoff.session_ids,
                historical_closeout: 'UNKNOWN',
                broker_boot_id: handoff.broker_boot_id,
              });
              save(doc);
            }
          }
        } else {
          return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: 'broker ownership unavailable; no agent closeout proof' };
        }
      } else if (!localProfile && !await d.treeClosed({ name: 'herdrBroker', missing_record: true })) {
        // The local profile has no broker/agents, so there is no agent closeout
        // to prove; required services are recovered directly below.
        return { result: RESULT.STOP_INCOMPLETE, phase: 'agents', steps, note: 'missing broker record is not agent closeout proof' };
      }
      for (const name of topoOrder(cfg.components).map((c) => c.name).reverse()) {
        const child = doc.children.find((c) => c.name === name && c.status !== 'EXITED');
        if (!child) continue;
        // Re-prove executable + creation time IMMEDIATELY before the forced signal.
        if (child.containment && !deps.forceKill) {
          const proof = await d.recoverOwnedJob(child.containment, cfg.timeouts_ms.graceful_exit);
          if (proof.outcome !== 'GONE' || proof.active !== 0 || !proof.closed) return { result: RESULT.STOP_INCOMPLETE, phase: 'job-recovery', steps, proof };
          Object.assign(child, { status: 'EXITED', tree_closeout_verified: true, exited_at: new Date().toISOString(), exit_note: 'explicit owned-job recovery' });
          if (name === 'herdrBroker' && recordedHistoricalCloseout) {
            appendEvent(doc, 'recover.historical_closeout_exception_resumed', {
              decision: recordedHistoricalCloseout.decision,
              session_ids: recordedHistoricalCloseout.session_ids,
              historical_closeout: 'UNKNOWN',
              broker_boot_id: recordedHistoricalCloseout.broker_boot_id,
              broker_process: 'GONE',
              broker_port_clear: true,
              broker_job_closeout: 'VERIFIED',
            });
          }
          steps.push({ name, outcome: 'GONE', proof }); save(doc); continue;
        }
        const v = (await classify(cfg, [child], { prove: false })).get(name);
        if (v.verdict === 'GONE' || v.verdict === 'FOREIGN') {
          if (!await d.treeClosed(child)) return { result: RESULT.STOP_INCOMPLETE, phase: 'descendants', steps };
          Object.assign(child, { status: 'EXITED', tree_closeout_verified: true, exited_at: new Date().toISOString(), exit_note: `recover: ${v.detail}` });
          steps.push({ name, outcome: 'GONE', signalled: false, detail: v.detail }); save(doc); continue;
        }
        if (v.verdict !== 'MATCH') {
          doc.state = 'STOP_INCOMPLETE'; appendEvent(doc, 'recover.unproven', { name, detail: v.detail }); save(doc);
          steps.push({ name, outcome: v.verdict, signalled: false, detail: v.detail });
          return { result: RESULT.STOP_INCOMPLETE, phase: 'control-plane', steps };
        }
        if (!await d.treeSignalSafe(child)) return { result: RESULT.STOP_INCOMPLETE, phase: 'descendant-ownership', steps, note: 'tree termination refused: descendant ownership unproven' };
        const fresh = (await classify(cfg, [child], { prove: false })).get(name);
        if (fresh.verdict !== 'MATCH') return { result: RESULT.STOP_INCOMPLETE, phase: 'identity-recheck', steps, note: 'identity changed during tree verification; nothing signalled' };
        appendEvent(doc, 'recover.force_kill', { name, pid: child.pid }); save(doc);
        const k = await d.forceKill(child.pid);
        const outcome = await waitGone(cfg, child);
        steps.push({ name, outcome, signalled: true, detail: k.detail });
        if (outcome !== 'GONE') {
          doc.state = 'STOP_INCOMPLETE'; save(doc);
          return { result: RESULT.STOP_INCOMPLETE, phase: 'control-plane', steps };
        }
        Object.assign(child, { status: 'EXITED', tree_closeout_verified: true, exited_at: new Date().toISOString(), exit_note: 'forced (recover)' }); save(doc);
      }
      doc.state = 'STOPPED'; doc.stopped_at = new Date().toISOString(); appendEvent(doc, 'recover.force.done'); save(doc);
      journal('recover.force.done', { steps });
      return { result: RESULT.STOPPED, steps, verification: await verifyStopped(cfg, doc) };
    });
  }

  // ── STATUS (read-only: no lock, no writes) ──────────────────────────────
  async function status() {
    const report = { scope: 'COMMAND_CONTROL_PLANE_ONLY', safe_to_shutdown_starq: false, generated_at: new Date().toISOString(), inspection: { complete: true, errors: [] }, problems: [] };
    const fail = (msg) => { report.inspection.complete = false; report.inspection.errors.push(msg); };
    let cfg = null;
    try { cfg = cfgOf(); report.config = { valid: true, sha256: cfg.sha256, file: configFile }; } catch (err) {
      report.config = { valid: false, error: err.message }; report.overall = 'UNKNOWN'; report.problems.push('config invalid'); return report;
    }
    const observationOnly = cfg.profile?.name === OBSERVATION_PROFILE;
    const localProfile = cfg.profile?.name === COMMAND_LOCAL_PROFILE;
    // The observation and command-local profiles never probe standalone Herdr.
    // Full-floor status keeps the pre-existing read-only standalone probe.
    let shGate = { resolved: false, detail: 'not evaluated' };
    let shObserved = { state: 'NOT_PROBED', detail: 'not evaluated' };
    let shEntry = null;
    const infraPins = {
      herdrExecutable: null,
      scriptsRoot: cfg.workspace_root ? path.join(cfg.workspace_root, 'agent-comms', 'scripts') : null,
    };
    if (!observationOnly && !localProfile) {
      shEntry = standaloneHerdr(cfg);
      infraPins.herdrExecutable = shEntry?.executable ?? null;
      try { shGate = await d.standaloneHerdrGate(cfg); } catch (err) { shGate = { resolved: false, detail: `G-PROFILE: ${err.message}` }; }
      shObserved = { state: 'NOT_PROBED', detail: 'owner protocol not commissioned; the standalone binary was not executed' };
      if (shGate.resolved && shEntry) {
        try { shObserved = await d.probeStandaloneHerdr(shEntry); } catch (err) { shObserved = { state: 'ERROR', detail: err.message }; }
      }
      report.normal_profile = {
        name: cfg.profile?.name, ready: false, external_required: cfg.profile?.external_required ?? [],
        standalone_herdr: { owner_gate: shGate, observed: { state: shObserved.state, detail: shObserved.detail } },
        detail: 'ready requires control plane RUNNING, a commissioned standalone Herdr owner protocol and standalone Herdr observed AVAILABLE; control-plane status alone is not full-profile readiness',
      };
      const herdrClass = classifyInfrastructureProcess(
        { exe: shEntry?.executable, cmd: shEntry?.executable },
        infraPins,
      );
      report.infrastructure_policy = {
        command_ports_remain_blocking: true,
        standalone_herdr: herdrClass,
        declared_external: ['standalone-herdr', 'starqbot-gateway', 'room-watcher'],
        note: 'Declared Starq infrastructure is not a Command child and is not an unowned Command blocker unless it holds a Command control-plane port.',
      };
    } else if (observationOnly) {
      report.observation_profile = {
        name: cfg.profile.name, ready: false, services: cfg.components.map((c) => c.name),
        worker_admission: false, herdr_probe: 'NOT_PERFORMED',
      };
    } else {
      // command-local/v1: no standalone-Herdr, no WSL, no infrastructure policy.
      report.local_profile = {
        name: cfg.profile.name, ready: false,
        required: cfg.profile?.required_components ?? [],
        optional: cfg.profile?.optional_components ?? [],
        detail: 'ready requires the control plane RUNNING on the required services (data, pm, ui); optional services never gate readiness and standalone Herdr is not consulted',
      };
    }
    report.env_overrides = findEnvOverrides(env, cfg);
    if (report.env_overrides.length) report.problems.push(`runtime overrides present (start would refuse): ${report.env_overrides.join(', ')}`);
    report.environment_hazards = observationOnly ? findObservationEnvHazards(env) : [];
    if (report.environment_hazards.length) report.problems.push(`observer environment is contaminated (start would refuse): ${report.environment_hazards.join(', ')}`);
    report.lock = readLock(lockPath);
    const st = readState(statePath);
    report.state = { kind: st.kind, reason: st.reason ?? null, declared: st.state?.state ?? null };
    const doc = st.kind === 'OK' ? st.state : null;
    if (doc && doc.config_sha256 !== cfg.sha256) report.problems.push('config changed since this runtime was started');
    if (st.kind === 'CORRUPT' || st.kind === 'UNREADABLE') fail(`state ${st.kind}: ${st.reason}`);

    let listeners = null;
    try { listeners = await d.listListeners(); } catch (err) { fail(`listeners: ${err.message}`); }
    const listenerPids = [...new Set((listeners ?? []).map((l) => l.pid).filter((pid) => Number.isInteger(pid) && pid > 0))];
    let listenerInfos = new Map();
    if (listenerPids.length) {
      try { listenerInfos = await d.inspect(listenerPids); }
      catch (err) { fail(`listener processes: ${err.message}`); }
    }
    if (!observationOnly && !localProfile) {
      try {
        const rows = await d.inspectInfrastructure(infraPins);
        report.live_infrastructure = (rows ?? []).map((info) => ({
          pid: info.pid, name: info.name ?? null, exe: info.exe ?? null,
          ...classifyInfrastructureProcess(info, infraPins),
        })).filter((row) => row.kind === 'DECLARED_EXTERNAL_INFRASTRUCTURE');
      } catch (err) {
        fail(`infrastructure: ${err.message}`);
        report.live_infrastructure = [];
      }
    }
    const children = doc ? doc.children : [];
    const verdicts = await classify(cfg, children);
    for (const [name, v] of verdicts) if (v.verdict === 'UNKNOWN') fail(`${name}: ${v.detail}`);

    report.components = [];
    const componentNames = (observationOnly || localProfile) ? cfg.components.map((c) => c.name) : REQUIRED_COMPONENTS;
    for (const name of componentNames) {
      const c = comp(cfg, name);
      const rec = children.find((x) => x.name === name);
      const entry = { name, port: c.port, recorded: Boolean(rec), pid: rec?.pid ?? null, declared_status: rec?.status ?? null };
      entry.ownership = !rec ? 'NOT_RECORDED' : rec.status === 'EXITED' ? (rec.tree_closeout_verified === true ? 'EXITED' : 'EXITED_UNVERIFIED') : verdicts.get(name)?.verdict ?? 'UNKNOWN';
      entry.ownership_detail = rec && rec.status !== 'EXITED' ? verdicts.get(name)?.detail ?? null : null;
      let bound = null;
      if (entry.ownership === 'OWNED') {
        entry.health = await d.checkHealth(cfg.host, c);
        // Authenticated proof of where this instance listens. The OS TCP table on
        // some Windows machines reports live listeners under pid 0 (or not at all),
        // so it cannot be what decides ownership; it only vetoes (see below).
        bound = await d.proveBoundAddress(rec);
        entry.bound = { ok: bound.ok, supported: bound.supported, addresses: bound.addresses, detail: bound.detail };
      }
      if (listeners) {
        const rows = listeners.filter((l) => l.port === c.port);
        const confirmed = Boolean(bound?.ok && boundOnPort(bound.addresses, c.port));
        const foreign = rows.some((l) => l.pid !== rec?.pid && l.pid !== 0);
        const tableAgrees = rows.length > 0 && rows.every((l) => l.pid === rec?.pid);
        entry.listener = {
          present: rows.length > 0 || confirmed,
          owned: entry.ownership === 'OWNED' && !foreign && (confirmed || (bound?.supported === false && tableAgrees)),
          pids: rows.map((l) => l.pid),
          classifications: rows.map((l) => {
            const info = listenerInfos.get(l.pid);
            return {
              pid: l.pid,
              ...classifyInfrastructureProcess(
                { name: info?.name, exe: info?.exe, cmd: info?.cmd },
                infraPins,
              ),
            };
          }),
        };
      }
      report.components.push(entry);
    }
    if (doc) {
      // In the local profile only the required services must be present for a
      // valid READY; optional services that were skipped are not "missing".
      const mustHave = localProfile ? componentNames.filter((n) => COMMAND_LOCAL_REQUIRED.includes(n)) : componentNames;
      const missing = mustHave.filter((n) => !children.some((x) => x.name === n));
      if (doc.state === 'READY' && missing.length) report.problems.push(`READY state is missing components: ${missing.join(', ')}`);
    }
    const brokerEntry = report.components.find((x) => x.name === 'herdrBroker');
    if (!brokerEntry) {
      report.broker = { present: false, reason: 'broker is not part of the observation-only profile' };
    } else if (brokerEntry.ownership === 'OWNED') {
      const view = await broker(cfg, 'GET', '/api/lifecycle');
      report.broker = view.status === 200
        ? { reachable: true, admission: view.body.admission, running: view.body.running, open_terminals: view.body.open_terminals, drained: view.body.drained }
        : { reachable: false, error: view.error ?? view.body?.code ?? view.status };
      if (!report.broker.reachable) report.problems.push('broker owned but lifecycle channel unreachable');
    } else {
      report.broker = { reachable: false, reason: 'broker not running under verified ownership' };
    }

    const all = report.components;
    // Local readiness is judged on the required services only; optional services never gate RUNNING.
    const readinessSet = localProfile ? all.filter((x) => COMMAND_LOCAL_REQUIRED.includes(x.name)) : all;
    const componentsReady = readinessSet.length > 0 && readinessSet.every((x) => x.ownership === 'OWNED' && x.health?.ok && x.listener?.owned);
    const running = doc?.state === 'READY' && componentsReady && (observationOnly || localProfile || (report.broker.reachable && report.broker.admission === 'OPEN'));
    const nothingAlive = all.every((x) => ['NOT_RECORDED', 'EXITED', 'GONE', 'FOREIGN'].includes(x.ownership));
    const anyListener = all.some((x) => x.listener?.present);
    const stoppedDeclared = !doc || ['STOPPED', 'START_FAILED'].includes(doc.state);
    if (!report.inspection.complete) report.overall = 'UNKNOWN';
    else if (running) report.overall = 'RUNNING';
    else if (stoppedDeclared && nothingAlive && !anyListener) report.overall = 'STOPPED';
    else if (stoppedDeclared && nothingAlive && anyListener) { report.overall = 'CONFLICT'; report.problems.push('foreign listener on a control-plane port while stopped'); }
    else report.overall = 'DEGRADED';
    if (observationOnly) report.observation_profile.ready = report.overall === 'RUNNING';
    else if (localProfile) report.local_profile.ready = report.overall === 'RUNNING';
    else report.normal_profile.ready = report.overall === 'RUNNING' && shGate.resolved === true && shObserved.state === 'AVAILABLE';
    for (const x of all) {
      if (x.ownership === 'OWNED' && x.health && !x.health.ok) report.problems.push(`${x.name} unhealthy: ${x.health.detail}`);
      if (x.listener?.present && !x.listener.owned) report.problems.push(`${x.name} port ${x.port} held by non-owned pid(s) ${x.listener.pids.join(',')}`);
      if (x.ownership === 'UNPROVEN') report.problems.push(`${x.name} alive but instance unproven: ${x.ownership_detail}`);
    }
    report.repositories = buildRepositoryPreflight(cfg);
    report.health_preflight = buildHealthPreflight(report);
    report.health_preflight.repositories = report.repositories;
    return report;
  }

  return { start, stop, recoverForce, status, paths: { statePath, lockPath, logsDir, journalPath } };
}
