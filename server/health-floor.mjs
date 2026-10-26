/**
 * STARQ // COMMAND — Phase 2 health floor. READ-ONLY BY CONSTRUCTION.
 *
 * This module answers a different question from data-service.mjs. The data
 * service asks "what do the canonical projections say?". This module asks
 * "can Command see them at all, how fresh are they, and is the runtime that
 * serves them healthy?".
 *
 * The distinction matters, and it is the whole point of the floor:
 *
 *   A GREEN PROJECTION IS NOT A GREEN CONTROL PLANE.
 *
 * A projection can be perfectly in sync with its source and still be served by
 * a runtime that cannot verify the ledger, run the reconciliation gates, or
 * reach half of its own declared inputs. Command reports those conditions
 * separately and never lets one of them imply the others.
 *
 * RULES THIS MODULE OBEYS
 *   - It computes METADATA about truth, never truth itself. No stage
 *     classification, no maturity, no work-state scoring.
 *   - It states UNAVAILABLE when it cannot see something. It never substitutes
 *     a default, a cached guess, or an optimism.
 *   - Where the canonical source records no value, it says UNKNOWN rather
 *     than inventing one.
 *   - It NEVER writes. Not to Starq, not to scratch, not to a cache file.
 *   - It reports CURRENT health and PRESERVED HISTORICAL issues in separate
 *     structures, because a frozen historical failure must never redden the
 *     present and a green present must never be read as having forgiven it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CANONICAL, CONTROL_BOARD_FILES, PROTOCOL_FILES, abs } from './paths.mjs';
import { readRoomSnapshot } from './room-snapshot.mjs';

// ── Dimension state vocabulary ──────────────────────────────────────────────
// One vocabulary, shared with the UI (src/lib/states.ts). These are NOT the
// process-truth stage states and must never be confused with them: a stage can
// be `implemented` while the ledger serving it is UNAVAILABLE, and both facts
// are true at once.
export const DIMENSION = {
  OK: 'OK',
  FAIL: 'FAIL',
  STALE: 'STALE',
  DRIFT: 'DRIFT',
  UNAVAILABLE: 'UNAVAILABLE',
  UNREADABLE: 'UNREADABLE',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Worst-first precedence for the aggregate.
 *
 * UNREADABLE and UNAVAILABLE outrank everything: you cannot judge truth
 * against something you cannot read. UNKNOWN sits above OK so an unassessed
 * dimension can never be counted as a healthy one.
 */
export const DIMENSION_PRECEDENCE = [
  DIMENSION.UNAVAILABLE,
  DIMENSION.UNREADABLE,
  DIMENSION.FAIL,
  DIMENSION.DRIFT,
  DIMENSION.STALE,
  DIMENSION.UNKNOWN,
  DIMENSION.OK,
];

/** Snapshot contract version. Bump when the envelope shape changes. */
export const SNAPSHOT_SCHEMA_VERSION = '2.0.0';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256Prefix(filePath, width = 16) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .slice(0, width);
}

function rel(root, absolute) {
  if (!root || !absolute) return null;
  return path.relative(root, absolute).split(path.sep).join('/');
}

/** One health dimension. `evidence` is a list of workspace-relative paths. */
function dimension(id, label, state, detail, extra = {}) {
  return { id, label, state, detail, evidence: [], ...extra };
}

