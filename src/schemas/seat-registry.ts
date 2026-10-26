/**
 * Full Fleet Seat Registry & Runtime Policies
 * Starq Command Architecture Doctrine Section 14
 */

/**
 * SUPERSEDED — NOT AUTHORITATIVE. DO NOT BUILD ON THIS FILE.
 *
 * ── SUPERSEDED BY `server/staff-profile.mjs` (Founder Room seq 8475) ────────
 *
 * This file held a second, unwired seat roster that contradicted the Founder's
 * declared Dev Studio roster (Room seq 8473). It was never consumed by the
 * staff surface, and it was wrong in ways that would have misled an operator if
 * it ever had been:
 *
 *   · Elder modelled as `Claude 3.7 Sonnet` and Codex as `o3-mini` — both
 *     stale, and neither is a fact any canonical source carries.
 *   · Cursor at tier `L2_OPERATIONAL` on provider `OpenAI/Anthropic`, where the
 *     Founder declares a Paid L1 SpaceX / Cursor / SpaceXAI seat.
 *   · Vision and Deadpool tagged `Google Deepmind / Gemini` at `L1_EXECUTIVE`
 *     and `L2_OPERATIONAL`. They are Nous Research Hermes free/offload seats —
 *     one of them Windows, one WSL — so both the provider and the paid tier were
 *     wrong.
 *   · Copilot absent entirely, despite being a declared paid seat.
 *   · `Hermes Profile` and `unlaunchable_archive` are not seats. Hermes is the
 *     engine underneath Vision and Deadpool; the archive row is a tombstone.
 *
 * WHAT REPLACES IT
 *
 * `server/staff-profile.mjs` is the single declared source, and it is
 * deliberately much smaller: provider/owner, product/client, capacity class,
 * normal host and role family, keyed by Room handle. It holds no live model, no
 * usage, no PID, no assignment and no Room state, because none of those may
 * live in a declared-profile file.
 *
 * WHAT IS LEFT HERE, AND WHY
 *
 * `CANONICAL_STARQ_FLEET` and `src/capacity/quota-tracker.ts` are retained
 * unchanged so their own module graph keeps resolving, and
 * `SEAT_REGISTRY_AUTHORITY` below exists so that no consumer can reach this data
 * by accident while believing it is canonical. `QuotaTracker` has no consumer
 * anywhere in the package and synthesises a quota that no provider API on this
 * floor reports — deleting it is a separate, separately-authorised cleanup, and
 * quietly deleting it inside a roster fix would be scope I was not given.
 */

/** The one declared seat-profile source. Read this instead of the fleet below. */
export const SEAT_REGISTRY_AUTHORITY = {
  status: 'SUPERSEDED',
  authoritative: false,
  superseded_by: 'server/staff-profile.mjs :: STAFF_PROFILE',
  authority_note:
    'NOT CANONICAL. This module carries a stale parallel roster. Do not read CANONICAL_STARQ_FLEET as a source of provider, tier, model or launch policy — read server/staff-profile.mjs for declared seat metadata and 00_STARQ_HQ/operations/herdr-floor/manifest.json for declared launch facts.',
} as const;

export type SeatLaunchPolicy =
  | 'AUTO'
  | 'MANUAL'
  | 'EXTERNAL'
  | 'UNLAUNCHABLE'
  | 'OFFLINE'
  | 'DEGRADED';

export type SeatRuntimeState =
  | 'ONLINE'
  | 'BUSY'
  | 'IDLE'
  | 'PAUSED'
  | 'OFFLINE'
  | 'ERROR'
  | 'UNKNOWN';

export type SeatTier = 'L1_EXECUTIVE' | 'L2_OPERATIONAL' | 'L3_SUPPORT' | 'EXTERNAL_TOOL';

export interface SeatDefinition {
  seatId: string;
  name: string;
  role: string;
  tier: SeatTier;
  launchPolicy: SeatLaunchPolicy;
  defaultProvider: string;
  defaultModel: string;
  harness: string;
  canBuild: boolean;
  canVerify: boolean;
  description: string;
  capabilities: string[];
}

