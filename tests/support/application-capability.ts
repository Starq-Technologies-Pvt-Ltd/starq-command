/**
 * tests/support/application-capability.ts
 *
 * Shared AST-walking utilities for Phase 5.2 read-only capability boundary
 * tests. Centralises:
 *   - full application source-tree enumeration
 *   - TypeScript/TSX source parsing
 *   - filesystem write-capability detection (direct + aliased + namespaced)
 *   - client transport write-capability detection (all hiding patterns)
 *
 * Nothing here asserts. Assertions live in the test file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ── Source tree enumeration ──────────────────────────────────────────────────

/** Recursively collect every .ts / .tsx file under a directory. */
export function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTs(full, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Collect all server .mjs files. */
export function collectMjs(dir: string): string[] {
  return readdirSync(dir)
    .filter(n => n.endsWith('.mjs'))
    .map(n => path.join(dir, n));
}

// ── Parse helpers ────────────────────────────────────────────────────────────

export function parseSource(file: string): ts.SourceFile {
  const src = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
}

export function sourceText(file: string): string {
  return readFileSync(file, 'utf8');
}

// ── Walk helpers ─────────────────────────────────────────────────────────────

/** Collect all CallExpression nodes in a subtree.
 *
 * The SourceFile is threaded explicitly and used for getChildren().
 *
 * Note (verified by probe, not assumed): ts.forEachChild() is NOT broken on
 * this parse tree — a one-line and a nested function-body call are both found
 * by either walker. AG's original diagnosis blamed forEachChild, but the actual
 * defect was a call site passing only one argument. The explicit `sf` is kept
 * because getChildren(sf) is the documented traversal entry point and makes the
 * required argument impossible to omit silently at a call site.
 */
export function collectCalls(
  node: ts.Node,
  sf: ts.SourceFile,
  out: ts.CallExpression[] = [],
): ts.CallExpression[] {
  if (ts.isCallExpression(node)) out.push(node);
  for (const child of node.getChildren(sf)) collectCalls(child, sf, out);
  return out;
}

/** Collect all ImportDeclaration nodes (top-level only). */
export function collectImports(sf: ts.SourceFile): ts.ImportDeclaration[] {
  const out: ts.ImportDeclaration[] = [];
  for (const child of sf.getChildren(sf)) {
    // SourceFile's first child is typically a SyntaxList
    if (ts.isSyntaxList(child) || child.kind === ts.SyntaxKind.SyntaxList) {
      for (const stmt of child.getChildren(sf)) {
        if (ts.isImportDeclaration(stmt)) out.push(stmt);
      }
    }
    if (ts.isImportDeclaration(child)) out.push(child);
  }
  return out;
}

/**
 * Collect every dynamic `import(...)` expression in a subtree.
 *
 * PHASE 5.3 — this collector exists because the Phase 5.2 guard was bypassable
 * by real files. detectFsWriteCapability walked ONLY ImportDeclaration nodes, so
 * `const m = await import('node:fs'); m.writeFileSync(p, d);` produced no import
 * declaration, therefore no writable name, no namespace, no call site, and
 * `hasWriteCapability: false`. DP proved this in-situ at 62/62 green against a
 * real src/components/ file. A dynamic import is syntactically a CallExpression
 * whose expression is an ImportExpression node (ts.SyntaxKind.ImportKeyword
 * child under a CallExpression), so it must be collected separately.
 */
export function collectDynamicImports(
  node: ts.Node,
  sf: ts.SourceFile,
  out: ts.CallExpression[] = [],
): ts.CallExpression[] {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    out.push(node);
  }
  for (const child of node.getChildren(sf)) collectDynamicImports(child, sf, out);
  return out;
}

/** Collect VariableDeclarations that are initialised from a named expression. */
export function collectVarDeclarations(
  node: ts.Node,
  sf: ts.SourceFile,
  out: ts.VariableDeclaration[] = [],
): ts.VariableDeclaration[] {
  if (ts.isVariableDeclaration(node)) out.push(node);
  for (const child of node.getChildren(sf)) collectVarDeclarations(child, sf, out);
  return out;
}

