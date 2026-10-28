/** Resolve lifecycle test companions through the same roots as production. */
import path from 'node:path';
import { importExternalComponent, resolveExternalComponent } from '../../server/external-components.mjs';

export async function importTestComponent(name, relativeModule) {
  const result = await importExternalComponent(name, relativeModule);
  if (result.state !== 'AVAILABLE') {
    throw new Error(`Lifecycle test prerequisite unavailable: ${name}/${relativeModule}: ${result.reason}`);
  }
  return result.module;
}

export function resolveTestComponentPath(name, relativePath) {
  const result = resolveExternalComponent(name);
  if (result.state !== 'AVAILABLE') {
    throw new Error(`Lifecycle test prerequisite unavailable: ${name}: ${result.reason}`);
  }
  const target = path.resolve(result.root, relativePath);
  const rel = path.relative(result.root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Refused lifecycle test path outside ${name}: ${relativePath}`);
  }
  return target;
}