/**
 * Runtime health of a seat.
 *
 * `UNKNOWN` was added to this union deliberately, and it is the most important
 * member of it.
 *
 * The union used to be `'HEALTHY' | 'DEGRADED' | 'UNRESPONSIVE' | 'OFFLINE'`
 * only. That has no member for "nobody has looked", which is the state a seat
 * is actually in before anything observes it. With no such member, the only
 * way to construct a `SeatRuntimeStatus` for an unobserved seat was to pick one
 * of the four, and the cheapest pick was `HEALTHY`. `src/capacity/quota-tracker.ts`
 * duly did exactly that for all ten seats, on construction, with no observation
 * behind it — and since nothing ever corrected those values, the floor served
 * a permanent, confident, fabricated all-green.
 *
 * A type that cannot express "unknown" does not get an honest value assigned
 * to it; it gets a plausible one. Note the asymmetry this created: the sibling
 * `SeatRuntimeState` union below has carried `'UNKNOWN'` the whole time. Health
 * was the one field on this interface an operator reads first, and it was the
 * one field with no way to admit ignorance.
 *
 * `OFFLINE` is NOT a substitute for `UNKNOWN` and neither is `DEGRADED`. Both
 * are claims: `OFFLINE` asserts someone looked and saw nothing running, and
 * `DEGRADED` asserts someone looked and saw something wrong. A tracker that has
 * never polled a seat knows neither, and a degraded-looking value would be its
 * own kind of lie — it manufactures a fault that may not exist in exchange for
 * not manufacturing a fault that does.
 */
export type SeatHealth = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNRESPONSIVE' | 'OFFLINE';

export interface SeatRuntimeStatus extends SeatDefinition {
  runtimeState: SeatRuntimeState;
  currentTaskId?: string;
  activeWorkspace?: string;
  /**
   * Last time a heartbeat was actually OBSERVED for this seat.
   *
   * Absent means "no heartbeat has ever been seen". It is optional rather than
   * nullable so that "never observed" is a shape, not a value: a consumer
   * cannot accidentally render a construction timestamp as though it were a
   * liveness signal. Do not populate this from a process start time, a poll
   * time, or any other clock reading that did not come from the seat.
   */
  lastHeartbeat?: string;
  health: SeatHealth;
  quotaStatus: 'NORMAL' | 'APPROACHING_LIMIT' | 'EXHAUSTED' | 'UNKNOWN';
  /**
   * Whether `runtimeState`, `health` and `lastHeartbeat` came from an
   * observation of the seat, rather than from declaration or default.
   *
   * This exists because `UNKNOWN` alone is ambiguous in a payload: it reads
   * identically whether the seat was never looked at or whether the observer
   * looked and could not tell. This field separates those two, so a consumer
   * can tell "no data" from "data says nothing", and so no future surface can
   * quietly map `UNKNOWN` onto a green tone without this flag contradicting it.
   */
  observed?: boolean;
}

/**
 * Canonical Starq Fleet Roster — **SUPERSEDED, NOT AUTHORITATIVE.**
 *
 * See `SEAT_REGISTRY_AUTHORITY` at the top of this file. Retained only so this
 * module graph keeps resolving; the declared Dev Studio roster lives in
 * `server/staff-profile.mjs` and this list contradicts it.
 *
 * Reflects all seats across Starq: Claude/Elder, Codex, Antigravity, Cursor,
 * Vision, Deadpool, Pi, OpenCode, Goose, Hermes profiles, and local seats.
 */
