/**
 * src/lib/herdr-terminal.ts — the Founder's terminal link to a broker PTY.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 *
 * A typed client for the broker's EXISTING `/term` websocket, plus the state
 * machine that decides what the Founder is looking at. It is deliberately free
 * of React and of the DOM so that every protocol decision — the URL, the
 * identity proof, the refusal vocabulary, the rule that input only flows to a
 * bound socket — is testable without a browser.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is not a shell. It carries no argv, no cwd, no env, no command string and
 * no target-session parameter. The only thing a client can say to the PTY is
 * "these are keystrokes, for the session this socket already owns", and the
 * broker decides which PTY that is. A change that adds a command field here
 * would be a browser-to-shell route wearing a new hat.
 *
 * ── SESSION IDENTITY ────────────────────────────────────────────────────────
 *
 * Two values are required to attach: a broker-issued `session_id` and the
 * CURRENT `boot_id`. A session id from a previous boot is a different namespace
 * and the broker refuses it; refusing it here first means the UI can say so
 * honestly instead of showing a socket that never opens.
 *
 * ── THE HANDSHAKE IS A PROOF ────────────────────────────────────────────────
 *
 * The broker's first frame answers with the session_id and boot_id it actually
 * bound. This module compares that answer to what was asked for and refuses the
 * attachment on mismatch. Without that check, a UI would happily display
 * output attributed to a session it is not actually bound to.
 *
 * ── SINGLE ATTACH ───────────────────────────────────────────────────────────
 *
 * A second attach to a live PTY is refused by the broker, by design. This
 * module surfaces that refusal as its own state and offers takeover as an
 * EXPLICIT, separate, Founder-initiated action — never as an automatic retry,
 * because a silent takeover would evict the operator already holding the seat.
 */

/** The one path a Founder terminal may ever open. There is no other. */
export const TERMINAL_ATTACH_PATH = '/term';

/** WebSocket.OPEN is 1 by specification. Named so the literal is not magic. */
export const SOCKET_OPEN = 1;

/**
 * Refuse an oversized keystroke burst.
 *
 * A paste of a megabyte into a PTY is a denial-of-service against the agent's
 * stdin, not a Founder action. The broker does not cap this frame, so the
 * client caps it and says so rather than dropping the bytes silently.
 */
export const MAX_INPUT_CHARS = 8192;

/** Host allowlist. A terminal is a local surface or it is nothing. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Link state, in the vocabulary of the product: every absence is named rather
 * than rendered as a blank or a healthy-looking empty terminal.
 */
export type TerminalLinkState =
  | 'idle'          // nothing requested yet
  | 'connecting'    // socket opening
  | 'connected'     // broker acknowledged the bind
  | 'disconnected'  // dropped; the session may still be alive
  | 'closed'        // the PTY itself ended
  | 'refused';      // the broker said no

export interface TerminalRef {
  sessionId: string;
  bootId: string;
}

export interface TerminalGeometry {
  rows: number;
  cols: number;
  resizeEnabled: boolean;
}

export class TerminalRefError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'TerminalRefError';
  }
}

/**
 * Reject anything that is not a plausible broker-issued identity.
 *
 * These values are placed into a URL and into a broker lookup, so the shape is
 * checked rather than escaped-and-hoped-for. This is a naming rule, not a
 * security control — the broker's own lookup is the security control.
 */
function assertIdentityToken(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TerminalRefError(`a broker-issued ${label} is required to attach`, 'IDENTITY_MISSING');
  }
  if (value.length > 128) {
    throw new TerminalRefError(`${label} is longer than any broker-issued value`, 'IDENTITY_MALFORMED');
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new TerminalRefError(
      `${label} contains characters no broker-issued identity contains`,
      'IDENTITY_MALFORMED',
    );
  }
  return value;
}

export function assertTerminalRef(ref: Partial<TerminalRef>): TerminalRef {
  const sessionId = assertIdentityToken(ref?.sessionId, 'session_id');
  const bootId = assertIdentityToken(ref?.bootId, 'boot_id');
  return { sessionId, bootId };
}

/** True when a host may carry a Founder terminal. */
export function isLoopbackHost(host: unknown): boolean {
  if (typeof host !== 'string' || host.length === 0) return false;
  const bare = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return LOOPBACK_HOSTS.has(bare);
}

