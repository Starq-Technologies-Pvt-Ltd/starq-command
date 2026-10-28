import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveExternalComponent } from '../server/external-components.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const testsRoot = path.join(root, 'lifecycle', 'tests');
const needs = new Map([
  ['development-readiness.test.mjs', ['starq-lifecycle', 'herdr-floor']],
  ['historical-closeout-handoff.test.mjs', ['herdr-floor']],
  ['native-fixtures-static.test.mjs', ['starq-lifecycle', 'herdr-floor']],
  ['observation-profile.test.mjs', ['starq-lifecycle', 'herdr-floor']],
  ['standalone-herdr.test.mjs', ['starq-lifecycle']],
]);
const files = (await readdir(testsRoot)).filter((name) => name.endsWith('.test.mjs')).sort();
const selected = [];
let skipped = 0;
for (const name of files) {
  const missing = (needs.get(name) ?? []).map((component) => resolveExternalComponent(component))
    .filter((component) => component.state !== 'AVAILABLE');
  if (missing.length) {
    skipped += 1;
    console.log(`SKIP ${name}: ${missing.map((component) => `${component.name}: ${component.reason}`).join('; ')}`);
  } else selected.push(path.join(testsRoot, name));
}
console.log(`Lifecycle suite: ${selected.length} runnable, ${skipped} companion-dependent suite(s) skipped; skips are not passes.`);
if (!selected.length) process.exit(0);
const result = spawnSync(process.execPath, ['--test', ...selected], { cwd: path.resolve(root, '..'), env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
