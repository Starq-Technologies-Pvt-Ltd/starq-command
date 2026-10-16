import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceSurface } from '@/surfaces/evidence';
import type { CommandSurface, ProvenanceSource, SurfaceState } from '@/lib/contracts';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

function surface(state: SurfaceState, sources: ProvenanceSource[]): CommandSurface {
  return {
    provenance: { state, sources, checked: sources.length, missing: [], drifted: [] },
    execution_truth: { state: 'STALE', available: true },
  } as unknown as CommandSurface;
}

const drift: ProvenanceSource = { name: 'Changed decision source', path: 'decisions.json', state: 'DRIFT', recorded: 'aaaa', live: 'bbbb' };
const missing: ProvenanceSource = { name: 'Absent roadmap', path: 'roadmap.md', state: 'UNAVAILABLE', recorded: 'cccc', live: null, reason: 'canonical source not found on disk' };

describe('Evidence distinguishes source access from hash agreement', () => {
  it('a changed live hash proves the source was read even when it disagrees', () => {
    dom = new JSDOM(renderToStaticMarkup(<EvidenceSurface surface={surface('DRIFT', [drift])} />));
    const fields = [...dom.window.document.querySelectorAll('dt')];
    expect(fields.find((f) => f.textContent === 'Read at this projection')?.nextElementSibling?.textContent).toBe('yes');
    expect(dom.window.document.body.textContent).toContain('DRIFT');
    expect(dom.window.document.body.textContent).toContain('aaaa');
    expect(dom.window.document.body.textContent).toContain('bbbb');
    expect(dom.window.document.body.textContent).toContain('Source content has not been read.');
    expect(dom.window.document.body.textContent).not.toContain('The source read as empty.');
  });

  it('renders the individual source records when the aggregate is UNAVAILABLE', () => {
    dom = new JSDOM(renderToStaticMarkup(<EvidenceSurface surface={surface('UNAVAILABLE', [missing, drift])} />));
    const doc = dom.window.document;
    expect(doc.querySelector('[data-work-row="roadmap.md"]')?.getAttribute('data-tone')).toBe('unknown');
    expect(doc.querySelector('[data-work-row="decisions.json"]')?.getAttribute('data-tone')).toBe('drift');
    expect(doc.body.textContent).toContain('Absent roadmap');
    expect(doc.body.textContent).toContain('Changed decision source');
    expect(doc.body.textContent).toContain('canonical source not found on disk');
  });

  it('keeps the source-gap view when no source records were supplied', () => {
    const markup = renderToStaticMarkup(<EvidenceSurface surface={surface('UNAVAILABLE', [])} />);
    expect(markup).toContain('Source accessibility cannot be established');
    expect(markup).not.toContain('role="listbox"');
  });

  it('does not retry a declared absent source and still inspects a subsequently available source', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => 'current canonical bytes' }));
    vi.stubGlobal('fetch', fetchMock);
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<EvidenceSurface surface={surface('UNAVAILABLE', [missing])} />); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain(missing.reason);
    expect(host.textContent).not.toContain('read guard refused');
    const available = { ...missing, state: 'OK' as const, live: 'cccc', reason: undefined };
    await act(async () => { root?.render(<EvidenceSurface surface={surface('OK', [available])} />); });
    expect(fetchMock).toHaveBeenCalledWith('/api/raw?path=roadmap.md', { cache: 'no-store' });
    expect(host.textContent).toContain('current canonical bytes');
  });

  it('declares the existing preview limit instead of silently hiding source content', async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'a'.repeat(200000) + 'OMITTED_SOURCE_TAIL' })));
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => { root?.render(<EvidenceSurface surface={surface('DRIFT', [drift])} />); });
    expect(host.textContent).toContain('This bounded preview is truncated');
    expect(host.textContent).toContain('200,000');
    expect(host.textContent).not.toContain('OMITTED_SOURCE_TAIL');
  });
});