/**
 * The websocket URL for one broker session.
 *
 * Exactly four query values exist, and only the first three are identity:
 * `session_id`, `boot_id`, and the explicit `takeover` flag. There is no
 * command, no shell, no argv — because there is nothing to put there.
 */
export function buildTerminalUrl({
  host,
  sessionId,
  bootId,
  takeover = false,
}: {
  host: string;
  sessionId: string;
  bootId: string;
  takeover?: boolean;
}): string {
  if (!isLoopbackHost(host)) {
    throw new TerminalRefError(
      `terminal attach is loopback-only; refused host ${JSON.stringify(host)}`,
      'LOOPBACK_REQUIRED',
    );
  }
  const ref = assertTerminalRef({ sessionId, bootId });
  const params = new URLSearchParams();
  params.set('session_id', ref.sessionId);
  params.set('boot_id', ref.bootId);
  // The flag is present only when asked for. Its absence is the default posture:
  // never evict the current operator by accident.
  if (takeover) params.set('takeover', 'true');
  return `ws://${host}${TERMINAL_ATTACH_PATH}?${params.toString()}`;
}

export interface TerminalCloseReading {
  state: Exclude<TerminalLinkState, 'idle' | 'connecting' | 'connected'>;
  code: string;
  message: string;
  /** True only when the broker's own rule says an explicit takeover is the fix. */
  takeoverOffered: boolean;
  /** True when re-attaching the SAME session could still succeed. */
  retryable: boolean;
}

/**
 * Translate a socket close into an honest Founder-facing fact.
 *
 * The broker closes an attach refusal with 1008 and the SessionError code as
 * the reason (see herdr-floor/src/ws-bridge.mjs), and ends a dead PTY with 1000
 * and `pty closed`. Both are read here so the UI never has to guess, and so an
 * unknown code stays UNKNOWN rather than being dressed up as a healthy state.
 */
export function describeTerminalClose(code: number, reason: string): TerminalCloseReading {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';

  switch (trimmed) {
    case 'SESSION_ALREADY_ATTACHED':
      return {
        state: 'refused',
        code: trimmed,
        message:
          'another client already holds this PTY session; taking it over disconnects that client',
        takeoverOffered: true,
        retryable: false,
      };
    case 'SESSION_STALE_BOOT':
      return {
        state: 'refused',
        code: trimmed,
        message: 'this session id belongs to a previous broker boot and can never authorise again',
        takeoverOffered: false,
        retryable: false,
      };
    case 'SESSION_UNKNOWN':
      return {
        state: 'refused',
        code: trimmed,
        message: 'this broker boot issued no such session',
        takeoverOffered: false,
        retryable: false,
      };
    case 'SESSION_CLOSED':
      return {
        state: 'closed',
        code: trimmed,
        message: 'the PTY behind this session has already exited',
        takeoverOffered: false,
        retryable: false,
      };
    case 'pty closed':
      return {
        state: 'closed',
        code: 'PTY_CLOSED',
        message: 'the PTY closed; this session is finished',
        takeoverOffered: false,
        retryable: false,
      };
    default:
      break;
  }

  if (code === 1008) {
    return {
      state: 'refused',
      code: trimmed || 'ATTACH_REFUSED',
      message: trimmed
        ? `the broker refused this attach: ${trimmed}`
        : 'the broker refused this attach',
      takeoverOffered: false,
      retryable: false,
    };
  }
  if (code === 1000 || code === 1005) {
    return {
      state: 'closed',
      code: 'CLOSED',
      message: 'the terminal link closed normally; the session status is unchanged',
      takeoverOffered: false,
      retryable: true,
    };
  }
  return {
    state: 'disconnected',
    code: trimmed || `WS_${code}`,
    message: `the terminal link dropped (close code ${code}); the session may still be alive`,
    takeoverOffered: false,
    retryable: true,
  };
}

/** The broker's single control frame. Exactly one is sent, at attach. */
export interface AttachedFrame {
  type: 'attached';
  session_id: string;
  boot_id: string;
  rows: number;
  cols: number;
  resize_enabled: boolean;
}

export type FrameParseResult =
  | { kind: 'attached'; frame: AttachedFrame }
  | { kind: 'output' }
  | { kind: 'unreadable'; reason: string };