// ── Filesystem write-capability detection ─────────────────────────────────────
//
// Canonical write-capable Node FS APIs we guard against.
// Both sync and async forms, including the promises sub-module.
//
// Why include readFile / createReadStream? We do NOT — they are read-only and
// are used legitimately by the server. Only write-capable APIs are listed.

const FS_WRITE_APIS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'rename',
  'renameSync',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'copyFile',
  'copyFileSync',
  'truncate',
  'truncateSync',
  'ftruncate',
  'ftruncateSync',
  'open',        // O_WRONLY / O_RDWR open for writing
  'createWriteStream',
  'write',
  'writeSync',
  'writev',
  'writevSync',
]);

/**
 * FS write-capable module specifiers.
 * Both bare names and node:-prefixed forms.
 */
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

/**
 * Result of analysing a single source file for FS write capability.
 */
export interface FsWriteCapability {
  /** Local names that carry write capability: direct bindings + aliases. */
  writableNames: Set<string>;
  /** Namespace objects that carry the full FS module: `import * as fs from 'fs'`. */
  namespaceNames: Set<string>;
  /** Whether fs/promises (or node:fs/promises) is imported at all. */
  promisesModuleImported: boolean;
  /** Call sites that invoke a writable name. */
  writeCalls: ts.CallExpression[];
  /**
   * PHASE 5.3 — dynamic `import()` of an FS module. Each entry is the
   * CallExpression. A dynamic FS import grants the same write capability as a
   * static one, because the returned namespace exposes every write API.
   *
   * Typed optional so the real-tree mutation harness can also be run against
   * the Phase 5.2 guard (which has no such field) to demonstrate non-vacuity
   * without throwing on `undefined.length`.
   */
  dynamicFsImports?: ts.CallExpression[];
  /**
   * PHASE 5.3 — dynamic `import()` whose specifier is NOT a string literal
   * (`await import(someVar)`). The module cannot be statically identified, so
   * the guard FAILS CLOSED: an unresolvable specifier could be `node:fs`.
   */
  opaqueDynamicImports?: ts.CallExpression[];
  /** Whether any write capability exists. */
  hasWriteCapability: boolean;
}

/**
 * Analyse one source file for filesystem write capability.
 *
 * Detection strategy:
 *
 *   1. Direct named import:  import { writeFileSync } from 'fs'
 *   2. Aliased named import: import { writeFileSync as w } from 'fs'
 *   3. Namespace import:     import * as myFs from 'fs'
 *      → guard: myFs.writeFileSync(...)
 *   4. fs/promises module:   import { writeFile } from 'fs/promises'
 *      → same alias tracking
 *   5. Call-site scan: look for any call whose callee resolves to a write name
 *      (direct call OR member expression on a namespace).
 *
 *   6. PHASE 5.3 — DYNAMIC import: `await import('node:fs')` and the bare /
 *      node:-prefixed / promises variants. Phase 5.2 enumerated static
 *      ImportDeclaration nodes ONLY, so a real src/components file using a
 *      dynamic import passed the whole guard. Verified in-situ by DP.
 *   7. PHASE 5.3 — FAIL CLOSED on `import(expr)` with a non-literal specifier:
 *      the module is unresolvable and could be node:fs.
 *   8. PHASE 5.3 — ANY member access on a dynamic FS namespace is write
 *      capability, not just known write API names. Rationale: a namespace
 *      obtained from import() is fully opaque to name-level analysis, so
 *      whitelisting member names would reintroduce exactly the hole Phase 5.2
 *      had. Read-only use of a dynamic fs namespace is not a supported pattern
 *      in this application (the real tree imports read APIs statically).
 */
