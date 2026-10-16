/**
 * STARQ // COMMAND — versioned serialisable snapshot.
 *
 * WHY THIS EXISTS
 *
 * A phone client is a future requirement, and this file exists so that when it
 * arrives, it does not have to renegotiate the data boundary. The rule from
 * the Founder: local Command remains authoritative, and the shape must be
 * ready before the transport is.
 *
 * WHAT THIS IS NOT
 *
 * This is NOT remote access, NOT sync, NOT cloud, and NOT a second SSOT. No
 * network call is made from this file. Nothing is pushed anywhere. The
 * snapshot is a READ of the same read-only surface the local UI already
 * renders, wrapped in a self-describing envelope.
 *
 * WHAT THE ENVELOPE GUARANTEES
 *
 *   schema_version   Bumped on any breaking shape change. A future client
 *                    refuses a version it does not understand rather than
 *                    guessing at fields.
 *   projection_version  The canonical contract version this projection was
 *                    built from. The client can tell WHICH truth it is holding.
 *   generated_at     When the local surface was assembled, in UTC.
 *   provenance       Every canonical source, with digests and the recorded
 *                    digests the contract itself claims.
 *   freshness        Per-source age and reachability, so a client can render
 *                    STALE without reimplementing a single rule.
 *   state            The explicit OK / FAIL / STALE / DRIFT / UNAVAILABLE /
 *                    UNKNOWN state, never a boolean.
 *
 * ABSOLUTE PATHS ARE REDACTED
 *
 * A snapshot is designed to leave the machine. `D:\!starq\...` is a fact about
 * one host, is useless to a client on another, and leaks local directory
 * structure. Paths under the workspace are rewritten to workspace-relative
 * form; anything absolute and outside it is replaced with an explicit marker.
 * The redaction is asserted by test, not merely intended by comment.
 *
 * REDACTION REACHES INSIDE PROSE, NOT JUST WHOLE VALUES
 *
 * A redaction that only fires when an entire string is a path is not a
 * redaction. Canonical forwarded prose carries paths mid-sentence — "vendor
 * install already on C:\Users\...\cli (vendor footprint, do not expand)" — and
 * those are exactly the values that leak. Every occurrence of a path anywhere
 * in a string is rewritten, and the surrounding sentence survives.
 */
import { DIMENSION, DIMENSION_PRECEDENCE, SNAPSHOT_SCHEMA_VERSION, summarizeFloor } from './health-floor.mjs';

const ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const REDACTION = '[REDACTED_ABSOLUTE_PATH]';

/**
 * The portable-path assertion, exported so the test that enforces it uses
 * exactly the rule the redactor applies.
 *
 * The negative lookahead matters. A naive `/[A-Za-z]:[\\/]/` also matches the
 * tail of `file://`, because `e:/` looks exactly like a drive letter and a
 * separator. That would fail the test for a correct implementation and train
 * everyone to ignore it, so the drive letter must be a standalone token and the
 * separator must not itself begin a URL authority.
 *
 * This is a DETECTOR, and it is applied to PARSED string values rather than to
 * `JSON.stringify` output. Serialising first doubles every backslash, so the
 * lookahead above rejects its own output and the assertion passes against a
 * snapshot that still leaks. Test the value, not its serialisation.
 */
export const ABSOLUTE_WINDOWS_PATH = /(?:^|[^A-Za-z0-9_])[A-Za-z]:(?![\\/]{2})[\\/]/;

/**
 * Characters that may appear inside a path segment.
 *
 * Deliberately excludes the prose delimiters `( ) , ; : ? " '` so a path
 * inside a sentence terminates at the sentence rather than eating it.
 *
 * `!` is included even though it opens an English exclamation, because this
 * workspace's own root is `D:\!starq` — leaving it out truncated every
 * workspace path at `D:\` and stranded the rest of it in the prose.
 */
