import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSurface, server } from '../server/data-service.mjs';
import { buildBuilding } from '../server/building.mjs';

let temporaryRoot: string | null = null;
const previousRoot = process.env.STARQ_WORKSPACE;
afterEach(() => {
  if (previousRoot === undefined) delete process.env.STARQ_WORKSPACE;
  else process.env.STARQ_WORKSPACE = previousRoot;
  if (temporaryRoot) {
    const relative = path.relative(os.tmpdir(), temporaryRoot);
    if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) throw new Error('Invalid fixture cleanup path');
    fs.rmSync(temporaryRoot, { recursive: true });
  }
  temporaryRoot = null;
});

function workspace() {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'command-source-failures-'));
  const root = temporaryRoot;
  function write(relative: string, data: unknown) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data));
  }
  write('STARQ.md', 'offline fixture');
  write('agent-comms/room.jsonl', '');
  const board = '00_STARQ_HQ/operations/starqerp-control-board';
  write(`${board}/contract.json`, { contract: {}, hold_state: { implementation: 'ON_HOLD' }, provenance: { generated_from: {} } });
  write(`${board}/activity.json`, { activity_ledger: { sha256_prefix: crypto.createHash('sha256').update('').digest('hex').slice(0, 16) }, agents: [], activity_events: [] });
  write(`${board}/command_work_model.json`, {});
  write('agent-comms/protocol/v1/identities.json', { identities: [] });
  write('agent-comms/protocol/v1/staff-state.json', { entries: {} });
  write('00_STARQ_HQ/operations/herdr-floor/manifest.json', { seats: [] });
  process.env.STARQ_WORKSPACE = root;
  return { root, write, board };
}

describe('source failures stay explicit without a live service or regenerated projection', () => {
  it.each([
    ['process_truth', '00_STARQ_HQ/operations/starqerp-control-board/contract.json'],
    ['execution_truth', '00_STARQ_HQ/operations/starqerp-control-board/activity.json'],
    ['work_truth', '00_STARQ_HQ/operations/starqerp-control-board/command_work_model.json'],
    ['identities', 'agent-comms/protocol/v1/identities.json'],
    ['staff_state', 'agent-comms/protocol/v1/staff-state.json'],
    ['herdr_manifest', '00_STARQ_HQ/operations/herdr-floor/manifest.json'],
  ])('carries the missing-input reason into %s', (key, relative) => {
    const { root } = workspace();
    fs.unlinkSync(path.join(root, relative));
    const result = buildSurface()[key];
    expect(result.available).toBe(false);
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.reason).toBe('canonical source not found on disk');
    expect(server.listening).toBe(false);
  });

  it('preserves a parse error instead of dropping its reason', () => {
    const { write, board } = workspace();
    write(`${board}/activity.json`, '{');
    const result = buildSurface().execution_truth;
    expect(result.state).toBe('UNREADABLE');
    expect(result.reason).toMatch(/^parse failed:/);
  });

  it('does not classify an unreadable provenance input as OK', () => {
    const { root, write, board } = workspace();
    fs.mkdirSync(path.join(root, 'unreadable.md'));
    write(`${board}/contract.json`, { contract: {}, provenance: { generated_from: { fixture: { path: 'unreadable.md', sha256_prefix: 'a'.repeat(16) } } } });
    const result = buildSurface();
    expect(result.provenance.state).toBe('UNREADABLE');
    expect(result.provenance.sources[0].state).toBe('UNREADABLE');
    expect(result.provenance.sources[0].reason).toBeTruthy();
    expect(result.health.conditions.find((condition: { key: string }) => condition.key === 'provenance')?.state).toBe('UNREADABLE');
    expect(result.health.overall).not.toBe('OK');
  });

  it('preserves missing-source and hash-drift evidence independently', () => {
    const { write, board } = workspace();
    write('changed.md', 'current bytes');
    write(`${board}/contract.json`, { contract: {}, provenance: { generated_from: {
      missing: { path: 'missing.md', sha256_prefix: 'a'.repeat(16) },
      changed: { path: 'changed.md', sha256_prefix: 'b'.repeat(16) },
    } } });
    const result = buildSurface().provenance;
    expect(result.state).toBe('DRIFT');
    expect(result.missing).toEqual(['missing']);
    expect(result.drifted).toEqual(['changed']);
    expect(result.sources[0].reason).toBe('canonical source not found on disk');
    expect(result.sources[1].live).toBe(crypto.createHash('sha256').update('current bytes').digest('hex').slice(0, 16));
  });

  it('the Building bridge supplies its declared company sources without widening the fixture workspace', () => {
    const { root } = workspace();
    const result = buildBuilding(root, { process_truth: { hold_state: { implementation: 'ON_HOLD' } } });
    expect(result.floor).toBe('Dev Studio');
    expect(result.projects.find((p: { id: string }) => p.id === 'erp').state).toBe('ON_HOLD');
    expect(result.projects.find((p: { id: string }) => p.id === 'hoadha').classification).toBe('PREPARED');
    expect(result.hoadha.live_count).toBe(326);
    expect(result.hoadha.proposed_count).toBe(33);
    expect(result.hoadha.integrity).toBe('SOURCE_READ');
    expect(result.sources.every((s: { state: string }) => s.state === 'AVAILABLE')).toBe(true);
    expect(server.listening).toBe(false);
  });
});