export function detectFsWriteCapability(sf: ts.SourceFile): FsWriteCapability {
  const writableNames = new Set<string>();
  const namespaceNames = new Set<string>();
  let promisesModuleImported = false;

  for (const imp of collectImports(sf)) {
    const moduleSpec = imp.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpec)) continue;
    const specifier = moduleSpec.text;
    if (!FS_MODULES.has(specifier)) continue;

    if (specifier === 'fs/promises' || specifier === 'node:fs/promises') {
      promisesModuleImported = true;
    }

    const clause = imp.importClause;
    if (!clause) continue;

    // namespace import: import * as fs from 'fs'
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      namespaceNames.add(clause.namedBindings.name.text);
    }

    // named imports: import { writeFileSync, writeFileSync as w } from 'fs'
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        // el.propertyName is the original export name (if aliased)
        const original = el.propertyName?.text ?? el.name.text;
        if (FS_WRITE_APIS.has(original)) {
          writableNames.add(el.name.text); // local binding name
        }
      }
    }

    // default import: import fs from 'fs'
    if (clause.name) {
      // treat as a namespace-like handle
      namespaceNames.add(clause.name.text);
    }
  }

  // ── PHASE 5.3 — dynamic import scan ───────────────────────────────────────
  const dynamicFsImports: ts.CallExpression[] = [];
  const opaqueDynamicImports: ts.CallExpression[] = [];

  for (const dynCall of collectDynamicImports(sf, sf)) {
    const specifierArg = dynCall.arguments[0];
    if (specifierArg && ts.isStringLiteralLike(specifierArg)) {
      if (FS_MODULES.has(specifierArg.text)) {
        dynamicFsImports.push(dynCall);
        if (
          specifierArg.text === 'fs/promises' ||
          specifierArg.text === 'node:fs/promises'
        ) {
          promisesModuleImported = true;
        }
      }
    } else {
      // import(expr) — unresolvable module. Fail closed.
      opaqueDynamicImports.push(dynCall);
    }
  }

  // ── PHASE 5.3 — CommonJS require() of an FS module ─────────────────────────
  //
  // `const m = require('node:fs'); m.writeFileSync(p, d);` is the same
  // capability reached through a different door. It is not an ImportDeclaration
  // and not an import(), so neither pass above sees it. A non-literal
  // `require(x)` fails closed for the same reason `import(x)` does.
  for (const call of collectCalls(sf, sf)) {
    const callee = call.expression;
    if (!ts.isIdentifier(callee) || callee.text !== 'require') continue;
    const arg = call.arguments[0];
    if (arg && ts.isStringLiteralLike(arg) && FS_MODULES.has(arg.text)) {
      dynamicFsImports.push(call);
      if (arg.text === 'fs/promises' || arg.text === 'node:fs/promises') {
        promisesModuleImported = true;
      }
    } else if (!arg || !ts.isStringLiteralLike(arg)) {
      // require(<non-literal>) or require() — unresolvable specifier.
      // A string-literal specifier is exactly as resolvable as an import()
      // of the same string, so only non-literals fail closed.
      opaqueDynamicImports.push(call);
    }
  }

  // Bind names holding a dynamic FS namespace:
  //   const m = await import('node:fs');
  //   const m = (await import('fs/promises')).default;
  //   const { writeFile } = await import('fs/promises');
  // These handles are tracked SEPARATELY from static namespaceNames, because
  // any member access on them is write capability (see strategy 8).
  const dynamicFsNamespaces = new Set<string>();
  const dynamicFsDestructured = new Set<string>();
  for (const decl of collectVarDeclarations(sf, sf)) {
    if (!decl.initializer) continue;
    const init = decl.initializer;
    // Unwrap await: const m = await import(...)
    const inner = init.kind === ts.SyntaxKind.AwaitExpression
      ? (init as ts.AwaitExpression).expression
      : init;
    // Unwrap `.default` / member chains down to the import() call itself.
    let expr: ts.Expression = inner;
    while (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      expr = expr.expression;
    }
    if (expr.kind !== ts.SyntaxKind.ImportKeyword) continue;
    const arg = (expr as ts.CallExpression).arguments[0];
    const isFsModule = !!arg && ts.isStringLiteralLike(arg) && FS_MODULES.has(arg.text);
    if (!isFsModule) continue;

    if (ts.isIdentifier(decl.name)) {
      dynamicFsNamespaces.add(decl.name.text);
    } else if (ts.isObjectBindingPattern(decl.name)) {
      for (const el of decl.name.elements) {
        if (ts.isIdentifier(el.name)) dynamicFsDestructured.add(el.name.text);
      }
    }
  }

  // Same binding logic for CommonJS: `const m = require('node:fs')`
  for (const decl of collectVarDeclarations(sf, sf)) {
    if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
    const init = decl.initializer;
    if (!ts.isCallExpression(init)) continue;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== 'require') continue;
    const arg = init.arguments[0];
    if (!arg || !ts.isStringLiteralLike(arg) || !FS_MODULES.has(arg.text)) continue;
    dynamicFsNamespaces.add(decl.name.text);
  }
  // A destructured dynamic FS binding is write capability by itself — the
  // binding exists to reach a write API. Any call through it is also flagged.
  for (const name of dynamicFsDestructured) writableNames.add(name);

  // Call-site scan
  const writeCalls: ts.CallExpression[] = [];
  for (const call of collectCalls(sf, sf)) {
    const expr = call.expression;

    // Direct call: writableNames.has(callee name)
    if (ts.isIdentifier(expr) && writableNames.has(expr.text)) {
      writeCalls.push(call);
      continue;
    }

    // Member-expression call: namespace.writeApi(...)
    if (ts.isPropertyAccessExpression(expr)) {
      const obj = expr.expression;
      const prop = expr.name.text;
      if (ts.isIdentifier(obj) && namespaceNames.has(obj.text) && FS_WRITE_APIS.has(prop)) {
        writeCalls.push(call);
        continue;
      }
      // PHASE 5.3 strategy 8: ANY member call on a dynamic FS namespace is
      // write capability — the namespace is opaque to name-level analysis.
      if (ts.isIdentifier(obj) && dynamicFsNamespaces.has(obj.text)) {
        writeCalls.push(call);
        continue;
      }
    }
  }

  const hasWriteCapability =
    writableNames.size > 0 ||
    promisesModuleImported ||
    writeCalls.length > 0 ||
    dynamicFsImports.length > 0 ||
    opaqueDynamicImports.length > 0;

  return {
    writableNames,
    namespaceNames,
    promisesModuleImported,
    writeCalls,
    dynamicFsImports,
    opaqueDynamicImports,
    hasWriteCapability,
  };
}

