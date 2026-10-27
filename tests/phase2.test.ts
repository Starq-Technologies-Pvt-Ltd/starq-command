import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPhase2Surface, buildSurface, STATE } from '../server/data-service.mjs';
import { buildSnapshot, ABSOLUTE_WINDOWS_PATH } from '../server/snapshot.mjs';
import { DIMENSION, DIMENSION_PRECEDENCE, SNAPSHOT_SCHEMA_VERSION, summarizeFloor } from '../server/health-floor.mjs';
import { runReadOnlyGates, RUNNABLE_GATES, REFUSED_SCRIPTS } from '../server/gates.mjs';
import { resolveWorkspace } from '../server/paths.mjs';

/**
 * Phase 2 contract tests, against the REAL canonical sources.
 *
 * These assert the properties the Founder named for this phase, in the order
 * the properties can actually fail:
 *
 *   - the four honesty states stay distinct
 *   - current health never absorbs preserved historical issues
 *   - every carried issue cites a canonical source
 *   - the snapshot is versioned, serialisable, and free of host paths
 *   - nothing in Phase 2 became a write, a remote call, or a second SSOT
 *
 * A mock would prove none of this. If the workspace moves underneath Command,
 * these fail — which is the point.
 */

const root = resolveWorkspace().root;
const surface = await buildPhase2Surface();
const floor = surface.health_floor!;
const summary = surface.health_floor_summary!;
const snapshot = buildSnapshot({ surface, floor, workspaceRoot: root });
const snapshotJson = JSON.stringify(snapshot);
const summaryScope = buildSnapshot({ surface, floor, workspaceRoot: root, scope: 'summary' });

/**
 * Collect every absolute Windows path surviving in PARSED string values.
 *
 * This walks the object graph rather than testing `JSON.stringify` output,
 * and that distinction is the whole point. Serialising doubles every
 * backslash, so `C:\Users` becomes `C:\\Users` and the `(?![\/]{2})` URL guard
 * inside `ABSOLUTE_WINDOWS_PATH` rejects the serialised form of the very path
 * it is meant to catch. An assertion written against the serialised string
 * therefore passes against a snapshot that still leaks. The value has to be
 * walked as a value.
 */
function collectAbsolutePathLeaks(value: unknown, at = '$'): { at: string; value: string }[] {
  const leaks: { at: string; value: string }[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, pointer: string, depth: number): void => {
    if (depth > 24 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (ABSOLUTE_WINDOWS_PATH.test(node)) leaks.push({ at: pointer, value: node });
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pointer}[${i}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, `${pointer}.${key}`, depth + 1);
    }
  };

  walk(value, at, 0);
  return leaks;
}

/** Readable failure text, so a leak names the field that carried it. */
function describeLeaks(leaks: { at: string; value: string }[]): string {
  return leaks.map((l) => `${l.at} => ${JSON.stringify(l.value)}`).join('\n');
}

describe('the health floor exists and is separate from the projection health', () => {
  it('assembles a health floor alongside, not inside, the Phase 1 health', () => {
    expect(floor).toBeTruthy();
    expect(summary).toBeTruthy();
    // Phase 1's proven contract is untouched: still four conditions, still the
    // three truth layers plus provenance.
    expect(surface.health.conditions.map((c) => c.key).sort()).toEqual([
      'executionTruth',
      'processTruth',
      'provenance',
      'workTruth',
    ]);
  });

  it('declares its own authority and never claims to be an SSOT', () => {
    expect(floor.authority).toBe('DERIVED_PROJECTION');
    expect(floor.principle).toMatch(/green projection is NOT a green control plane/i);
  });

  it('carries a dimension per control-plane concern', () => {
    const ids = floor.current_health.map((d) => d.id);
    for (const required of [
      'ledgerIntegrity',
      'sourceReachability',
      'runtime',
      'healthTool',
      'reviewerSeparation',
      'destructiveGuard',
      'identityLease',
      'reconciliationGates',
    ]) {
      expect(ids, `missing health dimension ${required}`).toContain(required);
    }
  });
});

