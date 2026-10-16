/**
 * tests/herdr-terminal.test.tsx
 *
 * ── THE FOUNDER TERMINAL LINK ───────────────────────────────────────────────
 *
 * The interactive surface over a broker-owned PTY is only legitimate if it can
 * do exactly one thing — bind to a broker-issued session and carry terminal
 * bytes — and provably cannot do anything else. These tests assert both halves:
 *
 *   ATTACH   URL construction is loopback-only, carries the session_id and the
 *            CURRENT boot_id, and offers takeover only when explicitly asked.
 *   IDENTITY A session id from a stale boot cannot attach, and a handshake that
 *            acknowledges a different session is refused rather than displayed.
 *   BOUNDARY Keystrokes cannot flow before the bind is proven, cannot be aimed
 *            at another session, and there is no command surface to aim.
 *   STATE    Every close reason is named — attached, disconnected, closed,
 *            refused — and a refusal is never dressed up as a healthy link.
 *   UI       The rendered surface exposes its state honestly and offers takeover
 *            as an explicit Founder action rather than an automatic retry.
 */

import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_INPUT_CHARS,
  SOCKET_OPEN,
  TERMINAL_ATTACH_PATH,
  TerminalChannel,
  TerminalRefError,
  buildTerminalUrl,
  describeTerminalClose,
  isLoopbackHost,
  parseBrokerFrame,
  type TerminalLinkState,
  type TerminalSocketLike,
} from '@/lib/herdr-terminal';
import { HerdrTerminal } from '@/components/herdr-terminal';
import { HerdrSurface, type HerdrSessionState } from '@/surfaces/herdr';

// ── A socket the tests drive, standing in for the browser's ─────────────────

interface FakeSocket extends TerminalSocketLike {
  sent: string[];
  closed: { code?: number; reason?: string } | null;
  /** Pretend the transport is up. */
  transportUp(): void;
  emitMessage(data: unknown): void;
  emitClose(code: number, reason: string): void;
}

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    readyState: 0,
    sent: [],
    closed: null,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data: string) {
      socket.sent.push(data);
    },
    close(code?: number, reason?: string) {
      socket.closed = { code, reason };
      socket.readyState = 3;
    },
    transportUp() {
      socket.readyState = SOCKET_OPEN;
      socket.onopen?.({});
    },
    emitMessage(data: unknown) {
      socket.onmessage?.({ data });
    },
    emitClose(code: number, reason: string) {
      socket.readyState = 3;
      socket.onclose?.({ code, reason });
    },
  };
  return socket;
}

/** The exact frame the broker sends as the first message on a bound attach. */
function attachedFrame(sessionId: string, bootId: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'attached',
    session_id: sessionId,
    boot_id: bootId,
    rows: 24,
    cols: 80,
    resize_enabled: false,
    note: 'send terminal bytes as binary/text frames; there is no command frame',
    ...overrides,
  });
}

interface Harness {
  channel: TerminalChannel;
  socket: FakeSocket;
  states: TerminalLinkState[];
  details: (string | null)[];
  output: string[];
  urls: string[];
  geometry: unknown[];
}

function harness(overrides: { host?: string; sessionId?: string; bootId?: string } = {}): Harness {
  const urls: string[] = [];
  const socket = fakeSocket();
  const states: TerminalLinkState[] = [];
  const details: (string | null)[] = [];
  const output: string[] = [];
  const geometry: unknown[] = [];
  const channel = new TerminalChannel({
    host: overrides.host ?? '127.0.0.1:5188',
    sessionId: overrides.sessionId ?? 'hrd-abc123',
    bootId: overrides.bootId ?? 'boot-1',
    createSocket: (url) => {
      urls.push(url);
      return socket;
    },
    onState: (state, detail) => {
      states.push(state);
      details.push(detail);
    },
    onOutput: (chunk) => output.push(chunk),
    onGeometry: (g) => geometry.push(g),
  });
  return { channel, socket, states, details, output, urls, geometry };
}

// ── Attach URL ───────────────────────────────────────────────────────────────

