import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveReadOnlyTarget } from './path-guard.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NEXUS_LIBRARY_ROOT = path.resolve(
  process.env.STARQ_COMMAND_NEXUS_LIBRARY_ROOT || path.join(APP_ROOT, 'recovered', 'nexus', 'library'),
);

const TEXT_SUFFIXES = ['.md', '.txt', '.json', '.csv', '.html', '.htm', '.xml'];
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
let indexCache = null;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isTextFile(name) {
  const lower = name.toLowerCase();
  return TEXT_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || lower.endsWith('.md\uf00a');
}

function walk(root) {
  const files = [];
  const rootReal = fs.realpathSync(root);
  const stack = [rootReal];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        files.push({
          path: path.relative(rootReal, absolute).split(path.sep).join('/'),
          absolute,
          bytes: stat.size,
          modified_at: stat.mtime.toISOString(),
        });
      }
    }
  }
  return { rootReal, files };
}

function titleFrom(content, relativePath) {
  const heading = content.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1];
  return (heading || path.basename(relativePath).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')).trim();
}

function snippetFor(content, terms) {
  const flat = content.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_>#\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = flat.toLocaleLowerCase();
  const index = terms.length ? Math.max(0, lower.indexOf(terms[0])) : 0;
  const start = Math.max(0, index - 90);
  return `${start ? '…' : ''}${flat.slice(start, start + 260)}${start + 260 < flat.length ? '…' : ''}`;
}

function loadIndex(root = NEXUS_LIBRARY_ROOT, { refresh = false } = {}) {
  if (!refresh && indexCache?.root === path.resolve(root)) return indexCache;
  if (!fs.existsSync(root)) throw Object.assign(new Error(`Recovered Nexus Library unavailable: ${root}`), { code: 'ENOENT' });
  const { rootReal, files } = walk(root);
  const entries = files.map((file) => {
    const parts = file.path.split('/');
    let content = '';
    if (isTextFile(file.path) && file.bytes <= MAX_DOCUMENT_BYTES) {
      try { content = fs.readFileSync(file.absolute, 'utf8'); } catch { content = ''; }
    }
    return {
      path: file.path,
      domain: parts.length > 1 ? parts[0] : 'Unsorted',
      title: content ? titleFrom(content, file.path) : titleFrom('', file.path),
      bytes: file.bytes,
      modified_at: file.modified_at,
      content,
    };
  });
  indexCache = { root: path.resolve(root), rootReal, entries };
  return indexCache;
}

export function searchNexusLibrary({ query = '', domain = '', limit = 40, offset = 0 } = {}, root = NEXUS_LIBRARY_ROOT) {
  const cleanQuery = String(query).trim().slice(0, 240).toLocaleLowerCase();
  const terms = cleanQuery.split(/\s+/).filter(Boolean);
  const cleanDomain = String(domain).trim().slice(0, 180);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const safeOffset = Math.max(0, Math.min(100000, Number(offset) || 0));
  const { entries } = loadIndex(root);
  const matches = entries.filter((entry) => {
    if (cleanDomain && entry.domain !== cleanDomain) return false;
    if (!terms.length) return true;
    const haystack = `${entry.path}\n${entry.title}\n${entry.content}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  matches.sort((a, b) => {
    if (terms.length) {
      const score = (entry) => terms.reduce((n, term) => n + (entry.path.toLocaleLowerCase().includes(term) ? 4 : 0) + (entry.title.toLocaleLowerCase().includes(term) ? 2 : 0) + (entry.content.toLocaleLowerCase().includes(term) ? 1 : 0), 0);
      const delta = score(b) - score(a);
      if (delta) return delta;
    }
    return a.path.localeCompare(b.path);
  });
  const page = matches.slice(safeOffset, safeOffset + safeLimit);
  return {
    state: 'AVAILABLE',
    authority: 'RECOVERED_SOURCE_COPY',
    read_only: true,
    query: String(query).trim().slice(0, 240),
    domain: cleanDomain || null,
    total: matches.length,
    offset: safeOffset,
    limit: safeLimit,
    domains: [...new Set(entries.map((entry) => entry.domain))].sort((a, b) => a.localeCompare(b)),
    documents: page.map(({ path: sourcePath, domain: sourceDomain, title, bytes, modified_at, content }) => ({
      path: sourcePath,
      domain: sourceDomain,
      title,
      bytes,
      modified_at,
      snippet: content ? snippetFor(content, terms) : '',
    })),
  };
}

export function readNexusLibraryDocument(relativePath, root = NEXUS_LIBRARY_ROOT) {
  const rel = String(relativePath ?? '').replace(/\\/g, '/');
  const rootParent = path.dirname(path.resolve(root));
  const rootName = path.basename(path.resolve(root));
  const guarded = resolveReadOnlyTarget({
    workspaceRoot: rootParent,
    requested: `${rootName}/${rel}`,
    allowed: [rootName],
  });
  if (!guarded.ok) throw Object.assign(new Error(guarded.error), { status: guarded.status });
  const stat = fs.statSync(guarded.real);
  if (!stat.isFile()) throw Object.assign(new Error('Library target is not a file'), { status: 404 });
  if (stat.size > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('Library document exceeds the read boundary'), { status: 413 });
  const content = fs.readFileSync(guarded.real, 'utf8');
  const canonicalPath = path.relative(fs.realpathSync(root), guarded.real).split(path.sep).join('/');
  return {
    state: 'AVAILABLE',
    authority: 'RECOVERED_SOURCE_COPY',
    read_only: true,
    path: canonicalPath,
    title: titleFrom(content, canonicalPath),
    bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    sha256: sha256(content),
    content,
  };
}

