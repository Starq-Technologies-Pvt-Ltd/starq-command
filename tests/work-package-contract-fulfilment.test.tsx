import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CommandSurface, WorkPackageRow } from '@/lib/contracts';
import { parseBuildingRoute } from '@/lib/building-route';
import { BuildingSurface } from '@/surfaces/building';
import {
  filterWorkPackageRows,
  WorkPackagesSurface,
  projectOptionValue,
  stageOptionValue,
  workPackageProjectOptions,
  workPackageStageOptions,
} from '@/surfaces/work-packages';

/**
 * CMD-DI-3-2c — Work contract-fulfilment verification.
 *
 * ADDITIVE to CMD-DI-3-2b, which verified surface behaviour. This file verifies
 * that the surface FULFILS the frozen 3-2a contract and invents nothing.
 *
 * Frozen contract (CMD-DI-3-2a): src/lib/contracts.ts, 40629 B,
 * sha256 81f6e9f61ea2f9b9b045e7c4f03b3bfa2459405f1af1b12f0f3fcde33d29d99d
 *
 * ── WHY THIS FILE PARSES SOURCE ──────────────────────────────────────────────
 * vitest transpiles via esbuild, which strips TypeScript types without checking
 * them, and tsconfig includes only ["src"]. A `keyof WorkPackageRow` assertion
 * in this folder therefore enforces nothing: a ninth contract field, or a
 * `string | null` narrowed to `string`, would leave every type-level test green.
 * The contract is consequently pinned by READING THE INTERFACE BODY and
 * asserting its literal text, which is a real runtime check.
 */

function read(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), 'utf8');
}

const CONTRACT_SRC = read('src', 'lib', 'contracts.ts');
const SURFACE_SRC = read('src', 'surfaces', 'work-packages.tsx');
const BUILDING_SRC = read('src', 'surfaces', 'building.tsx');

/** The interface body exactly as declared, so its literal types are assertable. */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  expect(start, `${name} not found in contracts.ts`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `${name} body has no closing brace`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** The EvidenceRoomsPeer function, with a safe end boundary. */
function roomsPeer(): string {
  const start = BUILDING_SRC.indexOf('function EvidenceRoomsPeer');
  expect(start, 'EvidenceRoomsPeer not found').toBeGreaterThan(-1);
  const end = BUILDING_SRC.indexOf('\nfunction ', start + 1);
  return BUILDING_SRC.slice(start, end === -1 ? undefined : end);
}

/** Every contract field the surface is obliged to surface, with its declared type. */
const CONTRACT_FIELDS = [
  'id',
  'project_id',
  'title',
  'current_stage',
  'owner',
  'verifier',
  'board_lane',
  'source',
] as const;

/** Fields the contract deliberately leaves open; a non-null type here is a breach. */
const NULLABLE_FIELDS = ['current_stage', 'owner', 'verifier', 'board_lane'] as const;

const rows = [
  {
    id: 'erp-1',
    project_id: 'erp',
    title: 'ERP task title as declared',
    current_stage: 'BLOCKED',
    owner: null,
    verifier: null,
    board_lane: null,
    source: { kind: 'ERP_TASK', reference: 'starqNexus/data/starq-erp-tasks.json' },
  },
  {
    id: 'hoadha-1',
    project_id: 'hoadha',
    title: 'Hoadha item title as declared',
    current_stage: 'H2',
    owner: 'declared-owner',
    verifier: null,
    board_lane: 'UNKNOWN',
    source: { kind: 'HOADHA_ITEM', reference: '03_PROJECTS/hoadha/board.json' },
  },
  {
    // Tempts a stage inference from board_lane.
    id: 'tempt-1',
    project_id: 'mercury',
    title: 'Row with a lane but no stage',
    current_stage: null,
    owner: null,
    verifier: null,
    board_lane: 'READY',
    source: { kind: 'GENERAL_ASSIGNMENT', reference: 'activity/assignment.json' },
  },
  {
    // Nothing but a stage; every other optional field must stay unsupported.
    id: 'tempt-2',
    project_id: 'mercury',
    title: 'Row with nothing but a stage',
    current_stage: 'IN REVIEW',
    owner: null,
    verifier: null,
    board_lane: null,
    source: { kind: 'GENERAL_ASSIGNMENT', reference: 'activity/other.json' },
  },
  {
    // Breaks naive encoders, trimmers and case-folders.
    id: 'awkward',
    project_id: 'a/b c',
    title: '  padded title  ',
    current_stage: ' blocked ',
    owner: 'Mixed-Case-Owner',
    verifier: null,
    board_lane: null,
    source: { kind: 'ERP_TASK', reference: 'path with space/and-slash.json' },
  },
] satisfies WorkPackageRow[];

/**
 * CORRECTIVE #1 (Vision REJECT #9273) — discriminating positive fixtures.
 *
 * The pre-corrective fixture set had `verifier: null` on every row and no
 * per-row assertion binding owner or board_lane to their markers, so
 * requirement 1 was not proven for current_stage, owner, verifier or
 * board_lane.
 *
 * Every value below is non-null and pairwise distinct WITHIN its row and
 * ACROSS the two rows. Distinctness is what makes the assertions discriminating:
 * if the surface transposed owner and verifier, substituted a neighbouring
 * field's value, or inferred a fallback, the exact-equality assertion fails,
 * because no other field in the document can supply the expected token.
 */
const boundRows = [
  {
    id: 'bind-alpha',
    project_id: 'alpha-project',
    title: 'Alpha package title',
    current_stage: 'ALPHA-STAGE',
    owner: 'ALPHA-OWNER',
    verifier: 'ALPHA-VERIFIER',
    board_lane: 'ALPHA-LANE',
    source: { kind: 'ERP_TASK', reference: 'alpha/alpha-source.json' },
  },
  {
    id: 'bind-beta',
    project_id: 'beta-project',
    title: 'Beta package title',
    current_stage: 'BETA-STAGE',
    owner: 'BETA-OWNER',
    verifier: 'BETA-VERIFIER',
    board_lane: 'BETA-LANE',
    source: { kind: 'HOADHA_ITEM', reference: 'beta/beta-source.json' },
  },
] satisfies WorkPackageRow[];

/** field marker -> the exact contract value that must render in it. */
function expectedBinding(row: (typeof boundRows)[number]): Record<string, string> {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    current_stage: row.current_stage,
    owner: row.owner,
    verifier: row.verifier,
    board_lane: row.board_lane,
    'source.kind': row.source.kind,
    'source.reference': row.source.reference,
  };
}

