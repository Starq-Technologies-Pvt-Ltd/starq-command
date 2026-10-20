import * as React from 'react';
import {
  CheckCircle2,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  XCircle,
} from 'lucide-react';
import { PeerWorkHeader, QualifierRow } from '@/components/work-area';
import { HerdrTerminal } from '@/components/herdr-terminal';
import { buildTerminalUrl } from '@/lib/herdr-terminal';
import { Panel, Stat, StatRail, KV } from '@/components/console';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface HerdrAgentRow {
  id: string;
  label: string;
  runtime: string;
  startup_policy: string;
  launchable: boolean;
  terminal: boolean;
  state: string; // RUNNING | EXITED
  pid: number | null;
  session_id: string | null;
  cwd: string;
  executable: string | null;
  args?: string[];
  floor_open_decision?: {
    allowed: boolean;
    refusal: string | null;
    message: string;
  };
  evidence?: string | null;
  note?: string | null;
  herdr?: {
    kind?: string;
    read_only?: boolean;
  } | null;
}

export interface HerdrFloorState {
  floor_opened: boolean;
  floor_opens: number;
  last_opened_at?: string | null;
}

export interface HerdrAuditEvent {
  at: string;
  event: string;
  [key: string]: unknown;
}

export interface HerdrSessionState {
  timestamp: string;
  broker: {
    online: boolean;
    boot_id?: string;
    access?: string;
    host?: string;
    error?: string;
  };
  herdr: {
    state: string; // AVAILABLE | UNAVAILABLE | ERROR | UNKNOWN
    version?: string;
    protocol?: number;
    socket?: string;
    detail?: string;
    panes?: Array<{ id: string; [key: string]: unknown }>;
    agents?: Array<{ name: string; [key: string]: unknown }>;
  };
  floor: HerdrFloorState;
  terminal: {
    resize_enabled: boolean;
    fallback_size: { cols: number; rows: number };
  };
  agents: HerdrAgentRow[];
  sessions: Array<{
    session_id: string;
    agent_id: string;
    pid: number;
    started_at?: string;
    open?: boolean;
    attached?: boolean;
    takeover_count?: number;
    bytes_in?: number;
    bytes_out?: number;
  }>;
  registry_records?: Array<{ session_id: string; agent_id: string; pid: number; state: string }>;
  // Standalone Herdr panes, projected SEPARATELY from broker sessions. A bound
  // pane represents a declared seat by explicit operator binding; it is never
  // broker-owned, never floor-launched, and carries no session/PID/authority.
  standalone?: {
    herdr_state: string;
    bindings_state: string;
    note?: string;
    panes:
      | Array<{
          attribution: 'BOUND' | 'UNATTRIBUTED';
          binding_state: 'BOUND' | 'STALE' | null;
          seat_id: string | null;
          binding: { bound_by: string | null; authority: string | null; bound_at: string | null; note?: string | null } | null;
          observed_by_herdr: boolean;
          broker_owned: false;
          floor_launched: false;
          broker_session: null;
          broker_pid: null;
          authority_effect: 'NONE';
          reason?: string;
          pane: {
            pane_id: string | null;
            workspace_id: string | null;
            terminal_id: string | null;
            terminal_title_stripped: string | null;
            cwd: string | null;
            agent_status: string | null;
          } | null;
        }>
      | null;
  };
  exclusions?: string[];
  audit?: HerdrAuditEvent[];
  session_established: boolean;
  session_boot_id: string | null;
  ownership?: {
    command_role?: string;
    broker_role?: string;
    herdr_role?: string;
  };
}

const DEFAULT_STATE: HerdrSessionState = {
  timestamp: new Date().toISOString(),
  broker: {
    online: false,
    error: 'Connecting to broker...',
  },
  herdr: {
    state: 'UNAVAILABLE',
    detail: 'Broker not yet connected',
  },
  floor: {
    floor_opened: false,
    floor_opens: 0,
  },
  terminal: {
    resize_enabled: false,
    fallback_size: { cols: 80, rows: 24 },
  },
  agents: [],
  sessions: [],
  registry_records: [],
  exclusions: [],
  audit: [],
  session_established: false,
  session_boot_id: null,
};

