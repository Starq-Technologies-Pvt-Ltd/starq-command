import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Phase 7 — the SEPARATE read-only Building/project origin.
 *
 * Room seq 8361 is the governing decision these tests exist to hold:
 *
 *   "do not add Hoadha assembly directly into frozen server/data-service.mjs.
 *    Hoadha must be exposed through the separate read-only Building/project
 *    projection path already established for Phase 7.
 *    data-service.mjs remains protected tonight."
 *
 * The preserved Wave A work violated this: commit 62ee760 added four lines to
 * data-service.mjs to attach the Building projection. These tests are the
 * regression guard for that specific violation, so it cannot silently return.
 */

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const SERVER = path.join(APP_ROOT, 'server');
const SRC = path.join(APP_ROOT, 'src');

const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8');

describe('Phase 7 — the frozen data service is protected (Room seq 8361)', () => {
  it('data-service.mjs contains no Building or Hoadha assembly at all', () => {
    // #9535 may document missing work sources in comments. Guard executable
    // assembly, not explanatory prose; no Building import or invocation is allowed.
    const service = read(SERVER, 'data-service.mjs')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Not imported, not invoked, not declared, not named in executable code.
    expect(service).not.toMatch(/building\.mjs/);
    expect(service).not.toMatch(/BUILDING_SOURCES/);
    expect(service).not.toMatch(/buildBuilding/);
    expect(service).not.toMatch(/hoadha/i);
  });

  it('the Building projection reaches the UI over its own endpoint', () => {
    const hook = read(SRC, 'lib', 'use-command-surface.ts');
    expect(hook).toMatch(/fetch\('\/api\/building'/);
    // It must NOT be smuggled in through the frozen surface endpoint.
    const app = read(SRC, 'App.tsx');
    expect(app).toMatch(/useBuildingProjection/);
  });
});

describe('Phase 7 — the Building origin is read-only structurally', () => {
  const origin = read(SERVER, 'building-service.mjs');

  it('refuses every non-GET method before any route is dispatched', () => {
    // The guard must precede route dispatch, exactly as the data service does.
    const guard = origin.indexOf("req.method !== 'GET'");
    const firstRoute = origin.indexOf("url.pathname === '/api/building'");
    expect(guard).toBeGreaterThan(-1);
    expect(firstRoute).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstRoute);
    expect(origin).toMatch(/405/);
  });

  it('declares no write verb, no filesystem write and no transport', () => {
    const forbidden = [
      'writeFileSync',
      'appendFileSync',
      'rmSync',
      'unlinkSync',
      'renameSync',
      'mkdirSync',
      'createWriteStream',
      'fs.promises.writeFile',
      "method: 'POST'",
      "method: 'PUT'",
      "method: 'PATCH'",
      "method: 'DELETE'",
      'WebSocket',
    ];
    for (const token of forbidden) {
      expect(origin, `building origin declares ${token}`).not.toMatch(
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    }
  });

  it('stamps every response DERIVED_PROJECTION and READ_ONLY', () => {
    expect(origin).toMatch(/x-starq-command-authority/);
    expect(origin).toMatch(/DERIVED_PROJECTION/);
    expect(origin).toMatch(/x-starq-command-access/);
    expect(origin).toMatch(/READ_ONLY/);
  });

  it('states in its own header that it is a separate origin', () => {
    expect(origin).toMatch(/separate/i);
    expect(origin).toMatch(/8361/);
  });
});

describe('Phase 7 — the Building origin degrades independently, not silently', () => {
  it('keeps the last good projection and marks it stale rather than blanking', () => {
    const hook = read(SRC, 'lib', 'use-command-surface.ts');
    // The failure path must not clear the retained value.
    expect(hook).toMatch(/setBuildingStale/);
    expect(hook).not.toMatch(/setBuilding\(null\)/);
  });

  it('declares the Building origin state above the project rooms', () => {
    const app = read(SRC, 'App.tsx');
    expect(app).toMatch(/BuildingOriginBanner/);
    // Scoped to the READY branch: that is the branch where both the banner and
    // the project rooms render together, and where the ordering is the claim.
    // (The UNAVAILABLE branch renders BuildingSurface without a separate banner
    // because its own data-service banner already covers that whole region.)
    const ready = app.slice(app.indexOf("status === 'READY' && surface"));
    const banner = ready.indexOf('<BuildingOriginBanner');
    const surface = ready.indexOf('<BuildingSurface');
    expect(banner).toBeGreaterThan(-1);
    expect(surface).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(surface);
  });

  it('never reports a healthy state it did not read', () => {
    const banner = read(SRC, 'App.tsx');
    // A healthy origin renders nothing at all — no banner, no false reassurance.
    expect(banner).toMatch(/if \(status === 'READY' && !stale\) return null/);
  });
});
