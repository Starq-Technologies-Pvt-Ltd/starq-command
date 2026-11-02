import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const FACTORY = readFileSync(path.join(PKG, 'src/surfaces/factory.tsx'), 'utf8');
const CLIENT = readFileSync(path.join(PKG, 'src/lib/command-client.ts'), 'utf8');

describe('M4 workforce UI truthfulness', () => {
  it('renders distinct task/owner/verifier column', () => {
    expect(FACTORY).toContain('Task / Owner / Verifier');
    expect(FACTORY).toContain("task.owner || 'UNKNOWN'");
    expect(FACTORY).toContain("task.verifier || 'UNKNOWN'");
    expect(FACTORY).toContain('PM declared labels');
  });

  it('renders runtime session distinct from workforce function', () => {
    expect(FACTORY).toContain('Runtime Session');
    expect(FACTORY).toContain("seat.runtime?.session_id || 'UNKNOWN'");
    expect(FACTORY).toContain('Role / Function');
  });

  it('renders per-seat source/time or UNKNOWN (no misattribution)', () => {
    expect(FACTORY).toContain('Runtime source / observation time');
    expect(FACTORY).toContain("seat.runtime?.observed ? 'Herdr' : 'UNKNOWN'");
    expect(FACTORY).toContain("seat.runtime?.observed_at || 'UNKNOWN'");
  });

  it('WorkforceSeat keeps concepts separate and nullable', () => {
    expect(CLIENT).toContain('task_id?: string | null');
    expect(CLIENT).toContain('owner?: string | null');
    expect(CLIENT).toContain('verifier?: string | null');
    expect(CLIENT).toContain('runtime_session?: string | null');
  });

  it('uses pmTask to resolve exact PM links only after observed task project_id', () => {
    expect(FACTORY).toContain('pmTask(id)');
    expect(FACTORY).toContain('pmTaskHref(task.projectId, tid)');
    expect(FACTORY).toContain("(unavailable)");
  });
});