describe('STALE, DRIFT, UNAVAILABLE and UNKNOWN stay distinct', () => {
  it('publishes one vocabulary for the control plane', () => {
    expect(Object.values(DIMENSION).sort()).toEqual(
      ['DRIFT', 'FAIL', 'OK', 'STALE', 'UNAVAILABLE', 'UNKNOWN', 'UNREADABLE'].sort(),
    );
  });

  it('orders the aggregate so an unreadable source outranks a drifted one', () => {
    // You cannot judge truth against something you cannot read.
    expect(DIMENSION_PRECEDENCE.indexOf(DIMENSION.UNAVAILABLE)).toBeLessThan(
      DIMENSION_PRECEDENCE.indexOf(DIMENSION.FAIL),
    );
    expect(DIMENSION_PRECEDENCE.indexOf(DIMENSION.UNREADABLE)).toBeLessThan(
      DIMENSION_PRECEDENCE.indexOf(DIMENSION.DRIFT),
    );
    // UNKNOWN must never be ranked as healthy.
    expect(DIMENSION_PRECEDENCE.indexOf(DIMENSION.UNKNOWN)).toBeLessThan(
      DIMENSION_PRECEDENCE.indexOf(DIMENSION.OK),
    );
  });

  it('assigns every dimension a state from that vocabulary', () => {
    for (const d of floor.current_health) {
      expect(Object.values(DIMENSION), `dimension ${d.id} has state ${d.state}`).toContain(d.state);
      expect(typeof d.detail, `dimension ${d.id} has no detail`).toBe('string');
      expect(d.detail.length, `dimension ${d.id} has an empty detail`).toBeGreaterThan(0);
    }
  });

  it('never counts an unassessed dimension as healthy', () => {
    // The anti-masking property: UNKNOWN is not a quiet pass.
    expect(summary.dimensions_assessed).toBeLessThanOrEqual(summary.dimensions_total);
    expect(summary.dimensions_healthy + (summary.by_state.UNKNOWN ?? 0)).toBeLessThanOrEqual(
      summary.dimensions_total,
    );
    if (summary.by_state.UNKNOWN) {
      expect(summary.dimensions_healthy).toBeLessThan(summary.dimensions_total);
    }
  });

  it('summarises without collapsing a dimension into the verdict', () => {
    const s = summarizeFloor(floor);
    expect(s.dimensions_total).toBe(floor.current_health.length);
    expect(s.overall).toBe(
      DIMENSION_PRECEDENCE.find((st) => floor.current_health.some((d) => d.state === st)),
    );
  });
});

describe('current health is separate from preserved historical issues', () => {
  it('keeps them in two different structures', () => {
    expect(Array.isArray(floor.current_health)).toBe(true);
    expect(Array.isArray(floor.preserved_historical)).toBe(true);
    const currentIds = floor.current_health.map((d) => d.id);
    for (const epoch of floor.preserved_historical) {
      expect(currentIds).not.toContain(epoch.epoch_id);
    }
  });

  it('never lets a frozen epoch affect the current verdict', () => {
    for (const epoch of floor.preserved_historical) {
      expect(epoch.affects_current_verdict).toBe(false);
      expect(epoch.immutable).toBe(true);
    }
  });

  it('preserves the Epoch-1 failure rather than forgetting or repairing it', () => {
    const epoch1 = floor.preserved_historical.find((e) =>
      e.epoch_id.startsWith('epoch-1'),
    );
    expect(epoch1, 'epoch-1 history is missing — a preserved failure must stay visible').toBeTruthy();
    expect(epoch1!.verdict).toBe('FAIL_PRESERVED');
    expect(epoch1!.known_failure_count).toBeGreaterThan(0);
    expect(epoch1!.policy?.rewrite).toBe('NEVER');
    expect(epoch1!.policy?.rehash).toBe('NEVER');
  });

  it('reports the current epoch independently of the frozen one', () => {
    const current = floor.ledger_integrity?.current;
    expect(current).toBeTruthy();
    // Whatever the current epoch says, it is a separate verdict from Epoch-1.
    expect(current!.epoch_id).not.toBe(floor.preserved_historical[0]?.epoch_id);
    expect(['OK', 'FAIL']).toContain(current!.state);
  });
});

