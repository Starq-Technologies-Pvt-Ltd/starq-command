import * as React from 'react';
import {
  Activity,
  AlertOctagon,
  Boxes,
  Building2,
  FileSearch,
  Fingerprint,
  Gauge,
  Library,
  LayoutDashboard,
  Network,
  Settings2,
  Users,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from './ui/separator';
import { SurfaceBadge } from './state-gate';
import { SlimStatus, KV } from './console';
import type { Health } from '@/lib/contracts';

export type ViewId =
  | 'building'
  | 'company'
  | 'library'
  | 'cortex'
  | 'comms'
  | 'studio'
  | 'overview'
  | 'attention'
  | 'evidence'
  | 'system';

export interface NavItem {
  id: ViewId;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shells for later phases are present but explicitly marked not-yet-live. */
  live: boolean;
}

/**
 * Navigation architecture.
 *
 * Every entry is authorised and live. There is deliberately NO phase field.
 * It previously read 7,7,7,5,1,7 and was rendered as a `P{n}` badge behind
 * `!item.live` — but all six entries are live, so that badge could never
 * render and the number varied on nothing an operator could see or act on
 * (Goose R7). A field that is displayed nowhere and drives no behaviour is
 * not bookkeeping, it is a lie waiting for someone to believe it. The history
 * of which phase authorised a surface lives in the implementation record and
 * the Room, not in the navigation.
 *
 * ORDER IS OPERATOR ORDER, deliberately: Overview, Building, Dev Studio, then
 * the cross-room surfaces Founder Attention, Evidence and System. It is not
 * phase order and must not be sorted by phase.
 */
export const NAV: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    hint: 'Starq Technologies',
    icon: LayoutDashboard,
    live: true,
  },
  {
    // Company (Founder seq 8486/8487). One nav item for the whole skyscraper:
    // Dev Studio is one floor, not the building. Doctrine in @/surfaces/company-os.
    id: 'company',
    label: 'Company',
    hint: 'Starq Technologies as a company',
    icon: Building2,
    live: true,
  },
  {
    id: 'building',
    label: 'Building',
    hint: 'Floors and project rooms',
    icon: Boxes,
    live: true,
  },
  {
    id: 'library',
    label: 'Library',
    hint: 'Nexus records and documents',
    icon: Library,
    live: true,
  },
  {
    id: 'cortex',
    label: 'Cortex',
    hint: 'Connected work and evidence',
    icon: Network,
    live: true,
  },
  {
    id: 'comms',
    label: 'Comms',
    hint: 'Room messenger',
    icon: MessageSquare,
    live: true,
  },
  {
    id: 'studio',
    label: 'Dev Studio',
    hint: 'Project boards',
    icon: Users,
    live: true,
  },
  {
    id: 'attention',
    label: 'Founder Attention',
    hint: 'Building governance',
    icon: AlertOctagon,
    live: true,
  },
  {
    id: 'evidence',
    label: 'Evidence',
    hint: 'Command summarizes → Room proves',
    icon: Fingerprint,
    live: true,
  },
  {
    id: 'system',
    label: 'System',
    hint: 'Building source health',
    icon: Settings2,
    live: true,
  },
];

export function Rail({
  active,
  onSelect,
  health,
  expanded,
  onToggle,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  health: Health | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-surface-1/70 backdrop-blur-sm transition-[width] duration-200 ease-out',
        expanded ? 'w-rail-expanded' : 'w-rail',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
        className="flex h-topbar items-center gap-2.5 border-b border-border px-3 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-truth-hold/40 bg-truth-hold-soft">
          <Network className="h-4 w-4 text-truth-hold" />
        </span>
        {expanded ? (
                  <span className="min-w-0">
                    <span className="wordmark block truncate">
                      STARQ <span className="text-muted-foreground">//</span> COMMAND
                    </span>
                    <span className="wordmark-sub block truncate">Starq Technologies</span>
                  </span>
                ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              /*
                The accessible name is UNCONDITIONAL. Below 800px the rail
                collapses by CSS only — React still holds expanded===true — so
                the label text is display:none while `title` was undefined.
                That left six icon buttons with no accessible name and no hover
                text (Goose R3). aria-label carries the name at every width;
                `title` stays so a pointer user also gets the hint.
              */
              aria-label={item.label}
              title={`${item.label} — ${item.hint}`}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150',
                isActive
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground',
              )}
            >
              {isActive ? (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
              ) : null}
              <Icon className="h-4 w-4 shrink-0" />
              {expanded ? (
                              <span className="min-w-0 flex-1">
                                <span className="nav-item-label block truncate">{item.label}</span>
                                <span className="nav-item-hint block truncate">{item.hint}</span>
                              </span>
                            ) : null}
            </button>
          );
        })}
      </div>

      <Separator />

      <div className="p-2">
        <ProjectionState health={health} expanded={expanded} />
      </div>
    </nav>
  );
}

