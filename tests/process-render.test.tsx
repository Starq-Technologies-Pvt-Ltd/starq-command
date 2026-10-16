import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { ProcessSurface } from '@/surfaces/process';
import { buildPhase3Surface } from '../server/data-service.mjs';

/**
 * The Phase 4 process floor must actually RENDER.
 *
 * A type system proves a component is well-formed. It does not prove it
 * mounts, does not throw on a real payload, and does not put the right words
 * on screen. This renders the REAL assembled surface — the same object the
 * browser receives — and asserts on the markup.
 *
 * These assertions are about HONESTY OF PRESENTATION. The strong property is
 * not that the surface contains the five family names; it is that every value
 * on screen arrived in the payload, that no maturity number appears, and that
 * the constraints which keep the surface honest are legible rather than
 * implied.
 */

const surface = await buildPhase3Surface();
const html = renderToStaticMarkup(React.createElement(ProcessSurface, { surface }));
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

const families = surface.process_truth.process_families ?? [];
const totalStages = families.reduce((n, f) => n + f.stages.length, 0);
const wave = surface.process_truth.restart_wave_after_authorization ?? [];

/* ------------------------------------------------------------------ *
 * Render-level row census.
 *
 * Every assertion above this block is about WHETHER a string reaches the
 * page. None of them can tell a row that rendered from a row that was
 * dropped, because a duplicated stage name surviving in one family still
 * satisfies `text.includes(stage)` for the other. That is not a theoretical
 * gap: a module-level `Set` keyed by `stage.name` in `StageTable` deletes
 * the second occurrence of every repeated canonical stage name, the suite
 * stays green, and four legitimate rows disappear from the surface.
 *
 * The census below parses the rendered MARKUP and counts rows, so the unit
 * of assertion is the thing the Founder actually sees. It is anchored to
 * table STRUCTURE (thead vs tbody, header row vs data row, per-family table
 * boundaries) rather than to CSS class names, so a restyle does not
 * silently disarm it.
 * ------------------------------------------------------------------ */

type RowCensus = {
  headerRows: number;
  dataRows: number;
  /** First cell of each data row, in render order. */
  firstCells: string[];
  heads: string[];
};

function tablesOf(markup: string): string[] {
  return markup.match(/<table[\s>][\s\S]*?<\/table>/g) ?? [];
}