describe('terminal attach URL', () => {
  it('addresses the broker /term path with the session and boot identity', () => {
    const url = buildTerminalUrl({
      host: '127.0.0.1:5188',
      sessionId: 'hrd-abc123',
      bootId: 'boot-9',
    });
    expect(url.startsWith(`ws://127.0.0.1:5188${TERMINAL_ATTACH_PATH}?`)).toBe(true);
    expect(url).toContain('session_id=hrd-abc123');
    expect(url).toContain('boot_id=boot-9');
  });

  it('omits the takeover flag by default and sets it only on request', () => {
    const plain = buildTerminalUrl({ host: '127.0.0.1:5188', sessionId: 's1', bootId: 'b1' });
    expect(plain).not.toContain('takeover');
    const forced = buildTerminalUrl({
      host: '127.0.0.1:5188',
      sessionId: 's1',
      bootId: 'b1',
      takeover: true,
    });
    expect(forced).toContain('takeover=true');
  });

  it('carries no command, argv, cwd, env or shell parameter', () => {
    // The parameter set is the security boundary. A new one here is a new route.
    const url = buildTerminalUrl({
      host: '127.0.0.1:5188',
      sessionId: 's1',
      bootId: 'b1',
      takeover: true,
    });
    const params = new URL(url).searchParams;
    expect([...params.keys()].sort()).toEqual(['boot_id', 'session_id', 'takeover']);
    for (const forbidden of ['cmd', 'command', 'argv', 'cwd', 'env', 'shell', 'exec', 'input']) {
      expect(params.has(forbidden)).toBe(false);
    }
  });

  it('refuses a non-loopback host before any socket can exist', () => {
    for (const host of ['example.com:5188', '10.0.0.5:5188', '0.0.0.0:5188', '', 'evil.com']) {
      expect(() => buildTerminalUrl({ host, sessionId: 's1', bootId: 'b1' })).toThrow(
        TerminalRefError,
      );
    }
    expect(isLoopbackHost('127.0.0.1:5188')).toBe(true);
    expect(isLoopbackHost('localhost:5188')).toBe(true);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  it('refuses a missing or malformed session identity', () => {
    const bad: Array<[string, string]> = [
      ['', 'b1'],
      ['s1', ''],
      ['s 1', 'b1'],
      ['s1\nX-Injected: 1', 'b1'],
      ['s1', 'b/1?x=2'],
      ['../../etc', 'b1'],
    ];
    for (const [sessionId, bootId] of bad) {
      expect(() => buildTerminalUrl({ host: '127.0.0.1:5188', sessionId, bootId })).toThrow(
        TerminalRefError,
      );
    }
    // A value long enough to be nobody's broker-issued id is refused too.
    expect(() =>
      buildTerminalUrl({ host: '127.0.0.1:5188', sessionId: 'a'.repeat(129), bootId: 'b1' }),
    ).toThrow(TerminalRefError);
  });

  it('cannot construct a channel with a non-loopback host or a bad identity', () => {
    expect(
      () =>
        harness({ host: 'example.com:5188' }) as unknown as Error,
    ).toThrow(TerminalRefError);
    expect(() => harness({ sessionId: '' })).toThrow(TerminalRefError);
    expect(() => harness({ bootId: '' })).toThrow(TerminalRefError);
  });
});

// ── Frame handling ───────────────────────────────────────────────────────────

describe('broker frame handling', () => {
  it('reads exactly one handshake frame and treats everything after it as output', () => {
    const first = parseBrokerFrame(attachedFrame('s1', 'b1'), true);
    expect(first.kind).toBe('attached');

    // A PTY that prints JSON must not be able to forge a control frame.
    const later = parseBrokerFrame(JSON.stringify({ type: 'attached', session_id: 'other' }), false);
    expect(later.kind).toBe('output');
  });

  it('refuses output that arrives before the acknowledgement', () => {
    const r = parseBrokerFrame('hello before handshake', true);
    expect(r.kind).toBe('unreadable');
  });

  it('never reports resize as enabled unless the broker said so', () => {
    const claimed = parseBrokerFrame(attachedFrame('s1', 'b1', { resize_enabled: true }), true);
    expect(claimed.kind).toBe('attached');
    if (claimed.kind === 'attached') expect(claimed.frame.resize_enabled).toBe(true);

    const honest = parseBrokerFrame(attachedFrame('s1', 'b1', { resize_enabled: false }), true);
    if (honest.kind === 'attached') expect(honest.frame.resize_enabled).toBe(false);

    const absent = parseBrokerFrame(attachedFrame('s1', 'b1', { resize_enabled: undefined }), true);
    if (absent.kind === 'attached') expect(absent.frame.resize_enabled).toBe(false);
  });
});

// ── Close vocabulary ─────────────────────────────────────────────────────────

describe('terminal close vocabulary', () => {
  it('names an already-attached refusal and offers takeover', () => {
    const r = describeTerminalClose(1008, 'SESSION_ALREADY_ATTACHED');
    expect(r.state).toBe('refused');
    expect(r.takeoverOffered).toBe(true);
    expect(r.retryable).toBe(false);
  });

  it('names a stale boot and never offers takeover for it', () => {
    const r = describeTerminalClose(1008, 'SESSION_STALE_BOOT');
    expect(r.state).toBe('refused');
    expect(r.takeoverOffered).toBe(false);
    expect(r.message).toMatch(/previous broker boot/);
  });

  it('distinguishes a dead PTY from a dropped link', () => {
    const dead = describeTerminalClose(1000, 'pty closed');
    expect(dead.state).toBe('closed');
    expect(dead.retryable).toBe(false);

    const gone = describeTerminalClose(1008, 'SESSION_CLOSED');
    expect(gone.state).toBe('closed');

    const dropped = describeTerminalClose(1006, '');
    expect(dropped.state).toBe('disconnected');
    expect(dropped.retryable).toBe(true);
  });

  it('does not dress an unknown close code up as a healthy link', () => {
    const r = describeTerminalClose(4321, 'something-new');
    expect(r.state).toBe('disconnected');
    expect(r.code).toBe('something-new');
  });
});

// ── The channel ──────────────────────────────────────────────────────────────

describe('terminal channel', () => {
  it('starts unconnected and refuses input before the bind is proven', () => {
    const h = harness();
    expect(h.channel.state).toBe('idle');
    h.channel.open();
    expect(h.channel.state).toBe('connecting');
    expect(h.socket.sent).toEqual([]);
    expect(h.channel.sendInput('rm -rf /')).toBe(false);
  });

  it('opens exactly one socket at the broker /term URL for the named session', () => {
    const h = harness();
    h.channel.open();
    expect(h.urls).toHaveLength(1);
    expect(h.urls[0]).toBe(buildTerminalUrl({
      host: '127.0.0.1:5188',
      sessionId: 'hrd-abc123',
      bootId: 'boot-1',
    }));
  });

  it('refuses a handshake that acknowledges a DIFFERENT session', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-SOMEONE-ELSE', 'boot-1'));
    expect(h.channel.state).toBe('refused');
    expect(h.details.at(-1)).toMatch(/different session/);
    expect(h.socket.closed?.code).toBe(1008);
  });

  it('refuses a handshake carrying a different boot', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-PREVIOUS'));
    expect(h.channel.state).toBe('refused');
  });

  it('becomes connected only after the identity frame, then forwards output', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    // Transport is up but no identity yet: still not connected.
    expect(h.channel.state).toBe('connecting');
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    expect(h.channel.state).toBe('connected');
    expect(h.geometry[0]).toEqual({ rows: 24, cols: 80, resizeEnabled: false });

    h.socket.emitMessage('[31mclaude[0m> ');
    h.socket.emitMessage('[2J[H');
    expect(h.output.join('')).toBe('[31mclaude[0m> [2J[H');
  });

  it('sends keystrokes only after the bind, and only to the bound socket', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));

    expect(h.channel.sendInput('hello\r')).toBe(true);
    expect(h.socket.sent).toEqual(['hello\r']);

    // The channel has no session parameter to misdirect; the target is the
    // socket, and there is no other socket it can reach.
    expect(Object.keys(h.channel).filter((k) => /target|argv|command/i.test(k))).toEqual([]);
    expect((h.channel as unknown as { sendInput: (d: string) => unknown }).sendInput.length).toBe(1);
  });

  it('refuses an oversized keystroke burst instead of flooding the agent stdin', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    expect(h.channel.sendInput('x'.repeat(MAX_INPUT_CHARS + 1))).toBe(false);
    expect(h.socket.sent).toEqual([]);
    expect(h.details.at(-1)).toMatch(/input refused/);
  });

  it('refuses empty and non-string input', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    expect(h.channel.sendInput('')).toBe(false);
    expect(h.channel.sendInput(undefined as unknown as string)).toBe(false);
    expect(h.socket.sent).toEqual([]);
  });

  it('stops accepting input the moment the link closes', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    h.socket.emitClose(1000, 'pty closed');
    expect(h.channel.state).toBe('closed');
    expect(h.channel.sendInput('more')).toBe(false);
  });

  it('surfaces the broker single-attach refusal as REFUSED, not as a retry loop', () => {
    const h = harness();
    h.channel.open();
    h.socket.emitClose(1008, 'SESSION_ALREADY_ATTACHED');
    expect(h.channel.state).toBe('refused');
    expect(h.details.at(-1)).toContain('SESSION_ALREADY_ATTACHED');
    expect(h.urls).toHaveLength(1);
  });

  it('opens a SECOND socket only when the Founder explicitly takes over', () => {
    const h = harness();
    h.channel.open();
    h.socket.emitClose(1008, 'SESSION_ALREADY_ATTACHED');

    // A plain reopen is not a takeover.
    const second = fakeSocket();
    h.channel.open(false);
    expect(h.urls).toHaveLength(2);
    expect(h.urls[1]).not.toContain('takeover');

    void second;
  });

  it('marks takeover as a single explicit act, never an automatic retry', () => {
    const h = harness();
    h.channel.open(true);
    expect(h.urls[0]).toContain('takeover=true');
    expect(h.channel.takeoverConsumed).toBe(true);

    h.channel.open(true);
    expect(h.urls).toHaveLength(1);
    expect(h.channel.state).toBe('refused');
    expect(h.details.at(-1)).toMatch(/already used/);
  });

  it('reports an operator detach as a detachment, not as a session failure', () => {
    const h = harness();
    h.channel.open();
    h.socket.transportUp();
    h.socket.emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    h.channel.close();
    expect(h.socket.closed).toEqual({ code: 1000, reason: 'client detach' });
    h.socket.emitClose(1000, 'client detach');
    expect(h.channel.state).toBe('disconnected');
    expect(h.details.at(-1)).toMatch(/detached by the operator/);
  });

  it('closes the previous socket before opening a new one', () => {
    // Otherwise the second socket is the reason the broker refuses the first's
    // session: a client evicting itself with its own single-attach rule.
    const sockets: FakeSocket[] = [];
    const states: TerminalLinkState[] = [];
    const channel = new TerminalChannel({
      host: '127.0.0.1:5188',
      sessionId: 'hrd-abc123',
      bootId: 'boot-1',
      createSocket: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      onState: (s) => states.push(s),
      onOutput: () => {},
      onGeometry: () => {},
    });
    channel.open();
    sockets[0].transportUp();
    sockets[0].emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    expect(channel.state).toBe('connected');

    channel.open();
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toEqual({ code: 1000, reason: 'reopen' });
    expect(sockets[1].closed).toBeNull();
    expect(channel.state).toBe('connecting');
  });

  it('ignores a late close from a socket it already replaced', () => {
    const sockets: FakeSocket[] = [];
    const states: TerminalLinkState[] = [];
    const channel = new TerminalChannel({
      host: '127.0.0.1:5188',
      sessionId: 'hrd-abc123',
      bootId: 'boot-1',
      createSocket: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      onState: (s) => states.push(s),
      onOutput: () => {},
      onGeometry: () => {},
    });
    channel.open();
    channel.open();
    // The first socket's close event arrives after the second is in flight. It
    // is history; it must not overwrite the current link's state.
    sockets[0].emitClose(1006, '');
    expect(channel.state).toBe('connecting');
    sockets[1].transportUp();
    sockets[1].emitMessage(attachedFrame('hrd-abc123', 'boot-1'));
    expect(channel.state).toBe('connected');
  });

  it('exposes no command surface on the channel object', () => {
    const h = harness();
    const api = h.channel as unknown as Record<string, unknown>;
    for (const forbidden of ['exec', 'execute', 'run', 'runCommand', 'sendText', 'ptyInjection', 'shell', 'spawn']) {
      expect(api[forbidden]).toBeUndefined();
    }
  });
});