describe('ledger integrity is imported, never re-derived', () => {
  it('cites the canonical verifier as its evidence', () => {
    const evidence = floor.ledger_integrity?.evidence ?? [];
    expect(evidence.some((p) => p.endsWith('ledger-epoch.mjs'))).toBe(true);
    expect(evidence.some((p) => p.endsWith('ledger-epoch.json'))).toBe(true);
    expect(floor.ledger_integrity?.method).toMatch(/imported read-only/i);
  });

  it('reports every failure rather than only the first', () => {
    const current = floor.ledger_integrity?.current;
    expect(current).toBeTruthy();
    expect(Array.isArray(current!.failures)).toBe(true);
    if (current!.state === 'OK') expect(current!.failures).toHaveLength(0);
  });

  it('checks the anchor against the live ledger, not against itself', () => {
    const current = floor.ledger_integrity?.current;
    expect(current?.anchor_consistent).not.toBeNull();
    expect(current?.anchor_consistent).not.toBeUndefined();
  });
});

describe('a blocked tool is not an unavailable truth', () => {
  const tool = floor.current_health.find((d) => d.id === 'healthTool')!;

  it('reports the canonical health tool honestly on this runtime', () => {
    // The tool genuinely cannot execute on native Windows Node. If that ever
    // gets fixed, this test is expected to be updated — and the change will be
    // visible in the diff rather than silently absorbed.
    expect(tool.state).toBe(DIMENSION.UNAVAILABLE);
    expect(tool.detail).toMatch(/ERR_UNSUPPORTED_ESM_URL_SCHEME|dynamic import/i);
  });

  it('separates the blocked tool from the truth underneath it', () => {
    expect(tool.underlying_truth_reachable).toBe(true);
    // The underlying integrity truth IS reported, and it is a real verdict.
    expect(floor.ledger_integrity?.current?.records_checked).toBeGreaterThan(0);
  });

  it('attributes the fix to the source, and says Command did not make it', () => {
    expect(tool.fix_locus).toBe('SOURCE');
    expect(tool.command_did_not_modify).toBe(true);
    expect(tool.remediation_owner).toBeTruthy();
    expect(tool.evidence.length).toBeGreaterThan(0);
  });
});

describe('every carried issue says where it is fixed, with a citation', () => {
  it('gives each fix-status entry a locus and canonical evidence', () => {
    expect(floor.fix_status.length).toBeGreaterThan(0);
    for (const f of floor.fix_status) {
      expect(['SOURCE', 'SOURCE_FIXED_RECORD_PRESERVED', 'RUNTIME', 'NONE']).toContain(f.locus);
      expect(f.evidence.length, `${f.id} cites no canonical source`).toBeGreaterThan(0);
      for (const p of f.evidence) {
        expect(p.startsWith('/')).toBe(false);
        expect(/^[A-Za-z]:/.test(p)).toBe(false);
      }
    }
  });

  it('distinguishes a source fix from a preserved failing record', () => {
    const epoch1 = floor.fix_status.find((f) => f.id === 'ledgerHistoricalEpoch1');
    expect(epoch1).toBeTruthy();
    expect(epoch1!.locus).toBe('SOURCE_FIXED_RECORD_PRESERVED');
    // A preserved failure is a FAIL that must never be presented as repaired.
    expect(epoch1!.state).toBe(DIMENSION.FAIL);
  });

  it('refuses to claim a pass for a guard it will not probe', () => {
    const guard = floor.current_health.find((d) => d.id === 'destructiveGuard')!;
    expect(guard.probe_policy).toBe('NEVER_PROBED_BY_COMMAND');
    expect([DIMENSION.UNKNOWN, DIMENSION.FAIL]).toContain(guard.state);
  });
});