// ── Client transport write-capability detection ───────────────────────────────
//
// Guard against non-GET HTTP capability in the UI layer.
// Patterns covered:
//   1. fetch(url, { method: 'POST' })           — literal
//   2. fetch(url, { method: POST_CONST })       — identifier
//   3. fetch(url, { method: someVar })          — identifier (any non-literal = suspicious)
//   4. fetch(url, opts)                         — variable options (cannot verify method)
//   5. fetch(url, { ...opts })                  — spread (cannot verify method)
//   6. XMLHttpRequest.open('POST', ...)         — XHR (covered for completeness)
//   7. const myFetch = fetch; myFetch(...)      — aliased fetch
//
//   PHASE 5.3 ADDITIONS (DP found all four of these passing in-situ):
//   8. window.fetch / globalThis.fetch / any `<obj>.fetch` — the callee is a
//      PropertyAccessExpression, not an Identifier named `fetch`, so the
//      Phase 5.2 check missed it entirely.
//   9. Fetch aliases resolved through variable declarations, INCLUDING
//      `const f = window.fetch` and `const g = someObj.fetch`. This tracking
//      is REAL and implemented in `collectFetchAliasNames` below — the Phase
//      5.2 comment claimed it and it did not exist. Verified in-situ.
//  10. Computed property keys in the options object: { ['method']: 'DELETE' }.
//      A ComputedPropertyName is not a PropertyAssignment name the old
//      `.find()` could match, so the call fell through to "no method key →
//      GET". Any computed key in the options object is now suspicious.
//  11. UNRESOLVED aliases fail closed. A call through an identifier that
//      cannot be proven to be a local non-fetch function, carrying a second
//      argument, is treated as a possible fetch and its options are analysed.
//      See the `provablyNotFetch` exclusion set in the detector below.
//
// The ONLY safe forms are:
//   fetch(url)                                  — no options → defaults to GET
//   fetch(url, { method: 'GET' })               — explicit GET string literal
//   fetch(url, { method: 'HEAD' })              — explicit HEAD string literal

