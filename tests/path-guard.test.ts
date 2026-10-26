import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRequested, isContained, resolveReadOnlyTarget } from '../server/path-guard.mjs';

/**
 * Regression tests for the /api/raw path-traversal blocker (Room seq 8316).
 *
 * These exist because the existing suite passed 40/40 while the exploit was
 * live: it checked for filesystem WRITE primitives and Nexus imports, and
 * never checked how a requested path is authorised. These tests attack the
 * authorisation decision directly, including the exact string that worked.
 *
 * They run against a synthetic workspace so they are deterministic and never
 * depend on (or touch) real Starq files.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'starq-pathguard-'));

/** Mirrors the declared read-only surface shipped by the data service. */
const ALLOWED = [
  '00_STARQ_HQ/operations/starqerp-control-board',
  'agent-comms/room.jsonl',
  'agent-comms/protocol/v1/identities.json',
  '00_STARQ_HQ/decisions.json',
];

function seed() {
  fs.mkdirSync(path.join(ROOT, '00_STARQ_HQ', 'operations'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'agent-comms', 'protocol', 'v1'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, '_secrets'), { recursive: true });

  fs.writeFileSync(path.join(ROOT, 'CLAUDE.md'), '# master context');
  fs.writeFileSync(path.join(ROOT, 'STARQ.md'), '# front door');
  fs.mkdirSync(path.join(ROOT, '.git'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.git', 'config'), '[core]');
  fs.writeFileSync(path.join(ROOT, '_secrets', 'session.key'), 'SUPER-SECRET-VALUE');
  fs.writeFileSync(path.join(ROOT, 'agent-comms', 'room.jsonl'), '{"eventId":"x"}');
  fs.writeFileSync(path.join(ROOT, 'agent-comms', 'protocol', 'v1', 'identities.json'), '{}');
  fs.writeFileSync(path.join(ROOT, '00_STARQ_HQ', 'decisions.json'), '{}');
  fs.writeFileSync(
    path.join(ROOT, '00_STARQ_HQ', 'operations', 'ONBOARDING.md'),
    '# onboarding',
  );
  fs.mkdirSync(path.join(ROOT, '00_STARQ_HQ', 'operations', 'starqerp-control-board'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(ROOT, '00_STARQ_HQ', 'operations', 'starqerp-control-board', 'contract.json'),
    '{}',
  );
}

seed();

const guard = (requested, allowed = ALLOWED) =>
  resolveReadOnlyTarget({ workspaceRoot: ROOT, requested, allowed });

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('the exact exploit that was live', () => {
  it('BLOCKS the proven traversal string from seq 8316', () => {
    // This exact request returned HTTP 200 and served CLAUDE.md before the fix.
    const exploit =
      '00_STARQ_HQ/operations/ONBOARDING.md/../../../CLAUDE.md';
    const result = guard(exploit);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it('BLOCKS the proven traversal to a secret file', () => {
    const exploit =
      '00_STARQ_HQ/operations/ONBOARDING.md/../../../_secrets/session.key';
    const result = guard(exploit);
    expect(result.ok).toBe(false);
  });

  it('still refuses the direct request the traversal was bypassing', () => {
    // The contrast is the point: both must be refused after the fix.
    expect(guard('CLAUDE.md').ok).toBe(false);
    expect(guard('_secrets/session.key').ok).toBe(false);
  });

  it('does not leak secret contents through any refused variant', () => {
    for (const attack of [
      '00_STARQ_HQ/operations/ONBOARDING.md/../../../_secrets/session.key',
      '00_STARQ_HQ/operations/ONBOARDING.md\\..\\..\\..\\_secrets\\session.key',
      'agent-comms/room.jsonl/../../../_secrets/session.key',
      'agent-comms/protocol/v1/../../../../_secrets/session.key',
    ]) {
      const result = guard(attack);
      expect(result.ok, `${attack} was not blocked`).toBe(false);
      expect(JSON.stringify(result)).not.toContain('SUPER-SECRET-VALUE');
    }
  });
});

describe('equivalent escape forms are rejected', () => {
  const escapes: Array<[string, string]> = [
    ['forward-slash traversal', 'a/../../../etc/passwd'],
    ['backslash traversal (Windows separator)', 'a\\..\\..\\..\\etc\\passwd'],
    ['traversal after an allowed prefix', '00_STARQ_HQ/decisions.json/../../_secrets/session.key'],
    ['traversal to workspace root', 'agent-comms/../../'],
    ['encoded dots (%2e%2e)', 'a/%2e%2e/%2e%2e/CLAUDE.md'],
    ['double-encoded dots', 'a/%252e%252e/CLAUDE.md'],
    ['mixed encoding', 'a/..%2f..%2fCLAUDE.md'],
    ['leading slash (absolute)', '/etc/passwd'],
    ['drive-qualified', 'C:/Windows/win.ini'],
    ['UNC-style', '\\\\server\\share\\file'],
    ['bare dot-dot', '..'],
    ['dot-dot hidden mid-path', 'agent-comms/room.jsonl/../../_secrets/session.key'],
  ];

  for (const [name, attack] of escapes) {
    it(`rejects ${name}`, () => {
      const result = guard(attack);
      expect(result.ok, `${name} was not blocked: ${attack}`).toBe(false);
    });
  }

  it('rejects a NUL byte', () => {
    const result = guard('agent-comms/room.jsonl\u0000.txt');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty or whitespace-only path', () => {
    expect(guard('').ok).toBe(false);
    expect(guard('   ').ok).toBe(false);
  });
});

describe('legitimate declared-source reads still work', () => {
  it('permits an exact declared file', () => {
    const result = guard('agent-comms/room.jsonl');
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(path.join(ROOT, 'agent-comms', 'room.jsonl'));
  });

  it('permits a file inside a declared directory', () => {
    const result = guard('00_STARQ_HQ/operations/starqerp-control-board/contract.json');
    expect(result.ok).toBe(true);
  });

  it('permits a redundant but harmless "." segment', () => {
    const result = guard('agent-comms/./room.jsonl');
    expect(result.ok).toBe(true);
  });

  it('refuses a sibling file that merely shares a prefix', () => {
    // 'agent-comms/room.jsonl.bak' must not pass a naive startsWith check.
    expect(guard('agent-comms/room.jsonl.bak').ok).toBe(false);
  });
});

describe('containment helper', () => {
  it('treats a path as contained in itself', () => {
    expect(isContained(path.join(ROOT, 'a'), ROOT)).toBe(true);
  });

  it('treats a nested path as contained', () => {
    expect(isContained(path.join(ROOT, 'a', 'b'), ROOT)).toBe(true);
  });

  it('does not treat a prefix-sibling as contained', () => {
    expect(isContained(path.join(ROOT, 'ab'), path.join(ROOT, 'a'))).toBe(false);
  });
});

describe('symlink escape is refused', () => {
  it('refuses a symlink inside an allowed directory that points outside', () => {
    const linkDir = path.join(ROOT, '00_STARQ_HQ', 'operations', 'starqerp-control-board', 'escape');
    const outside = path.join(ROOT, '_secrets', 'session.key');
    let created = false;
    try {
      fs.symlinkSync(outside, linkDir, 'file');
      created = true;
    } catch {
      // Symlink creation can require elevation on Windows. If we cannot create
      // one, the traversal tests above still cover the reported blocker.
      return;
    }
    if (!created) return;
    const result = guard(
      '00_STARQ_HQ/operations/starqerp-control-board/escape',
    );
    expect(result.ok).toBe(false);
  });
});

describe('normalisation is explicit and testable', () => {
  it('collapses backslashes to forward slashes', () => {
    const n = normalizeRequested('agent-comms\\room.jsonl');
    expect(n.ok).toBe(true);
    expect(n.relative).toBe('agent-comms/room.jsonl');
  });

  it('collapses "." segments', () => {
    const n = normalizeRequested('agent-comms/./protocol/./v1/identities.json');
    expect(n.ok).toBe(true);
    expect(n.relative).toBe('agent-comms/protocol/v1/identities.json');
  });

  it('refuses ".." segments', () => {
    expect(normalizeRequested('a/../b').ok).toBe(false);
  });

  it('refuses absolute and drive-qualified paths', () => {
    expect(normalizeRequested('/etc/passwd').ok).toBe(false);
    expect(normalizeRequested('C:/Windows/win.ini').ok).toBe(false);
  });
});
