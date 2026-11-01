/**
 * Command's own Windows Job Object containment adapter (self-contained).
 *
 * The standalone `command-local/v1` profile used to import this logic, and the
 * Node runtime it runs under, from the separate Herdr Floor installation, so a
 * machine without Herdr Floor could not start Command at all. This is the same
 * adapter, narrowed to what Command itself needs, living with the code that uses
 * it. Herdr Floor remains an optional integration and is not consulted.
 *
 * Nothing about containment is relaxed:
 *   - the guardian binary is verified against its pinned SHA-256 on every use
 *   - the launch descriptor is hash-bound and written exclusively under the state
 *     directory (an existing or redirected directory is refused)
 *   - the pre-execution receipt is HMAC-authenticated with a token that exists only
 *     in the private descriptor, never in the workload's environment or argv
 *   - status/stop trust only the kernel's own `owned`/`closed`/`active` report and
 *     reject incomplete or contradictory answers
 *
 * Deliberately NOT carried over: pseudoconsole (terminal) launch, which only Herdr's
 * terminal panes use, and recovery of descriptors issued by retired guardian
 * builds, which a profile that has only ever run the pinned build cannot have.
 */
import { readFileSync, realpathSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function assertInsideState(stateDir, target) {
  const root = path.resolve(stateDir);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to write outside the containment state directory: ${resolved}`);
  }
  return resolved;
}

export function persistContainmentDescriptor(stateDir, instance, config) {
  if (!/^[a-f0-9]{32}$/.test(instance)) throw new Error('invalid containment instance');
  mkdirSync(assertInsideState(stateDir, stateDir), { recursive: true });
  const root = realpathSync(stateDir);
  const directory = assertInsideState(root, path.join(root, instance));
  // Exclusive new directory prevents reuse of a junction or prior descriptor.
  mkdirSync(directory);
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw new Error('containment directory redirected');
  config.directory = directory;
  const bytes = JSON.stringify(config);
  const configPath = assertInsideState(root, path.join(directory, 'launch.json'));
  writeFileSync(configPath, bytes, { flag: 'wx', mode: 0o600 });
  return { configPath, bytes };
}

export function verifyReceipt(config, kind, raw) {
  const signed = JSON.parse(raw);
  const expected = createHmac('sha256', config.token).update(`${kind}|${config.instance}|${signed.payload}`).digest('hex');
  const a = Buffer.from(String(signed.mac)); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('containment receipt authentication failed');
  return JSON.parse(signed.payload);
}

export function createWindowsJobContainment({
  guardian, guardianSha256, stateDir, spawn: createBootstrap, execute,
  clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const verifiedBinary = () => {
    if (!/^[a-f0-9]{64}$/i.test(guardianSha256 ?? '') || hash(readFileSync(guardian)) !== guardianSha256.toLowerCase()) throw new Error('guardian binary pin missing or changed');
  };
  function descriptor(meta) {
    verifiedBinary();
    if (!meta || meta.kind !== 'WINDOWS_JOB_V1' || meta.guardian_sha256 !== guardianSha256 || path.resolve(meta.guardian) !== path.resolve(guardian) || hash(readFileSync(meta.config)) !== meta.config_sha256) throw new Error('containment descriptor missing or changed');
    const cfg = JSON.parse(readFileSync(meta.config, 'utf8'));
    if (cfg.instance !== meta.instance || cfg.schema !== 'starq.windows.job/v1') throw new Error('containment identity mismatch');
    return cfg;
  }
  function receipt(meta) {
    const cfg = descriptor(meta);
    const started = verifyReceipt(cfg, 'started', readFileSync(path.join(cfg.directory, 'started.json'), 'utf8'));
    if (!started.assigned_before_resume || started.job !== `Local\\StarqJob_${cfg.instance}` || path.resolve(started.exe).toLowerCase() !== path.resolve(cfg.exe).toLowerCase() || !Number.isInteger(started.root_pid) || started.root_pid <= 0) throw new Error('invalid pre-execution job receipt');
    return started;
  }
  function launch({ argv, cwd, env, stdio = 'ignore', detached = false }, beforeSpawn = () => {}) {
    verifiedBinary();
    if (!path.isAbsolute(argv[0]) || /(?:^|[\\/])wsl(?:\.exe)?$/i.test(argv[0])) throw new Error('Windows containment cannot own WSL workloads');
    const instance = randomBytes(16).toString('hex');
    const directory = path.join(stateDir, instance);
    const childEnv = { ...process.env, ...env };
    // The job token only exists in its private descriptor, never in workload env/argv.
    for (const k of Object.keys(childEnv)) if (k.startsWith('STARQ_JOB_')) delete childEnv[k];
    // The environment reaches the workload by inheritance through the guardian.
    // It is never persisted: the descriptor outlives the launch and may hold no secrets.
    const config = { schema: 'starq.windows.job/v1', instance, token: randomBytes(32).toString('hex'), directory, exe: realpathSync(argv[0]), args: argv.slice(1), cwd: realpathSync(cwd) };
    const { configPath, bytes } = persistContainmentDescriptor(stateDir, instance, config);
    const meta = { kind: 'WINDOWS_JOB_V1', instance, config: configPath, config_sha256: hash(bytes), guardian, guardian_sha256: guardianSha256 };
    beforeSpawn(meta); // durable reservation is established before the trusted bootstrap runs
    const physical = createBootstrap(guardian, ['launch', configPath], { cwd, env: childEnv, shell: false, windowsHide: true, stdio, detached: detached === true });
    return {
      containment: meta,
      get pid() { try { return receipt(meta).root_pid; } catch { return 0; } },
      get rootCreatedMs() { return receipt(meta).root_created_ms; },
      on: typeof physical.on === 'function' ? (event, fn) => physical.on(event, fn) : undefined,
      unref: () => physical.unref?.(),
    };
  }
  async function status(meta, operation = 'query') {
    try {
      descriptor(meta); receipt(meta);
      const result = await execute(guardian, [operation, meta.config], { shell: false, windowsHide: true, timeout: 10000 });
      if (result.owned !== true || !Number.isInteger(result.active) || result.active < 0 || typeof result.closed !== 'boolean' || (result.closed && (result.active !== 0 || result.guardian_gone !== true))) throw new Error('incomplete or contradictory kernel job report');
      return result;
    } catch (error) { return { owned: false, closed: false, outcome: 'UNKNOWN', error: error.message }; }
  }
  async function stop(meta, { force = false, graceMs = 2000 } = {}) {
    const before = await status(meta);
    if (!before.owned) return { outcome: 'UNKNOWN', ...before };
    if (before.closed) return { ...before, outcome: 'GONE' };
    const signalled = await status(meta, force ? 'force' : 'graceful');
    if (!signalled.owned) return { ...signalled, outcome: 'UNKNOWN' };
    const deadline = clock() + graceMs;
    let current = signalled;
    while (current.owned && !current.closed && clock() < deadline) { await sleep(50); current = await status(meta); }
    return { ...current, outcome: current.closed && current.active === 0 ? 'GONE' : current.owned ? 'STILL_RUNNING' : 'UNKNOWN', forced: force };
  }
  return { launch, status, stop, receipt };
}
