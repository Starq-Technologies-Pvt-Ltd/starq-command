/** Resolve separately owned Starq components without assuming checkout depth. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveWorkspace } from './paths.mjs';

const COMPONENTS = Object.freeze({
  'agent-comms': { env: 'STARQ_AGENT_COMMS_ROOT', relative: 'agent-comms' },
  'starq-lifecycle': { env: 'STARQ_LIFECYCLE_ROOT', relative: path.join('00_STARQ_HQ', 'operations', 'starq-lifecycle') },
  'herdr-floor': { env: 'STARQ_HERDR_FLOOR_ROOT', relative: path.join('00_STARQ_HQ', 'operations', 'herdr-floor') },
});

export function resolveExternalComponent(name, {
  env = process.env,
  workspaceRoot = resolveWorkspace().root,
} = {}) {
  const definition = COMPONENTS[name];
  if (!definition) throw new Error(`Unknown external Starq component: ${name}`);
  const override = String(env[definition.env] ?? '').trim();
  if (override) {
    const root = path.resolve(override);
    return fs.existsSync(root) && fs.statSync(root).isDirectory()
      ? { name, state: 'AVAILABLE', root, configuredBy: definition.env }
      : { name, state: 'UNAVAILABLE', root: null, configuredBy: definition.env, reason: `${definition.env} does not name an existing directory: ${root}` };
  }
  if (!workspaceRoot) {
    return { name, state: 'UNAVAILABLE', root: null, configuredBy: null, reason: `${definition.env} is unset and the Starq workspace root is unresolved` };
  }
  const root = path.resolve(workspaceRoot, definition.relative);
  return fs.existsSync(root) && fs.statSync(root).isDirectory()
    ? { name, state: 'AVAILABLE', root, configuredBy: 'workspace-default' }
    : { name, state: 'UNAVAILABLE', root: null, configuredBy: 'workspace-default', reason: `${name} is not present at the configured workspace location: ${root}` };
}

export async function importExternalComponent(name, relativeModule, options = {}) {
  const component = resolveExternalComponent(name, options);
  if (component.state !== 'AVAILABLE') return { ...component, module: null };
  const modulePath = path.resolve(component.root, relativeModule);
  const relative = path.relative(component.root, modulePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { name, state: 'UNAVAILABLE', root: component.root, module: null, reason: `Refused module outside ${name}: ${relativeModule}` };
  }
  if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    return { name, state: 'UNAVAILABLE', root: component.root, module: null, reason: `${name} module is unavailable: ${modulePath}` };
  }
  try {
    const loaded = await import(pathToFileURL(modulePath).href);
    return { ...component, state: 'AVAILABLE', module: loaded };
  } catch (error) {
    return { name, state: 'UNAVAILABLE', root: component.root, module: null, reason: `${name} module failed to load: ${error instanceof Error ? error.message : String(error)}` };
  }
}
