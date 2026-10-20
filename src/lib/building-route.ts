export const COMPANY_VIEWS = [
  'overview',
  'company',
  'building',
  'studio',
  'attention',
  'evidence',
  'system',
  // CMD-DI-3-2b. Distinct from Evidence peers and from the six Studio tabs.
  'work',
] as const;
export const ATTENTION_TABS = ['Decisions', 'Exceptions', 'Conflicts', 'Holds', 'History'];
export const EVIDENCE_TABS = ['Sources', 'Projection', 'Decisions', 'Rooms', 'Hashes'];
export const SYSTEM_TABS = ['Health', 'Runtime', 'Sources', 'Contracts', 'Projection'];
/**
 * The Company OS tabs — the whole skyscraper, from one nav item.
 *
 * Structure is the tree (company -> floors -> rooms). Seats is every seat with
 * its occupant and delegation. Portfolio is the room inventory with dormant
 * rooms truthful. Founder is the acting-capacity surface. Infrastructure is the
 * systems that are NOT staff.
 *
 * One nav item, not five. Splitting these across the top rail would be the
 * "second dashboard" the wave forbids.
 */
export const COMPANY_OS_TABS = [
  'Structure',
  'Seats',
  'Portfolio',
  'Founder',
  'Infrastructure',
];
export const STUDIO_TABS = ['Overview', 'Staff', 'Projects', 'Capacity', 'Activity', 'Herdr'];
export const ERP_TABS = [
  'Overview',
  'Process',
  'Tasks',
  'Decisions',
  'Evidence',
  'Staff',
  'Integrity',
];
export const HOADHA_TABS = [
  'Overview',
  'Loops',
  'Board',
  'Waves',
  'Stages',
  'Evidence',
  'Staff',
  'Integrity',
];
export interface BuildingRoute {
  view: string;
  room: 'erp' | 'hoadha' | null;
  tab: string;
  /** Set only for a project id that is not an ERP/Hoadha room and not a Studio tab. */
  projectId?: string;
}

const STUDIO_TAB_IDS = new Set(STUDIO_TABS.map((tab) => tab.toLowerCase()));

/**
 * Project id from a project_id query, else the studio hash.
 * A reserved Studio tab token in the query is rejected and does not erase a
 * valid hash project id. Studio tab tokens are rejected at every path depth,
 * so `#studio/projects/board` is the Projects tab, not project_id "projects".
 */
export function projectIdFromRoute(route: string): string | null {
  const [path, query = ''] = route.replace(/^#\/?/, '').split('?');
  const fromQuery = new URLSearchParams(query).get('project_id')?.trim() ?? '';
  if (fromQuery && !STUDIO_TAB_IDS.has(fromQuery.toLowerCase())) return fromQuery;
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments[0] !== 'studio') return null;
  const candidate = segments[1];
  if (!candidate || STUDIO_TAB_IDS.has(candidate.toLowerCase())) return null;
  return candidate;
}

function specialRoom(projectId: string | null): 'erp' | 'hoadha' | null {
  if (!projectId) return null;
  const key = projectId.toLowerCase();
  if (key === 'erp' || key === 'starqerp' || key === 'starq_erp' || key === 'starq-erp') return 'erp';
  if (key === 'hoadha') return 'hoadha';
  return null;
}

export function parseBuildingRoute(hash: string): BuildingRoute {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [view, room, tab] = path.split('/');
  const legacy: Record<string, BuildingRoute> = {
    floor: { view: 'studio', room: null, tab: 'Staff' },
    process: { view: 'studio', room: 'erp', tab: 'Process' },
    truth: { view: 'studio', room: 'erp', tab: 'Integrity' },
  };
  if (legacy[view]) return legacy[view];
  if (view === 'studio') {
    const selectedId = projectIdFromRoute(hash);
    const special = specialRoom(selectedId);
    if (selectedId && !special) {
      return { view, room: null, tab: 'Overview', projectId: selectedId };
    }
    const project = special ?? (room === 'erp' || room === 'hoadha' ? room : null);
    const tabs = project === 'erp' ? ERP_TABS : project === 'hoadha' ? HOADHA_TABS : STUDIO_TABS;
    const selected = project ? tab : room;
    return {
      view,
      room: project,
      tab: tabs.find((t) => t.toLowerCase() === selected?.toLowerCase()) ?? 'Overview',
    };
  }
  const companyView = COMPANY_VIEWS.includes(view as (typeof COMPANY_VIEWS)[number]) ? view : 'overview';
  const peers =
    companyView === 'attention'
      ? ATTENTION_TABS
      : companyView === 'evidence'
        ? EVIDENCE_TABS
        : companyView === 'system'
          ? SYSTEM_TABS
          : companyView === 'company'
            ? COMPANY_OS_TABS
            : [];
  return {
    view: companyView,
    room: null,
    tab: room
      ? peers.find((peer) => peer.toLowerCase() === room.toLowerCase()) ?? peers[0] ?? 'Overview'
      : 'Overview',
  };
}
export function routeHash(route: BuildingRoute) {
  if (route.view === 'studio') {
    return `#studio/${route.room ? `${route.room}/` : ''}${route.tab.toLowerCase()}`;
  }
  const isPeerView =
    route.view === 'attention' ||
    route.view === 'evidence' ||
    route.view === 'system' ||
    route.view === 'company';
  return isPeerView && route.tab ? `#${route.view}/${route.tab.toLowerCase()}` : `#${route.view}`;
}
