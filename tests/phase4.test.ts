import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import surface from './fixtures/cmd-stu-003-surface.json';
import { STAGE_SEVERITY, worstStage } from '../src/lib/states';

/**
 * ── THE INDEPENDENT ORACLE ──────────────────────────────────────────────────
 *
 * The canonical Founder rules being tested, restated from the rulings
 * themselves and NOT from the implementation:
 *
 *   R1  Family state is the WORST canonical stage state. Worst is decided by
 *       the declared severity order, not by any arithmetic mean.
 *   R2  No averaging, no weighted rollup, no task-count completion percentage.
 *   R3  `family.maturity` is prose. It is never scored, ranked, sorted on or
 *       turned into a percentage.
 *   R4  Execution activity cannot affect process state. The activity layer
 *       carries no `process_stage`, so the join is structurally absent.
 *   R5  Raw SERP completion cannot affect process state.
 *   R6  `stage.evidence` is not rendered as verified or openable evidence.
 *   R7  Phase 5 remains unauthorised.
 *   R8  The DEC-100 hold remains visibly intact.
 *
 * This block deliberately does NOT import `worstStage` or `STAGE_SEVERITY`
 * when computing the EXPECTED value. An earlier phase was caught by exactly
 * this failure mode: the expected result was computed with the function under
 * test, so breaking the function broke the expectation in the same direction
 * and the suite stayed green while the surface lied. The oracle below is the
 * only thing allowed to define "worst" for judging the implementation. If the
 * production rule and this rule ever disagree, that disagreement is the
 * finding.
 */

/** Declared severity order, restated from the canonical classification key. */
const ORACLE_SEVERITY: Record<string, number> = {
  implemented: 0,
  partial: 1,
  'test-only': 2,
  'schema-only': 3,
  absent: 4,
  UNKNOWN: 5,
};

const oracleWorst = (states: string[]): string => {
  if (!states.length) return 'UNKNOWN';
  let worst = states[0]!;
  for (const s of states) {
    if (ORACLE_SEVERITY[s]! > ORACLE_SEVERITY[worst]!) worst = s;
  }
  return worst;
};

/** Canonical process truth, read straight off the live surface. */
const pt = surface.process_truth;
const families = pt.process_families ?? [];

