/**
 * Integrity — source reachability and reconciliation, shared by both rooms.
 *
 * WHAT THIS SURFACE IS FOR
 *
 * It answers one question: did Command read what it says it read? Every row
 * carries the source path, its declared state, its modification time and its
 * SHA-256. A hash proves which bytes were read. It does not prove that what
 * those bytes say is true, and this panel never claims otherwise — that
 * distinction is stated in the panel footer rather than left implied.
 *
 * WHY IT IS PER-ROOM
 *
 * Each room reads a different source set. An operator in the Hoadha room must
 * see Hoadha's sources and must NOT have to reason about whether an ERP source
 * being unreachable invalidates the Hoadha projection. The filter is explicit
 * and the counts are per-room.
 */
import * as React from 'react';
import type { BuildingProjection, CommandSurface } from '@/lib/contracts';
import { Chip, FocusRail, Panel, SourceGap, show } from '@/components/console';
import { TruthSurface } from '@/surfaces/truth';

type Project = 'erp' | 'hoadha';

function forProject(building: BuildingProjection, project?: Project) {
  return building.sources.filter((s) =>
    !project ? true : project === 'hoadha' ? !s.source.includes('starq-erp') : s.source.includes('starq-erp'),
  );
}

export function SourcePanel({
  building,
  project,
}: {
  building: BuildingProjection;
  project?: Project;
}) {
  const rows = forProject(building, project);
  const unreachable = rows.filter((s) => s.state !== 'AVAILABLE');
  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <Panel
      title="Source reachability / projection integrity"
      count={`${rows.filter((s) => s.state === 'AVAILABLE').length} / ${rows.length} readable`}
    >
      {rows.length ? (
        <div className="command-table-wrap">
          <table>
            <caption>Read provenance · refresh reads the files again</caption>
            <thead>
              <tr>
                <th>Source</th>
                <th style={{ width: '8rem' }}>State</th>
                <th style={{ width: '10rem' }}>Modified</th>
                <th style={{ width: '5.5rem' }}>Hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                // A Fragment carries the key so the optional expansion row is
                // part of the same keyed list — without it React warns and the
                // expansion row can be reconciled against the wrong source.
                <React.Fragment key={s.source}>
                  <tr
                    className="clickable"
                    onClick={() => setExpanded(expanded === s.source ? null : s.source)}
                  >
                    <td
                      className="row-rail"
                      data-tone={s.state === 'AVAILABLE' ? 'ok' : 'unknown'}
                    >
                      <a
                        href={`/api/raw?path=${encodeURIComponent(s.source)}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.source}
                      </a>
                    </td>
                    <td>
                      <Chip value={s.state} title={s.reason} />
                      {s.reason ? (
                        <div className="text-[9.5px] text-muted-foreground">{s.reason}</div>
                      ) : null}
                    </td>
                    <td className="mono">{s.modified_at ?? 'UNKNOWN'}</td>
                    <td className="mono">
                      <button
                        type="button"
                        data-variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(expanded === s.source ? null : s.source);
                        }}
                        aria-expanded={expanded === s.source}
                      >
                        {s.sha256 ? `${s.sha256.slice(0, 8)}…` : 'UNKNOWN'}
                      </button>
                    </td>
                  </tr>
                  {expanded === s.source ? (
                    <tr>
                      <td colSpan={4} style={{ background: 'hsl(var(--surface-0) / 0.6)' }}>
                        <span className="label-micro" style={{ fontSize: '8.5px' }}>
                          SHA-256 of bytes read
                        </span>
                        <div className="break-all font-mono text-[10px]">
                          {s.sha256 ?? 'UNKNOWN — source was not read'}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SourceGap reason="No source declared for this room." />
      )}
      <div className="border-t border-border px-2.5 py-1.5">
        <p className="prose-note">{building.note}</p>
        {unreachable.length ? (
          <p className="mt-1 !text-truth-unknown">
            {unreachable.length} source(s) not readable:{' '}
            {unreachable.map((s) => s.source.split('/').pop()).join(', ')}. Any projection
            depending on them is UNAVAILABLE, not empty.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * IntegritySurface — ERP shows the Phase 6 health floor as well, because that
 * is the control-plane truth ERP owns. Hoadha does not, because it has no
 * control-plane source; showing ERP's health inside the Hoadha room would
 * imply an authority Hoadha does not have.
 */
export function IntegritySurface({
  building,
  project,
  surface,
}: {
  building: BuildingProjection;
  project: Project;
  surface: CommandSurface;
}) {
  const h = building.hoadha;
  // The health-floor projection with a readable dimension set is what the
  // accepted Phase 3 Truth surface needs. Anything less is an absent input,
  // not an empty one — so the guard tests the shape the surface actually reads.
  const floorPresent = Array.isArray(surface.health_floor?.current_health);
  return (
    <>
      <FocusRail label="Reading note">
        <p>
          A SHA-256 here proves which bytes Command read. It does not prove that those bytes are
          correct, that a release was accepted, or that anything was deployed.
        </p>
      </FocusRail>
      {/*
        The Phase 3 Truth surface is an accepted, frozen surface and is mounted
        unchanged. But it reads `floor.current_health`, which only exists when a
        floor projection was actually read. Phase 7 therefore checks the input
        at the boundary rather than editing the accepted surface to tolerate an
        absence it was never written against — and when the floor is absent, it
        says so instead of rendering half a health table.
      */}
      {project === 'erp' && floorPresent ? (
        <TruthSurface surface={surface} />
      ) : project === 'erp' ? (
        <Panel title="Control-plane health floor">
          <SourceGap
            reason="Floor projection unavailable — control-plane dimensions cannot be read."
            detail="The health floor is derived from a floor projection. Nothing is inferred from its absence."
          />
        </Panel>
      ) : null}
      {project === 'hoadha' ? (
        <div className="command-split">
          <Panel title="Board reconciliation" count={h.integrity}>
            <div className="command-table-wrap short">
              <table>
                <caption>Expected packet counts versus source reads</caption>
                <thead>
                  <tr>
                    <th>Board</th>
                    <th style={{ width: '4rem' }} className="num">
                      Read
                    </th>
                    <th style={{ width: '4.5rem' }} className="num">
                      Expected
                    </th>
                    <th style={{ width: '6rem' }}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {h.boards.map((b) => (
                    <tr key={b.project}>
                      <td className="mono">{b.project}</td>
                      <td className="num">{show(b.count)}</td>
                      <td className="num">{b.expected}</td>
                      <td>
                        <Chip value={b.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Declared project state">
            <div className="body">
              <dl className="kv">
                {(
                  [
                    ['Integrity', h.integrity],
                    ['Source status', h.source_status],
                    ['Current wave', h.current_wave],
                    ['Execution', h.execution],
                    ['Production', h.production],
                    ['Integration', h.integration],
                    ['Proposed', show(h.proposed_count)],
                    ['Live', show(h.live_count)],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="mt-2 prose-note">
                Build and release acceptance is UNVERIFIED. ERP hold is a room state and is not
                restatable from this surface.
              </p>
            </div>
          </Panel>
        </div>
      ) : null}
      <SourcePanel building={building} project={project} />
    </>
  );
}