/**
 * Classify a broker frame.
 *
 * `expectHandshake` is TRUE only before the first frame has been seen. The
 * broker sends exactly one control frame at attach and raw PTY bytes after it,
 * so after the handshake every frame — including text that happens to parse as
 * JSON — is terminal output. Treating a later JSON-looking frame as a control
 * message would let PTY content forge a session id.
 */
export function parseBrokerFrame(data: unknown, expectHandshake: boolean): FrameParseResult {
  const isText = typeof data === 'string';
  if (!expectHandshake) return { kind: 'output' };
  if (!isText) return { kind: 'output' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(data as string);
  } catch {
    return { kind: 'unreadable', reason: 'the broker sent output before acknowledging the attach' };
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { type?: unknown }).type !== 'attached'
  ) {
    return { kind: 'unreadable', reason: 'the broker did not answer with an attach acknowledgement' };
  }
  const f = parsed as Partial<AttachedFrame>;
  if (typeof f.session_id !== 'string' || typeof f.boot_id !== 'string') {
    return { kind: 'unreadable', reason: 'the attach acknowledgement carried no session identity' };
  }
  return {
    kind: 'attached',
    frame: {
      type: 'attached',
      session_id: f.session_id,
      boot_id: f.boot_id,
      rows: Number.isFinite(f.rows) ? Number(f.rows) : 24,
      cols: Number.isFinite(f.cols) ? Number(f.cols) : 80,
      // Resize is a broker proof, not a client preference. A client that
      // believes it can resize is a client that will send a resize the broker
      // has not proven.
      resize_enabled: f.resize_enabled === true,
    },
  };
}

/** The minimum surface this module needs from a websocket. */
export interface TerminalSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface TerminalChannelCallbacks {
  onState: (state: TerminalLinkState, detail: string | null) => void;
  onOutput: (chunk: string) => void;
  onGeometry: (geometry: TerminalGeometry) => void;
}

export interface TerminalChannelOptions extends TerminalChannelCallbacks {
  host: string;
  sessionId: string;
  bootId: string;
  createSocket: (url: string) => TerminalSocketLike;
}

/**
 * One socket, one PTY, one explicit lifecycle.
 *
 * The class holds no command surface. `sendInput` is the only way bytes leave
 * it, it carries no target, and it refuses to run before the broker has proved
 * the bind — which is what makes "keystrokes go only to this session" a
 * property of the code rather than a claim in the UI copy.
 */
export class TerminalChannel {
  private socket: TerminalSocketLike | null = null;
  private currentState: TerminalLinkState = 'idle';
  private handshakeDone = false;
  private closedByClient = false;

  private ref: TerminalRef;
  readonly host: string;
  private geometry: TerminalGeometry | null = null;
  private takeoverUsed = false;

  constructor(private readonly opts: TerminalChannelOptions) {
    this.ref = assertTerminalRef({ sessionId: opts.sessionId, bootId: opts.bootId });
    if (!isLoopbackHost(opts.host)) {
      throw new TerminalRefError(
        `terminal attach is loopback-only; refused host ${JSON.stringify(opts.host)}`,
        'LOOPBACK_REQUIRED',
      );
    }
    this.host = opts.host;
  }

  get state(): TerminalLinkState {
    return this.currentState;
  }

  get boundRef(): TerminalRef {
    return { ...this.ref };
  }

  get currentGeometry(): TerminalGeometry | null {
    return this.geometry ? { ...this.geometry } : null;
  }

  get takeoverConsumed(): boolean {
    return this.takeoverUsed;
  }

  private setState(state: TerminalLinkState, detail: string | null = null): void {
    this.currentState = state;
    this.opts.onState(state, detail);
  }

