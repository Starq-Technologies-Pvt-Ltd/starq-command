import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Architectural guard tests.
 *
 * These are not rendering tests. They assert the rules that make STARQ //
 COMMAND trustworthy, and they fail the build if a future change quietly
 * breaks one. The rules come straight from the Founder's architecture
 * constraints; a regression here is a governance regression, not a bug.
 */

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

/**
 * Strip comments before auditing source.
 *
 * These guards assert what the CODE does, not what the prose mentions.
 * Without stripping, this file's own documentation — which names every
 * forbidden primitive in order to forbid it — would fail its own check.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * True for modules that only declare types.
 *
 * A type file legitimately NAMES canonical fields (family_weight and friends)
 * in order to type them. Declaring the shape of a forwarded value is the
 * opposite of computing one, so type-only modules are exempt from the
 * computation guards and still audited for hardcoded data.
 */
function isTypeOnlyModule(src: string): boolean {
  const c = code(src);
  const hasTypeDecl = /export\s+(interface|type)\s/.test(c);
  const hasRuntime = /\bfunction\b|\bconst\s+\w+\s*=\s*\(|\breturn\b/.test(c);
  return hasTypeDecl && !hasRuntime;
}

describe('read-only enforcement', () => {
  const serverFiles = walk(SERVER, ['.mjs', '.js']);

  it('finds the server to audit', () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it('contains no filesystem write primitives', () => {
    const forbidden = [
      'writeFileSync',
      'appendFileSync',
      'rmSync',
      'unlinkSync',
      'renameSync',
      'mkdirSync',
      'copyFileSync',
      'truncateSync',
      'createWriteStream',
      'fs.write',
    ];
    for (const file of serverFiles) {
      const src = code(readFileSync(file, 'utf8'));
      for (const token of forbidden) {
        expect(
          src.includes(token),
          `${path.basename(file)} contains forbidden write primitive: ${token}`,
        ).toBe(false);
      }
    }
  });

  // Founder #9503: the human-operated PM service is the single authorized write
  // route. Every OTHER server file must still serve GET/HEAD only.
  it('issues no HTTP method other than GET/HEAD (sole exception: server/pm-service.mjs)', () => {
    for (const file of serverFiles) {
      if (path.basename(file) === 'pm-service.mjs') continue;
      const src = code(readFileSync(file, 'utf8'));
      expect(src.includes("'PUT'")).toBe(false);
      expect(src.includes("'DELETE'")).toBe(false);
      expect(src.includes("'POST'")).toBe(false);
      expect(src.includes("'PATCH'")).toBe(false);
    }
  });

  it('server/pm-service.mjs is the ONLY write-capable server file, is loopback-only and cannot reach Herdr, the TaskStore or control-plane.db', () => {
    const methods = ["'PUT'", "'DELETE'", "'POST'", "'PATCH'"];
    const writers = serverFiles
      .filter((file) => methods.some((m) => code(readFileSync(file, 'utf8')).includes(m)))
      .map((file) => path.basename(file));
    expect(writers).toEqual(['pm-service.mjs']);

    const pm = code(readFileSync(path.join(SERVER, 'pm-service.mjs'), 'utf8'));
    expect(pm).not.toMatch(/from\s+['"][^'"]*(herdr|task-store|control-plane|integrations)[^'"]*['"]/i);
    expect(pm).not.toMatch(/\bTaskStore\b|control-plane\.db|createHerdrService/);
    expect(pm).toMatch(/const HOST = '127\.0\.0\.1'/);
    expect(pm).toMatch(/CANONICAL\.pmBoardDb/);
  });
});

describe('no business maturity computation in the UI layer', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']).filter((f) => !f.endsWith('.d.ts'));

  it('finds UI files to audit', () => {
    expect(uiFiles.length).toBeGreaterThan(0);
  });

  it('never computes a weighted maturity rollup in React', () => {
    // The product rule: scoring and maturity rollups stay outside React.
    // A component that divides stage weights or applies a cap is a violation.
    const forbidden = [
      /stage_cap/i,
      /stage_weight\s*\[/i,
      /family_weight/i,
      /erp_cap/i,
      /control_gate/i,
    ];
    for (const file of uiFiles) {
      const raw = readFileSync(file, 'utf8');
      // A type-only module names canonical scoring fields in order to type
      // them; that is declaration, not computation.
      if (isTypeOnlyModule(raw)) continue;
      const src = code(raw);
      for (const pattern of forbidden) {
        expect(
          pattern.test(src),
          `${path.basename(file)} matches forbidden scoring pattern ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it('does not average stage states to produce a family number', () => {
    // Colour by worst, never by average. An arithmetic mean over stage
    // states is exactly the averaging this product forbids.
    const averaging = /\.reduce\([^)]*avg|\bmean\s*\(|\baverage\s*\(/i;
    for (const file of uiFiles) {
      const raw = readFileSync(file, 'utf8');
      if (isTypeOnlyModule(raw)) continue;
      const src = code(raw);
      expect(
        averaging.test(src),
        `${path.basename(file)} appears to average values`,
      ).toBe(false);
    }
  });
});

describe('no task-count completion masquerading as maturity', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']);

  it('labels L1 as informational wherever it is rendered', () => {
    const filesWithL1 = uiFiles.filter((f) => readFileSync(f, 'utf8').includes('L1'));
    expect(filesWithL1.length).toBeGreaterThan(0);
    const combined = filesWithL1.map((f) => readFileSync(f, 'utf8')).join('\n');
    // The L1 block must carry the separation warning verbatim from source.
    expect(combined).toMatch(/INFORMATIONAL ONLY/i);
  });

  it('does not derive an ERP percentage from task counts', () => {
    for (const file of uiFiles) {
      const raw = readFileSync(file, 'utf8');
      if (isTypeOnlyModule(raw)) continue;
      const src = code(raw);
      // A VERIFIED-count divided by a total, used as a maturity figure, is
      // the exact conflation the doctrine forbids.
      expect(src).not.toMatch(/VERIFIED[\s\S]{0,120}?\/\s*total[\s\S]{0,40}?maturity/i);
    }
  });
});

describe('Nexus integration boundaries', () => {
  const allSource = [
    ...walk(SRC, ['.ts', '.tsx']),
    ...walk(SERVER, ['.mjs']),
  ];

  it('keeps Nexus adapters inside Command and imports no external Nexus package', () => {
    for (const file of allSource) {
      const src = code(readFileSync(file, 'utf8'));
      const specifiers = [
        ...[...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)]
          .map((match) => match[1] ?? match[2]!),
        ...[...src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
      ];
      for (const specifier of specifiers.filter((value) => /nexus/i.test(value))) {
        expect(
          specifier.startsWith('.') || specifier.startsWith('@/'),
          `${path.basename(file)} imports Nexus through external module '${specifier}'`,
        ).toBe(true);
        const resolved = specifier.startsWith('@/')
          ? path.resolve(SRC, specifier.slice(2))
          : path.resolve(path.dirname(file), specifier);
        expect(
          resolved.startsWith(`${APP_ROOT}${path.sep}`),
          `${path.basename(file)} resolves Nexus integration outside Command: ${resolved}`,
        ).toBe(true);
        expect(existsSync(resolved), `${path.basename(file)} Nexus adapter is missing: ${resolved}`).toBe(true);
      }
    }
  });

  it('does not declare a dependency on starqNexus in package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name.toLowerCase()).not.toContain('nexus');
    }
  });
});

describe('identity presentation', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']);

  it('resolves the Founder identity from the registry, not a literal', () => {
    const serverSrc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    // The canonical handle must be discovered via authorityIdentityId.
    expect(serverSrc).toMatch(/authority_identity_id\s*===\s*'founder'/);
    expect(serverSrc).toMatch(/authorityIdentityId/);
  });

  it('does not hardcode a fresh Ali presentation in UI copy', () => {
    for (const file of uiFiles) {
      const src = readFileSync(file, 'utf8');
      // @ali may appear only as a documented legacy-compatibility reference.
      const mentions = src.match(/@ali/gi) ?? [];
      expect(
        mentions.length <= 1,
        `${path.basename(file)} introduces fresh @ali presentation`,
      ).toBe(true);
    }
  });

  it('marks ali as legacy rather than canonical', () => {
    const serverSrc = readFileSync(path.join(SERVER, 'data-service.mjs'), 'utf8');
    expect(serverSrc).toMatch(/is_legacy/);
    expect(serverSrc).toMatch(/legacyAliasOf/);
  });
});

describe('honest state vocabulary', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']);

  it('keeps UNKNOWN, STALE, DRIFT and UNAVAILABLE distinct', () => {
    const combined = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const state of ['UNKNOWN', 'STALE', 'DRIFT', 'UNAVAILABLE']) {
      expect(combined, `missing state ${state}`).toContain(state);
    }
  });

  it('never renders an unreachable source as an empty-but-healthy one', () => {
    // The UnavailableState component must exist and be wired into the root.
    const gate = readFileSync(path.join(SRC, 'components', 'state-gate.tsx'), 'utf8');
    expect(gate).toMatch(/export function UnavailableState/);
    const app = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/UnavailableState/);
  });

  it('keeps the hold banner non-dismissible on every surface', () => {
    const app = readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/HoldBanner/);
    // No dismiss handler may exist on the hold banner.
    const gate = readFileSync(path.join(SRC, 'components', 'state-gate.tsx'), 'utf8');
    const holdBlock = gate.slice(gate.indexOf('export function HoldBanner'));
    expect(holdBlock).not.toMatch(/onDismiss|setDismissed|dismissed/);
  });
});

describe('no hidden truth inside UI state', () => {
  const uiFiles = walk(SRC, ['.ts', '.tsx']);

  it('does not hardcode operational fixture data', () => {
    // Phase 1 forbids fake operational data. Any literal that looks like a
    // real business number in a component is a fabricated fact.
    const suspicious = [
      /0\.40\d*\s*\*\s*100/,
      /maturity\s*[:=]\s*0\.\d+/,
      /\bL4\s*[:=]\s*[\d.]+/,
      /agents\s*[:=]\s*\[\{/,
    ];
    for (const file of uiFiles) {
      const src = code(readFileSync(file, 'utf8'));
      for (const pattern of suspicious) {
        expect(
          pattern.test(src),
          `${path.basename(file)} appears to hardcode operational data: ${pattern}`,
        ).toBe(false);
      }
    }
  });
});

describe('Phase 2 boundaries', () => {
  const statesSrc = readFileSync(path.join(SRC, 'lib', 'states.ts'), 'utf8');
  const truthSrc = readFileSync(path.join(SRC, 'surfaces', 'truth.tsx'), 'utf8');
  const shellSrc = readFileSync(path.join(SRC, 'components', 'shell.tsx'), 'utf8');

  it('keeps control-plane states in their own vocabulary', () => {
    // DIMENSION_TONE must be keyed by the control-plane states and must not
    // borrow the process-stage vocabulary. A shared chip between `absent` and
    // `FAIL` would assert a relationship between two unrelated verdicts.
    expect(statesSrc).toMatch(/export const DIMENSION_TONE/);
    for (const state of ['OK', 'FAIL', 'STALE', 'DRIFT', 'UNAVAILABLE', 'UNKNOWN']) {
      expect(statesSrc, `dimension vocabulary is missing ${state}`).toContain(state);
    }
    expect(statesSrc).toMatch(/export const FIX_LOCUS_TONE/);
  });

  it('renders current health and preserved history through separate components', () => {
    expect(truthSrc).toMatch(/function CurrentHealthCard/);
    expect(truthSrc).toMatch(/function PreservedHistoryCard/);
    expect(truthSrc).toMatch(/function FixStatusCard/);
    // The historical panel must be fenced: it has to say, in rendered copy,
    // that it does not affect the current verdict.
    expect(truthSrc).toMatch(/EXCLUDED FROM THE CURRENT VERDICT/);
  });

  it('never presents an unassessed dimension as assessed', () => {
    // The floor header must carry the assessed count beside the healthy count.
    expect(truthSrc).toMatch(/dimensions_assessed/);
  });

  it('does not let the truth surface reach outside the app for data', () => {
    const stripped = code(truthSrc);
    expect(stripped).not.toMatch(/\bfetch\s*\(\s*['"]https?:/i);
    // Only the local read-only routes are allowed.
    const routes = stripped.match(/['"`]\/api\/[a-z-]+/gi) ?? [];
    for (const r of routes) {
      expect(
        ['/api/surface', '/api/gates', '/api/snapshot', '/api/health-floor', '/api/raw'],
        `unexpected local route referenced: ${r}`,
      ).toContain(r.toLowerCase().replace(/[`'"]/g, ''));
    }
  });

  it('keeps accepted surfaces reachable inside the isolated company shell', () => {
    // These foundational operational surfaces remain live. The exact navigation
    // census below is the product-surface regression boundary; new capabilities
    // are added there as they are integrated rather than being blocked by the
    // historical phase-five limit.
    for (const id of ['studio', 'building', 'attention']) {
      expect(
        new RegExp(`id: '${id}'[\\s\\S]{0,220}?live: true`).test(shellSrc),
        `the Phase 3/4/5 surface '${id}' must be marked live`,
      ).toBe(true);
    }

    // Phase metadata was removed from live navigation because it implied a
    // hidden release gate while every current surface is authorized. Keep that
    // invariant explicit instead of accepting any positive integer vacuously.
    const phaseNumbers = [...shellSrc.matchAll(/phase:\s*(\d+)\b/g)].map((match) => Number(match[1]));
    expect(phaseNumbers).toHaveLength(0);

    const navIds = [...shellSrc.matchAll(/\bid: '([a-z0-9]+)'/g)].map((m) => m[1]!);
    // Keep the census aligned with the integrated Company OS surfaces. An
    // additional nav id requires its own route and operational capability.
    expect(navIds.sort()).toEqual(
      ['attention', 'evidence', 'building', 'company', 'overview', 'studio', 'system', 'library', 'cortex', 'comms'].sort(),
    );
  });

  it('renders the Phase 3, 4 and 5 surfaces through real surfaces', () => {
    const app = readFileSync(path.join(SRC, 'surfaces', 'building.tsx'), 'utf8');
    expect(app).toMatch(/import \{ FloorSurface \} from '@\/surfaces\/floor'/);
    expect(app).toMatch(/<FloorSurface surface=\{surface\}/);
    expect(app).toMatch(/import \{ ProcessSurface \} from '@\/surfaces\/process'/);
    expect(app).toMatch(/<ProcessSurface surface=\{surface\}/);
    expect(app).toMatch(/import \{ AttentionSurface \} from '@\/surfaces\/attention'/);
    expect(app).toMatch(/<AttentionSurface surface=\{surface\}/);
    // Every live surface must have left the not-yet-authorised shell registry.
    // The registry is now EMPTY: no phase beyond 5 is authorised, so no later
    // surface is described there either.
    const phaseShell = readFileSync(path.join(SRC, 'surfaces', 'phase-shell.tsx'), 'utf8');
    const intents = phaseShell.slice(
      phaseShell.indexOf('export const PHASE_INTENTS'),
      phaseShell.indexOf('export function PhaseShellFor'),
    );
    expect(intents).not.toMatch(/\bfloor:\s*\{/);
    expect(intents).not.toMatch(/\bprocess:\s*\{/);
    expect(intents).not.toMatch(/\battention:\s*\{/);
    // A registry entry of ANY shape means a phase shell was reintroduced.
    expect(intents).not.toMatch(/:\s*\{\s*\n\s*phase:/);
  });

  it('recomputes no age on the floor surface', () => {
    // A clock call in a component turns a frozen ingest-time value into a
    // freshly wrong one. Timestamps are rendered; ages are not computed.
    const floor = readFileSync(path.join(SRC, 'surfaces', 'floor.tsx'), 'utf8');
    const src = code(floor);
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/performance\.now\s*\(/);
    expect(src).not.toMatch(/hours_since_last_activity/);
    expect(src).not.toMatch(/formatAge/);
  });
});
