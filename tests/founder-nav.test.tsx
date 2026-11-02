import { describe, expect, it } from 'vitest';
import { NAV } from '@/components/shell';
import { parseBuildingRoute, routeHash } from '@/lib/building-route';

const PRIMARY_VIEWS = ['home', 'organization', 'workforce', 'projects', 'activity', 'records'] as const;

describe('CV-CU5 founder navigation', () => {
  it('parses an empty hash as home', () => {
    expect(parseBuildingRoute('#').view).toBe('home');
    expect(parseBuildingRoute('').view).toBe('home');
    expect(parseBuildingRoute('#not-a-real-view').view).toBe('home');
  });

  it('parses organization and round-trips the primary views', () => {
    expect(parseBuildingRoute('#organization').view).toBe('organization');
    for (const view of PRIMARY_VIEWS) {
      const route = parseBuildingRoute(`#${view}`);
      expect(route.view).toBe(view);
      expect(routeHash(route)).toBe(`#${view}`);
      expect(parseBuildingRoute(routeHash(route)).view).toBe(view);
    }
  });

  it('keeps studio, erp, and hoadha parsing', () => {
    expect(parseBuildingRoute('#studio/erp/tasks')).toEqual({
      view: 'studio',
      room: 'erp',
      tab: 'Tasks',
    });
    expect(parseBuildingRoute('#studio/hoadha/board')).toEqual({
      view: 'studio',
      room: 'hoadha',
      tab: 'Board',
    });
    expect(parseBuildingRoute('#overview').view).toBe('overview');
  });

  it('lists Home first and keeps System', () => {
    expect(NAV.map((item) => item.label)).toEqual([
      'Home',
      'Organization',
      'Workforce',
      'Projects',
      'Activity',
      'Records',
      'Overview',
      'Company',
      'Building',
      'Library',
      'Cortex',
      'Comms',
      'Dev Studio',
      'Founder Attention',
      'Evidence',
      'System',
    ]);
    expect(NAV.slice(0, 6).every((item) => item.live)).toBe(true);
    expect(NAV.map((item) => item.label)).toContain('Home');
    expect(NAV.map((item) => item.label)).toContain('System');
  });
});
