/**
 * tests/real-tree-capability-mutation.test.ts
 *
 * ── PHASE 5.3 — REAL-TREE CAPABILITY CLOSURE ─────────────────────────────────
 *
 * WHY THIS FILE EXISTS
 *
 * DP cold-accepted 34a8b20 and rejected it. The reason matters more than the
 * fix: Phase 5.2's guard was NON-VACUOUS only against synthetic in-memory
 * ASTs. Probed against REAL files in the REAL application tree, it stayed
 * green at 62/62 while src/components/dp52-transport.tsx contained:
 *
 *     const m = await import('node:fs');
 *     m.writeFileSync(p, d);
 *
 * detectFsWriteCapability enumerated only ImportDeclaration nodes. A dynamic
 * import produces no import declaration, so: no writable name, no namespace,
 * no call site, `hasWriteCapability: false`. Same class on the transport side:
 * window.fetch, globalThis.fetch, aliased fetch, and a computed method key all
 * passed in-situ.
 *
 * A synthetic AST structurally CANNOT catch this class. So the proof has to be
 * integration-level: write real files to real application paths, observe the
 * guard go red, delete them, observe it return to green.
 *
 * WHAT THIS FILE PROVES
 *
 *   Part A — the real tree is CLEAN. Baseline: no write capability anywhere in
 *            src/** before this file touches anything.
 *   Part B — each mutant, placed in a REAL src/lib/** or src/components/** path,
 *            turns the guard RED.
 *   Part C — the guard returns to GREEN after byte-for-byte cleanup.
 *   Part D — no fixture leakage: the real tree is byte-identical to its
 *            pre-test state, verified by digest over every file's contents.
 *
 * SAFETY
 *   Every mutant is written to a dedicated, uniquely-named scratch path under
 *   src/ and removed in `finally`. The suite deletes only files it created, and
 *   only after confirming the path did not exist beforehand. If the process
 *   dies mid-test the files are inert TS modules that no surface imports, and
 *   Part D plus `npm run typecheck` still surface their presence.
 */

import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import {
  collectTs,
  detectFsWriteCapability,
  detectTransportWriteCapability,
  parseSource,
} from './support/application-capability';

const root = process.cwd();
const SRC = path.join(root, 'src');

// ── The real-tree guard, exactly as the acceptance proofs use it ──────────────

/**
 * Run the FULL application-source capability guard over the real src/** tree.
 * This is the same composition PROOF 2/3/4/5 use — a mutant anywhere under
 * src/ must make this return a violation list.
 */
function scanRealTree(): { fs: string[]; transport: string[] } {
  const files = collectTs(SRC);
  const fsViolations: string[] = [];
  const transportViolations: string[] = [];

  for (const file of files) {
    const rel = path.relative(SRC, file);
    const sf = parseSource(file);
    const fsCap = detectFsWriteCapability(sf);

    // Defensive reads. The Phase 5.3 fields are optional here so that this
    // harness can also be run against an OLDER guard implementation to prove
    // non-vacuity: if the field is missing, that is itself a finding, and an
    // undefined.length would otherwise throw instead of reporting.
    const dynamicFs = fsCap.dynamicFsImports ?? [];
    const opaqueDynamic = fsCap.opaqueDynamicImports ?? [];

    if (fsCap.writableNames.size > 0) {
      fsViolations.push(`${rel}: writable FS names [${[...fsCap.writableNames].join(', ')}]`);
    }
    if (fsCap.namespaceNames.size > 0) {
      fsViolations.push(`${rel}: FS namespace [${[...fsCap.namespaceNames].join(', ')}]`);
    }
    if (fsCap.promisesModuleImported) {
      fsViolations.push(`${rel}: imports fs/promises`);
    }
    if (dynamicFs.length > 0) {
      fsViolations.push(
        `${rel}: dynamic FS import [${dynamicFs.map(c => c.getText(sf)).join(', ')}]`,
      );
    }
    if (opaqueDynamic.length > 0) {
      fsViolations.push(
        `${rel}: opaque dynamic import — fails closed [${opaqueDynamic
          .map(c => c.getText(sf))
          .join(', ')}]`,
      );
    }
    if (fsCap.writeCalls.length > 0) {
      fsViolations.push(
        `${rel}: FS write call(s) [${fsCap.writeCalls.map(c => c.getText(sf)).join('; ')}]`,
      );
    }
  }

  const transport = detectTransportWriteCapability(files);
  for (const c of transport.suspiciousCalls) {
    transportViolations.push(`${path.relative(SRC, c.file)}: ${c.reason} — ${c.text.slice(0, 90)}`);
  }

  return { fs: fsViolations, transport: transportViolations };
}

