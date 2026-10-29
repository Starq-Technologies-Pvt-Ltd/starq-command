/**
 * Governed & High-Fidelity PM Kanban Board.
 * Supports multi-agent assignment, governance stages, fidelity metadata,
 * filtering/sorting, structured acceptance criteria, and gated lifecycle operability controls.
 */
import * as React from 'react';
import { Panel, Chip, SourceGap, type Tone } from '@/components/console';
import { PmNav } from '@/surfaces/pm-portfolio';
import {
  PM_STATUSES,
  PM_STATUS_LABELS,
  PM_PRIORITIES,
  pmCreateTask,
  pmIsScratch,
  pmMeta,
  pmPort,
  pmProjects,
  pmTask,
  pmTaskHref,
  pmTasks,
  pmUpdateTask,
  pmLinkRoom,
  pmAddEvidence,
  type PmPriority,
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

interface ParsedAcceptanceItem {
  text: string;
  done?: boolean;
}

function parseAcceptance(rawJson?: string | null, nexusAttr?: Record<string, unknown> | null): ParsedAcceptanceItem[] {
  let raw: any = null;
  if (rawJson) {
    try { raw = JSON.parse(rawJson); } catch { raw = rawJson; }
  } else if (nexusAttr && (nexusAttr as any).acceptance) {
    raw = (nexusAttr as any).acceptance;
  }
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') {
        const isBox = /^-\s*\[[\sx]\]/i.test(item);
        const isChecked = /^-\s*\[x\]/i.test(item);
        const cleanText = isBox ? item.replace(/^-\s*\[[\sx]\]\s*/i, '') : item.replace(/^[-*]\s*/, '');
        return { text: cleanText, done: isBox ? isChecked : undefined };
      }
      if (item && typeof item === 'object') {
        return {
          text: item.text || item.title || item.requirement || item.criterion || JSON.stringify(item),
          done: item.done ?? item.completed ?? item.checked ?? undefined,
        };
      }
      return { text: String(item) };
    });
  }
  if (typeof raw === 'string') {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => {
      const isBox = /^-\s*\[[\sx]\]/i.test(l);
      const isChecked = /^-\s*\[x\]/i.test(l);
      const cleanText = isBox ? l.replace(/^-\s*\[[\sx]\]\s*/i, '') : l.replace(/^[-*]\s*/, '');
      return { text: cleanText, done: isBox ? isChecked : undefined };
    });
  }
  return [{ text: JSON.stringify(raw) }];
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
  const [draft, setDraft] = React.useState({ title: '', owner: 'UNASSIGNED', description: '', priority: 'P2' as PmPriority });

  // Detail edits
  const [editTitle, setEditTitle] = React.useState('');
  const [editOwner, setEditOwner] = React.useState('');
  const [editVerifier, setEditVerifier] = React.useState('');
  const [editPriority, setEditPriority] = React.useState<PmPriority>('P2');
  const [editDescription, setEditDescription] = React.useState('');

  // WP-2 Operability UI dialog states
  const [showLinkRoom, setShowLinkRoom] = React.useState(false);
  const [roomSeq, setRoomSeq] = React.useState('');
  const [roomEventId, setRoomEventId] = React.useState('');
  const [roomPurpose, setRoomPurpose] = React.useState('');

  const [showAddEvidence, setShowAddEvidence] = React.useState(false);
  const [evidencePath, setEvidencePath] = React.useState('');
  const [evidenceSha, setEvidenceSha] = React.useState('');
  const [evidenceDesc, setEvidenceDesc] = React.useState('');

  // Filtering & Sorting
  const [filterPriority, setFilterPriority] = React.useState<string>('ALL');
  const [filterWorker, setFilterWorker] = React.useState<string>('ALL');
  const [filterEpicMilestone, setFilterEpicMilestone] = React.useState<string>('ALL');
  const [filterPhaseSprint, setFilterPhaseSprint] = React.useState<string>('ALL');
  const [filterStage, setFilterStage] = React.useState<string>('ALL');
  const [filterProvenance, setFilterProvenance] = React.useState<string>('ALL');
  const [sortBy, setSortBy] = React.useState<'DEFAULT' | 'PRIORITY' | 'ID' | 'UPDATED'>('DEFAULT');

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
    const retired = new Set(['ali', 'nexus']);
    const active = m.data.handles.filter((h) => !retired.has(h));
    setHandles(active);
    const stored = readActor();
    if (!stored || retired.has(stored)) {
      if (active.includes('antigravity')) setActor('antigravity');
      else if (active[0]) setActor(active[0]);
      else setActor('');
    }
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
        setEditVerifier(d.data.task.verifier || 'UNASSIGNED');
        setEditPriority(d.data.task.priority || 'P2');
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
    setShowLinkRoom(false); setShowAddEvidence(false);
    const d = await pmTask(id);
    if (d.ok) {
      setDetail(d.data);
      setEditTitle(d.data.task.title);
      setEditOwner(d.data.task.owner);
      setEditVerifier(d.data.task.verifier || 'UNASSIGNED');
      setEditPriority(d.data.task.priority || 'P2');
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
    setShowLinkRoom(false); setShowAddEvidence(false);
    setEditTitle(res.data.task.title);
    setEditOwner(res.data.task.owner);
    setEditVerifier(res.data.task.verifier || 'UNASSIGNED');
    setEditPriority(res.data.task.priority || 'P2');
    setEditDescription(res.data.task.description);
    await load(res.data.task.id);
    return true;
  };

  const who = actor;

  const move = async (task: PmTask, to: PmStatus, explicitStage?: string) => {
    if (!who) {
      setErrors(['Select an active handle in "Acting as" before moving cards.']);
      return;
    }
    const isRejecting = (to === 'NEXT' || explicitStage === 'READY') && ['REVIEW', 'VERIFICATION', 'ACCEPTANCE'].includes(task.stage);
    const isBlockedOrGate = to === 'BLOCKED' || explicitStage === 'BLOCKED' || explicitStage === 'FOUNDER_GATE';
    let note: string | undefined;

    if (isRejecting || isBlockedOrGate) {
      const promptMsg = isRejecting
        ? `Rejection note (required, min 5 chars) for returning ${task.id} to READY:`
        : `Reason note (required, min 5 chars) for moving ${task.id} to ${explicitStage || to}:`;
      const entered = window.prompt(promptMsg);
      if (entered === null) return;
      if (entered.trim().length < 5) {
        setErrors(['A note of at least 5 characters is required. Transition aborted.']);
        return;
      }
      note = entered.trim();
    }

    setBusy(true);
    const body: Record<string, unknown> = {
      actor: who,
      expected_updated_at: task.updated_at,
    };
    if (explicitStage) {
      body.stage = explicitStage;
    } else {
      body.status = to;
    }
    if (note) body.note = note;

    const res = await pmUpdateTask(task.id, body);
    await finish(res, `Moved ${task.id} to ${explicitStage ? explicitStage : PM_STATUS_LABELS[to]}.`);
  };

  const create = async () => {
    if (!who) {
      setErrors(['Select an active handle in "Acting as" before creating cards.']);
      return;
    }
    if (draft.title.trim().length < 3) { setErrors(['Title needs at least 3 characters.']); return; }
    setBusy(true);
    await finish(await pmCreateTask({
      project_id: projectId,
      actor: who,
      title: draft.title,
      description: draft.description,
      owner: draft.owner,
      priority: draft.priority,
    }), 'Task added.');
    setDraft({ title: '', owner: 'UNASSIGNED', description: '', priority: 'P2' });
  };

  const save = async () => {
    if (!detail) return;
    if (!who) {
      setErrors(['Select an active handle in "Acting as" before saving edits.']);
      return;
    }
    setBusy(true);
    const t = detail.task;
    const body: Record<string, unknown> = { actor: who, expected_updated_at: t.updated_at };
    if (editTitle !== t.title) body.title = editTitle;
    if (editOwner !== t.owner) body.owner = editOwner;
    if (editVerifier !== t.verifier) body.verifier = editVerifier;
    if (editPriority !== t.priority) body.priority = editPriority;
    if (editDescription !== t.description) body.description = editDescription;
    await finish(await pmUpdateTask(t.id, body), 'Saved.');
  };

  const handleLinkRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!who) {
      setErrors(['Select an active handle in "Acting as" before linking Room authorization.']);
      return;
    }
    const seq = parseInt(roomSeq, 10);
    if (!seq || seq <= 0) { setErrors(['Room sequence must be a positive integer.']); return; }
    if (!/^[a-f0-9]{64}$/i.test(roomEventId.trim())) { setErrors(['Event ID / token must be 64 hex characters.']); return; }
    setBusy(true);
    const res = await pmLinkRoom(detail.task.id, {
      actor: who,
      expected_updated_at: detail.task.updated_at,
      sequence: seq,
      event_id: roomEventId.trim(),
      token: roomEventId.trim(),
      purpose: roomPurpose.trim() || `Authorization for ${detail.task.id}`,
      kind: 'authorization',
    });
    await finish(res, `Linked Room #${seq} authorization.`);
  };

  const handleAddEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!who) {
      setErrors(['Select an active handle in "Acting as" before attaching evidence.']);
      return;
    }
    if (evidenceDesc.trim().length < 5 && !evidencePath.trim()) {
      setErrors(['Evidence requires a description (min 5 chars) or artifact path.']);
      return;
    }
    setBusy(true);
    const res = await pmAddEvidence(detail.task.id, {
      actor: who,
      expected_updated_at: detail.task.updated_at,
      path: evidencePath.trim(),
      sha256: evidenceSha.trim(),
      description: evidenceDesc.trim() || 'Attached verification evidence',
    });
    await finish(res, 'Evidence attached.');
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

  const retired = new Set(['ali', 'nexus']);
  const activeHandles = handles.filter((h) => h !== 'UNASSIGNED' && !retired.has(h));
  const people = ['UNASSIGNED', ...activeHandles];
  const uniqueOwners = [...new Set(tasks.map((t) => t.owner).filter((o) => o && o !== 'UNASSIGNED' && !retired.has(o)))];
  for (const owner of uniqueOwners) if (!people.includes(owner)) people.push(owner);

  // Derive unique filter options
  const allWorkers = [...new Set(tasks.flatMap((t) => (t.workers && t.workers.length ? t.workers : [t.owner])).filter(Boolean))].sort();
  const allStages = [...new Set(tasks.map((t) => t.stage).filter(Boolean))].sort();
  const allEpics = [...new Set(tasks.map((t) => t.epic).filter(Boolean) as string[])].sort();
  const allMilestones = [...new Set(tasks.map((t) => t.milestone).filter(Boolean) as string[])].sort();
  const allEpicsMilestones = [...new Set([...allEpics, ...allMilestones])];
  const allPhaseSprint = [
    ...new Set([
      ...tasks.flatMap((t) => t.phase ? [`phase:${t.phase}`] : []),
      ...tasks.flatMap((t) => t.sprint ? [`sprint:${t.sprint}`] : []),
    ]),
  ].sort();

  // Filter tasks
  const q = query.trim().toLowerCase();
  let visible = tasks.filter((t) => {
    if (q) {
      const matchText = `${t.id} ${t.title} ${t.owner} ${t.status} ${t.stage ?? ''} ${(t.workers || []).join(' ')} ${t.epic ?? ''} ${t.phase ?? ''} ${t.sprint ?? ''} ${t.milestone ?? ''} ${t.commit_sha ?? ''} ${t.pr_ref ?? ''}`.toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    if (filterPriority !== 'ALL' && t.priority !== filterPriority) return false;
    if (filterProvenance === 'LIVE' && t.provenance !== 'LIVE') return false;
    if (filterProvenance === 'HISTORICAL' && t.provenance === 'LIVE') return false;
    if (filterStage !== 'ALL' && t.stage !== filterStage) return false;
    if (filterWorker !== 'ALL') {
      const wList = t.workers && t.workers.length ? t.workers : [t.owner];
      if (!wList.includes(filterWorker)) return false;
    }
    if (filterEpicMilestone !== 'ALL') {
      if (t.epic !== filterEpicMilestone && t.milestone !== filterEpicMilestone) return false;
    }
    if (filterPhaseSprint !== 'ALL') {
      const separator = filterPhaseSprint.indexOf(':');
      const kind = filterPhaseSprint.slice(0, separator);
      const value = filterPhaseSprint.slice(separator + 1);
      if ((kind === 'phase' ? t.phase : t.sprint) !== value) return false;
    }
    return true;
  });

  // Sort tasks
  if (sortBy === 'PRIORITY') {
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    visible = [...visible].sort((a, b) => (pOrder[a.priority] ?? 4) - (pOrder[b.priority] ?? 4));
  } else if (sortBy === 'ID') {
    visible = [...visible].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  } else if (sortBy === 'UPDATED') {
    visible = [...visible].sort((a, b) => Date.parse(b.updated_at || '0') - Date.parse(a.updated_at || '0'));
  }

  return (
    <section className="command-stack" aria-label={`${project.name} project board`} data-pm="board" data-project={projectId}>
      <Panel
        title={project.name}
        count={`${visible.length} of ${tasks.length} cards`}
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
            General DEC-100 ERP implementation freeze was lifted per Founder Room #14394. CP2 HOLD #12690 remains active for payment-command/payment-dispatch scope.
          </p>
        ) : null}

        {/* Action and Search Bar */}
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-2.5">
          <label className="grid min-w-32 gap-1 text-2xs text-muted-foreground">
            Acting as
            <select aria-label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">— choose —</option>
              {people.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
          <label className="grid min-w-40 flex-1 gap-1 text-2xs text-muted-foreground">
            Search
            <input aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, title, owner, epic, worker" />
          </label>
          <button type="button" className="go-link" disabled={busy} onClick={() => { setCreating(true); setSelectedId(null); setDetail(null); }}>New card</button>
          <button type="button" className="go-link" onClick={() => { void load(selectedId); void loadExecution(); }}>Refresh</button>
        </div>

        {/* WP-1 Filter & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/10 px-3 py-2 text-2xs">
          <span className="font-semibold text-muted-foreground">Filter:</span>
          <select aria-label="Filter Priority" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            <option value="ALL">Priority: All</option>
            <option value="P0">P0 (Critical)</option>
            <option value="P1">P1 (High)</option>
            <option value="P2">P2 (Normal)</option>
            <option value="P3">P3 (Low)</option>
          </select>
          <select aria-label="Filter Provenance" value={filterProvenance} onChange={(e) => setFilterProvenance(e.target.value)}>
            <option value="ALL">Provenance: All</option>
            <option value="LIVE">Live Work</option>
            <option value="HISTORICAL">Historical Nexus</option>
          </select>
          <select aria-label="Filter Stage" value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
            <option value="ALL">Stage: All</option>
            {allStages.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select aria-label="Filter Worker" value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)}>
            <option value="ALL">Worker: All</option>
            {allWorkers.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          {allEpicsMilestones.length > 0 ? (
            <select aria-label="Filter Epic/Milestone" value={filterEpicMilestone} onChange={(e) => setFilterEpicMilestone(e.target.value)}>
              <option value="ALL">Epic/Milestone: All</option>
              {allEpicsMilestones.map((em) => <option key={em} value={em}>{em}</option>)}
            </select>
          ) : null}
          {allPhaseSprint.length > 0 ? (
            <select aria-label="Filter Phase/Sprint" value={filterPhaseSprint} onChange={(e) => setFilterPhaseSprint(e.target.value)}>
              <option value="ALL">Phase/Sprint: All</option>
              {allPhaseSprint.map((entry) => (
                <option key={entry} value={entry}>{entry.slice(0, entry.indexOf(':'))}: {entry.slice(entry.indexOf(':') + 1)}</option>
              ))}
            </select>
          ) : null}
          <span className="ml-auto font-semibold text-muted-foreground">Sort:</span>
          <select aria-label="Sort cards" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
            <option value="DEFAULT">Default</option>
            <option value="PRIORITY">Priority (P0 first)</option>
            <option value="ID">ID / Sequence</option>
            <option value="UPDATED">Most Recently Updated</option>
          </select>
        </div>

        {flash ? <p role="status" className="px-3 pt-2 text-xs text-truth-ok">{flash}</p> : null}
        {errors.length && !detail ? <ul role="alert" className="px-3 pt-2 text-xs text-truth-drift">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}

        {creating ? (
          <form className="grid gap-2 border-b border-border p-3" aria-label="New task" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Task title" value={draft.title} maxLength={800} placeholder="Card title" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Owner" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}>
                {people.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <select aria-label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as PmPriority })}>
                {PM_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <textarea aria-label="Description" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Optional description" />
            <div className="flex gap-2">
              <button type="submit" className="go-link" disabled={busy || !actor}>Add card</button>
              <button type="button" className="go-link" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        ) : null}

        {/* Kanban Board Grid */}
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
                  {col.map((t) => {
                    const priorityTone: Tone =
                      t.priority === 'P0' ? 'drift' :
                      t.priority === 'P1' ? 'stale' : 'muted';
                    const priorityDisplay = t.priority_raw && t.priority_raw !== t.priority
                      ? `${t.priority} (${t.priority_raw})`
                      : t.priority;
                    const isLive = t.provenance === 'LIVE';

                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                          aria-pressed={selectedId === t.id}
                          onClick={() => void select(t.id)}
                          className={`w-full rounded border p-2 text-left transition-colors ${
                            selectedId === t.id
                              ? 'border-[hsl(var(--room))] bg-[hsl(var(--room-soft))]'
                              : 'border-border bg-card hover:border-border-hover'
                          }`}
                        >
                          {/* Card Header: ID, Priority, Provenance & Stage Indicator */}
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-mono text-[10px] font-semibold text-[hsl(var(--room))]">{t.id}</span>
                            <div className="flex items-center gap-1">
                              <Chip value={priorityDisplay} tone={priorityTone} />
                              <span className="chip" data-tone={isLive ? 'room' : 'muted'}>
                                {isLive ? 'LIVE' : 'HISTORICAL'}
                              </span>
                            </div>
                          </div>

                          {/* Card Title */}
                          <span className="mt-1 block text-xs font-medium leading-5">{t.title}</span>

                          {/* Epics / Milestones */}
                          {(t.epic || t.milestone) ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.epic ? <span className="chip" data-tone="room">Epic: {t.epic}</span> : null}
                              {t.milestone ? <span className="chip" data-tone="muted">M: {t.milestone}</span> : null}
                            </div>
                          ) : null}
                          {(t.phase || t.sprint || t.commit_sha || t.pr_ref) ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.phase ? <span className="chip" data-tone="muted">Phase: {t.phase}</span> : null}
                              {t.sprint ? <span className="chip" data-tone="muted">Sprint: {t.sprint}</span> : null}
                              {t.commit_sha ? <span className="chip mono" data-tone="room" title={t.commit_sha}>Commit: {t.commit_sha.slice(0, 10)}</span> : null}
                              {t.pr_ref ? <span className="chip mono" data-tone="room">{t.pr_ref}</span> : null}
                            </div>
                          ) : null}

                          {/* Multi-Agent Workers & Governance Stage indicator */}
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-1 border-t border-border pt-1 text-[10px] text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-1">
                              {(t.workers && t.workers.length > 1 ? t.workers : [t.owner]).map((w) => (
                                <span key={w} className="rounded border border-border/70 bg-surface-0/60 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                                  {w}
                                </span>
                              ))}
                            </div>
                            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                              [{t.stage ?? t.status}]
                            </span>
                          </div>

                          {/* Execution Floor Integration */}
                          {executionByTask[t.id] ? (
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-execution-state={executionByTask[t.id].state}>
                              <Chip value={`EXEC ${executionByTask[t.id].state}`} tone={executionByTask[t.id].state === 'BLOCKED' ? 'drift' : 'room'} />
                              <span className="text-[10px] text-muted-foreground">{executionByTask[t.id].builderSeat ?? 'NO BUILDER'} · {executionByTask[t.id].branch ?? 'NO WORKTREE'}</span>
                            </span>
                          ) : t.status === 'IN_PROGRESS' ? (
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-execution-state="NONE">
                              <Chip value="NO EXECUTION RECORD" tone="stale" />
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>

      {/* Task Detail Panel */}
      {detail && selectedId ? (
        <section className="command-panel" aria-label={`Task ${detail.task.id}`} data-task-id={detail.task.id}>
          <div className="head">
            <div className="flex items-center gap-2">
              <h3>{detail.task.id}</h3>
              <Chip
                value={detail.task.provenance === 'LIVE' ? 'LIVE' : 'HISTORICAL'}
                tone={detail.task.provenance === 'LIVE' ? 'room' : 'muted'}
              />
              <Chip value={`STAGE: ${detail.task.stage}`} tone={detail.task.gated ? 'room' : 'muted'} />
            </div>
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
            ) : detail.task.status === 'IN_PROGRESS' ? (
              <Panel title="Software factory execution" count="NO RECORD">
                <div className="body text-2xs text-truth-drift">
                  No execution record for this in-progress task.
                </div>
              </Panel>
            ) : null}

            {errors.length ? <ul role="alert" className="text-xs text-truth-drift">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}

            {/* Structured Stage & Gated Lifecycle Indicator */}
            <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/20 p-2 text-2xs">
              <span className="font-semibold text-muted-foreground">Lifecycle:</span>
              <Chip
                value={detail.task.gated ? 'GATED LIFECYCLE (ENFORCED)' : 'UNGATED (HISTORICAL RECORD)'}
                tone={detail.task.gated ? 'room' : 'muted'}
              />
              {detail.task.prior_stage ? (
                <span className="text-muted-foreground">Prior stage: <strong className="mono text-foreground">{detail.task.prior_stage}</strong></span>
              ) : null}
              {detail.task.room_authorization_ref ? (
                <span className="text-muted-foreground">Room Auth: <strong className="mono text-truth-ok">#{detail.task.room_authorization_ref.sequence}</strong></span>
              ) : null}
            </div>

            {/* Existing Nexus fidelity fields; values remain claims until reconciled. */}
            <dl className="grid grid-cols-2 gap-2 rounded border border-border bg-card/30 p-2 text-2xs sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Epic</dt>
                <dd className="mono font-medium text-foreground">{detail.task.epic || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Phase</dt>
                <dd className="font-medium text-foreground">{detail.task.phase || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sprint</dt>
                <dd className="mono font-medium text-foreground">{detail.task.sprint || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Milestone</dt>
                <dd className="mono font-medium text-foreground">{detail.task.milestone || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Release Track</dt>
                <dd className="mono font-medium text-foreground">{detail.task.release_track || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Lane / Module / Group</dt>
                <dd className="font-medium text-foreground">{[detail.task.lane, detail.task.module, detail.task.task_group].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
            </dl>

            {(detail.task.commit_sha || detail.task.merge_commit || detail.task.commits_json || detail.task.pr_ref || detail.task.pr_url || detail.task.branch || detail.task.worktree) ? (
              <Panel title="GitHub and worktree references" count="REFERENCES ONLY">
                <dl className="body grid grid-cols-1 gap-1 text-2xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Branch</dt><dd className="mono break-all">{detail.task.branch || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Commit</dt><dd className="mono break-all">{detail.task.commit_sha || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Merge commit</dt><dd className="mono break-all">{detail.task.merge_commit || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">PR</dt><dd className="mono break-all">{[detail.task.pr_ref, detail.task.pr_url].filter(Boolean).join(' · ') || '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Worktree</dt><dd className="mono break-all">{detail.task.worktree || '—'}</dd></div>
                  {detail.task.commits_json ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Commit history</dt><dd className="mono break-all">{detail.task.commits_json}</dd></div> : null}
                </dl>
                <p className="px-3 pb-2 text-2xs text-muted-foreground">Stored references only. Repository reconciliation determines whether each commit exists and is integrated.</p>
              </Panel>
            ) : null}

            {/* Multi-Agent Workers Array */}
            <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/60 bg-surface-0/40 p-2 text-2xs">
              <span className="font-semibold text-muted-foreground">Assigned Workers / Team:</span>
              {(detail.task.workers && detail.task.workers.length > 0 ? detail.task.workers : [detail.task.owner]).map((w) => (
                <span key={w} className="chip" data-tone={w === 'UNASSIGNED' ? 'muted' : 'room'}>
                  {w}
                </span>
              ))}
            </div>

            {/* Form Edit Fields */}
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Title
              <input aria-label="Task title" value={editTitle} maxLength={800} onChange={(e) => setEditTitle(e.target.value)} />
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="grid gap-1 text-2xs text-muted-foreground">
                Priority
                <select
                  aria-label="Priority"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as PmPriority)}
                >
                  {PM_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {detail.task.priority_raw && detail.task.priority_raw !== detail.task.priority ? (
                  <span className="text-[10px] text-muted-foreground">Raw: {detail.task.priority_raw}</span>
                ) : null}
              </label>

              <label className="grid gap-1 text-2xs text-muted-foreground">
                Owner
                <input aria-label="Owner" list="kanban-owners" value={editOwner} onChange={(e) => setEditOwner(e.target.value)} />
                <datalist id="kanban-owners">{people.map((h) => <option key={h} value={h} />)}</datalist>
              </label>

              <label className="grid gap-1 text-2xs text-muted-foreground">
                Assign Independent Verifier
                <input
                  aria-label="Independent Verifier"
                  list="kanban-verifiers"
                  value={editVerifier}
                  onChange={(e) => setEditVerifier(e.target.value)}
                  placeholder="UNASSIGNED"
                />
                <datalist id="kanban-verifiers">{people.map((h) => <option key={h} value={h} />)}</datalist>
              </label>
            </div>

            {editOwner !== 'UNASSIGNED' && editOwner === editVerifier ? (
              <p className="text-2xs font-medium text-truth-drift">
                Owner and verifier must be different identities (DEC-072).
              </p>
            ) : null}

            <label className="grid gap-1 text-2xs text-muted-foreground">
              Description
              <textarea aria-label="Description" rows={5} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </label>

            {/* Move Task & Save Actions */}
            {!actor ? (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-2xs text-amber-200">
                Select an active handle in &quot;Acting as&quot; above to move cards, save changes, link Room, or attach evidence.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Move task">
              {detail.task.allowed_next.map((to) => (
                <button key={to} type="button" className="go-link" disabled={busy || !actor} onClick={() => void move(detail.task, to)}>
                  → {PM_STATUS_LABELS[to]}
                </button>
              ))}
              <button type="button" className="go-link font-semibold" disabled={busy || !actor} onClick={() => void save()}>Save Changes</button>
            </div>

            {/* Allowed Governance Stage Moves */}
            {detail.task.allowed_stage_next && detail.task.allowed_stage_next.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-2xs">
                <span className="text-muted-foreground">Advance Stage:</span>
                {detail.task.allowed_stage_next.map((targetStage) => (
                  <button
                    key={targetStage}
                    type="button"
                    className="go-link"
                    disabled={busy || !actor}
                    onClick={() => void move(detail.task, detail.task.status, targetStage)}
                  >
                    → {targetStage}
                  </button>
                ))}
              </div>
            ) : null}

            {/* WP-2 Operability Controls: Link Room & Attach Evidence buttons */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <button
                type="button"
                className="go-link"
                disabled={busy || !actor}
                onClick={() => { setShowLinkRoom(!showLinkRoom); setShowAddEvidence(false); }}
              >
                {showLinkRoom ? 'Cancel Link Room' : 'Link Room Authorization'}
              </button>
              <button
                type="button"
                className="go-link"
                disabled={busy || !actor}
                onClick={() => { setShowAddEvidence(!showAddEvidence); setShowLinkRoom(false); }}
              >
                {showAddEvidence ? 'Cancel Evidence' : 'Attach Evidence'}
              </button>
            </div>

            {/* Link Room Form */}
            {showLinkRoom ? (
              <form onSubmit={handleLinkRoom} className="grid gap-2 rounded border border-border bg-card/40 p-3 text-2xs" aria-label="Link Room Authorization">
                <h4 className="font-semibold text-foreground">Link Room Authorization Record</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    Room Sequence #
                    <input
                      type="number"
                      required
                      placeholder="e.g. 10663"
                      value={roomSeq}
                      onChange={(e) => setRoomSeq(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    Event ID / Token (64 hex characters)
                    <input
                      required
                      placeholder="64-character SHA-256 event ID"
                      value={roomEventId}
                      onChange={(e) => setRoomEventId(e.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-1">
                  Authorization Purpose
                  <input
                    placeholder={`Authorization for ${detail.task.id}`}
                    value={roomPurpose}
                    onChange={(e) => setRoomPurpose(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="go-link" disabled={busy}>Authorize in Room</button>
                  <button type="button" className="go-link" onClick={() => setShowLinkRoom(false)}>Cancel</button>
                </div>
              </form>
            ) : null}

            {/* Attach Evidence Form */}
            {showAddEvidence ? (
              <form onSubmit={handleAddEvidence} className="grid gap-2 rounded border border-border bg-card/40 p-3 text-2xs" aria-label="Attach Evidence">
                <h4 className="font-semibold text-foreground">Attach Verification Evidence</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    Artifact / File Path
                    <input
                      placeholder="e.g. 00_STARQ_HQ/evidence/WP-1.md"
                      value={evidencePath}
                      onChange={(e) => setEvidencePath(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    SHA-256 Digest
                    <input
                      placeholder="SHA-256 checksum or commit SHA"
                      value={evidenceSha}
                      onChange={(e) => setEvidenceSha(e.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-1">
                  Evidence Description / Attestation Note
                  <textarea
                    rows={2}
                    required
                    placeholder="Attestation findings or verification summary (min 5 chars)"
                    value={evidenceDesc}
                    onChange={(e) => setEvidenceDesc(e.target.value)}
                  />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="go-link" disabled={busy}>Record Evidence</button>
                  <button type="button" className="go-link" onClick={() => setShowAddEvidence(false)}>Cancel</button>
                </div>
              </form>
            ) : null}

            {/* Existing Evidence List */}
            {detail.task.evidence_refs && detail.task.evidence_refs.length > 0 ? (
              <Panel title="Linked Evidence Records" count={`${detail.task.evidence_refs.length} record${detail.task.evidence_refs.length === 1 ? '' : 's'}`}>
                <ul className="body grid gap-1.5 text-2xs">
                  {detail.task.evidence_refs.map((ev, idx) => (
                    <li key={idx} className="rounded border border-border/70 p-1.5">
                      <div className="flex items-center justify-between">
                        <span className="mono font-semibold">Room #{ev.sequence}</span>
                        <span className="text-muted-foreground">{ev.senderHandle ?? 'ANON'}</span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{ev.purpose}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {/* Structured Acceptance Criteria Checklist */}
            {(() => {
              const items = parseAcceptance(detail.task.acceptance_json, detail.task.nexus_attributes);
              if (!items.length) return null;
              return (
                <Panel title="Structured Acceptance Criteria" count={`${items.length} criteria`}>
                  <ul className="body grid gap-1.5 text-xs">
                    {items.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border font-mono text-[9px] ${
                          item.done === true
                            ? 'border-truth-ok bg-truth-ok/20 font-bold text-truth-ok'
                            : item.done === false
                              ? 'border-border bg-card text-muted-foreground'
                              : 'border-border text-muted-foreground'
                        }`}>
                          {item.done === true ? '✓' : item.done === false ? '○' : '•'}
                        </span>
                        <span className={item.done ? 'line-through text-muted-foreground' : 'text-foreground'}>
                          {item.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })()}

            {detail.task.notes ? <p className="whitespace-pre-wrap text-2xs text-muted-foreground">{detail.task.notes}</p> : null}

            {/* Dependencies */}
            {detail.task.depends_on.length ? (
              <Panel title="Dependencies" count={`${detail.task.depends_on.length} linked task${detail.task.depends_on.length === 1 ? '' : 's'}`}>
                <ul className="body grid gap-1">
                  {detail.task.depends_on.map((id) => (
                    <li key={id}><a className="go-link" href={pmTaskHref(detail.task.project_id, id)}>{id} →</a></li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {(detail.task.nexus_attributes || detail.task.requirements_json || detail.task.from_decision_json || detail.task.dependencies_json || detail.task.children_json || detail.task.related_json || detail.task.blocked_by_json || detail.task.contributors_json || detail.task.review_note || detail.task.notes_raw || detail.task.evidence_json || detail.task.verification_json) ? (
              <details className="rounded border border-border p-3" data-task-fidelity="">
                <summary className="cursor-pointer text-xs text-muted-foreground">Additional preserved fidelity fields</summary>
                <div className="mt-2 grid gap-2">
                  {([
                    ['Requirements', detail.task.requirements_json],
                    ['Decision links', detail.task.from_decision_json],
                    ['Dependency details', detail.task.dependencies_json],
                    ['Children', detail.task.children_json],
                    ['Related work', detail.task.related_json],
                    ['Blocked by', detail.task.blocked_by_json],
                    ['Contributors', detail.task.contributors_json],
                    ['Evidence details', detail.task.evidence_json],
                    ['Verification details', detail.task.verification_json],
                    ['Review note', detail.task.review_note],
                    ['Raw notes', detail.task.notes_raw],
                  ] as const).filter(([, value]) => value).map(([label, value]) => (
                    <div key={label} className="grid gap-1">
                      <strong className="text-2xs text-muted-foreground">{label}</strong>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-2xs">{value}</pre>
                    </div>
                  ))}
                  {detail.task.nexus_attributes ? (
                    <div className="grid gap-1">
                      <strong className="text-2xs text-muted-foreground">Complete Nexus attributes</strong>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-2xs">{JSON.stringify(detail.task.nexus_attributes, null, 2)}</pre>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}

            {/* Original Nexus Source Payload */}
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
