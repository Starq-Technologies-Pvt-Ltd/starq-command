import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { importExternalComponent } from '../../server/external-components.mjs';
import {
  DEVELOPMENT_TIER, OBSERVATION_COMPONENTS, OBSERVATION_PROFILE, OBSERVATION_RUNTIME_DIRECTORY,
  OBSERVATION_SHARED_LOCK, validateConfig,
} from './config.mjs';

const [starqLifecycle, herdrFloor] = await Promise.all([
  importExternalComponent('starq-lifecycle', 'runtime-policy.mjs'),
  importExternalComponent('herdr-floor', 'src/containment-config.mjs'),
]);
const unavailableCheck = (component, exportName) => () => {
  throw new Error(component.reason ?? `${component.name} module does not export ${exportName}`);
};
const checkObservationRule0 = starqLifecycle.module?.checkObservationRule0 ?? unavailableCheck(starqLifecycle, 'checkObservationRule0');
const checkWorkspaceRule0 = starqLifecycle.module?.checkWorkspaceRule0 ?? unavailableCheck(starqLifecycle, 'checkWorkspaceRule0');
const checkDevelopmentRule0 = starqLifecycle.module?.checkDevelopmentRule0 ?? unavailableCheck(starqLifecycle, 'checkDevelopmentRule0');
const unavailableGate = (component, label, exportName) => () => ({
  resolved: false,
  detail: `${label}: ${component.reason ?? `${component.name} module does not export ${exportName}`}`,
});
const compatibilityGate = herdrFloor.module?.compatibilityGate ?? unavailableGate(herdrFloor, 'G-CONTAINMENT', 'compatibilityGate');
const developmentContainmentGate = herdrFloor.module?.developmentContainmentGate ?? unavailableGate(herdrFloor, 'G-CONTAINMENT', 'developmentContainmentGate');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Evidence files are checked without executing any audit or booting WSL.
// This validates recorded evidence; independent acceptance remains external.
export function evaluateRule0Gate(workspace, { check = checkWorkspaceRule0 } = {}) {
  if (typeof workspace !== 'string' || !workspace) {
    return { resolved: false, detail: 'G-RULE0: canonical workspace root required for actual-path inventory enforcement' };
  }
  try {
    const result = check(workspace);
    const inventory = result?.inventory;
    const complete = inventory?.schema === 'starq.rule0.inventory/v1'
      && Array.isArray(inventory.entries)
      && Array.isArray(inventory.unresolved)
      && inventory.unresolved.length === 0
      && /^[a-f0-9]{64}$/i.test(inventory.sha256 ?? '')
      && Array.isArray(result.failures)
      && result.failures.length === 0
      && result.resolved === true;
    return {
      resolved: complete,
      detail: complete ? result.detail : (result?.detail ?? 'G-RULE0: inventory or policy evaluation incomplete'),
      failure_count: Array.isArray(result?.failures) ? result.failures.length : null,
      inventory_sha256: inventory?.sha256 ?? null,
    };
  } catch (err) {
    return { resolved: false, detail: `G-RULE0: actual path inventory UNKNOWN (${err.message})` };
  }
}

export function evaluateObservationRule0Gate(workspace, cfg, { check = checkObservationRule0 } = {}) {
  if (typeof workspace !== 'string' || !workspace) {
    return { resolved: false, detail: 'G-RULE0-OBS: canonical workspace root required for scoped observer inventory enforcement' };
  }
  try {
    const result = check(workspace, cfg);
    const inventory = result?.inventory;
    const complete = inventory?.schema === 'starq.rule0.inventory/v1'
      && Array.isArray(inventory.entries) && inventory.entries.length > 0
      && Array.isArray(inventory.unresolved) && inventory.unresolved.length === 0
      && /^[a-f0-9]{64}$/i.test(inventory.sha256 ?? '')
      && Array.isArray(result.failures) && result.failures.length === 0
      && result.resolved === true;
    return {
      resolved: complete,
      detail: complete ? `G-RULE0-OBS: scoped three-service and containment inventory verified (${inventory.entries.length} entries)`
        : (result?.detail ?? 'G-RULE0-OBS: inventory or policy evaluation incomplete'),
      failure_count: Array.isArray(result?.failures) ? result.failures.length : null,
      inventory_sha256: inventory?.sha256 ?? null,
    };
  } catch (err) {
    return { resolved: false, detail: `G-RULE0-OBS: scoped actual-path inventory UNKNOWN (${err.message})` };
  }
}