/** Digest of the entire real src/** tree — file paths + contents. */
function treeDigest(): string {
  const hash = createHash('sha256');
  for (const file of collectTs(SRC).sort()) {
    hash.update(path.relative(SRC, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// ── Mutant fixtures — real application source, real write capability ─────────
//
// Each is the EXACT shape DP proved bypasses the Phase 5.2 guard in-situ.

interface Mutant {
  name: string;
  /** Path relative to the project root. Deliberately under real app paths. */
  target: string;
  content: string;
  /** Which guard must go red. */
  expectKind: 'fs' | 'transport' | 'both';
}

const MUTANTS: Mutant[] = [
  {
    name: 'M1 dynamic node:fs namespace write (DP in-situ blocker, verbatim)',
    target: 'src/lib/p53-dyn-nodefs.ts',
    expectKind: 'fs',
    content: `export async function commitRuling(p: string, d: string) {
  const m = await import('node:fs');
  m.writeFileSync(p, d);
}
`,
  },
  {
    name: 'M2 dynamic bare fs namespace write',
    target: 'src/lib/p53-dyn-bare-fs.ts',
    expectKind: 'fs',
    content: `export async function persist(p: string, d: string) {
  const m = await import('fs');
  m.writeFileSync(p, d);
}
`,
  },
  {
    name: 'M3 dynamic node:fs/promises writeFile',
    target: 'src/lib/p53-dyn-promises.ts',
    expectKind: 'fs',
    content: `export async function store(p: string, d: string) {
  const m = await import('node:fs/promises');
  await m.writeFile(p, d);
}
`,
  },
  {
    name: 'M4 dynamic fs/promises destructured write',
    target: 'src/lib/p53-dyn-destructured.ts',
    expectKind: 'fs',
    content: `export async function store(p: string, d: string) {
  const { writeFile } = await import('fs/promises');
  await writeFile(p, d);
}
`,
  },
  {
    name: 'M5 dynamic import with unresolvable specifier (fails closed)',
    target: 'src/lib/p53-dyn-opaque.ts',
    expectKind: 'fs',
    content: `export async function load(mod: string) {
  const m = await import(mod);
  return m;
}
`,
  },
  {
    name: 'M6 window.fetch POST in a real component',
    target: 'src/components/p53-window-fetch.tsx',
    expectKind: 'transport',
    content: `export function submitDecision(url: string, body: string) {
  return window.fetch(url, { method: 'POST', body });
}
`,
  },
  {
    name: 'M7 globalThis.fetch POST',
    target: 'src/components/p53-globalthis-fetch.tsx',
    expectKind: 'transport',
    content: `export function submitDecision(url: string, body: string) {
  return globalThis.fetch(url, { method: 'POST', body });
}
`,
  },
  {
    name: 'M8 aliased fetch const f = fetch',
    target: 'src/components/p53-fetch-alias.ts',
    expectKind: 'transport',
    content: `const f = fetch;
export function submitDecision(url: string, body: string) {
  return f(url, { method: 'POST', body });
}
`,
  },
  {
    name: 'M9 computed method key',
    target: 'src/components/p53-computed-key.tsx',
    expectKind: 'transport',
    content: `export function submitDecision(url: string) {
  return fetch(url, { ['method']: 'DELETE' });
}
`,
  },
  // ── Phase 5.2 detections, re-proven in-situ (not just synthetic) ─────────
  {
    name: 'M10 static writeFileSync (Phase 5.2 detection, real tree)',
    target: 'src/lib/p53-static-write.ts',
    expectKind: 'fs',
    content: `import { writeFileSync } from 'fs';
export function applyRuling(p: string, d: string) {
  writeFileSync(p, d);
}
`,
  },
  {
    name: 'M11 aliased filesystem writer (Phase 5.2 detection, real tree)',
    target: 'src/components/p53-aliased-writer.tsx',
    expectKind: 'fs',
    content: `import { writeFileSync as save } from 'fs';
export function persistAll(p: string, d: string) {
  save(p, d);
}
`,
  },
  {
    name: 'M12 fs/promises static writer (Phase 5.2 detection, real tree)',
    target: 'src/lib/p53-promises-static.ts',
    expectKind: 'fs',
    content: `import { writeFile } from 'fs/promises';
export async function store(p: string, d: string) {
  await writeFile(p, d);
}
`,
  },
  {
    name: 'M13 fetch method via variable (Phase 5.2 detection, real tree)',
    target: 'src/lib/p53-method-var.ts',
    expectKind: 'transport',
    content: `const M = 'POST';
export function submit(url: string) {
  return fetch(url, { method: M });
}
`,
  },
  {
    name: 'M14 fetch method hidden in spread (Phase 5.2 detection, real tree)',
    target: 'src/lib/p53-spread.ts',
    expectKind: 'transport',
    content: `export function action(url: string, opts: { method: string }) {
  return fetch(url, { ...opts });
}
`,
  },
  {
    name: 'M15 spread plus explicit GET still suspicious (Phase 5.2 detection)',
    target: 'src/lib/p53-spread-get.ts',
    expectKind: 'transport',
    content: `export function mixed(url: string, opts: object) {
  return fetch(url, { method: 'GET', ...opts });
}
`,
  },
  {
    name: "M16 quoted 'method' key (Phase 5.2 detection, real tree)",
    target: 'src/lib/p53-quoted-key.ts',
    expectKind: 'transport',
    content: `export function remove(url: string) {
  return fetch(url, { 'method': 'DELETE' });
}
`,
  },
];

// ── Fixture lifecycle: create only where nothing pre-exists, always clean up ──

const created: string[] = [];
let baselineDigest = '';

function install(targetRel: string, content: string): string {
  const abs = path.join(root, targetRel);
  // Never clobber canonical work. If the path already exists this is a bug,
  // not something to overwrite silently.
  expect(
    existsSync(abs),
    `refusing to install mutant over an existing canonical file: ${targetRel}`,
  ).toBe(false);
  writeFileSync(abs, content, 'utf8');
  created.push(abs);
  return abs;
}

function uninstallAll(): void {
  // Remove in reverse order; only files this test created.
  while (created.length > 0) {
    const abs = created.pop()!;
    try {
      rmSync(abs, { force: true });
    } catch {
      // force already suppresses ENOENT; a real failure here must not be
      // swallowed silently during cleanup, so it is re-surfaced by Part D.
    }
  }
}

beforeAll(() => {
  baselineDigest = treeDigest();
});

afterAll(() => {
  uninstallAll();
});

// ── Part A — the real tree is clean BEFORE any mutation ──────────────────────

describe('PART A — real application tree is clean before mutation', () => {
  it('no FS write capability anywhere in src/**', () => {
    const { fs } = scanRealTree();
    expect(fs, `FS write capability in the real tree:\n${fs.join('\n')}`).toEqual([]);
  });

  it('no write-capable transport anywhere in src/**', () => {
    const { transport } = scanRealTree();
    expect(
      transport,
      `write-capable transport in the real tree:\n${transport.join('\n')}`,
    ).toEqual([]);
  });

  it('the mutant target paths do not pre-exist in the real tree', () => {
    for (const m of MUTANTS) {
      expect(existsSync(path.join(root, m.target)), `${m.target} already exists`).toBe(false);
    }
  });
});

// ── Part B + C — each mutant goes RED, then cleanup returns GREEN ────────────

describe('PART B/C — real-tree mutation: guard goes red per mutant, green after cleanup', () => {
  for (const m of MUTANTS) {
    it(`RED while present, GREEN after cleanup: ${m.name}`, () => {
      // ── red ────────────────────────────────────────────────────────────────
      install(m.target, m.content);

      // Prove the file really is on disk before trusting the verdict.
      const abs = path.join(root, m.target);
      expect(existsSync(abs), `${m.target} was not written to disk`).toBe(true);
      expect(
        readFileSync(abs, 'utf8'),
        `${m.target} contents do not match what was installed`,
      ).toBe(m.content);
      // And that it landed under a REAL application path, not a staging dir.
      expect(
        path.relative(SRC, abs).startsWith('..'),
        `${m.target} is not under src/`,
      ).toBe(false);

      const result = scanRealTree();

      if (m.expectKind === 'fs' || m.expectKind === 'both') {
        expect(
          result.fs.length,
          `mutant was NOT caught by the FS guard (${m.target}). fs violations: ${
            result.fs.length === 0 ? 'NONE' : result.fs.join('; ')
          }`,
        ).toBeGreaterThan(0);
        expect(
          result.fs.some(v => v.includes(path.basename(m.target))),
          `FS guard went red but not because of the mutant file: ${result.fs.join('; ')}`,
        ).toBe(true);
      }
      if (m.expectKind === 'transport' || m.expectKind === 'both') {
        expect(
          result.transport.length,
          `mutant was NOT caught by the transport guard (${m.target})`,
        ).toBeGreaterThan(0);
        expect(
          result.transport.some(v => v.includes(path.basename(m.target))),
          `transport guard went red but not because of the mutant file: ${result.transport.join('; ')}`,
        ).toBe(true);
      }

      // ── green, byte-for-byte cleanup ───────────────────────────────────────
      // Remove ONLY this mutant, in a finally so a failed assertion above
      // still cannot leave a fixture behind.
      try {
        rmSync(abs, { force: true });
        const idx = created.indexOf(abs);
        if (idx >= 0) created.splice(idx, 1);
      } finally {
        expect(existsSync(abs), `${m.target} survived cleanup`).toBe(false);
      }

      const after = scanRealTree();
      expect(
        after.fs,
        `FS guard did not return to green after removing ${m.target}:\n${after.fs.join('\n')}`,
      ).toEqual([]);
      expect(
        after.transport,
        `transport guard did not return to green after removing ${m.target}:\n${after.transport.join('\n')}`,
      ).toEqual([]);
    });
  }
});

// ── Part D — no fixture leakage ──────────────────────────────────────────────

describe('PART D — no fixture leakage', () => {
  it('every mutant file has been removed from the real tree', () => {
    const leftovers = MUTANTS.filter(m => existsSync(path.join(root, m.target)));
    expect(
      leftovers.map(m => m.target),
      'mutant files leaked into the real application tree',
    ).toEqual([]);
  });

  it('no file under src/ matches a mutant marker', () => {
    const leaked: string[] = [];
    for (const file of collectTs(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('p53-') || text.includes('P53 real-tree mutation fixture')) {
        leaked.push(path.relative(SRC, file));
      }
    }
    expect(leaked, 'mutant content leaked into the real tree').toEqual([]);
  });

  it('the real src/** tree is byte-identical to its pre-test digest', () => {
    expect(treeDigest(), 'the real source tree was mutated and not restored').toBe(
      baselineDigest,
    );
  });

  it('no .bak / .v52bak / .orig scratch files remain under src/', () => {
    const strays: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(bak|orig|rej|v52bak|tmp)$/.test(entry)) strays.push(full);
      }
    };
    walk(SRC);
    expect(strays, 'scratch files left in the real source tree').toEqual([]);
  });
});

// ── Unit-level backing for the two fail-closed rules ────────────────────────

describe('PART E — the fail-closed rules hold at the detector level too', () => {
  const sfOf = (code: string, name = 'p53.ts') =>
    ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  it('a dynamic import of node:fs is write capability even with no call', () => {
    const r = detectFsWriteCapability(
      sfOf(`export async function w() { await import('node:fs'); }`),
    );
    expect(r.dynamicFsImports.length).toBe(1);
    expect(r.hasWriteCapability).toBe(true);
  });

  it('an unresolvable dynamic import specifier fails closed', () => {
    const r = detectFsWriteCapability(
      sfOf(`export async function w(m: string) { return import(m); }`),
    );
    expect(r.opaqueDynamicImports.length).toBe(1);
    expect(r.hasWriteCapability).toBe(true);
  });

  it('a type-only import() type annotation is NOT flagged', () => {
    // `import('./x').T` in a type position is not a runtime capability.
    const r = detectFsWriteCapability(
      sfOf(`type S = import('@/lib/contracts').CommandSurface;\nexport function f(s: S) { return s; }`),
    );
    expect(r.hasWriteCapability).toBe(false);
  });

  it('a non-FS module dynamic import is NOT flagged', () => {
    const r = detectFsWriteCapability(
      sfOf(`export async function w() { const m = await import('./helper'); return m; }`),
    );
    expect(r.hasWriteCapability).toBe(false);
  });

  it('read-only FS access is still allowed', () => {
    const r = detectFsWriteCapability(
      sfOf(
        `import { readFileSync } from 'fs';\nexport function r(p: string) { return readFileSync(p, 'utf8'); }`,
      ),
    );
    expect(r.hasWriteCapability).toBe(false);
  });
});