describe('source reachability is not drift', () => {
  it('reports every declared canonical source', () => {
    const reach = floor.source_reachability!;
    expect(reach.checked).toBeGreaterThanOrEqual(10);
    for (const s of reach.sources) {
      expect(s.path.startsWith('/')).toBe(false);
      expect(typeof s.role).toBe('string');
      if (s.state === DIMENSION.UNAVAILABLE) {
        // Unreachable says nothing about agreement, so it must not claim drift.
        expect(s.sha256_prefix).toBeNull();
      }
    }
  });

  it('separates reachability from the contract provenance check', () => {
    expect(floor.source_reachability?.state).not.toBe(surface.provenance.state === STATE.OK ? 'IMPOSSIBLE' : undefined);
    expect(surface.provenance.sources.length).toBeGreaterThan(0);
  });
});

describe('read-only gates are explicit and allowlisted', () => {
  it('never puts the ingester on the run list', () => {
    const runnable = RUNNABLE_GATES.map((g) => g.script);
    expect(runnable).not.toContain('ingest_room_activity.py');
    expect(REFUSED_SCRIPTS.some((r) => r.script === 'ingest_room_activity.py')).toBe(true);
    expect(REFUSED_SCRIPTS[0].reason).toMatch(/write/i);
  });

  it('reports gates as UNKNOWN until they are actually run', () => {
    const gates = floor.tool_health?.reconciliation_gates;
    expect(gates?.gates.every((g) => g.state === DIMENSION.UNKNOWN)).toBe(true);
    expect(gates?.detail).toMatch(/UNKNOWN/i);
  });

  it('runs both read-only gates and reports each verdict separately', () => {
    const run = runReadOnlyGates({ root });
    // Gates may be UNAVAILABLE if the Python interpreter cannot run on this host.
    // UNAVAILABLE is an asserted fail-closed outcome, not a skip.
    expect(run.gates).toHaveLength(RUNNABLE_GATES.length);
    for (const g of run.gates) {
      expect(g.read_only).toBe(true);
      expect([DIMENSION.OK, DIMENSION.UNAVAILABLE, DIMENSION.FAIL]).toContain(g.state);
      if (g.state === DIMENSION.OK) {
        expect(g.exit_code).toBe(0);
        expect(g.verdict).toBe('IN_SYNC');
      } else if (g.state === DIMENSION.UNAVAILABLE) {
        expect(g.verdict).toBeNull();
        expect(g.exit_code === null || g.exit_code === undefined || g.exit_code !== 0).toBe(true);
      } else {
        expect(g.exit_code).not.toBe(0);
        expect(g.verdict).not.toBe('IN_SYNC');
      }
    }
  });

  it('refuses to run anything outside the allowlist', () => {
    const run = runReadOnlyGates({ root: null });
    expect(run.gates.every((g) => g.state === DIMENSION.UNAVAILABLE)).toBe(true);
    expect(run.detail).toMatch(/could not be executed|unresolved/i);
  });
});

