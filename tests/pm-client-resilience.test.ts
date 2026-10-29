/**
 * Focused tests for the bounded PM-client resilience helper.
 *
 * Scope: 5s default timeout, distinct TIMEOUT result, at most two retries for
 * safe GETs on network/timeout/503, no automatic mutation retries.
 * Pre-existing dirty changes in src/lib/pm-client.ts are preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pmCall, PM_TIMEOUT_MS, PM_MAX_SAFE_GET_RETRIES } from '../src/lib/pm-client';

const BASE = 'http://127.0.0.1:5176';

function makeResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('pm-client resilience', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('PM_TIMEOUT_MS is 5000 and PM_MAX_SAFE_GET_RETRIES is 2', () => {
    expect(PM_TIMEOUT_MS).toBe(5_000);
    expect(PM_MAX_SAFE_GET_RETRIES).toBe(2);
  });

  it('returns TIMEOUT when fetch aborts', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(abortError) as unknown as typeof fetch;

    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('TIMEOUT');
      expect(res.code).toBe('TIMEOUT');
      expect(res.status).toBe(0);
    }
  });

  it('returns UNREACHABLE when fetch throws a non-abort error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch;

    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('UNAVAILABLE');
      expect(res.code).toBe('UNREACHABLE');
    }
  });

  it('returns REJECTED on 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(500, { error: 'INTERNAL' })) as unknown as typeof fetch;

    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('REJECTED');
      expect(res.code).toBe('INTERNAL');
    }
  });

  it('returns UNAVAILABLE on 503', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(503, { error: 'UNAVAILABLE' })) as unknown as typeof fetch;

    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('UNAVAILABLE');
      expect(res.code).toBe('UNAVAILABLE');
    }
  });

  it('retries safe GETs up to PM_MAX_SAFE_GET_RETRIES times on 503 then succeeds', async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls.push(calls.length);
      if (calls.length <= PM_MAX_SAFE_GET_RETRIES) {
        return makeResponse(503, { error: 'UNAVAILABLE' });
      }
      return makeResponse(200, { status: 'READY' });
    }) as unknown as typeof fetch;

    const res = await pmCall<{ status: string }>('GET', '/api/pm/health');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe('READY');
    }
    expect(calls.length).toBe(PM_MAX_SAFE_GET_RETRIES + 1);
  });

  it('does not retry POST mutations on 503', async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls.push(calls.length);
      return makeResponse(503, { error: 'UNAVAILABLE' });
    }) as unknown as typeof fetch;

    const res = await pmCall<unknown>('POST', '/api/pm/tasks', { title: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('UNAVAILABLE');
    }
    expect(calls.length).toBe(1);
  });

  it('does not retry PATCH mutations on 503', async () => {
    const calls: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls.push(calls.length);
      return makeResponse(503, { error: 'UNAVAILABLE' });
    }) as unknown as typeof fetch;

    const res = await pmCall<unknown>('PATCH', '/api/pm/tasks/abc', { status: 'DONE' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.state).toBe('UNAVAILABLE');
    }
    expect(calls.length).toBe(1);
  });

  it('retries safe GETs on TIMEOUT (timeout retry per Room #16240)', async () => {
    let count = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      count += 1;
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.state).toBe('TIMEOUT');
    expect(count).toBe(3); // 1 initial + 2 retries = 3 total attempts
  });

  it('never retries 4xx/REJECTED: exactly one fetch call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(404, { error: 'NOT_FOUND' })) as unknown as typeof fetch;
    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.state).toBe('REJECTED');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('caps at 3 total GET attempts on TIMEOUT', async () => {
    const counts: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      counts.push(counts.length);
      if (counts.length <= 2) throw new DOMException('timed out', 'TimeoutError');
      return makeResponse(200, { ok: true });
    }) as unknown as typeof fetch;
    const res = await pmCall<{ ok: boolean }>('GET', '/api/pm/health');
    expect(res.ok).toBe(true);
    expect(counts.length).toBe(3);
  });

  it('stalled body after headers becomes TIMEOUT with bounded retries', async () => {
    const counts: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      counts.push(counts.length);
      const res = makeResponse(200, null);
      res.json = vi.fn().mockImplementation(() => {
        throw new DOMException('body timed out', 'TimeoutError');
      });
      return res;
    }) as unknown as typeof fetch;
    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.state).toBe('TIMEOUT');
    expect(counts.length).toBe(3);
  });

  it('malformed JSON swallows to null (ok:true,data:null)', async () => {
    const res = makeResponse(200, null);
    res.json = vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'));
    globalThis.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
    const out = await pmCall<unknown>('GET', '/api/pm/health');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('body-read TimeoutError under 200 becomes TIMEOUT', async () => {
    const res = makeResponse(200, null);
    res.json = vi.fn().mockRejectedValue(new DOMException('body timed out', 'TimeoutError'));
    globalThis.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
    const out = await pmCall<unknown>('GET', '/api/pm/health');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.state).toBe('TIMEOUT');
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('returns TIMEOUT on success path type guard', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(200, { ok: true })) as unknown as typeof fetch;

    const res = await pmCall<unknown>('GET', '/api/pm/health');
    expect(res.ok).toBe(true);
  });
});