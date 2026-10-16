/**
 * Phase 7 FINAL UX CORRECTIVE PASS (R4 + R5) — targeted guards.
 *
 * Mission: Room seq 8382. Findings from Goose's seq 8381 re-verification
 * (VERDICT PARTIAL; R4 DEFECT, R5 PARTIAL). OpenCode PASS at seq 8377 on the
 * behavioural/route lane is not re-litigated here.
 *
 *   R4  HoldBanner is a defensible owner; ERP tab duplication was NOT removed.
 *   R5  .label-sec is defined but effectively unapplied.
 *
 * WHY THIS FILE IS WRITTEN THE WAY IT IS
 *
 * The previous round's R4 guard covered only the two files that round had
 * edited — RoomHeadline and ErpFocus — so five surviving presentation sites
 * went unguarded and the 12/12 mutation proof still passed. A guard written
 * from the files you just changed cannot see the files you did not. That is
 * the actual mechanism behind seq 8374's overclaim, so the guards here are
 * driven from a CENSUS of every surface file, not from a list of edited files.
 *
 * Every assertion below is checked against source with comments stripped,
 * because each fix is documented at the point of the fix and names the exact
 * expression it removed — a naive substring check matches its own explanation.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(APP_ROOT, 'src');
const SURFACES = path.join(SRC, 'surfaces');

const raw = (...p: string[]) => readFileSync(path.join(...p), 'utf8');

/** Source with block and line comments removed. */
const code = (...p: string[]) =>
  raw(...p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * EVERY .tsx file under src/, by census.
 *
 * This is the fix for the round-2 gap. Enumerating the directory means a new
 * surface that restates the hold record is covered automatically; hardcoding
 * the five known paths would reproduce exactly the defect being corrected.
 */
const ALL_TSX = readdirSync(SRC, { recursive: true })
  .filter((f): f is string => typeof f === 'string' && f.endsWith('.tsx'))
  .map((f) => path.join(SRC, f));

const SURFACE_FILES = readdirSync(SURFACES).filter((f) => f.endsWith('.tsx'));

/* ═══════════════════════════════════════════════════════════════════════════
 * R4 — HoldBanner is the single owning canonical hold presentation.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R4 — HoldBanner owns the canonical hold record', () => {
  it('the banner exists, is non-dismissible, and is mounted on every ERP route', () => {
    const gate = raw(SRC, 'components', 'state-gate.tsx');
    const app = code(SRC, 'App.tsx');

    // The owner's own contract.
    expect(gate).toMatch(/persistent, non-dismissible/);
    const banner = gate.slice(gate.indexOf('export function HoldBanner'));
    expect(banner).not.toMatch(/onClose|dismissible/);

    // Mounted, and gated on the ERP room exactly as seq 8381 verified.
    expect(app).toMatch(/route\.room === 'erp'[\s\S]{0,200}?<HoldBanner/);
    // It receives all three canonical values.
    for (const prop of ['authority=', 'effective=', 'restartRequires=']) {
      expect(app, `banner does not receive ${prop}`).toContain(prop);
    }
  });

  it('NO surface file restates the canonical HOLD record', () => {
    /*
      The census assertion. Every .tsx under src/ is scanned for a READ of a
      canonical hold field. App.tsx is excluded because App.tsx is what mounts
      the banner and therefore must read those fields to pass them in — that
      read is the owner's, not a duplicate presentation.

      Scope is `hold*` only, and that precision matters. attention.tsx renders
      `authority {gb.authority}` for the GLOBAL BLOCKER, which is a different
      canonical fact with its own authority field, sits in its own card, and was
      not among the sites Goose named. A guard written as "no `.authority`
      anywhere" flags it, and would have had me delete a correct surface. The
      claim under test is narrower: the HOLD record is presented once.
    */
    const offenders: string[] = [];
    for (const file of ALL_TSX) {
      const base = path.basename(file);
      // The two files that ARE the owner, or that mount it. App.tsx reads the
      // fields to pass them into HoldBanner; state-gate.tsx DEFINES HoldBanner
      // and so of course renders "restart requires". Neither is a duplicate
      // presentation — both are the single presentation.
      if (base === 'App.tsx' || base === 'state-gate.tsx') continue;
      const body = code(file);
      const patterns: [string, RegExp][] = [
        ['authority', /\bhold\w*\??\.\s*authority\b/g],
        ['effective', /\bhold\w*\??\.\s*effective\b/g],
        ['restart_requires', /\bhold\w*\??\.\s*restart_requires\b/g],
        ['restart_requires (text)', /\brestart requires\b/gi],
      ];
      for (const [field, re] of patterns) {
        if (re.test(body)) offenders.push(`${path.relative(APP_ROOT, file)} -> ${field}`);
      }
    }
    expect(
      offenders,
      `canonical HOLD record restated outside HoldBanner:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the five sites Goose seq 8381 named are individually clean', () => {
    // Explicit, so a future edit that reintroduces one names the site.
    const named = [
      'erp-room.tsx',
      'overview.tsx',
      'process.tsx',
      'attention.tsx',
      'truth.tsx',
    ];
    for (const f of named) {
      expect(SURFACE_FILES, `${f} is not a surface file`).toContain(f);
      const body = code(SURFACES, f);
      // Scoped to hold reads — `gb.authority` (global blocker) is a different
      // canonical fact and is deliberately still rendered.
      expect(body, `${f} still reads hold.authority`).not.toMatch(/\bhold\w*\??\.\s*authority\b/);
      expect(body, `${f} still reads hold.effective`).not.toMatch(/\bhold\w*\??\.\s*effective\b/);
      expect(body, `${f} still reads restart_requires`).not.toMatch(/restart_requires/);
    }
  });

  it('what HoldBanner CANNOT carry survives on the tab surfaces', () => {
    /*
      The other direction, and the one that stops this being a deletion.
      De-duplication that removes the operator's only copy of the restart gate
      conditions would be information loss, not correction. The ordered gate
      conditions are a LIST; a one-line banner has nowhere to put one.
    */
    for (const f of ['process.tsx', 'attention.tsx', 'overview.tsx']) {
      const body = code(SURFACES, f);
      expect(body, `${f} lost the gate conditions`).toMatch(/restart_gate_conditions/);
    }
    // The narrative reason is per-surface detail and is preserved.
    for (const f of ['process.tsx', 'attention.tsx']) {
      expect(code(SURFACES, f), `${f} lost hold.reason`).toMatch(/hold\.reason|hold\?\.reason/);
    }
  });

  it('the honesty branches for an ABSENT hold_state are untouched', () => {
    /*
      Critical distinction. Goose's Evidence-tab authority=0 is the absence
      case, not duplication. An UnknownValue branch reporting that canonical
      source carries no hold_state is a truth statement, and HoldBanner does
      not render at all when hold_state is absent — so removing these would
      delete honesty, not duplication.
    */
    const attention = code(SURFACES, 'attention.tsx');
    expect(attention).toMatch(/holdPresent/);
    expect(attention).toMatch(/SOURCE MISSING/);
    const process = code(SURFACES, 'process.tsx');
    expect(process).toMatch(/carries no hold_state/);
  });

  it('convergence-not-rewrite keeps its absence signal on Attention', () => {
    /*
      attention.tsx renders this as DECLARED / NOT DECLARED. HoldBanner renders
      it only when TRUE, as an italic aside — so the negative case is
      information the banner structurally cannot carry. It stays, and that is a
      deliberate judgement recorded in the source, not an oversight.
    */
    const attention = code(SURFACES, 'attention.tsx');
    expect(attention).toMatch(/convergence_not_rewrite/);
    expect(attention).toMatch(/NOT DECLARED/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R5 — the secondary tier exists in the PRODUCT, not only in the stylesheet.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('R5 — .label-sec is applied to visible product structure', () => {
  const css = raw(SRC, 'index.css');

  it('is still defined, and still differs from .label-micro by weight', () => {
    expect(css).toContain('.label-sec');
    const sec = css.slice(css.indexOf('.label-sec {'), css.indexOf('}', css.indexOf('.label-sec {')));
    const micro = css.slice(
      css.indexOf('.label-micro {'),
      css.indexOf('}', css.indexOf('.label-micro {')),
    );
    expect(sec).toMatch(/font-semibold/);
    expect(micro).toMatch(/font-medium/);
  });

  it('is used at MULTIPLE sites, not once', () => {
    // seq 8381: "used at exactly ONE site in all of src/**". That is the defect.
    const sites = ALL_TSX.filter((f) => /className="label-sec/.test(code(f)));
    expect(
      sites.length,
      `.label-sec is used in only ${sites.length} file(s): ${sites
        .map((f) => path.basename(f))
        .join(', ')}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('is used on VISIBLE surfaces, not only the one hidden below 800px', () => {
    /*
      The sharper half of seq 8381's finding. Before: one site, and that site
      was display:none under 800px, so the tier changed nothing an operator
      sees. The rail site is allowed to keep using it, but it must not be the
      ONLY site — otherwise the declaration is still decoration.
    */
    const railOnly = path.join(SRC, 'components', 'shell.tsx');
    const otherSites = ALL_TSX.filter(
      (f) => f !== railOnly && /className="label-sec/.test(code(f)),
    );
    expect(
      otherSites.length,
      '.label-sec appears only in shell.tsx, whose only use is hidden below 800px',
    ).toBeGreaterThanOrEqual(2);
    for (const f of otherSites) {
      expect(path.basename(f), `${f} should be a room surface`).not.toBe('shell.tsx');
    }
  });

  it('no CSS rule hides every .label-sec site at any width', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 800px)'));
    // The rail heading may be hidden; the rule must be scoped to the rail.
    const hidden = narrow.match(/[^{}]*label-sec[^{]*\{[^}]*display:\s*none/g) ?? [];
    for (const rule of hidden) {
      expect(rule, `unscoped label-sec hide: ${rule}`).toContain('data-rail-projection');
    }
  });

  it('the ladder is walkable: h2 > label-sec > label-micro all still exist', () => {
    expect(css).toMatch(/\.command-panel h2/);
    expect(css).toMatch(/\.command-panel h3/);
    expect(css).toMatch(/\.label-micro/);
    // And .label-micro is still widely used, so the tier is a refinement
    // rather than a replacement of the existing vocabulary.
    const microSites = ALL_TSX.filter((f) => /className="label-micro/.test(code(f)));
    expect(microSites.length).toBeGreaterThanOrEqual(5);
  });

  it('the R5 work did not become a global typography redesign', () => {
    // Scope guard. The tier was applied to group headings; the existing
    // near-identical small sizes were deliberately NOT re-tuned this round.
    const micro = css.slice(
      css.indexOf('.label-micro {'),
      css.indexOf('}', css.indexOf('.label-micro {')),
    );
    expect(micro).toMatch(/text-micro/);
    // The stat/chip/dt sizes Goose listed as still-collapsed are untouched.
    expect(css).toMatch(/\.stat \.k/);
    expect(css).toMatch(/\.chip \{/);
  });
});
