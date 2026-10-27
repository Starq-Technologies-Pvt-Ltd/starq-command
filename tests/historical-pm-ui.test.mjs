/**
 * Fixture-only UI/source proofs for historical Nexus view (#10646).
 * No runtime start. Does not import React or read canonical Nexus boards.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

test('historical UI is labelled HISTORICAL/READ_ONLY and has no native task actions', () => {
  const ui = read('src', 'surfaces', 'historical-pm.tsx');
  assert.match(ui, /HISTORICAL/);
  assert.match(ui, /READ_ONLY/);
  assert.match(ui, /actionable=false/);
  assert.match(ui, /data-historical-pm="true"/);
  assert.doesNotMatch(ui, /\/api\/pm|pm-client|PmBoardSurface|pmTasks|createTask|expected_updated_at/);
  assert.doesNotMatch(ui, /writeFileSync|fetch\(/);
});

test('Building router mounts historical view without feeding records into PmBoardSurface', () => {
  const router = read('src', 'surfaces', 'building.tsx');
  assert.match(router, /HistoricalPmSurface/);
  assert.match(router, /historical=\{b\.historical_pm\}/);
  assert.match(router, /Historical Nexus records \(HISTORICAL_SNAPSHOT · READ_ONLY · not native tasks\)/);
  const pmMounts = [...router.matchAll(/<PmBoardSurface projectId="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(pmMounts.sort(), ['erp', 'hoadha']);
  assert.doesNotMatch(router, /<PmBoardSurface[^>]*historical/);
  assert.doesNotMatch(router, /historical_pm[\s\S]{0,80}<PmBoardSurface/);
});