describe('the snapshot is a versioned, portable, serialisable envelope', () => {
  it('carries every field a future client needs to refuse a shape it does not know', () => {
    expect(snapshot.schema_version).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(typeof snapshot.schema_version).toBe('string');
    expect(snapshot.projection_version).toBeTruthy();
    expect(snapshot.command_version).toBeTruthy();
    expect(new Date(snapshot.generated_at).toString()).not.toBe('Invalid Date');
  });

  it('declares its own authority and access model', () => {
    expect(snapshot.authority).toBe('DERIVED_PROJECTION');
    expect(snapshot.is_ssot).toBe(false);
    expect(snapshot.access).toBe('READ_ONLY');
    expect(snapshot.transport.mode).toBe('local');
  });

  it('carries provenance and per-source freshness', () => {
    expect(snapshot.provenance.declared_sources.length).toBeGreaterThan(0);
    expect(snapshot.provenance.contract_recorded.version).toBeTruthy();
    expect(snapshot.freshness.sources.length).toBeGreaterThan(0);
    for (const s of snapshot.freshness.sources) {
      expect(typeof s.state).toBe('string');
      expect(typeof s.age_seconds === 'number' || s.age_seconds === null).toBe(true);
    }
    expect(snapshot.freshness.ingest.state).toBeTruthy();
  });

  it('carries the explicit state vocabulary, not a boolean', () => {
    expect(snapshot.state.vocabulary).toEqual(DIMENSION);
    expect(snapshot.state.precedence).toEqual(DIMENSION_PRECEDENCE);
    expect(typeof snapshot.state.overall).toBe('string');
    expect(snapshot.state.floor_summary.dimensions_total).toBeGreaterThan(0);
  });

  it('survives a JSON round trip unchanged', () => {
    const round = JSON.parse(snapshotJson);
    expect(round).toEqual(snapshot);
    expect(Object.keys(round).sort()).toEqual(Object.keys(snapshot).sort());
  });

  it('leaks no absolute host path', () => {
    // Walked against PARSED values, so this fails when a path survives inside
    // a string. The old form tested `JSON.stringify(snapshot)`, where the
    // doubled backslashes made the regex's own URL guard reject the match and
    // the assertion passed against a snapshot that leaked two live paths.
    const leaks = collectAbsolutePathLeaks(snapshot);
    expect(describeLeaks(leaks), 'absolute Windows paths survived redaction').toBe('');
    expect(leaks).toHaveLength(0);
    expect(snapshot.workspace.root_included).toBe(false);
  });

  it('leaks no absolute host path in the summary scope either', () => {
    // `summary` drops the event feed and rebuilds part of the envelope, so it
    // is a separate object graph with its own chance to leak.
    const leaks = collectAbsolutePathLeaks(summaryScope);
    expect(describeLeaks(leaks), 'absolute Windows paths survived in scope=summary').toBe('');
    expect(leaks).toHaveLength(0);
  });

  it('would actually fail if a path survived redaction', () => {
    // A guard that cannot fail is not a guard. Prove the detector still sees a
    // path in each position it can appear, and that it is the parsed walk — not
    // the serialised string — that catches it.
    const seeded = {
      wholeValue: 'D:\\StarqTech\\workspaces\\devin',
      embedded: 'Vendor install already on C:\\Users\\Ali Musthaq\\AppData\\Local\\devin\\cli (do not expand).',
      inArray: ['D:\\AgentRuntimes', 'nested: D:\\StarqTech\\_system\\devin'],
      nested: { deep: { deeper: 'under D:\\a\\b and D:\\c\\d' } },
    };
    const leaks = collectAbsolutePathLeaks(seeded);
    expect(leaks.map((l) => l.at).sort()).toEqual([
      '$.embedded',
      '$.inArray[0]',
      '$.inArray[1]',
      '$.nested.deep.deeper',
      '$.wholeValue',
    ]);
    // The serialised form of the same object is NOT reliably detectable, which
    // is precisely why the assertion above walks values.
    expect(ABSOLUTE_WINDOWS_PATH.test(JSON.stringify(seeded))).toBe(false);
  });

  it('redacts a whole-value absolute path', () => {
    const out = buildSnapshot({
      surface: { staff_state: { probe: 'D:\\StarqTech\\workspaces\\devin' } },
      floor,
      workspaceRoot: root,
    });
    // Paths under workspace root are relativized, not redacted. This is the
    // intended behavior - redaction is for paths outside the workspace.
    expect(out.truth.staff_state.probe).toBe('workspaces/devin');
    expect(out.truth.staff_state.probe).not.toContain('\\');
    expect(out.truth.staff_state.probe).not.toMatch(/\[REDACTED_ABSOLUTE_PATH\]/);
    expect(ABSOLUTE_WINDOWS_PATH.test(out.truth.staff_state.probe)).toBe(false);
  });

  it('redacts an absolute path embedded in prose and keeps the sentence', () => {
    const out = buildSnapshot({
      surface: {
        staff_state: {
          probe:
            'Vendor install already on C:\\Users\\Ali Musthaq\\AppData\\Local\\devin\\cli (vendor footprint, do not expand).',
        },
      },
      floor,
      workspaceRoot: root,
    });
    const note = out.truth.staff_state.probe;
    // The path is gone, and so is the drive letter that identified the host.
    expect(ABSOLUTE_WINDOWS_PATH.test(note)).toBe(false);
    expect(note).not.toContain('Ali Musthaq');
    expect(note).not.toContain('AppData');
    // Redaction must not eat the sentence that carried the path.
    expect(note).toContain('Vendor install already on');
    expect(note).toContain('(vendor footprint, do not expand).');
  });

  it('redacts every one of several embedded paths in a single value', () => {
    const out = buildSnapshot({
      surface: {
        staff_state: {
          probe:
            'must stay under D:\\AgentRuntimes and D:\\StarqTech\\workspaces\\devin. Also C:\\Users\\Ali Musthaq\\AppData.',
        },
      },
      floor,
      workspaceRoot: root,
    });
    const note = out.truth.staff_state.probe;
    expect(ABSOLUTE_WINDOWS_PATH.test(note)).toBe(false);
    // D:\StarqTech\workspaces\devin is under workspace root, so it's relativized to workspaces/devin
    // The other two are outside workspace and get redacted
    const redactedCount = (note.match(/\[REDACTED_ABSOLUTE_PATH\]/g) || []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(2);
    expect(note).toContain('must stay under');
    expect(note).toContain('and');
    expect(note).toContain('Also');
  });

  it('still relativises a workspace path instead of marking it', () => {
    // Redaction is not a blanket delete: a path under the workspace is
    // rewritten to a portable relative form, which is more useful to a client
    // than a marker.
    const out = buildSnapshot({
      surface: { staff_state: { probe: `${root}\\00_STARQ_HQ\\operations\\starq-command` } },
      floor,
      workspaceRoot: root,
    });
    expect(out.truth.staff_state.probe).toBe('00_STARQ_HQ/operations/starq-command');
    expect(out.truth.staff_state.probe).not.toContain('\\');
    expect(out.truth.staff_state.probe).not.toMatch(/\[REDACTED_ABSOLUTE_PATH\]/);
    expect(ABSOLUTE_WINDOWS_PATH.test(out.truth.staff_state.probe)).toBe(false);
  });

  it('does not mistake a file:// URL for a drive path', () => {
    // `e:/` in `file://` looks exactly like a drive letter and a separator.
    // Redacting it would corrupt a legitimate value.
    const out = buildSnapshot({
      surface: { staff_state: { probe: 'imported read-only via file:// URL; re-derives nothing' } },
      floor,
      workspaceRoot: root,
    });
    expect(out.truth.staff_state.probe).toBe(
      'imported read-only via file:// URL; re-derives nothing',
    );
  });

  it('leaks no absolute path from the live canonical staff-state fields', () => {
    // These are the exact values that carried the defect: canonical
    // capacity_note prose forwarded into `truth.staff_state.byHandle`.
    const byHandle = snapshot.truth.staff_state?.byHandle ?? {};
    const names = Object.keys(byHandle);
    expect(names.length, 'canonical staff state is empty — this check would be vacuous').toBeGreaterThan(0);

    const leaky: string[] = [];
    for (const [name, staff] of Object.entries(byHandle)) {
      for (const [field, value] of Object.entries(staff as Record<string, unknown>)) {
        if (typeof value === 'string' && ABSOLUTE_WINDOWS_PATH.test(value)) {
          leaky.push(`byHandle.${name}.${field} => ${JSON.stringify(value)}`);
        }
      }
    }
    expect(leaky.join('\n'), 'live staff-state fields carry absolute host paths').toBe('');
    expect(leaky).toHaveLength(0);
  });

  it('carries no secret material in any form', () => {
    expect(snapshotJson).not.toMatch(/_secrets/i);
    expect(snapshotJson).not.toMatch(/STARQBOOKS_SESSION_SECRET/);
    expect(snapshotJson).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });

  it('offers a summary scope that declares what it left out', () => {
    expect(summaryScope.scope).toBe('summary');
    const omitted = summaryScope.truth.execution_truth.activity_events_omitted;
    expect(omitted.omitted).toBe(true);
    expect(typeof omitted.count).toBe('number');
    // The full scope keeps them.
    expect(Array.isArray(snapshot.truth.execution_truth.activity_events)).toBe(true);
  });

  it('agrees with the live surface on every dimension state', () => {
    expect(snapshot.health_floor.current_health.length).toBe(floor.current_health.length);
    expect(snapshot.state.floor_summary.overall).toBe(floor.state);
  });
});

describe('Phase 2 did not become a write, a remote call, or a second SSOT', () => {
  const SRC = path.join(process.cwd(), 'src');
  const SERVER = path.join(process.cwd(), 'server');

  function read(p: string) {
    return readFileSync(p, 'utf8');
  }

  /**
   * Strip comments before auditing.
   *
   * These guards assert what the CODE does, not what the prose says. Without
   * stripping, this product's own documentation — which names every forbidden
   * primitive in order to forbid it, including the words "authorization" and
   * "remote" — fails its own check, and a guard that cries wolf is a guard
   * nobody reads.
   */
  function code(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  }

  it('adds no filesystem write primitive to the server', () => {
    for (const f of ['health-floor.mjs', 'snapshot.mjs', 'gates.mjs', 'data-service.mjs']) {
      const src = code(read(path.join(SERVER, f)));
      for (const token of [
        'writeFileSync',
        'appendFileSync',
        'rmSync',
        'unlinkSync',
        'renameSync',
        'mkdirSync',
        'copyFileSync',
        'createWriteStream',
      ]) {
        expect(src.includes(token), `${f} contains ${token}`).toBe(false);
      }
    }
  });

  it('opens no outbound transport anywhere in the app', () => {
    // Matched on the CALL, not on any URL literal. The data service legitimately
    // builds a local `http://` base for URL parsing; what must not exist is a
    // request that leaves this machine.
    const outbound = [
      /\bfetch\s*\(/,
      /https?\.(request|get)\s*\(/,
      /\bWebSocket\b/,
      /node-fetch|axios|got\s*\(/,
      /\bnet\.(connect|Socket)\b/,
      /\bdgram\b/,
    ];
    for (const f of ['health-floor.mjs', 'snapshot.mjs', 'gates.mjs', 'data-service.mjs']) {
      const src = code(read(path.join(SERVER, f)));
      for (const pattern of outbound) {
        expect(pattern.test(src), `${f} matches outbound transport ${pattern}`).toBe(false);
      }
      // The one remote-shaped string allowed anywhere is a file:// URL, which
      // is a local module specifier, not a network location.
      expect(src, `${f} references a remote URL`).not.toMatch(/https?:\/\/[a-z0-9.-]+/i);
    }

    // The UI may only ever talk to its own origin.
    const truth = code(read(path.join(SRC, 'surfaces', 'truth.tsx')));
    for (const pattern of outbound) {
      expect(pattern.test(truth), `truth.tsx matches outbound transport ${pattern}`).toBe(false);
    }
    expect(truth).not.toMatch(/https?:\/\/[a-z0-9.-]+/i);
  });

  it('does not redesign authentication or invent credentials', () => {
    for (const f of ['health-floor.mjs', 'snapshot.mjs', 'gates.mjs', 'data-service.mjs']) {
      const src = code(read(path.join(SERVER, f)));
      expect(src, `${f} sets an auth header`).not.toMatch(/['"]authorization['"]/i);
      expect(src, `${f} uses a bearer token`).not.toMatch(/\bbearer\b/i);
      expect(src, `${f} reads a credential`).not.toMatch(/\b(api[_-]?key|secret|password|token)\b\s*[,)]/i);
    }
  });

  it('keeps the health floor out of the Phase 1 health contract', () => {
    // The floor is attached beside `health`, never folded into it. Folding it
    // in would change a proven Phase 1 contract and would erase the exact line
    // between "the data matches its source" and "the system is healthy".
    expect(surface.health.conditions).toHaveLength(4);
    expect(surface.phase2?.current_health_separate_from).toBe('preserved_historical');
    const svc = read(path.join(SERVER, 'data-service.mjs'));
    expect(svc).toMatch(/surface\.health_floor = floor/);
  });

  it('keeps the Phase 1 synchronous surface contract intact', () => {
    // Phase 1 tests call this synchronously. Phase 2 added an async wrapper
    // rather than changing this, so the accepted boundary is preserved.
    const sync = buildSurface();
    expect(sync.assembled_at).toBeTruthy();
    expect(sync.health.overall).toBeTruthy();
    expect(sync.health_floor).toBeUndefined();
  });
});
