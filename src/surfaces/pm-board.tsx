/**
 * Writable, human-operated project board backed by the PM service.
 *
 * The existing ProjectBoard is read-only by construction and its lane map has
 * no VERIFICATION or ACCEPTANCE lane, so this surface renders its own lanes in
 * the same visual language. Every rule (transitions, DEC-072, Room references,
 * holds) is enforced by the service; this surface only reports what it says.
 */
import * as React from 'react';
import { Chip, KV, Panel, SourceGap } from '@/components/console';
import { PmNav } from '@/surfaces/pm-portfolio';
import { TaskForm, emptyTaskForm, taskToForm, type TaskFormValues } from '@/components/task-form';
import { MilestonesPanel } from '@/components/milestones-panel';
import {
  PM_STATUSES,
  pmCreateTask,
  pmIsScratch,
  pmPort,
  pmLinkRoom,
  pmMeta,
  pmProjects,
  pmRetryRoomSync,
  pmTask,
  pmTasks,
  pmUpdateTask,
  type PmHistoryRow,
  type PmProject,
  type PmResult,
  type PmStatus,
  type PmTask,
  type PmTaskDetail,
} from '@/lib/pm-client';

function requestedTaskId(): string | null {
  if (typeof window === 'undefined') return null;
  const query = window.location.hash.split('?')[1] ?? '';
  const id = new URLSearchParams(query).get('task');
  return id && /^PM-[A-Z]{2,4}-\d{3,}$/.test(id) ? id : null;
}

const lane = (s: string) => s.replace(/_/g, ' ');
const ACTOR_KEY = 'starq.pm.actor';

function readActor(): string {
  try { return window.localStorage.getItem(ACTOR_KEY) ?? ''; } catch { return ''; }
}
function storeActor(value: string) {
  try { window.localStorage.setItem(ACTOR_KEY, value); } catch { /* convenience only */ }
}

function failureLines(res: Extract<PmResult<unknown>, { ok: false }>): string[] {
  return [`${res.code}: ${res.message}`, ...(res.errors ?? [])];
}

function SyncChip({ row }: { row: PmHistoryRow }) {
  if (row.room_sync === 'POSTED') return <Chip value={`ROOM #${row.room_ref?.sequence ?? '?'}`} tone="ok" />;
  if (row.room_sync === 'PENDING') return <Chip value="ROOM SYNC PENDING" tone="stale" title={row.room_error ?? 'Not posted yet'} />;
  if (row.room_sync === 'DISABLED') return <Chip value="ROOM POST DISABLED" tone="drift" />;
  return <Chip value="LOCAL ONLY" tone="muted" />;
}

