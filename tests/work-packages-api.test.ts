import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../server/data-service.mjs';

const { roomVisibilityMock } = vi.hoisted(() => ({
  roomVisibilityMock: vi.fn(() => ({ work: null })),
}));
vi.mock('../server/room-work.mjs', () => ({ readRoomVisibility: roomVisibilityMock }));

async function request(method: string, url: string) {
  return new Promise<{ status: number; body: string; headers: Record<string, string> }>((resolve) => {
    const response = {
      status: 0,
      headers: {} as Record<string, string>,
      writeHead(status: number, headers: Record<string, string>) {
        this.status = status;
        this.headers = headers;
        return this;
      },
      end(body = '') {
        resolve({ status: this.status, body: String(body), headers: this.headers });
        return this;
      },
    };

    // Exercise the existing route handler without binding a port or starting a service.
    server.emit(
      'request',
      { method, url, headers: { host: '127.0.0.1' } } as never,
      response as never,
    );
  });
}

const priorObservationMode = process.env.COMMAND_OBSERVATION_ONLY;
const priorRoot = process.env.STARQ_WORKSPACE;
beforeEach(() => { process.env.STARQ_WORKSPACE = 'D:/__command_missing_fixture_root__'; });
afterEach(() => {
  roomVisibilityMock.mockReset();
  roomVisibilityMock.mockReturnValue({ work: null });
  if (priorObservationMode === undefined) delete process.env.COMMAND_OBSERVATION_ONLY;
  else process.env.COMMAND_OBSERVATION_ONLY = priorObservationMode;
  if (priorRoot === undefined) delete process.env.STARQ_WORKSPACE;
  else process.env.STARQ_WORKSPACE = priorRoot;
});

describe('GET /api/work-packages', () => {
  it('returns UNKNOWN as null when no current canonical package sources are supported', async () => {
    expect(server.listening).toBe(false);
    const response = await request('GET', '/api/work-packages?project_id=erp');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toBeNull();
    expect(response.headers['x-starq-command-access']).toBe('READ_ONLY');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(server.listening).toBe(false);
  });

  it('is available in the existing observation-only route allowlist', async () => {
    process.env.COMMAND_OBSERVATION_ONLY = '1';
    const response = await request('GET', '/api/work-packages');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toBeNull();
  });

  it('refuses write methods through the data service read-only boundary', async () => {
    const response = await request('POST', '/api/work-packages');
    expect(response.status).toBe(405);
    expect(server.listening).toBe(false);
  });
  it('preserves exact project filtering without reading the live Room in this API test', async () => {
    const rows = [
      { project_id: 'hoadha', id: 'fixture-hoadha', record: { current_execution: 'UNKNOWN', independent_verification: 'UNKNOWN' } },
      { project_id: 'starq-erp', id: 'fixture-erp', record: { current_execution: 'UNKNOWN', independent_verification: 'UNKNOWN' } },
    ];
    roomVisibilityMock.mockReturnValue({ work: rows });
    const response = await request('GET', '/api/work-packages?project_id=hoadha');
    expect(response.status).toBe(200);
    const result = JSON.parse(response.body);
    expect(result).toEqual([rows[0]]);
    expect(result.every((r: any) => r.project_id === 'hoadha' && r.record.current_execution === 'UNKNOWN' && r.record.independent_verification === 'UNKNOWN')).toBe(true);
    expect(server.listening).toBe(false);
  });
});
