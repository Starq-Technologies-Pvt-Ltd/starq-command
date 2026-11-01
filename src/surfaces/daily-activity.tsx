/**
 * Daily activity — attention, the latest digest, and open follow-ups from the
 * PM service. Follow-ups come from GET /api/pm/followups (ops-automation
 * backend); rows are rendered from the service, never invented.
 */
import * as React from 'react';
import { PmEmpty, PmLoading, PmUnavailable } from '@/components/pm-feedback';
import {
  pmAttention,
  pmFollowups,
  pmLatestDigest,
  type PmAttention,
  type PmDigest,
  type PmFollowup,
  type PmResult,
} from '@/lib/pm-client';

type SectionState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; data: T };

function failureReason(res: Extract<PmResult<unknown>, { ok: false }>): string {
  return `${res.state} ${res.code}: ${res.message}`;
}

function rowLabel(row: Record<string, unknown>, index: number): string {
  for (const key of ['title', 'name', 'task_id', 'id']) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return `item ${index + 1} (no title recorded)`;
}

function digestHasContent(digest: PmDigest | null | undefined): digest is PmDigest {
  if (!digest || typeof digest !== 'object') return false;
  if (digest.id || digest.generated_at || digest.trigger || digest.delivery_state || digest.delivery_detail) {
    return true;
  }
  const summary = digest.summary;
  if (!summary) return false;
  if (summary.date || summary.generated_at) return true;
  if (summary.counts && Object.keys(summary.counts).length > 0) return true;
  return [
    summary.completed_last_24h,
    summary.started_last_24h,
    summary.blocked_tasks,
    summary.unassigned_open_tasks,
    summary.at_risk_milestones,
    summary.person_load,
  ].some((rows) => Array.isArray(rows) && rows.length > 0);
}

function DailySection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} data-daily-section={id}>
      <h2 id={id} className="text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function AttentionBody({ attention }: { attention: PmAttention }) {
  const actions = Array.isArray(attention.next_actions) ? attention.next_actions : [];
  return (
    <>
      <ul>
        {actions.map((action) => (
          <li key={`${action.project_id}:${action.task_id}`}>
            {action.href ? <a href={action.href}>{action.task_id}</a> : action.task_id}
            {action.title ? ` · ${action.title}` : ''}
            {action.status ? ` · ${action.status}` : ''}
            {action.reason ? ` · ${action.reason}` : ''}
            {action.owner ? ` · ${action.owner}` : ''}
          </li>
        ))}
      </ul>
      <p>
        blocked {attention.blocked} · founder gate {attention.founder_gate} · unassigned {attention.unassigned} · in
        progress {attention.in_progress}
      </p>
      <p>as of {attention.generated_at || 'UNKNOWN'}</p>
    </>
  );
}

