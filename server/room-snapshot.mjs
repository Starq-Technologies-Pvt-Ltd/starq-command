/**
 * Read the Room only through the sanctioned agent-comms reader. Production
 * callers use its configured canonical path; fixture roots are passed only by
 * isolated tests that create their own agent-comms/room.jsonl file.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { CANONICAL, abs, resolveWorkspace } from './paths.mjs';
import { classifyFilesystemPath } from './room-path.mjs';

const workspace = resolveWorkspace();
const readerPath = workspace.root
  ? abs(workspace.root, 'agent-comms/scripts/room.mjs')
  : null;
let reader = null;
let loadError = null;
if (readerPath) {
  try { reader = await import(pathToFileURL(readerPath).href); }
  catch (err) { loadError = err.message; }
}

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
 * Read one snapshot. An explicit non-workspace root is used by fixture-backed
 * unit tests; a production caller cannot redirect the configured Room path.
 */
export function readRoomSnapshot(root = workspace.root, { roomPath: requestedPath = null, fixturePath = false } = {}) {
  if (!root) return unavailable(`Workspace unresolved; Room reader ${loadError ?? 'not loaded'}.`);
  if (!reader?.readRoomSnapshot) return unavailable(`Sanctioned Room reader unavailable: ${loadError ?? 'export missing'}.`);

  const expectedPath = abs(root, CANONICAL.roomLedger);
  const protectedPaths = workspace.root ? [abs(workspace.root, CANONICAL.roomLedger)] : [];
  if (fixturePath && (!requestedPath || samePath(requestedPath, expectedPath) ||
      protectedPaths.some((protectedPath) => classifyFilesystemPath(requestedPath, protectedPath) !== 'DIFFERENT'))) {
    return unavailable('Fixture Room path must be explicit, non-canonical, and isolated under the OS temp directory.');
  }
  if (requestedPath && !samePath(requestedPath, expectedPath)) {
    if (!fixturePath || !safeTempFixturePath(requestedPath, [...protectedPaths, expectedPath]))
      return unavailable('Non-canonical Room path refused; only a direct temp fixture is supported.');
    return reader.readRoomSnapshot({ roomPath: requestedPath });
  }
  if (workspace.root && samePath(root, workspace.root)) {
    if (!samePath(reader.ROOM_PATH, expectedPath)) {
      return unavailable('Configured Room reader path does not match the canonical workspace ledger.');
    }
    return reader.readRoomSnapshot();
  }
  if (!safeTempFixturePath(expectedPath, protectedPaths))
    return unavailable('Non-canonical Room path refused; only a direct temp fixture is supported.');
  return reader.readRoomSnapshot({ roomPath: expectedPath });
}
