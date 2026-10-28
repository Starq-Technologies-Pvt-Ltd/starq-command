/**
 * Read the Room only through the sanctioned agent-comms reader. Production
 * callers use its configured canonical path; fixture roots are passed only by
 * isolated tests that create their own agent-comms/room.jsonl file.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CANONICAL, abs, resolveWorkspace } from './paths.mjs';
import { importExternalComponent } from './external-components.mjs';
import { classifyFilesystemPath } from './room-path.mjs';

const workspace = resolveWorkspace();
let reader = null;
const externalReader = await importExternalComponent('agent-comms', 'scripts/room.mjs');
reader = externalReader.module;
const loadError = externalReader.reason ?? null;

const unavailable = (reason) => ({
  state: 'UNAVAILABLE', stable: false, parseStatus: 'UNAVAILABLE', reason,
  byteLength: null, sha256: null, sha256Prefix: null, modifiedAt: null,
  recordCount: null, tailSequence: null, tailHash: null,
  records: [], recordLocations: [],
});

function samePath(left, right) {
  const comparable = (value) => path.resolve(value).replace(/^\\\\\\?\\/, '').toLowerCase();
  return comparable(left) === comparable(right);
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeTempFixturePath(candidate, protectedPaths) {
  try {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const requestedReal = fs.realpathSync(candidate);
    const requestedPath = path.resolve(candidate);
    const requestedCanonical = path.resolve(requestedReal);
    const tempCanonical = path.resolve(tempRoot);
    if (!pathWithin(tempCanonical, requestedCanonical)) return false;
    // Reject symlinks/junction aliases even when their target is in temp.
    if (!samePath(requestedPath, requestedCanonical)) return false;
    return protectedPaths.every((protectedPath) => classifyFilesystemPath(candidate, protectedPath) === 'DIFFERENT');
  } catch { return false; }
}

/**
 * Prove an exact raw byte prefix of the same Room path that readRoomSnapshot would read for
 * this root. Path validation is identical to readRoomSnapshot's default branch.
 */
export function readRoomRawPrefix(root = workspace.root, { recordCount, expectedSha16 } = {}) {
  if (!root) return { proven: false, byteLength: null, reason: 'Workspace unresolved' };
  if (!reader?.readRoomRawPrefix) return { proven: false, byteLength: null, reason: `Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.` };
  const expectedPath = abs(root, CANONICAL.roomLedger);
  const protectedPaths = workspace.root ? [abs(workspace.root, CANONICAL.roomLedger)] : [];
  if (workspace.root && samePath(root, workspace.root)) {
    if (!samePath(reader.ROOM_PATH, expectedPath)) {
      return { proven: false, byteLength: null, reason: 'Configured Room reader path does not match the canonical workspace ledger.' };
    }
    return reader.readRoomRawPrefix({ recordCount, expectedSha16 });
  }
  if (!safeTempFixturePath(expectedPath, protectedPaths)) {
    return { proven: false, byteLength: null, reason: 'Non-canonical Room path refused; only a direct temp fixture is supported.' };
  }
  return reader.readRoomRawPrefix({ roomPath: expectedPath, recordCount, expectedSha16 });
}

/**
 * Read the Room once for this root and return records, digests and the raw-prefix proof derived
 * from the same bytes. Path validation is identical to readRoomSnapshot / readRoomRawPrefix.
 */
export function readRoomBoundSnapshot(root = workspace.root, { recordCount, expectedSha16 } = {}) {
  const refused = (reason) => ({ ...unavailable(reason), rawPrefix: { proven: false, byteLength: null, reason } });
  if (!root) return refused('Workspace unresolved');
  if (!reader?.readRoomBoundSnapshot) return refused(`Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.`);
  const expectedPath = abs(root, CANONICAL.roomLedger);
  const protectedPaths = workspace.root ? [abs(workspace.root, CANONICAL.roomLedger)] : [];
  if (workspace.root && samePath(root, workspace.root)) {
    if (!samePath(reader.ROOM_PATH, expectedPath)) {
      return refused('Configured Room reader path does not match the canonical workspace ledger.');
    }
    return reader.readRoomBoundSnapshot({ recordCount, expectedSha16 });
  }
  if (!safeTempFixturePath(expectedPath, protectedPaths)) {
    return refused('Non-canonical Room path refused; only a direct temp fixture is supported.');
  }
  return reader.readRoomBoundSnapshot({ roomPath: expectedPath, recordCount, expectedSha16 });
}

/**
 * Read one snapshot. An explicit non-workspace root is used by fixture-backed
 * unit tests; a production caller cannot redirect the configured Room path.
 */
export function readRoomSnapshot(root = workspace.root, { roomPath: requestedPath = null, fixturePath = false } = {}) {
  if (!root) return unavailable(`Workspace unresolved; Room reader ${loadError ?? 'not loaded'}.`);

  const expectedPath = abs(root, CANONICAL.roomLedger);
  const protectedPaths = workspace.root ? [abs(workspace.root, CANONICAL.roomLedger)] : [];
  if (fixturePath && (!requestedPath || samePath(requestedPath, expectedPath) ||
      protectedPaths.some((protectedPath) => classifyFilesystemPath(requestedPath, protectedPath) !== 'DIFFERENT'))) {
    return unavailable('Fixture Room path must be explicit, non-canonical, and isolated under the OS temp directory.');
  }
  if (requestedPath && !samePath(requestedPath, expectedPath)) {
    if (!fixturePath || !safeTempFixturePath(requestedPath, [...protectedPaths, expectedPath]))
      return unavailable('Non-canonical Room path refused; only a direct temp fixture is supported.');
    if (!reader?.readRoomSnapshot) return unavailable(`Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.`);
    return reader.readRoomSnapshot({ roomPath: requestedPath });
  }
  if (workspace.root && samePath(root, workspace.root)) {
    if (!reader?.readRoomSnapshot) return unavailable(`Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.`);
    if (!samePath(reader.ROOM_PATH, expectedPath)) {
      return unavailable('Configured Room reader path does not match the canonical workspace ledger.');
    }
    return reader.readRoomSnapshot();
  }
  if (!safeTempFixturePath(expectedPath, protectedPaths))
    return unavailable('Non-canonical Room path refused; only a direct temp fixture is supported.');
  if (!reader?.readRoomSnapshot) return unavailable(`Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.`);
  return reader.readRoomSnapshot({ roomPath: expectedPath });
}
