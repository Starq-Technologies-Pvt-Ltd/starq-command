/**
 * STARQ // COMMAND — communications projection (the messenger).
 *
 * Authority: Founder, 28 Oct 2026 — "Bring Nexus's complete messenger
 * functionality into Command: Common Room, project conversations, groups, DMs,
 * directory, threads, search, message composition and sending. Use the
 * existing canonical Room infrastructure. Make communications LEAN."
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 *
 * Nexus's messenger (CommsMessenger.tsx, 6,936 LOC) rendered a chat over its
 * own comms bus. Command has something Nexus did not: a hash-chained,
 * identity-leased, authority-routed Room ledger with 15,842 real events. This
 * module projects that ledger into the shapes a messenger needs — channels,
 * threads, a people directory, search — WITHOUT inventing a second store.
 *
 * It is READ-ONLY and pure given its input records. The send path lives in the
 * PM service (the Command writer), because writing is a different authority
 * boundary from reading and the two must not be conflated.
 *
 * ── CHANNELS ────────────────────────────────────────────────────────────────
 *
 * A channel is a view over the one ledger, not a separate inbox:
 *
 *   common            every record (the Common Room)
 *   project:<slug>    records whose metadata.project is that slug
 *   dm:<a>~<b>        records between two handles that mention only each other
 *   thread:<eventId>  a record and everything replying beneath it
 *
 * The Room has one true ordering (brokerSequence); channels are filters over
 * it, so a message is never copied and can never disagree with itself.
 *
 * ── LEAN ────────────────────────────────────────────────────────────────────
 *
 * The projection carries exactly what a chat needs and drops the ceremony. An
 * ACK or readiness record is tagged `coordination: true` so the UI can fold
 * the chatter into a quiet line instead of a message bubble — the 41% of
 * traffic that is coordination stops drowning the conversation, without
 * deleting anything from the ledger.
 */

const ev = (r) => r.event ?? r;

/** Records whose whole content is coordination, so the UI can fold them. */
const COORDINATION_RE =
  /^(re:\s*)?(task )?(ack|acknowled|readiness|ready\b|startup|session (binding|bind)|identity verified|lease|.* (verified|received|acknowledged)$|re-?ack|ack-of-ack)/i;

function isCoordination(record) {
  const e = ev(record);
  const subj = (e.metadata?.subject ?? '').trim();
  if (COORDINATION_RE.test(subj)) return true;
  // A record that only confirms receipt, with no task and no action required.
  const status = e.metadata?.status ?? '';
  const needs = e.metadata?.actionRequired ?? '';
  if ((status === 'Received' || status === 'Posted') && (!needs || needs === 'NONE') && !e.taskId) {
    const body = (e.body ?? '').trim();
    if (body.length < 140 && COORDINATION_RE.test(body)) return true;
  }
  return false;
}

/** The DM pair for a record, or null if it is not a 1:1 exchange. */
function dmPair(record) {
  const e = ev(record);
  const from = e.senderHandle;
  const mentions = (e.mentions ?? []).filter((m) => m && m !== from && m !== 'all' && m !== 'room');
  if (!from || mentions.length !== 1) return null;
  if (e.metadata?.project && e.metadata.project !== 'general') return null;
  return [from, mentions[0]].sort().join('~');
}

/**
 * Project one Room record into a chat message. Everything the messenger
 * renders comes from here; nothing is read from the record again downstream.
 */
export function toMessage(record) {
  const e = ev(record);
  const md = e.metadata ?? {};
  const mentions = (e.mentions ?? []).filter(Boolean);
  const project = md.project && md.project !== 'general' ? md.project : null;
  return {
    id: e.eventId ?? record.eventId,
    sequence: record.brokerSequence ?? null,
    from: e.senderHandle ?? 'unknown',
    sender_identity_id: e.senderIdentityId ?? null,
    at: e.createdAt ?? record.receivedAt ?? null,
    received_at: record.receivedAt ?? null,
    type: e.type ?? 'MESSAGE',
    subject: md.subject ?? null,
    body: e.body ?? '',
    mentions,
    project,
    task_id: e.taskId ?? null,
    thread_id: e.threadId ?? null,
    reply_to: e.replyTo ?? null,
    action_required: md.actionRequired && md.actionRequired !== 'NONE' ? md.actionRequired : null,
    status: md.status ?? null,
    references: Array.isArray(md.references) ? md.references : [],
    delivery: record.evaluatedDeliveryType ?? null,
    authority: record.authorityDecision?.senderAuthorityLevel ?? null,
    dm_pair: dmPair(record),
    coordination: isCoordination(record),
    record_hash: record.recordHash ?? null,
    verified: Boolean(record.recordHash),
  };
}

