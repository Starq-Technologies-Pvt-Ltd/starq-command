/**
 * Phase 7 — dense record table.
 *
 * WHAT CHANGED AND WHY
 *
 * The pre-build table was report-shaped: 30 rows per page, an "Inspect" button
 * per row that opened a JSON drawer, and no selection model. That made the two
 * real rooms — 326 Hoadha records and 437 ERP tasks — effectively unusable,
 * because the operator's actual question ("show me the blocked ones") required
 * a status dropdown, a page count, and then a button press per candidate.
 *
 * This table is console-shaped:
 *   · Click any row to select it; the evidence drawer opens from the selection,
 *     not from a per-row control that pushes every row's width wider.
 *   · Filter chips carry live counts, so "blocked (6)" is answerable at a glance.
 *   · The table lives inside a bounded scroll pane. The PAGE does not grow.
 *   · Status is carried on a left row-rail as well as in a chip, so scanning
 *     300 rows does not require reading 300 chips.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not rank, score, sort by importance, or infer a work state. Row
 * order is source order. The count in the toolbar is a filtered count, and it
 * is labelled as such. `null` records render as an explicit source gap, never
 * as an empty table.
 */
import * as React from 'react';
import type { BuildingRecord } from '@/lib/contracts';
import {
  Chip,
  Drawer,
  GoLink,
  SegmentedFilter,
  SourceGap,
  rowTone,
  show,
} from '@/components/console';

type Filter = 'ALL' | 'OPEN' | 'BLOCKED' | 'DONE';

function statusOf(r: BuildingRecord): string {
  return show(r.status ?? r.state);
}

/**
 * Row grouping for the status filter.
 *
 * `OPEN` is "not recorded as complete" — an honest partition of the source's
 * own vocabulary, not a new lifecycle. It is labelled in the UI as OPEN, never
 * as IN PROGRESS or ACTIVE, because the source does not say those things.
 */
function bucket(r: BuildingRecord): Filter {
  const s = statusOf(r).toUpperCase();
  if (['BLOCKED', 'DRIFT', 'FAIL', 'ERROR'].includes(s)) return 'BLOCKED';
  if (['DONE', 'COMPLETE', 'COMPLETED', 'CLOSED'].includes(s)) return 'DONE';
  return 'OPEN';
}

export function RecordTable({
  records,
  label,
  crumb,
  height,
  href,
}: {
  records: BuildingRecord[] | null;
  label: string;
  crumb?: string;
  height?: 'short' | 'tall';
  href?: string;
  rowHref?: (r: BuildingRecord) => string | null;
}) {
  const storageKey = `command-filter:${label}`;
  const [query, setQuery] = React.useState(() =>
    typeof window === 'undefined' ? '' : (sessionStorage.getItem(storageKey) ?? ''),
  );
  React.useEffect(() => {
    sessionStorage.setItem(storageKey, query);
  }, [storageKey, query]);

  const [filter, setFilter] = React.useState<Filter>('ALL');
  const [selected, setSelected] = React.useState<BuildingRecord | null>(null);

  const all = records ?? [];
  const counts = React.useMemo(() => {
    const c: Record<Filter, number> = { ALL: all.length, OPEN: 0, BLOCKED: 0, DONE: 0 };
    for (const r of all) c[bucket(r)] += 1;
    return c;
  }, [all]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (filter !== 'ALL' && bucket(r) !== filter) return false;
      if (!q) return true;
      return `${r.id} ${show(r.title)} ${r.collection} ${statusOf(r)} ${show(r.wave)} ${show(
        r.phase,
      )} ${show(r.sprint)}`
        .toLowerCase()
        .includes(q);
    });
  }, [all, query, filter]);

  return (
    <section className="command-panel">
      <div className="head">
        <h2>{label}</h2>
        {records === null ? (
          <span className="chip" data-tone="unknown">
            SOURCE UNAVAILABLE
          </span>
        ) : (
          <span className="chip" data-tone="muted">
            {filtered.length} / {all.length}
          </span>
        )}
        <span className="spacer" />
        {href ? <GoLink href={href}>Open</GoLink> : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-2.5 py-1.5">
        <SegmentedFilter
          label="Status"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'ALL', label: 'All', count: counts.ALL },
            { id: 'OPEN', label: 'Open', count: counts.OPEN },
            { id: 'BLOCKED', label: 'Blocked', count: counts.BLOCKED },
            { id: 'DONE', label: 'Done', count: counts.DONE },
          ]}
        />
        <label className="command-toolbar" style={{ flex: '1 1 10rem', minWidth: 0 }}>
          <span className="sr-only">Search {label}</span>
          <input
            value={query}
            placeholder="Search id, title, phase, sprint…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%' }}
            aria-label={`Search ${label}`}
          />
          {query ? (
            <button type="button" data-variant="ghost" onClick={() => setQuery('')}>
              clear
            </button>
          ) : null}
        </label>
      </div>

      {records === null ? (
        <SourceGap
          reason="Cannot read this task source."
          detail="The projection records the source as absent or unreadable. No rows are shown because none were read — not because there are none."
        />
      ) : all.length === 0 ? (
        <SourceGap reason="Source read, zero rows." detail={`${label} is empty at source.`} />
      ) : (
        <div
          className={height === 'tall' ? 'command-table-wrap tall' : height === 'short' ? 'command-table-wrap short' : 'command-table-wrap'}
        >
          <table>
            <caption className="sr-only">{label} · original source states preserved</caption>
            <thead>
              <tr>
                <th style={{ width: '7.5rem' }}>ID</th>
                <th>Task</th>
                <th style={{ width: '6rem' }}>Status</th>
                <th style={{ width: '5rem' }}>Phase</th>
                <th style={{ width: '6.5rem' }}>Sprint</th>
                <th style={{ width: '9rem' }}>Collection</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const st = statusOf(r);
                return (
                  <tr
                    key={`${r.collection}:${r.id}:${i}`}
                    className="clickable"
                    aria-selected={selected === r}
                    tabIndex={0}
                    onClick={() => setSelected(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(r);
                      }
                    }}
                  >
                    <td className="id">{r.id}</td>
                    <td className="row-rail" data-tone={rowTone(st)}>
                      {show(r.title)}
                    </td>
                    <td>
                      <Chip value={st} />
                    </td>
                    <td className="mono">{show(r.phase)}</td>
                    <td className="mono">{show(r.sprint)}</td>
                    <td className="mono">{r.collection}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p style={{ padding: '0.75rem' }}>No matching records in this filter.</p>
          ) : null}
        </div>
      )}
      {selected ? (
        <Drawer
          title={`${selected.id}`}
          crumb={crumb ?? `${label} · ${selected.collection}`}
          record={selected}
          close={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}