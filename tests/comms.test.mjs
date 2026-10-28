/**
 * Communications projection — Founder 28 Oct.
 * Standalone, opens nothing: node --test tests/comms.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSendArgs,
  channelMessages,
  listChannels,
  peopleDirectory,
  searchMessages,
  threadMessages,
  toMessage,
} from '../server/comms.mjs';

// A tiny synthetic ledger in the real record shape.
function rec(seq, over = {}) {
  return {
    brokerSequence: seq,
    receivedAt: `2026-10-28T00:0${seq}:00.000Z`,
    eventId: over.eventId ?? `ev${seq}`,
    recordHash: `hash${seq}`,
    evaluatedDeliveryType: over.delivery ?? 'CC_CONTEXT',
    authorityDecision: { senderAuthorityLevel: over.authority ?? 'CORE_AGENT' },
    event: {
      createdAt: `2026-10-28T00:0${seq}:00.000Z`,
      senderHandle: over.from ?? 'codex',
      senderIdentityId: 'ident_x',
      type: over.type ?? 'MESSAGE',
      body: over.body ?? `message ${seq}`,
      mentions: over.mentions ?? [],
      taskId: over.taskId ?? null,
      threadId: over.threadId ?? null,
      replyTo: over.replyTo ?? null,
      metadata: {
        subject: over.subject ?? `subject ${seq}`,
        status: over.status ?? 'Posted',
        actionRequired: over.actionRequired ?? 'NONE',
        references: [],
        project: over.project ?? 'general',
      },
    },
  };
}

const ledger = [
  rec(1, { from: 'mustarq', authority: 'ROOT_GENESIS', body: 'kick off', project: 'command' }),
  rec(2, { from: 'codex', project: 'command', subject: 'Task ACK: CMD-1', body: 'ack', status: 'Received' }),
  rec(3, { from: 'claude', project: 'starq-erp', body: 'erp note' }),
  rec(4, { from: 'codex', mentions: ['claude'], body: 'dm hi claude', subject: 'ping' }),
  rec(5, { from: 'claude', mentions: ['codex'], body: 'dm reply', subject: 'pong' }),
  rec(6, { from: 'claude', eventId: 'root', body: 'start a thread', subject: 'thread root' }),
  rec(7, { from: 'codex', replyTo: 'root', body: 'first reply' }),
  rec(8, { from: 'antigravity', replyTo: 'ev7', body: 'nested reply' }),
];

test('a record projects to the fields a chat needs', () => {
  const m = toMessage(ledger[0]);
  assert.equal(m.from, 'mustarq');
  assert.equal(m.project, 'command');
  assert.equal(m.authority, 'ROOT_GENESIS');
  assert.equal(m.verified, true);
  assert.equal(m.sequence, 1);
});

test('ACK/readiness is tagged coordination, not deleted', () => {
  const ack = toMessage(ledger[1]);
  assert.equal(ack.coordination, true, 'Task ACK folds');
  const real = toMessage(ledger[0]);
  assert.equal(real.coordination, false);
});

test('channels are derived: common, projects, DMs', () => {
  const ch = listChannels(ledger);
  assert.equal(ch.common.count, 8);
  const slugs = ch.projects.map((p) => p.slug).sort();
  assert.deepEqual(slugs, ['command', 'starq-erp']);
  assert.equal(ch.dms.length, 1);
  assert.deepEqual(ch.dms[0].members, ['claude', 'codex']);
});

test('a project channel filters to its records', () => {
  const r = channelMessages(ledger, 'project:command');
  assert.equal(r.total, 2);
  assert.ok(r.messages.every((m) => m.project === 'command'));
});

test('coordination can be excluded from a channel view', () => {
  const withAck = channelMessages(ledger, 'project:command', { includeCoordination: true });
  const without = channelMessages(ledger, 'project:command', { includeCoordination: false });
  assert.equal(withAck.total, 2);
  assert.equal(without.total, 1, 'the ACK is folded out');
});

test('a DM channel shows only that pair', () => {
  const r = channelMessages(ledger, 'dm:claude~codex');
  assert.equal(r.total, 2);
  assert.deepEqual(r.messages.map((m) => m.body).sort(), ['dm hi claude', 'dm reply']);
});

test('a thread walks the full reply tree, not one level', () => {
  const t = threadMessages(ledger, 'root');
  // root -> ev7 (replyTo root) -> ev8 (replyTo ev7)
  assert.deepEqual(t.messages.map((m) => m.id), ['root', 'ev7', 'ev8']);
});

test('search matches body and subject, newest first, with filters', () => {
  const all = searchMessages(ledger, 'reply');
  assert.ok(all.messages.length >= 2);
  assert.ok(all.messages[0].sequence > all.messages[all.messages.length - 1].sequence, 'newest first');

  const byFrom = searchMessages(ledger, '', { from: 'claude' });
  assert.ok(byFrom.messages.every((m) => m.from === 'claude'));

  const byProject = searchMessages(ledger, '', { project: 'starq-erp' });
  assert.ok(byProject.messages.every((m) => m.project === 'starq-erp'));
});

test('the directory joins identities with observed activity and hides nobody', () => {
  const identities = {
    identities: [
      { canonicalHandle: 'codex', displayName: 'Codex', role: 'Builder', status: 'active', authorityLevel: 'CORE_AGENT' },
      { canonicalHandle: 'mustarq', displayName: 'Founder', role: 'Founder', status: 'active', authorityLevel: 'ROOT_GENESIS' },
    ],
  };
  const people = peopleDirectory(identities, ledger);
  const codex = people.find((p) => p.handle === 'codex');
  assert.ok(codex.messages >= 2);
  const founder = people.find((p) => p.handle === 'mustarq');
  assert.equal(founder.kind, 'founder');
  // claude and antigravity posted but are not in this tiny registry -> surfaced
  assert.ok(people.find((p) => p.handle === 'claude' && p.status === 'unregistered'));
  assert.ok(people.find((p) => p.handle === 'antigravity' && p.status === 'unregistered'));
});

test('compose derives a subject from the first line (the missing --subject)', () => {
  const args = buildSendArgs({ from: 'claude', body: 'Hello team\nsecond line' });
  const i = args.indexOf('--subject');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], 'Hello team');
  assert.ok(args.includes('--from'));
  assert.ok(args.includes('--room'));
  assert.equal(args[args.length - 2], '--body');
});

test('compose maps a project channel to a tag and a reply to --reply-to', () => {
  const args = buildSendArgs({ from: 'claude', body: 'in erp', channel: 'project:erp' });
  const ti = args.indexOf('--tag');
  assert.equal(args[ti + 1], 'erp');

  const reply = buildSendArgs({ from: 'claude', body: 'replying', replyTo: 'ev123' });
  const ri = reply.indexOf('--reply-to');
  assert.equal(reply[ri + 1], 'ev123');
});

test('compose refuses an empty sender or body', () => {
  assert.throws(() => buildSendArgs({ from: '', body: 'x' }));
  assert.throws(() => buildSendArgs({ from: 'claude', body: '  ' }));
});
