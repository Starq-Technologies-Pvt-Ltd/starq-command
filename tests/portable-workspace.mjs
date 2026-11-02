/**
 * Workspace selection for Node tests only.
 *
 * Production resolution stays in server/paths.mjs: an explicit STARQ_WORKSPACE
 * that is not a real workspace is invalid, and the ancestry walk never invents
 * a root. Tests need a third outcome so a hosted checkout, which is not inside
 * the Founder's tree, can still exercise the same code.
 *
 * Order:
 *   1. STARQ_WORKSPACE when that directory has the canonical fingerprint.
 *   2. The ancestry walk, only when STARQ_WORKSPACE is unset.
 *   3. The in-repo fixture. It is not a company workspace and holds no live data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PORTABLE_WORKSPACE_FIXTURE = path.resolve(HERE, 'fixtures', 'portable-workspace');

function isWorkspaceRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, 'STARQ.md'))
      && fs.existsSync(path.join(dir, '00_STARQ_HQ'));
  } catch {
    return false;
  }
}

export function portableWorkspaceRoot() {
  const fromEnv = process.env.STARQ_WORKSPACE;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (isWorkspaceRoot(resolved)) return resolved;
  } else {
    let dir = path.resolve(HERE, '..');
    for (let i = 0; i < 12; i += 1) {
      if (isWorkspaceRoot(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return PORTABLE_WORKSPACE_FIXTURE;
}
