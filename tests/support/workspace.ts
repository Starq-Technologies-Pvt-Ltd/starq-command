/**
 * Workspace resolution for tests.
 *
 * Several suites legitimately read canonical sources that live OUTSIDE this
 * repository — the Room protocol modules, the baseline census. They used to
 * reach them by counting `../` levels from the test file or `process.cwd()`,
 * which only resolves when the checkout sits at exactly
 * `D:\StarqTech\00_STARQ_HQ\operations\starq-command`.
 *
 * That made the suite silently location-dependent: in a worktree, a fresh
 * clone or CI, four files failed to load at import time, taking ~98 tests with
 * them and reporting five phantom failures that look like code defects. A
 * builder running in the canonical directory saw green while a reviewer
 * running anywhere else saw red, and neither reading was wrong about its own
 * environment.
 *
 * Resolution goes through `server/paths.mjs` — the same resolver the services
 * use — so tests and runtime agree on where the workspace is, and an
 * unresolvable workspace says so plainly instead of throwing ENOENT on a path
 * nobody intended.
 */
import { resolveWorkspace } from '../../server/paths.mjs';

const resolved = resolveWorkspace();

/** The canonical workspace root, or null when it cannot be resolved. */
export const WORKSPACE_ROOT: string | null = resolved.root ?? null;

/** How the root was resolved — `STARQ_WORKSPACE`, `app-ancestry`, or a failure code. */
export const WORKSPACE_SOURCE: string = resolved.source;

/** True when canonical workspace sources are available to read. */
export const HAS_WORKSPACE = WORKSPACE_ROOT !== null;

/**
 * Absolute path to a canonical workspace source.
 * Throws with the resolution attempt rather than a mystery ENOENT.
 */
export function workspacePath(...segments: string[]): string {
  if (!WORKSPACE_ROOT) {
    throw new Error(
      `canonical workspace unresolved (${WORKSPACE_SOURCE}); set STARQ_WORKSPACE to the workspace root to run this suite`,
    );
  }
  return [WORKSPACE_ROOT, ...segments].join('/');
}
