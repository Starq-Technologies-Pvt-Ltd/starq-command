/**
 * tests/read-only-capability.test.ts
 *
 * ── PHASE 5.3 CORRECTIVE — REAL-TREE CAPABILITY CLOSURE ──────────────────────
 *
 * DP cold-accepted 34a8b20 and rejected it. The guard was non-vacuous only
 * against synthetic ASTs. Against REAL files in the REAL src/ tree, these
 * all passed at 62/62 green:
 *
 *   const m = await import('node:fs'); m.writeFileSync(p, d);   ← primary blocker
 *   window.fetch(u, { method: 'POST' })
 *   globalThis.fetch(u, { method: 'POST' })
 *   const f = fetch; f(u, { method: 'POST' })
 *   fetch(u, { ['method']: 'DELETE' })
 *
 * Root cause: detectFsWriteCapability walked only ImportDeclaration nodes, so
 * a dynamic import produced no import declaration, no writable name, no
 * namespace and no call site. On the transport side the callee check required
 * an Identifier literally named `fetch`, and the method-key lookup could not
 * match a ComputedPropertyName. The Phase 5.2 comment at
 * application-capability.ts:246 claimed alias tracking that did not exist.
 *
 * PHASE 5.3 closes all five classes and adds the missing real-tree proof in
 * tests/real-tree-capability-mutation.test.ts. Non-vacuity of the new proof
 * was demonstrated by running it against the Phase 5.2 guard: M1-M9 (the five
 * defect classes) fail, M10-M16 (the pre-existing detections) still pass.
 *
 * ── PHASE 5.2 ACCEPTANCE PROOFS ─────────────────────────────────────────────
 *
 * Vision independently rejected Phase 5.1 on one remaining issue:
 *
 *   The capability guard misses write capability placed outside the folders it
 *   scans. Proven bypasses:
 *     src/lib/apply-ruling.ts       — writeFileSync
 *     src/components/ruling-writer.ts — writeFileSync
 *
 * This file closes that gap. Every test has an adversarial mutation that was
 * introduced, observed to cause failure, then reverted before committing.
 *
 * SCOPE
 *   - Complete src/**\/*.ts + src/**\/*.tsx application source tree
 *   - server/**\/*.mjs (unchanged from Phase 5.1, retained)
 *   - All Node FS write APIs: sync, async, aliased, and namespace-accessed
 *   - All client transport write capability: literal, variable, and hidden
 *   - Production build output guard (dist/ present and clean)
 *   - Live HTTP 405 boundary (retained from Phase 5.1)
 *
 * CLOSED — NOT REOPENED
 *   - Founder-decision semantics (phase5.test.ts, phase5-fixture.test.tsx)
 *   - Missing-source truth (phase5-fixture.test.tsx)
 *   - Deterministic fixture / live split (phase5-fixture.test.tsx)
 *   - Live HTTP GET/HEAD-only boundary (retained below, not reopened)
 *
 * ADVERSARIAL MUTATIONS (all introduced, each caught, all reverted):
 *   1. src/lib/apply-ruling.ts       using writeFileSync            → caught by PROOF 2
 *   2. src/components/ruling-writer.ts using writeFileSync          → caught by PROOF 2
 *   3. src/lib/fs-helper.ts          using fs/promises + writeFile  → caught by PROOF 3
 *   4. src/lib/transport.ts          window.fetch({ method:'POST'}) → caught by PROOF 4
 *   5. src/lib/transport.ts          method via variable            → caught by PROOF 5
 *   6. src/lib/action-helper.ts      method hidden in spread        → caught by PROOF 5
 *   7. src/lib/read-helper.ts        normal GET-only helper         → allowed (PROOF 7)
 *   8. Live HTTP POST                                               → 405 (PROOF 8)
 *   9. dist/ production build                                       → present (PROOF 9)
 *  10. Phase 5/5.1 tests                                            → still green (PROOF 10)
 */

import { describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import {
  collectCalls,
  collectMjs,
  collectTs,
  detectFsWriteCapability,
  detectTransportWriteCapability,
  detectTransportWriteCapabilityInSource,
  isApprovedCommandUiWrite,
  parseSource,
  sourceText,
} from './support/application-capability';

const root = process.cwd();
const SRC = path.join(root, 'src');
const SERVER = path.join(root, 'server');

// ── All application source files (complete tree) ─────────────────────────────

const allAppSrc = collectTs(SRC);
const allServerMjs = collectMjs(SERVER);

// ── Sanity: the tree actually contains the directories Codex's guard missed ──

describe('PROOF 0 — source tree sanity (guard scope)', () => {
  it('src/lib/** contains at least one TypeScript file', () => {
    const libFiles = allAppSrc.filter(f => f.includes(path.sep + 'lib' + path.sep));
    expect(libFiles.length).toBeGreaterThan(0);
  });

  it('src/components/** contains at least one TypeScript file', () => {
    const compFiles = allAppSrc.filter(f => f.includes(path.sep + 'components' + path.sep));
    expect(compFiles.length).toBeGreaterThan(0);
  });

  it('src/surfaces/** contains at least one TypeScript file', () => {
    const surfFiles = allAppSrc.filter(f => f.includes(path.sep + 'surfaces' + path.sep));
    expect(surfFiles.length).toBeGreaterThan(0);
  });

  it('server/** contains at least one .mjs file', () => {
    expect(allServerMjs.length).toBeGreaterThan(0);
  });
});

// ── PROOF 1 — server files contain no write primitives ───────────────────────

describe('PROOF 1 — server modules contain no filesystem write primitives', () => {
  for (const file of allServerMjs) {
    const name = path.basename(file);

    it(`${name} imports no FS write-capable API`, () => {
      const text = sourceText(file);
      // These are JS .mjs files — use text-level guards (reliable for server files)
      expect(text, `${name} uses writeFileSync`).not.toMatch(/\bwriteFileSync\b/);
      expect(text, `${name} uses writeFile`).not.toMatch(/\bwriteFile\s*\(/);
      expect(text, `${name} uses appendFileSync`).not.toMatch(/\bappendFileSync\b/);
      expect(text, `${name} uses appendFile`).not.toMatch(/\bappendFile\s*\(/);
      expect(text, `${name} uses renameSync`).not.toMatch(/\brenameSync\b/);
      expect(text, `${name} uses unlinkSync`).not.toMatch(/\bunlinkSync\b/);
      expect(text, `${name} uses rmSync`).not.toMatch(/\brmSync\b/);
      expect(text, `${name} uses mkdirSync`).not.toMatch(/\bmkdirSync\b/);
      expect(text, `${name} uses createWriteStream`).not.toMatch(/\bcreateWriteStream\b/);
      expect(text, `${name} uses fs.promises`).not.toContain('fs.promises');
      expect(text, `${name} imports fs/promises`).not.toMatch(/from\s+['"](?:node:)?fs\/promises['"]/);
    });
  }
});

// ── PROOF 2 — FULL application source tree: no FS write capability ────────────
//
// This is the guard Phase 5.1 did not have.
// Phase 5.1 scanned only src/App.tsx and src/surfaces/**. This proof scans the
// COMPLETE src/** tree — lib/, components/, surfaces/, and root-level files.

describe('PROOF 2 — complete application source tree has no FS write capability', () => {
  it('reports the files being scanned (non-vacuity)', () => {
    // Sanity: every subdirectory is covered
    const covered = new Set(allAppSrc.map(f => {
      const rel = path.relative(SRC, f);
      return rel.split(path.sep)[0]; // top-level folder or file
    }));
    // Must include lib and components — the directories Phase 5.1 missed
    expect(covered.has('lib') || covered.has('lib.ts'), 'lib not in scan').toBe(true);
    expect(covered.has('components') || allAppSrc.some(f => f.includes('components')), 'components not in scan').toBe(true);
  });

  for (const file of allAppSrc) {
    const rel = path.relative(SRC, file);

    it(`${rel} has no FS write capability (direct, aliased, or namespace)`, () => {
      const sf = parseSource(file);
      const result = detectFsWriteCapability(sf);

      expect(
        result.writableNames.size,
        `${rel} imports write-capable FS API names: ${[...result.writableNames].join(', ')}`,
      ).toBe(0);

      expect(
        result.namespaceNames.size,
        `${rel} imports FS namespace (could reach write APIs): ${[...result.namespaceNames].join(', ')}`,
      ).toBe(0);

      expect(
        result.promisesModuleImported,
        `${rel} imports fs/promises (grants write capability)`,
      ).toBe(false);

      expect(
        result.writeCalls.length,
        `${rel} contains ${result.writeCalls.length} FS write call(s): ${result.writeCalls.map(c => c.getText(sf)).join('; ')}`,
      ).toBe(0);

      // PHASE 5.3 — DP proved these passed the guard on a real src/ file.
      // `await import('node:fs')` yields no ImportDeclaration, so Phase 5.2
      // saw nothing at all here.
      expect(
        result.dynamicFsImports?.length ?? 0,
        `${rel} contains a dynamic filesystem import: ${(result.dynamicFsImports ?? []).map(c => c.getText(sf)).join('; ')}`,
      ).toBe(0);

      expect(
        result.opaqueDynamicImports?.length ?? 0,
        `${rel} contains a dynamic import with an unresolvable specifier (fails closed): ${(result.opaqueDynamicImports ?? []).map(c => c.getText(sf)).join('; ')}`,
      ).toBe(0);
    });
  }
});

// ── PROOF 3 — fs/promises module import is blocked everywhere in src ──────────
//
// Separate from PROOF 2 because the detection path is different:
// a bare `import 'fs/promises'` with no bindings still grants capability
// to dynamic requires downstream.

describe('PROOF 3 — fs/promises is not imported anywhere in application source', () => {
  it('no src file contains an fs/promises import', () => {
    const violations: string[] = [];
    for (const file of allAppSrc) {
      const text = sourceText(file);
      if (
        text.includes('fs/promises') ||
        text.includes('node:fs/promises') ||
        // Also catch: const { writeFile } = await import('fs/promises')
        text.includes("import('fs/promises')") ||
        text.includes("import('node:fs/promises')")
      ) {
        violations.push(path.relative(SRC, file));
      }
    }
    expect(
      violations,
      `Files importing fs/promises: ${violations.join(', ')}`,
    ).toHaveLength(0);
  });
});

// ── PROOF 4 — no unapproved client-side write-capable transport ───────────────

describe('PROOF 4 — all client-side writes are explicitly authorized', () => {
  const result = detectTransportWriteCapability(allAppSrc);
  const approved = result.suspiciousCalls.filter(isApprovedCommandUiWrite);
  const unapproved = result.suspiciousCalls.filter(c => !isApprovedCommandUiWrite(c));

  it('permits only the declared PM-backed Messenger and task-artifact mutations', () => {
    expect(approved).toHaveLength(3);
    expect(approved.some((call) => call.file.replace(/\\/g, '/').endsWith('src/surfaces/comms.tsx'))).toBe(true);
    expect(approved.find((call) => call.text.includes('/api/pm/comms/send'))?.reason).toBe("fetch with method 'POST'");
    const artifacts = approved.find((call) => call.text.includes('/artifacts'));
    expect(artifacts?.reason).toBe("fetch with method 'POST'");
    expect(artifacts?.text).toContain("method: 'POST'");
    if (unapproved.length > 0) {
      const detail = unapproved
        .map(v => `${path.relative(SRC, v.file)}: ${v.reason} — ${v.text.slice(0, 80)}`)
        .join('\n');
      expect.fail(`Unapproved write-capable transports found:\n${detail}`);
    }
    expect(unapproved).toHaveLength(0);
  });
});

// ── PROOF 5 — no write method hidden via variable, spread, or non-literal ──────
//
// This closes the Phase 5.1 bypass where:
//   const opts = { method: 'POST' };
//   fetch(url, opts);                  ← missed by literal-only check
//
//   fetch(url, { method: writeMethod });  ← identifier → suspicious
//
//   fetch(url, { ...opts });           ← spread → cannot verify → suspicious

describe('PROOF 5 — no application source module hides a write method via variable or spread', () => {
  const result = detectTransportWriteCapability(allAppSrc);
  const unapproved = result.suspiciousCalls.filter(c => !isApprovedCommandUiWrite(c));

  it('no fetch call uses a non-literal method value', () => {
    const violations = unapproved.filter(
      c => !c.reason.startsWith("fetch with method '"),
    );
    if (violations.length > 0) {
      const detail = violations
        .map(v => `${path.relative(SRC, v.file)}: ${v.reason} — ${v.text.slice(0, 80)}`)
        .join('\n');
      expect.fail(`Suspicious (non-literal-method) fetch calls found:\n${detail}`);
    }
    expect(violations).toHaveLength(0);
  });

  it('no src file contains XHR.open with a non-GET method', () => {
    // Text-level guard covering XMLHttpRequest usage across the entire tree
    const violations: string[] = [];
    for (const file of allAppSrc) {
      const text = sourceText(file);
      // .open('POST',...) / .open("PUT",...) / .open(`PATCH`,...)
      if (/\.open\s*\(\s*['"`](?:POST|PUT|PATCH|DELETE|OPTIONS|HEAD\s*[^'`"])/i.test(text)) {
        violations.push(path.relative(SRC, file));
      }
    }
    expect(violations, `XHR with write method: ${violations.join(', ')}`).toHaveLength(0);
  });
});

// ── PROOF 6 — innocuously named write helper is caught ───────────────────────
//
// This proof uses a synthetic adversarial AST to prove the detector works when
// a write API is wrapped inside a function named something innocuous.
// The underlying module still imports a write-capable API — the detector sees it.

describe('PROOF 6 — detector catches write capability in an innocuously named module', () => {
  it('writeFileSync aliased as "save" is still detected', () => {
    // Synthetic source that mimics a helper that calls itself "save"
    const code = `import { writeFileSync as save } from 'fs';
export function persistData(path: string, data: string) { save(path, data); }`;
    const sf = ts.createSourceFile('fake-save.ts', code, ts.ScriptTarget.Latest, true);
    const result = detectFsWriteCapability(sf);
    expect(result.writableNames.has('save')).toBe(true);
    expect(result.writeCalls.length).toBe(1);
    expect(result.hasWriteCapability).toBe(true);
  });

  it('namespace write via import * as fsMod from "node:fs" is detected', () => {
    const code = `import * as fsMod from 'node:fs';
export function flush(p: string, d: string) { fsMod.writeFileSync(p, d); }`;
    const sf = ts.createSourceFile('fake-flush.ts', code, ts.ScriptTarget.Latest, true);
    const result = detectFsWriteCapability(sf);
    expect(result.namespaceNames.has('fsMod')).toBe(true);
    expect(result.writeCalls.length).toBe(1);
    expect(result.hasWriteCapability).toBe(true);
  });

  it('fs/promises writeFile via import { writeFile } from "fs/promises" is detected', () => {
    const code = `import { writeFile } from 'fs/promises';
export async function asyncSave(p: string, d: string) { await writeFile(p, d); }`;
    const sf = ts.createSourceFile('fake-async-save.ts', code, ts.ScriptTarget.Latest, true);
    const result = detectFsWriteCapability(sf);
    expect(result.writableNames.has('writeFile')).toBe(true);
    expect(result.promisesModuleImported).toBe(true);
    expect(result.hasWriteCapability).toBe(true);
  });
});

// ── PROOF 7 — normal read-only helper is NOT flagged ──────────────────────────

describe('PROOF 7 — read-only helper passes the capability guard', () => {
  it('readFileSync import is not flagged as write capability', () => {
    const code = `import { readFileSync } from 'fs';
export function load(p: string) { return readFileSync(p, 'utf8'); }`;
    const sf = ts.createSourceFile('fake-reader.ts', code, ts.ScriptTarget.Latest, true);
    const result = detectFsWriteCapability(sf);
    expect(result.writableNames.size).toBe(0);
    expect(result.namespaceNames.size).toBe(0);
    expect(result.writeCalls.length).toBe(0);
    expect(result.hasWriteCapability).toBe(false);
  });

  it('GET-only fetch helper is not flagged as write capability', () => {
    const code = `export async function getData(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  return res.json();
}`;
    const sf = ts.createSourceFile('fake-get-helper.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    // Analyse the in-memory AST directly — no disk read, real detection logic.
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-get-helper.ts');
    // No method key at all → GET default → safe
    expect(transport.suspiciousCalls).toHaveLength(0);
    expect(transport.hasWriteCapability).toBe(false);
  });

  it('fetch with explicit GET literal is not flagged', () => {
    const code = `export async function refresh() {
  return fetch('/api/surface', { method: 'GET', cache: 'no-store' });
}`;
    const sf = ts.createSourceFile('fake-get-literal.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-get-literal.ts');
    expect(transport.suspiciousCalls).toHaveLength(0);
    expect(transport.hasWriteCapability).toBe(false);
  });

  it('the same detector DOES flag a POST literal in the same shape', () => {
    // Control: proves the assertions above are not vacuous — the in-memory
    // path runs the same detection used against the real tree.
    const code = `export async function submit() {
  return fetch('/api/surface', { method: 'POST' });
}`;
    const sf = ts.createSourceFile('fake-post.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-post.ts');
    expect(transport.suspiciousCalls.length).toBeGreaterThan(0);
    expect(transport.hasWriteCapability).toBe(true);
  });

  it('a spread in the options object is flagged, not treated as a safe GET', () => {
    // Regression for a verified hole found by the Phase 5.2 mutation battery:
    // `fetch(url, { ...opts })` carries no `method` PropertyAssignment, so the
    // detector used to fall into the "no method key → GET" branch and pass it.
    const code = `export async function action(url: string, opts: { method: string }) {
  return fetch(url, { ...opts });
}`;
    const sf = ts.createSourceFile('fake-spread.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-spread.ts');
    expect(transport.suspiciousCalls).toHaveLength(1);
    expect(transport.suspiciousCalls[0].reason).toMatch(/spread/);
    expect(transport.hasWriteCapability).toBe(true);
  });

  it('a spread alongside a safe GET method is still flagged', () => {
    // The visible method is GET, but the spread can still override it.
    const code = `export async function mixed(url: string, opts: object) {
  return fetch(url, { method: 'GET', ...opts });
}`;
    const sf = ts.createSourceFile('fake-mixed.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-mixed.ts');
    expect(transport.hasWriteCapability).toBe(true);
  });

  it('a quoted method key is still detected', () => {
    const code = `export async function quoted(url: string) {
  return fetch(url, { 'method': 'DELETE' });
}`;
    const sf = ts.createSourceFile('fake-quoted.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-quoted.ts');
    expect(transport.hasWriteCapability).toBe(true);
    expect(transport.suspiciousCalls[0].reason).toContain("'DELETE'");
  });

  // ── PHASE 5.3 — the four classes DP proved bypass this guard in-situ ──────
  //
  // Each of these passed the Phase 5.2 detector against a REAL file in the
  // REAL src/ tree. They are re-proven here at the detector level; the
  // real-tree in-situ proof lives in real-tree-capability-mutation.test.ts.

  it('a dynamic import of a filesystem module is write capability', () => {
    for (const mod of ['node:fs', 'fs', 'node:fs/promises', 'fs/promises']) {
      const code = `export async function w(p: string, d: string) {
  const m = await import('${mod}');
  m.writeFileSync(p, d);
}`;
      const sf = ts.createSourceFile(`fake-dyn-${mod}.ts`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const result = detectFsWriteCapability(sf);
      expect(result.dynamicFsImports?.length, `dynamic import of ${mod} not detected`).toBe(1);
      expect(result.hasWriteCapability, `dynamic import of ${mod} passed the guard`).toBe(true);
    }
  });

  it('a dynamic import with an unresolvable specifier fails closed', () => {
    const code = `export async function w(mod: string) { return import(mod); }`;
    const sf = ts.createSourceFile('fake-opaque-dyn.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectFsWriteCapability(sf);
    expect(result.opaqueDynamicImports?.length).toBe(1);
    expect(result.hasWriteCapability).toBe(true);
  });

  it('a non-filesystem dynamic import is NOT flagged', () => {
    // Fail-closed must not become fail-everything: a lazy non-FS module load
    // is legitimate and must not be reported as write capability.
    const code = `export async function w() { const m = await import('./helper'); return m; }`;
    const sf = ts.createSourceFile('fake-nonfs-dyn.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectFsWriteCapability(sf);
    expect(result.hasWriteCapability).toBe(false);
  });

  // ── PHASE 5.4 — require() false-positive closure ─────────────────────────
  //
  // Phase 5.3 fail-closed on the wrong condition: it treated every non-FS
  // require literal as opaque, so require('path') and require('./local') were
  // reported as write capability. A string-literal specifier is exactly as
  // resolvable as import() of the same string, so only a non-literal (or a
  // missing) argument may fail closed. Asymmetry proof: import('path') passed
  // while require('path') did not.

  it('require() of a filesystem module is write capability', () => {
    for (const mod of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises']) {
      const code = `const m = require('${mod}');
export function w(p: string, d: string) { m.writeFileSync(p, d); }`;
      const sf = ts.createSourceFile(`fake-req-${mod}.ts`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const result = detectFsWriteCapability(sf);
      expect(result.dynamicFsImports?.length, `require of ${mod} not detected`).toBe(1);
      expect(result.hasWriteCapability, `require of ${mod} passed the guard`).toBe(true);
    }
  });

  it('require() of a non-filesystem literal is NOT flagged', () => {
    // The Phase 5.3 false positive. Each of these is a legitimate CommonJS
    // require of a known non-FS module and must not be opaque.
    const cases: Array<[string, string]> = [
      ["require('path')", `const p = require('path');\nexport function j(x: string) { return p.join(x, 'y'); }`],
      ["require('node:path')", `const p = require('node:path');\nexport function j(x: string) { return p.join(x, 'y'); }`],
      ["require('node:crypto')", `const c = require('node:crypto');\nexport function h() { return c.randomUUID(); }`],
      ["require('util')", `const u = require('util');\nexport function h() { return u.format('x'); }`],
      ["require('./local')", `const m = require('./local');\nexport function h() { return m.go(); }`],
    ];
    for (const [label, code] of cases) {
      const sf = ts.createSourceFile(`fake-req-safe-${label}.ts`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const result = detectFsWriteCapability(sf);
      expect(result.opaqueDynamicImports?.length ?? 0, `${label} wrongly treated as opaque`).toBe(0);
      expect(result.dynamicFsImports?.length ?? 0, `${label} wrongly treated as a dynamic FS import`).toBe(0);
      expect(result.hasWriteCapability, `${label} failed the guard`).toBe(false);
    }
  });

  it('require() with an unresolvable specifier fails closed', () => {
    // Fail closed must survive the false-positive fix: a non-literal or absent
    // argument cannot be resolved, so it must still be opaque.
    const cases: Array<[string, string]> = [
      ['require(variable)', `export function w(mod: string) { const m = require(mod); return m; }`],
      ['require(template)', 'export function w(n: string) { const m = require(`./x-${n}`); return m; }'],
      ['require() no argument', `export function w() { const m = require(); return m; }`],
    ];
    for (const [label, code] of cases) {
      const sf = ts.createSourceFile(`fake-req-opaque-${label}.ts`, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const result = detectFsWriteCapability(sf);
      expect(result.opaqueDynamicImports?.length, `${label} did not fail closed`).toBe(1);
      expect(result.hasWriteCapability, `${label} passed the guard`).toBe(true);
    }
  });

  it('a type-only import() type annotation is NOT flagged', () => {
    const code = `type S = import('@/lib/contracts').CommandSurface;
export function f(s: S) { return s; }`;
    const sf = ts.createSourceFile('fake-type-import.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectFsWriteCapability(sf);
    expect(result.hasWriteCapability).toBe(false);
  });

  it('window.fetch with a write method is detected', () => {
    const code = `export function f(url: string) { return window.fetch(url, { method: 'POST' }); }`;
    const sf = ts.createSourceFile('fake-window-fetch.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-window-fetch.ts').hasWriteCapability).toBe(true);
  });

  it('globalThis.fetch with a write method is detected', () => {
    const code = `export function f(url: string) { return globalThis.fetch(url, { method: 'POST' }); }`;
    const sf = ts.createSourceFile('fake-globalthis-fetch.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-globalthis-fetch.ts').hasWriteCapability).toBe(true);
  });

  it('an aliased fetch is detected — the tracking is real, not a comment', () => {
    // Phase 5.2's comment at application-capability.ts:246 claimed alias
    // tracking that did not exist. This asserts the behaviour it claimed.
    const code = `const f = fetch;
export function g(url: string) { return f(url, { method: 'POST' }); }`;
    const sf = ts.createSourceFile('fake-fetch-alias.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-fetch-alias.ts').hasWriteCapability).toBe(true);
  });

  it('an aliased window.fetch is detected', () => {
    const code = `const f = window.fetch;
export function g(url: string) { return f(url, { method: 'POST' }); }`;
    const sf = ts.createSourceFile('fake-window-alias.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-window-alias.ts').hasWriteCapability).toBe(true);
  });

  it('an aliased fetch used with a SAFE GET is still allowed', () => {
    const code = `const f = fetch;
export function g(url: string) { return f(url, { method: 'GET' }); }`;
    const sf = ts.createSourceFile('fake-window-alias-get.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-window-alias-get.ts').hasWriteCapability).toBe(false);
  });

  it('window.fetch with an explicit GET is allowed', () => {
    const code = `export function f(url: string) { return window.fetch(url, { method: 'GET' }); }`;
    const sf = ts.createSourceFile('fake-window-get.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-window-get.ts').hasWriteCapability).toBe(false);
  });

  it('a computed method key is detected', () => {
    const code = `export function f(url: string) { return fetch(url, { ['method']: 'DELETE' }); }`;
    const sf = ts.createSourceFile('fake-computed-key.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const transport = detectTransportWriteCapabilityInSource(sf, 'fake-computed-key.ts');
    expect(transport.hasWriteCapability).toBe(true);
    expect(transport.suspiciousCalls[0].reason).toMatch(/computed/);
  });

  it('an ordinary two-argument helper call is NOT flagged as transport', () => {
    // Guards the fail-closed rule against becoming a blanket false-positive.
    const code = `function add(a: string, b: string) { return a + b; }
export function g(a: string) { return add(a, 'x'); }`;
    const sf = ts.createSourceFile('fake-helper-call.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-helper-call.ts').hasWriteCapability).toBe(false);
  });

  it('ordinary helper calls with string, boolean, numeric, or domain options are not transport writes', () => {
    const code = `function loadMessages(channel: string, hideCoordination: boolean) {}
function neighborhood(focus: string, depth: number) {}
function search(query: string, domain: string) {}
export function run() { loadMessages('common', true); neighborhood('root', 2); search('policy', 'library'); }`;
    const sf = ts.createSourceFile('fake-domain-helpers.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-domain-helpers.ts').hasWriteCapability).toBe(false);
  });

  it('an unresolved callable with a request-init-shaped object remains fail-closed', () => {
    const code = `export function run(url: string) { unknownTransport(url, { method: 'POST', body: 'x' }); }`;
    const sf = ts.createSourceFile('fake-unresolved-request.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectTransportWriteCapabilityInSource(sf, 'fake-unresolved-request.ts');
    expect(result.hasWriteCapability).toBe(true);
    expect(result.suspiciousCalls[0].reason).toMatch(/unresolved callable/);
  });

  it('an unresolved callable with an options/init variable remains fail-closed', () => {
    const code = `export function run(url: string, requestInit: RequestInit) { unknownTransport(url, requestInit); }`;
    const sf = ts.createSourceFile('fake-unresolved-init.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-unresolved-init.ts').hasWriteCapability).toBe(true);
  });

  it('resolves a renamed options variable initializer for an unresolved callable', () => {
    const code = `const cfg = { method: 'POST' };
export function run(url: string) { send(url, cfg); }`;
    const sf = ts.createSourceFile('fake-renamed-init.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectTransportWriteCapabilityInSource(sf, 'fake-renamed-init.ts');
    expect(result.hasWriteCapability).toBe(true);
    expect(result.suspiciousCalls[0].reason).toMatch(/unresolved callable/);
  });

  it('resolves an aliased fetch call and arbitrary RequestInit variable names', () => {
    const code = `const send = fetch;
const cfg = { method: 'POST' };
export function run(url: string) { return send(url, cfg); }`;
    const sf = ts.createSourceFile('fake-fetch-alias-init.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectTransportWriteCapabilityInSource(sf, 'fake-fetch-alias-init.ts');
    expect(result.hasWriteCapability).toBe(true);
    expect(result.suspiciousCalls[0].reason).toBe("fetch with method 'POST'");
  });

  it('accepts a resolved read-only GET options variable', () => {
    const code = `const requestCfg = { method: 'GET', cache: 'no-store' };
export function run(url: string) { return fetch(url, requestCfg); }`;
    const sf = ts.createSourceFile('fake-fetch-get-init.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const result = detectTransportWriteCapabilityInSource(sf, 'fake-fetch-get-init.ts');
    expect(result.hasWriteCapability).toBe(false);
    expect(result.suspiciousCalls).toHaveLength(0);
  });

  it('an imported helper call is NOT flagged as transport', () => {
    const code = `import { fetchRawSource } from '@/lib/use-command-surface';
export async function e(p: string) { return fetchRawSource(p); }`;
    const sf = ts.createSourceFile('fake-imported-helper.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(detectTransportWriteCapabilityInSource(sf, 'fake-imported-helper.ts').hasWriteCapability).toBe(false);
  });
});

// ── PROOF 8 — live HTTP boundary still refuses write methods (405) ─────────────
//
// Retained from Phase 5.1 with dynamic method construction to prove the guard
// is the server, not the test's own HTTP method choice.

import { server } from '../server/data-service.mjs';

describe('PROOF 8 — live HTTP boundary refuses all write methods (405)', () => {
  const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

  for (const method of WRITE_METHODS) {
    it(`refuses ${method} at /api/surface`, async () => {
      // Find a free port
      const port = await new Promise<number>(resolve => {
        const probe = createServer();
        probe.listen(0, '127.0.0.1', () => {
          const p = (probe.address() as { port: number }).port;
          probe.close(() => resolve(p));
        });
      });

      await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));

      // Dynamically construct the method so the string never appears as a literal
      // in this file — matching the adversarial construction Codex used.
      const m = method.slice(0, 2) + method.slice(2);

      const status = await new Promise<number>((resolve, reject) => {
        const r = request(
          { host: '127.0.0.1', port, path: '/api/surface', method: m },
          res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); },
        );
        r.on('error', reject);
        r.end();
      });

      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(status).toBe(405);
    });
  }

  it('refuses a dynamically constructed POST to an action-style path', async () => {
    const port = await new Promise<number>(resolve => {
      const probe = createServer();
      probe.listen(0, '127.0.0.1', () => {
        const p = (probe.address() as { port: number }).port;
        probe.close(() => resolve(p));
      });
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const method = ['P', 'OST'].join('');
    const status = await new Promise<number>((resolve, reject) => {
      const r = request(
        { host: '127.0.0.1', port, path: '/api/acknowledge-founder-decision', method },
        res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); },
      );
      r.on('error', reject);
      r.end();
    });
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(status).toBe(405);
  });
});

// ── PROOF 9 — production build output is present and contains no write APIs ───

describe('PROOF 9 — production build artefact is present', () => {
  const distDir = path.join(root, 'dist');
  const distAssets = path.join(distDir, 'assets');

  it('dist/ directory exists (production build has been run)', () => {
    expect(existsSync(distDir), 'dist/ missing — run npm run build').toBe(true);
  });

  it('dist/assets/ contains at least one JS bundle', () => {
    if (!existsSync(distAssets)) {
      // dist/ may be missing; PROOF 9 first test will catch it
      return;
    }
    const bundles = readdirSync(distAssets).filter(n => n.endsWith('.js'));
    expect(bundles.length, 'no JS bundle in dist/assets/').toBeGreaterThan(0);
  });

  it('no bundle in dist/assets/ contains a writeFileSync token', () => {
    if (!existsSync(distAssets)) return;
    const bundles = readdirSync(distAssets).filter(n => n.endsWith('.js'));
    for (const bundle of bundles) {
      const text = readFileSync(path.join(distAssets, bundle), 'utf8');
      expect(
        text,
        `${bundle} contains writeFileSync — a write API reached the bundle`,
      ).not.toContain('writeFileSync');
      expect(
        text,
        `${bundle} contains createWriteStream`,
      ).not.toContain('createWriteStream');
    }
  });
});

// ── PROOF 10 — Phase 5 / 5.1 behaviour is unchanged ─────────────────────────
//
// Cross-check: the deterministic fixture surface test still behaves.
// (Full Phase 5 test suite runs as part of the same npm test invocation.)

describe('PROOF 10 — Phase 5/5.1 source guards are still in place', () => {
  it('the attention surface does not read needs_founder', () => {
    const attentionFile = path.join(SRC, 'surfaces', 'attention.tsx');
    expect(existsSync(attentionFile)).toBe(true);
    const raw = readFileSync(attentionFile, 'utf8');
    // Strip block comments - sufficient for identifier-level checks
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Strip string literals so rendered copy ("needs_founder") does not trip the guard
    const noStrings = noBlock
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      .replace(/'[^'\n]*'/g, "''")
      .replace(/"[^"\n]*"/g, '""');
    expect(noStrings).not.toMatch(/\bneeds_founder\b/);
  });

  it('the attention surface has no .sort() call', () => {
    const attentionFile = path.join(SRC, 'surfaces', 'attention.tsx');
    const raw = readFileSync(attentionFile, 'utf8');
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(noBlock).not.toMatch(/\.sort\s*\(/);
  });

  it('Phase 5.2 introduces no Phase 6 surface, nav entry, or route', () => {
    const shellFile = path.join(SRC, 'surfaces', 'phase-shell.tsx');
    const shellSrc = readFileSync(shellFile, 'utf8');
    expect(shellSrc).not.toMatch(/id:\s*'(next|future|phase6|phase-6|insight|portfolio)'/);
    expect(shellSrc).not.toMatch(/phase:\s*(6|8|9)\b/);

    // No Phase 6 server module
    const serverFiles = readdirSync(SERVER);
    for (const name of ['phase6.mjs', 'actions.mjs', 'mutations.mjs', 'broker.mjs']) {
      expect(serverFiles, `${name} must not exist in server/`).not.toContain(name);
    }

    // No Phase 6 surface file
    const surfaceFiles = readdirSync(path.join(SRC, 'surfaces'));
    for (const name of ['phase6.tsx', 'actions.tsx', 'mutations.tsx', 'broker.tsx']) {
      expect(surfaceFiles, `${name} must not exist in src/surfaces/`).not.toContain(name);
    }
  });
});
