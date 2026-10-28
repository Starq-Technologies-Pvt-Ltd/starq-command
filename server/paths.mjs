/**
 * Canonical Starq path resolution — READ-ONLY.
 *
 * STARQ // COMMAND is a DERIVED_PROJECTION. It never writes to any canonical
 * source. This module resolves where those sources live and nothing else.
 *
 * Resolution order:
 *   1. STARQ_WORKSPACE env var (canonical override used by the control board's
 *      own scripts — keeps us consistent with starq_paths.py).
 *   2. Walk up from this file until a directory containing the canonical
 *      fingerprint (STARQ.md + 00_STARQ_HQ) is found.
 *
 * If neither resolves, the data service reports UNAVAILABLE. It never guesses
 * a path and never invents truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

/** Fingerprint that identifies the Starq workspace root unambiguously. */
function isWorkspaceRoot(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'STARQ.md')) &&
      fs.existsSync(path.join(dir, '00_STARQ_HQ'))
    );
  } catch {
    return false;
  }
}

export function resolveWorkspace() {
  const fromEnv = process.env.STARQ_WORKSPACE;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    return isWorkspaceRoot(resolved)
      ? { root: resolved, source: 'STARQ_WORKSPACE' }
      : { root: null, source: 'STARQ_WORKSPACE_INVALID', attempted: resolved };
  }

  let dir = APP_ROOT;
  for (let i = 0; i < 12; i += 1) {
    if (isWorkspaceRoot(dir)) return { root: dir, source: 'app-ancestry' };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { root: null, source: 'UNRESOLVED' };
}

/** Canonical source locations, relative to the workspace root. */
export const CANONICAL = {
  frontDoor: 'STARQ.md',
  onboarding: '00_STARQ_HQ/operations/ONBOARDING.md',
  decisions: '00_STARQ_HQ/decisions.json',
  identities: 'agent-comms/protocol/v1/identities.json',
  staffState: 'agent-comms/protocol/v1/staff-state.json',
  roomLedger: 'agent-comms/room.jsonl',
  controlBoard: '00_STARQ_HQ/operations/starqerp-control-board',
  // Phase 2 — the control-plane health model and its evidence.
  protocol: 'agent-comms/protocol/v1',
  identityLeases: 'agent-comms/cursors/identity-leases',
  guards: '00_STARQ_HQ/infrastructure/guards',
  // Herdr Floor — the approved launch manifest. Read-only here, and read only
  // for the DECLARED launch facts (seat id, runtime, launchable, startup
  // policy). Live PID and process state are NOT in this file and are never
  // taken from it; they come from the broker at render time.
  herdrManifest: '00_STARQ_HQ/operations/herdr-floor/manifest.json',
  // Company OS seat registry — the machine-readable PROJECTION of the
  // human-readable governance source at the workspace root. Read-only, and
  // deliberately NOT added to `read_only_sources`: that list is the /api/raw
  // evidence-drawer ALLOWLIST, not an inventory of what the service can see, and
  // nothing asked to serve the registry's bytes.
  companySeats: 'company-seats.json',
  pmBoardDb: '00_STARQ_HQ/operations/starq-command/data/pm-operating.db',
  pmBoardLegacyDb: '00_STARQ_HQ/operations/starq-command/data/pm-board.db',
  pmProjects: '00_STARQ_HQ/operations/starq-command/board/pm-projects.json',
};

export const CONTROL_BOARD_FILES = {
  contract: 'contract.json',
  activity: 'activity.json',
  workModel: 'command_work_model.json',
  reclassification: 'serp_reclassification.json',
  state: 'activity_state.json',
  // Read-only reconciliation gates. Command never runs these implicitly; a
  // gate is only executed on an explicit Founder-visible request.
  gateProcessTruth: 'reconcile_control_board.py',
  gateExecutionTruth: 'reconcile_activity.py',
  ingester: 'ingest_room_activity.py',
};

/**
 * Canonical control-plane health modules.
 *
 * These are READ as evidence and, for `ledgerEpochModule`, IMPORTED read-only
 * so Command reports the canonical integrity verdict instead of re-deriving
 * one. Command never modifies them.
 */
export const PROTOCOL_FILES = {
  healthTool: 'health.mjs',
  ledgerEpochFile: 'ledger-epoch.json',
  ledgerEpochModule: 'ledger-epoch.mjs',
  envelope: 'envelope.mjs',
  hashChain: 'hashChain.mjs',
  reviewerSeparation: 'reviewer-separation.mjs',
  identityLease: 'identityLease.mjs',
};

export function abs(root, rel) {
  return path.join(root, rel);
}