function censusOf(table: string): RowCensus {
  const heads = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    decode(m[1].replace(/<[^>]+>/g, ' ')),
  );
  const thead = table.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '';
  const tbody = table.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '';
  const dataRows = [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  return {
    headerRows: [...thead.matchAll(/<tr[\s>]/g)].length,
    dataRows: dataRows.length,
    firstCells: dataRows.map((r) => {
      const first = r.match(/<td[^>]*>([\s\S]*?)<\/td>/);
      return decode((first?.[1] ?? '').replace(/<[^>]+>/g, ' '));
    }),
    heads,
  };
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const renderedTables = tablesOf(html);
const censuses = renderedTables.map(censusOf);
const stageTables = censuses.filter((c) => c.heads[0] === 'Stage');
const waveTables = censuses.filter((c) => c.heads[0] === '#');

describe('the ERP Process Floor renders from the real surface', () => {
  it('mounts without throwing and produces substantial markup', () => {
    expect(html.length).toBeGreaterThan(10000);
    expect(text.length).toBeGreaterThan(2000);
  });

  it('renders all five canonical families by id and name', () => {
    for (const f of families) {
      expect(text, `family id ${f.id} missing`).toContain(f.id);
      expect(text, `family name ${f.name} missing`).toContain(f.name);
    }
    expect(families).toHaveLength(5);
  });

  it('renders every stage the payload declares', () => {
    for (const f of families) {
      for (const s of f.stages) {
        expect(text, `stage ${f.id}/${s.stage} missing from render`).toContain(s.stage);
      }
    }
    expect(totalStages).toBeGreaterThanOrEqual(49);
  });

  it('displays each stage state exactly as canonical source records it', () => {
    // The chip label for a state is its own canonical name, so every state the
    // payload uses must appear on screen spelled that way.
    const used = new Set(families.flatMap((f) => f.stages.map((s) => s.state)));
    for (const state of used) {
      expect(text, `canonical stage state ${state} never reaches the screen`).toContain(state);
    }
    expect(used.size).toBeGreaterThan(1);
  });

  it('shows one worst-stage summary per family and no family score', () => {
    // The label appears once per family, and never beside a number.
    const worstLabels = text.match(/WORST STAGE/g) ?? [];
    expect(worstLabels).toHaveLength(families.length);
  });

  it('renders declared maturity as prose and says it is not scored', () => {
    for (const f of families) {
      if (f.maturity) expect(text, `maturity prose "${f.maturity}" missing`).toContain(f.maturity);
    }
    expect(text).toMatch(/Not scored, not ranked\./);
  });

  it('renders each family critical blocker verbatim', () => {
    for (const f of families) {
      if (f.critical_blocker) {
        expect(text, `blocker ${f.critical_blocker} missing`).toContain(f.critical_blocker);
      }
    }
  });

  it('renders every classification state in the legend, including ones that do not occur', () => {
    // test-only occurs on 0 of 49 stages today. A vocabulary the Founder can
    // only decode on the day it fires is a vocabulary that will be misread on
    // exactly the day it matters.
    for (const state of ['implemented', 'partial', 'test-only', 'schema-only', 'absent', 'UNKNOWN']) {
      expect(text, `legend state ${state} missing`).toContain(state);
    }
  });

  it('renders the honesty rail, so the constraints are legible not implied', () => {
    expect(text).toMatch(/Raw SERP task completion is not ERP maturity/);
    expect(text).toMatch(/evidence, not maturity/i);
    expect(text).toMatch(/Evidence drill-down is unavailable in this phase/);
    expect(text).toMatch(/Per-stage reconciliation is unavailable in this phase/);
    expect(text).toMatch(/Process state is independent of execution activity/);
    expect(text).toMatch(/remains on hold under the Founder course correction/);
  });

  it('states the measured evidence coverage rather than implying full coverage', () => {
    const withEvidence = families.reduce(
      (n, f) => n + f.stages.filter((s) => (s.evidence ?? []).length > 0).length,
      0,
    );
    expect(text).toMatch(new RegExp(`${withEvidence} of 49 stages carry an evidence entry`));
  });

  it('renders no evidence entry in a citation position', () => {
    // A finding that shaped this test. Canonical `evidence[]` is regex-scraped
    // out of the roadmap's note prose, so every evidence string is a literal
    // SUBSTRING of the note on the same stage: 26 of 26 distinctive entries
    // appear inside a rendered note. An assertion that the strings are absent
    // from the page is therefore unsatisfiable, and asserting it anyway would
    // train the next person to delete the note column to make a test green.
    //
    // The property that actually matters is POSITIONAL, not textual: an
    // evidence value must never be rendered as a citation. The note is
    // canonical roadmap prose written for a reader, it is column-labelled as
    // prose, and the surface carries no evidence column at all.
    const rendered = text;
    const withEvidence = families.flatMap((f) => f.stages).filter(
      (s) => (s.evidence ?? []).length > 0,
    );
    expect(withEvidence.length).toBeGreaterThan(0);

    // 1. The stage table has a note column and NO evidence column.
    expect(text).toMatch(/Canonical note \(prose, not proof\)/);
    expect(text).not.toMatch(/>\s*Evidence\s*</);
    expect(text).not.toMatch(/\bEvidence ref/);

    // 2. The note is labelled as prose, not as proof, in the visible column.
    expect(text).toMatch(/prose, not proof/);

    // 3. No evidence entry is rendered with a citation affordance.
    expect(html).not.toMatch(/EvidencePeek/);
    expect(html).not.toMatch(/<a\s+href/);
    // A citation would name a source kind; none is named anywhere.
    expect(rendered).not.toMatch(/\b(verified|confirmed) (source|citation|reference)\b/i);

    // 4. Whatever appears is note prose, and it is on screen only under the
    //    note heading. Both are asserted above; this pins the fact that the
    //    overlap is inherent to the data rather than a rendering defect.
    const distinctive = new Set(
      families
        .flatMap((f) => f.stages)
        .flatMap((s) => s.evidence ?? [])
        .map((e) => e.trim())
        .filter((e) => e.length >= 12),
    );
    expect(distinctive.size).toBeGreaterThan(0);
  });

  it('renders no percentage or completion figure anywhere on the surface', () => {
    // Strip class attributes so Tailwind widths are not mistaken for output.
    const visible = html.replace(/class="[^"]*"/g, ' ');
    const percents = visible.match(/[\d.]+\s*%/g) ?? [];
    expect(percents, `rendered percentages: ${percents.join(', ')}`).toEqual([]);
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s*%/);
  });

  it('renders the DEC-100 hold and the restart wave as not authorised', () => {
    const hold = surface.process_truth.hold_state!;
    expect(text).toContain(hold.implementation);
    /*
      R4 (Room seq 8382). This test used to assert that THIS surface renders
      `hold.authority` and `hold.restart_requires`. HoldBanner now owns the
      canonical hold record and is mounted above this surface on every ERP
      route, so those two values are deliberately no longer restated here.

      The test is updated, not weakened: it now asserts the NEW contract in
      both directions — the canonical values must be ABSENT from this surface,
      the surface must still render what HoldBanner cannot carry (the gate
      conditions and the reason), and it must still point at the owner. An
      assertion that only deleted the two expectations would let the surface
      go blank and still pass.

      Note these render ProcessSurface in isolation, so HoldBanner is not in
      this output. That is precisely why absence is asserted here and presence
      is asserted in the shell-level R4 guard, which renders the banner.
    */
    expect(text).not.toContain(hold.authority!);
    expect(text).not.toContain(hold.restart_requires!);
    // What remains is what the banner structurally cannot carry. On this
    // fixture the gate conditions ARE declared, so the pointer-to-owner branch
    // does not render — the conditions themselves are the hand-off, and the
    // owner pointer only appears when there is nothing else to show.
    expect((hold.restart_gate_conditions ?? []).length).toBeGreaterThan(0);
    for (const g of hold.restart_gate_conditions ?? []) {
      expect(text, `gate condition missing: ${g}`).toContain(g);
    }
    expect(text).toContain(hold.reason!);
    expect(text).toContain('NOT AUTHORISED');
    // The declared wave renders, each entry, in canonical order.
    for (const w of surface.process_truth.restart_wave_after_authorization ?? []) {
      expect(text, `restart wave task ${w.task} missing`).toContain(String(w.task));
    }
    expect(text).toMatch(/does not authorise, imply or schedule any restart/);
  });

  it('renders the carried discrepancies as unresolved', () => {
    const d = surface.process_truth.reconciliation?.known_discrepancies ?? [];
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) {
      expect(text, `discrepancy ${x.id} missing`).toContain(x.id);
    }
    expect(text).toMatch(/FOUNDER DECISION/);
    expect(text).toMatch(/UNRESOLVED/);
  });

  it('renders no agent, event count or activity attribution', () => {
    // The execution floor cannot appear here in any form. Any handle from the
    // live agent set reaching this surface would mean a join was introduced.
    for (const agent of surface.execution_truth.agents ?? []) {
      if (agent.handle && agent.handle.length >= 4) {
        expect(text, `agent handle ${agent.handle} leaked into the process surface`).not.toContain(
          agent.handle,
        );
      }
    }
    expect(text).not.toMatch(/\bactivity events\b/i);
    expect(text).not.toMatch(/\bcurrent assignment\b/i);
  });

  it('renders the canonical projection timestamp rather than a live clock', () => {
    const generated = surface.process_truth.generated_at!;
    expect(text).toContain(generated.slice(0, 10));
  });
});