export const CANONICAL_STARQ_FLEET: SeatDefinition[] = [
  {
    seatId: 'claude',
    name: 'Claude / Elder',
    role: 'Elder & Process Synthesis',
    tier: 'L1_EXECUTIVE',
    launchPolicy: 'MANUAL',
    defaultProvider: 'Anthropic',
    defaultModel: 'Claude 3.7 Sonnet',
    harness: 'Claude Code CLI',
    canBuild: true,
    canVerify: true,
    description: 'Lead process synthesis and architecture authority',
    capabilities: ['reasoning', 'architecture', 'full-stack', 'process-closure'],
  },
  {
    seatId: 'codex',
    name: 'Codex',
    role: 'Senior Core Builder',
    tier: 'L1_EXECUTIVE',
    launchPolicy: 'AUTO',
    defaultProvider: 'OpenAI',
    defaultModel: 'o3-mini',
    harness: 'Codex CLI',
    canBuild: true,
    canVerify: false,
    description: 'High-speed code synthesis and algorithmic implementation',
    capabilities: ['core-building', 'algorithms', 'refactoring'],
  },
  {
    seatId: 'antigravity',
    name: 'Antigravity',
    role: 'Agentic Systems & Control Plane Lead',
    tier: 'L1_EXECUTIVE',
    launchPolicy: 'AUTO',
    defaultProvider: 'Google Deepmind',
    defaultModel: 'Gemini 2.5 Flash / Pro',
    harness: 'Antigravity CLI / AGY',
    canBuild: true,
    canVerify: true,
    description: 'Autonomous agentic control plane and full-stack orchestration',
    capabilities: ['subagents', 'control-plane', 'orchestration', 'full-stack'],
  },
  {
    seatId: 'cursor',
    name: 'Cursor',
    role: 'Interactive IDE Specialist',
    tier: 'L2_OPERATIONAL',
    launchPolicy: 'EXTERNAL',
    defaultProvider: 'Cursor / OpenAI / Anthropic',
    defaultModel: 'Composer Multi-Model',
    harness: 'Cursor IDE',
    canBuild: true,
    canVerify: false,
    description: 'Interactive IDE editor and real-time diff editing',
    capabilities: ['interactive-editing', 'ui-refinement'],
  },
  {
    seatId: 'vision',
    name: 'Vision',
    role: 'Chief Verification Authority & System Architect',
    tier: 'L1_EXECUTIVE',
    launchPolicy: 'AUTO',
    defaultProvider: 'Google Deepmind',
    defaultModel: 'Gemini 2.5 Pro',
    harness: 'Vision CLI / AGY',
    canBuild: false,
    canVerify: true,
    description: 'Independent verification, adversarial review, and quality gates',
    capabilities: ['verification', 'adversarial-testing', 'security-auditing'],
  },
  {
    seatId: 'deadpool',
    name: 'Deadpool',
    role: 'Autonomous Operational Executor',
    tier: 'L2_OPERATIONAL',
    launchPolicy: 'AUTO',
    defaultProvider: 'Google Deepmind',
    defaultModel: 'Gemini 2.5 Flash',
    harness: 'AGY Runner',
    canBuild: true,
    canVerify: false,
    description: 'Rapid execution of operational tasks and maintenance loops',
    capabilities: ['ops', 'maintenance', 'integration-testing'],
  },
  {
    seatId: 'pi',
    name: 'Pi',
    role: 'Lightweight Task Runner',
    tier: 'L3_SUPPORT',
    launchPolicy: 'AUTO',
    defaultProvider: 'Local / Ollama / Lightweight',
    defaultModel: 'Llama 3.3 70B / Mistral',
    harness: 'Pi Runner',
    canBuild: true,
    canVerify: false,
    description: 'Fast local execution for bounded scripting and linting',
    capabilities: ['linting', 'formatting', 'light-scripts'],
  },
  {
    seatId: 'opencode',
    name: 'OpenCode',
    role: 'Open-Source Model Specialist',
    tier: 'L3_SUPPORT',
    launchPolicy: 'MANUAL',
    defaultProvider: 'HuggingFace / Ollama',
    defaultModel: 'DeepSeek-Coder-V2',
    harness: 'OpenCode CLI',
    canBuild: true,
    canVerify: false,
    description: 'Open-weights fallback and offline code generation',
    capabilities: ['offline-coding', 'open-weights'],
  },
  {
    seatId: 'goose',
    name: 'Goose',
    role: 'Autonomous Tool Agent',
    tier: 'L3_SUPPORT',
    launchPolicy: 'MANUAL',
    defaultProvider: 'Block / Goose',
    defaultModel: 'Goose-Agent',
    harness: 'Goose CLI',
    canBuild: true,
    canVerify: false,
    description: 'Autonomous desktop and developer tool driver',
    capabilities: ['tool-automation', 'environment-setup'],
  },
  {
    seatId: 'hermes',
    name: 'Hermes Profile',
    role: 'Profile & Capability Manager',
    tier: 'L2_OPERATIONAL',
    launchPolicy: 'EXTERNAL',
    defaultProvider: 'NousResearch / Local',
    defaultModel: 'Hermes 3',
    harness: 'Hermes Engine',
    canBuild: false,
    canVerify: false,
    description: 'Persona and profile steering across agent conversations',
    capabilities: ['persona-management', 'steering'],
  },
  {
    seatId: 'unlaunchable_archive',
    name: 'Archived Legacy Agent',
    role: 'Legacy Archive',
    tier: 'L3_SUPPORT',
    launchPolicy: 'UNLAUNCHABLE',
    defaultProvider: 'None',
    defaultModel: 'None',
    harness: 'None',
    canBuild: false,
    canVerify: false,
    description: 'Deprecated seat preserved for historical audit logs',
    capabilities: [],
  },
];
