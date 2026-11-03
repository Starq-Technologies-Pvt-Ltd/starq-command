/**
 * Project board. Stage is the only move. The selected task opens in a
 * right-side drawer with its own scroll so detail is reachable at 1280×720.
 */
import * as React from 'react';
import { Panel, Chip, type Tone } from '@/components/console';
import { PmEmpty, PmLoading, PmRejected, PmSaved, PmUnavailable } from '@/components/pm-feedback';
import { PmNav } from '@/surfaces/pm-portfolio';
import { readClaimedActor, storeClaimedActor } from '@/lib/acting-as';
import {
  PM_STATUSES,
  PM_STATUS_LABELS,
  PM_PRIORITIES,
  pmCreateMilestone,
  pmCreateTask,
  pmIsScratch,
  pmMeta,
  pmMilestones,
  pmOrg,
  pmPort,
  pmProjects,
  pmTask,
  pmTaskHref,
  pmTasks,
  pmUpdateTask,
  pmLinkRoom,
  pmAddEvidence,
  type PmMilestone,
  type PmOrgPerson,
  type PmPriority,
  type PmStatus,
  type PmProject,
  type PmResult,
  type PmTask,
  type PmTaskDetail,
} from '@/lib/pm-client';
import { refusalFix } from '@/lib/stage-refusal';
import { useAdaptiveKanban, CollapsedColumnStrip } from '@/components/adaptive-kanban';

function requestedTaskId(): string | null {
  if (typeof window === 'undefined') return null;
  const query = window.location.hash.split('?')[1] ?? '';
  const id = new URLSearchParams(query).get('task');
  return id && /^[A-Za-z0-9._:-]{2,40}$/.test(id) ? id : null;
}

const BOARD_STAGES = [
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'REVIEW',
  'VERIFICATION',
  'ACCEPTANCE',
  'CLOSED',
  'BLOCKED',
  'FOUNDER_GATE',
] as const;

const STAGE_COLUMN_LABEL: Record<string, string> = {
  BACKLOG: 'To Do',
  READY: 'Next Up',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'In Progress',
  VERIFICATION: 'In Progress',
  ACCEPTANCE: 'Done',
  CLOSED: 'Done',
  BLOCKED: 'Blocked',
  FOUNDER_GATE: 'Blocked',
};

const DRAWER_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  height: '100vh',
  width: 'min(36rem, 100vw)',
  overflowY: 'auto',
  zIndex: 40,
  background: 'hsl(var(--background))',
};

function columnLabel(stage: string): string {
  return STAGE_COLUMN_LABEL[stage] ?? 'UNKNOWN';
}

function milestoneIdOf(task: PmTask): string {
  const id = (task as PmTask & { milestone_id?: string | null }).milestone_id;
  return typeof id === 'string' ? id : '';
}

function needsNote(task: PmTask, stage: string): boolean {
  const rejecting = stage === 'READY' && (task.stage === 'REVIEW' || task.stage === 'VERIFICATION' || task.stage === 'ACCEPTANCE');
  return rejecting || stage === 'BLOCKED' || stage === 'FOUNDER_GATE';
}

function usablePeople(people: PmOrgPerson[]): PmOrgPerson[] {
  const seen = new Set<string>();
  const out: PmOrgPerson[] = [];
  for (const person of people) {
    if (!person?.handle || person.archived_at || seen.has(person.handle)) continue;
    seen.add(person.handle);
    out.push(person);
  }
  return out;
}

function personOptionLabel(person: PmOrgPerson): string {
  const name = person.display_name && person.display_name !== person.handle
    ? `${person.display_name} (${person.handle})`
    : person.handle;
  return person.kind ? `${name} · ${person.kind}` : name;
}

function refusalOf(res: Extract<PmResult<unknown>, { ok: false }>): { code: string; message: string } {
  const extra = (res.errors ?? []).filter((line) => line && line !== res.message);
  return {
    code: res.code,
    message: extra.length ? `${res.message} ${extra.join(' ')}` : res.message,
  };
}

interface ParsedAcceptanceItem {
  text: string;
  done?: boolean;
}

