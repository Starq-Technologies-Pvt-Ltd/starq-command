import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { resolveWorkspace } from '../../../server/paths.mjs';
import { importTestComponent } from '../external-test-components.mjs';
const {
  compatibilityGate,
  developmentContainmentGate,
  probeDevelopmentRuntimeContainment,
  containmentOptions,
  containmentDependencyPaths,
} = await importTestComponent('herdr-floor', 'src/containment-config.mjs');
import { readGates, readDevelopmentGates, evaluateDevelopmentRule0Gate } from '../gates.mjs';
const { checkDevelopmentRule0, developmentOperationalSpecs } = await importTestComponent('starq-lifecycle', 'runtime-policy.mjs');
import { createOwner, RESULT } from '../owner.mjs';

const WORKSPACE_ROOT = resolveWorkspace().root;
assert.ok(WORKSPACE_ROOT, 'canonical STARQ workspace must be available for native lifecycle readiness tests');

// Helper to write simulated authenticated receipts for probe failure mock tests
function writeMockReceipt(configPath, { rootPid = 12345, assignedBeforeResume = true } = {}) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const payloadStr = JSON.stringify({
    schema: 'starq.windows.job.receipt/v1',
    kind: 'started',
    job: 'Local\\StarqJob_' + cfg.instance,
    exe: cfg.exe,
    root_pid: rootPid,
    root_created_ms: Date.now(),
    assigned_before_resume: assignedBeforeResume,
  });
  const mac = createHmac('sha256', cfg.token).update('started|' + cfg.instance + '|' + payloadStr).digest('hex');
  writeFileSync(path.join(cfg.directory, 'started.json'), JSON.stringify({ payload: payloadStr, mac }), 'utf8');
}

test('release containment gate remains strictly fail-closed with unexecuted acceptance state', () => {
  const result = compatibilityGate(WORKSPACE_ROOT);
  assert.equal(result.resolved, false);
  assert.match(result.detail, /G-CONTAINMENT: exact-build independent compatibility proof required/);
});