/**
 * Projection health — ONE component, rendered at two sizes.
 *
 * Goose R1: below 800px this block used to be `display:none`, which deleted a
 * truth-state value rather than compressing it. The count now also rides the
 * pinned `.command-context` bar in App.tsx at every width, so the rail keeps
 * the badge (health colour, at a glance) and the bar keeps the count (the
 * number). Neither width loses either.
 *
 * `overall` is derived here, once, so the rail and the bar can never disagree
 * about what state Command believes it is in.
 *
 * The rail-side block is marked `data-rail-projection` rather than relying on
 * `div:last-child`, because that positional selector was what made the block
 * easy to delete wholesale when the layout changed.
 */
export function ProjectionState({
  health,
  expanded,
}: {
  health: Health | null;
  expanded: boolean;
}) {
  const overall = health?.overall ?? 'UNAVAILABLE';
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-0/60 p-2"
      data-rail-projection=""
      data-projection-state={overall}
    >
      {expanded ? <span className="label-sec">Projection state</span> : null}
      <SurfaceBadge state={overall} label={expanded ? undefined : ''} />
      {expanded && health ? (
        <span className="text-2xs text-muted-foreground">
          {health.counts.ok}/{health.counts.total} conditions in sync
        </span>
      ) : null}
    </div>
  );
}

export function TopBar({
  founderDisplay,
  founderHandle,
  workspaceRoot,
  authority,
  assembledAt,
  refreshing,
  onRefresh,
  children,
}: {
  founderDisplay: string | null;
  founderHandle: string | null;
  workspaceRoot: string | null;
  authority: string | null;
  assembledAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface-1/60 px-4 backdrop-blur-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
              <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {founderDisplay ?? 'UNKNOWN'} <span className="text-muted-foreground">· Founder</span>
                  {founderHandle ? (
                    <span className="ml-1.5 font-mono text-2xs text-truth-founder">{founderHandle}</span>
                  ) : null}
                </p>
              </div>
            </div>

            {/*
              ROOM QUICK-SWITCH — WF-SHELL-03.

              This used to be rendered as `children` INSIDE the top bar's flex row,
              which is where gap map WF-SHELL-03 said it did not belong: two
              full room toggles with live state tokens, sharing a 40px bar with the
              founder identity and the workspace read-out. It had no label of its
              own, so at narrow widths it collapsed into anonymous chips.

              It is now a dedicated labelled strip, mounted by the shell beneath the
              top bar, so "which room am I in" is a question with a visibly labelled
              answer rather than two unlabelled chips competing for the header row.
              `children` is retained so the strip can still be overridden, but the
              default mount point is its own element.
            */}
            {children ? <div className="room-strip">{children}</div> : null}

      <div className="flex shrink-0 items-center gap-3">
              {/*
                PERSISTENT AUTHORITY — slim status treatment (seq 8411).

                The DERIVED_PROJECTION declaration stays INLINE and always visible.
                It is not demoted and not click-gated: an operator must never have to
                click to learn that what they are reading is a projection rather than
                an SSOT. That single word is the whole truth claim and it costs one
                token.

                What folds behind the disclosure is the supporting provenance — the
                workspace path and the assembly timestamp — which is what an operator
                consults when auditing a claim, not on every glance. On narrow widths
                the whole block is still one compact control rather than a second
                wrapped row.
              */}
              <SlimStatus
                token={authority ?? 'DERIVED_PROJECTION'}
                title="Projection authority and assembly provenance"
              >
                <KV
                  rows={[
                    ['Authority', authority ?? 'UNKNOWN'],
                    ['Workspace', workspaceRoot ?? 'UNRESOLVED'],
                    [
                      'Assembled',
                      assembledAt ?? 'UNKNOWN',
                    ],
                  ]}
                />
              </SlimStatus>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="Refresh canonical projections"
                className="cmd-btn flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Activity className={cn('h-3.5 w-3.5', refreshing && 'animate-spin text-primary')} />
              </button>
            </div>
    </header>
  );
}