/** The channel directory, derived from the records themselves. */
export function listChannels(records) {
  const projects = new Map();
  const dms = new Map();
  let common = 0;

  for (const r of records) {
    const m = toMessage(r);
    common += 1;
    if (m.project) {
      const c = projects.get(m.project) ?? { count: 0, last_at: null, last_seq: 0 };
      c.count += 1;
      if ((m.sequence ?? 0) > c.last_seq) { c.last_seq = m.sequence ?? 0; c.last_at = m.at; }
      projects.set(m.project, c);
    }
    if (m.dm_pair) {
      const c = dms.get(m.dm_pair) ?? { count: 0, last_at: null, last_seq: 0, members: m.dm_pair.split('~') };
      c.count += 1;
      if ((m.sequence ?? 0) > c.last_seq) { c.last_seq = m.sequence ?? 0; c.last_at = m.at; }
      dms.set(m.dm_pair, c);
    }
  }

  return {
    common: { id: 'common', kind: 'common', label: 'Common Room', count: common },
    projects: [...projects.entries()]
      .map(([slug, c]) => ({ id: `project:${slug}`, kind: 'project', slug, label: slug, ...c }))
      .sort((a, b) => b.last_seq - a.last_seq),
    dms: [...dms.entries()]
      .map(([pair, c]) => ({ id: `dm:${pair}`, kind: 'dm', members: c.members, label: c.members.join(' ↔ '), count: c.count, last_at: c.last_at, last_seq: c.last_seq }))
      .sort((a, b) => b.last_seq - a.last_seq),
  };
}

/** Filter the ledger to one channel, newest last, paginated from the tail. */
export function channelMessages(records, channelId, { limit = 100, before = null, includeCoordination = true } = {}) {
  let filtered;
  if (!channelId || channelId === 'common') {
    filtered = records;
  } else if (channelId.startsWith('project:')) {
    const slug = channelId.slice('project:'.length);
    filtered = records.filter((r) => {
      const p = ev(r).metadata?.project;
      return p === slug || (slug === 'command' && p === 'starq-command') || (slug === 'erp' && p === 'starq-erp');
    });
  } else if (channelId.startsWith('dm:')) {
    const pair = channelId.slice('dm:'.length);
    filtered = records.filter((r) => dmPair(r) === pair);
  } else if (channelId.startsWith('thread:')) {
    return threadMessages(records, channelId.slice('thread:'.length));
  } else {
    filtered = [];
  }

  let messages = filtered.map(toMessage);
  if (!includeCoordination) messages = messages.filter((m) => !m.coordination);
  if (before != null) messages = messages.filter((m) => (m.sequence ?? 0) < before);

  const total = messages.length;
  const page = messages.slice(Math.max(0, messages.length - limit));
  return {
    channel: channelId ?? 'common',
    total,
    returned: page.length,
    has_more: total > page.length,
    oldest_sequence: page.length ? page[0].sequence : null,
    messages: page,
  };
}

/**
 * A thread: the root record and everything beneath it, by replyTo OR threadId.
 * Nexus threads were shallow; Room's replyTo chains can be deep, so this walks
 * the whole reply tree rather than one level.
 */
export function threadMessages(records, rootId) {
  const byId = new Map(records.map((r) => [ev(r).eventId ?? r.eventId, r]));
  const root = byId.get(rootId);
  const inThread = new Set([rootId]);
  // Breadth-first over replyTo edges, plus any record sharing the threadId.
  const rootThreadId = root ? (ev(root).threadId ?? rootId) : rootId;
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of records) {
      const e = ev(r);
      const id = e.eventId ?? r.eventId;
      if (inThread.has(id)) continue;
      if ((e.replyTo && inThread.has(e.replyTo)) || (e.threadId && e.threadId === rootThreadId)) {
        inThread.add(id);
        changed = true;
      }
    }
  }
  const messages = records
    .filter((r) => inThread.has(ev(r).eventId ?? r.eventId))
    .map(toMessage)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return { channel: `thread:${rootId}`, root: rootId, total: messages.length, returned: messages.length, has_more: false, messages };
}