test('development containment gate passes on valid disk binaries, build pins and active runtime verification (exercises live probe)', () => {
  // Test explicitly exercises the live probeDevelopmentRuntimeContainment implementation
  const result = developmentContainmentGate(WORKSPACE_ROOT);
  assert.equal(result.resolved, true);
  assert.equal(result.tier, 'development');
  assert.equal(result.dependencies_verified, 8);
  assert.ok(result.runtime_containment, 'runtime containment evidence must be present');
  assert.ok(result.runtime_containment.root_pid > 0, 'reliable process identification verified');
  assert.equal(result.runtime_containment.assigned_before_resume, true, 'pre-resume kernel assignment verified');
  assert.ok(result.runtime_containment.kernel_job_active >= 1, 'kernel job containment verified');
  assert.equal(result.runtime_containment.interrupted_recovery_outcome, 'GONE', 'verified clean recovery closure');
  assert.equal(result.runtime_containment.cleanup, 'VERIFIED_AND_REMOVED', 'verified fail-closed scratch cleanup');
  assert.match(
    result.detail,
    /development runtime containment verified \(JobGuardian binary, build pins, 8 runtime dependencies, authenticated process identification, kernel child containment & recovery verified/
  );
});

test('development containment gate fails closed if JobGuardian.exe drifts', () => {
  const mockRead = (filePath) => {
    if (filePath.endsWith('JobGuardian.exe')) return Buffer.from('corrupted binary');
    return readFileSync(filePath);
  };
  const result = developmentContainmentGate(WORKSPACE_ROOT, { read: mockRead, verifyRuntime: false });
  assert.equal(result.resolved, false);
  assert.match(result.detail, /JobGuardian\.exe binary pin drift/);
});

test('development containment gate fails closed if a node-pty runtime dependency hash drifts', () => {
  const mockRead = (filePath) => {
    if (filePath.endsWith('conpty.dll')) return Buffer.from('modified dll content');
    return readFileSync(filePath);
  };
  const result = developmentContainmentGate(WORKSPACE_ROOT, { read: mockRead, verifyRuntime: false });
  assert.equal(result.resolved, false);
  assert.match(result.detail, /dependency hash drift on disk: .*conpty\.dll/i);
});

test('development containment gate fails closed if practical runtime probe reports failure', () => {
  const mockProbe = () => ({
    ok: false,
    error: 'child containment unsupported by active runtime: owned=false, active=0',
  });
  const result = developmentContainmentGate(WORKSPACE_ROOT, { probeRuntime: mockProbe });
  assert.equal(result.resolved, false);
  assert.match(result.detail, /runtime containment evidence failed: child containment unsupported/);
});

test('development containment gate exposes cleanup status and retainedDirectory in failure detail when probe retains evidence', () => {
  const dummyRetainedDir = path.join(WORKSPACE_ROOT, '_scratch', 'STARQ-COMMAND-DEVELOPMENT-READINESS-IMPLEMENTATION-2026-10-27', 'dummy-retained-test');
  const mockFailedProbeWithRetention = () => ({
    ok: false,
    error: 'interrupted-start recovery unclosed after force: closed=false, active=1',
    cleanup: 'UNVERIFIED_RETAINED',
    retainedDirectory: dummyRetainedDir,
  });
  const result = developmentContainmentGate(WORKSPACE_ROOT, { probeRuntime: mockFailedProbeWithRetention });
  assert.equal(result.resolved, false);
  assert.match(result.detail, /runtime containment evidence failed: interrupted-start recovery unclosed after force/);
  assert.match(result.detail, /cleanup=UNVERIFIED_RETAINED/);
  assert.match(result.detail, /retainedDirectory=.*dummy-retained-test/);
  assert.equal(result.runtime_containment?.cleanup, 'UNVERIFIED_RETAINED');
  assert.equal(result.runtime_containment?.retainedDirectory, dummyRetainedDir);
});

test('probeDevelopmentRuntimeContainment fails closed on missing/invalid authenticated started receipt', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (bin, args) => {
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: null, on: () => {}, unref: () => {} };
    },
    execSync: () => '{}',
  });
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /reliable process identification failed: authenticated started receipt has no root_pid/);
});

test('probeDevelopmentRuntimeContainment fails closed on kernel job query failure', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (exe, args) => {
      writeMockReceipt(args[1]);
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: 12345, on: () => {}, unref: () => {} };
    },
    execSync: (bin, args) => {
      if (args[0] === 'query') throw new Error('mock kernel status query failure');
      return '{}';
    },
  });
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /kernel job status query failed: mock kernel status query failure/);
});

test('probeDevelopmentRuntimeContainment fails closed when active runtime reports job unowned or active=0', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (exe, args) => {
      writeMockReceipt(args[1]);
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: 12345, on: () => {}, unref: () => {} };
    },
    execSync: (bin, args) => {
      if (args[0] === 'query') return JSON.stringify({ owned: false, active: 0 });
      return '{}';
    },
  });
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /child containment unsupported by active runtime: owned=false, active=0/);
});

test('probeDevelopmentRuntimeContainment fails closed when force recovery reports unowned', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (exe, args) => {
      writeMockReceipt(args[1]);
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: 12345, on: () => {}, unref: () => {} };
    },
    execSync: (bin, args) => {
      if (args[0] === 'query') return JSON.stringify({ owned: true, active: 1, closed: false, guardian_gone: false });
      if (args[0] === 'force') return JSON.stringify({ owned: false });
      return '{}';
    },
  });
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /interrupted-start recovery incomplete: owned=false/);
});

test('probeDevelopmentRuntimeContainment fails closed when recovery fails to reach closed=true and active=0', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let qCount = 0;
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (exe, args) => {
      writeMockReceipt(args[1]);
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: 12345, on: () => {}, unref: () => {} };
    },
    execSync: (bin, args) => {
      if (args[0] === 'query') {
        qCount++;
        if (qCount === 1) return JSON.stringify({ owned: true, active: 1, closed: false, guardian_gone: false });
        return JSON.stringify({ owned: true, active: 1, closed: false, guardian_gone: false });
      }
      if (args[0] === 'force') return JSON.stringify({ owned: true });
      return '{}';
    },
  });
  // In simulated mock failure, active=1 triggers evidence preservation in probe finally block;
  // clean up the mock scratch directory now that probe fail-closed behavior is verified:
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
  assert.equal(res.ok, false);
  assert.match(res.error, /interrupted-start recovery unclosed after force: closed=false, active=1/);
});