function render(rowsArg: WorkPackageRow[] | null): string {
  return renderToStaticMarkup(<WorkPackagesSurface rows={rowsArg} />);
}

/**
 * The rendered TEXT of one contract field, extracted from its own marker span.
 *
 * CORRECTIVE #1 (Vision REJECT #9273): the previous version sliced from the
 * marker to the next `</span>` and stripped tags, which left the opening tag's
 * attribute text in the result and therefore only ever supported a loose
 * `toContain`. It now isolates the span's text content so assertions can be
 * exact equality, which is what field-value binding actually requires.
 *
 * The result is deliberately NOT trimmed: the surface copies declared values
 * verbatim, so trimming here would hide a surface that started trimming.
 */
function fieldValue(html: string, field: string): string {
  const marker = `data-contract-field="${field}"`;
  const at = html.indexOf(marker);
  expect(at, `field ${field} has no marker in this render`).toBeGreaterThan(-1);
  const open = html.indexOf('>', at);
  const close = html.indexOf('</span>', open);
  expect(open, `field ${field} marker is not closed`).toBeGreaterThan(at);
  expect(close, `field ${field} span is not closed`).toBeGreaterThan(open);
  return html.slice(open + 1, close).replace(/<[^>]*>/g, '');
}

describe('CMD-DI-3-2c · requirement 7a — the frozen 3-2a contract is pinned at source level', () => {
  const body = interfaceBody(CONTRACT_SRC, 'WorkPackageRow');

  it('declares exactly the eight agreed fields and no more', () => {
    const declared = [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(declared).toEqual([...CONTRACT_FIELDS]);
    expect(declared).toHaveLength(8);
  });

  it('keeps the four deliberately-open fields nullable in the contract itself', () => {
    // Parsed from the source, so narrowing `string | null` to `string` fails here.
    for (const f of NULLABLE_FIELDS) {
      expect(body, `${f} must stay nullable`).toMatch(new RegExp(`\\b${f}\\s*:\\s*string\\s*\\|\\s*null;`));
    }
  });

  it('keeps the identifying fields non-nullable', () => {
    for (const f of ['id', 'project_id', 'title'] as const) {
      expect(body, `${f} must stay required`).toMatch(new RegExp(`\\b${f}\\s*:\\s*string;`));
    }
    expect(body).toMatch(/\bsource\s*:\s*WorkPackageSource;/);
  });

  it('keeps the proposed response union distinct: WorkPackageRow[] | null', () => {
    const sig = interfaceBody(CONTRACT_SRC, 'WorkPackagesEndpointSignature');
    expect(sig).toMatch(/response:\s*WorkPackageRow\[\]\s*\|\s*null;/);
    // The union must not be flattened to either arm.
    expect(sig).not.toMatch(/response:\s*WorkPackageRow\[\];/);
    expect(sig).not.toMatch(/response:\s*null;/);
  });
});

describe('CMD-DI-3-2c · requirement 1 — every contract field is surfaced with its own value', () => {
  it('renders exactly one contract marker per field per row', () => {
    const html = render(rows);
    // `source` is nested and surfaces as its two declared members; there is no
    // bare data-contract-field="source" marker.
    const markers = [...CONTRACT_FIELDS.filter((f) => f !== 'source'), 'source.kind', 'source.reference'];
    expect(markers).toHaveLength(9);
    for (const field of markers) {
      const n = html.split(`data-contract-field="${field}"`).length - 1;
      expect(n, `field ${field} rendered ${n} times, expected ${rows.length}`).toBe(rows.length);
    }
  });

  it('binds every contract field to its exact value, per row, including stage owner verifier and lane', () => {
    // CORRECTIVE #1: exact equality on all nine markers. Pre-corrective this
    // covered only id, project_id, title, source.kind and source.reference.
    for (const row of boundRows) {
      const html = render([row]);
      const binding = expectedBinding(row);
      for (const [field, expected] of Object.entries(binding)) {
        expect(fieldValue(html, field), `${row.id}.${field} must render its own contract value`).toBe(
          expected,
        );
      }
    }
  });

  it('marks all four open fields declared when they carry a contract value', () => {
    const html = render(boundRows);
    // current_stage carries a stage-origin attribute; the other three carry a
    // support attribute. They are not interchangeable.
    expect(html).toContain('data-contract-field="current_stage" data-stage-origin="declared"');
    for (const field of ['owner', 'verifier', 'board_lane']) {
      expect(html, `${field} must be declared, not unsupported`).toContain(
        `data-contract-field="${field}" data-support="declared"`,
      );
      expect(html, `${field} must not be unsupported here`).not.toContain(
        `data-contract-field="${field}" data-support="unsupported"`,
      );
    }
    expect(html).not.toContain('data-contract-field="current_stage" data-stage-origin="absent"');
  });

  it('uses pairwise-distinct values so a transposition or substitution cannot pass', () => {
    for (const row of boundRows) {
      const values = Object.values(expectedBinding(row));
      expect(new Set(values).size, `row ${row.id} values must all differ`).toBe(values.length);

      // A transposed field pair must be directly observable as a mismatch.
      const html = render([row]);
      expect(fieldValue(html, 'owner')).not.toBe(row.verifier);
      expect(fieldValue(html, 'verifier')).not.toBe(row.owner);
      expect(fieldValue(html, 'current_stage')).not.toBe(row.board_lane);
      expect(fieldValue(html, 'board_lane')).not.toBe(row.current_stage);
      // No other field in the document may leak into these four.
      for (const field of ['current_stage', 'owner', 'verifier', 'board_lane']) {
        const value = fieldValue(html, field);
        for (const other of Object.entries(expectedBinding(row))) {
          if (other[0] === field) continue;
          expect(value, `${field} must not carry ${other[0]}`).not.toContain(other[1]);
        }
      }
    }
  });

  it('renders a marker count matching the positively-bound rows', () => {
    const html = render(boundRows);
    const markers = [...CONTRACT_FIELDS.filter((f) => f !== 'source'), 'source.kind', 'source.reference'];
    for (const field of markers) {
      const n = html.split(`data-contract-field="${field}"`).length - 1;
      expect(n, `field ${field} rendered ${n} times`).toBe(boundRows.length);
    }
  });

  it('binds each rendered field to the exact contract value, per row', () => {
    // Catches a marker that survives while its value is hardcoded or substituted.
    for (const row of rows) {
      const html = render([row]);
      expect(fieldValue(html, 'id')).toContain(row.id);
      expect(fieldValue(html, 'project_id')).toContain(row.project_id);
      expect(fieldValue(html, 'title')).toContain(row.title);
      expect(fieldValue(html, 'source.kind')).toContain(row.source.kind);
      expect(fieldValue(html, 'source.reference')).toContain(row.source.reference);
    }
  });

  it('marks an absent owner, verifier or lane unsupported instead of substituting', () => {
    const html = render(rows);
    expect(html).toContain('data-contract-field="owner" data-support="unsupported"');
    expect(html).toContain('data-contract-field="verifier" data-support="unsupported"');
    expect(html).toContain('data-contract-field="board_lane" data-support="unsupported"');
    expect(html).toContain('data-contract-field="owner" data-support="declared"');
    expect(html).toContain('Mixed-Case-Owner');
  });

  it('renders a missing current_stage as UNKNOWN and marks the origin absent', () => {
    const html = render(rows);
    // Only tempt-1 lacks a stage; a padded token is DECLARED, not absent.
    expect(html.split('data-stage-origin="absent"').length - 1).toBe(1);
    expect(html.split('data-stage-origin="declared"').length - 1).toBe(rows.length - 1);
  });
});

describe('CMD-DI-3-2c · requirement 2 — nothing is inferred or synthesized', () => {
  it('never derives a stage from board_lane on a row that declares no stage', () => {
    const html = render([rows[2]]);
    expect(html).toContain('data-stage-origin="absent"');
    expect(html).toContain('UNKNOWN');
    expect(html, 'board_lane must not become the stage').not.toMatch(/data-stage-origin="declared">READY</);
    // The lane is still shown, because the contract declared it.
    expect(html).toContain('READY');
  });

  it('never invents an owner, verifier or lane for a bare row', () => {
    const html = render([rows[3]]);
    expect(fieldValue(html, 'owner')).toContain('unsupported');
    expect(fieldValue(html, 'verifier')).toContain('unsupported');
    expect(fieldValue(html, 'board_lane')).toContain('unsupported');
    // A fallback applied via `??` would surface one of these tokens.
    for (const invented of ['unassigned', 'TBD', 'n/a', 'nobody', 'default', 'UNKNOWN']) {
      expect(fieldValue(html, 'owner'), `invented owner ${invented}`).not.toContain(invented);
      expect(fieldValue(html, 'verifier'), `invented verifier ${invented}`).not.toContain(invented);
      expect(fieldValue(html, 'board_lane'), `invented lane ${invented}`).not.toContain(invented);
    }
  });

  it('copies contract values verbatim without trimming, case-folding or translating', () => {
    const awkward = render([rows[4]]);
    expect(awkward).toContain('> blocked <');
    expect(awkward).toContain('  padded title  ');
    expect(awkward).toContain('Mixed-Case-Owner');
    expect(awkward).toContain('a/b c');

    // 'IN REVIEW' is a declared token; it must not become a canonical lane.
    const synonym = render([rows[3]]);
    expect(synonym).toContain('>IN REVIEW<');
    expect(synonym, 'declared synonym must not be translated').not.toContain('>REVIEW<');
  });

  it('defence in depth: the surface declares no assembler or data source', () => {
    // These are string-shape proxies and can be evaded by obfuscation. The
    // behavioural tests above are the primary defence; this catches the
    // ordinary case where someone reintroduces an ERP/Hoadha read directly.
    expect(SURFACE_SRC).not.toMatch(/\berp_tasks\b/);
    expect(SURFACE_SRC).not.toMatch(/\bhoadha\b/);
    expect(SURFACE_SRC).not.toContain('/api/work-packages');
    expect(SURFACE_SRC).not.toMatch(/useEffect|useLayoutEffect/);
  });
});

describe('CMD-DI-3-2c · requirement 3 — filters preserve exact contract values', () => {
  it('round-trips every project id and stage label through the option encoding', () => {
    expect(workPackageProjectOptions(rows)).toEqual(['erp', 'hoadha', 'mercury', 'a/b c']);
    expect(workPackageStageOptions(rows)).toEqual(['BLOCKED', 'H2', 'UNKNOWN', 'IN REVIEW', ' blocked ']);

    const html = render(rows);
    for (const id of workPackageProjectOptions(rows)) {
      expect(html).toContain(`value="${projectOptionValue(id)}"`);
    }
    for (const label of workPackageStageOptions(rows)) {
      expect(html).toContain(`value="${stageOptionValue(label)}"`);
    }
    // An id with a slash and a space must survive URI encoding intact.
    expect(html).toContain('value="project:a%2Fb%20c"');
    expect(html).toContain('value="stage:%20blocked%20"');
  });

  it('filters on exact equality and never rewrites the supplied rows', () => {
    const before = JSON.stringify(rows);
    expect(filterWorkPackageRows(rows, { project_id: 'mercury', stage: null }).map((r) => r.id)).toEqual([
      'tempt-1',
      'tempt-2',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: 'MERCURY', stage: null })).toEqual([]);
    expect(filterWorkPackageRows(rows, { project_id: 'a/b c', stage: null }).map((r) => r.id)).toEqual([
      'awkward',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: ' blocked ' }).map((r) => r.id)).toEqual([
      'awkward',
    ]);
    expect(filterWorkPackageRows(rows, { project_id: null, stage: 'blocked' })).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('a filter miss is not reported as an empty response', () => {
    expect(filterWorkPackageRows(rows, { project_id: 'no-such-project', stage: null })).toEqual([]);
    // The rendered total stays truthful, so a miss can never read as "none exist".
    const html = render(rows);
    expect(html).toContain(`${rows.length} / ${rows.length}`);
    expect(html).not.toContain('Verified empty');
    expect(SURFACE_SRC).toContain('data-filter-result="none"');
  });
});

describe('CMD-DI-3-2c · requirement 4 — null is unavailable, [] is verified empty', () => {
  it('renders null as UNKNOWN availability and never as an empty list', () => {
    const unknown = render(null);
    expect(unknown).toContain('data-availability="UNKNOWN"');
    expect(unknown).toContain('An empty list is not assumed');
    expect(unknown).not.toContain('data-availability="empty"');
    expect(unknown).not.toContain('Verified empty');
    expect(unknown).not.toContain('0 / 0');
  });

  it('renders [] as a verified empty result, not as unavailable', () => {
    const empty = render([]);
    expect(empty).toContain('data-availability="empty"');
    expect(empty).toContain('Verified empty');
    expect(empty).not.toContain('data-availability="UNKNOWN"');
    expect(empty).not.toContain('An empty list is not assumed');
    expect(empty).toContain('0 / 0');
  });

  it('never rewrites null into an empty list in the surface logic', () => {
    expect(SURFACE_SRC).toContain('rows === null');
    expect(SURFACE_SRC).not.toMatch(/rows\s*\?\?\s*\[\]/);
    expect(SURFACE_SRC).not.toMatch(/rows\s*\|\|\s*\[\]/);
  });
});

describe('CMD-DI-3-2c · requirement 5 — Evidence → Rooms stays independent and unchanged', () => {
  it('matches the pinned EvidenceRoomsPeer slice hash and byte count', () => {
    const peer = roomsPeer();
    const bytes = Buffer.from(peer, 'utf8');
    expect(bytes.length).toBe(15076);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '0b664c0b1a49aa1a0323e23df622aefc15e44d30e66e55534cbaa5df1812a96c',
    );
  });

  it('pins that slice in the same way the recovery baseline pins it', () => {
    // The baseline extracts from the literal token to the next \nfunction
    // boundary; reproduce that extraction exactly, including the -1 fallback.
    const start = BUILDING_SRC.indexOf('function EvidenceRoomsPeer');
    const end = BUILDING_SRC.indexOf('\nfunction ', start + 1);
    const peer = BUILDING_SRC.slice(start, end === -1 ? undefined : end);
    expect(createHash('sha256').update(Buffer.from(peer, 'utf8')).digest('hex')).toBe(
      '0b664c0b1a49aa1a0323e23df622aefc15e44d30e66e55534cbaa5df1812a96c',
    );
    expect(peer.length).toBeGreaterThan(0);
  });

  it('keeps Work out of the Rooms peer and the Rooms peer out of Work', () => {
    const peer = roomsPeer();
    expect(peer).not.toContain('WorkPackage');
    expect(peer).not.toContain('work-packages');
    expect(peer).not.toContain('WorkPackagesSurface');
    expect(SURFACE_SRC).not.toContain('EvidenceRoomsPeer');
    expect(SURFACE_SRC).not.toContain('room.jsonl');
  });

  it('still routes #evidence/rooms to Rooms and #work to Work', () => {
    expect(parseBuildingRoute('#evidence/rooms')).toEqual({ view: 'evidence', room: null, tab: 'Rooms' });
    const rooms = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#evidence/rooms')} surface={{} as CommandSurface} />,
    );
    expect(rooms).not.toContain('data-surface="work-packages"');

    const work = renderToStaticMarkup(
      <BuildingSurface route={parseBuildingRoute('#work')} surface={{} as CommandSurface} />,
    );
    expect(work).toContain('data-surface="work-packages"');
    expect(work).not.toContain('Conversation record');
  });
});

