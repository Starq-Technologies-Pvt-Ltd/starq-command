import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { readGates, readObservationGates, readStandaloneHerdrGate } from './gates.mjs';
import { compatibilityGate } from '../../../herdr-floor/src/containment-config.mjs';
// Gates that need no runtime inventory are evaluated alone, so a single query
// does not trigger the full Rule0 filesystem scan.
const OBSERVATION_KINDS = new Set(['G-RULE0-OBS', 'G-PROFILE-OBS', 'G-OWNERSHIP-OBS']);
const FULL_KINDS = new Set(['G-WSL', 'G-RULE0']);

export function readNamedGate(workspace, kind, {
  readFull = readGates,
  readObservation = readObservationGates,
  readProfile = readStandaloneHerdrGate,
  readContainment = compatibilityGate,
  loadObservation = (root) => loadConfig(path.join(root, '00_STARQ_HQ/operations/starq-command/lifecycle.observation.config.json')),
} = {}) {
  if (kind === 'G-PROFILE') return { kind, ...readProfile(workspace) };
  if (kind === 'G-CONTAINMENT') return { kind, ...readContainment(workspace) };
  if (OBSERVATION_KINDS.has(kind)) {
    try {
      const result = readObservation(workspace, loadObservation(workspace)).find((gate) => gate.kind === kind);
      return result ?? { kind, resolved: false, detail: `${kind}: observation gate missing from evaluator` };
    } catch (err) {
      return { kind, resolved: false, detail: `${kind}: observation gate evaluation UNKNOWN (${err.message})` };
    }
  }
  if (FULL_KINDS.has(kind)) {
    const result = readFull(workspace).find((gate) => gate.kind === kind);
    return result ?? { kind, resolved: false, detail: `${kind}: full-profile gate missing from evaluator` };
  }
  return { kind: kind ?? null, resolved: false, detail: `unknown gate ${kind ?? '<missing>'}` };
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (invokedDirectly) {
  const [workspace, kind] = process.argv.slice(2);
  const result = readNamedGate(workspace, kind);
  console.log(JSON.stringify(result));
  if (result.resolved !== true && /^unknown gate /.test(result.detail)) process.exitCode = 2;
}
