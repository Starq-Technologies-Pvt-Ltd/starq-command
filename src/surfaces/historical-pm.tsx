/**
 * Historical Nexus records — Building projection view (#10646).
 *
 * Read-only. Does not call the PM service, does not create native tasks,
 * and does not map Nexus status onto Command workflow stages.
 */
import * as React from 'react';
import type { HistoricalPmProjection, HistoricalPmRecord } from '@/lib/contracts';
import { Chip, KV, Panel } from '@/components/console';
import { PeerWorkHeader, QualifierRow, WorkArea, WorkRow } from '@/components/work-area';

const BOARD_LABEL: Record<string, string> = {
  erp: 'ERP',
  hoadha_core: 'Hoadha Core',
  hoadha_social: 'Hoadha Social',
  hoadha_concierge: 'Hoadha Concierge',
};

function relationText(relations: Record<string, unknown> | undefined) {
  if (!relations) return 'none declared';
  const parts = Object.entries(relations).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return parts.length ? parts.join(' · ') : 'none declared';
}

export function HistoricalPmSurface({
  historical,
  board,
}: {
  historical?: HistoricalPmProjection;
  board?: string;
}) {
  const records = (historical?.records ?? []).filter((row) => !board || row.board === board);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected: HistoricalPmRecord | null =
    records.find((row) => `${row.board}:${row.source_row_index}:${row.source_id}` === selectedId) ?? records[0] ?? null;
  const rowId = (row: HistoricalPmRecord) => `${row.board}:${row.source_row_index}:${row.source_id}`;

  return (
    <section className="command-stack" data-historical-pm="true" data-actionable="false">
      <PeerWorkHeader
        peer="Historical Nexus"
        question="What raw Nexus board rows exist as history, without becoming Command tasks?"
      />
      <QualifierRow>
        <Chip value="HISTORICAL" tone="muted" />
        <Chip value="READ_ONLY" tone="muted" />
        <Chip value="actionable=false" tone="muted" />
        <span>
          {historical?.counts.total ?? 0}/{historical?.expected_counts.total ?? 763} records
        </span>
        <span>no native task actions · no owner/verifier inference · no status mapping</span>
      </QualifierRow>
      <Panel title="Board counts" count={historical?.count_match ? 'MATCH 763' : 'NOT 763'}>
        <KV
          rows={[
            ['ERP', historical?.counts.erp ?? 'UNKNOWN'],
            ['Hoadha Core', historical?.counts.hoadha_core ?? 'UNKNOWN'],
            ['Hoadha Social', historical?.counts.hoadha_social ?? 'UNKNOWN'],
            ['Hoadha Concierge', historical?.counts.hoadha_concierge ?? 'UNKNOWN'],
            ['Unique ids', historical?.unique_source_ids.length ?? 'UNKNOWN'],
            ['Workspace', 'D:\\!starq (not D:\\StarqTech\\Projects)'],
            ['Reason', historical?.reason ?? 'none'],
          ]}
        />
      </Panel>
      <WorkArea
        label="Historical records"
        rows={records.map(rowId)}
        selectedId={selected ? rowId(selected) : null}
        onSelect={setSelectedId}
        count={records.length}
        detailTitle={selected ? selected.source_id : 'No historical row selected'}
        list={
          <ul className="work-row-list" role="listbox" aria-label="Historical Nexus records">
            {records.map((row) => (
              <WorkRow
                key={rowId(row)}
                id={rowId(row)}
                selected={selected ? rowId(selected) === rowId(row) : false}
                onSelect={setSelectedId}
              >
                <span className="k">{String(row.raw.title ?? row.source_id)}</span>
                <span className="r">
                  {BOARD_LABEL[row.board] ?? row.board} · {String(row.status ?? 'UNKNOWN')} · row {row.source_row_index}
                </span>
              </WorkRow>
            ))}
          </ul>
        }
        detail={
          selected ? (
            <KV
              rows={[
                ['Kind', selected.kind],
                ['Actionable', String(selected.actionable)],
                ['Board', BOARD_LABEL[selected.board] ?? selected.board],
                ['Source path', selected.source_path],
                ['Source SHA-256', selected.source_sha256],
                ['Source row index', selected.source_row_index],
                ['Raw status', String(selected.status)],
                ['Relations', relationText(selected.relations)],
                ['Raw id', selected.source_id],
              ]}
            />
          ) : (
            <p className="tier-prose">No historical row selected.</p>
          )
        }
      />
    </section>
  );
}