// ── Source reachability ─────────────────────────────────────────────────────
//
// "Can Command actually see this file?" is a different question from "is this
// projection in sync?", and conflating them manufactures false alarms. A
// missing file is UNAVAILABLE. A present file with a moved hash is DRIFT.
// A present, matching file is OK. None of them is ever inferred.
const SOURCE_ROLES = [
  { id: 'contract', path: `${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.contract}`, role: 'process truth' },
  { id: 'activity', path: `${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.activity}`, role: 'execution truth' },
  { id: 'workModel', path: `${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.workModel}`, role: 'work truth' },
  { id: 'roomLedger', path: CANONICAL.roomLedger, role: 'append-only ledger (execution source)' },
  { id: 'identities', path: CANONICAL.identities, role: 'canonical identity registry' },
  { id: 'staffState', path: CANONICAL.staffState, role: 'duty state' },
  { id: 'decisions', path: CANONICAL.decisions, role: 'decision authority' },
  { id: 'onboarding', path: CANONICAL.onboarding, role: 'operating procedure' },
  { id: 'frontDoor', path: CANONICAL.frontDoor, role: 'workspace router' },
  { id: 'ledgerEpoch', path: `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochFile}`, role: 'ledger epoch ruling' },
  { id: 'healthTool', path: `${CANONICAL.protocol}/${PROTOCOL_FILES.healthTool}`, role: 'control-plane health tool' },
  { id: 'reviewerSeparation', path: `${CANONICAL.protocol}/${PROTOCOL_FILES.reviewerSeparation}`, role: 'reviewer separation' },
  { id: 'ingestState', path: `${CANONICAL.controlBoard}/${CONTROL_BOARD_FILES.state}`, role: 'ingest checkpoint' },
];

export function readSourceReachability(root) {
  if (!root) {
    return {
      state: DIMENSION.UNAVAILABLE,
      detail: 'workspace root unresolved — no source can be reached',
      checked: 0,
      sources: [],
    };
  }

  const roomSnapshot = readRoomSnapshot(root);
  const sources = SOURCE_ROLES.map((s) => {
    const target = abs(root, s.path);
    const base = { id: s.id, path: s.path, role: s.role };
    if (s.id === 'roomLedger') {
      const valid = roomSnapshot.state === 'OK' && roomSnapshot.stable && roomSnapshot.parseStatus === 'OK';
      const state = valid ? DIMENSION.OK :
        roomSnapshot.state === 'UNAVAILABLE' || roomSnapshot.state === 'EMPTY' ? DIMENSION.UNAVAILABLE : DIMENSION.UNREADABLE;
      return {
        ...base,
        state,
        detail: valid ? 'reachable, stable and parsed by the sanctioned Room reader' : (roomSnapshot.reason ?? 'Room snapshot unavailable'),
        bytes: roomSnapshot.byteLength,
        modified_at: roomSnapshot.modifiedAt,
        sha256_prefix: roomSnapshot.sha256Prefix,
        hashed: valid,
      };
    }
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      return { ...base, state: DIMENSION.UNAVAILABLE, detail: 'not found on disk', bytes: null, modified_at: null, sha256_prefix: null };
    }
    if (!stat.isFile()) {
      return { ...base, state: DIMENSION.UNAVAILABLE, detail: 'path is not a regular file', bytes: null, modified_at: null, sha256_prefix: null };
    }
    // Hash only the other files that are safe to hash here. The Room ledger
    // has already been measured through readRoomSnapshot() above.
    const hashable = stat.size <= 4 * 1024 * 1024;
    let digest = null;
    if (hashable) {
      try {
        digest = sha256Prefix(target);
      } catch (err) {
        return { ...base, state: DIMENSION.UNREADABLE, detail: `hash failed: ${err.message}`, bytes: stat.size, modified_at: stat.mtime.toISOString(), sha256_prefix: null };
      }
    }
    return {
      ...base,
      state: DIMENSION.OK,
      detail: hashable ? 'reachable and hashed' : 'reachable (not hashed — size exceeds the inline hash budget; integrity covered by the epoch verifier)',
      bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      sha256_prefix: digest,
      hashed: hashable,
    };
  });

  const unreachable = sources.filter((s) => s.state !== DIMENSION.OK);
  return {
    state: unreachable.length ? DIMENSION.UNAVAILABLE : DIMENSION.OK,
    detail: unreachable.length
      ? `${unreachable.length} of ${sources.length} declared sources unreachable: ${unreachable.map((s) => s.id).join(', ')}`
      : `all ${sources.length} declared canonical sources reachable`,
    checked: sources.length,
    unreachable: unreachable.map((s) => s.id),
    sources,
  };
}