/** Full-text search across bodies and subjects, newest first. */
export function searchMessages(records, query, { limit = 50, from = null, project = null } = {}) {
  const q = (query ?? '').trim().toLowerCase();
  const hits = [];
  for (let i = records.length - 1; i >= 0 && hits.length < limit; i -= 1) {
    const m = toMessage(records[i]);
    if (from && m.from !== from) continue;
    if (project && m.project !== project) continue;
    if (q) {
      const hay = (m.body + ' ' + (m.subject ?? '')).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    hits.push(m);
  }
  return { query: q, from, project, returned: hits.length, messages: hits };
}

/**
 * The people directory, from the canonical identity registry joined with
 * observed Room activity. Retired and revoked handles are shown as such
 * rather than hidden — the directory tells the truth about who is who.
 */
export function peopleDirectory(identities, records) {
  const activity = new Map();
  for (const r of records) {
    const h = ev(r).senderHandle;
    if (!h) continue;
    const a = activity.get(h) ?? { messages: 0, last_at: null, last_seq: 0 };
    a.messages += 1;
    const seq = r.brokerSequence ?? 0;
    if (seq > a.last_seq) { a.last_seq = seq; a.last_at = ev(r).createdAt ?? null; }
    activity.set(h, a);
  }

  const list = (identities?.identities ?? []).map((i) => {
    const handle = i.canonicalHandle ?? i.handle;
    const a = activity.get(handle) ?? { messages: 0, last_at: null };
    return {
      handle,
      display_name: i.displayName ?? handle,
      role: i.role ?? null,
      status: i.status ?? 'unknown',
      authority: i.authorityLevel ?? 'NONE',
      kind: i.authorityLevel === 'ROOT_GENESIS' ? 'founder' : 'agent',
      aliases: i.aliases ?? [],
      avatar: i.avatar ?? null,
      messages: a.messages,
      last_active_at: a.last_at,
    };
  });

  // Handles that posted but are not in the registry are surfaced, not dropped.
  const known = new Set(list.map((p) => p.handle));
  for (const [handle, a] of activity) {
    if (!known.has(handle)) {
      list.push({ handle, display_name: handle, role: null, status: 'unregistered', authority: 'NONE', kind: 'agent', aliases: [], avatar: null, messages: a.messages, last_active_at: a.last_at });
    }
  }
  return list.sort((a, b) => (b.messages - a.messages));
}

/**
 * Build the send-arguments for the canonical send.mjs — the LEAN compose path.
 *
 * The ceremony the Founder objects to is the human proving identity before
 * every message. send.mjs claims or renews the lease internally on post, so
 * the UI needs only: who is sending, where, and the text. Everything else is
 * derived:
 *
 *   - subject defaults to the first line of the body (the missing --subject
 *     that made the PM writer's own postToRoom throw);
 *   - a project channel sets --tag <project> and the structured project;
 *   - a reply sets --reply-to and the body is prefixed so send.mjs accepts it.
 *
 * Integrity is untouched: send.mjs still hash-chains, still stamps identity,
 * still enforces the Founder anti-impersonation rule. Lean is about ceremony,
 * not about weakening the record.
 */
export function buildSendArgs({ from, body, channel = null, replyTo = null, subject = null, actionRequired = null, taskId = null }) {
  if (!from || typeof from !== 'string') throw new Error('from (sender handle) is required');
  if (!body || typeof body !== 'string' || !body.trim()) throw new Error('body is required');

  const firstLine = body.trim().split(/\r?\n/)[0].slice(0, 80);
  const subj = (subject && subject.trim()) || firstLine || 'Message';

  const args = ['--from', from, '--room', '--subject', subj];

  let effectiveBody = body;
  if (replyTo) {
    args.push('--reply-to', replyTo);
    // send.mjs requires a reply body to start with "Reply to #<n>" only when
    // addressed by sequence; an eventId reply is accepted as-is. We pass the
    // eventId and leave the body unmodified.
  }
  if (channel && channel.startsWith('project:')) {
    args.push('--tag', channel.slice('project:'.length));
  }
  if (taskId) args.push('--task', taskId);
  if (actionRequired) args.push('--action-required', actionRequired);

  args.push('--body', effectiveBody);
  return args;
}
