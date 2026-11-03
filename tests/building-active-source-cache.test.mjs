import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildingFingerprint } from '../server/building-service.mjs';
import { NEXUS_TASK_SOURCES, readBuildingSource } from '../server/building.mjs';

test('Building cache fingerprint tracks ERP updates in the canonical StarqNexus project source', (t) => {
  const priorDataRoot = process.env.STARQ_NEXUS_DATA_ROOT;
  const priorWorkspaceRoot = process.env.STARQ_NEXUS_WORKSPACE_ROOT;
  delete process.env.STARQ_NEXUS_DATA_ROOT;
  delete process.env.STARQ_NEXUS_WORKSPACE_ROOT;
  t.after(() => {
    if (priorDataRoot === undefined) delete process.env.STARQ_NEXUS_DATA_ROOT;
    else process.env.STARQ_NEXUS_DATA_ROOT = priorDataRoot;
    if (priorWorkspaceRoot === undefined) delete process.env.STARQ_NEXUS_WORKSPACE_ROOT;
    else process.env.STARQ_NEXUS_WORKSPACE_ROOT = priorWorkspaceRoot;
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-active-erp-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'Projects', 'StarqNexus', 'data');
  fs.mkdirSync(data, { recursive: true });
  const board = path.join(data, 'starq-erp-tasks.json');
  const initialContent = JSON.stringify({ tasks: [{ id: 'SERP-CACHE-1', status: 'planned' }] });
  const changedContent = JSON.stringify({ tasks: [{ id: 'SERP-CACHE-1', status: 'blocked' }] });
  assert.equal(changedContent.length, initialContent.length);
  fs.writeFileSync(board, initialContent);
  const fixedMtime = new Date('2026-11-03T00:00:00.000Z');
  fs.utimesSync(board, fixedMtime, fixedMtime);
  const initialStat = fs.statSync(board);

  const before = buildingFingerprint(root);
  fs.writeFileSync(board, changedContent);
  fs.utimesSync(board, fixedMtime, fixedMtime);
  const changedStat = fs.statSync(board);
  assert.equal(changedStat.size, initialStat.size);
  assert.equal(Math.trunc(changedStat.mtimeMs), Math.trunc(initialStat.mtimeMs));
  const after = buildingFingerprint(root);

  assert.notEqual(after, before);
  assert.match(after, /WORKSPACE_PROJECT_CHECKOUT/);
  assert.ok(after.includes(fs.realpathSync(board)));
  assert.ok(after.includes(crypto.createHash('sha256').update(changedContent).digest('hex')));
});

test('Building cache fingerprint refuses to hash a Nexus board symlink escaping its declared root', (t) => {
  const priorDataRoot = process.env.STARQ_NEXUS_DATA_ROOT;
  const priorWorkspaceRoot = process.env.STARQ_NEXUS_WORKSPACE_ROOT;
  delete process.env.STARQ_NEXUS_DATA_ROOT;
  delete process.env.STARQ_NEXUS_WORKSPACE_ROOT;
  t.after(() => {
    if (priorDataRoot === undefined) delete process.env.STARQ_NEXUS_DATA_ROOT;
    else process.env.STARQ_NEXUS_DATA_ROOT = priorDataRoot;
    if (priorWorkspaceRoot === undefined) delete process.env.STARQ_NEXUS_WORKSPACE_ROOT;
    else process.env.STARQ_NEXUS_WORKSPACE_ROOT = priorWorkspaceRoot;
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-board-cache-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'command-board-cache-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const outsideBoard = path.join(outside, 'hoadha-tasks.json');
  const sentinel = JSON.stringify({ tasks: [{ id: 'MUST-NOT-BE-READ' }] });
  fs.writeFileSync(outsideBoard, sentinel);
  const localData = path.join(root, 'starqNexus', 'data');
  fs.mkdirSync(localData, { recursive: true });
  fs.symlinkSync(outsideBoard, path.join(localData, 'hoadha-tasks.json'), 'file');

  const fingerprint = buildingFingerprint(root);
  const outsideHash = crypto.createHash('sha256').update(sentinel).digest('hex');
  const read = readBuildingSource(root, 'starqNexus/data/hoadha-tasks.json');

  assert.equal(read.state, 'UNREADABLE');
  assert.match(fingerprint, /UNREADABLE:REFUSED_ESCAPE/);
  assert.ok(!fingerprint.includes(outsideHash));
});

test('Building cache fingerprint uses the reader UNAVAILABLE state when workspace resolution is absent', () => {
  const fingerprint = buildingFingerprint(null);
  for (const source of NEXUS_TASK_SOURCES) {
    assert.equal(readBuildingSource(null, source).state, 'UNAVAILABLE');
    assert.ok(fingerprint.includes(`${source}=UNAVAILABLE`));
  }
});

test('Building cache fingerprint invalidates when the authoritative ERP decision state changes', () => {
  const authorized = {
    process_truth: {
      hold_state: {
        implementation: 'RESTART_AUTHORIZED',
        authority: 'DEC-109',
        effective: '2026-10-29',
      },
    },
  };
  const held = {
    process_truth: {
      hold_state: {
        implementation: 'ON_HOLD',
        authority: 'DEC-100',
        effective: '2026-09-28',
      },
    },
  };

  assert.notEqual(buildingFingerprint('C:/workspace', authorized), buildingFingerprint('C:/workspace', held));
});