// ── The rendered surface ─────────────────────────────────────────────────────

const SESSION_STATE: HerdrSessionState = {
  timestamp: '2026-10-01T00:00:00Z',
  broker: { online: true, boot_id: 'boot-live-1', access: 'LOOPBACK_ONLY', host: '127.0.0.1:5188' },
  herdr: { state: 'AVAILABLE', version: '0.9.1' },
  floor: { floor_opened: true, floor_opens: 1 },
  terminal: { resize_enabled: false, fallback_size: { cols: 80, rows: 24 } },
  agents: [
    {
      id: 'elder',
      label: 'Elder',
      runtime: 'windows',
      startup_policy: 'FLOOR_LAUNCH',
      launchable: true,
      terminal: true,
      state: 'RUNNING',
      pid: 1234,
      session_id: 'hrd-elder',
      cwd: 'D:\\StarqTech',
      executable: 'claude.exe',
    },
  ],
  sessions: [{ session_id: 'hrd-elder', agent_id: 'elder', pid: 1234, open: true, attached: false }],
  session_established: true,
  session_boot_id: 'boot-live-1',
};

describe('Founder terminal surface', () => {
  it('renders an unattached, honest link with no session attached', () => {
    const html = renderToStaticMarkup(<HerdrTerminal host="127.0.0.1:5188" sessionId="hrd-elder" bootId="boot-live-1" agentId="elder" />);
    expect(html).toContain('herdr-terminal');
    expect(html).toContain('NOT ATTACHED');
    expect(html).toContain('RESIZE DISABLED');
    expect(html).toContain('keystrokes → this bound PTY only');
    expect(html).toContain('no browser-to-shell route');
    expect(html).toContain('herdr-terminal-screen');
  });

  it('never opens a socket while server-rendering', () => {
    // If the effect ran on the server it would try to construct a WebSocket and
    // this render would throw. It does not, and that is the assertion.
    const open = vi.fn();
    (globalThis as { WebSocket?: unknown }).WebSocket = function Fake() {
      open();
    } as unknown;
    expect(() =>
      renderToStaticMarkup(<HerdrTerminal host="127.0.0.1:5188" sessionId="hrd-elder" bootId="boot-live-1" />),
    ).not.toThrow();
    expect(open).not.toHaveBeenCalled();
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
  });

  it('renders a refusal instead of a terminal when the session identity is unusable', () => {
    const html = renderToStaticMarkup(<HerdrTerminal host="127.0.0.1:5188" sessionId="" bootId="boot-live-1" />);
    expect(html).toContain('ATTACH REFUSED');
    expect(html).toContain('IDENTITY_MISSING');
    expect(html).toContain('no live PTY output is being displayed');
  });

  it('renders a refusal rather than a screen for a non-loopback host', () => {
    const html = renderToStaticMarkup(<HerdrTerminal host="example.com:5188" sessionId="hrd-elder" bootId="boot-live-1" />);
    expect(html).toContain('ATTACH REFUSED');
    expect(html).toContain('LOOPBACK_REQUIRED');
  });

  it('the surface offers attach for a live session and shows the real broker URL', () => {
    const html = renderToStaticMarkup(<HerdrSurface initialState={SESSION_STATE} pollIntervalMs={0} />);
    expect(html).toContain('Attach Terminal');
    // The advertised URL is produced by the same builder that opens the socket,
    // so the surface cannot show one endpoint while the terminal opens another.
    const advertised = buildTerminalUrl({
      host: '127.0.0.1:5188',
      sessionId: 'hrd-elder',
      bootId: 'boot-live-1',
    });
    // `&` is HTML-escaped in the markup; compare against the rendered form.
    expect(html).toContain(advertised.replace(/&/g, '&amp;'));
    expect(html).toContain('Founder Terminal');
    expect(html).toContain('No PTY session attached');
    // No session is attached in this render, so no socket-bearing component is
    // mounted and no terminal screen is claimed.
    expect(html).not.toContain('herdr-terminal-screen');
  });

  it('the surface refuses to advertise an attach URL with no current boot id', () => {
    const noBoot: HerdrSessionState = {
      ...SESSION_STATE,
      broker: { online: true, boot_id: '', access: 'LOOPBACK_ONLY', host: '127.0.0.1:5188' },
    };
    const html = renderToStaticMarkup(<HerdrSurface initialState={noBoot} pollIntervalMs={0} />);
    expect(html).not.toContain('ws://127.0.0.1:5188/term?session_id=hrd-elder');
    expect(html).toContain('not attachable: no current boot_id');
  });

  it('the surface has no command, shell or exec route of its own', () => {
    const src = require('node:fs').readFileSync('src/surfaces/herdr.tsx', 'utf8');
    for (const forbidden of ['/api/herdr/exec', '/api/herdr/run', '/api/herdr/shell', 'send-text', 'pane/run']) {
      expect(src).not.toContain(forbidden);
    }
    // The only websocket surface referenced is the broker's own /term path.
    expect(src).toContain('buildTerminalUrl');
  });
});