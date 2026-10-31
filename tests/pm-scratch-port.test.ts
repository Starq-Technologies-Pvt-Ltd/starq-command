// @vitest-environment jsdom
/**
 * A disposable PM session must not fall back to the live PM after navigating.
 *
 * Observed in a real browser: opening `#building/projects?pm_port=5191` and
 * clicking "Dev Studio" rewrote the hash to `#studio/overview`, dropping the
 * query, and PM requests went to :5176 from then on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pmIsScratch, pmPort } from '@/lib/pm-client';
import { routeHash } from '@/lib/building-route';

afterEach(() => {
  window.sessionStorage.clear();
  window.location.hash = '';
});

describe('PM scratch port survives navigation', () => {
  it('defaults to the live PM when no scratch port was ever given', () => {
    expect(pmPort()).toBe(5176);
    expect(pmIsScratch()).toBe(false);
  });

  it('reads a scratch port from the hash', () => {
    window.location.hash = '#building/projects?pm_port=5191';
    expect(pmPort()).toBe(5191);
    expect(pmIsScratch()).toBe(true);
  });

  it('stays on the scratch port after the router rebuilds the hash without its query', () => {
    window.location.hash = '#building/projects?pm_port=5191';
    expect(pmPort()).toBe(5191);
    // Exactly what a nav click does.
    window.location.hash = routeHash({ view: 'studio', room: null, tab: 'OVERVIEW' } as never);
    expect(window.location.hash).toBe('#studio/overview');
    expect(pmPort()).toBe(5191);
  });

  it('the app entry captures the scratch port before the router can drop it', async () => {
    const { readFileSync } = await import('node:fs');
    const entry = readFileSync('src/main.tsx', 'utf8');
    const capture = entry.indexOf('pmPort();');
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(entry.indexOf('createRoot('));
  });

  it('a fresh tab (empty session storage) is live again', () => {
    window.location.hash = '#building/projects?pm_port=5191';
    pmPort();
    window.sessionStorage.clear();
    window.location.hash = '#studio/overview';
    expect(pmPort()).toBe(5176);
  });

  it('never accepts a port outside the scratch range, from the hash or from storage', () => {
    window.location.hash = '#studio/overview?pm_port=5176';
    expect(pmPort()).toBe(5176);
    window.sessionStorage.setItem('starq.command.pm_port', '8080');
    window.location.hash = '#studio/overview';
    expect(pmPort()).toBe(5176);
  });
});
