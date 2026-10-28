import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsRoot, '..');
const testsRoot = path.join(repoRoot, 'tests');
const files = (await readdir(testsRoot)).filter((name) => name.endsWith('.test.mjs')).sort();
if (!files.length) {
  console.error('No Node built-in test files found under tests/.');
  process.exit(2);
}
console.log(`Running ${files.length} Node built-in test files.`);
const result = spawnSync(process.execPath, ['--test', ...files.map((name) => path.join(testsRoot, name))], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
