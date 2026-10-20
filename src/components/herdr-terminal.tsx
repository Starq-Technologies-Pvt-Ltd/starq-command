/**
 * src/components/herdr-terminal.tsx — the Founder's interactive terminal.
 *
 * ── WHAT THIS COMPONENT IS ──────────────────────────────────────────────────
 *
 * A viewport onto ONE broker-owned PTY session. It opens the broker's existing
 * `/term` websocket, writes live PTY bytes into an emulator, and forwards
 * keystrokes back on that same socket.
 *
 * ── WHAT IT DELIBERATELY DOES NOT HAVE ──────────────────────────────────────
 *
 *   · No argv, cwd, env or command field. There is no way to describe a process
 *     here; the broker issued the session and Command does not get a vote.
 *   · No target-session selector on a keystroke. The socket is bound to one
 *     PTY by the broker, and this component can only talk to the socket it
 *     opened.
 *   · No resize. `RESIZE_PROVEN` is false in the broker and the handshake frame
 *     reports `resize_enabled`; until the broker says otherwise the geometry
 *     shown is the geometry the broker fixed, and the component never calls
 *     resize on it. An unproven resize that is silently wrong is worse than a
 *     fixed 80x24.
 *   · No automatic takeover. Being refused the seat is shown, with the
 *     takeover offered as a separate button the Founder presses.
 *
 * ── WHY THE EMULATOR LOADS LAZILY ───────────────────────────────────────────
 *
 * xterm needs a DOM at construction, and this module is also server-rendered
 * by the test suite. A static import would drag a browser-only module into
 * every render, so it is imported inside the effect that actually owns a
 * browser. The component renders its chrome — state, geometry, refusals — with
 * no emulator at all, which is why the SSR output is honest rather than empty.
 */
import * as React from 'react';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  TerminalChannel,
  terminalPreflight,
  MAX_INPUT_CHARS,
  type TerminalGeometry,
  type TerminalLinkState,
  type TerminalSocketLike,
} from '@/lib/herdr-terminal';

/** Human label for each link state. Never collapses a state into a blank. */
const STATE_LABEL: Record<TerminalLinkState, string> = {
  idle: 'NOT ATTACHED',
  connecting: 'CONNECTING',
  connected: 'CONNECTED',
  disconnected: 'DISCONNECTED',
  closed: 'SESSION CLOSED',
  refused: 'ATTACH REFUSED',
};

const STATE_TONE: Record<TerminalLinkState, string> = {
  idle: 'text-muted-foreground border-border/40',
  connecting: 'text-amber-400 border-amber-500/40',
  connected: 'text-emerald-400 border-emerald-500/40',
  disconnected: 'text-amber-400 border-amber-500/40',
  closed: 'text-zinc-400 border-zinc-500/40',
  refused: 'text-destructive border-destructive/40',
};

/**
 * Close reasons that carry an explicit, broker-sanctioned takeover offer.
 * Mirrors herdr-floor's SESSION_ALREADY_ATTACHED refusal, read from the link
 * detail rather than guessed from the state alone.
 */
function takeoverOffered(detail: string | null): boolean {
  return typeof detail === 'string' && detail.includes('SESSION_ALREADY_ATTACHED');
}

export interface HerdrTerminalProps {
  /** Broker host:port. Loopback only; anything else is refused before a socket. */
  host: string;
  /** A broker-issued session id. Never constructed by this component. */
  sessionId: string;
  /** The CURRENT broker boot id. A stale boot can never attach. */
  bootId: string;
  agentId?: string | null;
  /** What the broker reports it supports. False in v0.1, and respected. */
  resizeEnabled?: boolean;
  /** Called after the link ends, so the caller can refresh broker state. */
  onLinkEnded?: () => void;
}

