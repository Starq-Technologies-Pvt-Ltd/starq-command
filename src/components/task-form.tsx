/**
 * Create / edit form for a PM task. Presentation and client-side required-field
 * checks only; the PM service re-validates everything and is the authority.
 */
import * as React from 'react';
import { PM_PRIORITIES, type PmPriority, type PmTask } from '@/lib/pm-client';

export interface TaskFormValues {
  title: string;
  description: string;
  priority: PmPriority;
  owner: string;
  verifier: string;
  notes: string;
  dependsOn: string[];
  authSequence: string;
  authEventId: string;
  authPurpose: string;
}

export function emptyTaskForm(): TaskFormValues {
  return {
    title: '', description: '', priority: 'P2', owner: 'UNASSIGNED', verifier: 'UNASSIGNED',
    notes: '', dependsOn: [], authSequence: '', authEventId: '', authPurpose: '',
  };
}

export function taskToForm(task: PmTask): TaskFormValues {
  return {
    title: task.title, description: task.description, priority: task.priority,
    owner: task.owner, verifier: task.verifier, notes: task.notes,
    dependsOn: task.depends_on, authSequence: '', authEventId: '', authPurpose: '',
  };
}

export function TaskForm({
  mode,
  initial,
  handles,
  busy,
  errors,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial: TaskFormValues;
  handles: string[];
  busy: boolean;
  errors: string[];
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = React.useState<TaskFormValues>(initial);
  const [local, setLocal] = React.useState<string[]>([]);
  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const people = ['UNASSIGNED', ...handles];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    if (v.title.trim().length < 3) problems.push('Title needs at least 3 characters.');
    if (v.owner !== 'UNASSIGNED' && v.owner === v.verifier) problems.push('Owner and verifier must be different (DEC-072).');
    const anyAuth = v.authSequence || v.authEventId || v.authPurpose;
    if (mode === 'create' && anyAuth && !(v.authSequence && /^[a-f0-9]{64}$/i.test(v.authEventId) && v.authPurpose.trim().length >= 3)) {
      problems.push('Room authorization needs a sequence, a 64-character event id and a purpose.');
    }
    setLocal(problems);
    if (!problems.length) onSubmit(v);
  };

  const field = 'grid gap-1 text-2xs text-muted-foreground';
  return (
    <form onSubmit={submit} className="grid gap-2 p-3" aria-label={mode === 'create' ? 'New task' : 'Edit task'}>
      <label className={field}>
        Title
        <input aria-label="Task title" value={v.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className={field}>
        Description
        <textarea aria-label="Task description" rows={3} value={v.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} />
      </label>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className={field}>
          Priority
          <select aria-label="Task priority" value={v.priority} onChange={(e) => set('priority', e.target.value as PmPriority)}>
            {PM_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className={field}>
          Owner
          <select aria-label="Task owner" value={v.owner} onChange={(e) => set('owner', e.target.value)}>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className={field}>
          Independent verifier
          <select aria-label="Task verifier" value={v.verifier} onChange={(e) => set('verifier', e.target.value)}>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <label className={field}>
        Depends on (task ids, comma separated, same project)
        <input
          aria-label="Task dependencies"
          value={v.dependsOn.join(', ')}
          onChange={(e) => set('dependsOn', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="PM-CMD-001, PM-CMD-002"
        />
      </label>
      <label className={field}>
        Notes
        <textarea aria-label="Task notes" rows={2} value={v.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
      </label>
      {mode === 'create' ? (
        <fieldset className="grid gap-2 rounded border border-border p-2">
          <legend className="px-1 text-2xs text-muted-foreground">Room authorization (verified against the ledger; required before work starts)</legend>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className={field}>
              Room sequence
              <input aria-label="Authorization Room sequence" inputMode="numeric" value={v.authSequence} onChange={(e) => set('authSequence', e.target.value.replace(/\D/g, ''))} placeholder="9497" />
            </label>
            <label className={`${field} md:col-span-2`}>
              Event id (64 hex)
              <input aria-label="Authorization event id" value={v.authEventId} onChange={(e) => set('authEventId', e.target.value.trim())} />
            </label>
          </div>
          <label className={field}>
            Purpose
            <input aria-label="Authorization purpose" value={v.authPurpose} maxLength={200} onChange={(e) => set('authPurpose', e.target.value)} placeholder="What this Room event authorizes" />
          </label>
        </fieldset>
      ) : null}
      {[...local, ...errors].length ? (
        <ul role="alert" className="grid gap-0.5 text-xs text-truth-drift">
          {[...local, ...errors].map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="go-link">{busy ? 'Saving…' : mode === 'create' ? 'Create task' : 'Save changes'}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="go-link">Cancel</button>
      </div>
    </form>
  );
}
