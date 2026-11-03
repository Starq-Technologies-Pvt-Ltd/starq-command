import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readBuildingSource } from '../server/building.mjs';
import { buildingFingerprint } from '../server/building-service.mjs';

test('Building reads the canonical workspace StarqNexus ERP board before the historical fallback', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-active-erp-board-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectData = path.join(root, 'Projects', 'StarqNexus', 'data');
  const legacyData = path.join(root, 'starqNexus', 'data');
  fs.mkdirSync(projectData, { recursive: true });
  fs.mkdirSync(legacyData, { recursive: true });
  fs.writeFileSync(path.join(projectData, 'starq-erp-tasks.json'), JSON.stringify({ tasks: [{ id: 'SERP-ACTIVE-1', status: 'in_progress' }] }));
  fs.writeFileSync(path.join(legacyData, 'starq-erp-tasks.json'), JSON.stringify({ tasks: [{ id: 'SERP-LEGACY-1', status: 'done' }] }));
  fs.writeFileSync(path.join(legacyData, 'hoadha-tasks.json'), JSON.stringify({ tasks: [{ id: 'HOADHA-PRESERVED-1', status: 'planned' }] }));

  const source = readBuildingSource(root, 'starqNexus/data/starq-erp-tasks.json');

  assert.equal(source.state, 'AVAILABLE');
  assert.equal(source.source_kind, 'NEXUS_COMPANY_BOARD');
  assert.equal(source.source_role, 'WORKSPACE_PROJECT_CHECKOUT');
  assert.equal(source.source_root, fs.realpathSync(projectData));
  assert.deepEqual(source.data.tasks.map((task) => task.id), ['SERP-ACTIVE-1']);
  assert.match(source.sha256, /^[a-f0-9]{64}$/);

  const hoadha = readBuildingSource(root, 'starqNexus/data/hoadha-tasks.json');
  assert.equal(hoadha.source_role, 'WORKSPACE_LOCAL');
  assert.deepEqual(hoadha.data.tasks.map((task) => task.id), ['HOADHA-PRESERVED-1']);
});

test('Building refuses a canonical StarqNexus ERP board whose data path escapes by junction or symlink', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-active-erp-board-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'command-active-erp-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'starq-erp-tasks.json'), JSON.stringify({ tasks: [{ id: 'SERP-OUTSIDE-1' }] }));
  const link = path.join(root, 'Projects', 'StarqNexus', 'data');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

  const source = readBuildingSource(root, 'starqNexus/data/starq-erp-tasks.json');
  const fingerprint = buildingFingerprint(root);

  assert.equal(source.state, 'UNREADABLE');
  assert.match(source.reason, /escapes the workspace root|escapes the declared read-only surface/);
  assert.equal(source.data, null);
  assert.match(fingerprint, /starqNexus\/data\/starq-erp-tasks\.json=.*UNREADABLE:REFUSED/);
});

test('ERP source selection leaves local Hoadhaa fallback intact when no local ERP board exists', (t) => {
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

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-hoadha-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const localData = path.join(root, 'starqNexus', 'data');
  fs.mkdirSync(localData, { recursive: true });
  fs.writeFileSync(path.join(localData, 'hoadha-tasks.json'), JSON.stringify({ tasks: [{ id: 'HOADHA-LOCAL-1' }] }));

  const source = readBuildingSource(root, 'starqNexus/data/hoadha-tasks.json');

  assert.equal(source.state, 'AVAILABLE');
  assert.equal(source.source_role, 'WORKSPACE_LOCAL');
  assert.deepEqual(source.data.tasks.map((task) => task.id), ['HOADHA-LOCAL-1']);
});
