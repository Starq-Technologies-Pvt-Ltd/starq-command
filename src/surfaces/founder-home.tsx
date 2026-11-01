/**
 * Founder Home — today's operating picture from PM attention, the latest digest,
 * and milestones. Counts and ages are shown only when the payload carries them.
 */
import * as React from 'react';
import { Chip, Panel } from '@/components/console';
import { PmEmpty, PmLoading, PmUnavailable } from '@/components/pm-feedback';
import { readClaimedActor } from '@/lib/acting-as';
import {
  pmAttention,
  pmBoardHref,
  pmLatestDigest,
  pmMilestones,
  pmOrg,
  pmOrgCompanies,
  pmProjects,
  pmTaskHref,
  type PmAttention,
  type PmAttentionAction,
  type PmDigest,
  type PmDigestSummary,
  type PmMilestone,
  type PmResult,
} from '@/lib/pm-client';
import { FirstRun } from '@/surfaces/first-run';

type Load<T> = { phase: 'loading' } | { phase: 'ready'; result: PmResult<T> };

type AttentionData = PmAttention;
type DigestData = { digest: PmDigest | null };
type MilestoneData = { milestones: PmMilestone[] };

interface BlockedRow {
  key: string;
  title: string;
  href: string | null;
  owner: string;
  reason: string;
  age: string;
  personHref: string | null;
}

interface ProgressGroup {
  owner: string;
  tasks: PmAttentionAction[];
}

const LOAD_KEYS = ['in_progress', 'open', 'blocked', 'completed', 'count'] as const;

