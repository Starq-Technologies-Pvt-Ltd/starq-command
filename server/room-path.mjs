import fs from 'node:fs';
import path from 'node:path';

function comparablePath(value) {
  return path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase();
}

const missingCodes = new Set(['ENOENT', 'ENOTDIR']);

/** Pure decision helper so probe failures can be tested without filesystem faults. */
export function classifyPathIdentityProbes(leftPath, rightPath, {
  leftRealPath = null, rightRealPath = null,
  leftStat = null, rightStat = null,
  leftErrors = [], rightErrors = [],
} = {}) {
  if (comparablePath(leftPath) === comparablePath(rightPath)) return 'SAME';
  if (leftRealPath && rightRealPath && comparablePath(leftRealPath) === comparablePath(rightRealPath)) return 'SAME';
  if (leftStat && rightStat) {
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino ? 'SAME' : 'DIFFERENT';
  }
  const errors = [...leftErrors, ...rightErrors];
  if (errors.some((err) => !missingCodes.has(err?.code))) return 'UNKNOWN';
  if (errors.some((err) => missingCodes.has(err?.code))) return 'DIFFERENT';
  return 'UNKNOWN';
}

/** Classify lexical, real-path, and file-identity probes without fail-open errors. */
export function classifyFilesystemPath(left, right) {
  if (comparablePath(left) === comparablePath(right)) return 'SAME';
  const probe = (value) => {
    const result = { realPath: null, stat: null, errors: [] };
    try { result.realPath = fs.realpathSync(value); } catch (err) { result.errors.push(err); }
    try { result.stat = fs.statSync(value); } catch (err) { result.errors.push(err); }
    return result;
  };
  const a = probe(left);
  const b = probe(right);
  return classifyPathIdentityProbes(left, right, {
    leftRealPath: a.realPath,
    rightRealPath: b.realPath,
    leftStat: a.stat,
    rightStat: b.stat,
    leftErrors: a.errors,
    rightErrors: b.errors,
  });
}