function DigestBody({ digest }: { digest: PmDigest }) {
  const summary = digest.summary;
  const groups: Array<[string, Array<Record<string, unknown>> | undefined]> = [
    ['Completed last 24h', summary?.completed_last_24h],
    ['Started last 24h', summary?.started_last_24h],
    ['Blocked tasks', summary?.blocked_tasks],
    ['Unassigned open tasks', summary?.unassigned_open_tasks],
    ['Milestones at risk', summary?.at_risk_milestones],
    ['Person load', summary?.person_load],
  ];
  return (
    <>
      {digest.id ? <p>{digest.id}</p> : null}
      {digest.generated_at ? <p>Generated {digest.generated_at}</p> : null}
      {digest.trigger ? <p>Trigger {digest.trigger}</p> : null}
      {digest.delivery_state ? <p>Delivery {digest.delivery_state}</p> : null}
      {digest.delivery_detail ? <p>{digest.delivery_detail}</p> : null}
      {summary?.date ? <p>Date {summary.date}</p> : null}
      {summary?.generated_at ? <p>Summary generated {summary.generated_at}</p> : null}
      {summary?.counts && Object.keys(summary.counts).length > 0 ? (
        <ul>
          {Object.entries(summary.counts).map(([key, value]) => (
            <li key={key}>
              {key}: {value}
            </li>
          ))}
        </ul>
      ) : null}
      {groups.map(([label, rows]) =>
        Array.isArray(rows) && rows.length > 0 ? (
          <div key={label}>
            <h3 className="text-xs font-medium">{label}</h3>
            <ul>
              {rows.map((row, index) => (
                <li key={`${label}:${index}`}>{rowLabel(row, index)}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </>
  );
}

function FollowupsBody({ followups }: { followups: PmFollowup[] }) {
  return (
    <ul>
      {followups.map((f) => (
        <li key={f.id}>
          {f.task_id}
          {f.task_title ? ` · ${f.task_title}` : ''}
          {f.kind ? ` · ${f.kind}` : ''}
          {` · ${f.status}`}
          {typeof f.stale_days === 'number' ? ` · stale ${f.stale_days}d` : ''}
          {f.owner ? ` · ${f.owner}` : ''}
          {f.last_activity_at ? ` · last activity ${f.last_activity_at}` : ''}
        </li>
      ))}
    </ul>
  );
}

export function DailyActivity() {
  const [attention, setAttention] = React.useState<SectionState<PmAttention>>({ status: 'loading' });
  const [digest, setDigest] = React.useState<SectionState<PmDigest>>({ status: 'loading' });
  const [followups, setFollowups] = React.useState<SectionState<PmFollowup[]>>({ status: 'loading' });

  React.useEffect(() => {
    let active = true;
    void pmAttention().then((res) => {
      if (!active) return;
      if (!res.ok) {
        setAttention({ status: 'unavailable', reason: failureReason(res) });
        return;
      }
      const actions = res.data?.next_actions;
      if (!Array.isArray(actions)) {
        setAttention({
          status: 'unavailable',
          reason: 'PM attention payload is missing next_actions.',
        });
        return;
      }
      if (actions.length === 0) {
        setAttention({ status: 'empty' });
        return;
      }
      setAttention({ status: 'ready', data: res.data });
    });
    void pmLatestDigest().then((res) => {
      if (!active) return;
      if (!res.ok) {
        setDigest({ status: 'unavailable', reason: failureReason(res) });
        return;
      }
      const latest = res.data?.digest;
      if (!digestHasContent(latest)) {
        setDigest({ status: 'empty' });
        return;
      }
      setDigest({ status: 'ready', data: latest });
    });
    void pmFollowups().then((res) => {
      if (!active) return;
      if (!res.ok) {
        setFollowups({ status: 'unavailable', reason: failureReason(res) });
        return;
      }
      const rows = res.data?.followups;
      if (!Array.isArray(rows)) {
        setFollowups({ status: 'unavailable', reason: 'PM follow-ups payload is missing followups.' });
        return;
      }
      if (rows.length === 0) {
        setFollowups({ status: 'empty' });
        return;
      }
      setFollowups({ status: 'ready', data: rows });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="command-stack" data-daily-activity="">
      <DailySection id="daily-attention" title="Attention">
        {attention.status === 'loading' ? <PmLoading label="Loading attention" /> : null}
        {attention.status === 'empty' ? <PmEmpty label="No attention items." /> : null}
        {attention.status === 'unavailable' ? <PmUnavailable reason={attention.reason} /> : null}
        {attention.status === 'ready' ? <AttentionBody attention={attention.data} /> : null}
      </DailySection>
      <DailySection id="daily-latest-digest" title="Latest digest">
        {digest.status === 'loading' ? <PmLoading label="Loading latest digest" /> : null}
        {digest.status === 'empty' ? <PmEmpty label="No digest recorded." /> : null}
        {digest.status === 'unavailable' ? <PmUnavailable reason={digest.reason} /> : null}
        {digest.status === 'ready' ? <DigestBody digest={digest.data} /> : null}
      </DailySection>
      <DailySection id="daily-follow-ups" title="Follow-ups">
        {followups.status === 'loading' ? <PmLoading label="Loading follow-ups" /> : null}
        {followups.status === 'empty' ? <PmEmpty label="No open follow-ups." /> : null}
        {followups.status === 'unavailable' ? <PmUnavailable reason={followups.reason} /> : null}
        {followups.status === 'ready' ? <FollowupsBody followups={followups.data} /> : null}
      </DailySection>
    </div>
  );
}
