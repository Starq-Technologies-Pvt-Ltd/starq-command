/**
 * Read-only path guard.
 *
 * Corrective fix for the Phase 1 blocker found in Room seq 8316: /api/raw
 * tested the RAW request string against the allowlist and then handed the
 * un-normalised string to path.join(), which resolved `../` sequences. A
 * request prefixed with an allowed path could therefore walk out of the
 * declared read-only surface and read arbitrary workspace files, including
 * _secrets/*.
 *
 * The rule this module enforces, in order, and why each step exists:
 *
 *   1. Reject NUL bytes. A NUL truncates the path in some native layers.
 *   2. Normalise Windows separators to `/`. On Windows a backslash IS a path
 *      separator, so `..\..\` would otherwise slip past a forward-slash check.
 *      Backslash cannot legally appear in a Windows filename, so collapsing it
 *      cannot corrupt a legitimate request.
 *   3. Reject absolute / drive-qualified / UNC paths. The request is always
 *      interpreted as workspace-relative, so an absolute request is either a
 *      bug or an escape attempt.
 *   4. Reject any `..` segment outright. Defence in depth: the containment
 *      check below is the real boundary, but refusing the segment means a
 *      traversal never reaches path.resolve at all.
 *   5. Resolve against the workspace root, then PROVE containment by comparing
 *      the resolved path against the resolved root. This is the boundary the
 *      original code was missing entirely.
 *   6. Resolve symlinks on both sides and re-prove containment, so a symlink
 *      inside an allowed directory cannot point outside it.
 *   7. Re-apply the declared allowlist to the NORMALISED relative path, so the
 *      "declared read-only surface" is enforced against a canonical value
 *      rather than against attacker-supplied text.
 *
 * Every step is a pure function of its inputs, so the regression tests can
 * attack this module directly instead of inferring safety from a live server.
 */
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ ok: true, resolved: string, relative: string, real: string }}
 *  | {{ ok: false, status: number, error: string }} GuardResult */

const REJECT = (status, error) => ({ ok: false, status, error });

/**
 * Normalise a requested workspace-relative path.
 * Returns a canonical `/`-separated path with `.` segments collapsed.
 */
export function normalizeRequested(requested) {
  if (typeof requested !== 'string' || requested.length === 0) {
    return { ok: false, status: 400, error: 'path parameter is required' };
  }
  if (requested.includes('\0')) {
    return REJECT(400, 'path contains a NUL byte');
  }

  // Step 2: on Windows a backslash is a separator. Collapse to '/'.
  const slashed = requested.replace(/\\/g, '/');

  // Step 3: absolute, drive-qualified or UNC paths are never workspace-relative.
  if (slashed.startsWith('/')) return REJECT(403, 'absolute paths are not permitted');
  if (/^[a-zA-Z]:/.test(slashed)) return REJECT(403, 'drive-qualified paths are not permitted');

  // Step 4: refuse traversal segments before they can be resolved.
  const segments = slashed.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) {
    return REJECT(403, 'path traversal is not permitted');
  }
  if (segments.length === 0) return REJECT(400, 'path resolves to the workspace root');

  return { ok: true, relative: segments.join('/') };
}

/** True when `child` is `parent` itself or genuinely nested beneath it. */
export function isContained(child, parent) {
  if (child === parent) return true;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

/**
 * Resolve a requested path against the declared read-only surface.
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot  absolute workspace root
 * @param {string} opts.requested      raw ?path= value from the request
 * @param {string[]} opts.allowed      declared read-only source prefixes
 * @returns {GuardResult}
 */
export function resolveReadOnlyTarget({ workspaceRoot, requested, allowed }) {
  if (!workspaceRoot) return REJECT(503, 'workspace unresolved');

  const norm = normalizeRequested(requested);
  if (!norm.ok) return norm;

  const root = path.resolve(workspaceRoot);

  // Step 5: resolve, then prove containment against the resolved root.
  // path.resolve performs full normalisation, so `.` segments are already gone.
  const resolved = path.resolve(root, norm.relative);
  if (!isContained(resolved, root)) {
    return REJECT(403, 'resolved path escapes the workspace root');
  }

  // Step 7: apply the declared allowlist to the NORMALISED relative path.
  const relative = path.relative(root, resolved);
  const normalisedRelative = relative.split(path.sep).join('/');
  const isDeclared = (allowed || []).some(
    (base) =>
      normalisedRelative === base ||
      normalisedRelative.startsWith(`${base}/`),
  );
  if (!isDeclared) {
    return REJECT(403, 'path outside the declared read-only surface');
  }

  // Step 6: resolve symlinks and re-prove containment, so a symlink inside an
  // allowed directory cannot point outside the surface. If the target does not
  // exist we leave `real` unset and let the caller report 404 — a missing file
  // is not an authorisation decision.
  //
  // Containment is proved TWICE here, against the DECLARED SURFACE rather than
  // merely the workspace root. A symlink inside an allowed directory that
  // points at another file elsewhere in the workspace still resolves inside the
  // root, so a root-only check would wave it through. Re-checking the resolved
  // target against the resolved form of each declared base is what actually
  // enforces "the declared read-only surface".
  let real = resolved;
  try {
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      let realRoot = root;
      try {
        realRoot = fs.realpathSync(root);
      } catch {
        realRoot = root;
      }
      if (!isContained(realPath, realRoot)) {
        return REJECT(403, 'resolved path escapes the workspace root via a link');
      }

      const realBases = (allowed || [])
        .map((base) => {
          const candidate = path.resolve(root, base);
          try {
            return fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
          } catch {
            return candidate;
          }
        })
        .filter(Boolean);

      const insideDeclaredSurface = realBases.some(
        (realBase) => realPath === realBase || isContained(realPath, realBase),
      );
      if (!insideDeclaredSurface) {
        return REJECT(403, 'resolved path escapes the declared read-only surface via a link');
      }

      real = realPath;
    }
  } catch {
    return REJECT(403, 'path could not be resolved safely');
  }

  return { ok: true, resolved, relative: normalisedRelative, real };
}
