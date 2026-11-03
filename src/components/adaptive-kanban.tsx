/**
 * Adaptive Kanban layout utility and components.
 * Supports dynamic collapsing of empty columns (approx 40px track) while
 * expanding populated columns (minmax(240px, 1fr)) so populated columns
 * share the recovered horizontal space.
 *
 * Implements assignment #17490:
 * - Emptiness calculated from visible cards after active filters.
 * - Dynamic track calculation: 40px for collapsed, minmax(240px, 1fr) for expanded.
 * - Rotated 90° CCW title in collapsed state (bottom-to-top).
 * - Temporary manual toggle (expand/collapse) with reset on navigation.
 * - Semantic toggle buttons, aria-expanded, keyboard accessibility.
 * - Unavailable / loading data guarded against false collapsing.
 * - Transitions from count 0 to >0 automatically clear manual-collapse overrides.
 */
import * as React from 'react';

export interface UseAdaptiveKanbanOptions {
  /**
   * If false, board data is loading, unavailable, or failed.
   * Empty column auto-collapse MUST NOT trigger when data is not ready.
   */
  isDataReady?: boolean;
  /**
   * Key that resets manual overrides on navigation (e.g., projectId).
   */
  navigationKey?: string | null;
}

export interface UseAdaptiveKanbanReturn<T extends string> {
  isColumnCollapsed: (colId: T) => boolean;
  toggleColumn: (colId: T) => void;
  expandColumn: (colId: T) => void;
  collapseColumn: (colId: T) => void;
  desktopGridTemplateColumns: string;
  manualOverrides: Record<string, boolean>;
}

export function useAdaptiveKanban<T extends string>(
  columns: readonly T[],
  visibleCounts: Record<T, number>,
  options: UseAdaptiveKanbanOptions = {},
): UseAdaptiveKanbanReturn<T> {
  const { isDataReady = true, navigationKey = null } = options;

  // manualOverrides: true = manually expanded, false = manually collapsed
  const [manualOverrides, setManualOverrides] = React.useState<Record<string, boolean>>({});

  // Reset manual expansion on board navigation
  React.useEffect(() => {
    setManualOverrides({});
  }, [navigationKey]);

  // Track previous counts to detect transitions from 0 to positive count
  const prevCountsRef = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    const prevCounts = prevCountsRef.current;
    let changed = false;
    const nextOverrides = { ...manualOverrides };

    for (const colId of columns) {
      const prev = prevCounts[colId] ?? 0;
      const curr = visibleCounts[colId] ?? 0;

      // Rule (#17490 / #17512): When a lane transitions from 0 to a positive visible count,
      // clear the manual-collapse override so the lane expands automatically.
      if (prev === 0 && curr > 0) {
        if (nextOverrides[colId] !== undefined) {
          delete nextOverrides[colId];
          changed = true;
        }
      }
    }

    prevCountsRef.current = { ...visibleCounts };

    if (changed) {
      setManualOverrides(nextOverrides);
    }
  }, [columns, visibleCounts, manualOverrides]);

  const isColumnCollapsed = React.useCallback(
    (colId: T): boolean => {
      // Hard guard: loading, unavailable, or failed data must NEVER be treated as empty
      if (!isDataReady) return false;

      const count = visibleCounts[colId] ?? 0;
      const manual = manualOverrides[colId];

      // Synchronous guard: if the lane transitioned from zero to a positive visible count,
      // disregard any previous manual-collapse override and expand automatically.
      if (manual === false && count > 0 && (prevCountsRef.current[colId] ?? 0) === 0) {
        return false;
      }

      if (manual !== undefined) {
        return !manual;
      }

      // Automatic rule: 0 visible cards -> collapsed
      return count === 0;
    },
    [isDataReady, manualOverrides, visibleCounts],
  );

  const toggleColumn = React.useCallback(
    (colId: T) => {
      setManualOverrides((prev) => {
        const currentlyCollapsed = isColumnCollapsed(colId);
        const count = visibleCounts[colId] ?? 0;

        // If currently collapsed, expand it
        if (currentlyCollapsed) {
          return {
            ...prev,
            [colId]: true,
          };
        }

        // If currently expanded:
        // If count is 0, collapsing simply clears the manual-expand override
        if (count === 0) {
          const next = { ...prev };
          delete next[colId];
          return next;
        }

        // If count > 0, collapsing sets override = false
        return {
          ...prev,
          [colId]: false,
        };
      });
    },
    [isColumnCollapsed, visibleCounts],
  );

  const expandColumn = React.useCallback((colId: T) => {
    setManualOverrides((prev) => ({ ...prev, [colId]: true }));
  }, []);

  const collapseColumn = React.useCallback((colId: T) => {
    setManualOverrides((prev) => ({ ...prev, [colId]: false }));
  }, []);

  const desktopGridTemplateColumns = React.useMemo(() => {
    return columns
      .map((colId) => (isColumnCollapsed(colId) ? '40px' : 'minmax(240px, 1fr)'))
      .join(' ');
  }, [columns, isColumnCollapsed]);

  return {
    isColumnCollapsed,
    toggleColumn,
    expandColumn,
    collapseColumn,
    desktopGridTemplateColumns,
    manualOverrides,
  };
}

export interface CollapsedColumnStripProps {
  id: string;
  title: string;
  count: number;
  onToggle: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  className?: string;
}

export function CollapsedColumnStrip({
  id,
  title,
  count,
  onToggle,
  onDragOver,
  onDrop,
  className = '',
}: CollapsedColumnStripProps) {
  return (
    <section
      key={id}
      data-lane={id}
      data-collapsed="true"
      aria-label={`${title} lane (${count} tasks, collapsed)`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex min-h-[420px] w-[40px] min-w-[40px] max-w-[40px] flex-col items-center justify-between rounded border border-border bg-card/60 py-3 px-1 transition-colors hover:border-border-hover hover:bg-card ${className}`}
    >
      <button
        type="button"
        aria-expanded="false"
        aria-label={`Expand ${title} lane (${count} tasks)`}
        onClick={onToggle}
        className="flex h-full w-full flex-col items-center justify-between gap-3 rounded py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <span
          className="chip px-1.5 py-0.5 font-mono text-[10px]"
          data-tone="muted"
          data-testid={`column-count-${id}`}
        >
          {count}
        </span>

        <span
          className="my-auto whitespace-nowrap font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase transition-colors group-hover:text-foreground"
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
          }}
          data-testid={`column-label-${id}`}
        >
          {title}
        </span>

        <span
          className="select-none text-[11px] text-muted-foreground/70"
          title="Click to expand"
          aria-hidden="true"
        >
          ↕
        </span>
      </button>
    </section>
  );
}
