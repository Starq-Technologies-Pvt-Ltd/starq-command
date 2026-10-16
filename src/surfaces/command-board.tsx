import { useEffect, useState } from 'react';
import { Chip, KV, Panel } from '@/components/console';
import {
  COMMAND_BOARD_SOURCE,
  type CommandBoardProjection,
  loadCommandBoard,
} from '@/lib/command-board';

function CommandBoardView({ projection }: { projection: CommandBoardProjection }) {
  const tasks = projection.tasks;
  return (
    <section className="command-stack" aria-label="Command board task projection" data-input={projection.input}>
      <Panel title="Command / MODS offline board" count={projection.state}>
        <div className="body">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip value={projection.state} />
            <span className="text-2xs text-muted-foreground">distinct input: {projection.input}</span>
          </div>
          <p className="prose-note">
            Read-only snapshot of the separately accepted Command board. Task rows do not grant
            authorization or indicate current execution state.
          </p>
          <KV
            rows={[
              ['Source identity', projection.source.identity],
              ['Board SHA-256', projection.source.boardSha256],
              ['Schema SHA-256', projection.source.schemaSha256],
              ['Manifest SHA-256', projection.source.manifestSha256],
              ['Room cutoff', `#${projection.source.checkpoint.sequence}`],
              ['Cutoff event ID', projection.source.checkpoint.eventId],
              ['Cutoff record hash', projection.source.checkpoint.recordHash],
              ['Internal board status', tasks ? projection.boardStatus : 'CANDIDATE_NOT_ACCEPTED (pinned baseline)'],
              ['External acceptance', `Room #${projection.acceptance.sequence} · ${projection.acceptance.disposition}`],
              ['Acceptance event ID', projection.acceptance.eventId],
              ['Acceptance record hash', projection.acceptance.recordHash],
            ]}
          />
          <p className="mt-3 text-2xs text-muted-foreground">
            Freshness is STALE because this offline projection does not refresh the Room head after
            the #9455 checkpoint. The external acceptance covers pinned offline source integrity only.
          </p>
          {projection.state !== 'STALE' ? (
            <p role="alert" className="mt-2 text-2xs text-muted-foreground">
              {projection.state}: {projection.reason} No ERP, ledger, TaskStore, or UI-state fallback is used.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Phase 1 recorded exceptions" count="UNKNOWN">
        <div className="body">
          <ul className="space-y-1">
            {projection.historicalLimitations.map((limitation) => (
              <li key={limitation}><Chip value="UNKNOWN" /> <span>{limitation}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-2xs text-muted-foreground">
            Neither limitation is converted to PASS by this projection.
          </p>
        </div>
      </Panel>

      {tasks ? (
        <Panel title="Command task records" count={`${tasks.length} historical rows`}>
          <div className="command-table-wrap">
            <table>
              <caption>
                Original source state and scoped disposition; current owner, verifier, and workflow stage remain UNKNOWN.
              </caption>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Source state</th>
                  <th>Disposition</th>
                  <th>Current owner</th>
                  <th>Current verifier</th>
                  <th>Workflow stage</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="row-rail"><span className="mono">{task.id}</span><br />{task.title}</td>
                    <td><Chip value={task.source_state} /></td>
                    <td>{task.disposition}</td>
                    <td><Chip value={task.current_owner} /></td>
                    <td><Chip value={task.current_verifier} /></td>
                    <td><Chip value={String(task.workflow_stage).toUpperCase()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel title="Command task records" count="0 shown">
          <div className="body">
            <p className="prose-note">No task rows are shown until all pinned files and references validate.</p>
          </div>
        </Panel>
      )}
    </section>
  );
}

export function CommandBoardSurface() {
  const [projection, setProjection] = useState<CommandBoardProjection | null>(null);
  useEffect(() => {
    let mounted = true;
    void loadCommandBoard().then((result) => {
      if (mounted) setProjection(result);
    });
    return () => { mounted = false; };
  }, []);

  if (projection) return <CommandBoardView projection={projection} />;
  return (
    <section className="command-stack" aria-label="Command board task projection" data-input={COMMAND_BOARD_SOURCE.input}>
      <Panel title="Command / MODS offline board" count="CHECKING">
        <div className="body"><p className="prose-note">Reading the three pinned offline board assets.</p></div>
      </Panel>
    </section>
  );
}

export { CommandBoardView };