const PATH_SEGMENT_CHAR = /[A-Za-z0-9_\-.~+@!#$%&^=]/;

/** A path does not end in a separator, a dot, or whitespace. */
const PATH_TAIL = /[.\s\\/]+$/;

/**
 * Measure the path that begins at `start` (the drive letter) and return the
 * index just past it, or -1 if there is no path there.
 *
 * The difficulty is that a path may contain spaces — `C:\Users\Ali Musthaq\`
 * is one path — while prose between two paths also does. The rule used here:
 * a space CONTINUES the path only when another separator follows the words
 * after it. That keeps `Ali Musthaq\AppData` one path, and stops
 * `D:\AgentRuntimes and D:\...` at `D:\AgentRuntimes`, because "and" is not
 * followed by a separator.
 *
 * A trailing separator or dot is trimmed rather than consumed, so sentence
 * punctuation after a path stays in the prose instead of vanishing with it.
 */
function scanPath(value, start) {
  let i = start + 3; // past the drive letter, the colon and the first separator
  for (;;) {
    let segEnd = i;
    while (segEnd < value.length && PATH_SEGMENT_CHAR.test(value[segEnd])) segEnd += 1;
    if (segEnd === i) break; // an empty segment means the path already ended

    let afterSpace = segEnd;
    while (afterSpace < value.length && value[afterSpace] === ' ') afterSpace += 1;

    if (afterSpace > segEnd) {
      // A space sits inside a segment only if a further segment follows it.
      let probe = afterSpace;
      while (probe < value.length && PATH_SEGMENT_CHAR.test(value[probe])) probe += 1;
      const continues =
        probe < value.length && (value[probe] === '\\' || value[probe] === '/');
      if (!continues) break;
      i = afterSpace;
      continue;
    }

    if (segEnd < value.length && (value[segEnd] === '\\' || value[segEnd] === '/')) {
      i = segEnd + 1;
      continue;
    }
    break;
  }

  // `i` is where the last segment began, so fall back to its end.
  let segEnd = i;
  while (segEnd < value.length && PATH_SEGMENT_CHAR.test(value[segEnd])) segEnd += 1;
  let end = Math.max(i, segEnd);
  while (end > start + 3 && PATH_TAIL.test(value[end - 1])) end -= 1;
  return end > start + 2 ? end : -1;
}

/** Every absolute-path span in a string, in order and non-overlapping. */
function findPathSpans(value) {
  const spans = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!/[A-Za-z]/.test(value[i])) continue;
    // The drive letter must be a standalone token, not the tail of a word.
    if (i > 0 && /[A-Za-z0-9_]/.test(value[i - 1])) continue;
    if (value[i + 1] !== ':') continue;
    if (value[i + 2] !== '\\' && value[i + 2] !== '/') continue;
    // Same URL guard as ABSOLUTE_WINDOWS_PATH: `file://` is not a drive path.
    if (value[i + 3] === '/' || value[i + 3] === '\\') continue;
    const end = scanPath(value, i);
    if (end < 0) continue;
    spans.push({ start: i, end });
    i = end - 1;
  }
  return spans;
}

function toRelative(root, value) {
  if (typeof value !== 'string') return value;
  if (!ABSOLUTE_PATH.test(value)) return value;
  if (!root) return REDACTION;
  const normalisedRoot = root.replace(/[\\/]+$/, '');
  const normalisedValue = value.replace(/[\\/]+$/, '');
  if (normalisedValue === normalisedRoot) return '.';
  if (normalisedValue.startsWith(`${normalisedRoot}\\`) || normalisedValue.startsWith(`${normalisedRoot}/`)) {
    return normalisedValue.slice(normalisedRoot.length + 1).split('\\').join('/');
  }
  return REDACTION;
}

/**
 * Rewrite every absolute path in a string, wherever it appears.
 *
 * The whole-value case still works exactly as before — a value that IS a path
 * is relativised or marked — but a path embedded in a sentence is now rewritten
 * in place and the sentence around it is preserved.
 */
function redactString(root, value) {
  const spans = findPathSpans(value);
  if (spans.length === 0) return value;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += value.slice(cursor, span.start);
    out += toRelative(root, value.slice(span.start, span.end));
    cursor = span.end;
  }
  return out + value.slice(cursor);
}

/**
 * Deep-rewrite absolute paths, returning a fresh structure.
 *
 * Arrays and plain objects are rebuilt; every other value is passed through
 * untouched, so this is safe on the arbitrary JSON the canonical projections
 * carry without needing to know their shape.
 */
function redact(value, root, depth = 0) {
  if (depth > 12) return value;
  if (typeof value === 'string') return redactString(root, value);
  if (Array.isArray(value)) return value.map((v) => redact(v, root, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === 'absolute_path' ? toRelative(root, v) : redact(v, root, depth + 1);
    }
    return out;
  }
  return value;
}