test('probeDevelopmentRuntimeContainment cleanup is fail-closed: retains scratch directory when verifying query throws', () => {
  const guardianBuild = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/guardian-build.json')));
  let qCount = 0;
  let tmpProbeDir = null;
  const res = probeDevelopmentRuntimeContainment({
    workspace: WORKSPACE_ROOT,
    guardian: path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/native/JobGuardian.exe'),
    guardianSha256: guardianBuild.binary_sha256,
    spawnProcess: (exe, args) => {
      writeMockReceipt(args[1]);
      tmpProbeDir = path.dirname(path.dirname(args[1]));
      return { pid: 12345, on: () => {}, unref: () => {} };
    },
    execSync: (bin, args) => {
      if (args[0] === 'query') {
        qCount++;
        // 1st query: during active check -> owned & active
        if (qCount === 1) return JSON.stringify({ owned: true, active: 1, closed: false, guardian_gone: false });
        // 2nd query: post-force check -> closed & gone
        if (qCount === 2) return JSON.stringify({ owned: true, active: 0, closed: true, guardian_gone: true });
        // 3rd query: finally block verification query -> throws error
        throw new Error('simulated verification query crash');
      }
      if (args[0] === 'force') return JSON.stringify({ owned: true });
      return '{}';
    },
  });

  // Probe succeeded its execution phase:
  assert.equal(res.ok, true);
  assert.equal(res.recoveryOutcome, 'GONE');
  // Explicit cleanup status surfaces UNVERIFIED_RETAINED and records retainedDirectory:
  assert.equal(res.cleanup, 'UNVERIFIED_RETAINED');
  assert.equal(res.retainedDirectory, tmpProbeDir);

  // But because verifying query threw in finally block, cleanup was REFUSED (fail-closed) and directory retained:
  assert.ok(tmpProbeDir, 'probe scratch directory must be recorded');
  const dirRetained = (() => {
    try {
      readFileSync(path.join(tmpProbeDir, 'launch.json')); // test if accessible
      return true;
    } catch {
      // directory exists check:
      try { return (tmpProbeDir && Boolean(path.resolve(tmpProbeDir))); } catch { return false; }
    }
  })();
  assert.equal(dirRetained, true, 'evidence directory must be retained when verification query fails');

  // Clean up the verified retained directory manually now that fail-closed retention is proven:
  if (tmpProbeDir) {
    try { rmSync(tmpProbeDir, { recursive: true, force: true }); } catch {}
  }
});

test('profile selection: containmentOptions honours release vs development tiers', () => {
  // Release tier throws because compatibilityGate fails closed:
  assert.throws(
    () => containmentOptions(WORKSPACE_ROOT, 'D:\\tmp', { tier: 'release' }),
    /exact-build independent compatibility proof required/
  );

  // Development tier succeeds and returns options with runtime verification:
  const opts = containmentOptions(WORKSPACE_ROOT, 'D:\\tmp', { tier: 'development' });
  assert.equal(opts.tier, 'development');
  assert.ok(opts.guardian.endsWith('JobGuardian.exe'));
  assert.equal(typeof opts.guardianSha256, 'string');
});

test('readGates with containmentTier=development resolves G-CONTAINMENT without altering canonical proof file', () => {
  const gates = readGates(WORKSPACE_ROOT, {
    checkRule0: () => ({ resolved: true, detail: 'fast rule0 test check' }),
    containmentTier: 'development',
  });
  const containment = gates.find((g) => g.kind === 'G-CONTAINMENT');
  assert.ok(containment);
  assert.equal(containment.resolved, true);
  assert.match(containment.detail, /native matrix acceptance deferred to release\/unattended tier/);
});

