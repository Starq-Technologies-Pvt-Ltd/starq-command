/**
 * The acceptance harness's stray-process scan must tell its own invoker chain
 * apart from genuinely surviving Command children (Room #17430, blocker 2),
 * without ever excluding a process because of its image name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestorsOf, selectStrays } from '../../acceptance/stray-processes.mjs';

const WS = 'D:/StarqTech/_scratch/accept-x';
const row = (pid, ppid, name, cmd) => ({ pid, ppid, name, cmd });
// pwsh (1) -> node harness (2) --ws WS ; unrelated explorer (9)
const invoker = [
  row(9, 0, 'explorer.exe', 'C:\Windows\explorer.exe'),
  row(1, 9, 'pwsh.exe', `pwsh -Command node harness.mjs full --ws ${WS}`),
  row(2, 1, 'node.exe', `node harness.mjs full --ws ${WS}`),
];
const opts = { workspace: WS, harnessPid: 2 };

test('the runner and the shell that invoked it are not strays', () => {
  assert.deepEqual(selectStrays(invoker, opts), []);
  assert.deepEqual(ancestorsOf(2, invoker), [1, 9]);
});

test('a surviving Command child IS a stray, whatever its image name', () => {
  const table = [...invoker,
    row(40, 7, 'node.exe', `${WS}/00_STARQ_HQ/operations/starq-command/scripts/lifecycle-child.mjs`),
    row(41, 40, 'node.exe', `${WS}/.../server/pm-service.mjs`),
    row(42, 1, 'pwsh.exe', `pwsh something --db ${WS}/data/pm-operating.db`)];
  assert.deepEqual(selectStrays(table, opts).map((p) => p.pid), [40, 41, 42]);
});

test('a SIBLING node.exe or pwsh.exe naming the workspace is still a stray (no name exclusion)', () => {
  const table = [...invoker, row(50, 9, 'node.exe', `node leftover.mjs ${WS}`), row(51, 9, 'pwsh.exe', `pwsh -File x.ps1 ${WS}`)];
  assert.deepEqual(selectStrays(table, opts).map((p) => p.pid), [50, 51]);
});

test('the scan\'s own probe is exempt, and only that pid', () => {
  const table = [...invoker, row(60, 2, 'powershell.exe', `Get-CimInstance ... ${WS}`), row(61, 2, 'powershell.exe', `Get-CimInstance ... ${WS}`)];
  assert.deepEqual(selectStrays(table, { ...opts, probePid: 60 }).map((p) => p.pid), [61]);
});

test('matching is by workspace path, case-insensitively, and unrelated processes are ignored', () => {
  const table = [...invoker, row(70, 9, 'node.exe', `node X ${WS.toUpperCase()}`), row(71, 9, 'node.exe', 'node other-project.mjs')];
  assert.deepEqual(selectStrays(table, opts).map((p) => p.pid), [70]);
});

test('an ancestry cycle or a missing parent cannot hang or exempt anything extra', () => {
  const cyc = [row(2, 3, 'node.exe', `node ${WS}`), row(3, 2, 'pwsh.exe', `pwsh ${WS}`), row(4, 99, 'node.exe', `node ${WS}`)];
  assert.deepEqual(ancestorsOf(2, cyc), [3]);
  assert.deepEqual(selectStrays(cyc, opts).map((p) => p.pid), [4]);
});
