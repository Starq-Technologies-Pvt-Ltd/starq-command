/**
 * Containment gates and options for Command's standalone profile, built only
 * from files that ship with Command (runtime/containment/) and the Node runtime
 * Command provisions for itself (runtime/node/). No Herdr Floor, no separate
 * lifecycle package, no workspace _scratch layout.
 *
 * Development tier (what the daily driver runs at):
 *   1. guardian build record is well formed and its binary/source hashes match
 *   2. the Node runtime we will run under is the file we think it is: its
 *      SHA-256 must be on the committed allowlist (runtime/containment/node-pins.json)
 *   3. a REAL runtime probe: a throwaway child is launched through the guardian,
 *      must produce an authenticated pre-execution receipt (assigned before
 *      resume, with a root pid), must be reported owned and active by the kernel
 *      job, and must be force-recovered to a verified-empty job
 *
 * Release tier is unchanged in strictness: it needs an independent exact-build
 * proof (verifier different from builder, every matrix case PASS). None is
 * recorded for this package, so it stays unresolved, i.e. fail closed.
 */
import { readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWindowsJobContainment } from './windows-job.mjs';

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The Command checkout/install this code belongs to (scripts/lifecycle/containment -> root). */
export const APP_ROOT = path.resolve(HERE, '..', '..', '..');

export const REQUIRED_CASES = Object.freeze(['pre_resume_assignment', 'parent_exit_live_descendants', 'broker_crash_recovery', 'terminal_close', 'nested_job', 'breakaway_refused', 'assignment_denied_no_resume', 'query_denied_unknown', 'graceful_no_force', 'explicit_force_empty_family', 'console_interrupt_guardian_survives', 'terminal_release_handle_only', 'detached_bootstrap_console_close']);

/**
 * How long the probe waits for the guardian's authenticated started receipt.
 * Measured, not guessed: the first launch of a freshly provisioned node.exe was
 * scanned by the OS before it ran, and the receipt arrived 4.5 s after the
 * guardian started (guardian_created_ms vs root_created_ms in the retained
 * receipt) - past the old 2.5 s window, so a perfectly contained child was
 * reported as "no root_pid". Waiting longer relaxes nothing: the receipt must
 * still arrive, authenticate and say it was assigned before resume.
 */
export const RECEIPT_WAIT_MS = 30000;

export const containmentRoot = (appRoot = APP_ROOT) => path.join(appRoot, 'runtime', 'containment');

function readBuild(appRoot, read) {
  const root = containmentRoot(appRoot);
  const build = JSON.parse(read(path.join(root, 'guardian-build.json')));
  if (build.schema !== 'starq.guardian.build/v1') throw new Error('guardian-build schema invalid');
  if (!/^[a-f0-9]{64}$/i.test(build.binary_sha256 ?? '') || !/^[a-f0-9]{64}$/i.test(build.source_sha256 ?? '')) throw new Error('guardian build hashes invalid');
  const exe = path.join(root, 'JobGuardian.exe');
  if (sha256(read(exe)).toLowerCase() !== build.binary_sha256.toLowerCase()) throw new Error('JobGuardian.exe binary pin drift');
  if (sha256(read(path.join(root, 'JobGuardian.cs'))).toLowerCase() !== build.source_sha256.toLowerCase()) throw new Error('JobGuardian.cs source pin drift');
  return { build, exe };
}

/** The runtime must be an allowlisted Node build, byte for byte. */
export function verifyNodeRuntime(nodePath, appRoot = APP_ROOT, read = readFileSync) {
  if (typeof nodePath !== 'string' || !path.isAbsolute(nodePath)) throw new Error('node runtime path must be absolute');
  const pins = JSON.parse(read(path.join(containmentRoot(appRoot), 'node-pins.json')));
  if (pins.schema !== 'starq.command.node-pins/v1' || !Array.isArray(pins.runtimes) || !pins.runtimes.length) throw new Error('node-pins.json invalid');
  const actual = sha256(read(nodePath)).toLowerCase();
  const hit = pins.runtimes.find((r) => String(r.sha256).toLowerCase() === actual);
  if (!hit) throw new Error(`node runtime is not an approved build (sha256 ${actual.slice(0, 16)}...): ${nodePath}`);
  return hit;
}

