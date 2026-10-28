/**
 * Static safety checks over the disposable native-fixture harness and fixtures.
 * Source text only: nothing here imports or executes the harness or a fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { importTestComponent, resolveTestComponentPath } from '../external-test-components.mjs';
const { REQUIRED_CASES } = await importTestComponent('herdr-floor', 'src/containment-config.mjs');
const { judge } = await importTestComponent('starq-lifecycle', 'native-fixtures/oracles.mjs');

const DIR = resolveTestComponentPath('starq-lifecycle', 'native-fixtures');
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
  assert.doesNotMatch(c, /command-lifecycle|Start-Starq|Stop-Starq|Recover-Starq|send\.mjs|wsl(\.exe)?['"]|herdr\.exe|main\.mjs/i);
  assert.doesNotMatch(c, /schtasks|Register-ScheduledTask|reg(\.exe)? add|HKCU|HKLM|icacls/i);
  // The Room ledger has one read-only path, used only by readLedger(); it is never written or mutated.
  assert.equal((c.match(/room\.jsonl/g) ?? []).length, 1);
  assert.equal((c.match(/\bLEDGER\b/g) ?? []).length, 2);
  assert.match(c, /const readLedger = \(\) => parseLedger\(readFileSync\(LEDGER, 'utf8'\)\);/);
  assert.doesNotMatch(c, /\b(writeFileSync|appendFileSync|createWriteStream|unlinkSync|renameSync|truncateSync|copyFileSync|rmSync)\(\s*LEDGER\b/);
  assert.doesNotMatch(c, /\bLEDGER\b[^\n]*\b(writeFileSync|appendFileSync|createWriteStream|unlinkSync|renameSync|truncateSync|copyFileSync|rmSync)\b/);
});

test('authority gates: review by a non-builder, N-1 per case, N-2 bound to exact instance and action', () => {
  // The Room authority rules live in room-authority.mjs; harness.mjs only calls them.
  const auth = src('room-authority.mjs');
  const c = src('harness.mjs');
  assert.match(auth, /if \(!REVIEWERS\.includes\(g\.sender\) \|\| g\.sender === BUILDER\) refuse\(/);
  assert.match(auth, /for\s*\(\s*const r of laterRecords\(ledger,\s*g\.seq\)\s*\)\s*\{\s*if\s*\(r\.event\?\.senderHandle !== g\.sender\)\s*continue;\s*if\s*\(machineLines\(r\.event\?\.body,\s*TAG\.REVIEW\)\.length\)\s*refuse/);
  assert.match(auth, /f\.review_seq !== String\(review\.seq\) \|\| f\.review_record_hash !== review\.hash/);
  assert.match(auth, /if \(f\.outcome !== 'ACCEPTED'\) refuse\(/);
  assert.match(auth, /if \(f\.accepted_sha256 !== acceptedPinsSha256\) refuse\(/);
  assert.match(auth, /if \(g\.seq <= review\.seq\) refuse/);
  assert.match(auth, /isFounderRecord\(g\.record\)\) refuse\(`N-1/);
  assert.match(auth, /if \(!f\.operator\) refuse\(/);
  assert.match(auth, /decodeN1Principal\(f\.principal\)/);
  assert.match(auth, /if \(!cases\.length \|\| new Set\(cases\)\.size !== cases\.length/);
  assert.match(auth, /cases\.some\(\(c\) => !REQUIRED_CASES\.includes\(c\)\)/);
  assert.match(auth, /isFounderRecord\(r\) && machineLines\(r\.event\?\.body, TAG\['N-1'\]\)\.some\(\(x\) => x\.review_seq === f\.review_seq\)/);
  assert.match(auth, /if \(g\.seq <= n1\.seq\) refuse/);
  assert.match(auth, /f\.n1_seq === String\(n1\.seq\) && f\.n1_record_hash === n1\.hash && f\.instance === instance && f\.action === action/);
  assert.match(auth, /if \(match\.length !== 1\) refuse/);
  assert.match(auth, /descriptorWrittenMs >= g\.receivedAtMs\) refuse/);
  assert.match(c, /if \(!n1\.cases\.includes\(CASE\)\) refuse/);
  assert.match(c, /STARQ_AUTHORIZED_LIVE_TESTS/); assert.match(c, /fixtures never run beside a live stack/);
  // Every forced or OS-terminating action sits after an N-2 grant.
  const gated = c.slice(c.indexOf('async function n2Gated'));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf("force: true"));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf('f.child.closeTerminal(); // deliberately'));
  assert.ok(gated.indexOf('awaitN2(') < gated.indexOf('process.exit(9)'));
  assert.equal((c.match(/force: true/g) ?? []).length, 1);
});

test('assignment refusal is never reported PASS, and every required case has a runner', () => {
  // With no evidence the U1 oracle must fail closed, never pass.
  const v = judge('assignment_denied_no_resume', {});
  assert.equal(v.outcome, 'FAIL');
  assert.ok(v.unmet.length > 0);
  const c = src('harness.mjs');
  const body = c.slice(c.indexOf('async assignment_denied_no_resume'), c.indexOf('async explicit_force_empty_family'));
  assert.match(body, /record\(\{/); assert.doesNotMatch(body, /'PASS'/);
  for (const k of REQUIRED_CASES) assert.match(c, new RegExp(`async ${k}\\(`), k);
});

test('fixtures are self-bounded and inert', () => {
  const child = code(src('fixtures/child.mjs'));
  assert.match(child, /maxMs >= 1000 && maxMs <= 3_600_000/); assert.match(child, /setTimeout\(\(\) => end\('bound-exit'\), maxMs\)/);
  for (const rel of ['fixtures/child.mjs', 'fixtures/parent.mjs']) assert.doesNotMatch(code(src(rel)), /node:(net|http|https|dgram|tls)|fetch\(|createServer/, rel);
  assert.doesNotMatch(child, /setRawMode/);
  assert.match(code(src('fixtures/parent.mjs')), /childMax < 1000 \|\| childMax > 600_000/); // out-of-bound requests are refused
});