  /**
   * Open the link.
   *
   * `takeover` is a separate, explicit act. It is never set automatically on
   * retry: a retry that silently evicts the sitting operator would be a data
   * race the Founder never agreed to.
   */
  open(takeover = false): void {
    if (takeover && this.takeoverUsed) {
      this.setState(
        'refused',
        'takeover was already used for this session; reattach manually if it is still held',
      );
      return;
    }
    // A previous socket must be GONE before the next one is opened. Two live
    // sockets for one session would make the broker refuse the second as
    // ALREADY_ATTACHED — the client evicting itself with its own rule.
    if (this.socket) {
      this.closedByClient = true;
      this.safeClose(1000, 'reopen');
      this.closedByClient = false;
      this.socket = null;
    }
    this.handshakeDone = false;
    this.closedByClient = false;
    if (takeover) this.takeoverUsed = true;

    let url: string;
    try {
      url = buildTerminalUrl({
        host: this.host,
        sessionId: this.ref.sessionId,
        bootId: this.ref.bootId,
        takeover,
      });
    } catch (err) {
      this.setState('refused', err instanceof Error ? err.message : String(err));
      return;
    }

    this.setState('connecting', takeover ? 'requesting explicit takeover' : null);
    const socket = this.opts.createSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      // The socket being open is not the session being bound. The state stays
      // `connecting` until the broker answers with the identity frame.
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      if (this.currentState === 'connecting' || this.currentState === 'connected') {
        this.setState('disconnected', 'the terminal link reported a transport error');
      }
    };
    socket.onclose = (event) => {
      // A close from a socket we have already replaced is history, not state.
      if (this.socket !== socket) return;
      this.socket = null;
      this.handleClose(event.code, event.reason);
    };
  }

  private handleMessage(data: unknown): void {
    const result = parseBrokerFrame(data, !this.handshakeDone);

    if (result.kind === 'output') {
      // Terminal bytes. Written verbatim; the emulator owns interpretation.
      if (typeof data === 'string') this.opts.onOutput(data);
      return;
    }
    if (result.kind === 'unreadable') {
      this.setState('refused', result.reason);
      this.safeClose(1008, 'HANDSHAKE_UNREADABLE');
      return;
    }

    const frame = result.frame;
    if (frame.session_id !== this.ref.sessionId || frame.boot_id !== this.ref.bootId) {
      this.setState(
        'refused',
        'the broker acknowledged a different session than the one requested',
      );
      this.safeClose(1008, 'IDENTITY_MISMATCH');
      return;
    }
    this.handshakeDone = true;
    this.geometry = { rows: frame.rows, cols: frame.cols, resizeEnabled: frame.resize_enabled };
    this.opts.onGeometry(this.geometry);
    this.setState('connected', null);
  }

  private handleClose(code: number, reason: string): void {
    if (this.closedByClient) {
      this.setState('disconnected', 'detached by the operator');
      return;
    }
    const reading = describeTerminalClose(code, reason);
    this.setState(reading.state, `${reading.message} [${reading.code}]`);
  }

  /**
   * Send keystrokes to the bound PTY.
   *
   * Returns false — and sends nothing — unless the broker has acknowledged the
   * bind on THIS socket. There is no session parameter: the socket owns the
   * target, so keystrokes cannot be aimed at another agent.
   */
  sendInput(data: string): boolean {
    if (typeof data !== 'string' || data.length === 0) return false;
    if (this.currentState !== 'connected') return false;
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    if (data.length > MAX_INPUT_CHARS) {
      this.setState('connected', `input refused: ${data.length} chars exceeds the ${MAX_INPUT_CHARS} cap`);
      return false;
    }
    this.socket.send(data);
    return true;
  }

  /** Founder-initiated detach. The PTY keeps running; only the link ends. */
  close(): void {
    this.closedByClient = true;
    this.safeClose(1000, 'client detach');
  }

  private safeClose(code: number, reason: string): void {
    try {
      this.socket?.close(code, reason);
    } catch {
      // Already gone. The close event still resolves the state.
    }
  }
}
/**
 * The refusal this component would raise, or null when the reference is usable.
 *
 * Derived from the SAME builder the socket is opened with, so a refusal shown
 * before connecting is exactly a refusal that would happen on connect. Two
 * validators would be two places for them to disagree.
 */
export function terminalPreflight(props: {
  host: string;
  sessionId: string;
  bootId: string;
}): string | null {
  try {
    void buildTerminalUrl({
      host: props.host,
      sessionId: props.sessionId,
      bootId: props.bootId,
    });
    return null;
  } catch (err) {
    if (err instanceof TerminalRefError) return `${err.code}: ${err.message}`;
    return err instanceof Error ? err.message : String(err);
  }
}