export interface TransportWriteCapability {
  suspiciousCalls: Array<{ file: string; text: string; reason: string }>;
  hasWriteCapability: boolean;
}

const SAFE_METHODS = new Set(['GET', 'get', 'HEAD', 'head']);

/**
 * PHASE 5.3 — resolve local names that are aliases of `fetch`.
 *
 * A name is a fetch alias when its declaration initialises from:
 *   - the bare identifier `fetch`
 *   - ANY property access whose property name is `fetch`
 *     (window.fetch, globalThis.fetch, this.fetch, obj.fetch, ...)
 *   - another name already known to be a fetch alias (transitive)
 *
 * This is real tracking, not a comment. If the chain cannot be resolved to a
 * fetch expression the name is simply not an alias — but the separate
 * fail-closed rule in `unresolvedCallables` covers the residue.
 */
function collectFetchAliasNames(sf: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();

  // Iterate to a fixed point so transitive aliases resolve:
  //   const a = fetch; const b = a; b(url, {method:'POST'})
  for (let pass = 0; pass < 5; pass++) {
    let grew = false;
    for (const decl of collectVarDeclarations(sf, sf)) {
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      if (aliases.has(name)) continue;
      const init = decl.initializer;
      const isFetchExpr =
        (ts.isIdentifier(init) && init.text === 'fetch') ||
        (ts.isIdentifier(init) && aliases.has(init.text)) ||
        (ts.isPropertyAccessExpression(init) && init.name.text === 'fetch');
      if (isFetchExpr) {
        aliases.add(name);
        grew = true;
      }
    }
    if (!grew) break;
  }

  return aliases;
}

/**
 * PHASE 5.3 — property names that hold a fetch function, tracked across two
 * shapes the alias resolver above cannot see:
 *
 *   const api = { send: fetch };        →  api.send(u, { method: 'POST' })
 *   function getFetcher() { return fetch; }  →  getFetcher()(u, {method:'POST'})
 *
 * The first is an object-literal property; the second is a function RETURN,
 * which makes the call site `getFetcher()(...)` — a call whose callee is
 * itself a CallExpression, so it is not an identifier alias at all.
 *
 * Both return the SET of "names that produce a fetch when called". A call
 * whose callee is a PropertyAccess on such a name, or whose callee is a call
 * to a function that returns fetch, is analysed as a fetch call.
 */
function collectFetchCarriers(sf: ts.SourceFile): {
  objectProps: Set<string>;
  factoryFns: Set<string>;
} {
  const objectProps = new Set<string>();
  const factoryFns = new Set<string>();

  // const api = { send: fetch }
  for (const decl of collectVarDeclarations(sf, sf)) {
    const init = decl.initializer;
    if (!init || !ts.isObjectLiteralExpression(init)) continue;
    for (const prop of init.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const value = prop.initializer;
      if (ts.isIdentifier(value) && value.text === 'fetch') {
        const name = prop.name;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
          objectProps.add(name.text);
        }
      }
    }
  }

  // function getFetcher() { return fetch; }
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    const returnsFetch = stmt.body.statements.some(
      s =>
        ts.isReturnStatement(s) &&
        !!s.expression &&
        ts.isIdentifier(s.expression) &&
        s.expression.text === 'fetch',
    );
    if (returnsFetch) factoryFns.add(stmt.name.text);
  }

  return { objectProps, factoryFns };
}

