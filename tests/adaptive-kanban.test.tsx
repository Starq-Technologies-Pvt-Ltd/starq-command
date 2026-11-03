// @vitest-environment node
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PM_STATUSES, PM_STATUS_LABELS, type PmTask, type PmStatus } from '@/lib/pm-client';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { ProjectBoard, mapTaskToProjectLane, PROJECT_BOARD_LANES } from '@/surfaces/project-board';
import { useAdaptiveKanban, CollapsedColumnStrip } from '@/components/adaptive-kanban';
import type { BuildingRecord } from '@/lib/contracts';

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

function setupHost(url = 'http://localhost/#studio/pm/erp') {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = dom.window.document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

// Test harness for testing the useAdaptiveKanban hook in isolation
function AdaptiveKanbanTestHarness<T extends string>({
  columns,
  counts,
  isDataReady = true,
  navigationKey = 'board-1',
}: {
  columns: readonly T[];
  counts: Record<T, number>;
  isDataReady?: boolean;
  navigationKey?: string;
}) {
  const {
    isColumnCollapsed,
    toggleColumn,
    desktopGridTemplateColumns,
  } = useAdaptiveKanban(columns, counts, { isDataReady, navigationKey });

  return (
    <div
      data-testid="grid"
      style={{ gridTemplateColumns: desktopGridTemplateColumns }}
    >
      {columns.map((col) => {
        const collapsed = isColumnCollapsed(col);
        const count = counts[col] ?? 0;
        if (collapsed) {
          return (
            <CollapsedColumnStrip
              key={col}
              id={col}
              title={col}
              count={count}
              onToggle={() => toggleColumn(col)}
            />
          );
        }
        return (
          <section
            key={col}
            data-lane={col}
            data-collapsed="false"
            data-testid={`column-${col}`}
          >
            <header>
              <h3>{col}</h3>
              <span className="count">{count}</span>
              <button
                type="button"
                aria-expanded="true"
                data-testid={`collapse-btn-${col}`}
                onClick={() => toggleColumn(col)}
              >
                Collapse
              </button>
            </header>
            <div data-testid={`cards-${col}`}>cards for {col}</div>
          </section>
        );
      })}
    </div>
  );
}

describe('Adaptive Kanban UI & Layout Engine (#17490)', () => {
  it('correctly calculates dynamic desktop grid tracks for StarqERP board layout', () => {
    // StarqERP scenario from Founder specification #17490:
    // To Do (192) — expanded
    // Next Up (0) — collapsed
    // In Progress (12) — expanded
    // Blocked (0) — collapsed
    // Done (233) — expanded
    const counts: Record<PmStatus, number> = {
      TODO: 192,
      NEXT: 0,
      IN_PROGRESS: 12,
      BLOCKED: 0,
      DONE: 233,
    };

    const host = setupHost();
    act(() => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} />);
    });

    const grid = host.querySelector('[data-testid="grid"]') as HTMLElement;
    expect(grid).toBeTruthy();
    // Next Up and Blocked are collapsed to 40px; To Do, In Progress, Done get minmax(240px, 1fr)
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(240px, 1fr) 40px minmax(240px, 1fr) 40px minmax(240px, 1fr)',
    );

    // Collapsed columns rendered as vertical strips
    const nextCollapsed = host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]');
    expect(nextCollapsed).toBeTruthy();
    expect(nextCollapsed?.getAttribute('aria-label')).toContain('NEXT lane (0 tasks, collapsed)');

    const blockedCollapsed = host.querySelector('section[data-lane="BLOCKED"][data-collapsed="true"]');
    expect(blockedCollapsed).toBeTruthy();

    // Populated columns rendered expanded
    const todoExpanded = host.querySelector('section[data-lane="TODO"][data-collapsed="false"]');
    expect(todoExpanded).toBeTruthy();
    expect(host.querySelector('[data-testid="cards-TODO"]')).toBeTruthy();

    const inProgressExpanded = host.querySelector('section[data-lane="IN_PROGRESS"][data-collapsed="false"]');
    expect(inProgressExpanded).toBeTruthy();

    const doneExpanded = host.querySelector('section[data-lane="DONE"][data-collapsed="false"]');
    expect(doneExpanded).toBeTruthy();
  });

  it('renders status title rotated 90deg counterclockwise with count visible in collapsed strip', () => {
    const counts: Record<PmStatus, number> = {
      TODO: 10,
      NEXT: 0,
      IN_PROGRESS: 5,
      BLOCKED: 0,
      DONE: 20,
    };

    const host = setupHost();
    act(() => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} />);
    });

    const nextStrip = host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]');
    expect(nextStrip).toBeTruthy();

    // Count is visible
    const countBadge = nextStrip?.querySelector('[data-testid="column-count-NEXT"]');
    expect(countBadge?.textContent?.trim()).toBe('0');

    // Title label has rotated writing mode & transform
    const label = nextStrip?.querySelector('[data-testid="column-label-NEXT"]') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.textContent?.trim()).toBe('NEXT');
    expect(label.style.writingMode).toBe('vertical-rl');
    expect(label.style.transform).toBe('rotate(180deg)');

    // Toggle button has aria-expanded="false"
    const toggleBtn = nextStrip?.querySelector('button[aria-expanded="false"]');
    expect(toggleBtn).toBeTruthy();
  });

  it('supports temporary manual toggle (click to expand / click to collapse)', async () => {
    const counts: Record<PmStatus, number> = {
      TODO: 10,
      NEXT: 0,
      IN_PROGRESS: 5,
      BLOCKED: 0,
      DONE: 20,
    };

    const host = setupHost();
    await act(async () => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} />);
    });

    // NEXT is currently collapsed
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();

    // Click collapsed NEXT strip button to temporarily expand it
    const nextToggleBtn = host.querySelector('section[data-lane="NEXT"] button') as HTMLButtonElement;
    await act(async () => {
      nextToggleBtn.click();
    });

    // NEXT is now expanded
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="false"]')).toBeTruthy();
    const gridAfterExpand = host.querySelector('[data-testid="grid"]') as HTMLElement;
    expect(gridAfterExpand.style.gridTemplateColumns).toContain('minmax(240px, 1fr) minmax(240px, 1fr)');

    // Click the collapse button on the expanded NEXT column to collapse it back
    const collapseBtn = host.querySelector('[data-testid="collapse-btn-NEXT"]') as HTMLButtonElement;
    await act(async () => {
      collapseBtn.click();
    });

    // NEXT is collapsed again
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();
  });

  it('clears manual-collapse override when lane transitions from count 0 to 1 and expands automatically (#17512)', async () => {
    // Sequence required by Chief Engineer review #17512:
    // empty -> manually expand -> collapse -> count 0 to 1 -> assert lane expands automatically
    let counts: Record<PmStatus, number> = {
      TODO: 10,
      NEXT: 0,
      IN_PROGRESS: 5,
      BLOCKED: 0,
      DONE: 20,
    };

    const host = setupHost();
    await act(async () => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} />);
    });

    // 1. Initial state: NEXT is empty (count 0) and collapsed
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();

    // 2. Manually expand NEXT
    const nextStripBtn = host.querySelector('section[data-lane="NEXT"] button') as HTMLButtonElement;
    await act(async () => {
      nextStripBtn.click();
    });
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="false"]')).toBeTruthy();

    // 3. Manually collapse NEXT back
    const collapseBtn = host.querySelector('[data-testid="collapse-btn-NEXT"]') as HTMLButtonElement;
    await act(async () => {
      collapseBtn.click();
    });
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();

    // 4. Board updates: NEXT receives a visible card (count transitions from 0 to 1)
    counts = {
      ...counts,
      NEXT: 1,
    };
    await act(async () => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} />);
    });

    // 5. Assert: NEXT must expand automatically despite prior manual collapse override
    const nextExpanded = host.querySelector('section[data-lane="NEXT"][data-collapsed="false"]');
    expect(nextExpanded).toBeTruthy();
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeNull();

    const grid = host.querySelector('[data-testid="grid"]') as HTMLElement;
    // NEXT is now expanded, only BLOCKED remains collapsed (40px)
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr) 40px minmax(240px, 1fr)',
    );
  });

  it('resets temporary manual expansion on board navigation', async () => {
    const counts: Record<PmStatus, number> = {
      TODO: 10,
      NEXT: 0,
      IN_PROGRESS: 5,
      BLOCKED: 0,
      DONE: 20,
    };

    const host = setupHost();
    await act(async () => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} navigationKey="project-alpha" />);
    });

    // Manually expand NEXT
    const nextToggleBtn = host.querySelector('section[data-lane="NEXT"] button') as HTMLButtonElement;
    await act(async () => {
      nextToggleBtn.click();
    });
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="false"]')).toBeTruthy();

    // Navigate to project-beta
    await act(async () => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={counts} navigationKey="project-beta" />);
    });

    // NEXT automatically reverts back to collapsed state because manual expansion was reset
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();
  });

  it('never collapses columns when board data is loading, unavailable, or failed', () => {
    const zeroCounts: Record<PmStatus, number> = {
      TODO: 0,
      NEXT: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      DONE: 0,
    };

    const host = setupHost();
    act(() => {
      root?.render(
        <AdaptiveKanbanTestHarness
          columns={PM_STATUSES}
          counts={zeroCounts}
          isDataReady={false} // Data not ready
        />,
      );
    });

    // When isDataReady is false, no column should be collapsed
    const collapsed = host.querySelectorAll('section[data-collapsed="true"]');
    expect(collapsed.length).toBe(0);

    const expanded = host.querySelectorAll('section[data-collapsed="false"]');
    expect(expanded.length).toBe(5);

    const grid = host.querySelector('[data-testid="grid"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr) minmax(240px, 1fr)',
    );
  });

  it('automatically adapts layout when visible counts dynamically change from filter updates', () => {
    const initialCounts: Record<PmStatus, number> = {
      TODO: 5,
      NEXT: 3,
      IN_PROGRESS: 2,
      BLOCKED: 1,
      DONE: 4,
    };

    const host = setupHost();
    act(() => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={initialCounts} />);
    });

    // Initially all 5 columns populated -> all expanded
    expect(host.querySelectorAll('section[data-collapsed="true"]').length).toBe(0);
    expect(host.querySelectorAll('section[data-collapsed="false"]').length).toBe(5);

    // Apply high-priority filter where NEXT and BLOCKED have 0 matching cards
    const filteredCounts: Record<PmStatus, number> = {
      TODO: 2,
      NEXT: 0,
      IN_PROGRESS: 1,
      BLOCKED: 0,
      DONE: 1,
    };

    act(() => {
      root?.render(<AdaptiveKanbanTestHarness columns={PM_STATUSES} counts={filteredCounts} />);
    });

    // NEXT and BLOCKED are now automatically collapsed
    expect(host.querySelector('section[data-lane="NEXT"][data-collapsed="true"]')).toBeTruthy();
    expect(host.querySelector('section[data-lane="BLOCKED"][data-collapsed="true"]')).toBeTruthy();
    expect(host.querySelectorAll('section[data-collapsed="false"]').length).toBe(3);
  });

  it('renders read-only ProjectBoard with adaptive collapsed lanes for empty source statuses', () => {
    const mockRecords: BuildingRecord[] = [
      { id: 'SERP-101', title: 'Task Ready', status: 'ready', collection: 'starqERP', source: 'starq-erp-tasks.json' },
      { id: 'SERP-102', title: 'Task In Progress', status: 'in_progress', collection: 'starqERP', source: 'starq-erp-tasks.json' },
      { id: 'SERP-103', title: 'Task Done', status: 'done', collection: 'starqERP', source: 'starq-erp-tasks.json' },
    ];

    const html = renderToStaticMarkup(
      <ProjectBoard records={mockRecords} label="StarqERP Tasks" projectLabel="starqERP" projectId="erp" />,
    );

    // Grid container is present with dynamic tracks
    expect(html).toContain('data-testid="project-kanban-grid"');

    // Lanes with cards: READY, IN PROGRESS, DONE are expanded (data-collapsed="false")
    expect(html).toContain('data-lane="READY" data-collapsed="false"');
    expect(html).toContain('data-lane="IN PROGRESS" data-collapsed="false"');
    expect(html).toContain('data-lane="DONE" data-collapsed="false"');

    // Empty lanes: TODAY, REVIEW, FOUNDER GATE, BLOCKED, UNKNOWN are collapsed (data-collapsed="true")
    expect(html).toContain('data-lane="BLOCKED" data-collapsed="true"');
    expect(html).toContain('data-lane="TODAY" data-collapsed="true"');
    expect(html).toContain('data-lane="FOUNDER GATE" data-collapsed="true"');

    // Collapsed lane contains aria-expanded="false" and count
    expect(html).toContain('aria-label="Expand BLOCKED lane (0 tasks)"');
  });
});