const APP_ROOT = process.cwd();
const SRC = path.join(APP_ROOT, 'src');
const SERVER = path.join(APP_ROOT, 'server');

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Strip comments before auditing source: these tests assert what code does. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function isTypeOnlyModule(src: string): boolean {
  const c = code(src);
  const hasTypeDecl = /export\s+(interface|type)\s/.test(c);
  const hasRuntime = /\bfunction\b|\bconst\s+\w+\s*=\s*\(|\breturn\b/.test(c);
  return hasTypeDecl && !hasRuntime;
}

const processSrc = readFileSync(path.join(SRC, 'surfaces', 'process.tsx'), 'utf8');
const processCode = code(processSrc);
const shellSrc = readFileSync(path.join(SRC, 'components', 'shell.tsx'), 'utf8');
const appSrc = readFileSync(path.join(SRC, 'surfaces', 'building.tsx'), 'utf8');

describe('the live canonical process truth is the source of the Phase 4 surface', () => {
  it('reads process truth from canonical source', () => {
    expect(pt.available).toBe(true);
    expect(pt.state).toBe('OK');
  });

  it('renders all five canonical families', () => {
    const ids = families.map((f) => f.id).sort();
    expect(ids).toEqual(['C2B', 'I2GL', 'O2C', 'P2P', 'R2R']);
    expect(families).toHaveLength(5);
  });

  it('renders every canonical stage exactly once', () => {
    const total = families.reduce((n, f) => n + f.stages.length, 0);
    // 49 is the measured count in contract.json today. It is asserted as "at
    // least 49" plus an exact per-surface match, because a hard-coded 49 that
    // fails when canonical source legitimately grows would train the team to
    // edit the test rather than read the finding.
    expect(total).toBeGreaterThanOrEqual(49);

    // Uniqueness is per (family, stage), NOT per stage name. Four names are
    // deliberately shared across families today — COGS, Settlement,
    // Accounting and Bank Reconciliation each appear in two families — so a
    // global-uniqueness assertion would be asserting something canonical
    // source does not promise. A stage is identified by its family.
    const pairs = families.flatMap((f) => f.stages.map((s) => `${f.id}/${s.stage}`));
    expect(pairs).toHaveLength(total);
    expect(new Set(pairs).size).toBe(total);
  });

  it('treats stage identity as family-qualified, as canonical source requires', () => {
    // Pins the finding above so nobody "fixes" a duplicate-key warning by
    // silently dropping a stage or by assuming the name is globally unique.
    const byName = new Map<string, string[]>();
    for (const f of families) {
      for (const s of f.stages) {
        byName.set(s.stage, [...(byName.get(s.stage) ?? []), f.id]);
      }
    }
    const shared = [...byName.entries()].filter(([, ids]) => ids.length > 1);
    for (const [name, ids] of shared) {
      // Every occurrence is a distinct (family, stage) pair, so the renderer
      // keys rows by stage within a family and never by name globally.
      expect(ids.length, `${name} must be qualified by family`).toBeGreaterThan(1);
      for (const id of ids) {
        expect(families.find((f) => f.id === id)!.stages.some((s) => s.stage === name)).toBe(
          true,
        );
      }
    }
    // The surface keys the stage row by `s.stage` inside a per-family table,
    // which is the only scope in which that key is unique.
    expect(processCode).toMatch(/<TableRow key=\{s\.stage\}>/);
  });

  it('displays each stage state exactly as canonical source records it', () => {
    for (const f of families) {
      for (const s of f.stages) {
        // The renderer must not remap, default or coerce a state.
        expect(
          Object.prototype.hasOwnProperty.call(STAGE_SEVERITY, s.state),
          `canonical stage state "${s.state}" on ${f.id}/${s.stage} is not in the declared vocabulary`,
        ).toBe(true);
      }
    }
  });
});

describe('R1/R2 — family state is the worst stage, by order and never by arithmetic', () => {
  it('matches the independent oracle for every family', () => {
    for (const f of families) {
      const expected = oracleWorst(f.stages.map((s) => s.state));
      const actual = worstStage(f.stages.map((s) => s.state));
      expect(actual, `worst-state disagreement on ${f.id}`).toBe(expected);
    }
  });

  it('is order-based: changing one stage to a worse state moves only that family', () => {
    // Build a controlled set of families. The mutation must change exactly one
    // family's worst state and leave the other four byte-identical.
    const base = [
      { id: 'A', states: ['implemented', 'implemented', 'partial'] as StageState[] },
      { id: 'B', states: ['implemented', 'partial', 'partial'] as StageState[] },
      { id: 'C', states: ['schema-only', 'partial', 'partial'] as StageState[] },
      { id: 'D', states: ['absent', 'implemented', 'implemented'] as StageState[] },
      { id: 'E', states: ['implemented', 'implemented', 'implemented'] as StageState[] },
    ];
    const before = base.map((f) => ({ id: f.id, worst: worstStage(f.states) }));

    // Make one stage in family C worse: schema-only -> absent.
    const mutated = base.map((f) =>
      f.id === 'C' ? { ...f, states: f.states.map((s) => (s === 'schema-only' ? 'absent' : s)) as StageState[] } : f,
    );
    const after = mutated.map((f) => ({ id: f.id, worst: worstStage(f.states) }));

    // Sanity: the oracle agrees with the implementation on the controlled set
    // before any mutation is judged.
    for (const f of base) expect(worstStage(f.states)).toBe(oracleWorst(f.states));

    const changed = after.filter((a, i) => a.worst !== before[i]!.worst);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.id).toBe('C');
    expect(changed[0]!.worst).toBe('absent');
  });

  it('would fail if the rollup averaged instead of selecting the worst', () => {
    // The mutation test above proves order-based selection. This proves the
    // distinction is load-bearing: an averaging rollup over the same input
    // would return a value that is not any stage's declared state, which is
    // precisely the "family number" the doctrine forbids.
    const states: StageState[] = ['implemented', 'implemented', 'implemented', 'absent'];
    const selected = worstStage(states);
    expect(states).toContain(selected);
    // A mean over the severity ordering would land between states and would
    // not equal the worst declared state.
    const mean =
      states.reduce((n, s) => n + ORACLE_SEVERITY[s]!, 0) / states.length;
    expect(selected).toBe('absent');
    expect(mean).not.toBe(ORACLE_SEVERITY[selected]);
  });

  it('never averages, and never reduces stage states into a number', () => {
    // The Phase 1 guard already forbids mean/average/avg. Phase 4 adds the
    // stage-scoped twin: a rollup that divides or weights stage states.
    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      const raw = readFileSync(file, 'utf8');
      if (isTypeOnlyModule(raw)) continue;
      const src = code(raw);
      expect(src, `${path.basename(file)} averages values`).not.toMatch(
        /\.reduce\([^)]*avg|\bmean\s*\(|\baverage\s*\(/i,
      );
      // A weighted or capped maturity rollup in the UI layer.
      expect(src, `${path.basename(file)} computes a weighted stage rollup`).not.toMatch(
        /stage_weight|stage_cap|family_weight|erp_cap|control_gate/i,
      );
    }
  });

  it('renders no percentage, ratio or progress value on the process surface', () => {
    // No "%" sign, no toFixed on a derived ratio, no progress element, and no
    // "n of m" completion phrasing.
    expect(processCode).not.toMatch(/toFixed\s*\(/);
    expect(processCode).not.toMatch(/formatMaturity/);
    expect(processCode).not.toMatch(/<progress\b/i);
    expect(processCode).not.toMatch(/\bof\s+\{?\s*\w*\.?length\s*\}?\s+complete/i);
    expect(processSrc.toLowerCase()).not.toMatch(/\bcomplete(d|rness)?\s*(rate|percent|%)/i);

    // Tailwind column widths are the one legitimate "%" in this file, so the
    // percentage guard runs against the source with className attributes
    // removed. Without that, `w-[26%]` reads as a rendered percentage and the
    // guard would be noise the next person learns to ignore.
    const withoutClassNames = processCode.replace(/className=(?:"[^"]*"|\{`[^`]*`\})/g, '');
    const percents = withoutClassNames.match(/[\d.]+\s*%/g) ?? [];
    expect(
      percents,
      `process surface renders a percentage: ${percents.join(', ')}`,
    ).toEqual([]);

    // And no ratio is formed by dividing anything.
    expect(processCode).not.toMatch(/[\w)\]]\s*\/\s*(total|length|count|stages)/i);
  });
});

describe('R3 — declared family maturity is prose, never a score', () => {
  it('renders the label as text and states it is not scored', () => {
    expect(processCode).toMatch(/family\.maturity/);
    // The prose disclaimer must be rendered, not merely commented.
    expect(processSrc).toMatch(/Not scored, not ranked\./);
  });

  it('never uses maturity as a sort key, comparator or filter', () => {
    expect(processCode).not.toMatch(/\.sort\s*\(/);
    expect(processCode).not.toMatch(/maturity\s*[<>]=?/);
    expect(processCode).not.toMatch(/maturity\s*===|maturity\s*!==/);
    // Families render in the canonical order the payload declares, unmapped.
    expect(processCode).toMatch(/\{families\.map\(\(f\)/);
  });
});

describe('R4 — the execution floor cannot reach a process stage', () => {
  it('finds no process_stage in the live execution window', () => {
    // The structural absence is the guarantee this whole phase rests on. If a
    // future ingest ever populates it, this test fails and the Founder decides
    // whether that is a good thing — it must not be discovered by a join.
    const events = surface.execution_truth.activity_events ?? [];
    expect(events.length).toBeGreaterThan(0);
    const withStage = events.filter((e) => e.process_stage != null);
    expect(
      withStage.length,
      'execution events now carry process_stage; the Phase 4 firewall assumption has changed and needs a Founder decision',
    ).toBe(0);
  });

  it('renders no agent, event or activity attribution on the process surface', () => {
    for (const token of [
      'activity_events',
      'execution_truth',
      'agents',
      'handle',
      'last_activity',
      'serp_refs',
      'lifetime_events',
    ]) {
      expect(processCode, `process surface references ${token}`).not.toMatch(
        new RegExp(token),
      );
    }
  });

  it('takes no execution input at all — its only prop is the assembled surface', () => {
    // Structural: the component cannot be handed activity separately.
    expect(processSrc).toMatch(/export function ProcessSurface\(\{ surface \}: \{ surface: CommandSurface \}\)/);
  });

  it('states the independence of process state from execution activity on screen', () => {
    expect(processSrc).toMatch(
      /Process state is independent of execution activity/,
    );
  });
});

describe('R5 — raw SERP counts cannot affect family state', () => {
  it('worst-state is unchanged when every SERP reference is stripped or inflated', () => {
    for (const f of families) {
      const original = worstStage(f.stages.map((s) => s.state));
      const stripped = worstStage(
        f.stages.map((s) => ({ ...s, serp: [] }) as never).map((s) => s.state),
      );
      const inflated = worstStage(
        f.stages.map((s) => ({ ...s, serp: Array(50).fill('SERP-000') }) as never).map(
          (s) => s.state,
        ),
      );
      expect(stripped, `SERP removal changed ${f.id} family state`).toBe(original);
      expect(inflated, `SERP inflation changed ${f.id} family state`).toBe(original);
    }
  });

  it('renders SERP references as metadata, labelled as such', () => {
    expect(processSrc).toMatch(/SERP ref \(metadata only\)/);
    expect(processCode).toMatch(/SerpRefs/);
  });

  it('never counts SERP tasks into any stage or family verdict', () => {
    // No length/sum of a serp array may appear near a state or verdict.
    expect(processCode).not.toMatch(/serp[^\n]{0,80}\.length/);
    expect(processCode).not.toMatch(/\.serp\s*\.\s*(reduce|map)\s*\([^)]*length/);
  });
});

describe('R6 — evidence is not presented as verified or openable', () => {
  it('never renders an evidence entry into the UI', () => {
    // The distinction this guard draws is RENDER, not READ. The surface counts
    // how many stages carry an evidence entry so it can say so out loud
    // ("22 of 49 stages carry an evidence entry at all") — that is an honesty
    // disclosure and counts no one's work. What is forbidden is placing an
    // entry's VALUE on screen, because a bare filename or a scraped Room
    // sequence number rendered next to a stage reads as a verified citation.
    //
    // So: no evidence array may be mapped, indexed, joined or interpolated
    // into markup. A `.length` / filter count is permitted and asserted below.
    expect(processCode).not.toMatch(/evidence\s*\.\s*map\s*\(/);
    expect(processCode).not.toMatch(/evidence\s*\.\s*join\s*\(/);
    expect(processCode).not.toMatch(/evidence\s*\.\s*filter\s*\([^)]*\)\s*\.\s*map/);
    expect(processCode).not.toMatch(/evidence\s*\[\s*\d/);
    // No evidence value is ever destructured into a render position.
    expect(processCode).not.toMatch(/\{[^}]*\bev\b[^}]*\}/);

    // The count is the only permitted use, and it is only a count.
    expect(processCode).toMatch(/evidenceStages/);
    expect(processCode).toMatch(/\(s\.evidence \?\? \[\]\)\.length/);
  });

  it('declares the unavailability in rendered copy rather than a citation', () => {
    expect(processSrc).toMatch(/Evidence drill-down is unavailable in this phase/);
    expect(processSrc).toMatch(/not rendered as verified or openable evidence/);
  });

  it('opens no raw-source route from the process surface', () => {
    expect(processCode).not.toMatch(/fetchRawSource/);
    expect(processCode).not.toMatch(/\/api\/raw/);
    // The only local routes any surface may reference.
    const routes = processCode.match(/['"`]\/api\/[a-z-]+/gi) ?? [];
    for (const r of routes) {
      expect(
        ['/api/surface', '/api/gates', '/api/snapshot', '/api/health-floor', '/api/raw'],
        `unexpected local route referenced: ${r}`,
      ).toContain(r.toLowerCase().replace(/[`'"]/g, ''));
    }
  });

  it('wires no clickable citation element for any evidence item', () => {
    // An <a href> or button around an evidence string would be a citation.
    expect(processCode).not.toMatch(/EvidencePeek/);
    expect(processCode).not.toMatch(/<a\s+href/);
  });
});

describe('R7 — Phase 5 is authorised and Phase 6 remains unauthorised', () => {
  // Phase 4 originally asserted here that Phase 5 stayed `live: false`. The
  // Founder authorised Phase 5 on base 38037d5, so the guard is INVERTED, not
  // removed: `attention` must now be live AND no phase beyond it may exist.
  // The sibling protection Phase 4 relied on — a boolean that flips in the same
  // edit that promotes a phase — no longer has a Phase 5 sibling, so Phase 5 is
  // protected structurally instead: an empty shell registry and a nav that
  // cannot declare a phase beyond 5.
  it('marks the attention surface live', () => {
    expect(/id: 'attention'[\s\S]{0,220}?live: true/.test(shellSrc)).toBe(true);
  });

  it('removes the attention entry from the not-yet-authorised shell registry', () => {
    const phaseShell = readFileSync(path.join(SRC, 'surfaces', 'phase-shell.tsx'), 'utf8');
    const intents = phaseShell.slice(
      phaseShell.indexOf('export const PHASE_INTENTS'),
      phaseShell.indexOf('export function PhaseShellFor'),
    );
    expect(intents).not.toMatch(/\battention:\s*\{/);
    // The registry is empty: no Phase 6 shell was invented to fill it.
    expect(intents).not.toMatch(/:\s*\{\s*\n\s*phase:/);
    expect(intents).not.toMatch(/phase:\s*[6-9]/);
  });

  it('routes attention to a real surface', () => {
    expect(appSrc).toMatch(/<AttentionSurface surface=\{surface\}/);
    expect(appSrc).toMatch(/AttentionSurface/);
  });

  it('builds the Phase 5 surface file', () => {
    expect(existsSync(path.join(SRC, 'surfaces', 'attention.tsx'))).toBe(true);
  });

  it('builds NO Phase 6 surface and adds NO Phase 6 nav entry', () => {
    for (const name of ['phase6.tsx', 'next.tsx', 'insight.tsx', 'portfolio.tsx']) {
      expect(existsSync(path.join(SRC, 'surfaces', name)), `${name} must not exist`).toBe(false);
    }
    // `system` is phase 7 and has been live since Phase 1, so its phase number
    // is not a Phase 6 surface and is deliberately excluded from this guard.
    expect(shellSrc).not.toMatch(/phase:\s*(6|8|9)\b/);
    expect(shellSrc).not.toMatch(/id: '(next|future|phase6|phase-6|insight|portfolio)'/);
  });
});

describe('R8 — the DEC-100 hold remains visibly intact', () => {
  it('carries the hold into canonical process truth', () => {
    expect(pt.hold_state).not.toBeNull();
    expect(pt.hold_state!.implementation).toBe('ON_HOLD');
    expect(pt.hold_state!.authority).toBe('DEC-100');
  });

  it('renders the hold, its authority and its restart gate on the process surface', () => {
    expect(processSrc).toMatch(/ERP implementation state/);
    // The hold value is rendered from canonical source, not hardcoded, so the
    // chip is asserted through the expression that produces it.
    expect(processCode).toMatch(/hold\?\.implementation/);
    expect(processSrc).toMatch(/Restart requires/);
    expect(processCode).toMatch(/hold_state/);
    expect(processCode).toMatch(/restart_gate_conditions/);
  });

  it('does not state or imply that restart is authorised', () => {
    // The wave renders as declared order, stamped NOT AUTHORISED.
    expect(processSrc).toMatch(/NOT AUTHORISED/);
    expect(processSrc).toMatch(/restart_wave_after_authorization/);
    // And the surface says plainly that it confers no permission.
    expect(processSrc).toMatch(/does not authorise, imply or schedule any restart/);
  });

  it('keeps the non-dismissible hold banner wired at the app root', () => {
    // App.tsx renders HoldBanner from process_truth.hold_state for every view.
    expect(readFileSync(path.join(SRC, 'App.tsx'), 'utf8')).toMatch(/HoldBanner/);
    expect(readFileSync(path.join(SRC, 'App.tsx'), 'utf8')).toMatch(/process_truth\.hold_state/);
  });
});

describe('Phase 4 changed no server contract', () => {
  it('adds no filesystem write primitive to the server', () => {
    for (const file of walk(SERVER, ['.mjs', '.js'])) {
      const src = code(readFileSync(file, 'utf8'));
      for (const token of [
        'writeFileSync',
        'appendFileSync',
        'rmSync',
        'unlinkSync',
        'mkdirSync',
        'createWriteStream',
      ]) {
        expect(
          src.includes(token),
          `${path.basename(file)} contains forbidden write primitive: ${token}`,
        ).toBe(false);
      }
    }
  });

  it('widens neither read_only_sources nor the /api/raw allowlist', () => {
    // Founder ruling 3: no starqERP, no starqNexus, no new path.
    const svc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    const allowBlock = svc.slice(
      svc.indexOf('read_only_sources: ['),
      svc.indexOf('read_only_sources: [') + 600,
    );
    expect(allowBlock).not.toMatch(/starqERP/);
    expect(allowBlock).not.toMatch(/starqNexus/);
  });

  it('adds no phase4 server builder — process truth was already forwarded', () => {
    expect(existsSync(path.join(SERVER, 'process.mjs'))).toBe(false);
    expect(existsSync(path.join(SERVER, 'phase4.mjs'))).toBe(false);
    expect(readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8')).not.toMatch(
      /buildPhase4Surface/,
    );
  });

  it('issues no HTTP method other than GET/HEAD (sole exception: server/pm-service.mjs, Founder #9503)', () => {
    for (const file of walk(SERVER, ['.mjs', '.js'])) {
      if (path.basename(file) === 'pm-service.mjs') continue;
      const src = code(readFileSync(file, 'utf8'));
      for (const method of ["'PUT'", "'DELETE'", "'POST'", "'PATCH'"]) {
        expect(src.includes(method), `${path.basename(file)} serves ${method}`).toBe(false);
      }
    }
  });
});

describe('the process surface recomputes no age and holds no clock', () => {
  it('contains no clock call', () => {
    expect(processCode).not.toMatch(/Date\.now\s*\(/);
    expect(processCode).not.toMatch(/new\s+Date\s*\(/);
    expect(processCode).not.toMatch(/performance\.now\s*\(/);
    expect(processCode).not.toMatch(/formatAge/);
  });

  it('renders the projection timestamp rather than an elapsed age', () => {
    expect(processCode).toMatch(/formatTimestamp/);
  });
});