export function evaluateDevelopmentRule0Gate(workspace, cfg = null, { check = checkDevelopmentRule0 } = {}) {
  if (typeof workspace !== 'string' || !workspace) {
    return { resolved: false, detail: 'G-RULE0-DEV: canonical workspace root required for development operational inventory enforcement' };
  }
  try {
    const result = check(workspace, cfg);
    const inventory = result?.inventory;
    const complete = inventory?.schema === 'starq.rule0.inventory/v1'
      && Array.isArray(inventory.entries) && inventory.entries.length > 0
      && Array.isArray(inventory.unresolved) && inventory.unresolved.length === 0
      && /^[a-f0-9]{64}$/i.test(inventory.sha256 ?? '')
      && Array.isArray(result.failures) && result.failures.length === 0
      && result.resolved === true;
    return {
      resolved: complete,
      detail: complete
        ? `G-RULE0-DEV: focused operational inventory verified (${inventory.entries.length} entries; ${result.advisories?.length ?? 0} advisories)`
        : (result?.detail ?? 'G-RULE0-DEV: operational inventory or policy evaluation incomplete'),
      failure_count: Array.isArray(result?.failures) ? result.failures.length : null,
      advisory_count: Array.isArray(result?.advisories) ? result.advisories.length : 0,
      inventory_sha256: inventory?.sha256 ?? null,
    };
  } catch (err) {
    return { resolved: false, detail: `G-RULE0-DEV: operational inventory UNKNOWN (${err.message})` };
  }
}

export function evaluateObservationComposition(cfg) {
  const problems = validateConfig(cfg, { checkFiles: false });
  const names = cfg?.components?.map((c) => c.name);
  const valid = cfg?.profile?.name === OBSERVATION_PROFILE
    && JSON.stringify(names) === JSON.stringify(OBSERVATION_COMPONENTS)
    && problems.length === 0;
  return {
    resolved: valid,
    detail: valid ? 'G-PROFILE-OBS: exact data/building/UI composition, loopback host, ports, source paths and no worker/Room/control adapters verified'
      : `G-PROFILE-OBS: observation composition/configuration drift${problems.length ? ` (${problems.join('; ')})` : ''}`,
  };
}

export function evaluateObservationOwnership(cfg) {
  const valid = cfg?.profile?.name === OBSERVATION_PROFILE
    && cfg.profile.runtime_directory === OBSERVATION_RUNTIME_DIRECTORY
    && cfg.profile.shared_lock_file === OBSERVATION_SHARED_LOCK
    && cfg.profile.shared_lock_file !== cfg.profile.runtime_directory;
  return {
    resolved: valid,
    detail: valid ? 'G-OWNERSHIP-OBS: dedicated observer state uses the full/observer shared exclusive lifecycle lock; child ownership remains owner-issued and containment-bound'
      : 'G-OWNERSHIP-OBS: runtime directory or shared lifecycle lock ownership contract drift',
  };
}

/** Observer gates replace only WSL and standalone-Herdr profile applicability; containment remains the exact full native proof gate. */
export function readObservationGates(workspace, cfg, { checkRule0 = checkObservationRule0, checkContainment = compatibilityGate } = {}) {
  return [
    { kind: 'G-RULE0-OBS', ...evaluateObservationRule0Gate(workspace, cfg, { check: checkRule0 }) },
    { kind: 'G-PROFILE-OBS', ...evaluateObservationComposition(cfg) },
    { kind: 'G-OWNERSHIP-OBS', ...evaluateObservationOwnership(cfg) },
    { kind: 'G-CONTAINMENT', ...checkContainment(workspace) },
  ];
}