/**
 * Bounded runtime proof. Fails closed: scratch evidence is deleted only when the
 * guardian itself reports the job owned, closed and empty.
 */
export function probeRuntimeContainment({
  scratchRoot, guardian, guardianSha256, nodePath,
  execSync = execFileSync, spawnProcess = spawn,
} = {}) {
  mkdirSync(scratchRoot, { recursive: true });
  const tmp = mkdtempSync(path.join(scratchRoot, 'dev-containment-probe-'));
  let configPath = null;
  let outcome = null;
  const execute = (file, args, opts) => JSON.parse(execSync(file, args, { ...opts, windowsHide: true, shell: false, encoding: 'utf8', timeout: 10000 }));
  try {
    const containment = createWindowsJobContainment({
      guardian, guardianSha256, stateDir: tmp, spawn: spawnProcess,
      execute: (file, args, opts) => Promise.resolve(execute(file, args, opts)),
      sleep: () => Promise.resolve(),
    });
    const child = containment.launch({ argv: [nodePath, '-e', 'setTimeout(function(){}, 15000)'], cwd: tmp });
    configPath = child.containment?.config;

    let started = null;
    for (const stop = Date.now() + RECEIPT_WAIT_MS; Date.now() < stop;) {
      try { started = containment.receipt(child.containment); if (started?.root_pid > 0) break; } catch { /* not written yet */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    if (!started || !(started.root_pid > 0)) return (outcome = { ok: false, error: 'reliable process identification failed: authenticated started receipt has no root_pid' });
    if (started.assigned_before_resume !== true) return (outcome = { ok: false, error: 'pre-execution kernel job containment failed: assigned_before_resume is not true' });

    let st;
    try { st = execute(guardian, ['query', configPath], {}); } catch (err) { return (outcome = { ok: false, error: `kernel job status query failed: ${err.message}` }); }
    if (st.owned !== true || st.active < 1) return (outcome = { ok: false, error: `child containment unsupported by active runtime: owned=${st.owned}, active=${st.active}` });

    let forced;
    try { forced = execute(guardian, ['force', configPath], {}); } catch (err) { return (outcome = { ok: false, error: `interrupted-start force recovery failed: ${err.message}` }); }
    if (forced.owned !== true) return (outcome = { ok: false, error: `interrupted-start recovery incomplete: owned=${forced.owned}` });

    let last = null;
    for (let i = 0; i < 50; i += 1) {
      try { last = execute(guardian, ['query', configPath], {}); if (last.owned === true && last.closed === true && last.active === 0) break; } catch { /* retry */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    if (!last || last.closed !== true || last.active !== 0) return (outcome = { ok: false, error: `interrupted-start recovery unclosed after force: closed=${last?.closed}, active=${last?.active}` });
    return (outcome = { ok: true, rootPid: started.root_pid, assignedBeforeResume: true, activeCount: st.active, recoveryOutcome: 'GONE' });
  } catch (err) {
    return (outcome = { ok: false, error: err.message });
  } finally {
    let cleanup = 'UNVERIFIED_RETAINED';
    let allowed = false;
    if (configPath) {
      try { const q = execute(guardian, ['query', configPath], {}); allowed = q.owned === true && q.closed === true && q.active === 0; } catch { allowed = false; }
    }
    if (allowed) {
      for (let i = 0; i < 10; i += 1) {
        try { rmSync(tmp, { recursive: true, force: true }); cleanup = 'VERIFIED_AND_REMOVED'; break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
      }
    }
    if (outcome && typeof outcome === 'object') {
      outcome.cleanup = cleanup;
      if (cleanup === 'UNVERIFIED_RETAINED') outcome.retainedDirectory = tmp;
    }
  }
}

export function localDevelopmentGate(appRoot = APP_ROOT, {
  nodePath, verifyRuntime = true, read = readFileSync, probe = probeRuntimeContainment,
  scratchRoot = path.join(appRoot, '.command-runtime-local', 'containment-probe'),
} = {}) {
  let runtime = null;
  try {
    const { build, exe } = readBuild(appRoot, read);
    const node = verifyNodeRuntime(nodePath, appRoot, read);
    if (verifyRuntime !== false) {
      runtime = probe({ scratchRoot, guardian: exe, guardianSha256: build.binary_sha256, nodePath });
      if (!runtime.ok) {
        throw new Error(`runtime containment evidence failed: ${runtime.error}${runtime.cleanup ? `; cleanup=${runtime.cleanup}` : ''}${runtime.retainedDirectory ? `; retainedDirectory=${runtime.retainedDirectory}` : ''}`);
      }
    }
    return {
      resolved: true,
      tier: 'development',
      detail: `development runtime containment verified from Command's own package (JobGuardian build pins, approved Node ${node.version}, authenticated process identification, kernel child containment & recovery verified; native matrix acceptance deferred to release/unattended tier)`,
      guardian_sha256: build.binary_sha256,
      node_version: node.version,
      runtime_containment: runtime ? { root_pid: runtime.rootPid, assigned_before_resume: runtime.assignedBeforeResume, kernel_job_active: runtime.activeCount, interrupted_recovery_outcome: runtime.recoveryOutcome, cleanup: runtime.cleanup } : 'skipped_by_option',
    };
  } catch (e) {
    return { resolved: false, tier: 'development', detail: `G-CONTAINMENT-DEV: ${e.message}` };
  }
}

export function localReleaseGate(appRoot = APP_ROOT, { read = readFileSync, osRelease = release() } = {}) {
  try {
    const { build } = readBuild(appRoot, read);
    const proofFile = path.join(containmentRoot(appRoot), 'windows-job-compatibility.json');
    if (!existsSync(proofFile)) throw new Error('exact-build independent compatibility proof required (none recorded for this package)');
    const proof = JSON.parse(read(proofFile));
    if (proof.schema !== 'starq.windows.job.compatibility/v1' || proof.outcome !== 'PASS' || proof.os_release !== osRelease || proof.guardian_sha256 !== build.binary_sha256 || !proof.verifier || proof.verifier === proof.builder || !proof.verified_at || !Number.isFinite(Date.parse(proof.verified_at))) throw new Error('exact-build independent compatibility proof required');
    if (REQUIRED_CASES.some((name) => proof.cases?.[name] !== 'PASS')) throw new Error('native compatibility matrix incomplete');
    return { resolved: true, detail: 'recorded independent exact-build Windows containment compatibility verified' };
  } catch (e) { return { resolved: false, detail: `G-CONTAINMENT: ${e.message}; compiled source and mocks are not native compatibility acceptance` }; }
}

/** Same shape the lifecycle owner already consumes from the Herdr companion. */
export function localContainmentOptions(appRoot, stateDir, { tier = 'development', verifyRuntime = true, nodePath, read = readFileSync } = {}) {
  const gate = tier === 'development'
    ? localDevelopmentGate(appRoot, { nodePath, verifyRuntime, read })
    : localReleaseGate(appRoot, { read });
  if (!gate.resolved) throw new Error(gate.detail);
  const { build, exe } = readBuild(appRoot, read);
  return { guardian: exe, guardianSha256: build.binary_sha256, stateDir: path.join(stateDir, 'containment'), tier };
}

export function localNativeContainment(options, seams = {}) {
  return createWindowsJobContainment({
    ...options,
    spawn: seams.spawn ?? spawn,
    execute: seams.execute ?? ((exe, args, opts) => new Promise((resolve, reject) => {
      execFile(exe, args, opts, (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
    })),
  });
}

/** The authenticated root pid of a contained launch, or 0 if it never appears. */
export async function resolveRootPid(child, { timeoutMs = 8000, pollIntervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const raw = child?.pid;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
    if (child?.killed) break;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return 0;
}
