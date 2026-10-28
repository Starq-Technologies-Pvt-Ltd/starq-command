import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { importExternalComponent, resolveExternalComponent } from '../server/external-components.mjs';

describe('external Starq component resolution', () => {
  it('resolves component roots from explicit non-machine-specific overrides', () => {
    const result = resolveExternalComponent('agent-comms', {
      env: { STARQ_AGENT_COMMS_ROOT: 'C:/starq/components/agent-comms' },
      workspaceRoot: null,
    });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.configuredBy).toBe('STARQ_AGENT_COMMS_ROOT');
    expect(result.reason).toContain(path.resolve('C:/starq/components/agent-comms'));
  });

  it('uses the verified workspace layout when no explicit component root is set', () => {
    const result = resolveExternalComponent('herdr-floor', {
      env: {},
      workspaceRoot: 'C:/starq-workspace',
    });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.configuredBy).toBe('workspace-default');
    expect(result.reason).toContain(path.resolve('C:/starq-workspace/00_STARQ_HQ/operations/herdr-floor'));
  });

  it('returns a controlled unavailable state instead of throwing for an absent companion', async () => {
    const result = await importExternalComponent('starq-lifecycle', 'runtime-policy.mjs', {
      env: {},
      workspaceRoot: null,
    });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.module).toBeNull();
    expect(result.reason).toMatch(/STARQ_LIFECYCLE_ROOT is unset/);
  });

  it('does not allow an imported module path to escape its component root', async () => {
    const result = await importExternalComponent('agent-comms', '../outside.mjs', {
      env: { STARQ_AGENT_COMMS_ROOT: process.cwd() },
      workspaceRoot: null,
    });
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.reason).toMatch(/Refused module outside agent-comms/);
  });

  it('lets lifecycle gates report absent companions as unresolved instead of failing module load', () => {
    const gatesUrl = new URL('../scripts/lifecycle/gates.mjs', import.meta.url).href;
    const ownerUrl = new URL('../scripts/lifecycle/owner.mjs', import.meta.url).href;
    const gateStatusUrl = new URL('../scripts/lifecycle/gate-status.mjs', import.meta.url).href;
    const source = `import { evaluateRule0Gate, readObservationGates } from ${JSON.stringify(gatesUrl)};\n`
      + `import { createOwner } from ${JSON.stringify(ownerUrl)};\n`
      + `import { readNamedGate } from ${JSON.stringify(gateStatusUrl)};\n`
      + `const rule=evaluateRule0Gate('C:/workspace');\n`
      + `const gates=readObservationGates('C:/workspace', {});\n`
      + `const direct=readNamedGate('C:/workspace','G-CONTAINMENT');\n`
      + `console.log(JSON.stringify({rule,gates,direct,ownerLoaded:typeof createOwner==='function'}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: {
        ...process.env,
        STARQ_LIFECYCLE_ROOT: path.join('C:', 'missing-starq-lifecycle'),
        STARQ_HERDR_FLOOR_ROOT: path.join('C:', 'missing-herdr-floor'),
      },
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.rule.resolved).toBe(false);
    expect(output.rule.detail).toContain('starq-lifecycle');
    expect(output.ownerLoaded).toBe(true);
    expect(output.gates.find((gate: { kind: string }) => gate.kind === 'G-CONTAINMENT')?.resolved).toBe(false);
    expect(output.gates.find((gate: { kind: string }) => gate.kind === 'G-CONTAINMENT')?.detail).toContain('herdr-floor');
    expect(output.direct.resolved).toBe(false);
    expect(output.direct.detail).toContain('herdr-floor');
  });
});
