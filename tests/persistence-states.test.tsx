// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PmEmpty, PmLoading, PmRejected, PmSaved, PmUnavailable } from '@/components/pm-feedback';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode): HTMLElement {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root');
  if (!host) throw new Error('test root missing');
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

describe('CV-CU5 persistence states', () => {
  it('renders data-pm-state for loading, empty, unavailable, rejected, and saved', () => {
    const host = render(
      <>
        <PmLoading />
        <PmEmpty label="Nothing recorded." />
        <PmUnavailable reason="Origin down." />
        <PmRejected code="STALE_EDIT" message="Reload and reapply." />
        <PmSaved />
      </>,
    );
    const states = [...host.querySelectorAll('[data-pm-state]')].map((el) => el.getAttribute('data-pm-state'));
    expect(states).toEqual(['loading', 'empty', 'unavailable', 'error', 'saved']);
  });
});
