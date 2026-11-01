// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FounderHome } from '@/surfaces/founder-home';

let dom: JSDOM | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  dom?.window.close();
  dom = null;
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 404) {
  return { ok, status, json: async () => body };
}

function setNativeInput(input: HTMLInputElement, value: string) {
  const view = input.ownerDocument.defaultView!;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  input.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true }));
  setter?.call(input, value);
  input.dispatchEvent(new view.KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

describe('CV-CU8 first run', () => {
  it('registers a person before offering the first project and reads each step back', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    let org = { companies: [] as Array<Record<string, unknown>>, company: null, units: [] as Array<Record<string, unknown>>, positions: [], people: [] as Array<Record<string, unknown>>, appointments: [], generated_at: '2026-11-01T00:00:00.000Z' };
    let projects: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push({ url: path, body });
        if (path === '/api/pm/org/companies') {
          const company = { id: 'co-northwind', name: body.name, legal_name: null, notes: null };
          org = { ...org, companies: [company], company };
          return jsonResponse(company, true, 201);
        }
        if (path === '/api/pm/org/people') {
          const person = { id: 'person-founder', handle: body.handle, display_name: body.display_name, kind: 'HUMAN' };
          org = { ...org, people: [person] };
          return jsonResponse(person, true, 201);
        }
        if (path === '/api/pm/projects') {
          const project = { id: body.id, name: body.name, prefix: body.prefix, description: body.description ?? '', source_gap: null, hold: { state: 'CLEAR' } };
          projects = [project];
          return jsonResponse(project, true, 201);
        }
      }
      if (path === '/api/pm/org') return jsonResponse(org);
      if (path === '/api/pm/projects') return jsonResponse({ projects });
      if (path === '/api/pm/import/organization') return jsonResponse({ message: 'missing' }, false, 404);
      if (path === '/api/pm/attention') return jsonResponse({ next_actions: [], blocked: 0, founder_gate: 0, unassigned: 0, in_progress: 0, generated_at: org.generated_at, room_post: 'OFF' });
      if (path === '/api/pm/digests/latest') return jsonResponse({ digest: null });
      if (path === '/api/pm/milestones') return jsonResponse({ milestones: [] });
      return jsonResponse({ message: 'missing' }, false, 404);
    }));

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5173/' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    vi.stubGlobal('sessionStorage', dom.window.sessionStorage);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const elementProto = dom.window.HTMLElement.prototype as HTMLElement & { attachEvent?: () => void; detachEvent?: () => void };
    elementProto.attachEvent = () => {};
    elementProto.detachEvent = () => {};
    const host = dom.window.document.getElementById('root')!;
    root = createRoot(host);
    await act(async () => {
      root?.render(<FounderHome />);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(host.querySelector('[data-first-run]')).not.toBeNull();
    expect(host.textContent).toContain('No organization import is available');
    expect(host.querySelector('form[aria-label="Create first project"]')).toBeNull();

    setNativeInput(host.querySelector('[aria-label="Your handle"]') as HTMLInputElement, 'founder');
    setNativeInput(host.querySelector('[aria-label="Organization name"]') as HTMLInputElement, 'Northwind');
    await act(async () => {
      (host.querySelector('form[aria-label="Create organization"] button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(posts.some((post) => post.url === '/api/pm/org/companies' && post.body.actor === 'founder')).toBe(true);
    expect(host.querySelector('form[aria-label="Register first person"]')).not.toBeNull();
    expect(host.querySelector('form[aria-label="Create first project"]')).toBeNull();

    setNativeInput(host.querySelector('[aria-label="First person display name"]') as HTMLInputElement, 'Founder');
    await act(async () => {
      (host.querySelector('form[aria-label="Register first person"] button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector('form[aria-label="Create department"]')).not.toBeNull();
    await act(async () => {
      (host.querySelector('form[aria-label="Create department"] button[type="button"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('form[aria-label="Create first project"]')).not.toBeNull();

    setNativeInput(host.querySelector('[aria-label="Project id"]') as HTMLInputElement, '1bad');
    setNativeInput(host.querySelector('[aria-label="Project name"]') as HTMLInputElement, 'Northwind Rollout');
    setNativeInput(host.querySelector('[aria-label="Project prefix"]') as HTMLInputElement, 'NW');
    await act(async () => {
      (host.querySelector('form[aria-label="Create first project"] button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(posts.some((post) => post.url === '/api/pm/projects')).toBe(false);
    expect(host.textContent).toContain('Project id must be');

    setNativeInput(host.querySelector('[aria-label="Project id"]') as HTMLInputElement, 'northwind');
    await act(async () => {
      (host.querySelector('form[aria-label="Create first project"] button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const projectPost = posts.find((post) => post.url === '/api/pm/projects');
    expect(projectPost?.body).toMatchObject({ actor: 'founder', id: 'northwind', prefix: 'NW' });
  });
});
