import * as React from 'react';
import { Panel, Chip, SourceGap } from '@/components/console';
import {
  commandDispatchPreview,
  commandDispatchNext,
  commandTasks,
  commandRecover,
  commandVerificationStart,
  commandBuilderCompletion,
  commandVerify,
  commandPmClose,
  commandWorkforce,
  commandCapacity,
  commandStuck,
  commandStuckEscalate,
  commandRoomEvents,
  type CommandTaskItem,
  type DispatchPreviewData,
  type WorkforceData,
  type CapacityData,
  type StuckTaskItem,
  type RoomEventItem,
} from '@/lib/command-client';
import { pmRetryRoomSync } from '@/lib/pm-client';

export function SoftwareFactorySurface() {
  const [loading, setLoading] = React.useState(true);
  const [unavailableReason, setUnavailableReason] = React.useState<string | null>(null);
  const [tasks, setTasks] = React.useState<CommandTaskItem[]>([]);
  const [preview, setPreview] = React.useState<DispatchPreviewData | null>(null);
  const [workforce, setWorkforce] = React.useState<WorkforceData | null>(null);
  const [capacity, setCapacity] = React.useState<CapacityData | null>(null);
  const [stuck, setStuck] = React.useState<StuckTaskItem[]>([]);
  const [events, setEvents] = React.useState<RoomEventItem[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Active sub-view tab
  const [tab, setTab] = React.useState<'DISPATCH' | 'EXECUTIONS' | 'WORKFORCE' | 'CAPACITY' | 'STUCK' | 'EVENTS'>('DISPATCH');

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [tRes, pRes, wRes, cRes, sRes, eRes] = await Promise.all([
        commandTasks(),
        commandDispatchPreview(),
        commandWorkforce(),
        commandCapacity(),
        commandStuck(),
        commandRoomEvents(),
      ]);

      if (!pRes.ok && pRes.status === 503) {
        setUnavailableReason(pRes.error || 'PM execution bridge is not initialized.');
      } else {
        setUnavailableReason(null);
      }

      if (tRes.ok && tRes.data) setTasks(tRes.data.tasks || []);
      if (pRes.ok && pRes.data) setPreview(pRes.data);
      if (wRes.ok && wRes.data) setWorkforce(wRes.data);
      if (cRes.ok && cRes.data) setCapacity(cRes.data);
      if (sRes.ok && sRes.data) setStuck(sRes.data.stuckTasks || []);
      if (eRes.ok && eRes.data) setEvents(eRes.data.events || []);
    } catch (err: any) {
      setUnavailableReason(err.message || 'Service unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => void loadAll(), 8000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  const handleDispatchNext = async () => {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await commandDispatchNext();
      if (res.ok) {
        setStatusMsg(`Dispatched task ${res.data?.taskId || 'successfully'}.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || `Dispatch refused: ${res.state || 'UNKNOWN'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async (taskId: string) => {
    const reason = window.prompt(`Reason for worktree recovery on ${taskId} (min 5 chars):`);
    if (!reason || reason.trim().length < 5) {
      setErrorMsg('Recovery requires an explicit reason of at least 5 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await commandRecover(taskId, reason.trim());
      if (res.ok) {
        setStatusMsg(`Worktree recovery initiated for ${taskId}.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'Recovery failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStartVerification = async (taskId: string) => {
    setBusy(true);
    try {
      const res = await commandVerificationStart(taskId);
      if (res.ok) {
        setStatusMsg(`Verification started for ${taskId}.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'Verification start failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBuilderCompletion = async (task: CommandTaskItem) => {
    const candidateSha = window.prompt(`Candidate commit SHA for ${task.taskId}:`);
    if (!candidateSha || candidateSha.trim().length < 7) {
      setErrorMsg('A valid candidate commit SHA is required.');
      return;
    }
    const builderSeat = (task.execution?.builderSeat as string) || 'antigravity';
    setBusy(true);
    try {
      const res = await commandBuilderCompletion(task.taskId, {
        builderSeat,
        candidateSha: candidateSha.trim(),
        diffStat: { filesCount: 1, insertions: 10, deletions: 2 },
        testEvidence: `Builder verification passing for ${task.taskId}`,
      });
      if (res.ok) {
        setStatusMsg(`Builder completion submitted for ${task.taskId}.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'Builder completion rejected.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (task: CommandTaskItem, result: 'PASS' | 'FAIL') => {
    const notes = window.prompt(`Independent verification ${result} notes for ${task.taskId}:`, result === 'PASS' ? 'Acceptance verified against spec' : 'Verification findings');
    if (!notes || notes.trim().length < 5) {
      setErrorMsg('Verification notes of at least 5 characters required.');
      return;
    }
    const verifierSeat = (task.execution?.verifierSeat as string) || 'claude';
    setBusy(true);
    try {
      const res = await commandVerify(task.taskId, {
        verifierSeat,
        result,
        evaluatedSha: (task.execution?.candidateSha as string) || (task.execution?.baseSha as string) || '0000000',
        verdictNotes: notes.trim(),
        findings: result === 'FAIL' ? [{ severity: 'BLOCKER', description: notes.trim() }] : [],
      });
      if (res.ok) {
        setStatusMsg(`Task ${task.taskId} ${result === 'PASS' ? 'ACCEPTED' : 'REJECTED'} by ${verifierSeat}.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'Verification verdict rejected.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePmClose = async (taskId: string) => {
    setBusy(true);
    try {
      const res = await commandPmClose(taskId, 'mustarq');
      if (res.ok) {
        setStatusMsg(`Task ${taskId} closed to PM.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'PM close failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEscalateStuck = async (taskId: string) => {
    setBusy(true);
    try {
      const res = await commandStuckEscalate(taskId);
      if (res.ok) {
        setStatusMsg(`Stuck task ${taskId} escalated to Room.`);
        await loadAll();
      } else {
        setErrorMsg(res.error || 'Escalation failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRetryRoomSync = async () => {
    setBusy(true);
    try {
      const res = await pmRetryRoomSync();
      if (res.ok) {
        setStatusMsg(`Room sync queued. Pending: ${res.data.pending_room_sync}`);
      } else {
        setErrorMsg(res.message || 'Room sync retry failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="command-stack" aria-label="Software Factory Surface" data-surface="software-factory">
      <Panel
        title="Software Factory"
        count={unavailableReason ? 'UNAVAILABLE' : (loading ? 'Loading...' : `${tasks.length} live tasks`)}
        toolbar={(
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="go-link"
              disabled={busy}
              onClick={() => void handleRetryRoomSync()}
              title="Retry pending Room delivery synchronizations"
            >
              Retry Room Sync
            </button>
            <button
              type="button"
              className="go-link"
              disabled={busy}
              onClick={() => void loadAll()}
            >
              Refresh
            </button>
          </div>
        )}
      >
        {unavailableReason ? (
          <div className="p-3">
            <SourceGap
              reason={unavailableReason}
              detail="The Command execution bridge (:5179) is unavailable or not initialized. Start it via npm run os:start or check Start-Starq."
            />
          </div>
        ) : null}

        {statusMsg ? <p role="status" className="px-3 pt-2 text-xs text-truth-ok">{statusMsg}</p> : null}
        {errorMsg ? <p role="alert" className="px-3 pt-2 text-xs text-truth-drift">{errorMsg}</p> : null}

        {/* Sub-navigation tabs */}
        <nav className="flex flex-wrap items-center gap-2 border-b border-border bg-card/20 px-3 py-2 text-2xs" aria-label="Factory Views">
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'DISPATCH' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('DISPATCH')}
          >
            Dispatch ({preview?.eligible.length ?? 0} ready)
          </button>
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'EXECUTIONS' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('EXECUTIONS')}
          >
            Executions ({tasks.length})
          </button>
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'WORKFORCE' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('WORKFORCE')}
          >
            Workforce ({workforce?.seats.length ?? 0})
          </button>
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'CAPACITY' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('CAPACITY')}
          >
            Capacity ({capacity?.capacity.length ?? 0})
          </button>
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'STUCK' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('STUCK')}
          >
            Stuck ({stuck.length})
          </button>
          <button
            type="button"
            className={`font-mono px-2 py-0.5 rounded ${tab === 'EVENTS' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setTab('EVENTS')}
          >
            Events ({events.length})
          </button>
        </nav>

        {/* TAB 1: DISPATCH PREVIEW & ACTIONS */}
        {tab === 'DISPATCH' ? (
          <div className="grid gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-card/30 p-2.5">
              <div>
                <h4 className="text-xs font-semibold">Autonomous & Governed Dispatch</h4>
                <p className="text-2xs text-muted-foreground">
                  Evaluates READY tasks against verified worker capabilities and Herdr session readiness.
                </p>
              </div>
              <button
                type="button"
                className="go-link font-semibold"
                disabled={busy || Boolean(unavailableReason) || !preview?.eligible.length}
                onClick={() => void handleDispatchNext()}
              >
                Dispatch Next Ready Task →
              </button>
            </div>

            {/* Eligible tasks */}
            <div className="space-y-2">
              <h5 className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                Eligible for Dispatch ({preview?.eligible.length ?? 0})
              </h5>
              {preview?.eligible.length ? (
                <ul className="grid gap-2">
                  {preview.eligible.map((cand) => (
                    <li key={cand.taskId} className="rounded border border-border bg-card p-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-mono font-semibold text-[hsl(var(--room))]">{cand.taskId}</span>
                        <div className="flex items-center gap-1.5">
                          <Chip value={`ASSIGN TO: ${cand.worker}`} tone="room" />
                          <span className="font-mono text-2xs text-muted-foreground">session {cand.sessionId}</span>
                        </div>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 gap-1 text-2xs sm:grid-cols-2 text-muted-foreground font-mono">
                        <div>Repo: {cand.repository || 'UNKNOWN'} ({cand.baseSha?.slice(0, 7) || 'NO SHA'})</div>
                        <div>Target Branch: {cand.worktreeBranch || 'DEFAULT'}</div>
                        <div className="sm:col-span-2">Worktree: {cand.worktreePath || 'D:\\StarqTech\\_worktrees'}</div>
                      </div>
                      {cand.requiredCapabilities.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <span className="text-2xs text-muted-foreground">Capabilities:</span>
                          {cand.requiredCapabilities.map((cap) => (
                            <span key={cap} className="rounded border border-border/70 px-1 py-0.2 font-mono text-[9px]">{cap}</span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded border border-border/50 p-2 text-2xs text-muted-foreground">
                  No tasks currently eligible for dispatch. Verify task READY state and worker idle readiness.
                </p>
              )}
            </div>

            {/* Blocked tasks */}
            {preview?.blocked.length ? (
              <div className="space-y-2">
                <h5 className="font-mono text-2xs uppercase tracking-wider text-truth-drift">
                  Blocked from Dispatch ({preview.blocked.length})
                </h5>
                <ul className="grid gap-1.5 text-2xs">
                  {preview.blocked.map((b) => (
                    <li key={b.taskId} className="flex items-center justify-between rounded border border-truth-drift/30 bg-truth-drift/10 p-2">
                      <span className="font-mono font-semibold text-foreground">{b.taskId}</span>
                      <span className="text-truth-drift font-mono">{b.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* TAB 2: LIVE EXECUTIONS & WORKTREES */}
        {tab === 'EXECUTIONS' ? (
          <div className="p-3">
            {tasks.length ? (
              <ul className="grid gap-3">
                {tasks.map((task) => {
                  const exec = task.execution;
                  const execState = exec?.state || 'NONE';
                  const isBlocked = execState === 'BLOCKED';
                  return (
                    <li key={task.taskId} className="rounded border border-border bg-card p-3 text-xs" data-task-execution={task.taskId}>
                      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border/70 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[hsl(var(--room))]">{task.taskId}</span>
                          <span className="font-medium text-foreground">{task.title}</span>
                        </div>
                        {/* Governance Stage and Execution State SIDE-BY-SIDE per P-7 */}
                        <div className="flex items-center gap-1.5">
                          <Chip value={`STAGE: ${task.stage}`} tone="muted" />
                          <Chip value={`EXEC: ${execState}`} tone={isBlocked ? 'drift' : 'room'} />
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-2xs font-mono text-muted-foreground">
                        <div>Builder: <strong className="text-foreground">{exec?.builderSeat || 'UNASSIGNED'}</strong></div>
                        <div>Verifier: <strong className="text-foreground">{exec?.verifierSeat || 'UNASSIGNED'}</strong></div>
                        <div>Herdr Session: {exec?.herdrSessionId || 'NONE'}</div>
                        <div>Lease: {exec?.leaseId || 'NO LEASE'}</div>
                        <div>Branch: {exec?.branch || 'NONE'}</div>
                        <div>Candidate SHA: {exec?.candidateSha || 'NONE'}</div>
                        <div className="sm:col-span-2 break-all">Worktree: {exec?.workspacePath || 'NOT PROVISIONED'}</div>
                      </div>

                      {/* Execution Actions */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                        <button
                          type="button"
                          className="go-link font-semibold"
                          disabled={busy || Boolean(unavailableReason)}
                          onClick={() => void handleRecover(task.taskId)}
                        >
                          Recover Worktree
                        </button>

                        {['ALLOCATED', 'IN_PROGRESS'].includes(execState) ? (
                          <button
                            type="button"
                            className="go-link"
                            disabled={busy || Boolean(unavailableReason)}
                            onClick={() => void handleBuilderCompletion(task)}
                          >
                            Submit Builder Completion →
                          </button>
                        ) : null}

                        {execState === 'BUILDER_COMPLETE' ? (
                          <button
                            type="button"
                            className="go-link"
                            disabled={busy || Boolean(unavailableReason)}
                            onClick={() => void handleStartVerification(task.taskId)}
                          >
                            Start Verification →
                          </button>
                        ) : null}

                        {['IN_VERIFICATION', 'BUILDER_COMPLETE'].includes(execState) ? (
                          <>
                            <button
                              type="button"
                              className="go-link text-truth-ok font-semibold"
                              disabled={busy || Boolean(unavailableReason)}
                              onClick={() => void handleVerify(task, 'PASS')}
                            >
                              Verify ACCEPT ✓
                            </button>
                            <button
                              type="button"
                              className="go-link text-truth-drift font-semibold"
                              disabled={busy || Boolean(unavailableReason)}
                              onClick={() => void handleVerify(task, 'FAIL')}
                            >
                              Verify REJECT ✗
                            </button>
                          </>
                        ) : null}

                        {execState === 'ACCEPTED' ? (
                          <button
                            type="button"
                            className="go-link font-semibold"
                            disabled={busy || Boolean(unavailableReason)}
                            onClick={() => void handlePmClose(task.taskId)}
                          >
                            Close to PM →
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground p-3">No active execution tasks recorded.</p>
            )}
          </div>
        ) : null}

        {/* TAB 3: WORKFORCE & CAPABILITIES (X-1) */}
        {tab === 'WORKFORCE' ? (
          <div className="p-3 space-y-3">
            {workforce ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-2xs font-mono">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="p-1.5">Seat</th>
                      <th className="p-1.5">Provider / Client</th>
                      <th className="p-1.5">Class</th>
                      <th className="p-1.5">Role</th>
                      <th className="p-1.5">Availability</th>
                      <th className="p-1.5">Capabilities</th>
                      <th className="p-1.5">Dispatch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workforce.seats.map((seat) => (
                      <tr key={seat.handle} className="border-b border-border/40 hover:bg-card/40">
                        <td className="p-1.5 font-semibold text-foreground">{seat.handle}</td>
                        <td className="p-1.5 text-muted-foreground">{seat.provider_owner} · {seat.product_client}</td>
                        <td className="p-1.5">{seat.capacity_class}</td>
                        <td className="p-1.5">{seat.role_family}</td>
                        <td className="p-1.5">
                          <Chip
                            value={seat.availability}
                            tone={seat.availability === 'AVAILABLE' ? 'room' : seat.availability === 'OFFLINE' ? 'muted' : 'stale'}
                          />
                        </td>
                        <td className="p-1.5">
                          {seat.capabilities.values.length ? (
                            <span title={seat.capabilities.evidence.join(', ')}>
                              {seat.capabilities.values.join(', ')}
                            </span>
                          ) : (
                            <span className="text-truth-drift">NO VERIFIED CAPABILITY</span>
                          )}
                        </td>
                        <td className="p-1.5">
                          <Chip
                            value={seat.dispatch_eligible ? 'ELIGIBLE' : 'BLOCKED'}
                            tone={seat.dispatch_eligible ? 'room' : 'muted'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-2xs text-muted-foreground">Reading workforce capability registry…</p>
            )}
          </div>
        ) : null}

        {/* TAB 4: CAPACITY & QUOTA */}
        {tab === 'CAPACITY' ? (
          <div className="p-3 space-y-3">
            {capacity ? (
              <div className="space-y-2">
                <p className="text-2xs text-muted-foreground font-mono">{capacity.source}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {capacity.capacity.map((cap) => (
                    <div key={cap.seat} className="rounded border border-border bg-card p-2.5 text-2xs font-mono">
                      <div className="flex items-center justify-between">
                        <strong className="text-foreground">{cap.seat}</strong>
                        <Chip value={cap.availability} tone={cap.availability === 'AVAILABLE' ? 'room' : 'muted'} />
                      </div>
                      <div className="mt-1 text-muted-foreground">Provider: {cap.provider} ({cap.capacityClass})</div>
                      <div className="mt-0.5 text-muted-foreground">Quota: {cap.quotaStatus} ({cap.telemetrySource})</div>
                      <p className="mt-1 text-3xs text-muted-foreground/80">{cap.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-2xs text-muted-foreground">Reading capacity telemetry…</p>
            )}
          </div>
        ) : null}

        {/* TAB 5: STUCK TASKS & ESCALATION */}
        {tab === 'STUCK' ? (
          <div className="p-3">
            {stuck.length ? (
              <ul className="grid gap-2">
                {stuck.map((item) => (
                  <li key={item.taskId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-truth-drift/40 bg-truth-drift/10 p-2.5 text-2xs">
                    <div>
                      <span className="font-mono font-semibold text-foreground">{item.taskId}</span>
                      <span className="ml-2 font-mono text-muted-foreground">Seat: {item.seat} · Stuck since: {item.stuckSince}</span>
                      <ul className="mt-1 text-muted-foreground">
                        {item.signals.map((sig, idx) => (
                          <li key={idx}>• [{sig.type}] {sig.detail || 'signal detected'}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      className="go-link font-semibold"
                      disabled={busy || item.escalated}
                      onClick={() => void handleEscalateStuck(item.taskId)}
                    >
                      {item.escalated ? 'Escalated in Room' : 'Escalate to Room →'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">No tasks currently identified as stuck.</p>
            )}
          </div>
        ) : null}

        {/* TAB 6: COMMAND EVENTS LEDGER */}
        {tab === 'EVENTS' ? (
          <div className="p-3">
            {events.length ? (
              <ul className="grid gap-1.5 text-2xs font-mono">
                {events.map((ev, idx) => (
                  <li key={ev.eventId || idx} className="rounded border border-border/60 bg-card p-2">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>[{ev.type}] {ev.taskId ? `Task ${ev.taskId}` : ''}</span>
                      <span>{ev.timestamp}</span>
                    </div>
                    <p className="mt-0.5 text-foreground">{ev.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-muted-foreground">No command execution events recorded.</p>
            )}
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