function parseAcceptance(rawJson?: string | null, nexusAttr?: Record<string, unknown> | null): ParsedAcceptanceItem[] {
  let raw: unknown = null;
  if (rawJson) {
    try { raw = JSON.parse(rawJson); } catch { raw = rawJson; }
  } else if (nexusAttr && (nexusAttr as { acceptance?: unknown }).acceptance) {
    raw = (nexusAttr as { acceptance?: unknown }).acceptance;
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
        const row = item as Record<string, unknown>;
        return {
          text: String(row.text || row.title || row.requirement || row.criterion || JSON.stringify(item)),
          done: (row.done ?? row.completed ?? row.checked) as boolean | undefined,
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

function PersonSelect({
  label,
  ariaLabel,
  value,
  onChange,
  people,
  unavailable,
  includeUnassigned = true,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  people: PmOrgPerson[] | null;
  unavailable: string | null;
  includeUnassigned?: boolean;
}) {
  const name = ariaLabel ?? label;
  if (unavailable) {
    return (
      <label className="grid gap-1 text-2xs text-muted-foreground">
        {label}
        <span className="flex flex-wrap items-center gap-2">
          <select aria-label={name} value={value} disabled>
            <option value={value}>{value || 'UNASSIGNED'}</option>
          </select>
          <PmUnavailable reason={unavailable} />
        </span>
      </label>
    );
  }
  const directory = usablePeople(people ?? []);
  const known = new Set(directory.map((person) => person.handle));
  const extra = value && value !== 'UNASSIGNED' && !known.has(value) ? value : null;
  const selected = directory.find((person) => person.handle === value);
  return (
    <label className="grid gap-1 text-2xs text-muted-foreground">
      {label}
      <span className="flex flex-wrap items-center gap-2">
        <select aria-label={name} value={value} onChange={(e) => onChange(e.target.value)}>
          {includeUnassigned ? <option value="UNASSIGNED">UNASSIGNED</option> : null}
          {directory.map((person) => (
            <option key={person.id || person.handle} value={person.handle}>{personOptionLabel(person)}</option>
          ))}
          {extra ? <option value={extra}>{extra}</option> : null}
        </select>
        {selected?.kind ? <span className="chip" data-person-kind={selected.kind}>{selected.kind}</span> : null}
      </span>
    </label>
  );
}

type ExecutionRecord = {
  state?: string;
  builderSeat?: string;
  verifierSeat?: string;
  herdrSessionId?: string;
  verifierSessionId?: string;
  workspacePath?: string;
  verifierWorkspacePath?: string;
  leaseId?: string;
  candidateSha?: string;
  branch?: string;
};

type RoomTaskReport = {
  task_id: string;
  project_id: string;
  status: string;
  action: string;
  from: string;
  sender_identity_id: string;
  sequence: number;
  event_id: string;
  record_hash: string;
  at: string;
  received_at: string;
  subject: string | null;
};

interface PmBoardGridProps {
  projectId: string;
  tasks: PmTask[];
  visible: PmTask[];
  selectedId: string | null;
  select: (id: string) => void;
  move: (task: PmTask, status: PmStatus) => void;
  executionByTask: Record<string, ExecutionRecord>;
  roomReportByTask: Record<string, RoomTaskReport>;
}

function PmBoardGrid({
  projectId,
  tasks,
  visible,
  selectedId,
  select,
  move,
  executionByTask,
  roomReportByTask,
}: PmBoardGridProps) {
  const countsByStatus = React.useMemo(() => {
    const map: Record<PmStatus, number> = {
      TODO: 0,
      NEXT: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      DONE: 0,
    };
    for (const t of visible) {
      if (map[t.status] !== undefined) {
        map[t.status] += 1;
      }
    }
    return map;
  }, [visible]);

  const {
    isColumnCollapsed,
    toggleColumn,
    desktopGridTemplateColumns,
  } = useAdaptiveKanban(PM_STATUSES, countsByStatus, {
    isDataReady: true,
    navigationKey: projectId,
  });

  return (
    <div
      className="grid grid-cols-1 gap-2 p-2 md:grid-cols-3 xl:grid-cols-5 overflow-x-auto min-w-full"
      style={{ gridTemplateColumns: desktopGridTemplateColumns }}
      data-testid="kanban-grid"
    >
      {PM_STATUSES.map((s) => {
        const col = visible.filter((t) => t.status === s);
        const collapsed = isColumnCollapsed(s);

        if (collapsed) {
          return (
            <CollapsedColumnStrip
              key={s}
              id={s}
              title={PM_STATUS_LABELS[s]}
              count={col.length}
              onToggle={() => toggleColumn(s)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const task = tasks.find((row) => row.id === id);
                if (task && task.status !== s) void move(task, s);
              }}
            />
          );
        }

        return (
          <section
            key={s}
            className="min-w-0 rounded border border-border bg-background/40"
            aria-label={`${PM_STATUS_LABELS[s]} lane`}
            data-lane={s}
            data-collapsed="false"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const task = tasks.find((row) => row.id === id);
              if (task && task.status !== s) void move(task, s);
            }}
          >
            <header
              className="flex items-center justify-between border-b border-border bg-card px-2.5 py-2 cursor-pointer select-none"
              onClick={() => toggleColumn(s)}
              title={`Click to collapse ${PM_STATUS_LABELS[s]} lane`}
            >
              <h3 className="font-mono text-[10px] font-semibold tracking-wide">{PM_STATUS_LABELS[s]}</h3>
              <span className="chip" data-tone="muted">{col.length}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleColumn(s); }}
                aria-expanded="true"
                aria-label={`Collapse ${PM_STATUS_LABELS[s]} lane`}
                title="Collapse column"
                className="text-muted-foreground hover:text-foreground text-[10px] px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                ⇥
              </button>
            </header>
            <ul className="grid max-h-96 content-start gap-1.5 overflow-y-auto p-1.5">
              {col.length === 0 ? (
                <li className="py-8 text-center text-2xs text-muted-foreground/60 italic select-none">
                  No cards in this lane
                </li>
              ) : null}
              {col.map((t) => {
                const priorityTone: Tone =
                  t.priority === 'P0' ? 'drift' :
                  t.priority === 'P1' ? 'stale' : 'muted';
                const priorityDisplay = t.priority_raw && t.priority_raw !== t.priority
                  ? `${t.priority} (${t.priority_raw})`
                  : t.priority;
                const isLive = t.provenance === 'LIVE';
                const cardExecution = executionByTask[t.id];
                const roomReport = roomReportByTask[t.id];
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-pressed={selectedId === t.id}
                      onClick={() => void select(t.id)}
                      className={`w-full rounded border p-2 text-left transition-colors ${
                        selectedId === t.id
                          ? 'border-[hsl(var(--room))] bg-[hsl(var(--room-soft))]'
                          : 'border-border bg-card hover:border-border-hover'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-mono text-[10px] font-semibold text-[hsl(var(--room))]">{t.id}</span>
                        <div className="flex items-center gap-1">
                          <Chip value={priorityDisplay} tone={priorityTone} />
                          <span className="chip" data-tone={isLive ? 'room' : 'muted'}>
                            {isLive ? 'LIVE' : 'HISTORICAL'}
                          </span>
                        </div>
                      </div>
                      <span className="mt-1 block text-xs font-medium leading-5">{t.title}</span>
                      {(t.epic || t.milestone) ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.epic ? <span className="chip" data-tone="room">Epic: {t.epic}</span> : null}
                          {t.milestone ? <span className="chip" data-tone="muted">M: {t.milestone}</span> : null}
                        </div>
                      ) : null}
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
                      {cardExecution ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-execution-state={cardExecution.state}>
                          <Chip value={`EXEC ${cardExecution.state}`} tone={cardExecution.state === 'BLOCKED' ? 'drift' : 'room'} />
                          <span className="text-[10px] text-muted-foreground">{cardExecution.builderSeat ?? 'NO BUILDER'} · {cardExecution.branch ?? 'NO WORKTREE'}</span>
                        </span>
                      ) : t.status === 'IN_PROGRESS' ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-execution-state="NONE">
                          <Chip value="NO EXECUTION RECORD" tone="stale" />
                        </span>
                      ) : null}
                      {roomReport ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border pt-1" data-room-report={roomReport.action} title={`Room event ${roomReport.event_id} · ${roomReport.record_hash}`}>
                          <Chip value={`LAST ROOM REPORT · ${roomReport.status.replaceAll('_', ' ')}`} tone={roomReport.status === 'BLOCKED' ? 'drift' : 'room'} />
                          <span className="text-[10px] text-muted-foreground">@{roomReport.from} · #{roomReport.sequence} · {new Date(roomReport.at).toLocaleString()}</span>
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
  );
}

export function PmBoardSurface({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<PmProject | null>(null);
  const [tasks, setTasks] = React.useState<PmTask[] | null>(null);
  const [orgPeople, setOrgPeople] = React.useState<PmOrgPerson[] | null>(null);
  const [orgProblem, setOrgProblem] = React.useState<string | null>(null);
  const [milestones, setMilestones] = React.useState<PmMilestone[] | null>(null);
  const [milestonesProblem, setMilestonesProblem] = React.useState<string | null>(null);
  const [milestoneTitle, setMilestoneTitle] = React.useState('');
  const [milestoneDue, setMilestoneDue] = React.useState('');
  const [milestoneError, setMilestoneError] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PmTaskDetail | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [clientErrors, setClientErrors] = React.useState<string[]>([]);
  const [refusal, setRefusal] = React.useState<{ code: string; message: string } | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [rereadProblem, setRereadProblem] = React.useState<string | null>(null);
  const [actor, setActorState] = React.useState(readClaimedActor);
  const [query, setQuery] = React.useState('');
  const [draft, setDraft] = React.useState({ title: '', owner: 'UNASSIGNED', description: '', priority: 'P2' as PmPriority });

  const [editTitle, setEditTitle] = React.useState('');
  const [editOwner, setEditOwner] = React.useState('');
  const [editVerifier, setEditVerifier] = React.useState('');
  const [editPriority, setEditPriority] = React.useState<PmPriority>('P2');
  const [editDescription, setEditDescription] = React.useState('');
  const [editMilestoneId, setEditMilestoneId] = React.useState('');

  const [showLinkRoom, setShowLinkRoom] = React.useState(false);
  const [roomSeq, setRoomSeq] = React.useState('');
  const [roomEventId, setRoomEventId] = React.useState('');
  const [roomPurpose, setRoomPurpose] = React.useState('');

  const [showAddEvidence, setShowAddEvidence] = React.useState(false);
  const [evidencePath, setEvidencePath] = React.useState('');
  const [evidenceSha, setEvidenceSha] = React.useState('');
  const [evidenceDesc, setEvidenceDesc] = React.useState('');

  const [filterPriority, setFilterPriority] = React.useState<string>('ALL');
  const [filterWorker, setFilterWorker] = React.useState<string>('ALL');
  const [filterEpicMilestone, setFilterEpicMilestone] = React.useState<string>('ALL');
  const [filterMilestone, setFilterMilestone] = React.useState<string>('ALL');
  const [filterStage, setFilterStage] = React.useState<string>('ALL');
  const [filterProvenance, setFilterProvenance] = React.useState<string>('ALL');
  const [sortBy, setSortBy] = React.useState<'DEFAULT' | 'PRIORITY' | 'ID' | 'UPDATED'>('DEFAULT');

  const [executionByTask, setExecutionByTask] = React.useState<Record<string, { state?: string; builderSeat?: string; verifierSeat?: string; herdrSessionId?: string; verifierSessionId?: string; workspacePath?: string; verifierWorkspacePath?: string; leaseId?: string; candidateSha?: string; branch?: string }>>({});
  const [roomReportByTask, setRoomReportByTask] = React.useState<Record<string, RoomTaskReport>>({});

  const setActor = (value: string) => { setActorState(value); storeClaimedActor(value); };
  const who = actor;

  const fillEdits = (task: PmTask) => {
    setEditTitle(task.title);
    setEditOwner(task.owner || 'UNASSIGNED');
    setEditVerifier(task.verifier || 'UNASSIGNED');
    setEditPriority(task.priority || 'P2');
    setEditDescription(task.description ?? '');
    setEditMilestoneId(milestoneIdOf(task));
  };

  const loadExecution = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/command/tasks?project=${encodeURIComponent(projectId)}`);
      if (!response.ok) return;
      const body = await response.json();
      const next: Record<string, { state?: string; builderSeat?: string; branch?: string }> = {};
      for (const task of body.tasks ?? []) {
        if (task.taskId && task.execution) next[task.taskId] = task.execution;
      }
      setExecutionByTask(next);
    } catch { /* PM remains usable when the execution surface is unavailable. */ }
  }, [projectId]);

  const loadRoomReports = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/comms/task-activity?project_id=${encodeURIComponent(projectId)}`);
      if (!response.ok) return;
      const body = await response.json();
      const next: Record<string, RoomTaskReport> = {};
      for (const report of body.reports ?? []) {
        if (report.task_id && report.project_id === projectId) next[report.task_id] = report;
      }
      setRoomReportByTask(next);
    } catch { /* A Room outage must not alter PM task state. */ }
  }, [projectId]);

  const load = React.useCallback(async (keepSelected?: string | null) => {
    const [m, p, t, orgRes, msRes] = await Promise.all([
      pmMeta(),
      pmProjects(),
      pmTasks(projectId),
      pmOrg(),
      pmMilestones(projectId),
    ]);
    if (!m.ok) { setProblem(m.message); return; }
    if (!p.ok) { setProblem(p.message); return; }
    if (!t.ok) { setProblem(t.message); return; }
    setProblem(null);
    if (!orgRes.ok) {
      setOrgPeople(null);
      setOrgProblem(orgRes.message);
    } else {
      setOrgPeople(Array.isArray(orgRes.data.people) ? orgRes.data.people : []);
      setOrgProblem(null);
    }
    if (!msRes.ok) {
      setMilestones(null);
      setMilestonesProblem(msRes.message);
    } else {
      setMilestones(Array.isArray(msRes.data.milestones) ? msRes.data.milestones : []);
      setMilestonesProblem(null);
    }
    setProject(p.data.projects.find((x) => x.id === projectId) ?? null);
    setTasks(t.data.tasks);
    const id = keepSelected && t.data.tasks.some((task) => task.id === keepSelected) ? keepSelected : null;
    setSelectedId(id);
    setDetail(null);
    setClientErrors(keepSelected && !id ? [`Task ${keepSelected} is not recorded on the ${projectId} board.`] : []);
    if (id) {
      const d = await pmTask(id);
      if (d.ok && d.data.task.project_id === projectId) {
        setDetail(d.data);
        fillEdits(d.data.task);
      } else {
        setSelectedId(null);
        setClientErrors([d.ok ? `Task ${id} belongs to ${d.data.task.project_id}, not ${projectId}.` : d.message]);
      }
    }
  }, [projectId]);

  React.useEffect(() => {
    setSelectedId(null); setDetail(null); setCreating(false); setTasks(null); setProject(null);
    void load(requestedTaskId());
  }, [projectId, load]);

  const createMilestoneRecord = async () => {
    const title = milestoneTitle.trim();
    if (title.length < 2) {
      setMilestoneError('Milestone title needs at least 2 characters.');
      return;
    }
    if (!actor.trim()) {
      setMilestoneError('Choose a claimed actor before creating a milestone.');
      return;
    }
    setBusy(true);
    setMilestoneError(null);
    const res = await pmCreateMilestone({
      actor,
      project_id: projectId,
      title,
      ...(milestoneDue.trim() ? { due_date: milestoneDue.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setSaved(null);
      setMilestoneError(res.message || 'The service rejected the milestone.');
      return;
    }
    setMilestoneTitle('');
    setMilestoneDue('');
    setSaved(`Milestone ${title} is recorded.`);
    await load(selectedId);
  };

  React.useEffect(() => {
    void loadExecution();
    void loadRoomReports();
    const timer = window.setInterval(() => { void loadExecution(); void loadRoomReports(); }, 10000);
    return () => window.clearInterval(timer);
  }, [loadExecution, loadRoomReports]);

  const applyRead = (data: PmTaskDetail, replaceEdits: boolean) => {
    setDetail(data);
    setSelectedId(data.task.id);
    if (replaceEdits) fillEdits(data.task);
  };

  const finishWrite = async (res: PmResult<PmTaskDetail>, success: string, replaceEdits: boolean) => {
    setBusy(false);
    if (!res.ok) {
      setSaved(null);
      setRefusal(refusalOf(res));
      setClientErrors([]);
      return false;
    }
    setRefusal(null);
    setClientErrors([]);
    setSaved(success);
    setCreating(false);
    setShowLinkRoom(false);
    setShowAddEvidence(false);
    const id = res.data.task.id;
    setSelectedId(id);
    const reread = await pmTask(id);
    if (!reread.ok) {
      setRereadProblem(reread.message);
      return true;
    }
    setRereadProblem(null);
    applyRead(reread.data, replaceEdits);
    const fresh = reread.data.task;
    const list = await pmTasks(projectId);
    setTasks((prev) => {
      const base = list.ok ? list.data.tasks : (prev ?? []);
      if (!base.some((task) => task.id === fresh.id)) return [fresh, ...base];
      return base.map((task) => (task.id === fresh.id ? { ...task, ...fresh } : task));
    });
    return true;
  };

  const select = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setDetail(null); return; }
    setSelectedId(id); setCreating(false); setClientErrors([]); setRefusal(null); setSaved(null); setRereadProblem(null);
    setShowLinkRoom(false); setShowAddEvidence(false);
    const d = await pmTask(id);
    if (d.ok) {
      setDetail(d.data);
      fillEdits(d.data.task);
    } else setRefusal(refusalOf(d));
  };

  const closeDrawer = () => {
    setSelectedId(null);
    setDetail(null);
    setRefusal(null);
    setSaved(null);
    setRereadProblem(null);
    setShowLinkRoom(false);
    setShowAddEvidence(false);
  };

  const reloadAndReapply = async () => {
    if (!selectedId) return;
    setBusy(true);
    const d = await pmTask(selectedId);
    setBusy(false);
    if (!d.ok) {
      setRefusal(refusalOf(d));
      return;
    }
    applyRead(d.data, false);
    setRefusal(null);
  };

  const move = async (task: PmTask, stage: string) => {
    if (!who) {
      setClientErrors(['Claimed actor is missing.']);
      return;
    }
    let note: string | undefined;
    if (needsNote(task, stage)) {
      const entered = window.prompt(`Reason note (required, min 5 chars) for moving ${task.id} to ${stage}:`);
      if (entered === null) return;
      if (entered.trim().length < 5) {
        setClientErrors(['A note of at least 5 characters is required. Transition aborted.']);
        return;
      }
      note = entered.trim();
    }
    setBusy(true);
    setSaved(null);
    setRefusal(null);
    const body: Record<string, unknown> = {
      actor: who,
      stage,
      expected_updated_at: task.updated_at,
    };
    if (note) body.note = note;
    await finishWrite(await pmUpdateTask(task.id, body), `Moved ${task.id} to ${stage}.`, false);
  };

  const create = async () => {
    if (!who) {
      setClientErrors(['Claimed actor is missing.']);
      return;
    }
    if (draft.title.trim().length < 3) { setClientErrors(['Title needs at least 3 characters.']); return; }
    setBusy(true);
    setSaved(null);
    setRefusal(null);
    const added = await finishWrite(await pmCreateTask({
      project_id: projectId,
      actor: who,
      title: draft.title,
      description: draft.description,
      owner: draft.owner,
      priority: draft.priority,
    }), 'Task added.', true);
    if (added) setDraft({ title: '', owner: 'UNASSIGNED', description: '', priority: 'P2' });
  };

  const save = async () => {
    if (!detail) return;
    if (!who) {
      setClientErrors(['Claimed actor is missing.']);
      return;
    }
    setBusy(true);
    setSaved(null);
    setRefusal(null);
    const t = detail.task;
    const body: Record<string, unknown> = {
      actor: who,
      expected_updated_at: t.updated_at,
    };
    // The current task update route rejects unknown fields. Send milestone_id
    // only after the milestones route has loaded and the selection changed.
    if (!milestonesProblem && milestones && editMilestoneId !== milestoneIdOf(t)) {
      body.milestone_id = editMilestoneId || null;
    }
    if (editTitle !== t.title) body.title = editTitle;
    if (editOwner !== t.owner) body.owner = editOwner;
    if (editVerifier !== t.verifier) body.verifier = editVerifier;
    if (editPriority !== t.priority) body.priority = editPriority;
    if (editDescription !== t.description) body.description = editDescription;
    await finishWrite(await pmUpdateTask(t.id, body), 'Saved.', true);
  };

  const handleLinkRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!who) {
      setClientErrors(['Claimed actor is missing.']);
      return;
    }
    const seq = parseInt(roomSeq, 10);
    if (!seq || seq <= 0) { setClientErrors(['Room sequence must be a positive integer.']); return; }
    if (!/^[a-f0-9]{64}$/i.test(roomEventId.trim())) { setClientErrors(['Event ID / token must be 64 hex characters.']); return; }
    setBusy(true);
    setSaved(null);
    setRefusal(null);
    const res = await pmLinkRoom(detail.task.id, {
      actor: who,
      expected_updated_at: detail.task.updated_at,
      sequence: seq,
      event_id: roomEventId.trim(),
      token: roomEventId.trim(),
      purpose: roomPurpose.trim() || `Authorization for ${detail.task.id}`,
      kind: 'authorization',
    });
    await finishWrite(res, `Linked Room #${seq} authorization.`, false);
  };

  const handleAddEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (!who) {
      setClientErrors(['Claimed actor is missing.']);
      return;
    }
    if (evidenceDesc.trim().length < 5 && !evidencePath.trim()) {
      setClientErrors(['Evidence requires a description (min 5 chars) or artifact path.']);
      return;
    }
    setBusy(true);
    setSaved(null);
    setRefusal(null);
    const res = await pmAddEvidence(detail.task.id, {
      actor: who,
      expected_updated_at: detail.task.updated_at,
      path: evidencePath.trim(),
      sha256: evidenceSha.trim(),
      description: evidenceDesc.trim() || 'Attached verification evidence',
    });
    await finishWrite(res, 'Evidence attached.', false);
  };

  const directory = usablePeople(orgPeople ?? []);
  const actorOptions = directory.map((person) => person.handle);
  if (actor && !actorOptions.includes(actor)) actorOptions.push(actor);

  const refusalBlock = refusal ? (
    <div className="grid gap-2">
      <PmRejected code={refusal.code} message={refusal.message} fix={refusalFix(refusal.code)} />
      {refusal.code === 'STALE_EDIT' || refusal.code === 'STALE_WRITE' ? (
        <button type="button" className="go-link" onClick={() => void reloadAndReapply()}>Reload and reapply</button>
      ) : null}
    </div>
  ) : null;

  if (problem && !tasks) {
    return (
      <section className="command-stack" aria-label="Project board" data-pm="unavailable">
        <Panel title="Project board" count="UNAVAILABLE">
          <PmNav current={projectId} />
          <div className="body"><PmUnavailable reason={problem} /></div>
        </Panel>
      </section>
    );
  }
  if (!tasks || !project) {
    return (
      <section className="command-stack" aria-label="Project board">
        <Panel title="Project board" count="LOADING">
          <div className="body"><PmLoading label="Reading the board…" /></div>
        </Panel>
      </section>
    );
  }

  const allWorkers = [...new Set(tasks.flatMap((t) => (t.workers && t.workers.length ? t.workers : [t.owner])).filter(Boolean))].sort();
  const allStages = [...new Set(tasks.map((t) => t.stage).filter(Boolean))].sort();
  const allEpics = [...new Set(tasks.map((t) => t.epic).filter(Boolean) as string[])].sort();
  const allMilestones = [...new Set(tasks.map((t) => t.milestone).filter(Boolean) as string[])].sort();
  const allEpicsMilestones = [...new Set([...allEpics, ...allMilestones])];
  const milestoneFilterOptions = new Map<string, string>();
  for (const task of tasks) {
    const id = milestoneIdOf(task);
    if (id) {
      const title = milestones?.find((row) => row.id === id)?.title ?? id;
      milestoneFilterOptions.set(`id:${id}`, title);
    } else if (task.milestone) {
      milestoneFilterOptions.set(`legacy:${task.milestone}`, `${task.milestone} (legacy text)`);
    }
  }

  const q = query.trim().toLowerCase();
  let visible = tasks.filter((t) => {
    if (q) {
      const matchText = `${t.id} ${t.title} ${t.owner} ${t.status} ${t.stage ?? ''} ${(t.workers || []).join(' ')} ${t.epic ?? ''} ${t.milestone ?? ''} ${milestoneIdOf(t)}`.toLowerCase();
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
    if (filterMilestone !== 'ALL') {
      const id = milestoneIdOf(t);
      const key = id ? `id:${id}` : t.milestone ? `legacy:${t.milestone}` : '';
      if (key !== filterMilestone) return false;
    }
    return true;
  });

  if (sortBy === 'PRIORITY') {
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    visible = [...visible].sort((a, b) => (pOrder[a.priority] ?? 4) - (pOrder[b.priority] ?? 4));
  } else if (sortBy === 'ID') {
    visible = [...visible].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  } else if (sortBy === 'UPDATED') {
    visible = [...visible].sort((a, b) => Date.parse(b.updated_at || '0') - Date.parse(a.updated_at || '0'));
  }

  const execution = detail ? executionByTask[detail.task.id] : undefined;

  return (
    <>
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
              DEC-100's administrative implementation hold was lifted by DEC-109 on 29 October 2026; its business-process completion doctrine remains in force. CP2 HOLD #12690 remains scoped to payment-command/payment-dispatch work.
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 border-b border-border p-2.5">
            <label className="grid min-w-32 gap-1 text-2xs text-muted-foreground">
              Claimed actor — not authentication
              <span className="flex flex-wrap items-center gap-2">
                <select aria-label="Claimed actor — not authentication" value={actor} onChange={(e) => setActor(e.target.value)}>
                  {actorOptions.map((handle) => <option key={handle} value={handle}>{handle}</option>)}
                </select>
                {orgProblem ? <PmUnavailable reason={orgProblem} /> : null}
              </span>
            </label>
            <label className="grid min-w-40 flex-1 gap-1 text-2xs text-muted-foreground">
              Search
              <input aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, title, owner, epic, worker" />
            </label>
            <button type="button" className="go-link" disabled={busy} onClick={() => { setCreating(true); setSelectedId(null); setDetail(null); }}>New card</button>
            <button type="button" className="go-link" onClick={() => { void load(selectedId); void loadExecution(); }}>Refresh</button>
          </div>

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
            <select aria-label="Filter milestone" value={filterMilestone} onChange={(e) => setFilterMilestone(e.target.value)}>
              <option value="ALL">Milestone: All</option>
              {[...milestoneFilterOptions.entries()].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {allEpicsMilestones.length > 0 ? (
              <select aria-label="Filter Epic/Milestone" value={filterEpicMilestone} onChange={(e) => setFilterEpicMilestone(e.target.value)}>
                <option value="ALL">Epic/Milestone: All</option>
                {allEpicsMilestones.map((em) => <option key={em} value={em}>{em}</option>)}
              </select>
            ) : null}
            <span className="ml-auto font-semibold text-muted-foreground">Sort:</span>
            <select aria-label="Sort cards" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'DEFAULT' | 'PRIORITY' | 'ID' | 'UPDATED')}>
              <option value="DEFAULT">Default</option>
              <option value="PRIORITY">Priority (P0 first)</option>
              <option value="ID">ID / Sequence</option>
              <option value="UPDATED">Most Recently Updated</option>
            </select>
          </div>

          <form
            aria-label="Create milestone"
            className="flex flex-wrap items-end gap-2 border-b border-border/70 px-3 py-2"
            onSubmit={(event) => { event.preventDefault(); void createMilestoneRecord(); }}
          >
            <label className="grid min-w-48 flex-1 gap-1 text-2xs text-muted-foreground">
              Milestone title
              <input aria-label="Milestone title" value={milestoneTitle} maxLength={120} onChange={(event) => setMilestoneTitle(event.target.value)} />
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Due date
              <input aria-label="Milestone due date" value={milestoneDue} maxLength={40} placeholder="YYYY-MM-DD" onChange={(event) => setMilestoneDue(event.target.value)} />
            </label>
            <button type="submit" className="go-link" disabled={busy}>Create milestone</button>
            {milestoneError ? <span role="alert" className="text-xs text-truth-drift">{milestoneError}</span> : null}
          </form>

          {saved && !detail ? <PmSaved label={saved} /> : null}
          {refusal && !detail ? refusalBlock : null}
          {clientErrors.length && !detail ? <ul role="alert" className="px-3 pt-2 text-xs text-truth-drift">{clientErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}

          {creating ? (
            <form className="grid gap-2 border-b border-border p-3" aria-label="New task" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input aria-label="Task title" value={draft.title} maxLength={800} placeholder="Card title" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <PersonSelect
                  label="Owner"
                  value={draft.owner}
                  onChange={(owner) => setDraft({ ...draft, owner })}
                  people={orgPeople}
                  unavailable={orgProblem}
                />
                <select aria-label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as PmPriority })}>
                  {PM_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <textarea aria-label="Description" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Optional description" />
              <div className="flex gap-2">
                <button type="submit" className="go-link" disabled={busy}>Add card</button>
                <button type="button" className="go-link" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          ) : null}

          {tasks.length === 0 ? <PmEmpty label="No tasks on this board." /> : null}
          {tasks.length > 0 && visible.length === 0 ? <PmEmpty label="No cards match these filters." /> : null}

          <PmBoardGrid
            projectId={projectId}
            tasks={tasks}
            visible={visible}
            selectedId={selectedId}
            select={select}
            move={move}
            executionByTask={executionByTask}
            roomReportByTask={roomReportByTask}
          />
        </Panel>
      </section>

      {detail && selectedId ? (
        <aside
          data-task-drawer=""
          aria-label={`Task ${detail.task.id}`}
          data-task-id={detail.task.id}
          style={DRAWER_STYLE}
        >
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2">
            <h3 className="font-mono text-sm">{detail.task.id}</h3>
            <Chip
              value={detail.task.provenance === 'LIVE' ? 'LIVE' : 'HISTORICAL'}
              tone={detail.task.provenance === 'LIVE' ? 'room' : 'muted'}
            />
            <Chip value={`STAGE: ${detail.task.stage}`} tone={detail.task.gated ? 'room' : 'muted'} />
            <span className="spacer" />
            <button type="button" className="go-link" aria-label="Close task" onClick={closeDrawer}>Close</button>
          </div>

          <div className="grid gap-3 p-3">
            <p data-task-title="" className="text-sm font-medium">{detail.task.title}</p>
            <p data-task-stage="" className="font-mono text-2xs">Stage: {detail.task.stage}</p>
            <p data-derived-column="" className="text-2xs text-muted-foreground">Column: {columnLabel(detail.task.stage)}</p>

            <div className="flex flex-wrap gap-1" role="group" aria-label="Stage">
              {BOARD_STAGES.map((stage) => {
                const enabled = (detail.task.allowed_stage_next ?? []).includes(stage);
                const current = detail.task.stage === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    className="go-link"
                    aria-label={`Move to ${stage}`}
                    aria-current={current ? 'step' : undefined}
                    data-stage={stage}
                    disabled={busy || !enabled}
                    onClick={() => void move(detail.task, stage)}
                  >
                    {stage}
                  </button>
                );
              })}
            </div>

            {saved ? <PmSaved label={saved} /> : null}
            {rereadProblem ? <PmUnavailable reason={rereadProblem} /> : null}
            {refusalBlock}
            {clientErrors.length ? <ul role="alert" className="text-xs text-truth-drift">{clientErrors.map((error) => <li key={error}>{error}</li>)}</ul> : null}

            {execution ? (
              <Panel title="Software factory execution" count={execution.state}>
                <dl className="body grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div><dt className="meta">Builder / verifier</dt><dd className="mono">{execution.builderSeat ?? 'UNKNOWN'} / {execution.verifierSeat ?? 'UNKNOWN'}</dd></div>
                  <div><dt className="meta">Herdr sessions</dt><dd className="mono">{execution.herdrSessionId ?? 'UNKNOWN'} / {execution.verifierSessionId ?? 'NOT ASSIGNED'}</dd></div>
                  <div><dt className="meta">Worktrees</dt><dd className="mono break-all">{execution.workspacePath ?? 'NOT PROVISIONED'}{execution.verifierWorkspacePath ? ` · ${execution.verifierWorkspacePath}` : ''}</dd></div>
                  <div><dt className="meta">Lease / candidate</dt><dd className="mono break-all">{execution.leaseId ?? 'NO LEASE'} / {execution.candidateSha ?? 'NO CANDIDATE'}</dd></div>
                </dl>
              </Panel>
            ) : detail.task.status === 'IN_PROGRESS' ? (
              <Panel title="Software factory execution" count="NO RECORD">
                <div className="body text-2xs text-truth-drift">
                  No execution record for this in-progress task.
                </div>
              </Panel>
            ) : null}

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

            <dl className="grid grid-cols-2 gap-2 rounded border border-border bg-card/30 p-2 text-2xs sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Epic</dt>
                <dd className="mono font-medium text-foreground">{detail.task.epic || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sprint</dt>
                <dd className="mono font-medium text-foreground">{detail.task.sprint || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Legacy milestone</dt>
                <dd className="mono font-medium text-foreground" data-legacy-milestone="">{detail.task.milestone || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Release Track</dt>
                <dd className="mono font-medium text-foreground">{detail.task.release_track || '—'}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/60 bg-surface-0/40 p-2 text-2xs">
              <span className="font-semibold text-muted-foreground">Assigned Workers / Team:</span>
              {(detail.task.workers && detail.task.workers.length > 0 ? detail.task.workers : [detail.task.owner]).map((w) => (
                <span key={w} className="chip" data-tone={w === 'UNASSIGNED' ? 'muted' : 'room'}>{w}</span>
              ))}
            </div>

            <label className="grid gap-1 text-2xs text-muted-foreground">
              Title
              <input aria-label="Task title" value={editTitle} maxLength={800} onChange={(e) => setEditTitle(e.target.value)} />
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="grid gap-1 text-2xs text-muted-foreground">
                Priority
                <select aria-label="Priority" value={editPriority} onChange={(e) => setEditPriority(e.target.value as PmPriority)}>
                  {PM_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {detail.task.priority_raw && detail.task.priority_raw !== detail.task.priority ? (
                  <span className="text-[10px] text-muted-foreground">Raw: {detail.task.priority_raw}</span>
                ) : null}
              </label>
              <PersonSelect
                label="Owner"
                value={editOwner}
                onChange={setEditOwner}
                people={orgPeople}
                unavailable={orgProblem}
              />
              <PersonSelect
                label="Independent Verifier"
                ariaLabel="Independent Verifier"
                value={editVerifier}
                onChange={setEditVerifier}
                people={orgPeople}
                unavailable={orgProblem}
              />
            </div>

            {editOwner !== 'UNASSIGNED' && editOwner === editVerifier ? (
              <p className="text-2xs font-medium text-truth-drift">
                Owner and verifier must be different identities (DEC-072).
              </p>
            ) : null}

            <div className="grid gap-1 text-2xs text-muted-foreground">
              Milestone
              {milestonesProblem ? (
                <PmUnavailable reason={milestonesProblem} />
              ) : (
                <select aria-label="Milestone" value={editMilestoneId} onChange={(e) => setEditMilestoneId(e.target.value)}>
                  <option value="">No milestone</option>
                  {(milestones ?? []).map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
                  {editMilestoneId && !(milestones ?? []).some((row) => row.id === editMilestoneId) ? (
                    <option value={editMilestoneId}>{editMilestoneId}</option>
                  ) : null}
                </select>
              )}
            </div>

            <label className="grid gap-1 text-2xs text-muted-foreground">
              Description
              <textarea aria-label="Description" rows={5} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="go-link font-semibold" disabled={busy} onClick={() => void save()}>Save Changes</button>
              <button
                type="button"
                className="go-link"
                disabled={busy}
                onClick={() => { setShowAddEvidence(!showAddEvidence); setShowLinkRoom(false); }}
              >
                {showAddEvidence ? 'Cancel Evidence' : 'Attach Evidence'}
              </button>
            </div>

            {showAddEvidence ? (
              <form onSubmit={handleAddEvidence} className="grid gap-2 rounded border border-border bg-card/40 p-3 text-2xs" aria-label="Attach Evidence">
                <h4 className="font-semibold text-foreground">Attach Verification Evidence</h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    Artifact / File Path
                    <input placeholder="e.g. 00_STARQ_HQ/evidence/WP-1.md" value={evidencePath} onChange={(e) => setEvidencePath(e.target.value)} />
                  </label>
                  <label className="grid gap-1">
                    SHA-256 Digest
                    <input placeholder="SHA-256 checksum or commit SHA" value={evidenceSha} onChange={(e) => setEvidenceSha(e.target.value)} />
                  </label>
                </div>
                <label className="grid gap-1">
                  Evidence Description / Attestation Note
                  <textarea rows={2} required placeholder="Attestation findings or verification summary (min 5 chars)" value={evidenceDesc} onChange={(e) => setEvidenceDesc(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="go-link" disabled={busy}>Record Evidence</button>
                  <button type="button" className="go-link" onClick={() => setShowAddEvidence(false)}>Cancel</button>
                </div>
              </form>
            ) : null}

            <details data-advanced-room="">
              <summary className="cursor-pointer text-xs text-muted-foreground">Advanced / Room</summary>
              <div className="mt-2 grid gap-2">
                <button
                  type="button"
                  className="go-link"
                  disabled={busy}
                  onClick={() => { setShowLinkRoom(!showLinkRoom); setShowAddEvidence(false); }}
                >
                  {showLinkRoom ? 'Cancel Link Room' : 'Link Room Authorization'}
                </button>
                {showLinkRoom ? (
                  <form onSubmit={handleLinkRoom} className="grid gap-2 rounded border border-border bg-card/40 p-3 text-2xs" aria-label="Link Room Authorization">
                    <h4 className="font-semibold text-foreground">Link Room Authorization Record</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="grid gap-1">
                        Room Sequence #
                        <input type="number" required placeholder="e.g. 10663" value={roomSeq} onChange={(e) => setRoomSeq(e.target.value)} />
                      </label>
                      <label className="grid gap-1">
                        Event ID / Token (64 hex characters)
                        <input required placeholder="64-character SHA-256 event ID" value={roomEventId} onChange={(e) => setRoomEventId(e.target.value)} />
                      </label>
                    </div>
                    <label className="grid gap-1">
                      Authorization Purpose
                      <input placeholder={`Authorization for ${detail.task.id}`} value={roomPurpose} onChange={(e) => setRoomPurpose(e.target.value)} />
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" className="go-link" disabled={busy}>Authorize in Room</button>
                      <button type="button" className="go-link" onClick={() => setShowLinkRoom(false)}>Cancel</button>
                    </div>
                  </form>
                ) : null}
              </div>
            </details>

            <section aria-label="Task timeline" className="grid gap-2">
              <h4 className="text-xs font-semibold">Timeline</h4>
              {detail.history.length === 0 ? <PmEmpty label="No timeline on this record." /> : (
                <ol className="grid gap-2">
                  {detail.history.map((row) => (
                    <li key={row.id} className="rounded border border-border p-2 text-2xs">
                      <div className="font-semibold">{row.event_type}</div>
                      {(row.from_status || row.to_status) ? <div>{row.from_status ?? '—'} → {row.to_status ?? '—'}</div> : null}
                      <div>{row.actor}</div>
                      <time dateTime={row.timestamp}>{row.timestamp}</time>
                      {row.room_ref && row.room_ref.sequence != null ? <div>Room #{row.room_ref.sequence}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
              {detail.task.evidence_refs?.length ? (
                <ul aria-label="Evidence" className="grid gap-1 text-2xs">
                  {detail.task.evidence_refs.map((ev, idx) => (
                    <li key={`${ev.eventId}-${idx}`}>Room #{ev.sequence} · {ev.senderHandle ?? 'UNKNOWN'} · {ev.purpose}</li>
                  ))}
                </ul>
              ) : null}
            </section>

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
                            : 'border-border bg-card text-muted-foreground'
                        }`}>
                          {item.done === true ? '✓' : item.done === false ? '○' : '•'}
                        </span>
                        <span className={item.done ? 'line-through text-muted-foreground' : 'text-foreground'}>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })()}

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
        </aside>
      ) : null}
    </>
  );
}