function ageSeconds(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/** Per-source freshness, expressed so a client never re-derives a rule. */
function buildFreshness(surface, floor, now) {
  const reach = floor?.source_reachability?.sources ?? [];
  const ingestFreshness = {
    id: 'executionTruthIngest',
    label: 'Room ledger → activity projection',
    state: surface.execution_truth?.state ?? DIMENSION.UNKNOWN,
    generated_at: surface.execution_truth?.generated_at ?? null,
    age_seconds: ageSeconds(surface.execution_truth?.generated_at, now),
    recorded_sha256_prefix: surface.execution_truth?.ledger?.recorded_sha256_prefix ?? null,
    live_sha256_prefix: surface.execution_truth?.ledger?.live_sha256_prefix ?? null,
    detail: surface.execution_truth?.reason ?? 'recorded hash matches the live ledger',
  };

  const sources = reach.map((s) => ({
    id: s.id,
    path: s.path,
    role: s.role,
    state: s.state,
    bytes: s.bytes,
    modified_at: s.modified_at,
    age_seconds: ageSeconds(s.modified_at, now),
    sha256_prefix: s.sha256_prefix,
    hashed: s.hashed,
  }));

  const contract = surface.process_truth ?? {};
  const workModel = surface.work_truth ?? {};
  return {
    assembled_at: surface.assembled_at,
    states: {
      process_truth: contract.state ?? DIMENSION.UNAVAILABLE,
      execution_truth: surface.execution_truth?.state ?? DIMENSION.UNAVAILABLE,
      work_truth: workModel.state ?? DIMENSION.UNAVAILABLE,
      provenance: surface.provenance?.state ?? DIMENSION.UNAVAILABLE,
    },
    staleness_rule_hours: contract.execution_truth_layer_meta?.staleness?.stale_after_hours ?? null,
    ingest: ingestFreshness,
    sources,
  };
}

/**
 * Build the snapshot envelope.
 *
 * Deterministic in shape and free of host-specific absolute paths, so two
 * clients on two machine can compare a `schema_version` and know whether they
 * are speaking the same contract.
 *
 * `scope` is the one knob, and it exists for the phone client rather than for
 * convenience. `summary` drops the verbatim event feed — which is by far the
 * largest part of the payload and is a scrolling view, not state — while
 * keeping every truth layer, dimension and digest intact. A small screen
 * should not have to download an event log to render a health floor, and the
 * states it needs to render correctly are all still present.
 */
export function buildSnapshot({ surface, floor, workspaceRoot, scope = 'full' }) {
  const now = Date.now();
  const root = workspaceRoot ?? null;
  const resolvedScope = scope === 'summary' ? 'summary' : 'full';

  const provenance = {
    authority: surface.authority_note ?? 'DERIVED_PROJECTION',
    declared_sources: surface.read_only_sources ?? [],
    contract_provenance: surface.provenance ?? null,
    contract_recorded: {
      version: surface.process_truth?.version ?? 'UNKNOWN',
      status: surface.process_truth?.status ?? 'UNKNOWN',
      generated_at: surface.process_truth?.generated_at ?? null,
      canonical_ssoT: surface.process_truth?.canonical_ssoT ?? null,
    },
  };

  const summary = summarizeFloor(floor);

  // `summary` scope keeps every state, count and digest and drops only the
  // verbatim event feed. The omission is declared in the payload itself rather
  // than left for the client to infer from a missing key.
  const executionTruth =
    resolvedScope === 'summary' && surface.execution_truth
      ? {
          ...surface.execution_truth,
          activity_events: undefined,
          activity_events_omitted: {
            omitted: true,
            reason: 'scope=summary excludes the verbatim event feed',
            count: surface.execution_truth.activity_events?.length ?? 0,
            available_at: '/api/surface',
          },
        }
      : (surface.execution_truth ?? null);

  const envelope = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    scope: resolvedScope,
    projection: 'STARQ // COMMAND',
    authority: 'DERIVED_PROJECTION',
    is_ssot: false,
    access: 'READ_ONLY',
    transport: {
      mode: 'local',
      note: 'This envelope is designed to be transport-agnostic. No remote sync, no remote write and no cloud access exist. A future client fetches; the local Command remains authoritative.',
    },
    generated_at: new Date(now).toISOString(),
    projection_version: surface.process_truth?.version ?? 'UNKNOWN',
    command_version: floor?.runtime?.app_version ?? 'UNKNOWN',
    workspace: {
      // Deliberately not the absolute root. `ref` is a stable, non-identifying
      // handle; the local UI still shows the real path on the System surface.
      ref: root ? root.split(/[\\/]/).filter(Boolean).pop() : null,
      resolution: floor?.runtime?.workspace_resolution ?? 'UNKNOWN',
      root_included: false,
      reason: 'absolute host paths are not part of a portable snapshot',
    },
    state: {
      overall: floor?.state ?? DIMENSION.UNAVAILABLE,
      floor_summary: summary,
      precedence: DIMENSION_PRECEDENCE,
      vocabulary: DIMENSION,
    },
    freshness: buildFreshness(surface, floor, now),
    provenance,
    health_floor: floor,
    truth: {
      process_truth: surface.process_truth ?? null,
      execution_truth: executionTruth,
      work_truth: surface.work_truth ?? null,
      identities: surface.identities ?? null,
      staff_state: surface.staff_state ?? null,
    },
  };

  return redact(envelope, root);
}
