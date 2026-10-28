/**
 * Nexus-style writable kanban. Five columns, create/edit/move, no lifecycle gates.
 */
import * as React from 'react';
import { Panel, Chip, SourceGap } from '@/components/console';
import { PmNav } from '@/surfaces/pm-portfolio';
import {
  PM_STATUSES,
  PM_STATUS_LABELS,
  pmCreateTask,
  pmIsScratch,
  pmMeta,
  pmPort,
  pmProjects,
  pmTask,
  pmTaskHref,
  pmTasks,
  pmUpdateTask,
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
  return id && /^[A-Za-z0-9._:-]{2,40}$/.test(id) ? id : null;
}

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

export function PmBoardSurface({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<PmProject | null>(null);
  const [tasks, setTasks] = React.useState<PmTask[] | null>(null);
  const [handles, setHandles] = React.useState<string[]>([]);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PmTaskDetail | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [actor, setActorState] = React.useState(readActor());
  const [query, setQuery] = React.useState('');
  const [draft, setDraft] = React.useState({ title: '', owner: 'UNASSIGNED', description: '' });
  const [editTitle, setEditTitle] = React.useState('');
  const [editOwner, setEditOwner] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [executionByTask, setExecutionByTask] = React.useState<Record<string, any>>({});

  const setActor = (value: string) => { setActorState(value); storeActor(value); };

  const loadExecution = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/command/tasks?project=${encodeURIComponent(projectId)}`);
      if (!response.ok) return;
      const body = await response.json();
      const next: Record<string, any> = {};
      for (const task of body.tasks ?? []) {
        if (task.taskId && task.execution) next[task.taskId] = task.execution;
      }
      setExecutionByTask(next);
    } catch { /* PM remains usable when the execution surface is unavailable. */ }
  }, [projectId]);

  const load = React.useCallback(async (keepSelected?: string | null) => {
    const [m, p, t] = await Promise.all([pmMeta(), pmProjects(), pmTasks(projectId)]);
    if (!m.ok) { setProblem(m.message); return; }
    if (!p.ok) { setProblem(p.message); return; }
    if (!t.ok) { setProblem(t.message); return; }
    setProblem(null);
    const people = m.data.handles;
    setHandles(people);
    if (!readActor() && people.includes('ali')) setActor('ali');
    else if (!readActor() && people[0]) setActor(people[0]);
    setProject(p.data.projects.find((x) => x.id === projectId) ?? null);
    setTasks(t.data.tasks);
    const id = keepSelected && t.data.tasks.some((task) => task.id === keepSelected) ? keepSelected : null;
    setSelectedId(id);
    setDetail(null);
    setErrors(keepSelected && !id ? [`Task ${keepSelected} is not recorded on the ${projectId} board.`] : []);
    if (id) {
      const d = await pmTask(id);
      if (d.ok && d.data.task.project_id === projectId) {
        setDetail(d.data);
        setEditTitle(d.data.task.title);
        setEditOwner(d.data.task.owner);
        setEditDescription(d.data.task.description);
      } else {
        setSelectedId(null);
        setErrors([d.ok ? `Task ${id} belongs to ${d.data.task.project_id}, not ${projectId}.` : d.message]);
      }
    }
  }, [projectId]);

  React.useEffect(() => {
    setSelectedId(null); setDetail(null); setCreating(false); setTasks(null); setProject(null);
    void load(requestedTaskId());
  }, [projectId, load]);

  React.useEffect(() => {
    void loadExecution();
    const timer = window.setInterval(() => void loadExecution(), 10000);
    return () => window.clearInterval(timer);
  }, [loadExecution]);

  const select = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id); setCreating(false); setErrors([]);
    const d = await pmTask(id);
    if (d.ok) {
      setDetail(d.data);
      setEditTitle(d.data.task.title);
      setEditOwner(d.data.task.owner);
      setEditDescription(d.data.task.description);
    } else setErrors(failureLines(d));
  };

  const finish = async (res: PmResult<PmTaskDetail>, success: string) => {
    setBusy(false);
    if (!res.ok) {
      setErrors(failureLines(res));
      if (res.code === 'STALE_EDIT') await load(selectedId);
      return false;
    }
    setErrors([]); setFlash(success);
    setDetail(res.data); setSelectedId(res.data.task.id); setCreating(false);
    setEditTitle(res.data.task.title);
    setEditOwner(res.data.task.owner);
    setEditDescription(res.data.task.description);
    await load(res.data.task.id);
    return true;
  };

  const who = actor || 'ali';

  const move = async (task: PmTask, to: PmStatus) => {
    setBusy(true);
    await finish(await pmUpdateTask(task.id, {
      actor: who, expected_updated_at: task.updated_at, status: to,
    }), `Moved ${task.id} to ${PM_STATUS_LABELS[to]}.`);
  };

  const create = async () => {
    if (draft.title.trim().length < 3) { setErrors(['Title needs at least 3 characters.']); return; }
    setBusy(true);
    await finish(await pmCreateTask({
      project_id: projectId, actor: who, title: draft.title, description: draft.description, owner: draft.owner,
    }), 'Task added.');
    setDraft({ title: '', owner: 'UNASSIGNED', description: '' });
  };

  const save = async () => {
    if (!detail) return;
    setBusy(true);
    const t = detail.task;
    const body: Record<string, unknown> = { actor: who, expected_updated_at: t.updated_at };
    if (editTitle !== t.title) body.title = editTitle;
    if (editOwner !== t.owner) body.owner = editOwner;
    if (editDescription !== t.description) body.description = editDescription;
    await finish(await pmUpdateTask(t.id, body), 'Saved.');
  };

  if (problem && !tasks) {
    return (
      <section className="command-stack" aria-label="Project board" data-pm="unavailable">
        <Panel title="Project board" count="UNAVAILABLE">
          <PmNav current={projectId} />
          <SourceGap reason="PM service unavailable." detail={<>{problem} Start it with <code>npm run os:start</code>.</>} />
        </Panel>
      </section>
    );
  }
  if (!tasks || !project) {
    return (
      <section className="command-stack" aria-label="Project board">
        <Panel title="Project board" count="LOADING"><div className="body"><p className="prose-note">Reading the board…</p></div></Panel>
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = tasks.filter((t) => !q || `${t.id} ${t.title} ${t.owner} ${t.status}`.toLowerCase().includes(q));
  const people = ['UNASSIGNED', ...handles.filter((h) => h !== 'UNASSIGNED')];
  const uniqueOwners = [...new Set(tasks.map((t) => t.owner).filter((o) => o && o !== 'UNASSIGNED'))];
  for (const owner of uniqueOwners) if (!people.includes(owner)) people.push(owner);

  return (
    <section className="command-stack" aria-label={`${project.name} project board`} data-pm="board" data-project={projectId}>
      <Panel
        title={project.name}
        count={`${tasks.length} cards`}
        toolbar={(
          <>
            {pmIsScratch() ? <Chip value={`SCRATCH :${pmPort()}`} tone="drift" /> : null}
            <Chip value="KANBAN" tone="room" />
          </>
        )}
      >
        <PmNav current={projectId} />
        {project.id === 'erp' ? (
          <p className="mx-3 mb-2 text-2xs text-muted-foreground">
            DEC-100 still holds ERP implementation. This board is the working record — move cards as you used to in Nexus.
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2.5">
          <label className="grid min-w-36 gap-1 text-2xs text-muted-foreground">
            Acting as
            <select aria-label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">— choose —</option>
              {people.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="grid min-w-44 flex-1 gap-1 text-2xs text-muted-foreground">
            Search
            <input aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, title, owner" />
          </label>
          <button type="button" className="go-link" disabled={busy} onClick={() => { setCreating(true); setSelectedId(null); setDetail(null); }}>New card</button>
          <button type="button" className="go-link" onClick={() => { void load(selectedId); void loadExecution(); }}>Refresh</button>
        </div>
        {flash ? <p role="status" className="px-3 pt-2 text-xs text-truth-ok">{flash}</p> : null}
        {errors.length && !detail ? <ul role="alert" className="px-3 pt-2 text-xs text-truth-drift">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}

        {creating ? (
          <form className="grid gap-2 border-b border-border p-3" aria-label="New task" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Task title" value={draft.title} maxLength={800} placeholder="Card title" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <select aria-label="Owner" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}>
              {people.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <textarea aria-label="Description" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Optional description" />
            <div className="flex gap-2">
              <button type="submit" className="go-link" disabled={busy}>Add card</button>
              <button type="button" className="go-link" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        ) : null}

        <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-3 xl:grid-cols-5">
          {PM_STATUSES.map((s) => {
            const col = visible.filter((t) => t.status === s);
            return (
              <section
                key={s}
                className="min-w-0 rounded border border-border bg-background/40"
                aria-label={`${PM_STATUS_LABELS[s]} lane`}
                data-lane={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain');
                  const task = tasks.find((row) => row.id === id);
                  if (task && task.status !== s) void move(task, s);
                }}
              >
                <header className="flex items-center justify-between border-b border-border bg-card px-2.5 py-2">
                  <h3 className="font-mono text-[10px] font-semibold tracking-wide">{PM_STATUS_LABELS[s]}</h3>
                  <span className="chip" data-tone="muted">{col.length}</span>
                </header>
                <ul className="grid max-h-[55vh] content-start gap-1.5 overflow-y-auto p-1.5">
                  {col.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                        aria-pressed={selectedId === t.id}
                        onClick={() => void select(t.id)}
                        className={`w-full rounded border p-2 text-left ${selectedId === t.id ? 'border-[hsl(var(--room))] bg-[hsl(var(--room-soft))]' : 'border-border bg-card'}`}
                      >
                        <span className="flex items-start justify-between gap-1">
                          <span className="font-mono text-[10px] text-[hsl(var(--room))]">{t.id}</span>
                        </span>
                        <span className="mt-1 block text-xs font-medium leading-5">{t.title}</span>
                        <span className="mt-1 block border-t border-border pt-1 text-[10px] text-muted-foreground">{t.owner}</span>
                        {executionByTask[t.id] ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-execution-state={executionByTask[t.id].state}>
                            <Chip value={`EXEC ${executionByTask[t.id].state}`} tone={executionByTask[t.id].state === 'BLOCKED' ? 'drift' : 'room'} />
                            <span className="text-[10px] text-muted-foreground">{executionByTask[t.id].builderSeat ?? 'NO BUILDER'} · {executionByTask[t.id].branch ?? 'NO WORKTREE'}</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>

      {detail && selectedId ? (
        <section className="command-panel" aria-label={`Task ${detail.task.id}`} data-task-id={detail.task.id}>
          <div className="head">
            <h3>{detail.task.id}</h3>
            <span className="spacer" />
            <Chip value={PM_STATUS_LABELS[detail.task.status]} />
          </div>
          <div className="grid gap-3 p-3">
            {executionByTask[detail.task.id] ? (
              <Panel title="Software factory execution" count={executionByTask[detail.task.id].state}>
                <dl className="body grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div><dt className="meta">Builder / verifier</dt><dd className="mono">{executionByTask[detail.task.id].builderSeat ?? 'UNKNOWN'} / {executionByTask[detail.task.id].verifierSeat ?? 'UNKNOWN'}</dd></div>
                  <div><dt className="meta">Herdr sessions</dt><dd className="mono">{executionByTask[detail.task.id].herdrSessionId ?? 'UNKNOWN'} / {executionByTask[detail.task.id].verifierSessionId ?? 'NOT ASSIGNED'}</dd></div>
                  <div><dt className="meta">Worktrees</dt><dd className="mono break-all">{executionByTask[detail.task.id].workspacePath ?? 'NOT PROVISIONED'}{executionByTask[detail.task.id].verifierWorkspacePath ? ` · ${executionByTask[detail.task.id].verifierWorkspacePath}` : ''}</dd></div>
                  <div><dt className="meta">Lease / candidate</dt><dd className="mono break-all">{executionByTask[detail.task.id].leaseId ?? 'NO LEASE'} / {executionByTask[detail.task.id].candidateSha ?? 'NO CANDIDATE'}</dd></div>
                </dl>
              </Panel>
            ) : null}
            {errors.length ? <ul role="alert" className="text-xs text-truth-drift">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Title
              <input aria-label="Task title" value={editTitle} maxLength={800} onChange={(e) => setEditTitle(e.target.value)} />
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Owner
              <input aria-label="Owner" list="kanban-owners" value={editOwner} onChange={(e) => setEditOwner(e.target.value)} />
              <datalist id="kanban-owners">{people.map((h) => <option key={h} value={h} />)}</datalist>
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Description
              <textarea aria-label="Description" rows={6} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Move task">
              {detail.task.allowed_next.map((to) => (
                <button key={to} type="button" className="go-link" disabled={busy} onClick={() => void move(detail.task, to)}>
                  → {PM_STATUS_LABELS[to]}
                </button>
              ))}
              <button type="button" className="go-link" disabled={busy} onClick={() => void save()}>Save</button>
            </div>
            {detail.task.notes ? <p className="whitespace-pre-wrap text-2xs text-muted-foreground">{detail.task.notes}</p> : null}
            {detail.task.depends_on.length ? (
              <Panel title="Dependencies" count={`${detail.task.depends_on.length} linked task${detail.task.depends_on.length === 1 ? '' : 's'}`}>
                <ul className="body grid gap-1">
                  {detail.task.depends_on.map((id) => (
                    <li key={id}><a className="go-link" href={pmTaskHref(detail.task.project_id, id)}>{id} →</a></li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            {detail.source_record ? (
              <details className="rounded border border-border p-3" data-nexus-source-record="">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Original Nexus record · {detail.source_record.source_file} row {detail.source_record.source_row_index + 1} · status {detail.source_record.raw_status ?? 'UNKNOWN'}
                </summary>
                <p className="mt-2 break-all font-mono text-2xs text-muted-foreground">
                  Source SHA-256 {detail.source_record.source_file_sha256}<br />
                  Record SHA-256 {detail.source_record.payload_sha256}
                </p>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-2xs text-muted-foreground">
                  {JSON.stringify(detail.source_record.raw_payload, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
