#!/usr/bin/env node
/**
 * STARQ // COMMAND lifecycle owner — CLI.
 *
 *   start                      dependency-ordered start; fails closed; unwinds only its own attempt
 *   stop [--stop-agents]       drain broker -> graceful agent stop -> graceful control-plane stop
 *   restart [--stop-agents]    stop, then start
 *   status [--json]            read-only, inspection-complete truth
 *   recover --force            EXPLICIT forced recovery; re-proves identity before each forced signal
 *
 * All logic lives in scripts/lifecycle/owner.mjs. Configuration: lifecycle.config.json
 * (the only port/component truth; env overrides are refused). Every mutating command
 * takes the lifecycle lock, so this CLI, npm run command:* and the PowerShell commands
 * cannot interleave.
 *
 * Exit codes: 0 READY/STOPPED/RUNNING, 1 refused (nothing changed), 2 start failed
 * (cleanly unwound) or stop incomplete, 3 rollback incomplete, 10 status STOPPED,
 * 20 status other.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwner, EXIT, RESULT } from './lifecycle/owner.mjs';
import { loadConfig } from './lifecycle/config.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = createOwner({
  configFile: path.join(PACKAGE_ROOT, 'lifecycle.config.json'),
  runtimeDir: path.join(PACKAGE_ROOT, '.command-runtime'),
});
const observationConfigFile = path.join(PACKAGE_ROOT, 'lifecycle.observation.config.json');
let observationOwner = null;
function getObservationOwner() {
  if (observationOwner) return observationOwner;
  const cfg = loadConfig(observationConfigFile);
  observationOwner = createOwner({
    configFile: observationConfigFile,
    runtimeDir: cfg.abs(cfg.profile.runtime_directory),
    // Both profiles share one lifecycle lock so they cannot race for the same
    // ports while retaining separate state and logs.
    lockFile: cfg.abs(cfg.profile.shared_lock_file),
    inspectionTools: cfg.inspection_tools,
  });
  return observationOwner;
}

const [command = 'status', ...flags] = process.argv.slice(2);
const json = flags.includes('--json');
const known = new Set(['--json', '--stop-agents', '--force']);
const bad = flags.filter((f) => !known.has(f));

function emit(result) {
  if (json) { process.stdout.write(`${JSON.stringify(result, (k, v) => (k === 'token' ? '[redacted]' : v), 2)}\n`); return; }
  const line = (s) => process.stdout.write(`${s}\n`);
  line(`STARQ // COMMAND ${command}: ${result.result ?? result.overall}`);
  if (result.reason) line(`  reason: ${result.reason}`);
  if (result.failure) line(`  failed: ${result.failure.component}: ${result.failure.error}`);
  for (const u of result.unwound ?? []) line(`  unwound ${u.name}: ${u.outcome} (${u.detail})`);
  for (const s of result.steps ?? []) line(`  ${s.name}: ${s.outcome ?? ''} ${s.detail ?? (typeof s.result === 'string' ? s.result : '')}`);
  if (result.phase) line(`  incomplete at phase: ${result.phase}`);
  if (result.note) line(`  note: ${result.note}`);
  if (result.result === RESULT.READY) line(`  http://127.0.0.1:${result.state.ports.ui}/   attempt ${result.state.attempt_id}`);
  if (result.verification) line(`  verification: ${JSON.stringify(result.verification)}`);
  if (result.components) {
    for (const c of result.components) {
      const listener = !c.listener ? 'UNKNOWN'
        : c.listener.owned ? 'owned'
        : c.listener.present ? `FOREIGN(${c.listener.pids}${c.listener.classifications?.length ? `;${c.listener.classifications.map((x) => x.id || x.kind).join(',')}` : ''})`
        : 'none';
      line(`  ${c.name.padEnd(12)} ${String(c.port).padEnd(6)} ${c.ownership.padEnd(13)} pid=${c.pid ?? '-'} health=${c.health ? (c.health.ok ? 'OK' : `FAIL(${c.health.detail})`) : '-'} listener=${listener}`);
    }
    line(`  broker: ${JSON.stringify(result.broker)}`);
    if (result.infrastructure_policy) {
      line(`  infrastructure_policy: command_ports_remain_blocking=${result.infrastructure_policy.command_ports_remain_blocking}`);
    }
    if (Array.isArray(result.live_infrastructure)) {
      if (!result.live_infrastructure.length) line('  live_infrastructure: none observed');
      else for (const x of result.live_infrastructure) line(`  infra ${(x.id || 'unclassified').padEnd(22)} pid=${x.pid ?? '-'} ${x.kind}`);
    }
    line(`  inspection complete: ${result.inspection.complete}${result.inspection.errors.length ? ` (${result.inspection.errors.join('; ')})` : ''}`);
    for (const p of result.problems) line(`  problem: ${p}`);
    if (result.health_preflight) {
      const hp = result.health_preflight;
      line(`  health_preflight: overall=${hp.overall} idle_cooldown=${hp.idle_cooldown}`);
      for (const p of hp.ports ?? []) line(`  preflight ${(p.name || '?').padEnd(12)} ${String(p.port).padEnd(6)} ${p.state.padEnd(8)} ${p.detail}`);
    }
    if (result.repositories?.projects) {
      line('  repository_preflight:');
      for (const [id, r] of Object.entries(result.repositories.projects)) {
        line(`    ${id.padEnd(16)} ${r.state.padEnd(11)} ${r.state === 'RESOLVED' ? `${r.path} (${r.baseSha?.slice(0, 7)})` : r.reason}`);
      }
    }
  }
}

async function main() {
  if (bad.length) { process.stderr.write(`unknown flag(s): ${bad.join(' ')}\n`); return 1; }
  if (['observation-start', 'observation-status', 'observation-stop'].includes(command) && flags.some((f) => f !== '--json')) {
    process.stderr.write('observation commands accept only --json; worker/force flags are not applicable\n');
    return 1;
  }
  if (command === 'start') { const r = await owner.start(); emit(r); return EXIT[r.result]; }
  if (command === 'stop') { const r = await owner.stop({ stopAgents: flags.includes('--stop-agents') }); emit(r); return EXIT[r.result]; }
  if (command === 'restart') {
    const s = await owner.stop({ stopAgents: flags.includes('--stop-agents') });
    emit(s);
    if (s.result !== RESULT.STOPPED) return EXIT[s.result];
    const r = await owner.start(); emit(r); return EXIT[r.result];
  }
  if (command === 'recover') {
    if (!flags.includes('--force')) {
      process.stderr.write('recover requires --force: it is the explicit forced-termination recovery path. For a graceful stop use `stop`.\n');
      return 1;
    }
    const r = await owner.recoverForce(); emit(r); return EXIT[r.result];
  }
  if (command === 'status' || command === 'preflight') {
    const r = await owner.status(); emit(r);
    return r.overall === 'RUNNING' ? 0 : r.overall === 'STOPPED' ? 10 : 20;
  }
  if (command === 'observation-start') { const r = await getObservationOwner().start(); emit(r); return EXIT[r.result]; }
  if (command === 'observation-stop') {
    const r = await getObservationOwner().stop({ stopAgents: flags.includes('--stop-agents') }); emit(r); return EXIT[r.result];
  }
  if (command === 'observation-status') {
    const r = await getObservationOwner().status(); emit(r);
    return r.overall === 'RUNNING' ? 0 : r.overall === 'STOPPED' ? 10 : 20;
  }
  process.stderr.write(`unknown command ${command}; use start | stop [--stop-agents] | restart | status [--json] | preflight [--json] | recover --force | observation-start | observation-status | observation-stop\n`);
  return 1;
}

main().then((code) => { process.exitCode = code ?? 1; }).catch((err) => {
  process.stderr.write(`STARQ // COMMAND lifecycle error: ${err.stack || err.message}\n`);
  process.exitCode = 2;
});
