/**
 * An unreadable Room is not an empty channel directory.
 * The handler is invoked in-process. It does not bind a port or read the live ledger.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../server/data-service.mjs';

const { roomSnapshotMock } = vi.hoisted(() => ({
  roomSnapshotMock: vi.fn(),
}));

vi.mock('../server/room-snapshot.mjs', () => ({
  readRoomSnapshot: roomSnapshotMock,
  readRoomBoundSnapshot: vi.fn(),
  readRoomRawPrefix: vi.fn(),
}));

async function request(url: string) {
  return new Promise<{ status: number; body: string }>((resolve) => {
    const response = {
      status: 0,
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(body = '') {
        resolve({ status: this.status, body: String(body) });
        return this;
      },
    };
    server.emit(
      'request',
      { method: 'GET', url, headers: { host: '127.0.0.1' } } as never,
      response as never,
    );
  });
}

const priorRoot = process.env.STARQ_WORKSPACE;
beforeEach(() => {
  process.env.STARQ_WORKSPACE = 'D:/__command_missing_fixture_root__';
  roomSnapshotMock.mockReset();
});
afterEach(() => {
  if (priorRoot === undefined) delete process.env.STARQ_WORKSPACE;
  else process.env.STARQ_WORKSPACE = priorRoot;
});

function identityWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-comms-'));
  fs.writeFileSync(path.join(root, 'STARQ.md'), '# fixture\n');
  fs.mkdirSync(path.join(root, '00_STARQ_HQ'));
  const identities = path.join(root, 'agent-comms', 'protocol', 'v1');
  fs.mkdirSync(identities, { recursive: true });
  fs.writeFileSync(path.join(identities, 'identities.json'), JSON.stringify({
    identities: [{
      canonicalHandle: 'codex',
      displayName: 'Codex',
      status: 'active',
      authorityLevel: 'OPERATOR',
      role: 'engineer',
    }],
  }));
  return root;
}

function roomOk(records: unknown[], tailHash: string) {
  return {
    state: 'OK',
    reason: null,
    records,
    tailSequence: records.length,
    tailHash,
    recordCount: records.length,
  };
}

const note = {
  brokerSequence: 7,
  event: {
    eventId: 'evt-7',
    senderHandle: 'codex',
    createdAt: '2026-11-02T12:00:00.000Z',
    body: 'canal gate holds',
    mentions: [],
    metadata: { subject: 'gate', project: 'command' },
  },
};

describe('unavailable Room communications', () => {
  it('does not present channels, messages, search, or people as an empty success', async () => {
    roomSnapshotMock.mockReturnValue({
      state: 'UNAVAILABLE',
      reason: 'Room ledger unreadable',
      records: [],
    });
    const channels = await request('/api/comms/channels');
    const messages = await request('/api/comms/messages?channel=common');
    const search = await request('/api/comms/search?q=status');
    const people = await request('/api/comms/people');
    for (const response of [channels, messages, search, people]) {
      expect(response.status).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.state).toBe('UNAVAILABLE');
      expect(body.error).toBe('Room ledger unreadable');
      expect(body.channels).toBeUndefined();
      expect(body.messages).toBeUndefined();
      expect(body.people).toBeUndefined();
      expect(body.record_count).toBeUndefined();
    }
  });

  it('does not return the identity registry as a people directory when Room is unavailable', async () => {
    const root = identityWorkspace();
    process.env.STARQ_WORKSPACE = root;
    try {
      roomSnapshotMock.mockReturnValue({
        state: 'UNAVAILABLE',
        reason: 'Room ledger unreadable',
        records: [],
      });
      const response = await request('/api/comms/people');
      expect(response.status).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.state).toBe('UNAVAILABLE');
      expect(body.error).toBe('Room ledger unreadable');
      expect(body.people).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an unreadable Room state without an empty directory', async () => {
    roomSnapshotMock.mockReturnValue({
      state: 'UNREADABLE',
      reason: 'Room ledger parse failed',
      records: null,
    });
    const response = await request('/api/comms/people');
    expect(response.status).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.state).toBe('UNREADABLE');
    expect(body.error).toBe('Room ledger parse failed');
    expect(body.people).toBeUndefined();
  });

  it('still returns a real empty directory when the Room read succeeds with no records', async () => {
    roomSnapshotMock.mockReturnValue(roomOk([], 'empty-ledger'));
    const channels = await request('/api/comms/channels');
    const messages = await request('/api/comms/messages?channel=common');
    const search = await request('/api/comms/search?q=status');
    const people = await request('/api/comms/people');
    expect(channels.status).toBe(200);
    const channelBody = JSON.parse(channels.body);
    expect(channelBody.state).toBe('OK');
    expect(channelBody.channels.common.count).toBe(0);
    expect(channelBody.channels.projects).toEqual([]);
    expect(channelBody.channels.dms).toEqual([]);
    expect(messages.status).toBe(200);
    expect(JSON.parse(messages.body).messages).toEqual([]);
    expect(search.status).toBe(200);
    expect(JSON.parse(search.body).messages).toEqual([]);
    expect(people.status).toBe(200);
    expect(JSON.parse(people.body)).toEqual({ state: 'OK', people: [] });
  });

  it('keeps a successful empty ledger with registered people and zero activity', async () => {
    const root = identityWorkspace();
    process.env.STARQ_WORKSPACE = root;
    try {
      roomSnapshotMock.mockReturnValue(roomOk([], 'empty-with-identities'));
      const response = await request('/api/comms/people');
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.state).toBe('OK');
      expect(body.people).toEqual([
        expect.objectContaining({ handle: 'codex', display_name: 'Codex', messages: 0, status: 'active' }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the healthy channel, message, search, and people contracts', async () => {
    const root = identityWorkspace();
    process.env.STARQ_WORKSPACE = root;
    try {
      roomSnapshotMock.mockReturnValue(roomOk([note], 'healthy-ledger'));
      const channels = await request('/api/comms/channels');
      const messages = await request('/api/comms/messages?channel=common');
      const search = await request('/api/comms/search?q=canal');
      const people = await request('/api/comms/people');
      expect(channels.status).toBe(200);
      const channelBody = JSON.parse(channels.body);
      expect(channelBody.state).toBe('OK');
      expect(channelBody.record_count).toBe(1);
      expect(channelBody.channels.common.count).toBe(1);
      expect(channelBody.channels.projects.map((row: { id: string }) => row.id)).toEqual(['project:command']);
      expect(messages.status).toBe(200);
      expect(JSON.parse(messages.body).messages.map((row: { body: string }) => row.body)).toEqual(['canal gate holds']);
      expect(search.status).toBe(200);
      expect(JSON.parse(search.body).messages.map((row: { body: string }) => row.body)).toEqual(['canal gate holds']);
      expect(people.status).toBe(200);
      expect(JSON.parse(people.body).people).toEqual([
        expect.objectContaining({ handle: 'codex', messages: 1, last_active_at: '2026-11-02T12:00:00.000Z' }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves a later successful read after a Room failure, and a later failure after a success', async () => {
    const root = identityWorkspace();
    process.env.STARQ_WORKSPACE = root;
    try {
      roomSnapshotMock.mockReturnValue({
        state: 'UNAVAILABLE',
        reason: 'Room ledger unreadable',
        records: [],
      });
      const failed = await request('/api/comms/people');
      expect(failed.status).toBe(503);
      expect(JSON.parse(failed.body).people).toBeUndefined();

      roomSnapshotMock.mockReturnValue(roomOk([note], 'recovered-ledger'));
      const recovered = await request('/api/comms/channels');
      const recoveredPeople = await request('/api/comms/people');
      expect(recovered.status).toBe(200);
      expect(JSON.parse(recovered.body).channels.common.count).toBe(1);
      expect(recoveredPeople.status).toBe(200);
      expect(JSON.parse(recoveredPeople.body).people[0].messages).toBe(1);

      roomSnapshotMock.mockReturnValue({
        state: 'UNAVAILABLE',
        reason: 'Room ledger unreadable',
        records: [],
      });
      const failedAgain = await request('/api/comms/messages?channel=common');
      expect(failedAgain.status).toBe(503);
      expect(JSON.parse(failedAgain.body).messages).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