export function FounderHome() {
  const actor = readClaimedActor();
  const [emptyInstall, setEmptyInstall] = React.useState(false);
  const [installTick, setInstallTick] = React.useState(0);
  const [attention, setAttention] = React.useState<Load<AttentionData>>({ phase: 'loading' });
  const [digest, setDigest] = React.useState<Load<DigestData>>({ phase: 'loading' });
  const [milestones, setMilestones] = React.useState<Load<MilestoneData>>({ phase: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([pmOrg(), pmProjects()]).then(([orgRes, projectRes]) => {
      if (cancelled) return;
      const companies = orgRes.ok ? pmOrgCompanies(orgRes.data) : null;
      const projects = projectRes.ok ? projectRes.data?.projects : null;
      setEmptyInstall(Boolean(companies && projects && companies.length === 0 && projects.length === 0));
    });
    return () => { cancelled = true; };
  }, [installTick]);

  React.useEffect(() => {
    let cancelled = false;
    void pmAttention().then((result) => {
      if (!cancelled) setAttention({ phase: 'ready', result });
    });
    void pmLatestDigest().then((result) => {
      if (!cancelled) setDigest({ phase: 'ready', result });
    });
    void pmMilestones().then((result) => {
      if (!cancelled) setMilestones({ phase: 'ready', result });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (emptyInstall) {
    return (
      <div className="command-stack" data-founder-home="" data-first-run-host="">
        <FirstRun onComplete={() => setInstallTick((tick) => tick + 1)} />
      </div>
    );
  }

  return (
    <div className="command-stack" data-founder-home="">
      <header data-founder-header="">
        <h1>Founder Home</h1>
        <p>
          Claimed actor — not authentication{' '}
          <strong data-claimed-actor="">{actor}</strong>
        </p>
      </header>
      <NeedsAttention load={attention} />
      <TodaysDigest load={digest} />
      <Blocked loadAttention={attention} loadDigest={digest} />
      <InProgressByPerson loadAttention={attention} loadDigest={digest} />
      <CompletedInDigest load={digest} />
      <MilestonesAtRisk load={milestones} />
    </div>
  );
}

function Section({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  return (
    <div data-founder-section={name}>
      <Panel title={title}>
        <div className="body grid gap-2">{children}</div>
      </Panel>
    </div>
  );
}

function NeedsAttention({ load }: { load: Load<AttentionData> }) {
  return (
    <Section name="attention" title="Needs attention">
      {load.phase === 'loading' ? <PmLoading label="Loading attention" /> : null}
      {load.phase === 'ready' && !load.result.ok ? <PmUnavailable reason={load.result.message} /> : null}
      {load.phase === 'ready' && load.result.ok && !Array.isArray(load.result.data.next_actions) ? (
        <PmUnavailable reason="next_actions is missing on the attention payload." />
      ) : null}
      {load.phase === 'ready' && load.result.ok && Array.isArray(load.result.data.next_actions) && load.result.data.next_actions.length === 0 ? (
        <PmEmpty label="Nothing needs attention." />
      ) : null}
      {load.phase === 'ready' && load.result.ok && Array.isArray(load.result.data.next_actions) && load.result.data.next_actions.length > 0 ? (
        <ul>
          {load.result.data.next_actions.map((action, index) => {
            const href = actionHref(action.project_id, action.task_id, action.href);
            const title = action.title || action.task_id || 'Attention item';
            return (
              <li key={`${action.project_id}:${action.task_id}:${index}`}>
                {href ? <a href={href}>{title}</a> : <span>{title}</span>}
                {action.status ? <Chip value={action.status} /> : null}
                <span>Owner {action.owner || 'UNKNOWN'}</span>
                <span>Reason {action.reason || 'UNKNOWN'}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Section>
  );
}

function TodaysDigest({ load }: { load: Load<DigestData> }) {
  return (
    <Section name="digest" title="Today's digest">
      {load.phase === 'loading' ? <PmLoading label="Loading digest" /> : null}
      {load.phase === 'ready' ? <DigestBody result={load.result} /> : null}
    </Section>
  );
}

function DigestBody({ result }: { result: PmResult<DigestData> }) {
  if (!result.ok) return <PmUnavailable reason={result.message} />;
  const digest = result.data.digest;
  if (!digest) return <PmUnavailable reason="Latest digest record is missing." />;
  const record = digest as PmDigest & { state?: unknown };
  if (typeof record.state === 'string' && record.state.trim().toUpperCase() === 'UNAVAILABLE') {
    return <PmUnavailable reason={digest.delivery_detail || 'Digest state is UNAVAILABLE.'} />;
  }
  const summary = digest.summary;
  if (!summary) return <PmUnavailable reason="Digest summary is not on the latest digest." />;
  return (
    <>
      {digest.id ? <p>Digest {digest.id}</p> : null}
      {digest.generated_at ? <p>Generated {digest.generated_at}</p> : null}
      {digest.delivery_state ? <p>Delivery <Chip value={digest.delivery_state} /></p> : null}
      <SummaryCounts counts={summary.counts} />
      <DigestList label="Blocked" items={summary.blocked_tasks} blockFacts />
      <DigestList label="At risk" items={summary.at_risk_milestones} />
      <DigestList label="Completed" items={summary.completed_last_24h} />
    </>
  );
}

function SummaryCounts({ counts }: { counts: PmDigestSummary['counts'] }) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    return <PmUnavailable reason="Summary counts are not on this digest." />;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return <PmEmpty label="Summary counts are empty." />;
  const numeric = entries.filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  if (numeric.length === 0) return <PmUnavailable reason="Summary counts are not numeric on this digest." />;
  return (
    <ul data-digest-counts="">
      {numeric.map(([key, value]) => (
        <li key={key}>{key}: {value}</li>
      ))}
    </ul>
  );
}

function DigestList({
  label,
  items,
  blockFacts = false,
}: {
  label: string;
  items: Array<Record<string, unknown>> | undefined;
  blockFacts?: boolean;
}) {
  if (!Array.isArray(items)) return <PmUnavailable reason={`${label} list is not on this digest.`} />;
  if (items.length === 0) return <PmEmpty label={`${label} list is empty.`} />;
  return (
    <div>
      <h3>{label}</h3>
      <ul>
        {items.map((item, index) => {
          const record = normalizeRecord(item);
          return (
            <li key={`${label}-${index}`}>
              {blockFacts ? <BlockedFacts record={record} /> : <RecordLine record={record} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Blocked({ loadAttention, loadDigest }: { loadAttention: Load<AttentionData>; loadDigest: Load<DigestData> }) {
  if (loadAttention.phase !== 'ready' || loadDigest.phase !== 'ready') {
    return (
      <Section name="blocked" title="Blocked">
        <PmLoading label="Loading blocked" />
      </Section>
    );
  }
  const attentionResult = loadAttention.result;
  const digestResult = loadDigest.result;
  const actions = attentionResult.ok && Array.isArray(attentionResult.data.next_actions) ? attentionResult.data.next_actions : null;
  const summary = digestResult.ok ? digestResult.data.digest?.summary : undefined;
  const digestBlocked = summary && Array.isArray(summary.blocked_tasks) ? summary.blocked_tasks.map(normalizeRecord) : null;

  if (!actions && !digestBlocked) {
    const reason = !attentionResult.ok
      ? attentionResult.message
      : !digestResult.ok
        ? digestResult.message
        : 'Blocked items are not on the attention or digest payload.';
    return (
      <Section name="blocked" title="Blocked">
        <PmUnavailable reason={reason} />
      </Section>
    );
  }

  const rows = collectBlocked(actions, digestBlocked);
  const attentionConfirmed = actions !== null;
  const digestConfirmed = digestBlocked !== null;
  return (
    <Section name="blocked" title="Blocked">
      {rows.length > 0 ? <BlockedList rows={rows} /> : null}
      {rows.length === 0 && attentionConfirmed && digestConfirmed ? <PmEmpty label="Nothing is blocked." /> : null}
      {rows.length === 0 && attentionConfirmed && !digestConfirmed ? <PmEmpty label="No blocked items in attention." /> : null}
      {rows.length === 0 && !attentionConfirmed && digestConfirmed ? <PmEmpty label="Digest blocked list is empty." /> : null}
      {!attentionResult.ok ? <PmUnavailable reason={attentionResult.message} /> : null}
      {attentionResult.ok && actions === null ? <PmUnavailable reason="Attention next_actions is missing." /> : null}
      {!digestResult.ok ? <PmUnavailable reason={digestResult.message} /> : null}
      {digestResult.ok && !summary ? <PmUnavailable reason="Digest summary is not on the latest digest." /> : null}
      {digestResult.ok && summary && !Array.isArray(summary.blocked_tasks) ? (
        <PmUnavailable reason="Digest blocked list is not on this digest." />
      ) : null}
    </Section>
  );
}

function BlockedList({ rows }: { rows: BlockedRow[] }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.key}>
          {row.href ? <a href={row.href}>{row.title}</a> : <span>{row.title}</span>}
          <span>
            Owner{' '}
            {row.personHref ? <a href={row.personHref}>{row.owner}</a> : row.owner}
          </span>
          <span>Reason {row.reason}</span>
          <span>Age <Chip value={row.age} /></span>
        </li>
      ))}
    </ul>
  );
}

function BlockedFacts({ record }: { record: Record<string, unknown> }) {
  const row = toBlockedRow(record, 'digest-line');
  return (
    <>
      {row.href ? <a href={row.href}>{row.title}</a> : <span>{row.title}</span>}
      <span>Owner {row.personHref ? <a href={row.personHref}>{row.owner}</a> : row.owner}</span>
      <span>Reason {row.reason}</span>
      <span>Age <Chip value={row.age} /></span>
    </>
  );
}

function InProgressByPerson({ loadAttention, loadDigest }: { loadAttention: Load<AttentionData>; loadDigest: Load<DigestData> }) {
  if (loadAttention.phase !== 'ready' || loadDigest.phase !== 'ready') {
    return (
      <Section name="in-progress" title="In progress by person">
        <PmLoading label="Loading in progress" />
      </Section>
    );
  }
  const attentionResult = loadAttention.result;
  const digestResult = loadDigest.result;
  const summary = digestResult.ok ? digestResult.data.digest?.summary : undefined;
  const personLoad = summary && Array.isArray(summary.person_load) ? summary.person_load : null;
  const actions = attentionResult.ok && Array.isArray(attentionResult.data.next_actions) ? attentionResult.data.next_actions : null;

  if (personLoad) {
    return (
      <Section name="in-progress" title="In progress by person">
        {personLoad.length === 0 ? <PmEmpty label="In progress by person is empty." /> : <PersonLoadList items={personLoad} />}
      </Section>
    );
  }

  if (actions) {
    const groups = groupInProgress(actions);
    return (
      <Section name="in-progress" title="In progress by person">
        {groups.length === 0 ? <PmEmpty label="No one is in progress." /> : <ProgressGroups groups={groups} />}
      </Section>
    );
  }

  const reason = !attentionResult.ok
    ? attentionResult.message
    : !digestResult.ok
      ? digestResult.message
      : 'Neither person_load nor attention next_actions is available.';
  return (
    <Section name="in-progress" title="In progress by person">
      <PmUnavailable reason={reason} />
    </Section>
  );
}

function PersonLoadList({ items }: { items: unknown[] }) {
  return (
    <ul>
      {items.map((item, index) => {
        const record = typeof item === 'string' ? { handle: item } : normalizeRecord(item);
        const person = personRef(record);
        const facts = loadFacts(record);
        const tasks = Array.isArray(record.tasks) ? record.tasks.map(normalizeRecord) : null;
        return (
          <li key={`${person.label}-${index}`}>
            {person.href ? <a href={person.href}>{person.label}</a> : <span>{person.label}</span>}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
            {tasks && tasks.length === 0 ? <PmEmpty label="Task list is empty." /> : null}
            {tasks && tasks.length > 0 ? (
              <ul>
                {tasks.map((task, taskIndex) => (
                  <li key={taskIndex}>
                    <RecordLine record={task} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ProgressGroups({ groups }: { groups: ProgressGroup[] }) {
  return (
    <ul>
      {groups.map((group) => {
        const href = group.owner === 'UNKNOWN' ? null : `#workforce?person=${encodeURIComponent(group.owner)}`;
        return (
          <li key={group.owner}>
            {href ? <a href={href}>{group.owner}</a> : <span>{group.owner}</span>}
            <ul>
              {group.tasks.map((task, index) => (
                <li key={`${task.task_id}:${index}`}>
                  <RecordLine record={actionRecord(task)} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function CompletedInDigest({ load }: { load: Load<DigestData> }) {
  return (
    <Section name="completed" title="Completed in the latest digest">
      {load.phase === 'loading' ? <PmLoading label="Loading completed" /> : null}
      {load.phase === 'ready' ? <CompletedBody result={load.result} /> : null}
    </Section>
  );
}

function CompletedBody({ result }: { result: PmResult<DigestData> }) {
  if (!result.ok) return <PmUnavailable reason={result.message} />;
  const completed = result.data.digest?.summary?.completed_last_24h;
  if (!Array.isArray(completed)) {
    return <PmUnavailable reason="completed_last_24h is not on the latest digest." />;
  }
  if (completed.length === 0) return <PmEmpty label="Nothing completed in the latest digest." />;
  return (
    <ul>
      {completed.map((item, index) => (
        <li key={index}>
          <RecordLine record={normalizeRecord(item)} />
        </li>
      ))}
    </ul>
  );
}

function MilestonesAtRisk({ load }: { load: Load<MilestoneData> }) {
  return (
    <Section name="milestones" title="Milestones at risk">
      {load.phase === 'loading' ? <PmLoading label="Loading milestones" /> : null}
      {load.phase === 'ready' && !load.result.ok ? <PmUnavailable reason={load.result.message} /> : null}
      {load.phase === 'ready' && load.result.ok && !Array.isArray(load.result.data.milestones) ? (
        <PmUnavailable reason="Milestones payload is missing." />
      ) : null}
      {load.phase === 'ready' && load.result.ok && Array.isArray(load.result.data.milestones) ? (
        <MilestoneList milestones={load.result.data.milestones} />
      ) : null}
    </Section>
  );
}

function MilestoneList({ milestones }: { milestones: PmMilestone[] }) {
  const atRisk = milestones.filter((milestone) => milestone.at_risk === true || milestone.overdue === true);
  if (atRisk.length === 0) return <PmEmpty label="No milestones at risk." />;
  return (
    <ul>
      {atRisk.map((milestone) => {
        const href = milestone.project_id ? pmBoardHref(milestone.project_id) : null;
        const title = milestone.title || milestone.id || 'Milestone';
        return (
          <li key={milestone.id || `${milestone.project_id}:${title}`}>
            {href ? <a href={href}>{title}</a> : <span>{title}</span>}
            {milestone.at_risk === true ? <Chip value="at_risk" /> : null}
            {milestone.overdue === true ? <Chip value="overdue" /> : null}
            {milestone.due_date ? <span>Due {milestone.due_date}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function RecordLine({ record }: { record: Record<string, unknown> }) {
  const title = str(record.title) || str(record.name) || str(record.task_id) || str(record.id) || 'Item';
  const href = recordHref(record);
  const owner = str(record.owner);
  const reason = str(record.reason);
  return (
    <>
      {href ? <a href={href}>{title}</a> : <span>{title}</span>}
      {owner ? (
        <span>
          Owner <a href={`#workforce?person=${encodeURIComponent(owner)}`}>{owner}</a>
        </span>
      ) : null}
      {reason ? <span>Reason {reason}</span> : null}
    </>
  );
}

function actionHref(projectId: unknown, taskId: unknown, href: unknown): string | null {
  const project = str(projectId);
  const task = str(taskId);
  if (project && task) return pmTaskHref(project, task);
  return str(href);
}

function recordHref(record: Record<string, unknown>): string | null {
  const taskHref = actionHref(record.project_id, record.task_id, record.href);
  if (taskHref) return taskHref;
  const project = str(record.project_id);
  if (project) return pmBoardHref(project);
  const person = str(record.handle) || str(record.room_handle) || str(record.person_id);
  if (person) return `#workforce?person=${encodeURIComponent(person)}`;
  return null;
}

function personRef(record: Record<string, unknown>): { label: string; href: string | null } {
  const handle = str(record.handle) || str(record.room_handle);
  const id = str(record.person_id) || str(record.id);
  const owner = str(record.owner) || str(record.person);
  const key = handle || id || owner;
  const label = str(record.display_name) || str(record.name) || key || 'UNKNOWN';
  if (!key) return { label, href: null };
  return { label, href: `#workforce?person=${encodeURIComponent(key)}` };
}

function loadFacts(record: Record<string, unknown>): string[] {
  const facts: string[] = [];
  for (const key of LOAD_KEYS) {
    if (typeof record[key] === 'number') facts.push(`${key}: ${record[key]}`);
  }
  return facts;
}

function groupInProgress(actions: PmAttentionAction[]): ProgressGroup[] {
  const groups: ProgressGroup[] = [];
  const index = new Map<string, number>();
  for (const action of actions) {
    if (typeof action.status !== 'string' || action.status.toUpperCase() !== 'IN_PROGRESS') continue;
    const owner = str(action.owner) ?? 'UNKNOWN';
    const at = index.get(owner);
    if (at === undefined) {
      index.set(owner, groups.length);
      groups.push({ owner, tasks: [action] });
    } else {
      groups[at].tasks.push(action);
    }
  }
  return groups;
}

function collectBlocked(actions: PmAttentionAction[] | null, digestBlocked: Record<string, unknown>[] | null): BlockedRow[] {
  const rows: BlockedRow[] = [];
  const seen = new Map<string, number>();
  actions?.forEach((action, index) => {
    if (!indicatesBlocked(action.status, action.reason)) return;
    pushBlocked(rows, seen, actionRecord(action), `attention-${index}`);
  });
  digestBlocked?.forEach((record, index) => {
    pushBlocked(rows, seen, record, `digest-${index}`);
  });
  return rows;
}

function pushBlocked(rows: BlockedRow[], seen: Map<string, number>, record: Record<string, unknown>, key: string) {
  const id = identityKey(record);
  if (id && seen.has(id)) {
    const at = seen.get(id)!;
    rows[at] = mergeBlocked(rows[at], record);
    return;
  }
  if (id) seen.set(id, rows.length);
  rows.push(toBlockedRow(record, key));
}

function mergeBlocked(existing: BlockedRow, record: Record<string, unknown>): BlockedRow {
  const incoming = toBlockedRow(record, existing.key);
  return {
    ...existing,
    href: existing.href ?? incoming.href,
    owner: existing.owner === 'UNKNOWN' ? incoming.owner : existing.owner,
    reason: existing.reason === 'UNKNOWN' ? incoming.reason : existing.reason,
    age: incoming.age !== 'UNKNOWN' ? incoming.age : existing.age,
    personHref: existing.personHref ?? incoming.personHref,
    title: existing.title === 'Blocked item' ? incoming.title : existing.title,
  };
}

function toBlockedRow(record: Record<string, unknown>, key: string): BlockedRow {
  const owner = textOrUnknown(record.owner);
  return {
    key,
    title: str(record.title) || str(record.task_id) || str(record.id) || 'Blocked item',
    href: recordHref(record),
    owner,
    reason: textOrUnknown(record.reason),
    age: formatAge(record),
    personHref: owner === 'UNKNOWN' ? null : `#workforce?person=${encodeURIComponent(owner)}`,
  };
}

function actionRecord(action: PmAttentionAction): Record<string, unknown> {
  return {
    task_id: action.task_id,
    project_id: action.project_id,
    title: action.title,
    status: action.status,
    owner: action.owner,
    reason: action.reason,
    href: action.href,
  };
}

function indicatesBlocked(status: unknown, reason: unknown): boolean {
  if (typeof status === 'string' && status.toUpperCase().split(/[^A-Z0-9]+/).includes('BLOCKED')) return true;
  if (typeof reason !== 'string') return false;
  return /(^|[^a-z])blocked([^a-z]|$)/.test(reason.toLowerCase());
}

function formatAge(record: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(record, 'age')) return 'UNKNOWN';
  const age = record.age;
  if (typeof age === 'number' && Number.isFinite(age)) return String(age);
  if (typeof age === 'string' && age.trim()) return age.trim();
  return 'UNKNOWN';
}

function textOrUnknown(value: unknown): string {
  return str(value) ?? 'UNKNOWN';
}

function identityKey(record: Record<string, unknown>): string | null {
  const project = str(record.project_id);
  const task = str(record.task_id);
  if (project && task) return `${project}:${task}`;
  return null;
}

function normalizeRecord(item: unknown): Record<string, unknown> {
  if (typeof item === 'string' && item.trim()) return { title: item.trim() };
  if (item && typeof item === 'object' && !Array.isArray(item)) return item as Record<string, unknown>;
  return { title: 'UNKNOWN' };
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