/**
 * RoomSwitcher — the persistent ERP / Hoadha toggle.
 *
 * GAP MAP WF-SHELL-03, closed in the seq 8411 polish wave.
 *
 * It was previously passed into `TopBar` as `children`, which put two live
 * room toggles inside a 40px bar shared with the founder identity and the
 * workspace read-out, with no label of its own. At 430px it collapsed into
 * anonymous chips.
 *
 * It now renders as its own labelled strip: "Room" states which dimension
 * the control switches, and each room carries its own accent dot and its own
 * declared state token. The Founder instruction was to give it the dedicated
 * labelled treatment it was always intended to have — this is that, and it
 * moves the room dimension OUT of the founder-identity row rather than adding
 * a third competing thing to it.
 *
 * Nothing about room identity is derived here: `state` is passed in from the
 * building projection and rendered as declared.
 */
export function RoomSwitcher({
  rooms,
}: {
  rooms: { id: string; label: string; state: string; href: string }[];
}) {
  return (
    <div className="room-strip-inner" role="group" aria-label="Project rooms">
      <span className="room-strip-label" aria-hidden="true">
        Room
      </span>
      {rooms.map((r) => (
        <a
          key={r.id}
          href={r.href}
          data-room={r.id}
          className="room-root group flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-2xs no-underline transition-colors hover:border-foreground/30 hover:bg-foreground/[0.04]"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'hsl(var(--room))' }}
            aria-hidden="true"
          />
          <span className="font-medium text-foreground">{r.label}</span>
          {/* A declared state token: monospace, machine-cased on purpose. */}
          <span
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: 'hsl(var(--room))' }}
          >
            {r.state}
          </span>
        </a>
      ))}
    </div>
  );
}

export function FileSearchIcon({ className }: { className?: string }) {
  return <FileSearch className={className} />;
}

/**
 * CMD-DI-1-4 — Studio grouping, presentation only.
 *
 * The six Studio tabs stay where building-route declares them. This legend
 * names the design group the current tab already belongs to. It is not a
 * route, not a rail entry, and not a second tab list.
 */
const STUDIO_GROUP_BY_TAB: Record<string, string> = {
  Overview: 'Command',
  Staff: 'Workforce',
  Projects: 'Delivery',
  Capacity: 'Workforce',
  Activity: 'Delivery',
  Herdr: 'Runtime',
};

const STUDIO_GROUP_LEGEND: readonly (readonly [string, string])[] = [
  ['Command', 'Overview'],
  ['Workforce', 'Staff · Capacity'],
  ['Delivery', 'Projects · Activity'],
  ['Runtime', 'Herdr'],
];

export function studioGroupLabel(tab: string): string {
  return STUDIO_GROUP_BY_TAB[tab] ?? 'UNKNOWN';
}

export function StudioGroupLegend({ tab }: { tab: string }) {
  const current = studioGroupLabel(tab);
  return (
    <div className="border-b border-border bg-surface-0/80 px-3 py-1.5" aria-label="Studio grouping">
      <p className="label-micro">
        Dev Studio <span aria-hidden="true">/</span> {current} <span aria-hidden="true">/</span>{' '}
        <span className="label-token">{tab}</span>
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1" role="list">
        {STUDIO_GROUP_LEGEND.map(([label, members]) => {
          const active = label === current;
          return (
            <li
              key={label}
              className="text-2xs text-muted-foreground"
              data-studio-group={label}
              data-current={active ? 'true' : 'false'}
            >
              <span className={active ? 'text-foreground' : undefined}>{label}</span>
              <span className="ml-1 font-mono">{members}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