/**
 * The Observed / Standalone Herdr lane.
 *
 * Standalone panes are rendered here, NEVER merged into the broker `sessions[]`
 * table. Every row is explicit that it is observed-not-owned: a bound pane
 * represents a declared seat by operator binding only, and shows no PID, no PTY
 * session, no floor membership, and no controls (Command may not stop/restart a
 * pane it does not own). Unbound panes stay anonymous — never attributed by
 * cwd/title guessing.
 */
export function ObservedStandaloneLane({
  standalone,
}: {
  standalone?: HerdrSessionState['standalone'];
}) {
  const panes = standalone?.panes ?? null;
  const count =
    panes === null ? 'Unavailable' : `${panes.length} observed`;
  return (
    <Panel
      title="Observed · Standalone Herdr"
      count={count}
      className="rank-support border-dashed"
    >
      <div className="body space-y-3">
        <div className="text-2xs text-muted-foreground font-mono">
          Observation ≠ identity ≠ broker ownership ≠ floor membership ≠ authority.
          These panes are observed read-only; none is broker-owned or floor-launched.
        </div>
        {panes === null ? (
          <div className="text-xs text-muted-foreground">
            Herdr is not AVAILABLE, so standalone panes cannot be observed (fails closed).
          </div>
        ) : panes.length === 0 ? (
          <div className="text-xs text-muted-foreground">No standalone panes observed.</div>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Attribution</TableHead>
                <TableHead>Seat</TableHead>
                <TableHead>Pane (workspace / pane / terminal)</TableHead>
                <TableHead>Binding</TableHead>
                <TableHead>Ownership</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panes.map((row, i) => {
                const p = row.pane;
                const paneKey = p?.terminal_id ?? p?.pane_id ?? `row-${i}`;
                const bound = row.attribution === 'BOUND';
                return (
                  <TableRow key={paneKey}>
                    <TableCell>
                      <Badge variant={bound ? 'default' : 'outline'}>
                        {bound ? `BOUND · ${row.binding_state}` : 'UNATTRIBUTED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.seat_id ?? <span className="text-muted-foreground">— (anonymous)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-2xs">
                      {p
                        ? `${p.workspace_id ?? '?'} / ${p.pane_id ?? '?'} / ${p.terminal_id ?? '?'}`
                        : <span className="text-muted-foreground">{row.reason ?? 'pane not present (stale)'}</span>}
                    </TableCell>
                    <TableCell className="text-2xs">
                      {row.binding
                        ? `${row.binding.bound_by ?? '?'} · ${row.binding.authority ?? '?'}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-2xs text-muted-foreground">
                      observed · not broker-owned · no PID/PTY · authority {row.authority_effect}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Panel>
  );
}

export function HerdrSurface({
  initialState = null,
  pollIntervalMs = 5000,
}: {
  initialState?: HerdrSessionState | null;
  pollIntervalMs?: number;
}) {
  const [data, setData] = React.useState<HerdrSessionState>(initialState || DEFAULT_STATE);
  const [loading, setLoading] = React.useState<boolean>(!initialState);
  const [actionPending, setActionPending] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  // The one PTY session this browser is attached to, or null. Only ever a
  // broker-issued session_id picked from the live list below.
  const [attachedSessionId, setAttachedSessionId] = React.useState<string | null>(null);

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch('/api/herdr/state');
      if (res.ok) {
        const json = (await res.json()) as HerdrSessionState;
        setData(json);
      } else {
        setData((prev) => ({
          ...prev,
          broker: { online: false, error: `HTTP ${res.status}` },
          herdr: { state: 'UNAVAILABLE', detail: 'Service error' },
        }));
      }
    } catch (err) {
      setData((prev) => ({
        ...prev,
        broker: {
          online: false,
          error: err instanceof Error ? err.message : String(err),
        },
        herdr: { state: 'UNAVAILABLE', detail: 'Broker unreachable' },
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!initialState) {
      void fetchState();
    }
    if (pollIntervalMs > 0) {
      const timer = window.setInterval(() => {
        void fetchState();
      }, pollIntervalMs);
      return () => window.clearInterval(timer);
    }
  }, [fetchState, initialState, pollIntervalMs]);

  const csrfTokenRef = React.useRef<string | null>(null);

  const obtainCsrfToken = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/herdr/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data?.session?.csrfToken || data?.session?.csrf_token) {
        const token = data.session.csrfToken || data.session.csrf_token;
        csrfTokenRef.current = token;
        return token;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleAction = async (op: string, agent?: string) => {
    const key = agent ? `${op}:${agent}` : op;
    setActionPending(key);
    setActionMessage(null);
    setActionError(false);
    try {
      let token = csrfTokenRef.current || (await obtainCsrfToken());

      const executePost = async (csrf: string | null) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (csrf) headers['X-CSRF-Token'] = csrf;

        if (op === 'open-floor') {
          return await fetch('/api/herdr/floor/open', {
            method: 'POST',
            headers,
          });
        }
        if (op === 'start' && agent) {
          return await fetch(`/api/herdr/agents/${encodeURIComponent(agent)}/start`, {
            method: 'POST',
            headers,
          });
        }
        if (op === 'stop' && agent) {
          return await fetch(`/api/herdr/agents/${encodeURIComponent(agent)}/stop`, {
            method: 'POST',
            headers,
          });
        }
        if (op === 'restart' && agent) {
          return await fetch(`/api/herdr/agents/${encodeURIComponent(agent)}/restart`, {
            method: 'POST',
            headers,
          });
        }
        throw new Error(`Unsupported action: ${op}`);
      };

      let res = await executePost(token);
      if (res.status === 403 || res.status === 401) {
        // CSRF or session expired, refresh once
        token = await obtainCsrfToken();
        res = await executePost(token);
      }

      const json = await res.json();
      if (!res.ok) {
        setActionError(true);
        setActionMessage(`Action refused: ${json.error || json.code || 'Operation failed'}`);
      } else {
        setActionError(false);
        setActionMessage(`Action ${op.toUpperCase()}${agent ? ` [${agent}]` : ''} completed successfully.`);
      }
      await fetchState();
    } catch (err) {
      setActionError(true);
      setActionMessage(`Request error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionPending(null);
    }
  };

  const isBrokerOnline = data.broker.online;
  const isHerdrRunning = data.herdr.state === 'AVAILABLE';
  const runningAgents = data.agents.filter((a) => a.state === 'RUNNING');
  const selectedAgent = data.agents.find((a) => a.id === selectedAgentId) || data.agents[0] || null;

  // The attach target is the broker's own address, not a literal. The URL shown
  // and the URL opened are produced by the SAME function, so the surface can
  // never advertise one endpoint while the terminal opens another.
  const brokerHost = data.broker.host || '127.0.0.1:5188';
  const bootId = data.broker.boot_id || '';
  const attachableSessions = data.sessions.filter(
    (s) => s.open !== false && Boolean(s.session_id) && Boolean(bootId),
  );
  const attachedSession = attachedSessionId
    ? data.sessions.find((s) => s.session_id === attachedSessionId) || null
    : null;

  return (
    <div className="space-y-4" data-testid="herdr-surface">
      <PeerWorkHeader
        peer="Herdr"
        question="Is the Herdr Launch Floor broker online, what is Herdr runtime status, and which agent sessions are running?"
      />

      <QualifierRow>
        <span>Broker: {isBrokerOnline ? 'ONLINE (127.0.0.1:5188)' : 'OFFLINE'}</span>
        <span>Herdr Server: {data.herdr.state}</span>
        <span>Agents: {data.agents.length}</span>
        <span>PTY Sessions: {data.sessions.length}</span>
        <span>Floor: {data.floor.floor_opened ? `OPENED (${data.floor.floor_opens}x)` : 'UNOPENED'}</span>
        {data.broker.boot_id ? <span>Boot: {data.broker.boot_id}</span> : null}
      </QualifierRow>

      <StatRail>
        <Stat
          k="Broker"
          v={isBrokerOnline ? 'Online' : 'Offline'}
          tone={isBrokerOnline ? 'ok' : 'unknown'}
          sub={isBrokerOnline ? (data.broker.access ?? 'LOOPBACK_ONLY') : (data.broker.error ?? 'Unreachable')}
        />
        <Stat
          k="Herdr Multiplexer"
          v={isHerdrRunning ? 'Running' : 'Stopped'}
          tone={isHerdrRunning ? 'ok' : 'unknown'}
          sub={data.herdr.version ? `v${data.herdr.version}` : (data.herdr.detail ?? 'read-only status')}
        />
        <Stat
          k="Floor State"
          v={data.floor.floor_opened ? 'Opened' : 'Unopened'}
          tone={data.floor.floor_opened ? 'founder' : 'unknown'}
          sub={data.floor.floor_opened ? `${data.floor.floor_opens} opens recorded` : 'one-shot launch ready'}
        />
        <Stat
          k="Active Sessions"
          v={data.sessions.length}
          tone={data.sessions.length > 0 ? 'ok' : 'unknown'}
          sub={`${runningAgents.length} agents running`}
        />
      </StatRail>

      {/* Action feedback banner */}
      {actionMessage ? (
        <div
          className={`rounded border px-3 py-2 text-xs font-mono flex items-center justify-between ${
            actionError
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
          }`}
        >
          <span>{actionMessage}</span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs text-muted-foreground hover:text-foreground ml-2"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Broker Offline Notice */}
      {!isBrokerOnline ? (
        <Panel title="Herdr Floor Broker Offline" count="Action required" className="rank-primary border-destructive/40">
          <div className="body space-y-2 text-xs">
            <p className="text-muted-foreground">
              The Herdr Floor control broker is not running on <code>127.0.0.1:5188</code>. Command cannot actuate or observe the floor until it starts.
            </p>
            <p className="font-mono text-2xs bg-surface-2 p-2 rounded">
              cd D:\!starq\00_STARQ_HQ\operations\herdr-floor<br />
              node src/main.mjs
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchState()}
              disabled={loading}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Retry Connection
            </Button>
          </div>
        </Panel>
      ) : null}

      {/* Floor Launch Controls & Architecture Qualifiers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel title="Floor Launch Control" count={data.floor.floor_opened ? 'Opened' : 'Ready'} className="rank-primary md:col-span-1">
          <div className="body space-y-3">
            <KV
              rows={[
                ['Floor Opened', data.floor.floor_opened ? 'YES' : 'NO'],
                ['Open Count', String(data.floor.floor_opens)],
                ['Session Mode', data.session_established ? 'Authenticated' : 'Pending'],
                ['Boot ID', data.broker.boot_id || 'UNKNOWN'],
                ['Loopback Access', data.broker.access || 'LOOPBACK_ONLY'],
              ]}
            />
            <div className="pt-2">
              <Button
                variant={data.floor.floor_opened ? 'secondary' : 'default'}
                size="sm"
                className="w-full"
                onClick={() => void handleAction('open-floor')}
                disabled={!isBrokerOnline || data.floor.floor_opened || actionPending === 'open-floor'}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {data.floor.floor_opened ? 'Floor Already Opened' : 'Open Floor (One-Shot)'}
              </Button>
              {data.floor.floor_opened ? (
                <p className="mt-1 text-2xs text-muted-foreground">
                  Floor opening is an anti-thrash one-shot action per install. Named seats may be started, stopped or restarted individually below.
                </p>
              ) : (
                <p className="mt-1 text-2xs text-muted-foreground">
                  Opens the floor and launches all FLOOR_LAUNCH policy agents. MANUAL (Deadpool) and unlaunchable seats (Cursor) are skipped.
                </p>
              )}
            </div>
          </div>
        </Panel>

        <Panel title="Herdr Multiplexer State" count={data.herdr.state} className="rank-primary md:col-span-2">
          <div className="body space-y-3">
            <KV
              rows={[
                ['Multiplexer State', data.herdr.state],
                ['Herdr Version', data.herdr.version ? `v${data.herdr.version}` : 'Not detected'],
                ['Protocol Version', data.herdr.protocol ? String(data.herdr.protocol) : '—'],
                ['Unix Socket', data.herdr.socket || '—'],
                ['Observed Panes', String(data.herdr.panes?.length ?? 0)],
                ['Observed Agents', String(data.herdr.agents?.length ?? 0)],
              ]}
            />
            <div className="text-2xs text-muted-foreground border-t border-border/40 pt-2 font-mono">
              <span className="text-primary font-semibold">Ownership notice: </span>
              Command observes the Herdr terminal server read-only. The broker never starts or drives Herdr itself; it only observes panes and manages its own bounded PTY pool.
            </div>
          </div>
        </Panel>
      </div>

      {/* Managed Agents Roster with Bounded Controls */}
      <Panel title="Managed Agents Roster" count={`${data.agents.length} declared seats`} className="rank-primary">
        <div className="body overflow-x-auto">
          {data.agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">No agent manifest rows loaded.</p>
          ) : (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Runtime</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>PID / PTY Session</TableHead>
                  <TableHead>Herdr Profile</TableHead>
                  <TableHead className="text-right">Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agents.map((agent) => {
                  const isRunning = agent.state === 'RUNNING';
                  const isPending = actionPending?.endsWith(`:${agent.id}`);
                  const isDeadpool = agent.id === 'deadpool';
                  const isCursor = agent.id === 'cursor';

                  return (
                    <TableRow
                      key={agent.id}
                      className={selectedAgentId === agent.id ? 'bg-surface-2' : ''}
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      <TableCell className="font-medium cursor-pointer">
                        <div className="flex items-center space-x-1.5">
                          <span>{agent.label}</span>
                          {isDeadpool ? (
                            <Badge variant="outline" className="text-2xs font-mono bg-amber-500/10 text-amber-400 border-amber-500/30">
                              MANUAL-ONLY
                            </Badge>
                          ) : null}
                          {isCursor ? (
                            <Badge variant="outline" className="text-2xs font-mono bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                              UNLAUNCHABLE
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-2xs font-mono text-muted-foreground">{agent.id}</div>
                      </TableCell>
                      <TableCell className="font-mono text-2xs uppercase">
                        {agent.runtime}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-2xs">
                          {agent.startup_policy}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isRunning ? (
                          <span className="inline-flex items-center text-emerald-500 font-mono text-2xs">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            RUNNING
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-muted-foreground font-mono text-2xs">
                            <XCircle className="mr-1 h-3 w-3" />
                            EXITED
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-2xs">
                        {agent.pid ? (
                          <span className="text-foreground font-semibold">PID {agent.pid}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {agent.session_id ? (
                          <div className="truncate max-w-[140px] text-muted-foreground text-3xs">
                            {agent.session_id}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-2xs text-muted-foreground">
                        {agent.herdr?.kind ? (
                          <span className="text-foreground">{agent.herdr.kind}</span>
                        ) : (
                          <span>broker-PTY only</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {!agent.launchable ? (
                          <span className="text-2xs text-muted-foreground">Not launchable</span>
                        ) : isRunning ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-2xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleAction('stop', agent.id);
                              }}
                              disabled={!isBrokerOnline || isPending}
                            >
                              <Square className="mr-1 h-3 w-3 text-rose-400" />
                              Stop
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-2xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleAction('restart', agent.id);
                              }}
                              disabled={!isBrokerOnline || isPending}
                            >
                              <RotateCw className="mr-1 h-3 w-3 text-cyan-400" />
                              Restart
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-2xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleAction('start', agent.id);
                            }}
                            disabled={!isBrokerOnline || isPending}
                          >
                            <Play className="mr-1 h-3 w-3 text-emerald-400" />
                            Start
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Panel>

      {/* Observed / Standalone Herdr lane — kept visually and semantically
          distinct from broker-owned sessions above. */}
      <ObservedStandaloneLane standalone={data.standalone} />

      {/* Selected Agent Inspector */}
      {selectedAgent ? (
        <Panel title={`Agent Inspector: ${selectedAgent.label} (${selectedAgent.id})`} count={selectedAgent.startup_policy} className="rank-support">
          <div className="body space-y-3 text-xs">
            <KV
              rows={[
                ['Identifier', selectedAgent.id],
                ['Display Label', selectedAgent.label],
                ['Startup Policy', selectedAgent.startup_policy],
                ['Runtime Platform', selectedAgent.runtime],
                ['Terminal PTY Enabled', selectedAgent.terminal ? 'YES' : 'NO'],
                ['Working Directory', selectedAgent.cwd],
                ['Executable', selectedAgent.executable || '(none — unlaunchable)'],
                ['Arguments', selectedAgent.args?.join(' ') || '(none)'],
                ['Floor Open Ruling', selectedAgent.floor_open_decision?.message || '—'],
                ['Evidence / Verification', selectedAgent.evidence || selectedAgent.note || 'None recorded'],
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {/* Bottom Grid: Live Sessions & Audit Log */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Active PTY Sessions */}
        <Panel
          title="Broker Active PTY Sessions"
          count={`${data.sessions.length} live`}
          className="rank-support"
        >
          <div className="body">
            {data.sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active PTY sessions recorded on the broker.</p>
            ) : (
              <div className="space-y-2">
                {data.sessions.map((s) => {
                  const isAttachedHere = attachedSessionId === s.session_id;
                  const attachable = attachableSessions.some((x) => x.session_id === s.session_id);
                  let wsUrl = '';
                  try {
                    wsUrl = buildTerminalUrl({
                      host: brokerHost,
                      sessionId: s.session_id,
                      bootId,
                    });
                  } catch {
                    // A session with no current boot id cannot be attached, and
                    // the refusal is shown as an absent URL rather than a
                    // string that would not open.
                    wsUrl = '(not attachable: no current boot_id)';
                  }
                  return (
                    <div
                      key={s.session_id}
                      data-testid={`herdr-session-${s.session_id}`}
                      className="p-2.5 rounded bg-surface-1 border border-border/40 font-mono text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-primary">{s.agent_id}</span>
                        <span className="text-emerald-400 text-2xs">PID {s.pid}</span>
                      </div>
                      <div className="text-2xs text-muted-foreground truncate">
                        session_id: {s.session_id}
                      </div>
                      <div className="text-3xs text-muted-foreground bg-surface-2 p-1 rounded truncate">
                        {wsUrl}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant={isAttachedHere ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          disabled={!attachable}
                          onClick={() => setAttachedSessionId(isAttachedHere ? null : s.session_id)}
                        >
                          {isAttachedHere ? 'Close Terminal' : 'Attach Terminal'}
                        </Button>
                        {s.attached ? (
                          <span className="text-3xs text-amber-400 font-mono">
                            HELD BY ANOTHER CLIENT
                          </span>
                        ) : null}
                        {s.open === false ? (
                          <span className="text-3xs text-zinc-400 font-mono">
                            PTY EXITED — READ-ONLY DIAGNOSTIC ONLY
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>

        {/* Audit Log Stream */}
        <Panel title="Broker Audit Events" count={`${data.audit?.length ?? 0} events`} className="rank-support">
          <div className="body">
            {!data.audit || data.audit.length === 0 ? (
              <p className="text-xs text-muted-foreground">No audit events recorded yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                {data.audit.map((evt, idx) => (
                  <div key={idx} className="p-2 rounded bg-surface-1 border border-border/30 text-2xs font-mono space-y-0.5">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-foreground font-semibold">{evt.event}</span>
                      <span>{evt.at ? new Date(evt.at).toLocaleTimeString() : '—'}</span>
                    </div>
                    {evt.code ? <div className="text-amber-400">code: {String(evt.code)}</div> : null}
                    {evt.path ? <div className="text-muted-foreground">path: {String(evt.path)}</div> : null}
                    {evt.boot_id ? <div className="text-muted-foreground">boot: {String(evt.boot_id)}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Founder Terminal — the interactive surface over ONE broker PTY */}
      <Panel
        title="Founder Terminal"
        count={attachedSession ? attachedSession.agent_id : 'no session attached'}
        className="rank-primary"
      >
        <div className="body space-y-2">
          {attachedSession && bootId ? (
            <>
              <HerdrTerminal
                host={brokerHost}
                sessionId={attachedSession.session_id}
                bootId={bootId}
                agentId={attachedSession.agent_id}
                resizeEnabled={data.terminal.resize_enabled}
                onLinkEnded={() => void fetchState()}
              />
              <p className="text-2xs text-muted-foreground font-mono">
                One browser, one socket, one broker-owned PTY. A second attach is refused by the
                broker; takeover is an explicit action that disconnects the current client.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              No PTY session attached. Choose <span className="font-mono">Attach Terminal</span> on a
              live broker session above. Command never opens a terminal of its own: the PTY, the
              process and its lifecycle belong to the broker.
            </p>
          )}
        </div>
      </Panel>

      {/* Security Invariants & Boundaries */}
      <Panel title="Security Architecture & Trust Boundaries" count="Verified" className="rank-support">
        <div className="body text-2xs font-mono text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <p className="text-foreground font-semibold mb-1">Broker Guarantees:</p>
            <p>✓ Loopback-only bind (127.0.0.1:5188)</p>
            <p>✓ Pinned Host header verification</p>
            <p>✓ Fail-closed Origin allowlist (http://127.0.0.1:5173)</p>
            <p>✓ Session cookie + CSRF token required on mutating verbs</p>
          </div>
          <div>
            <p className="text-foreground font-semibold mb-1">Process Invariants:</p>
            <p>✓ PID + create_time + argv_hash process identity proof</p>
            <p>✓ Deadpool strictly MANUAL (WSL gateway preserved, no terminal)</p>
            <p>✓ Cursor launchable:false (no guessed standalone binary)</p>
            <p>✓ Zero arbitrary shell, exec, or pane text-injection routes</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