function TaskDetailPanel({
  detail, actor, busy, onTransition, onLink, onEdit,
}: {
  detail: PmTaskDetail;
  actor: string;
  busy: boolean;
  onTransition: (move: { to: PmStatus; note: string }) => void;
  onLink: (ref: { sequence: string; eventId: string; purpose: string; kind: 'authorization' | 'evidence' }) => void;
  onEdit: () => void;
}) {
  const { task, history } = detail;
  const [note, setNote] = React.useState('');
  const [ref, setRef] = React.useState({ sequence: '', eventId: '', purpose: '', kind: 'evidence' as 'authorization' | 'evidence' });
  const closed = task.status === 'CLOSED';
  return (
    <section className="command-panel" aria-label={`Task ${task.id}`} data-task-id={task.id}>
      <div className="head">
        <h3>{task.id} · {task.title}</h3>
        <span className="spacer" />
        <Chip value={lane(task.status)} />
        <Chip value={task.priority} tone="muted" />
        {task.pending_room_sync > 0 ? <Chip value={`${task.pending_room_sync} ROOM SYNC PENDING`} tone="stale" /> : null}
      </div>
      <div className="grid gap-3 p-3">
        <KV
          rows={[
            ['Owner', task.owner],
            ['Independent verifier', task.verifier],
            ['Description', task.description || '—'],
            ['Notes', task.notes || '—'],
            ['Depends on', task.depends_on.join(', ') || 'none'],
            ['Created', `${task.created_at} by ${task.created_by}`],
            ['Updated', task.updated_at],
            ['Room authorization', task.room_authorization_ref
              ? `#${task.room_authorization_ref.sequence} · ${task.room_authorization_ref.purpose} · sent by ${task.room_authorization_ref.senderHandle ?? 'UNKNOWN'} (${task.room_authorization_ref.authority_level}) · hash ${task.room_authorization_ref.recordHash?.slice(0, 12) ?? 'UNKNOWN'}…`
              : 'NONE — required before work starts'],
            ['Evidence refs', task.evidence_refs.length
              ? task.evidence_refs.map((r) => `#${r.sequence} ${r.purpose} (sent by ${r.senderHandle ?? 'UNKNOWN'}${r.mentions_task ? ', names this task' : ''})`).join(' · ')
              : 'none'],
          ]}
        />
        {!closed ? (
          <div className="grid gap-2 rounded border border-border p-2">
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Note (required for blocked, Founder gate and rejection)
              <input aria-label="Transition note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Move task">
              {task.allowed_next.map((to) => (
                <button key={to} type="button" className="go-link" disabled={busy || !actor} onClick={() => { onTransition({ to, note }); setNote(''); }}>
                  → {lane(to)}
                </button>
              ))}
              <button type="button" className="go-link" disabled={busy || !actor} onClick={onEdit}>Edit / assign</button>
            </div>
            {!actor ? <p className="text-2xs text-truth-stale">Choose who you are (Acting as) before changing a task. It is attribution only.</p> : null}
            <p className="text-2xs text-muted-foreground">Acceptance needs a linked Room record sent by the assigned verifier, naming this task, posted after VERIFICATION began. Closure needs one from the Founder, posted after ACCEPTANCE began. The actor field is not proof.</p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Closed tasks are immutable.</p>}

        {!closed ? (
          <form
            className="grid gap-2 rounded border border-border p-2"
            aria-label="Link Room reference"
            onSubmit={(e) => { e.preventDefault(); onLink(ref); setRef({ ...ref, sequence: '', eventId: '', purpose: '' }); }}
          >
            <p className="text-2xs text-muted-foreground">Link a Room record as authorization or evidence. The service checks it against the ledger.</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <input aria-label="Room sequence" inputMode="numeric" placeholder="Room sequence" value={ref.sequence} onChange={(e) => setRef({ ...ref, sequence: e.target.value.replace(/\D/g, '') })} />
              <input aria-label="Room event id" className="md:col-span-2" placeholder="Event id (64 hex)" value={ref.eventId} onChange={(e) => setRef({ ...ref, eventId: e.target.value.trim() })} />
              <select aria-label="Reference kind" value={ref.kind} onChange={(e) => setRef({ ...ref, kind: e.target.value as 'authorization' | 'evidence' })}>
                <option value="evidence">evidence</option>
                <option value="authorization">authorization</option>
              </select>
            </div>
            <input aria-label="Reference purpose" placeholder="Purpose (what this record shows)" value={ref.purpose} maxLength={200} onChange={(e) => setRef({ ...ref, purpose: e.target.value })} />
            <div><button type="submit" className="go-link" disabled={busy || !actor || !ref.sequence || !ref.eventId || ref.purpose.trim().length < 3}>Link Room reference</button></div>
          </form>
        ) : null}

        <div>
          <h4 className="label-micro mb-1">History · append-only</h4>
          <ul className="grid gap-1 text-2xs" aria-label="Task history">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-1">
                <span className="mono text-muted-foreground">{h.timestamp}</span>
                <strong>{h.event_type}</strong>
                {h.from_status || h.to_status ? <span>{h.from_status ?? '-'} → {h.to_status ?? '-'}</span> : null}
                <span>by {h.actor}</span>
                <SyncChip row={h} />
                {h.room_error && h.room_sync === 'PENDING' ? <span className="text-truth-stale">last error: {h.room_error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function PmBoardSurface({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<PmProject | null>(null);
  const [tasks, setTasks] = React.useState<PmTask[] | null>(null);
  const [handles, setHandles] = React.useState<string[]>([]);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PmTaskDetail | null>(null);
  const [mode, setMode] = React.useState<'none' | 'create' | 'edit'>('none');
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [actor, setActorState] = React.useState(readActor());
  const [query, setQuery] = React.useState('');
  const timers = React.useRef<number[]>([]);

  const setActor = (value: string) => { setActorState(value); storeActor(value); };

  const load = React.useCallback(async (keepSelected?: string | null) => {
    const [m, p, t] = await Promise.all([pmMeta(), pmProjects(), pmTasks(projectId)]);
    if (!m.ok) { setProblem(m.message); return; }
    if (!p.ok) { setProblem(p.message); return; }
    if (!t.ok) { setProblem(t.message); return; }
    setProblem(null);
    setHandles(m.data.handles);
    setProject(p.data.projects.find((x) => x.id === projectId) ?? null);
    setTasks(t.data.tasks);
    const id = keepSelected && t.data.tasks.some((task) => task.id === keepSelected) ? keepSelected : null;
    setSelectedId(id);
    setDetail(null);
    setErrors(keepSelected && !id ? [`Task ${keepSelected} is not recorded on the ${projectId} board.`] : []);
    if (id) {
      const d = await pmTask(id);
      if (d.ok && d.data.task.project_id === projectId) setDetail(d.data);
      else {
        setSelectedId(null);
        setErrors([d.ok ? `Task ${id} belongs to ${d.data.task.project_id}, not ${projectId}.` : d.message]);
      }
    }
  }, [projectId]);

  React.useEffect(() => {
    setSelectedId(null); setDetail(null); setMode('none'); setTasks(null); setProject(null);
    void load(requestedTaskId());
    const pending = timers.current;
    return () => { pending.forEach((t) => window.clearTimeout(t)); };
  }, [projectId, load]);

  const refreshSoon = (id: string | null) => {
    timers.current.push(window.setTimeout(() => void load(id), 6000));
  };

  const select = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); setMode('none'); return; }
    setSelectedId(id); setMode('none'); setErrors([]);
    const d = await pmTask(id);
    if (d.ok) setDetail(d.data); else setErrors(failureLines(d));
  };

  const finish = async (res: PmResult<PmTaskDetail>, success: string) => {
    setBusy(false);
    if (!res.ok) {
      setErrors(failureLines(res));
      if (res.code === 'STALE_EDIT') await load(selectedId);
      return false;
    }
    setErrors([]); setFlash(success);
    setDetail(res.data); setSelectedId(res.data.task.id); setMode('none');
    await load(res.data.task.id);
    refreshSoon(res.data.task.id);
    return true;
  };

  const create = async (v: TaskFormValues) => {
    setBusy(true);
    const body: Record<string, unknown> = {
      project_id: projectId, actor, title: v.title, description: v.description, priority: v.priority,
      owner: v.owner, verifier: v.verifier, notes: v.notes, depends_on: v.dependsOn,
    };
    if (v.authSequence) body.room_authorization_ref = { sequence: Number(v.authSequence), eventId: v.authEventId, purpose: v.authPurpose };
    await finish(await pmCreateTask(body), 'Task created and saved. Room post queued.');
  };

  const edit = async (v: TaskFormValues) => {
    if (!detail) return;
    setBusy(true);
    const t = detail.task;
    const body: Record<string, unknown> = { actor, expected_updated_at: t.updated_at };
    if (v.title !== t.title) body.title = v.title;
    if (v.description !== t.description) body.description = v.description;
    if (v.priority !== t.priority) body.priority = v.priority;
    if (v.owner !== t.owner) body.owner = v.owner;
    if (v.verifier !== t.verifier) body.verifier = v.verifier;
    if (v.notes !== t.notes) body.notes = v.notes;
    if (JSON.stringify(v.dependsOn) !== JSON.stringify(t.depends_on)) body.depends_on = v.dependsOn;
    await finish(await pmUpdateTask(t.id, body), 'Changes saved.');
  };

  const transition = async ({ to, note }: { to: PmStatus; note: string }) => {
    if (!detail) return;
    setBusy(true);
    const body: Record<string, unknown> = { actor, expected_updated_at: detail.task.updated_at, status: to };
    if (note.trim()) body.note = note.trim();
    await finish(await pmUpdateTask(detail.task.id, body), `Moved to ${lane(to)}.`);
  };

  const link = async (r: { sequence: string; eventId: string; purpose: string; kind: 'authorization' | 'evidence' }) => {
    if (!detail) return;
    setBusy(true);
    await finish(
      await pmLinkRoom(detail.task.id, { actor, expected_updated_at: detail.task.updated_at, sequence: Number(r.sequence), eventId: r.eventId, purpose: r.purpose, kind: r.kind }),
      'Room reference verified and linked.',
    );
  };

  const retry = async () => {
    const res = await pmRetryRoomSync();
    setFlash(res.ok ? 'Room sync retry queued.' : res.message);
    refreshSoon(selectedId);
  };

  if (problem && !tasks) {
    return (
      <section className="command-stack" aria-label="Project board" data-pm="unavailable">
        <Panel title="Project board" count="UNAVAILABLE">
          <PmNav current={projectId as 'command' | 'erp' | 'hoadha'} />
          <SourceGap reason="PM service unavailable." detail={<>{problem} Start it with <code>npm run pm:start</code>. No fallback or historical data is shown.</>} />
        </Panel>
      </section>
    );
  }
  if (!tasks || !project) {
    return (
      <section className="command-stack" aria-label="Project board">
        <Panel title="Project board" count="LOADING"><div className="body"><p className="prose-note">Reading the PM service…</p></div></Panel>
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = tasks.filter((t) => !q || `${t.id} ${t.title} ${t.owner} ${t.verifier} ${t.priority}`.toLowerCase().includes(q));
  const pending = tasks.reduce((n, t) => n + t.pending_room_sync, 0);
  const held = project.hold.state === 'ON_HOLD' || project.hold.state === 'UNKNOWN';

  return (
    <section className="command-stack" aria-label={`${project.name} project board`} data-pm="board" data-project={projectId}>
      <Panel
        title={`${project.name} · project board`}
        count={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        toolbar={(
          <>
            {pmIsScratch() ? <Chip value={`SCRATCH INSTANCE :${pmPort()}`} tone="drift" /> : null}
            <Chip value="WRITABLE · HUMAN-OPERATED" tone="room" />
          </>
        )}
      >
        <PmNav current={projectId as 'command' | 'erp' | 'hoadha'} />
        {held ? (
          <div role="note" className="mx-3 mb-2 rounded border border-border p-2 text-xs">
            <Chip value={project.hold.state} />{' '}
            Tasks can be planned (backlog, ready, blocked, Founder gate) but cannot progress past READY until the Founder lifts the hold. Source: {project.hold.source}.
          </div>
        ) : null}
        {project.source_gap && tasks.length === 0 ? (
          <div className="mx-3 mb-2"><SourceGap reason={`${project.name}: no tasks recorded yet — source gap declared.`} detail={project.source_gap} /></div>
        ) : null}
        {pending > 0 ? (
          <div role="status" className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
            <Chip value={`${pending} ROOM POST(S) PENDING`} tone="stale" /> Changes are saved locally; the Room record has not been written yet.
            <button type="button" className="go-link" onClick={() => void retry()}>Retry Room sync</button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2.5">
          <label className="grid min-w-36 gap-1 text-2xs text-muted-foreground">
            Acting as
            <select aria-label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">— choose —</option>
              {handles.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="grid min-w-44 flex-1 gap-1 text-2xs text-muted-foreground">
            Search
            <input aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, title, owner, priority" />
          </label>
          <button type="button" className="go-link" disabled={!actor || busy} onClick={() => { setMode('create'); setErrors([]); setFlash(null); }}>New task</button>
          <button type="button" className="go-link" onClick={() => void load(selectedId)}>Refresh</button>
        </div>
        {flash ? <p role="status" className="px-3 pt-2 text-xs text-truth-ok">{flash}</p> : null}
        {errors.length && (!detail || !selectedId) ? <ul role="alert" className="px-3 pt-2 text-xs text-truth-drift">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}

        {mode === 'create' ? (
          <div className="border-b border-border">
            <TaskForm mode="create" initial={emptyTaskForm()} handles={handles} busy={busy} errors={errors} onSubmit={(v) => void create(v)} onCancel={() => { setMode('none'); setErrors([]); }} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-3 2xl:grid-cols-5">
          {PM_STATUSES.map((s) => {
            const col = visible.filter((t) => t.status === s);
            return (
              <section key={s} className="min-w-0 rounded border border-border bg-background/40" aria-label={`${lane(s)} lane`} data-lane={s}>
                <header className="flex items-center justify-between border-b border-border bg-card px-2.5 py-2">
                  <h3 className="font-mono text-[10px] font-semibold tracking-wide">{lane(s)}</h3>
                  <span className="chip" data-tone="muted">{col.length}</span>
                </header>
                <ul className="grid max-h-[50vh] content-start gap-1.5 overflow-y-auto p-1.5">
                  {col.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-pressed={selectedId === t.id}
                        onClick={() => void select(t.id)}
                        className={`w-full rounded border p-2 text-left ${selectedId === t.id ? 'border-[hsl(var(--room))] bg-[hsl(var(--room-soft))]' : 'border-border bg-card'}`}
                      >
                        <span className="flex items-start justify-between gap-1">
                          <span className="font-mono text-[10px] text-[hsl(var(--room))]">{t.id}</span>
                          <span className="text-[9px] text-muted-foreground">{t.priority}</span>
                        </span>
                        <span className="mt-1 block text-xs font-medium leading-5">{t.title}</span>
                        <span className="mt-1 flex flex-wrap items-center justify-between gap-1 border-t border-border pt-1 text-[10px] text-muted-foreground">
                          <span>{t.owner}</span>
                          {t.pending_room_sync > 0 ? <span className="text-truth-stale">room sync pending</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>

      <MilestonesPanel projectId={projectId} actor={actor} />

      {detail && selectedId ? (
        mode === 'edit' ? (
          <Panel title={`Edit ${detail.task.id}`}>
            <TaskForm mode="edit" initial={taskToForm(detail.task)} handles={handles} busy={busy} errors={errors} onSubmit={(v) => void edit(v)} onCancel={() => { setMode('none'); setErrors([]); }} />
          </Panel>
        ) : (
          <>
            {errors.length ? <ul role="alert" className="px-3 text-xs text-truth-drift">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            <TaskDetailPanel detail={detail} actor={actor} busy={busy} onTransition={(move) => void transition(move)} onLink={(r) => void link(r)} onEdit={() => { setMode('edit'); setErrors([]); }} />
          </>
        )
      ) : null}
    </section>
  );
}