/**
 * Analyse ONE already-parsed source file for client-side write-capable transport.
 *
 * Takes a ts.SourceFile rather than a path so that callers holding an in-memory
 * / synthetic AST (test fixtures, PROOF 7) can exercise the real detection
 * logic without a file on disk. `label` is used only for reporting.
 */
export function detectTransportWriteCapabilityInSource(
  sf: ts.SourceFile,
  label: string,
): TransportWriteCapability {
  const suspiciousCalls: TransportWriteCapability['suspiciousCalls'] = [];
  const allCalls = collectCalls(sf, sf);
  const fetchAliases = collectFetchAliasNames(sf);
  const carriers = collectFetchCarriers(sf);

  /**
   * PHASE 5.3 rule 11 — fail closed on unresolved callables.
   *
   * A local function declaration or an import binding is PROVABLY not fetch,
   * so it is excluded. Everything else that is called with a second argument
   * is analysed as a possible fetch. This catches alias chains the resolver
   * cannot follow (e.g. an alias returned from another module) without
   * inventing an unbounded false-positive surface over ordinary helpers,
   * which are almost never called with an options-object second argument.
   */
  const provablyNotFetch = new Set<string>();
  for (const decl of collectVarDeclarations(sf, sf)) {
    if (ts.isIdentifier(decl.name) && decl.initializer && ts.isArrowFunction(decl.initializer)) {
      provablyNotFetch.add(decl.name.text);
    }
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) provablyNotFetch.add(stmt.name.text);
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (clause?.name) provablyNotFetch.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) provablyNotFetch.add(el.name.text);
      }
    }
  }
  for (const nonFetch of provablyNotFetch) fetchAliases.delete(nonFetch);

  /** True when the callee expression denotes a fetch (direct, property, alias). */
  const isFetchCallee = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) {
      return callee.text === 'fetch' || fetchAliases.has(callee.text);
    }
    // PHASE 5.3 rule 8: ANY property access named `fetch`, on ANY object.
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch') return true;
    // PHASE 5.3: a property that was assigned `fetch` in an object literal.
    if (ts.isPropertyAccessExpression(callee) && carriers.objectProps.has(callee.name.text)) {
      return true;
    }
    // Element access: globalThis['fetch'], window['fetch']
    if (ts.isElementAccessExpression(callee)) {
      const arg = callee.argumentExpression;
      if (arg && ts.isStringLiteralLike(arg) && arg.text === 'fetch') return true;
    }
    // PHASE 5.3: `getFetcher()(...)` where getFetcher returns fetch. The callee
    // is a CallExpression, not an identifier, so it is invisible to aliasing.
    if (ts.isCallExpression(callee)) {
      const inner = callee.expression;
      if (ts.isIdentifier(inner) && carriers.factoryFns.has(inner.text)) return true;
    }
    return false;
  };

  for (const call of allCalls) {
    const callee = call.expression;

    // Direct `fetch(...)`, `window.fetch(...)`, `globalThis.fetch(...)`,
    // or a resolved alias `f(...)` — all handled by isFetchCallee.
    if (isFetchCallee(callee)) {
      const optionsArg = call.arguments[1];
      if (!optionsArg) continue; // no options → GET by default ✓

      // Options is an object literal — inspect method property
      if (ts.isObjectLiteralExpression(optionsArg)) {
        // A spread can carry `method` in at runtime and cannot be verified
        // statically, so ANY spread in the options object is suspicious.
        // (Verified hole: fetch(url, { ...opts }) previously fell through to
        // the "no method key → GET" branch and was treated as safe.)
        const hasSpread = optionsArg.properties.some(ts.isSpreadAssignment);
        if (hasSpread) {
          suspiciousCalls.push({
            file: label,
            text: call.getText(sf),
            reason: 'fetch options contain a spread — method cannot be statically verified',
          });
          continue;
        }

        // PHASE 5.3 rule 10 — a COMPUTED key ({ ['method']: 'DELETE' }) is not
        // a matchable PropertyAssignment name, so it used to fall through to
        // the "no method key → GET" branch. Any computed key is suspicious:
        // the key cannot be resolved statically, so the method is unverifiable.
        const hasComputedKey = optionsArg.properties.some(
          p =>
            (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
            ts.isComputedPropertyName(p.name),
        );
        if (hasComputedKey) {
          suspiciousCalls.push({
            file: label,
            text: call.getText(sf),
            reason:
              'fetch options contain a computed property key — method cannot be statically verified',
          });
          continue;
        }

        const methodProp = optionsArg.properties.find(
          p =>
            ts.isPropertyAssignment(p) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
            (p.name as ts.Identifier).text === 'method',
        ) as ts.PropertyAssignment | undefined;

        if (!methodProp) continue; // no method key → GET ✓

        const init = methodProp.initializer;

        // String literal — check value
        if (ts.isStringLiteral(init)) {
          if (!SAFE_METHODS.has(init.text)) {
            const urlArg = call.arguments[0];
            const isBoundedControlPlane =
              urlArg &&
              ((ts.isStringLiteral(urlArg) &&
                (urlArg.text.startsWith('/api/herdr/') || urlArg.text.startsWith('/api/command/'))) ||
                (ts.isNoSubstitutionTemplateLiteral(urlArg) &&
                  (urlArg.text.startsWith('/api/herdr/') || urlArg.text.startsWith('/api/command/'))) ||
                (ts.isTemplateExpression(urlArg) &&
                  (urlArg.head.text.startsWith('/api/herdr/') || urlArg.head.text.startsWith('/api/command/'))));

            if (!isBoundedControlPlane) {
              suspiciousCalls.push({
                file: label,
                text: call.getText(sf),
                reason: `fetch with method '${init.text}'`,
              });
            }
          }
          continue;
        }

        // Anything other than a safe string literal is suspicious
        // (identifier, template literal, computed, dynamic expression, spread)
        suspiciousCalls.push({
          file: label,
          text: call.getText(sf),
          reason: `fetch with non-literal method (${init.kind === ts.SyntaxKind.Identifier ? (init as ts.Identifier).text : 'expression'})`,
        });

        continue;
      }

      // Options is NOT an object literal (variable, spread assignment, etc.)
      // Cannot verify the method statically → flag as suspicious
      suspiciousCalls.push({
        file: label,
        text: call.getText(sf),
        reason: 'fetch with non-object-literal options (method cannot be statically verified)',
      });
      continue;
    }

    // PHASE 5.3 rule 11 — FAIL CLOSED on an unresolved callable that receives
    // a second argument. It cannot be proven to be a local non-fetch function,
    // and a fetch-like options object as argument 2 is the write signature.
    if (
      ts.isIdentifier(callee) &&
      !provablyNotFetch.has(callee.text) &&
      call.arguments.length >= 2
    ) {
      suspiciousCalls.push({
        file: label,
        text: call.getText(sf),
        reason:
          'call through an unresolved callable with a second argument — may be a fetch alias (fails closed)',
      });
    }

    // XHR: new XMLHttpRequest() + .open('POST', ...) — text-level check
    // (full AST tracking of XHR instances is out of scope; text guard in main test)
  }

  return {
    suspiciousCalls,
    hasWriteCapability: suspiciousCalls.length > 0,
  };
}

/**
 * Analyse a set of source FILES for client-side write-capable transport.
 *
 * Thin wrapper: parses each file from disk and delegates to
 * detectTransportWriteCapabilityInSource, which holds the actual detection.
 */
export function detectTransportWriteCapability(
  files: string[],
): TransportWriteCapability {
  const suspiciousCalls: TransportWriteCapability['suspiciousCalls'] = [];

  for (const file of files) {
    const sf = parseSource(file);
    const result = detectTransportWriteCapabilityInSource(sf, file);
    suspiciousCalls.push(...result.suspiciousCalls);
  }

  return {
    suspiciousCalls,
    hasWriteCapability: suspiciousCalls.length > 0,
  };
}
