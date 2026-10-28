import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readNexusLibraryDocument, searchNexusLibrary } from '../server/nexus-library.mjs';

test('search exposes copied Library documents with domain and bounded pagination', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'command-nexus-library-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '07_ORGANIZATIONS'), { recursive: true });
  mkdirSync(path.join(root, '14_DECISIONS'), { recursive: true });
  writeFileSync(path.join(root, '07_ORGANIZATIONS', 'contract.md'), '# Canonical Contract\n\nRetention evidence remains linked to the company record.');
  writeFileSync(path.join(root, '14_DECISIONS', 'decision.md'), '# Decision\n\nApproved for archival.');

  const result = searchNexusLibrary({ query: 'retention evidence', limit: 1 }, root);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.read_only, true);
  assert.equal(result.total, 1);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].path, '07_ORGANIZATIONS/contract.md');
  assert.equal(result.documents[0].title, 'Canonical Contract');
  assert.deepEqual(result.domains, ['07_ORGANIZATIONS', '14_DECISIONS']);
});

test('document reader returns source-relative provenance and refuses traversal', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'command-nexus-library-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '02_WORK'), { recursive: true });
  const content = '# Operating Notes\n\nKeep provenance attached to every recovered document.\n';
  writeFileSync(path.join(root, '02_WORK', 'notes.md'), content);

  const result = readNexusLibraryDocument('02_WORK/notes.md', root);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.path, '02_WORK/notes.md');
  assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(result.content, content);
  assert.throws(() => readNexusLibraryDocument('../outside.txt', root), /traversal/);
});

