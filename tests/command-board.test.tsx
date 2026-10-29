import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/command-client', () => ({
  commandTasks: vi.fn(),
  commandDispatchPreview: vi.fn(),
  commandRoomEvents: vi.fn(),
}));
import boardRaw from '../board/command-board.json?raw';
import schemaRaw from '../board/board-schema.json?raw';
import manifestRaw from '../board/board-manifest.json?raw';
import {
  COMMAND_BOARD_SOURCE,
  PHASE1_ACCEPTANCE,
  loadCommandBoard,
  validateCommandBoardBundle,
} from '../src/lib/command-board';
import { CommandBoardSurface, CommandBoardView } from '../src/surfaces/command-board';
import { commandDispatchPreview, commandRoomEvents, commandTasks } from '@/lib/command-client';

const raw = { board: boardRaw, schema: schemaRaw, manifest: manifestRaw };

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function pinsFor(bundle: typeof raw) {
  const [boardSha256, schemaSha256, manifestSha256] = await Promise.all([
    digest(bundle.board), digest(bundle.schema), digest(bundle.manifest),
  ]);
  return { boardSha256, schemaSha256, manifestSha256 };
}

function jsonWith(rawJson: string, update: (value: Record<string, any>) => void): string {
  const value = JSON.parse(rawJson) as Record<string, any>;
  update(value);
  return JSON.stringify(value);
}

