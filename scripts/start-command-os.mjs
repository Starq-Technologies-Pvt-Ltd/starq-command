/**
 * Compatibility alias for the one supported Starq Command lifecycle.
 * It must not create a second PM database, PM port, or Vite process.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'command-lifecycle.mjs'), 'start'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => process.exit(code ?? 1));