export function evaluateGate(kind, record, { read = readFileSync, workspace, checkRule0 } = {}) {
  const fail = (why) => ({ resolved: false, detail: `${kind}: ${why}` });
  if (kind === 'G-RULE0') return evaluateRule0Gate(workspace, { check: checkRule0 ?? checkWorkspaceRule0 });
  if (kind !== 'G-WSL') return fail('unsupported evidence gate');
  if (!record || record.schema !== 'starq.lifecycle.gate/v2') return fail('missing validated v2 evidence record');
  if (!record.scope || !record.verified_at || !Number.isFinite(Date.parse(record.verified_at)) || !record.verifier) return fail('verification metadata incomplete');
  if (record.outcome !== 'SAFE' || !Array.isArray(record.evidence) || !record.evidence.length) return fail('safe evidence required');
  try {
    for (const e of record.evidence) {
      if (!path.isAbsolute(e.path ?? '') || !/^[a-f0-9]{64}$/i.test(e.sha256 ?? '') || digest(read(e.path)).toLowerCase() !== e.sha256.toLowerCase()) return fail('evidence hash drift or invalid evidence');
    }
    if (kind === 'G-WSL') {
      if (record.scope !== 'ALL_REGISTERED_DISTROS' || !Array.isArray(record.distros) || !record.distros.length) return fail('full distro coverage required');
      if (record.distros.some((d) => !d.name || d.result !== 'SAFE' || !Array.isArray(d.enabled_starq_units) || d.enabled_starq_units.length || !Array.isArray(d.unresolved) || d.unresolved.length)) return fail('unsafe or incomplete distro audit');
    }
  } catch (err) { return fail(`evidence unreadable: ${err.message}`); }
  return { resolved: true, detail: `${kind}: recorded SAFE evidence verified by ${record.verifier}` };
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * G-PROFILE: the standalone Herdr owner protocol. Standalone Herdr stays owned by
 * the Founder (interactive); this gate only proves that ownership boundary was
 * recorded and independently verified. It never makes Command a second owner
 * and never asserts that Herdr is running: Status observes that separately.
 */
export function evaluateStandaloneHerdrOwner(record, entry, { read = readFileSync } = {}) {
  const fail = (why) => ({ resolved: false, detail: `G-PROFILE: ${why}` });
  if (!entry) return fail('standalone-herdr is not declared in lifecycle.config.json');
  if (!record) return fail(`no Founder owner record at ${entry.owner_record}; standalone Herdr owner protocol not commissioned`);
  if (record.schema !== 'starq.standalone-herdr.owner/v1') return fail('owner record schema must be starq.standalone-herdr.owner/v1');
  if (record.decided_by !== 'Founder' || !record.decision_id || !Number.isFinite(Date.parse(record.decided_at))) return fail('Founder decision metadata incomplete');
  if (record.owner_protocol !== 'OPERATOR_INTERACTIVE' || record.command_actuation !== 'NONE') return fail('owner protocol must keep Command read-only (OPERATOR_INTERACTIVE, actuation NONE)');
  if (!samePath(record.executable, entry.executable) || !samePath(record.storage_root, entry.storage_root)) return fail('owner record does not name the configured executable and storage root');
  if (!/^[a-f0-9]{64}$/i.test(record.executable_sha256 ?? '')) return fail('executable hash pin missing');
  if (!record.verifier || record.verifier === record.builder || !Number.isFinite(Date.parse(record.verified_at))) return fail('independent verification metadata incomplete');
  if (!Array.isArray(record.evidence) || !record.evidence.length) return fail('hashed evidence required');
  const pending = record.pin_update?.pending_independent_verification;
  if (typeof pending === 'string' && pending.trim()) return fail('executable pin pending independent verification');
  const pinSha = String(record.pin_update?.to_sha256 ?? record.executable_sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(pinSha) || pinSha !== record.executable_sha256.toLowerCase()) {
    return fail('pin_update.to_sha256 is not bound to executable_sha256');
  }
  const iv = record.independent_verification;
  if (!iv || !/^[a-f0-9]{64}$/i.test(iv.executable_hash_recomputed ?? '')) {
    return fail('independent verification does not recompute the executable hash');
  }
  if (iv.executable_hash_recomputed.toLowerCase() !== record.executable_sha256.toLowerCase()) {
    return fail('independent verification hash is not bound to the current executable pin');
  }
  try {
    if (digest(read(entry.executable)).toLowerCase() !== record.executable_sha256.toLowerCase()) return fail('standalone Herdr executable hash drift');
    for (const e of record.evidence) {
      if (!path.isAbsolute(e.path ?? '') || !/^[a-f0-9]{64}$/i.test(e.sha256 ?? '') || digest(read(e.path)).toLowerCase() !== e.sha256.toLowerCase()) return fail('evidence hash drift or invalid evidence');
    }
  } catch (err) { return fail(`owner evidence unreadable: ${err.message}`); }
  return { resolved: true, detail: `G-PROFILE: standalone Herdr owner protocol recorded (${record.decision_id}) and verified by ${record.verifier}; live availability is observed by Status, not assumed` };
}

export function readStandaloneHerdrGate(workspace, { read = readFileSync } = {}) {
  let entry;
  try {
    const cfg = JSON.parse(read(path.join(workspace, '00_STARQ_HQ', 'operations', 'starq-command', 'lifecycle.config.json'), 'utf8'));
    entry = (cfg.profile?.external_required ?? []).find((e) => e?.id === 'standalone-herdr') ?? null;
  } catch (err) { return { resolved: false, detail: `G-PROFILE: lifecycle config unreadable (${err.message})` }; }
  let record = null;
  if (entry?.owner_record) {
    try { record = JSON.parse(read(path.join(workspace, entry.owner_record), 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') return { resolved: false, detail: `G-PROFILE: owner record unreadable (${err.message})` }; }
  }
  return evaluateStandaloneHerdrOwner(record, entry, { read });
}

export function readWslGate(workspace, { read = readFileSync } = {}) {
  const root = path.join(workspace, '00_STARQ_HQ', 'operations', 'starq-lifecycle', 'state');
  try {
    const record = JSON.parse(read(path.join(root, 'wsl-autostart-audit.json'), 'utf8'));
    return { kind: 'G-WSL', ...evaluateGate('G-WSL', record, { read, workspace }) };
  } catch (err) {
    return { kind: 'G-WSL', resolved: false, detail: `G-WSL: missing/unreadable evidence (${err.message})` };
  }
}

export function readDevelopmentGates(workspace, cfg = null, {
  read = readFileSync,
  checkRule0 = checkDevelopmentRule0,
  checkContainment = developmentContainmentGate,
} = {}) {
  const root = path.join(workspace, '00_STARQ_HQ', 'operations', 'starq-lifecycle', 'state');
  const gates = [['G-WSL', 'wsl-autostart-audit.json']].map(([kind, file]) => {
    try { return { kind, ...evaluateGate(kind, JSON.parse(read(path.join(root, file), 'utf8')), { read }) }; }
    catch (err) { return { kind, resolved: false, detail: `${kind}: missing/unreadable evidence (${err.message})` }; }
  });
  gates.push({ kind: 'G-RULE0', ...evaluateDevelopmentRule0Gate(workspace, cfg, { check: checkRule0 }) });
  gates.push({ kind: 'G-PROFILE', ...readStandaloneHerdrGate(workspace, { read }) });
  gates.push({ kind: 'G-CONTAINMENT', ...checkContainment(workspace, { read }) });
  return gates;
}

/**
 * Lean prerequisites for the command-local/v1 daily-driver profile. It verifies
 * the canonical workspace markers and the required-service sources, and keeps
 * native child containment (G-CONTAINMENT) so owned-process safety is unchanged.
 * It deliberately omits G-WSL and G-PROFILE (standalone-Herdr owner): the local
 * profile must start without WSL, the Room broker or standalone Herdr. Optional
 * services carry no gate; when unavailable they are simply not started.
 */
export function evaluateCommandLocalWorkspace(workspace, cfg, { exists = existsSync } = {}) {
  if (typeof workspace !== 'string' || !workspace || !path.isAbsolute(workspace)) {
    return { resolved: false, detail: 'G-WORKSPACE-LOCAL: canonical workspace root required (absolute path)' };
  }
  const missing = ['STARQ.md', '00_STARQ_HQ'].filter((m) => !exists(path.join(workspace, m)));
  const requiredNames = cfg?.profile?.required_components ?? [];
  for (const c of cfg?.components ?? []) {
    if (!requiredNames.includes(c?.name)) continue;
    for (const rel of [c.entry, c.cwd].filter(Boolean)) {
      if (!exists(path.join(workspace, rel))) missing.push(rel);
    }
  }
  return missing.length
    ? { resolved: false, detail: `G-WORKSPACE-LOCAL: missing canonical inputs: ${missing.join(', ')}` }
    : { resolved: true, detail: 'G-WORKSPACE-LOCAL: canonical workspace markers and required-service sources present; no WSL/Room/standalone-Herdr dependency' };
}

/**
 * Gates for the command-local/v1 daily-driver profile.
 *
 * G-CONTAINMENT follows the tier the profile DECLARES, exactly as the full
 * profile does, because that is the tier its containment really runs at:
 *
 *   development  developmentContainmentGate - guardian binary and source pins,
 *                dependency-drift checks, and a real runtime containment probe
 *   anything else compatibilityGate - the RELEASE gate, which demands an
 *                independent exact-build proof (windows-job-compatibility.json,
 *                verifier != builder, full pass matrix). Unknown or missing tier
 *                falls here, so a malformed config can only get STRICTER.
 *
 * This used to hard-wire compatibilityGate, so a development-tier profile was
 * judged by a release artifact that does not exist yet: the Founder's one-click
 * start was REFUSED ("exact-build independent compatibility proof required") on
 * the real workspace, and every test passed because they inject a fake gate. The
 * release gate is unchanged and still unsatisfied; nothing here forges or skips it.
 */
export function readCommandLocalGates(workspace, cfg, {
  exists = existsSync,
  checkContainment = null,
  checkDevelopmentContainment = developmentContainmentGate,
  checkReleaseContainment = compatibilityGate,
} = {}) {
  const containment = checkContainment
    ?? (cfg?.profile?.tier === DEVELOPMENT_TIER ? checkDevelopmentContainment : checkReleaseContainment);
  return [
    { kind: 'G-WORKSPACE-LOCAL', ...evaluateCommandLocalWorkspace(workspace, cfg, { exists }) },
    { kind: 'G-CONTAINMENT', ...containment(workspace) },
  ];
}

export function readGates(workspace, { read = readFileSync, checkRule0 = checkWorkspaceRule0, containmentTier = 'release' } = {}) {
  const root = path.join(workspace, '00_STARQ_HQ', 'operations', 'starq-lifecycle', 'state');
  const gates = [['G-WSL', 'wsl-autostart-audit.json']].map(([kind, file]) => {
    try { return { kind, ...evaluateGate(kind, JSON.parse(read(path.join(root, file), 'utf8')), { read }) }; }
    catch (err) { return { kind, resolved: false, detail: `${kind}: missing/unreadable evidence (${err.message})` }; }
  });
  gates.push({ kind: 'G-RULE0', ...evaluateGate('G-RULE0', null, { workspace, checkRule0 }) });
  gates.push({ kind: 'G-PROFILE', ...readStandaloneHerdrGate(workspace, { read }) });
  gates.push({
    kind: 'G-CONTAINMENT',
    ...(containmentTier === 'development' ? developmentContainmentGate(workspace, { read }) : compatibilityGate(workspace, { read })),
  });
  return gates;
}