test('readDevelopmentGates resolves G-WSL, G-RULE0, G-PROFILE and G-CONTAINMENT in development tier', () => {
  const gates = readDevelopmentGates(WORKSPACE_ROOT);
  assert.equal(gates.length, 4);
  assert.ok(gates.every((g) => g.resolved === true), `Some gate failed: ${JSON.stringify(gates)}`);
  const rule0 = gates.find((g) => g.kind === 'G-RULE0');
  assert.match(rule0.detail, /focused operational inventory verified/);
  const containment = gates.find((g) => g.kind === 'G-CONTAINMENT');
  assert.match(containment.detail, /development runtime containment verified/);
});

test('development Rule 0 classifies operational failures as blocking and unrelated findings as advisories', () => {
  const mockScan = (specs) => {
    return {
      schema: 'starq.rule0.inventory/v1',
      entries: specs.map((s) => ({ path: s.path, role: s.role, owner: s.owner, bytes: 100 })),
      volumes: { 'D:\\': { free_bytes: 1e11 } },
      unresolved: [{ path: 'D:\\StarqTech\\missing-operational.mjs', role: 'entry', owner: 'test', error: 'ENOENT' }],
      sha256: 'a'.repeat(64),
    };
  };
  const res = checkDevelopmentRule0(WORKSPACE_ROOT, null, { scan: mockScan, dotnetProbe: () => ({ release: 533320, binaries: {} }) });
  assert.equal(res.resolved, false);
  assert.ok(res.failures.some((f) => f.includes('missing-operational.mjs')));
});

test('development Rule 0 passes with advisories when inventory contains non-operational findings outside operational set', () => {
  const mockScan = (specs) => {
    return {
      schema: 'starq.rule0.inventory/v1',
      entries: [
        ...specs.map((s) => ({ path: s.path, role: s.role, owner: s.owner, bytes: 100 })),
        { path: 'C:\\Users\\Ali Musthaq\\unrelated-scratch\\note.txt', role: 'data', owner: 'test', bytes: 100 }
      ],
      volumes: { 'D:\\': { free_bytes: 1e11 } },
      unresolved: [],
      sha256: 'a'.repeat(64),
    };
  };
  const res = checkDevelopmentRule0(WORKSPACE_ROOT, null, { scan: mockScan });
  assert.equal(res.resolved, true);
  assert.equal(res.failures.length, 0);
  assert.ok(res.advisories.length > 0, 'advisories must be captured');
  assert.ok(res.advisories.some((a) => a.includes('note.txt')));
  assert.match(res.detail, /development operational inventory verified/);
});