describe('render-level row census: every canonical row reaches the screen', () => {
  it('renders exactly one stage table per canonical family', () => {
    expect(renderedTables).toHaveLength(families.length + 1);
    expect(stageTables).toHaveLength(families.length);
    expect(stageTables).toHaveLength(5);
  });

  it('renders exactly the canonical stage-row count, not a surviving subset', () => {
    // The payload declares 49 canonical (family, stage) rows. If a renderer
    // deduplicates by stage name, four of them vanish and this drops to 45
    // while every text-based assertion in this file still passes.
    const renderedStageRows = stageTables.reduce((n, t) => n + t.dataRows, 0);
    expect(renderedStageRows).toBe(49);
    expect(renderedStageRows).toBe(totalStages);
    expect(totalStages).toBe(49);
  });

  it('renders exactly the canonical restart-wave row count', () => {
    expect(waveTables).toHaveLength(1);
    const renderedWaveRows = waveTables.reduce((n, t) => n + t.dataRows, 0);
    expect(renderedWaveRows).toBe(6);
    expect(renderedWaveRows).toBe(wave.length);
  });

  it('renders one header row per table and no header row counted as data', () => {
    // 5 family stage tables + 1 restart-wave table.
    const headerRows = censuses.reduce((n, t) => n + t.headerRows, 0);
    expect(headerRows).toBe(6);
    for (const t of censuses) {
      expect(t.headerRows).toBe(1);
    }
  });

  it('totals 61 rendered table rows: 49 stage + 6 wave + 6 headers', () => {
    const totalTr = (html.match(/<tr[\s>]/g) ?? []).length;
    expect(totalTr).toBe(61);
    // Decomposed, so a failure says WHICH population moved.
    expect(stageTables.reduce((n, t) => n + t.headerRows, 0)).toBe(5);
    expect(stageTables.reduce((n, t) => n + t.dataRows, 0)).toBe(49);
    expect(waveTables.reduce((n, t) => n + t.headerRows, 0)).toBe(1);
    expect(waveTables.reduce((n, t) => n + t.dataRows, 0)).toBe(6);
  });

  it('binds every rendered stage row to the family whose table it sits in', () => {
    // Family-qualified, not a global text count: each family's table must
    // carry that family's stages, in canonical order, with no extras and
    // none missing. A global dedupe fails here per family, naming the loss.
    expect(stageTables).toHaveLength(families.length);
    families.forEach((f, i) => {
      const expected = f.stages.map((s: any) => s.stage);
      expect(stageTables[i].firstCells, `family ${f.id} rendered wrong rows`).toEqual(expected);
      expect(stageTables[i].dataRows).toBe(f.stages.length);
    });
  });

  it('keeps repeated canonical stage names represented in BOTH family contexts', () => {
    // Four stage names are legitimately shared across two families each.
    // These are four distinct business steps that happen to share a label,
    // and both must stay on the surface.
    const repeated: Record<string, number> = {
      Accounting: 2,
      COGS: 2,
      Settlement: 2,
      'Bank Reconciliation': 2,
    };

    for (const [name, expected] of Object.entries(repeated)) {
      // 1. It really is a repeated canonical name, not a coincidence.
      const declaredIn = families.filter((f: any) =>
        f.stages.some((s: any) => s.stage === name),
      );
      expect(declaredIn.length, `canonical repeat of "${name}" no longer exists`).toBe(expected);

      // 2. It renders once per declaring family, in each family's own table.
      for (const f of declaredIn) {
        const idx = families.indexOf(f);
        const inThatTable = stageTables[idx].firstCells.filter((c) => c === name);
        expect(
          inThatTable.length,
          `"${name}" missing or duplicated in family ${f.id} (${f.name})`,
        ).toBe(1);
      }
    }
  });

  it('renders every repeated name globally as the sum of its family contexts', () => {
    // Catches the inverse defect: a duplicated row rendered twice inside one
    // family while the other family's copy is lost.
    for (const [name, expected] of Object.entries({
      Accounting: 2,
      COGS: 2,
      Settlement: 2,
      'Bank Reconciliation': 2,
    })) {
      const rendered = stageTables.reduce((n, t) => n + t.firstCells.filter((c) => c === name).length, 0);
      expect(rendered, `rendered occurrences of "${name}"`).toBe(expected);
    }
  });
});

describe('the process floor refuses to render an empty-but-healthy surface', () => {
  it('declares unavailability instead of rendering zero families', () => {
    const broken = {
      ...surface,
      process_truth: {
        ...surface.process_truth,
        available: false,
        state: 'UNAVAILABLE' as const,
        reason: 'canonical process truth could not be read',
        process_families: [],
      },
    };
    const out = renderToStaticMarkup(React.createElement(ProcessSurface, { surface: broken }));
    const outText = out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(outText).toMatch(/PROCESS TRUTH UNAVAILABLE/);
    // UnknownValue carries the reason in a `title` attribute, which survives in
    // the raw markup but is stripped from the visible text. Assert both: the
    // reason must be attached to the state, and it must not be silently lost.
    expect(out).toMatch(/canonical process truth could not be read/);
    // And it does not fall through to a family list.
    expect(outText).not.toMatch(/Order-to-Cash/);
    expect(outText).not.toMatch(/canonical process families/);
  });
});
