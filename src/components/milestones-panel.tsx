/**
 * Milestones and work packages for one PM project (CMD-PROJ-1, Founder #9605).
 *
 * Deliberately lighter-weight than the task board: milestones/work packages
 * are organisational grouping, not individually Room-governed work items.
 * A task linked to a work package still goes through its own full task
 * workflow unchanged; this panel only reports the rollup.
 */
import * as React from 'react';
import { Chip, Panel } from '@/components/console';
import {
  pmCreateMilestone,
  pmCreateWorkPackage,
  pmMilestones,
  pmUpdateMilestone,
  pmUpdateWorkPackage,
  pmWorkPackages,
  WORK_PACKAGE_STATUSES,
  type PmMilestone,
  type PmResult,
  type PmWorkPackage,
  type WorkPackageStatus,
} from '@/lib/pm-client';

function failureLines(res: Extract<PmResult<unknown>, { ok: false }>): string[] {
  return [`${res.code}: ${res.message}`, ...(res.errors ?? [])];
}

export function MilestonesPanel({ projectId, actor }: { projectId: string; actor: string }) {
  const [milestones, setMilestones] = React.useState<PmMilestone[] | null>(null);
  const [workPackages, setWorkPackages] = React.useState<PmWorkPackage[] | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [newMilestoneTitle, setNewMilestoneTitle] = React.useState('');
  const [newWorkPackage, setNewWorkPackage] = React.useState({ title: '', milestoneId: '' });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [ms, wp] = await Promise.all([pmMilestones(projectId), pmWorkPackages(projectId)]);
    const nextErrors: string[] = [];
    if (ms.ok) setMilestones(ms.data.milestones); else nextErrors.push(...failureLines(ms));
    if (wp.ok) setWorkPackages(wp.data.work_packages); else nextErrors.push(...failureLines(wp));
    setErrors(nextErrors);
  }, [projectId]);

  React.useEffect(() => {
    setMilestones(null); setWorkPackages(null); setErrors([]);
    void load();
  }, [load]);

  const createMilestone = async () => {
    if (!newMilestoneTitle.trim() || !actor) return;
    setBusy(true); setErrors([]);
    const res = await pmCreateMilestone({ project_id: projectId, title: newMilestoneTitle.trim(), actor });
    setBusy(false);
    if (!res.ok) { setErrors(failureLines(res)); return; }
    setNewMilestoneTitle('');
    await load();
  };

  const createWorkPackage = async () => {
    if (!newWorkPackage.title.trim() || !actor) return;
    setBusy(true); setErrors([]);
    const body: Record<string, unknown> = { project_id: projectId, title: newWorkPackage.title.trim(), owner: actor, actor };
    if (newWorkPackage.milestoneId) body.milestone_id = newWorkPackage.milestoneId;
    const res = await pmCreateWorkPackage(body);
    setBusy(false);
    if (!res.ok) { setErrors(failureLines(res)); return; }
    setNewWorkPackage({ title: '', milestoneId: '' });
    await load();
  };

  const cycleWorkPackageStatus = async (wpRow: PmWorkPackage) => {
    if (!actor) return;
    const idx = WORK_PACKAGE_STATUSES.indexOf(wpRow.status);
    const next: WorkPackageStatus = WORK_PACKAGE_STATUSES[(idx + 1) % WORK_PACKAGE_STATUSES.length];
    setBusy(true); setErrors([]);
    const res = await pmUpdateWorkPackage(wpRow.id, { actor, expected_updated_at: wpRow.updated_at, status: next });
    setBusy(false);
    if (!res.ok) { setErrors(failureLines(res)); return; }
    await load();
  };

  const achieveMilestone = async (m: PmMilestone) => {
    if (!actor) return;
    setBusy(true); setErrors([]);
    const res = await pmUpdateMilestone(m.id, { actor, expected_updated_at: m.updated_at, status: m.status === 'ACHIEVED' ? 'OPEN' : 'ACHIEVED' });
    setBusy(false);
    if (!res.ok) { setErrors(failureLines(res)); return; }
    await load();
  };

  if (!milestones || !workPackages) {
    if (errors.length > 0) {
      return (
        <Panel title="Milestones & work packages" count="UNAVAILABLE">
          <div className="grid gap-2 p-3" data-pm="milestones-unavailable">
            <ul role="alert" className="text-xs text-truth-drift">
              {errors.map((e, i) => <li key={`${i}-${e}`}>{e}</li>)}
            </ul>
            <div>
              <button
                type="button"
                className="go-link"
                disabled={busy}
                onClick={() => {
                  setErrors([]);
                  void load();
                }}
              >
                Retry
              </button>
            </div>
          </div>
        </Panel>
      );
    }
    return <Panel title="Milestones & work packages" count="LOADING"><div className="body"><p className="prose-note">Reading the PM service…</p></div></Panel>;
  }

  return (
    <Panel
      title="Milestones & work packages"
      count={`${milestones.length} milestone${milestones.length === 1 ? '' : 's'} · ${workPackages.length} work package${workPackages.length === 1 ? '' : 's'}`}
    >
      <div className="grid gap-3 p-3" data-pm="milestones">
        {errors.length ? <ul role="alert" className="text-xs text-truth-drift">{errors.map((e, i) => <li key={`${i}-${e}`}>{e}</li>)}</ul> : null}

        <div className="grid gap-2 md:grid-cols-2">
          <section aria-label="Milestones" className="rounded border border-border">
            <header className="flex items-center justify-between border-b border-border bg-card px-2.5 py-2">
              <h4 className="font-mono text-[10px] font-semibold tracking-wide">MILESTONES</h4>
            </header>
            <ul className="grid gap-1.5 p-1.5" data-testid="milestone-list">
              {milestones.length === 0 ? <li className="p-2 text-xs text-muted-foreground">None yet.</li> : null}
              {milestones.map((m) => (
                <li key={m.id} className="rounded border border-border bg-background/40 p-2" data-milestone-id={m.id}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-mono text-[10px] text-[hsl(var(--room))]">{m.id}</span>
                    <button type="button" className="go-link" disabled={busy || !actor} onClick={() => void achieveMilestone(m)}>
                      <Chip value={m.status} tone={m.status === 'ACHIEVED' ? 'ok' : m.status === 'MISSED' ? 'drift' : 'muted'} />
                    </button>
                  </div>
                  <span className="mt-1 block text-xs font-medium leading-5">{m.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {m.target_date ? `target ${m.target_date} · ` : ''}
                    {m.work_package_total} work package{m.work_package_total === 1 ? '' : 's'}
                    {m.work_package_total > 0 ? ` (${m.work_package_counts.DONE} done)` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {actor ? (
              <form className="flex gap-1.5 border-t border-border p-1.5" onSubmit={(e) => { e.preventDefault(); void createMilestone(); }}>
                <input aria-label="New milestone title" placeholder="New milestone title" value={newMilestoneTitle} onChange={(e) => setNewMilestoneTitle(e.target.value)} />
                <button type="submit" className="go-link" disabled={busy || newMilestoneTitle.trim().length < 3}>Add</button>
              </form>
            ) : null}
          </section>

          <section aria-label="Work packages" className="rounded border border-border">
            <header className="flex items-center justify-between border-b border-border bg-card px-2.5 py-2">
              <h4 className="font-mono text-[10px] font-semibold tracking-wide">WORK PACKAGES</h4>
            </header>
            <ul className="grid gap-1.5 p-1.5" data-testid="work-package-list">
              {workPackages.length === 0 ? <li className="p-2 text-xs text-muted-foreground">None yet.</li> : null}
              {workPackages.map((w) => (
                <li key={w.id} className="rounded border border-border bg-background/40 p-2" data-wp-id={w.id}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-mono text-[10px] text-[hsl(var(--room))]">{w.id}</span>
                    <button type="button" className="go-link" disabled={busy || !actor} onClick={() => void cycleWorkPackageStatus(w)}>
                      <Chip value={w.status} tone={w.status === 'DONE' ? 'ok' : 'muted'} />
                    </button>
                  </div>
                  <span className="mt-1 block text-xs font-medium leading-5">{w.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {w.owner} · {w.milestone_id ?? 'no milestone'} · {w.task_total} task{w.task_total === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
            {actor ? (
              <form className="grid gap-1.5 border-t border-border p-1.5" onSubmit={(e) => { e.preventDefault(); void createWorkPackage(); }}>
                <input aria-label="New work package title" placeholder="New work package title" value={newWorkPackage.title} onChange={(e) => setNewWorkPackage((s) => ({ ...s, title: e.target.value }))} />
                <div className="flex gap-1.5">
                  <select aria-label="Milestone for new work package" value={newWorkPackage.milestoneId} onChange={(e) => setNewWorkPackage((s) => ({ ...s, milestoneId: e.target.value }))}>
                    <option value="">— no milestone —</option>
                    {milestones.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.title}</option>)}
                  </select>
                  <button type="submit" className="go-link" disabled={busy || newWorkPackage.title.trim().length < 3}>Add</button>
                </div>
              </form>
            ) : null}
          </section>
        </div>
      </div>
    </Panel>
  );
}
