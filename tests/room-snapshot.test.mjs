import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { classifyPathIdentityProbes } from '../server/room-path.mjs';
import { readRoomSnapshot } from '../server/room-snapshot.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starq-room-snapshot-test-'));
  const ledger = path.join(root, 'agent-comms', 'room.jsonl');
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  return { root, ledger };
}

function cleanup(root) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), tempRoot, 'cleanup target must be the test-created temp directory');
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('snapshot returns stable raw records and exact byte hash without exposing Room text', () => {
  const f = fixture();
  try {
    const first = { brokerRecordVersion: 1, brokerSequence: 41, recordHash: 'hash-41', event: { body: 'text with } and "quoted" data' } };
    const second = { brokerRecordVersion: 1, brokerSequence: 42, recordHash: 'hash-42', event: { body: 'second record' } };
    const bytes = Buffer.from(`${JSON.stringify(first)}${JSON.stringify(second)}\r\n`, 'utf8');
    fs.writeFileSync(f.ledger, bytes);

    const snapshot = readRoomSnapshot(f.root);
    assert.equal(snapshot.state, 'OK');
    assert.equal(snapshot.stable, true);
    assert.equal(snapshot.parseStatus, 'OK');
    assert.equal(snapshot.byteLength, bytes.length);
    assert.equal(snapshot.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(snapshot.sha256Prefix, snapshot.sha256.slice(0, 16));
    assert.equal(snapshot.recordCount, 2);
    assert.equal(snapshot.tailSequence, 42);
    assert.equal(snapshot.tailHash, 'hash-42');
    assert.deepEqual(snapshot.records, [first, second]);
    assert.deepEqual(snapshot.recordLocations, [{ line: 1, recordIndex: 0 }, { line: 1, recordIndex: 1 }]);
    assert.equal(Object.hasOwn(snapshot, 'raw'), false);
  } finally {
    cleanup(f.root);
  }
});

test('snapshot rejects malformed tails instead of returning partial records', () => {
  const f = fixture();
  try {
    const valid = { brokerSequence: 1, recordHash: 'hash-1' };
    fs.writeFileSync(f.ledger, `${JSON.stringify(valid)}\n{broken\n`);
    const snapshot = readRoomSnapshot(f.root);
    assert.equal(snapshot.state, 'MALFORMED');
    assert.equal(snapshot.parseStatus, 'MALFORMED');
    assert.deepEqual(snapshot.records, []);
    assert.match(snapshot.reason, /line 2/);
    fs.writeFileSync(f.ledger, `\uFEFF${JSON.stringify(valid)}`);
    assert.equal(readRoomSnapshot(f.root).state, 'MALFORMED');
  } finally {
    cleanup(f.root);
  }
});

test('snapshot distinguishes empty and unavailable fixture ledgers', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.ledger, '');
    assert.equal(readRoomSnapshot(f.root).state, 'EMPTY');
    fs.rmSync(f.ledger);
    assert.equal(readRoomSnapshot(f.root).state, 'UNAVAILABLE');
  } finally {
    cleanup(f.root);
  }
});

