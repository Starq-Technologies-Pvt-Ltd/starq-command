import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const src = readFileSync(fileURLToPath(new URL('../server/pm-service.mjs', import.meta.url)), 'utf8');

test('enabled Room posting requires explicit PM_ROOM_FROM and PM_ROOM_INSTANCE', () => {
  assert.match(src, /const ROOM_POST = \(process\.env\.PM_ROOM_POST \|\| 'on'\) !== 'off'/);
  assert.match(src, /const ROOM_FROM = String\(process\.env\.PM_ROOM_FROM \|\| ''\)\.trim\(\)/);
  assert.match(src, /const ROOM_INSTANCE = String\(process\.env\.PM_ROOM_INSTANCE \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(src, /PM_ROOM_FROM \|\| 'claude'/);
  assert.doesNotMatch(src, /claude-9489-audit-final/);
  assert.match(src, /function requireExplicitRoomWriter/);
  assert.match(src, /if \(ROOM_POST\) requireExplicitRoomWriter\(\)/);
  assert.match(src, /function postToRoom\(body\) \{\s*requireExplicitRoomWriter\(\)/);
});
