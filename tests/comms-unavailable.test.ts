/**
 * An unreadable Room is not an empty channel directory.
 * The handler is invoked in-process. It does not bind a port or read the live ledger.
 */
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

describe('unavailable Room communications', () => {
  it('does not present channels, messages, or search as an empty success', async () => {
    roomSnapshotMock.mockReturnValue({
      state: 'UNAVAILABLE',
      reason: 'Room ledger unreadable',
      records: [],
    });
    const channels = await request('/api/comms/channels');
    const messages = await request('/api/comms/messages?channel=common');
    const search = await request('/api/comms/search?q=status');
    for (const response of [channels, messages, search]) {
      expect(response.status).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.state).toBe('UNAVAILABLE');
      expect(body.error).toBe('Room ledger unreadable');
      expect(body.channels).toBeUndefined();
      expect(body.messages).toBeUndefined();
      expect(body.record_count).toBeUndefined();
    }
  });

  it('still returns a real empty directory when the Room read succeeds with no records', async () => {
    roomSnapshotMock.mockReturnValue({
      state: 'OK',
      reason: null,
      records: [],
      tailSequence: 0,
      tailHash: 'abc',
      recordCount: 0,
    });
    const response = await request('/api/comms/channels');
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.state).toBe('OK');
    expect(body.channels.common.count).toBe(0);
    expect(body.channels.projects).toEqual([]);
    expect(body.channels.dms).toEqual([]);
  });
});
