import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const previousWorkspace = process.env.STARQ_WORKSPACE;
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'starq-projection-singleflight-'));
mkdirSync(path.join(fixtureRoot, '00_STARQ_HQ'));
writeFileSync(path.join(fixtureRoot, 'STARQ.md'), '# disposable projection-cache fixture\n');
process.env.STARQ_WORKSPACE = fixtureRoot;

const { resolveWorkspace } = await import('../server/paths.mjs');
const { cachedPhase3Surface, invalidateProjectionCache, projectionCacheStats } =
  await import('../server/data-service.mjs');

after(() => {
  if (previousWorkspace === undefined) delete process.env.STARQ_WORKSPACE;
  else process.env.STARQ_WORKSPACE = previousWorkspace;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

test('parallel cold projection readers share one isolated scratch assembly', async () => {
  assert.equal(resolveWorkspace().root, fixtureRoot);

  invalidateProjectionCache();
  const readerCount = 8;
  const projections = await Promise.all(
    Array.from({ length: readerCount }, () => cachedPhase3Surface()),
  );

  assert.equal(projections.length, readerCount);
  assert.ok(projections.every((projection) => projection === projections[0]));
  assert.equal(projectionCacheStats().state, 'WARM');
  assert.equal(projectionCacheStats().hits, readerCount - 1);
});
