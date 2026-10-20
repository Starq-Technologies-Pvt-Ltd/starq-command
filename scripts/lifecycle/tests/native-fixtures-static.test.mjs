/**
 * Static safety checks over the disposable native-fixture harness and fixtures.
 * Source text only: nothing here imports or executes the harness or a fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REQUIRED_CASES } from '../../../../herdr-floor/src/containment-config.mjs';

const DIR = path.resolve(import.meta.dirname, '../../../../starq-lifecycle/native-fixtures');
const src = (rel) => readFileSync(path.join(DIR, rel), 'utf8');
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"]*$/gm, '');

test('harness and fixtures contain no PID-addressed or tool-based process termination', () => {
  for (const rel of ['harness.mjs', 'fixtures/child.mjs', 'fixtures/parent.mjs']) {
    const c = code(src(rel));
    assert.doesNotMatch(c, /process\.kill\s*\(/, rel); assert.doesNotMatch(c, /taskkill|Stop-Process|wmic/i, rel);
    assert.doesNotMatch(c, /\.kill\s*\(/, rel); // node-pty kill() is replaced by a throwing stub, never called
  }
  const cs = src('fixtures/breakaway.cs');
  assert.doesNotMatch(cs, /OpenProcess|Process\.GetProcessById|\.Kill\(/); // terminates only its own suspended child by handle
});

test('the harness never writes the compatibility record and never touches Starq surfaces', () => {
  const c = code(src('harness.mjs'));
  assert.doesNotMatch(c, /windows-job-compatibility/);
  assert.doesNotMatch(c, /command-lifecycle|Start-Starq|Stop-Starq|Recover-Starq|room\.jsonl|send\.mjs|wsl(\.exe)?['"]|herdr\.exe|main\.mjs/i);
  assert.doesNotMatch(c, /schtasks|Register-ScheduledTask|reg(\.exe)? add|HKCU|HKLM|icacls/i);
});

test('authority gates: review by a non-builder, N-1 per case, N-2 bound to exact instance and action', () => {
  const c = src('harness.mjs');
  assert.match(c, /review\.reviewer === review\.builder/);
  assert.match(c, /n1\.review_sha256 !== sha\(reviewBytes\)/);
  assert.match(c, /!n1\.cases\.includes\(CASE\)/);
  assert.match(c, /n2\.decision_id === n1\.decision_id \|\| n2\.n1_decision_id !== n1\.decision_id/);
  assert.match(c, /g\?\.instance === instance && g\?\.action === action/);
  assert.match(c, /STARQ_AUTHORIZED_LIVE_TESTS/); assert.match(c, /fixtures never run beside a live stack/);
  // Every forced or OS-terminating action sits after an N-2 grant.
  const gated = c.slice(c.indexOf('async function n2Gated'));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf("force: true"));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf('f.child.closeTerminal(); // deliberately'));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf('process.exit(9)'));
  assert.equal((c.match(/force: true/g) ?? []).length, 1);
});

test('assignment refusal is never reported PASS, and every required case has a runner', () => {
  const c = src('harness.mjs');
  const body = c.slice(c.indexOf('async assignment_denied_no_resume'), c.indexOf('async explicit_force_empty_family'));
  assert.match(body, /record\('NOT_DEMONSTRATED'/); assert.doesNotMatch(body, /'PASS'/);
  for (const k of REQUIRED_CASES) assert.match(c, new RegExp(`async ${k}\\(`), k);
});

test('fixtures are self-bounded and inert', () => {
  const child = code(src('fixtures/child.mjs'));
  assert.match(child, /maxMs >= 1000 && maxMs <= 3_600_000/); assert.match(child, /setTimeout\(\(\) => end\('bound-exit'\), maxMs\)/);
  for (const rel of ['fixtures/child.mjs', 'fixtures/parent.mjs']) assert.doesNotMatch(code(src(rel)), /node:(net|http|https|dgram|tls)|fetch\(|createServer/, rel);
  assert.doesNotMatch(child, /setRawMode/);
  assert.match(code(src('fixtures/parent.mjs')), /childMax < 1000 \|\| childMax > 600_000/); // out-of-bound requests are refused
});