test('production adapter refuses a COMMS_ROOM_PATH redirect before reading it', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.ledger, JSON.stringify({ brokerSequence: 1, recordHash: 'fixture' }));
    const moduleUrl = pathToFileURL(path.resolve('server/room-snapshot.mjs')).href;
    const script = `import { readRoomSnapshot } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(readRoomSnapshot()));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve('.'),
      env: { ...process.env, STARQ_WORKSPACE: 'D:/StarqTech', COMMS_ROOM_PATH: f.ledger },
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const snapshot = JSON.parse(child.stdout.trim());
    assert.equal(snapshot.state, 'UNAVAILABLE');
    assert.match(snapshot.reason, /does not match the canonical workspace ledger/);
  } finally {
    cleanup(f.root);
  }
});

test('explicit reader overrides are direct temp fixtures, never Room aliases or workspace paths', () => {
  const f = fixture();
  const alias = `${f.ledger}.alias`;
  try {
    fs.writeFileSync(f.ledger, JSON.stringify({ brokerSequence: 1, recordHash: 'fixture' }));
    fs.linkSync(f.ledger, alias);
    const aliased = readRoomSnapshot(f.root, { roomPath: alias, fixturePath: true });
    assert.equal(aliased.state, 'UNAVAILABLE');
    assert.match(aliased.reason, /Non-canonical Room path refused/);

    const workspaceFile = path.resolve('server/room-snapshot.mjs');
    const outsideTemp = readRoomSnapshot(f.root, { roomPath: workspaceFile, fixturePath: true });
    assert.equal(outsideTemp.state, 'UNAVAILABLE');
    assert.match(outsideTemp.reason, /Non-canonical Room path refused/);
  } finally {
    cleanup(f.root);
  }
});

test('fixture override cannot name or default to the configured canonical Room path', () => {
  const canonical = path.resolve('D:/StarqTech/agent-comms/room.jsonl');
  const explicitCanonical = readRoomSnapshot('D:/StarqTech', { roomPath: canonical, fixturePath: true });
  assert.equal(explicitCanonical.state, 'UNAVAILABLE');
  assert.match(explicitCanonical.reason, /Fixture Room path must be explicit, non-canonical/);

  const implicitCanonical = readRoomSnapshot('D:/StarqTech', { fixturePath: true });
  assert.equal(implicitCanonical.state, 'UNAVAILABLE');
  assert.match(implicitCanonical.reason, /Fixture Room path must be explicit, non-canonical/);
});

test('PM scratch reads require an explicit fixture and provenance checks guard Room aliases before hashing', () => {
  const pm = fs.readFileSync(path.resolve('server/pm-service.mjs'), 'utf8');
  assert.match(pm, /Scratch Room fixture path is not configured/);
  assert.match(pm, /fixturePath:\s*SCRATCH/);
  assert.match(pm, /if \(!SCRATCH && process\.env\.PM_ROOM_LEDGER\)/);

  const data = fs.readFileSync(path.resolve('server/data-service.mjs'), 'utf8');
  const aliasGuard = data.indexOf('classifyFilesystemPath(target, abs(workspaceRoot, CANONICAL.roomLedger))');
  const unknownGuard = data.indexOf("roomPathIdentity === 'UNKNOWN'");
  const genericHash = data.indexOf('live = sha256Prefix(target)');
  assert.ok(aliasGuard >= 0 && unknownGuard > aliasGuard && genericHash > unknownGuard,
    'Room path identity must be proven different before generic hashing');

  const adapter = fs.readFileSync(path.resolve('server/room-snapshot.mjs'), 'utf8');
  assert.match(adapter, /classifyFilesystemPath\(candidate, protectedPath\) === 'DIFFERENT'/);
  assert.match(adapter, /classifyFilesystemPath\(requestedPath, protectedPath\) !== 'DIFFERENT'/);
});

test('filesystem identity probe errors remain UNKNOWN, while a confirmed missing path is DIFFERENT', () => {
  const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
  const missing = Object.assign(new Error('not found'), { code: 'ENOENT' });
  const left = 'C:/temp/room-fixture.jsonl';
  const right = 'D:/workspace/agent-comms/room.jsonl';

  assert.equal(classifyPathIdentityProbes(left, right, {
    leftRealPath: left,
    leftStat: { dev: 1, ino: 11 },
    rightErrors: [denied],
  }), 'UNKNOWN');
  assert.equal(classifyPathIdentityProbes(left, right, {
    leftRealPath: left,
    leftStat: { dev: 1, ino: 11 },
    rightErrors: [missing],
  }), 'DIFFERENT');
  assert.equal(classifyPathIdentityProbes(left, right, {
    leftStat: { dev: 1, ino: 11 },
    rightStat: { dev: 1, ino: 11 },
  }), 'SAME');
});
