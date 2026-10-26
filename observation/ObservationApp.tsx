import type { ReactNode } from 'react';
import { useBuildingProjection, useCommandSurface } from '../src/lib/use-command-surface';

function stateTone(state: string): string {
  if (['READY', 'OK', 'AVAILABLE'].includes(state)) return 'good';
  if (['LOADING'].includes(state)) return 'pending';
  return 'unknown';
}

function ProjectionCard({ title, state, detail, children }: {
  title: string;
  state: string;
  detail?: string | null;
  children?: ReactNode;
}) {
  return <section className="projection-card">
    <div className="card-heading">
      <h2>{title}</h2>
      <span className={`state ${stateTone(state)}`}>{state}</span>
    </div>
    {detail && <p className="detail">{detail}</p>}
    {children}
  </section>;
}

function JsonView({ value }: { value: unknown }) {
  return <pre>{value == null ? 'No projection available.' : JSON.stringify(value, null, 2)}</pre>;
}

export function ObservationApp() {
  const command = useCommandSurface(15000);
  const building = useBuildingProjection(30000);

  return <main className="page">
    <header className="masthead">
      <div>
        <p className="eyebrow">STARQ // COMMAND</p>
        <h1>Observation only</h1>
        <p className="subhead">Passive projections from the Command data and Building services.</p>
      </div>
      <div className="profile-stamp" aria-label="Observation-only profile">READ ONLY · NO WORKER ADMISSION</div>
    </header>

    <section className="toolbar" aria-label="Projection refresh">
      <span>Command refreshes every 15 seconds; Building every 30 seconds.</span>
      <button type="button" onClick={() => void command.refresh()} disabled={command.refreshing}>
        {command.refreshing ? 'Reading…' : 'Refresh Command projection'}
      </button>
    </section>

    <div className="grid">
      <ProjectionCard title="Command data projection" state={command.status} detail={command.error}>
        <p className="timestamp">Last read: {command.lastFetchedAt ?? 'not read yet'}</p>
        <JsonView value={command.surface} />
      </ProjectionCard>
      <ProjectionCard title="Building projection" state={building.buildingStatus} detail={building.buildingError}>
        {building.buildingStale && <p className="stale">Displayed Building data is stale.</p>}
        <JsonView value={building.building} />
      </ProjectionCard>
    </div>

    <footer>
      <span>GET / HEAD projections only</span>
      <span>No operational controls are available in this profile.</span>
    </footer>
  </main>;
}