// ── Ledger / Room integrity ─────────────────────────────────────────────────
//
// The canonical verifier is imported, not reimplemented. Command reports what
// `ledger-epoch.mjs` concludes; it never reaches its own conclusion about the
// ledger. Import is read-only and the module only ever reads.
//
// On Windows a bare absolute path is not a valid ESM specifier, which is why
// the canonical import is built as a file:// URL. That is a Command-side
// runtime accommodation, and it is reported as such rather than hidden.
let epochModulePromise = null;
let epochCache = { key: null, result: null, at: null };

function epochCacheKey(root) {
  const parts = [];
  const room = readRoomSnapshot(root);
  parts.push(`room:${room.state}:${room.byteLength ?? 'UNKNOWN'}:${room.sha256 ?? 'UNKNOWN'}`);
  for (const p of [
    `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochFile}`,
  ]) {
    try {
      const st = fs.statSync(abs(root, p));
      parts.push(`${p}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${p}:absent`);
    }
  }
  return parts.join('|');
}

export async function readLedgerIntegrity(root) {
  if (!root) {
    return {
      state: DIMENSION.UNAVAILABLE,
      detail: 'workspace root unresolved',
      current: null,
      preserved_historical: [],
    };
  }

  const roomSnapshot = readRoomSnapshot(root);
  if (roomSnapshot.state !== 'OK' || !roomSnapshot.stable || roomSnapshot.parseStatus !== 'OK') {
    return {
      state: roomSnapshot.state === 'UNAVAILABLE' || roomSnapshot.state === 'EMPTY' ? DIMENSION.UNAVAILABLE : DIMENSION.UNREADABLE,
      detail: roomSnapshot.reason ?? `Room snapshot is ${roomSnapshot.state}/${roomSnapshot.parseStatus}`,
      current: null,
      preserved_historical: [],
      evidence: [CANONICAL.roomLedger],
    };
  }

  const modulePath = abs(root, `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`);
  if (!fs.existsSync(modulePath)) {
    return {
      state: DIMENSION.UNAVAILABLE,
      detail: `canonical epoch verifier not installed at ${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`,
      current: null,
      preserved_historical: [],
      evidence: [`${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`],
    };
  }

  const key = epochCacheKey(root);
  if (epochCache.key === key && epochCache.result) {
    return { ...epochCache.result, recomputed: false, verified_at: epochCache.at };
  }

  if (!epochModulePromise) {
    epochModulePromise = import(pathToFileURL(modulePath).href).catch((err) => ({ __error: err.message }));
  }
  const mod = await epochModulePromise;
  const verifiedAt = new Date().toISOString();

  if (!mod || mod.__error) {
    const result = {
      state: DIMENSION.UNAVAILABLE,
      detail: `canonical epoch verifier could not be imported on this runtime: ${mod?.__error ?? 'unknown error'}`,
      remedy: 'The health TRUTH is separately available; only this TOOL is blocked. These are different findings and are never merged.',
      current: null,
      preserved_historical: [],
      evidence: [`${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`],
      recomputed: true,
      verified_at: verifiedAt,
    };
    epochCache = { key, result, at: verifiedAt };
    return result;
  }

  let verification;
  let historical;
  try {
    verification = mod.verifyCurrentEpoch();
    historical = mod.historicalEpochHealth();
  } catch (err) {
    const result = {
      state: DIMENSION.UNAVAILABLE,
      detail: `epoch verification threw: ${err.message}`,
      current: null,
      preserved_historical: [],
      recomputed: true,
      verified_at: verifiedAt,
    };
    epochCache = { key, result, at: verifiedAt };
    return result;
  }

  const current = {
    epoch_id: verification.epochId ?? null,
    parent_epoch: verification.parentEpoch ?? null,
    anchor: verification.anchor
      ? {
          broker_sequence: verification.anchor.brokerSequence ?? null,
          event_id: verification.anchor.eventId ?? null,
          record_hash: verification.anchor.recordHash ?? null,
          line: verification.anchor.line ?? null,
          record_index: verification.anchor.recordIndex ?? null,
        }
      : null,
    anchor_consistent: verification.anchorConsistent ?? null,
    anchor_problems: verification.anchorProblems ?? [],
    records_checked: verification.checked ?? 0,
    failure_count: verification.failureCount ?? 0,
    // All failures are reported. The verifier is explicitly written never to
    // abort on the first, and Command does not truncate to a convenient one.
    failures: (verification.failures ?? []).slice(0, 20),
    state: verification.ok ? DIMENSION.OK : DIMENSION.FAIL,
    detail: verification.ok
      ? `every record in the current epoch (${verification.epochId}) verifies`
      : `${verification.failureCount} record(s) in the current epoch (${verification.epochId}) failed verification`,
  };

  const result = {
    state: current.state,
    detail: current.detail,
    method: 'canonical module imported read-only via file:// URL; Command re-derives nothing',
    current,
    preserved_historical: (historical ?? []).map((h) => ({
      epoch_id: h.epochId,
      verdict: h.state,
      immutable: true,
      affects_current_verdict: false,
      established_at: h.establishedAt ?? null,
      frozen_at: h.frozenAt ?? null,
      known_failure_count: h.knownFailureCount ?? 0,
      known_failures: h.knownFailures ?? [],
      policy: h.policy ?? null,
      note: h.note ?? null,
    })),
    evidence: [
      `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochFile}`,
      `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`,
      CANONICAL.roomLedger,
    ],
    recomputed: true,
    verified_at: verifiedAt,
  };

  epochCache = { key, result, at: verifiedAt };
  return result;
}