export function HerdrTerminal({
  host,
  sessionId,
  bootId,
  agentId = null,
  resizeEnabled = false,
  onLinkEnded,
}: HerdrTerminalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  const channelRef = React.useRef<TerminalChannel | null>(null);

  const [linkState, setLinkState] = React.useState<TerminalLinkState>(() =>
    // Decided during render, not in an effect: an unusable identity is refused
    // the moment the component is asked to render, so the first thing the
    // Founder sees is the refusal rather than a moment of "connecting" to a
    // session that could never bind.
    terminalPreflight({ host, sessionId, bootId }) === null ? 'idle' : 'refused',
  );
  const [detail, setDetail] = React.useState<string | null>(null);
  const [geometry, setGeometry] = React.useState<TerminalGeometry | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(() =>
    terminalPreflight({ host, sessionId, bootId }),
  );

  // A stable factory. The real WebSocket is only constructed in a browser.
  const createSocket = React.useCallback((url: string): TerminalSocketLike => {
    const Ctor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
    if (typeof Ctor !== 'function') {
      throw new Error('no WebSocket implementation is available in this runtime');
    }
    return new Ctor(url) as TerminalSocketLike;
  }, []);

  const teardown = React.useCallback(() => {
    channelRef.current?.close();
    channelRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const termHost = containerRef.current;

    // Refuse before opening anything. A component that renders "CONNECTING" for
    // a session id it never received would be lying about a broker it cannot
    // reach.
    const preflight = terminalPreflight({ host, sessionId, bootId });
    if (preflight !== null) {
      setLinkState('refused');
      setRefusal(preflight);
      return;
    }
    setRefusal(null);

    const channel = new TerminalChannel({
      host,
      sessionId,
      bootId,
      createSocket,
      onState: (state, stateDetail) => {
        if (cancelled) return;
        setLinkState(state);
        setDetail(stateDetail);
        if (state === 'refused' || state === 'closed' || state === 'disconnected') {
          onLinkEnded?.();
        }
      },
      onOutput: (chunk) => {
        if (!cancelled) terminalRef.current?.write(chunk);
      },
      onGeometry: (g) => {
        if (!cancelled) setGeometry(g);
      },
    });
    channelRef.current = channel;

    const start = async () => {
      // Lazily loaded: xterm constructs DOM nodes and must not run in SSR.
      const { Terminal: XTerm } = await import('@xterm/xterm');
      if (cancelled || !termHost) return;
      if (terminalRef.current) return;
      const term = new XTerm({
        rows: geometry?.rows ?? 24,
        cols: geometry?.cols ?? 80,
        convertEol: false,
        cursorBlink: true,
        disableStdin: false,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        theme: { background: '#0b0b0d', foreground: '#e5e5e5' },
      });
      term.open(termHost);
      terminalRef.current = term;

      // Keystrokes go to the bound socket. No target, no command, no argv.
      term.onData((data) => {
        channel.sendInput(data);
      });

      channel.open(false);
    };

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, sessionId, bootId, createSocket, teardown]);

  const takeOver = () => {
    teardown();
    setRefusal(null);
    const channel = new TerminalChannel({
      host,
      sessionId,
      bootId,
      createSocket,
      onState: setLinkState,
      onOutput: (chunk) => terminalRef.current?.write(chunk),
      onGeometry: setGeometry,
    });
    channelRef.current = channel;
    channel.open(true);
  };

  const detach = () => {
    teardown();
    setLinkState('idle');
    setDetail('detached by the operator; the broker-owned session keeps running');
    onLinkEnded?.();
  };

  const reconnect = () => {
    setRefusal(null);
    setLinkState('connecting');
    channelRef.current?.open(false);
  };

  const attempted = linkState !== 'idle';
  const mayTakeOver = takeoverOffered(detail);

  return (
    <div className="border border-border/40 rounded bg-surface-1" data-testid="herdr-terminal">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="font-mono text-xs font-semibold text-primary">
          {agentId || 'session'}
        </span>
        <span
          data-testid="herdr-terminal-state"
          data-state={linkState}
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-2xs uppercase',
            STATE_TONE[linkState],
          )}
        >
          {STATE_LABEL[linkState]}
        </span>
        <span className="font-mono text-3xs text-muted-foreground truncate">
          {sessionId}
        </span>
        <span className="font-mono text-3xs text-muted-foreground">
          boot {bootId}
        </span>
        <span className="font-mono text-3xs text-muted-foreground">
          {geometry ? `${geometry.cols}x${geometry.rows}` : '80x24 (fallback)'}
          {geometry?.resizeEnabled || resizeEnabled ? '' : ' · RESIZE DISABLED'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {linkState === 'disconnected' || (linkState === 'refused' && !mayTakeOver) ? (
            <Button variant="outline" size="sm" className="h-6 px-2 text-2xs" onClick={reconnect}>
              Reattach
            </Button>
          ) : null}
          {mayTakeOver ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              data-testid="herdr-terminal-takeover"
              onClick={takeOver}
            >
              Take over (disconnects current client)
            </Button>
          ) : null}
          {attempted ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={detach}
            >
              Detach
            </Button>
          ) : null}
        </span>
      </div>

      {detail || refusal ? (
        <div
          data-testid="herdr-terminal-detail"
          className={cn(
            'border-b border-border/40 px-3 py-1.5 font-mono text-2xs',
            linkState === 'connected' ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {refusal || detail}
        </div>
      ) : null}

      {linkState !== 'connected' ? (
        <div
          data-testid="herdr-terminal-gate"
          className="px-3 py-1.5 font-mono text-2xs text-muted-foreground border-b border-border/40"
        >
          {linkState === 'idle'
            ? 'not attached — the broker owns this PTY session and nobody is reading it'
            : linkState === 'connecting'
              ? 'opening the broker attach handshake; no keystrokes are sent until the session identity is proven'
              : 'no live PTY output is being displayed'}
        </div>
      ) : null}

      <div
        ref={containerRef}
        data-testid="herdr-terminal-screen"
        className="min-h-[320px] bg-[#0b0b0d] px-1 py-1"
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-1.5">
        <Badge variant="outline" className="font-mono text-3xs">
          keystrokes → this bound PTY only
        </Badge>
        <Badge variant="outline" className="font-mono text-3xs">
          input cap {MAX_INPUT_CHARS} chars
        </Badge>
        <Badge variant="outline" className="font-mono text-3xs">
          no argv / cwd / env surface
        </Badge>
        <Badge variant="outline" className="font-mono text-3xs">
          no browser-to-shell route
        </Badge>
        <span className="font-mono text-3xs text-muted-foreground">
          resize stays off until the broker proves the ConPTY round trip
        </span>
      </div>
    </div>
  );
}