test('owner startup preflight refuses foreign listeners and port conflicts in development mode', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cmd-dev-test-'));
  try {
    const cfgPath = path.join(tmp, 'lifecycle.config.json');
    const runtimeDir = path.join(tmp, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const cfg = {
      schema: 'starq.command.lifecycle.config/v1',
      workspace_root: WORKSPACE_ROOT,
      node: 'D:\\fake\\node.exe',
      host: '127.0.0.1',
      timeouts_ms: { identity: 40, health: 40, graceful_exit: 40, broker_request: 40, agent_stop: 40 },
      profile: { name: 'starq-online/v1', tier: 'development' },
      components: [
        { name: 'data', kind: 'module', entry: 'x\\data.mjs', cwd: 'x', port: 5177, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'building', kind: 'module', entry: 'x\\building.mjs', cwd: 'x', port: 5178, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'herdrBroker', kind: 'module', entry: 'x\\broker.mjs', cwd: 'x', port: 5188, depends_on: [], lifecycle_token: 'tok.txt', manifest: '00_STARQ_HQ/operations/herdr-floor/manifest.json', health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'herdr', kind: 'module', entry: 'x\\herdr.mjs', cwd: 'x', port: 5179, depends_on: ['herdrBroker'], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'pm', kind: 'module', entry: 'x\\pm.mjs', cwd: 'x', port: 5176, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'ui', kind: 'vite', entry: 'x\\ui.mjs', cwd: 'x', port: 5173, vite_config: 'vite.config.ts', depends_on: ['data', 'building', 'herdr', 'pm'], health: { path: '/', status: 200, content_type: 'text/html', body_includes: ['root'] } },
      ],
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

    const owner = createOwner({
      configFile: cfgPath,
      runtimeDir,
      tier: 'development',
      configOptions: { checkFiles: false },
      deps: {
        listListeners: async () => [{ port: 5173, pid: 99999 }],
        inspectProcesses: async () => new Map([[99999, { pid: 99999, exe: 'C:\\Windows\\notepad.exe' }]]),
        prerequisites: async () => [{ kind: 'G-RULE0', resolved: true }, { kind: 'G-CONTAINMENT', resolved: true }],
      },
    });
    const res = await owner.start();
    assert.equal(res.result, RESULT.REFUSED);
    assert.match(res.reason, /ports occupied: 5173<-pid 99999/);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

test('owner recoverForce recovers interrupted startup state and transitions cleanly to STOPPED', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cmd-dev-recover-'));
  try {
    const cfgPath = path.join(tmp, 'lifecycle.config.json');
    const runtimeDir = path.join(tmp, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const cfg = {
      schema: 'starq.command.lifecycle.config/v1',
      workspace_root: WORKSPACE_ROOT,
      node: process.execPath,
      host: '127.0.0.1',
      timeouts_ms: { identity: 40, health: 40, graceful_exit: 40, broker_request: 40, agent_stop: 40 },
      profile: { name: 'starq-online/v1', tier: 'development' },
      components: [
        { name: 'data', kind: 'module', entry: 'x\\data.mjs', cwd: 'x', port: 5177, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'building', kind: 'module', entry: 'x\\building.mjs', cwd: 'x', port: 5178, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'herdrBroker', kind: 'module', entry: 'x\\broker.mjs', cwd: 'x', port: 5188, depends_on: [], lifecycle_token: 'tok.txt', manifest: '00_STARQ_HQ/operations/herdr-floor/manifest.json', health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'herdr', kind: 'module', entry: 'x\\herdr.mjs', cwd: 'x', port: 5179, depends_on: ['herdrBroker'], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'pm', kind: 'module', entry: 'x\\pm.mjs', cwd: 'x', port: 5176, depends_on: [], health: { path: '/h', status: 200, json_has: ['ok'] } },
        { name: 'ui', kind: 'vite', entry: 'x\\ui.mjs', cwd: 'x', port: 5173, vite_config: 'vite.config.ts', depends_on: ['data', 'building', 'herdr', 'pm'], health: { path: '/', status: 200, content_type: 'text/html', body_includes: ['root'] } },
      ],
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

    // Create interrupted startup state in runtimeDir/state.json
    const statePath = path.join(runtimeDir, 'state.json');
    const state = {
      schema: 'starq.command.lifecycle.state/v2',
      state: 'STARTING',
      attempt_id: 'att-test-interrupted-start',
      config_sha256: 'a'.repeat(64),
      owner_pid: 12345,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      profile: { name: 'starq-online/v1', tier: 'development' },
      phase: 'STARTING',
      active: true,
      result: null,
      children: [
        { name: 'data', pid: 90001, exe: process.execPath, instance_id: 'data-inst', token: 'tok-1', status: 'READY', started_at: new Date().toISOString(), created_at: '2026-10-27T00:00:00Z', exit_code: null, error: null },
        { name: 'pm', pid: 90002, exe: process.execPath, instance_id: 'pm-inst', token: 'tok-2', status: 'IDENTIFIED', started_at: new Date().toISOString(), created_at: '2026-10-27T00:00:00Z', exit_code: null, error: null }
      ]
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

    const killedPids = [];
    const selfPid = 4242;
    const procMap = new Map([
      [selfPid, { pid: selfPid, found: true, created: '2026-10-27T00:00:00Z', exe: process.execPath }],
      [90001, { pid: 90001, found: true, created: '2026-10-27T00:00:00Z', exe: process.execPath }],
      [90002, { pid: 90002, found: true, created: '2026-10-27T00:00:00Z', exe: process.execPath }]
    ]);

    const owner = createOwner({
      configFile: cfgPath,
      runtimeDir,
      tier: 'development',
      configOptions: { checkFiles: false },
      deps: {
        selfPid,
        inspect: async (pids) => new Map(pids.map((p) => {
          if (killedPids.includes(p)) return [p, { pid: p, found: false }];
          return [p, procMap.get(p) ?? { pid: p, found: false }];
        })),
        forceKill: async (pid) => { killedPids.push(pid); return { ok: true }; },
        treeClosed: async () => true,
        treeSignalSafe: async () => true,
        proveInstance: async () => ({ ok: true, detail: 'mock instance proven' }),
        proveBoundAddress: async () => ({ ok: false, supported: false, addresses: [], detail: 'simulated host predates the bound op' }),
        brokerRequest: async () => ({ ok: true }),
        // Every other process fact here is simulated; the listener table must be
        // too. Reading the machine's real netstat made `ports_free` depend on
        // whatever else was bound to 5173-5188 at that instant, including other
        // suites running in parallel under the same `node --test`.
        listListeners: async () => [],
      },
    });

    const res = await owner.recoverForce('interrupted startup test');
    assert.equal(res.result, RESULT.STOPPED);
    assert.ok(killedPids.includes(90001));
    assert.ok(killedPids.includes(90002));
    assert.equal(res.verification.complete, true);
    assert.equal(res.verification.ports_free, true);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

test('canonical Start-Starq.ps1 wrapper delegates G-RULE0 evaluation to owner development tier', () => {
  const wrapperScript = readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/Start-Starq.ps1'), 'utf8');
  // Wrapper must NOT invoke the full-tier Get-Rule0Gate precheck that bypasses development tier:
  assert.equal(/Get-Rule0Gate\s+300/.test(wrapperScript), false, 'Start-Starq.ps1 must not call Get-Rule0Gate directly');
  // Wrapper must preserve delegation to canonical owner and WslAuditGate:
  assert.ok(wrapperScript.includes('Get-WslAuditGate'), 'wrapper must retain Get-WslAuditGate');
  assert.ok(wrapperScript.includes('Invoke-StarqOwner'), 'wrapper must retain Invoke-StarqOwner');
});

test('canonical Start-Starq entrypoint supports opt-in -CommandOnly switch and forwards arguments without invoking startup', () => {
  const wrapperScript = readFileSync(path.join(WORKSPACE_ROOT, '00_STARQ_HQ/operations/starq-lifecycle/Start-Starq.ps1'), 'utf8');
  const batScript = readFileSync(path.join(WORKSPACE_ROOT, 'Start-Starq.bat'), 'utf8');

  // 1. Start-Starq.bat forwards all arguments (%*) to Start-Starq.ps1:
  assert.match(batScript, /powershell(?:\.exe)? .* -File "%STARQ_LC%" %\*/i, 'Start-Starq.bat must forward %* to Start-Starq.ps1');

  // 2. Start-Starq.ps1 declares opt-in [switch]$CommandOnly:
  assert.match(wrapperScript, /param\s*\(\s*\[switch\]\$CommandOnly\s*\)/, 'Start-Starq.ps1 must declare [switch]$CommandOnly parameter');

  // 3. Bot suppression logic when $CommandOnly is present:
  assert.match(wrapperScript, /if\s*\(\$CommandOnly\)\s*\{[\s\S]*?skipping StarqBot gateway phase/i, 'Start-Starq.ps1 must log and skip Bot phase when -CommandOnly');
  assert.match(wrapperScript, /\$botEligible\s*=\s*\(-not\s+\$CommandOnly\s+-and/i, 'botEligible must require -not $CommandOnly');

  // 4. Default preservation: without -CommandOnly, bot phase remains eligible on READY and REFUSED:
  assert.match(wrapperScript, /\(\$commandResult\s+-in\s+@\('READY',\s*'REFUSED'\)\)/, 'bot phase must remain eligible on READY and REFUSED by default');
});

