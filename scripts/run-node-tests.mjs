import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveWorkspace } from '../server/paths.mjs';
import { PORTABLE_WORKSPACE_FIXTURE } from '../tests/portable-workspace.mjs';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsRoot, '..');
const testsRoot = path.join(repoRoot, 'tests');
const files = (await readdir(testsRoot)).filter((name) => name.endsWith('.test.mjs')).sort();
if (!files.length) {
  console.error('No Node built-in test files found under tests/.');
  process.exit(2);
}
/*
  One file at a time.

  Several of these suites are real integration tests: they spawn an actual PM
  service and bind a loopback port. A scratch PM instance may only use
  5190-5199 (server/pm-service.mjs), so six such files running in parallel
  across forked workers contend for ten ports and fail on binding rather than
  on behaviour. Serial execution is slower and honest; parallel execution was
  producing failures that did not reproduce when a file was run on its own.
*/
const env = { ...process.env };
const workspace = resolveWorkspace();
if (!workspace.root) {
  // A hosted checkout has no canonical tree. An invalid STARQ_WORKSPACE does not
  // fall through to ancestry, so substitute the in-repo fixture for this process
  // only. Never invent a machine path.
  env.STARQ_WORKSPACE = PORTABLE_WORKSPACE_FIXTURE;
  console.log(`Canonical workspace unresolved (${workspace.source}); Node tests use ${PORTABLE_WORKSPACE_FIXTURE}`);
}
console.log(`Running ${files.length} Node built-in test files (serially; these bind real ports).`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files.map((name) => path.join(testsRoot, name))], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