describe('CMD-DI-3-2c · requirement 6 — read-only, no unauthorized network or endpoint', () => {
  it('exposes no mutation affordance in the rendered surface', () => {
    const html = render(rows);
    expect(html).toContain('data-readonly="true"');
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<button/i);
    expect(html).not.toMatch(/method="post"/i);
    expect(html).not.toMatch(/contenteditable/i);
    // Only the two contract filters are interactive.
    expect(html.match(/<select/g)).toHaveLength(2);
  });

  it('keeps the authorized endpoint read-only and does not assemble unsupported sources', () => {
    const dataService = read('server', 'data-service.mjs');
    const start = dataService.indexOf("if (url.pathname === '/api/work-packages')");
    const end = dataService.indexOf("if (url.pathname === '/api/snapshot')", start);
    const handler = dataService.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    // #9538 authorizes the independently tested canonical Room read adapter.
    // An unavailable source still returns null; no fallback invents work.
    expect(handler).toContain('visibility.work === null ? null');
    expect(handler).toContain('readRoomVisibility');
    expect(handler).not.toMatch(/INSERT|UPDATE|DELETE|CREATE TABLE/i);
    expect(handler).not.toContain('buildBuilding(');
  });

  it('binds the Work route to the endpoint and preserves null as UNKNOWN', () => {
    const workRoute = read('src', 'surfaces', 'work-packages-route.tsx');
    expect(workRoute).toContain("fetch('/api/work-packages'");
    expect(workRoute).toContain("value !== null && !isWorkPackageRows(value)");
    expect(workRoute).toContain('setRows(value)');
    expect(workRoute).toContain('<WorkPackagesSurface rows={rows} />');
    expect(BUILDING_SRC).toContain('<WorkPackagesRoute />');
    expect(SURFACE_SRC).not.toContain('/api/work-packages');
  });

  it('keeps the endpoint call confined to the Work route binding', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d)) {
        const p = path.join(d, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry) && entry !== 'contracts.ts') {
          if (readFileSync(p, 'utf8').includes('/api/work-packages')) {
            offenders.push(path.relative(process.cwd(), p));
          }
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders, `endpoint callers: ${offenders.join(', ')}`).toEqual([
      path.join('src', 'surfaces', 'work-packages-route.tsx'),
    ]);
  });
});

describe('CMD-DI-3-2c · requirement 7b — accepted 3-2b surface behaviour is preserved', () => {
  it('retains every 3-2b export', () => {
    for (const symbol of [
      'workPackageStagePresentation',
      'workPackageSupportedText',
      'workPackageProjectOptions',
      'workPackageStageOptions',
      'filterWorkPackageRows',
      'projectOptionValue',
      'stageOptionValue',
      'WorkPackagesSurface',
    ]) {
      expect(SURFACE_SRC, `3-2b export ${symbol} missing`).toContain(`export function ${symbol}`);
    }
  });

  it('retains the declared/unsupported and declared/absent vocabulary', () => {
    expect(SURFACE_SRC).toContain("support: 'unsupported'");
    expect(SURFACE_SRC).toContain("support: 'declared'");
    expect(SURFACE_SRC).toContain("origin: 'absent'");
    expect(SURFACE_SRC).toContain("origin: 'declared'");
  });

  it('does not introduce the forbidden duplicate Room surface', () => {
    expect(existsSync(path.join(process.cwd(), 'src', 'surfaces', 'room.tsx'))).toBe(false);
  });
});