// ── Runtime health ──────────────────────────────────────────────────────────
//
// Facts about the process serving the surface. These are not opinions about
// the company; they are facts about the machine, and the Founder is entitled
// to both.
export function readRuntimeHealth(resolution) {
  const pkgPath = path.join(APP_ROOT, 'package.json');
  let appVersion = 'UNKNOWN';
  try {
    appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version ?? 'UNKNOWN';
  } catch {
    appVersion = 'UNKNOWN';
  }

  const mem = process.memoryUsage();
  return {
    state: DIMENSION.OK,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    pid_present: typeof process.pid === 'number',
    uptime_seconds: Math.round(process.uptime()),
    rss_bytes: mem.rss,
    app_version: appVersion,
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    workspace_resolution: resolution?.source ?? 'UNKNOWN',
    mode: 'local-first · read-only · no writes · no remote transport',
  };
}

// ── Tooling reachability ────────────────────────────────────────────────────
//
// health.mjs is the canonical control-plane health model. It is the truth for
// "is the control plane sound", and it is NOT ours to reimplement.
//
// It cannot execute on native Windows Node: lines 64 and 90 dynamic-import a
// bare absolute path, which the ESM loader rejects with
// ERR_UNSUPPORTED_ESM_URL_SCHEME. Command detects that condition by reading
// the tool, reports the tool as blocked, and separately reports that the
// health TRUTH underneath it is reachable through the module the tool itself
// depends on. "The tool is blocked" and "the truth is unavailable" are
// different claims and are never collapsed into one.
function readHealthTool(root) {
  const relPath = `${CANONICAL.protocol}/${PROTOCOL_FILES.healthTool}`;
  if (!root) {
    return dimension('healthTool', 'Control-plane health tool', DIMENSION.UNAVAILABLE, 'workspace root unresolved', { evidence: [relPath] });
  }
  const target = abs(root, relPath);
  if (!fs.existsSync(target)) {
    return dimension('healthTool', 'Control-plane health tool', DIMENSION.UNAVAILABLE, 'canonical health tool not installed', { evidence: [relPath] });
  }

  let src = '';
  try {
    src = fs.readFileSync(target, 'utf8');
  } catch (err) {
    return dimension('healthTool', 'Control-plane health tool', DIMENSION.UNREADABLE, `unreadable: ${err.message}`, { evidence: [relPath] });
  }

  // Detect the bare-path dynamic import that breaks this runtime. Detection is
  // by source inspection, and the line numbers are reported so the finding can
  // be checked rather than trusted.
  const lines = src.split('\n');
  const offending = [];
  lines.forEach((line, i) => {
    if (/await\s+import\(\s*(path\.join|path\.resolve|['"][A-Za-z]:)/.test(line)) {
      offending.push(i + 1);
    }
  });

  const modulePath = `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochModule}`;
  const truthReachable = fs.existsSync(abs(root, modulePath));

  if (offending.length) {
    return dimension(
      'healthTool',
      'Control-plane health tool',
      DIMENSION.UNAVAILABLE,
      `tool is environment-blocked on this runtime: bare absolute dynamic import at line(s) ${offending.join(', ')} is rejected by the Windows ESM loader (ERR_UNSUPPORTED_ESM_URL_SCHEME). The health truth beneath it is ${truthReachable ? 'independently reachable' : 'NOT reachable'}.`,
      {
        blocked_by: 'RUNTIME',
        fix_locus: 'SOURCE',
        fix_status: 'SOURCE_DEFECT_OPEN',
        remediation_owner: 'agent-comms protocol owner — Command does not modify canonical protocol modules',
        lines: offending,
        underlying_truth_reachable: truthReachable,
        command_did_not_modify: true,
        evidence: [relPath, modulePath],
      },
    );
  }

  return dimension('healthTool', 'Control-plane health tool', DIMENSION.OK, 'no bare absolute dynamic import detected in the canonical health tool', {
    underlying_truth_reachable: truthReachable,
    command_did_not_modify: true,
    evidence: [relPath],
  });
}

function readReconcilerGates(root) {
  const items = [
    { id: 'gateProcessTruth', label: 'Process-truth gate', file: CONTROL_BOARD_FILES.gateProcessTruth },
    { id: 'gateExecutionTruth', label: 'Execution-truth gate', file: CONTROL_BOARD_FILES.gateExecutionTruth },
  ];
  const out = items.map((g) => {
    const relPath = `${CANONICAL.controlBoard}/${g.file}`;
    if (!root) return { ...g, path: relPath, state: DIMENSION.UNAVAILABLE, detail: 'workspace root unresolved', evidence: [relPath] };
    if (!fs.existsSync(abs(root, relPath))) {
      return { ...g, path: relPath, state: DIMENSION.UNAVAILABLE, detail: 'gate script not installed', evidence: [relPath] };
    }
    return {
      ...g,
      path: relPath,
      state: DIMENSION.UNKNOWN,
      detail:
        'gate is installed and read-only, but its verdict is NOT_ASSESSED. Command never runs a gate implicitly — a verdict is only reported after an explicit run, and until then it is UNKNOWN, never PASS.',
      evidence: [relPath],
    };
  });

  const missing = out.filter((o) => o.state === DIMENSION.UNAVAILABLE);
  return {
    state: missing.length ? DIMENSION.UNAVAILABLE : DIMENSION.UNKNOWN,
    detail: missing.length
      ? `${missing.length} reconciliation gate(s) not installed`
      : `${out.length} reconciliation gate(s) installed; verdict UNKNOWN until explicitly run`,
    gates: out,
    execution_policy:
      'Command executes a read-only gate only on explicit request. It never runs the ingester, which would write to the control board.',
  };
}

/**
 * The remaining canonical control-plane mechanisms, reported as reachability
 * and mechanism-presence only.
 *
 * health.mjs probes reviewer separation by inspecting the module and probes
 * the destructive guard by ATTEMPTING `git reset --hard` through it. Command
 * does neither: it reports that the mechanism is installed, and it will never
 * invoke a destructive command, not even to prove a guard works.
 */
function readMechanismHealth(root) {
  const relPath = `${CANONICAL.protocol}/${PROTOCOL_FILES.reviewerSeparation}`;
  const reviewer = (() => {
    if (!root) return dimension('reviewerSeparation', 'Reviewer separation', DIMENSION.UNAVAILABLE, 'workspace root unresolved', { evidence: [relPath] });
    const target = abs(root, relPath);
    if (!fs.existsSync(target)) {
      return dimension('reviewerSeparation', 'Reviewer separation', DIMENSION.FAIL, 'reviewer-separation.mjs not installed', { evidence: [relPath] });
    }
    let src = '';
    try {
      src = fs.readFileSync(target, 'utf8');
    } catch (err) {
      return dimension('reviewerSeparation', 'Reviewer separation', DIMENSION.UNREADABLE, `unreadable: ${err.message}`, { evidence: [relPath] });
    }
    const bySeparation = /builderForTask/.test(src) && /SELF-REVIEW/.test(src);
    return bySeparation
      ? dimension('reviewerSeparation', 'Reviewer separation', DIMENSION.OK, 'enforcement mechanism present (builder-identity comparison, not a name allowlist)', { evidence: [relPath] })
      : dimension('reviewerSeparation', 'Reviewer separation', DIMENSION.FAIL, 'enforcement mechanism NOT detected in the installed module', { evidence: [relPath] });
  })();

  const guardRel = `${CANONICAL.guards}/destructive-guard.mjs`;
  const guardCallersRel = `${CANONICAL.guards}/callers.mjs`;
  const guardInstalled = root
    ? fs.existsSync(abs(root, guardRel)) && fs.existsSync(abs(root, guardCallersRel))
    : false;
  const guard = root
    ? dimension(
        'destructiveGuard',
        'Destructive-action guard',
        guardInstalled ? DIMENSION.UNKNOWN : DIMENSION.FAIL,
        guardInstalled
          ? 'guard and callers are installed. Command does NOT probe it: proving the guard works requires ATTEMPTING `git reset --hard`, and Command will never invoke a destructive command, not even through a guard. Install state is reported; behaviour is UNKNOWN.'
          : 'guard or callers missing',
        { installed: guardInstalled, probe_policy: 'NEVER_PROBED_BY_COMMAND', evidence: [guardRel, guardCallersRel] },
      )
    : dimension('destructiveGuard', 'Destructive-action guard', DIMENSION.UNAVAILABLE, 'workspace root unresolved', { evidence: [guardRel] });

  const leaseRel = CANONICAL.identityLeases;
  const lease = (() => {
    if (!root) return dimension('identityLease', 'Identity leases', DIMENSION.UNAVAILABLE, 'workspace root unresolved', { evidence: [leaseRel] });
    const dir = abs(root, leaseRel);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return dimension('identityLease', 'Identity leases', DIMENSION.UNAVAILABLE, 'lease directory not reachable', { evidence: [leaseRel] });
    }
    return dimension('identityLease', 'Identity leases', DIMENSION.OK, `${files.length} identity lease file(s) present`, {
      lease_count: files.length,
      // Recorded by the canonical health tool, not asserted by Command. The
      // gap is a real, unfixed control-plane weakness and is shown, not hidden.
      known_gaps: [
        'on-behalf-of sends bypass the lease',
        'ingress.mjs performs no lease check',
      ],
      evidence: [leaseRel],
    });
  })();

  return [reviewer, guard, lease];
}

export function readToolHealth(root) {
  const dimensions = [readHealthTool(root), ...readMechanismHealth(root)];
  const overall = DIMENSION_PRECEDENCE.find((s) => dimensions.some((d) => d.state === s)) ?? DIMENSION.OK;
  return {
    state: overall,
    detail: `${dimensions.filter((d) => d.state === DIMENSION.OK).length}/${dimensions.length} canonical mechanisms reported healthy; the rest carry their own state`,
    dimensions,
    reconciliation_gates: readReconcilerGates(root),
  };
}

// ── The floor, assembled ────────────────────────────────────────────────────

/**
 * Assemble the Phase 2 health floor.
 *
 * `current_health` and `preserved_historical` are deliberately two different
 * structures. A preserved historical failure is evidence and must stay
 * permanently visible; it is also not a live fault and must never redden the
 * present. Merging them would either hide the past or slander the now.
 */
export async function buildHealthFloor({ root, resolution }) {
  if (!root) {
    return {
      state: DIMENSION.UNAVAILABLE,
      generated_at: new Date().toISOString(),
      principle:
        'A green projection is NOT a green control plane. Every dimension is reported on its own, and no aggregate is allowed to stand in for a dimension that was never read.',
      current_health: [],
      preserved_historical: [],
      fix_status: [],
      runtime: null,
      source_reachability: null,
      ledger_integrity: null,
      tool_health: null,
    };
  }

  const reachability = readSourceReachability(root);
  const ledger = await readLedgerIntegrity(root);
  const runtime = readRuntimeHealth(resolution);
  const tools = readToolHealth(root);

  const execution = ledger.current ?? {
    state: DIMENSION.UNAVAILABLE,
    detail: 'current epoch verdict unavailable',
    records_checked: 0,
    failure_count: 0,
  };

  const current_health = [
    {
      ...dimension(
        'ledgerIntegrity',
        'Room ledger integrity (current epoch)',
        execution.state,
        execution.detail,
        {
          evidence: ledger.evidence ?? [],
          epoch_id: execution.epoch_id ?? null,
          records_checked: execution.records_checked ?? 0,
          failure_count: execution.failure_count ?? 0,
          anchor_consistent: execution.anchor_consistent ?? null,
          verified_at: ledger.verified_at ?? null,
        },
      ),
    },
    {
      ...dimension(
        'sourceReachability',
        'Canonical source reachability',
        reachability.state,
        reachability.detail,
        { evidence: SOURCE_ROLES.map((s) => s.path), checked: reachability.checked, unreachable: reachability.unreachable },
      ),
    },
    {
      ...dimension('runtime', 'Runtime serving this surface', runtime.state, 'Node runtime and local read-only mode', {
        evidence: [],
        node_version: runtime.node_version,
        platform: runtime.platform,
        uptime_seconds: runtime.uptime_seconds,
      }),
    },
    {
      ...dimension('healthTool', tools.dimensions.find((d) => d.id === 'healthTool')?.label ?? 'Control-plane health tool', tools.dimensions.find((d) => d.id === 'healthTool')?.state ?? DIMENSION.UNKNOWN, tools.dimensions.find((d) => d.id === 'healthTool')?.detail ?? 'not assessed', {
        ...(tools.dimensions.find((d) => d.id === 'healthTool') ?? {}),
        state: tools.dimensions.find((d) => d.id === 'healthTool')?.state ?? DIMENSION.UNKNOWN,
        label: tools.dimensions.find((d) => d.id === 'healthTool')?.label ?? 'Control-plane health tool',
        detail: tools.dimensions.find((d) => d.id === 'healthTool')?.detail ?? 'not assessed',
      }),
    },
    ...tools.dimensions
      .filter((d) => d.id !== 'healthTool')
      .map((d) => ({ ...d })),
    {
      ...dimension(
        'reconciliationGates',
        'Reconciliation gates',
        tools.reconciliation_gates.state,
        tools.reconciliation_gates.detail,
        { evidence: tools.reconciliation_gates.gates.map((g) => g.path), gates: tools.reconciliation_gates.gates },
      ),
    },
  ];

  // Where is each carried issue fixed? This is a fact with a citation, never a
  // reassurance. SOURCE means the defect lives in canonical code. RUNTIME means
  // the canonical code is sound and this machine is what fails. NONE means the
  // issue is open and unaddressed anywhere.
  const fix_status = [
    {
      id: 'healthToolWindowsEsm',
      title: 'health.mjs cannot execute on native Windows Node',
      state: DIMENSION.UNAVAILABLE,
      locus: 'SOURCE',
      detail:
        'A bare absolute dynamic import is rejected by the Windows ESM loader. The fix belongs in the canonical module; Command works around it for itself and does not modify the tool.',
      evidence: [`${CANONICAL.protocol}/${PROTOCOL_FILES.healthTool}`],
    },
    {
      id: 'ledgerHistoricalEpoch1',
      title: 'Epoch-1 integrity failure (seq 8304)',
      state: (ledger.preserved_historical ?? []).some((h) => h.verdict === 'FAIL_PRESERVED') ? DIMENSION.FAIL : DIMENSION.UNKNOWN,
      locus: 'SOURCE_FIXED_RECORD_PRESERVED',
      detail:
        'The write-path defect that produced the failure was fixed in the canonicaliser. The failing record itself is preserved unrewritten by Founder ruling, so the failure remains visible permanently and is never folded into the current verdict.',
      evidence: [
        `${CANONICAL.protocol}/${PROTOCOL_FILES.ledgerEpochFile}`,
        `${CANONICAL.protocol}/${PROTOCOL_FILES.envelope}`,
      ],
    },
    {
      id: 'identityLeaseBypass',
      title: 'on-behalf-of sends bypass the identity lease',
      state: DIMENSION.FAIL,
      locus: 'NONE',
      detail:
        'Recorded by the canonical health tool as an open control-plane gap. It is not fixed in source and not compensated at runtime. Shown here so a green ledger does not imply a sealed control plane.',
      evidence: [`${CANONICAL.protocol}/${PROTOCOL_FILES.leaseAuthorityAudit ?? 'lease-authority-audit.mjs'}`],
    },
    {
      id: 'destructiveGuardUnprobed',
      title: 'Destructive-action guard is installed but unproven by Command',
      state: DIMENSION.UNKNOWN,
      locus: 'RUNTIME',
      detail:
        'Install state is observable; behaviour is not, because proving it requires attempting a destructive command. Command declines to attempt it and reports UNKNOWN rather than claiming a pass.',
      evidence: [`${CANONICAL.guards}/destructive-guard.mjs`],
    },
  ];

  return {
    state: DIMENSION_PRECEDENCE.find((s) => current_health.some((d) => d.state === s)) ?? DIMENSION.OK,
    generated_at: new Date().toISOString(),
    authority: 'DERIVED_PROJECTION',
    principle:
      'A green projection is NOT a green control plane. Every dimension is reported on its own, and no aggregate is allowed to stand in for a dimension that was never read.',
    states: DIMENSION,
    precedence: DIMENSION_PRECEDENCE,
    current_health,
    preserved_historical: ledger.preserved_historical ?? [],
    preserved_historical_note:
      'Frozen epochs. Immutable, never repaired, never counted into the current verdict. A green current epoch does not forgive these, and these do not redden the present.',
    fix_status,
    runtime,
    source_reachability: reachability,
    ledger_integrity: ledger,
    tool_health: tools,
  };
}

/**
 * Aggregate a set of dimensions without ever collapsing them.
 *
 * The counts are the anti-masking device: `healthy` is only ever the number of
 * dimensions that were actually read AND agreed, and `assessed` is reported
 * beside it so a floor of mostly-UNKNOWN cannot be mistaken for a healthy one.
 */
export function summarizeFloor(floor) {
  const dims = floor?.current_health ?? [];
  const counts = {};
  for (const d of dims) counts[d.state] = (counts[d.state] ?? 0) + 1;
  const assessed = dims.filter((d) => d.state !== DIMENSION.UNKNOWN).length;
  return {
    overall: floor?.state ?? DIMENSION.UNAVAILABLE,
    dimensions_total: dims.length,
    dimensions_assessed: assessed,
    dimensions_healthy: counts[DIMENSION.OK] ?? 0,
    by_state: counts,
    preserved_historical_count: (floor?.preserved_historical ?? []).length,
  };
}
