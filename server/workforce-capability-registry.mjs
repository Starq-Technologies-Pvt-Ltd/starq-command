import fs from 'node:fs';
import path from 'node:path';

/** Load only explicit, evidence-backed capability declarations. */
export function readWorkforceCapabilityRegistry(filePath = path.resolve('data', 'workforce-capabilities.json')) {
  try {
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (document?.schemaVersion !== 1 || !document.workers || typeof document.workers !== 'object') {
      return { state: 'INVALID', workers: {}, reason: 'Capability registry schema is invalid.' };
    }
    const workers = {};
    for (const [handle, entry] of Object.entries(document.workers)) {
      if (!entry || entry.status !== 'VERIFIED' || !Array.isArray(entry.capabilities)
        || !entry.capabilities.every((value) => typeof value === 'string' && value.trim())
        || !Array.isArray(entry.evidence) || !entry.evidence.length
        || !entry.evidence.every((value) => typeof value === 'string' && value.trim())) continue;
      workers[handle] = {
        status: 'VERIFIED',
        capabilities: [...new Set(entry.capabilities.map((value) => value.trim()))],
        evidence: entry.evidence.map((value) => value.trim()),
        verifiedAt: entry.verifiedAt ?? null,
      };
    }
    return { state: 'OK', workers, reason: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'MISSING', workers: {}, reason: 'No verified workforce capability registry is configured.' };
    return { state: 'INVALID', workers: {}, reason: `Capability registry unreadable: ${error.message}` };
  }
}
