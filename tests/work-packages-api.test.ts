import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../server/data-service.mjs';
import { readRoomVisibility } from '../server/room-work.mjs';

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
  it('preserves canonical ingestion availability and exact project filtering under #9538', async () => {
    process.env.STARQ_WORKSPACE = 'D:/StarqTech';
    const response = await request('GET', '/api/work-packages?project_id=hoadha');
    expect(response.status).toBe(200);
    const rows = JSON.parse(response.body);
    const expected=readRoomVisibility('D:/StarqTech').work;
    expect(rows).toEqual(expected===null ? null : expected.filter((r:any)=>r.project_id==='hoadha'));
    if(rows) expect(rows.every((r: any) => r.project_id === 'hoadha' && r.record.current_execution === 'UNKNOWN' && r.record.independent_verification === 'UNKNOWN')).toBe(true);
    expect(server.listening).toBe(false);
  });
});