describe('separate read-only Command task input', () => {
  it('exposes the pinned 33-row board as stale command_tasks and preserves UNKNOWNs', async () => {
    const projection = await validateCommandBoardBundle(raw);
    expect(projection.state, projection.reason).toBe('STALE');
    expect(projection.input).toBe('command_tasks');
    expect(projection.source.boardSha256).toBe(COMMAND_BOARD_SOURCE.boardSha256);
    expect(projection.acceptance).toEqual(PHASE1_ACCEPTANCE);
    expect(projection.tasks).toHaveLength(33);
    expect(projection.tasks?.every((task) => task.current_owner === 'UNKNOWN' && task.current_verifier === 'UNKNOWN')).toBe(true);
    expect(projection.tasks?.every((task) => task.workflow_stage.toUpperCase() === 'UNKNOWN')).toBe(true);
    expect(projection.historicalLimitations).toHaveLength(2);
    expect(projection.historicalLimitations.every((value) => value.includes('UNKNOWN'))).toBe(true);
  });

  it('rejects a byte-tampered board against the accepted hash pins', async () => {
    const projection = await validateCommandBoardBundle({ ...raw, board: `${raw.board}\n` });
    expect(projection.state).toBe('CONFLICT');
    expect(projection.tasks).toBeNull();
  });

  it('rejects Vision’s same-size task and source-record mutation despite caller-computed replacement pins', async () => {
    const board = JSON.parse(raw.board) as Record<string, any>;
    const originalTitle = board.tasks[0].title as string;
    const changedTitle = `X${originalTitle.slice(1)}`;
    board.tasks[0].title = changedTitle;
    board.tasks[0].source_record.title = changedTitle;
    const serialized = JSON.stringify(board, null, 2);
    const baselineBoard = JSON.stringify(JSON.parse(raw.board), null, 2);
    expect(new TextEncoder().encode(serialized).length).toBe(new TextEncoder().encode(baselineBoard).length);
    expect(JSON.parse(serialized).tasks[0].title).toBe(JSON.parse(serialized).tasks[0].source_record.title);

    const mutatedBundle = { ...raw, board: serialized };
    const callerComputedPins = await pinsFor(mutatedBundle);
    const legacyOverrideCall = validateCommandBoardBundle as unknown as (
      bundle: typeof raw,
      options: { pins: Awaited<ReturnType<typeof pinsFor>>; acceptance: typeof PHASE1_ACCEPTANCE; digest: typeof digest },
    ) => ReturnType<typeof validateCommandBoardBundle>;
    const projection = await legacyOverrideCall(mutatedBundle, {
      pins: callerComputedPins,
      acceptance: PHASE1_ACCEPTANCE,
      digest,
    });
    expect(projection.state).toBe('CONFLICT');
    expect(projection.tasks).toBeNull();
    expect(projection.reason).toContain('SHA-256 differs from the accepted pins');
  });

  it('fails closed for changed IDs and invalid task references', async () => {
    const duplicate = jsonWith(raw.board, (board) => { board.tasks[1].id = board.tasks[0].id; });
    const duplicateResult = await validateCommandBoardBundle({ ...raw, board: duplicate });
    expect(duplicateResult.state).toBe('CONFLICT');
    expect(duplicateResult.tasks).toBeNull();

    const invalidReference = jsonWith(raw.board, (board) => { board.tasks[0].source_record.dependsOn = ['MISSING-TASK']; });
    const referenceResult = await validateCommandBoardBundle({ ...raw, board: invalidReference });
    expect(referenceResult.state).toBe('CONFLICT');
    expect(referenceResult.tasks).toBeNull();
  });

  it('fails closed for invalid schema and inconsistent manifest counts', async () => {
    const invalidSchema = jsonWith(raw.schema, (schema) => { schema.properties.tasks.type = 'object'; });
    const schemaResult = await validateCommandBoardBundle({ ...raw, schema: invalidSchema });
    expect(schemaResult.state).toBe('CONFLICT');
    expect(schemaResult.tasks).toBeNull();

    const inconsistentManifest = jsonWith(raw.manifest, (manifest) => { manifest.migration.imported_task_count = 32; });
    const manifestResult = await validateCommandBoardBundle({ ...raw, manifest: inconsistentManifest });
    expect(manifestResult.state).toBe('CONFLICT');
    expect(manifestResult.tasks).toBeNull();

    const wrongPath = jsonWith(raw.manifest, (manifest) => { manifest.artifacts.board.path = 'D:\\StarqTech\\erp-tasks.json'; });
    const pathResult = await validateCommandBoardBundle({ ...raw, manifest: wrongPath });
    expect(pathResult.state).toBe('CONFLICT');
    expect(pathResult.tasks).toBeNull();
  });

  it('keeps canonical source and Room acceptance pins immutable', () => {
    expect(Object.isFrozen(COMMAND_BOARD_SOURCE)).toBe(true);
    expect(Object.isFrozen(COMMAND_BOARD_SOURCE.checkpoint)).toBe(true);
    expect(Object.isFrozen(PHASE1_ACCEPTANCE)).toBe(true);
    expect(PHASE1_ACCEPTANCE.eventId).toBe('be17d38644207ea3c10325c8949042070ab51e72c63e4bc0d63bf674e2444357');
    expect(PHASE1_ACCEPTANCE.recordHash).toBe('30e31c54eb032474a1c51d5334df5216e2137f7e0a70e0206ccbf486a4e20dde');
  });

  it('uses repository-relative assets while preserving the accepted historical manifest byte pin', async () => {
    const projection = await validateCommandBoardBundle(raw);
    expect(projection.state).toBe('STALE');
    expect(projection.tasks).toHaveLength(33);
    expect(COMMAND_BOARD_SOURCE.identity).toBe('board/command-board.json');
    expect(COMMAND_BOARD_SOURCE.identity).not.toMatch(/^[A-Za-z]:/);
  });

  it('shows UNAVAILABLE when a pinned board file is missing and does not fall back', async () => {
    const projection = await loadCommandBoard(async () => ({ ok: false } as Response));
    expect(projection.state).toBe('UNAVAILABLE');
    expect(projection.tasks).toBeNull();
    expect(projection.reason).toContain('No fallback source is used');
  });

  it('loads only the three pinned offline board assets', async () => {
    const assets = new Map([
      ['command-board.json', raw.board],
      ['board-schema.json', raw.schema],
      ['board-manifest.json', raw.manifest],
    ]);
    const requested: string[] = [];
    const projection = await loadCommandBoard(async (url) => {
      const name = url.pathname.split('/').pop() ?? '';
      requested.push(name);
      const body = assets.get(name);
      return { ok: body !== undefined, text: async () => body ?? '' } as Response;
    });
    expect(projection.state).toBe('STALE');
    expect(projection.tasks).toHaveLength(33);
    expect(requested.sort()).toEqual(['board-manifest.json', 'board-schema.json', 'command-board.json']);
    expect(requested.join('|')).not.toMatch(/erp|ledger|taskstore|api/i);
  });

  it('renders a distinct source and no assignment, authorization, or dispatch controls', async () => {
    const projection = await validateCommandBoardBundle(raw);
    const html = renderToStaticMarkup(<CommandBoardView projection={projection} />);
    expect(html).toContain('data-input="command_tasks"');
    expect(html).toContain('Room #9462');
    expect(html).toContain('Room cutoff');
    expect(html).toContain('CANDIDATE_NOT_ACCEPTED');
    expect(html).toContain('ERP contract historical non-modification: UNKNOWN');
    expect(html).toContain('Herdr TaskStore historical non-access: UNKNOWN');
    expect(html).toContain('33 historical rows');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('draggable=');
  });
});
describe('live dispatcher surface', () => {
  const boardAssets = new Map([
    ['command-board.json', raw.board],
    ['board-schema.json', raw.schema],
    ['board-manifest.json', raw.manifest],
  ]);

  function feedOk<T>(data: T) {
    return Promise.resolve({ ok: true as const, status: 200, data });
  }

  function feedFail() {
    return Promise.resolve({ ok: false as const, status: 503, error: 'feed unavailable' });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const href = input instanceof URL ? input.href : String(input);
      const name = href.split('/').pop()?.split('?')[0] ?? '';
      const body = boardAssets.get(name);
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        text: async () => body ?? '',
        json: async () => ({}),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderLoadedSurface(): Promise<string> {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = dom.window as unknown as typeof window;
    globalThis.document = dom.window.document;
    const root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => {
      root.render(<CommandBoardSurface />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const html = dom.window.document.getElementById('root')?.innerHTML ?? '';
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    return html;
  }

  it('keeps the dispatcher visible and LIVE only after every required feed succeeds', async () => {
    vi.mocked(commandTasks).mockImplementation(() => feedOk({ ok: true, count: 2, tasks: [{ taskId: 'A' }, { taskId: 'B' }] }));
    vi.mocked(commandDispatchPreview).mockImplementation(() => feedOk({ eligible: [], blocked: [], workforceObservedAt: null }));
    vi.mocked(commandRoomEvents).mockImplementation(() => feedOk({ ok: true, state: 'OK', events: [{ eventId: 'e1' }] }));

    const html = await renderLoadedSurface();

    expect(html).toContain('33 historical rows');
    expect(html).toContain('Live dispatcher activity (read-only)</h2><span class="chip" data-tone="muted">2 tasks</span>');
    expect(html).toContain('title="LIVE"');
    expect(html).toContain('available (not executed)');
    expect(html).not.toContain('>CHECKING<');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('draggable=');
  });

  it('stays visible and STALE when only some required feeds succeed', async () => {
    vi.mocked(commandTasks).mockImplementation(() => feedOk({ ok: true, count: 1, tasks: [{ taskId: 'A' }] }));
    vi.mocked(commandDispatchPreview).mockImplementation(() => feedFail());
    vi.mocked(commandRoomEvents).mockImplementation(() => feedOk({ ok: true, state: 'OK', events: [{ eventId: 'e1' }] }));

    const html = await renderLoadedSurface();

    expect(html).toContain('33 historical rows');
    expect(html).toContain('Live dispatcher activity (read-only)</h2><span class="chip" data-tone="muted">STALE</span>');
    expect(html).toContain('Tasks shown:</strong> 1');
    expect(html).toContain('Dispatch preview:</strong> unavailable');
    expect(html).toContain('Room events:</strong> 1');
    expect(html).toContain('Only feeds that reported success are counted.');
    expect(html).not.toContain('title="LIVE"');
  });

  it('stays visible and UNAVAILABLE when required feeds resolve ok:false', async () => {
    vi.mocked(commandTasks).mockImplementation(() => feedFail());
    vi.mocked(commandDispatchPreview).mockImplementation(() => feedFail());
    vi.mocked(commandRoomEvents).mockImplementation(() => feedFail());

    const html = await renderLoadedSurface();

    expect(html).toContain('33 historical rows');
    expect(html).toContain('Live dispatcher activity (read-only)</h2><span class="chip" data-tone="muted">UNAVAILABLE</span>');
    expect(html).toContain('Required command feeds did not succeed.');
    expect(html).toContain('Tasks shown:</strong> 0');
    expect(html).not.toContain('title="LIVE"');
  });
});
