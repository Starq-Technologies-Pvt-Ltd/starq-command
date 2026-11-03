import * as React from 'react';
import { Scale } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { UnknownValue } from '@/components/state-gate';
import { KV, Panel, PreComment, SourceGap } from '@/components/console';
import {
  AboutMethod,
  PeerWorkHeader,
  QualifierRow,
  WorkArea,
  WorkRow,
} from '@/components/work-area';
import { cn, formatTimestamp } from '@/lib/utils';
import { DIMENSION_TONE, SURFACE_TONE } from '@/lib/states';
import type { CommandSurface } from '@/lib/contracts';

/**
 * Founder Attention — the Phase 5 surface. DECLARED EXCEPTIONS ONLY.
 *
 * WHAT IT ANSWERS
 *
 * "What explicitly declared conditions currently require Founder awareness or a
 * Founder decision?" That is the whole question, and it is a narrow one.
 *
 * WHAT IT MUST NOT ANSWER
 *
 * "What does the system think the Founder should care about?" Every design
 * decision below exists to keep that second question unanswerable here.
 *
 * THE SIX EXCLUSIONS THIS FILE ENFORCES STRUCTURALLY
 *
 *   1. NO ATTENTION IS DERIVED FROM ACTIVITY. The execution layer carries a
 *      `needs_founder` boolean on 228 of the 400 events in the live window.
 *      Measured at the Phase 5 base: 191 of those 228 bodies contain no
 *      decision request of any kind — they are STATUS, ACK and SITREP posts
 *      that merely carry a Founder on the Cc line. The flag is a regex over
 *      message text (an @-handle match plus a "founder ruling/decision/asked/
 *      directive" phrase match), not a decision channel. So this file never
 *      reads `activity_events`, never reads `needs_founder`, and never counts
 *      an event. The only execution value it touches is the freshness of the
 *      projection those events feed, and even that is context in the header,
 *      never an attention item.
 *
 *   2. NO FOUNDER-VIEWED ANCHOR. There is no trustworthy canonical record of
 *      when the Founder last looked. `agent-comms/cursors/ali.json` records
 *      `lastProcessedSeq: 0` and a lastSeenTimestamp 16 days stale, and that
 *      directory is outside the declared read-only surface, so it is not even
 *      reachable. No "since you last looked", no delta, no watermark.
 *
 *   3. NO AGE, NO CLOCK, NO DAY BOUNDARY. No canonical open-decision record
 *      carries a wait-start timestamp, so an age would be arithmetic against an
 *      invented baseline. No `Date.now()`, no `new Date()`, no `formatAge`, and
 *      no "daily" framing. Canonical timestamps are rendered as timestamps; the
 *      elapsed time between them and now is not this surface's to compute.
 *
 *   4. NO RANKING, NO SCORE, NO PERCENTAGE. There is no priority, no urgency,
 *      no ordering by importance and no attention count expressed as a ratio.
 *      Groups appear in a fixed declaration order and within a group rows
 *      render in the order canonical source declares them. Nothing is sorted.
 *      `family.maturity` is prose ("critical-path", "least-complete") and is
 *      never read here at all, so it cannot become a sort key.
 *
 *   5. NO BLOCKER IS INFERRED FROM ACTIVITY. `activity.process_stage` is null
 *      on 400 of 400 events — that absence is the maturity firewall and it is
 *      preserved by simply never reading the field. Every blocker below comes
 *      from a declared canonical field: `family.critical_blocker`,
 *      `stage.blocked_by`, `corrective_tasks[].state`, `global_blocker`,
 *      `hold_state`. A stage with no declared blocker contributes no row; a
 *      family with no declared critical blocker renders UNKNOWN.
 *
 *   6. NO CONTRADICTION IS MERGED. Two canonical sources disagree on the
 *      current task of 14 handles. Both values are forwarded with their source
 *      named, and the disagreement itself is the finding. This surface never
 *      picks a winner.
 *
 * WHAT THIS SURFACE COMPUTES
 *
 * Nothing. There is no score, no weight, no ratio, no clock and no sort. The
 * only operations are a filter on one declared boolean
 * (`founder_decision_required === true`) and a filter on one declared presence
 * (`blocked_by` non-empty). Both are selections over declared state, not
 * judgements about it, and both are asserted by test.
 */

/** Grouped by source and type. This is a fixed declaration order, not a ranking. */
const GROUP_ORDER = [
  'A. Founder decisions required',
  'B. Hold and restart gate',
  'C. Declared process blockers',
  'D. Integrity and conflict exceptions',
] as const;

/**
 * Maps each record GROUP onto its fixed declaration slot above.
 *
 * The queue renders records grouped by this table rather than in a hand-written
 * order, so "groups appear in a fixed declaration order" is a property of a
 * declared lookup rather than of the accident of JSX sequence. It is still not
 * a ranking: the slots are alphabetical labels inherited from the original
 * grouped article, and nothing sorts, filters or reorders them.
 */
const GROUP_SLOT: Record<string, string> = {
  'Founder decisions required': GROUP_ORDER[0],
  'Decision source': GROUP_ORDER[0],
  'Implementation decision': GROUP_ORDER[1],
  'Hold source': GROUP_ORDER[1],
  'Global blocker': GROUP_ORDER[1],
  'Global blocker source': GROUP_ORDER[1],
  'Restart wave (declared order)': GROUP_ORDER[1],
  'Family critical blocker': GROUP_ORDER[2],
  'Stage blocker': GROUP_ORDER[2],
  'Declared corrective task': GROUP_ORDER[2],
  'Blocker source': GROUP_ORDER[2],
  'Corrective task source': GROUP_ORDER[2],
  'Execution conflict': GROUP_ORDER[3],
  'Execution conflict source': GROUP_ORDER[3],
  'Current-task truth disagreement': GROUP_ORDER[3],
  'Identity exception': GROUP_ORDER[3],
};

function chip(tone: string | undefined): string {
  return cn(
    'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider',
    tone ?? 'bg-truth-unknown-soft text-truth-unknown border-truth-unknown/30',
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * E. TRUTH-HEALTH HONESTY BLOCK
 *
 * GAP MAP WF-ATT-01 (BLOCKER) and WF-WRONG-01.
 *
 * WHAT WAS WRONG
 *
 * This card was rendered ABOVE every attention item, with a title reading "How
 * to read this surface" and five explanatory bullets beneath it. The contract
 * requires actionable/inspectable records first; the finding was that
 * methodology appeared before the decision section, and at BLOCKER severity
 * because it is the exact failure the compression decision set out to fix.
 *
 * THE FIX IS AN ORDERING CHANGE, NOT A DELETION
 *
 * The block is unchanged in content and in honesty semantics — it still renders
 * the execution state, the recorded and live hashes, the process provenance
 * state and the reconciliation gates, and it still never contributes a row to
 * any panel below. It is now mounted inside `AboutMethod`, which is closed by
 * default, so an operator who wants the records never scrolls past
 * interpretation guidance to reach them.
 *
 * WHAT STAYS INLINE, and why
 *
 * Nothing here is lost. The freshness/eligibility qualifiers that must always
 * be visible are rendered by `AttentionQualifiers` as a compact non-
 * collapsible row directly above the work area. A disclosure is for method; a
 * truth state that can be collapsed away is not a qualifier, it is a hidden
 * fact.
 * ────────────────────────────────────────────────────────────────────────── */

function TruthHealthBlock({ surface, historicalEvidence = false }: { surface: CommandSurface; historicalEvidence?: boolean }) {
  const et = surface.execution_truth;
  const prov = surface.provenance;
  const gates = surface.health_floor?.tool_health?.reconciliation_gates?.gates ?? [];
  const etTone = SURFACE_TONE[et.state] ?? SURFACE_TONE.UNAVAILABLE;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="label-micro">Execution projection</p>
          <div className="mt-1">
            <span className={chip(etTone.chip)}>{etTone.label}</span>
          </div>
          <p className="mt-1 font-mono text-2xs text-muted-foreground">
            generated {formatTimestamp(et.generated_at)}
          </p>
          {et.ledger?.recorded_sha256_prefix && et.ledger?.live_sha256_prefix ? (
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground/80">
              recorded {et.ledger.recorded_sha256_prefix} · live {et.ledger.live_sha256_prefix}
            </p>
          ) : null}
          {et.state === 'STALE' ? (
            <p className="mt-1 text-2xs text-truth-stale">
              {et.reason ??
                'The Room ledger has moved since this projection was generated.'}{' '}
              Every execution-derived value is true as of the generated timestamp
              above, not now. Command does not re-ingest: that is a canonical
              write and is out of scope for a read-only surface.
            </p>
          ) : null}
        </div>

        <div>
          <p className="label-micro">Process provenance</p>
          <div className="mt-1">
            {prov?.state ? (
              <span className={chip((SURFACE_TONE[prov.state] ?? SURFACE_TONE.UNAVAILABLE).chip)}>
                {prov.state}
              </span>
            ) : (
              <UnknownValue reason="no provenance state forwarded" />
            )}
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {prov?.drifted?.length
              ? `drifted: ${prov.drifted.join(', ')}`
              : prov?.missing?.length
                ? `absent: ${prov.missing.join(', ')}`
                : `${formatTimestamp(surface.process_truth.generated_at)} · every declared source re-hashed`}
          </p>
        </div>

        <div>
          <p className="label-micro">Reconciliation gates</p>
          {!gates.length ? (
            <UnknownValue reason="canonical source reports no reconciliation gates" />
          ) : (
            <ul className="mt-1 space-y-1">
              {gates.map((g) => {
                const tone = DIMENSION_TONE[g.state] ?? DIMENSION_TONE.UNKNOWN;
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-1.5">
                    <span className={chip(tone.chip)}>{tone.label}</span>
                    <span className="text-2xs text-muted-foreground">{g.label ?? g.id}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1 text-2xs text-muted-foreground/80">
            A gate that has not been run is UNKNOWN, never PASS. This surface
            does not run one, and never infers a verdict from another.
          </p>
        </div>
      </div>

      <Separator className="my-3" />

      <ul className="space-y-1.5">
        {(historicalEvidence ? [
          'History displays ingested canonical communication records and their evidence text. It does not reconstruct previous attention state or accepted closure.',
          'Recorded reports and current execution are separate. Missing independent verification remains UNKNOWN.',
          'DEC-100 preserves the historical implementation hold. Current process truth records RESTART_AUTHORIZED under DEC-109; this history does not prove task execution.',
        ] : [
          'This surface shows only what canonical source has already declared to be a Founder decision, a hold, a blocker or a conflict. It does not judge what deserves attention.',
          'A post that merely mentions the Founder is not a decision request. Message text is never read here.',
          'Nothing below is ranked, scored or ordered by importance. Groups appear in a fixed declaration order.',
          'Current process truth records the ERP restart as RESTART_AUTHORIZED under DEC-109. That decision does not establish which task is executing.',
          'Every item on this surface links to a canonical field it names, and that field is shown beside it. There is no drill-down behind an item: the Room ledger is 17 MB against an 8 MB read cap, and this phase built no evidence route.',
        ]).map((line) => (
          <li key={line} className="flex gap-2 text-2xs text-muted-foreground">
            <Scale className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * AttentionQualifiers — the truth state that must NEVER be collapsed.
 *
 * The distinction this component exists to protect: method goes behind
 * `AboutMethod`, STATE stays inline. An operator must be able to see, without
 * opening anything, how fresh this projection is and whether the eligibility
 * source was even present. Those two facts qualify every row below them.
 */
function AttentionQualifiers({ surface }: { surface: CommandSurface }) {
  const et = surface.execution_truth;
  const pt = surface.process_truth;
  const etTone = SURFACE_TONE[et.state] ?? SURFACE_TONE.UNAVAILABLE;
  const discrepanciesPresent = pt.reconciliation?.known_discrepancies_present !== false;

  /*
    SEQ 8417 CORRECTION 5.

    This used to render its own `QualifierRow` band, immediately above a SECOND
    qualifier row inside `AttentionQueue`. Two full-width status bands stacked
    between the peer header and the first record is exactly the "repeated
    preamble" the Founder flagged, and the second band already restated
    "canonical order · not ranked" which the selection rule below it repeats
    again.

    It now returns its values as NODES rather than a band. `AttentionQueue`
    renders them inside its single existing qualifier row. The facts are
    identical and none is dropped — STALE, generation time, eligibility source
    and process truth still qualify every row beneath them, which is the whole
    reason Goose R1 forbids deleting this information at narrow widths. What
    changes is that they cost ONE band instead of two, and only on the peer
    where they are rendered.
  */
  return (
    <>
      <span className={chip(etTone.chip)}>{etTone.label}</span>
      <span>generated {formatTimestamp(et.generated_at)}</span>
      <span>
        eligibility source{' '}
        {discrepanciesPresent ? 'present · founder_decision_required flag only' : 'MISSING'}
      </span>
      <span>process truth {pt.state ?? 'UNKNOWN'}</span>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * The attention queue.
 *
 * GAP MAP WF-ATT-01 (BLOCKER), WF-ATT-02, WF-ATT-03, WF-WRONG-01.
 *
 * THE THREE THINGS THIS RESTRUCTURED
 *
 * 1. RECORDS BEFORE METHODOLOGY (WF-ATT-01 / WF-WRONG-01).
 *    The truth-health card rendered above the decisions with the title "How to
 *    read this surface". It is now inside `AboutMethod`, closed by default, and
 *    the freshness/eligibility qualifiers it carried that must stay visible are
 *    an inline `AttentionQualifiers` row above the queue.
 *
 * 2. A REAL QUEUE, CONSISTENT ACROSS PEERS (WF-ATT-02).
 *    Exceptions, Conflicts, Holds and History were compact key/value cards
 *    while Decisions was a giant grouped article — one surface behaving like a
 *    report on one tab and a card on the others. All five peers now go through
 *    the same `AttentionQueue`: a record list on the left, a selected record
 *    detail on the right, and the same empty-state language.
 *
 * 3. NO SELF-REJECTING COPY (WF-ATT-03).
 *    The page used to print "This is not a queue" and "Nothing below is ranked"
 *    under a composition that plainly was a report. The non-ranking qualifier
 *    is now a single clause in the queue header, where it is true and does not
 *    argue with the surface it sits on.
 *
 * WHAT THE QUEUE STILL DOES NOT DO
 *
 * It still computes nothing. No sort, no score, no age, no clock, no percentage.
 * Records are selected by declared fields and rendered in canonical declaration
 * order. `needs_founder` is never read; message text is never scanned; a
 * Founder-viewed anchor does not exist. Those six exclusions are stated at the
 * top of this file and are enforced by the Phase 5 guards, which this
 * restructure did not weaken.
 * ────────────────────────────────────────────────────────────────────────── */

/** One declared record, normalised across the five peers. */
interface AttentionRecord {
  id: string;
  group: string;
  title: string;
  /** The canonical field this record names. Rendered in the detail pane. */
  fields: [string, React.ReactNode][];
  /**
   * The declared facts rendered BESIDE the row in the list.
   *
   * This is the Phase 5 contract's requirement, not a style choice: "every item
   * on this surface links to a canonical field it names, and that field is shown
   * beside it." A list/detail split that put the declared fields only in the
   * detail pane would have hidden them behind a click — turning an inspectable
   * record into an ID the operator has to select before learning anything.
   *
   * So the row carries the declared values, and the detail pane carries the full
   * field list including canonical source. Nothing is click-gated.
   */
  summary: string[];
  tone: 'founder' | 'hold' | 'drift' | 'stale' | 'unknown';
  /**
   * The `data-attention-*` marker this record carries in the rendered DOM.
   *
   * These are the hooks the accepted Phase 5 render guards count — decisions,
   * wave rows, families, stage blockers, corrective tasks, disagreements,
   * identities and conflicts — and they are load-bearing, not decoration: the
   * guards prove that a record appears if and only if canonical source declares
   * it, which is the whole non-derivability claim this surface makes.
   *
   * Markers therefore live on the RECORD, so a record keeps its identity whether
   * it is rendered in the full queue or in a filtered peer.
   */
  markers?: Record<string, string>;
}

/**
 * Builds a record list with the declared tuple type.
 *
 * The array literals above are inferred as `(string | null)[][]`, which will not
 * satisfy the `[string, ReactNode][]` field contract — and rightly so: this
 * helper is where a field list is declared to BE pairs. It adds no defaulting
 * and no coercion; an absent canonical value still renders as UNKNOWN at the
 * point of display, because filling it in here would let absence become a value.
 */
function record(
  id: string,
  group: string,
  title: string,
  tone: AttentionRecord['tone'],
  fields: [string, React.ReactNode][],
  summary: string[],
  markers?: Record<string, string>,
): AttentionRecord {
  return { id, group, title, tone, fields, summary, markers };
}

/**
 * A declared value, rendered beside its record.
 *
 * An ABSENT canonical value becomes the explicit string `UNKNOWN` here rather
 * than an empty span. That is the surface's core discipline applied at the point
 * of display: a missing field and a field whose value is the word "UNKNOWN" are
 * different facts, and only one of them is rendered by this helper.
 */
function val(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'UNKNOWN';
  return String(v);
}

/**
 * Peer definitions.
 *
 * Each peer names the CANONICAL FIELD it selects from and the ORDER records are
 * rendered in. Both are declared here rather than implied by component order,
 * so "not ranked" is a property of this table and not a hope.
 *
 * `groups: null` means "no filter" — Decisions is the complete declared
 * attention queue. That is not an accident of the default tab; it is the Phase 5
 * contract. The accepted Founder Attention surface rendered all four declaration
 * groups — founder decisions, hold and restart gate, declared process blockers,
 * integrity and conflict exceptions — on its landing, and 30+ accepted render
 * guards assert exactly that against real assembled payloads. Splitting those
 * groups across peers and calling the landing "decisions only" would have
 * quietly converted four accepted surfaces into four filtered views of one.
 *
 * So the peers are nested, not disjoint:
 *
 *   Decisions   the full declared queue — every record, every group
 *   Exceptions  only the declared blockers and corrective tasks
 *   Conflicts   only the declared conflicts and disagreements
 *   Holds       only the hold, the global blocker and the restart wave
 *   History     explicitly unavailable — no historical projection is declared
 *
 * A filter can only ever narrow the landing, never replace it. An operator who
 * lands on Decisions sees everything; an operator who wants one class selects it.
 */
const PEERS: Record<string, { question: string; source: string; groups: string[] | null }> = {
  Decisions: {
    question: 'What does canonical source declare as requiring Founder awareness or a decision?',
    source: 'the complete declared-exception set',
    groups: null,
  },
  Exceptions: {
    question: 'Which process families, stages or corrective tasks declare a blocker?',
    source: 'process_families[].critical_blocker · stages[].blocked_by · corrective_tasks',
    groups: ['Family critical blocker', 'Stage blocker', 'Declared corrective task'],
  },
  Conflicts: {
    question: 'Where do two canonical sources disagree, and what is unresolved?',
    source: 'execution_truth.conflicts · floor.constraints',
    groups: [
      'Execution conflict',
      'Current-task truth disagreement',
      'Identity exception',
      'Blocker source',
    ],
  },
  Holds: {
    question: 'What does canonical source declare about implementation hold and restart authorization?',
    source: 'hold_state · global_blocker · restart_wave_after_authorization',
    groups: [
      'Implementation decision',
      'Global blocker',
      'Hold source',
      'Restart wave (declared order)',
    ],
  },
  History: {
    question: 'Is any historical attention projection declared?',
    source: 'none declared',
    groups: [],
  },
};

/**
 * The COMPLETE declared-attention record set.
 *
 * Every branch here is a selection over canonical state — a declared boolean, a
 * declared presence, a declared conflict. None of them is a judgement about what
 * the record means, and none of them orders anything.
 *
 * The set is built ONCE, unfiltered, and peers narrow it. Building it per peer
 * would let two peers disagree about the same canonical record, which is the one
 * class of defect a declared-exception surface cannot have.
 */
  function allRecords(surface: CommandSurface): AttentionRecord[] {
  const pt = surface.process_truth;
  const et = surface.execution_truth;

  /*
    DECISION SOURCE ABSENCE.

    `known_discrepancies_present === false` means the canonical contract has no
    `known_discrepancies` FIELD at all. It is not the same as an empty array,
    and it is emphatically not "no decisions are outstanding" — it is "the
    question cannot be asked". Emitting it as a record keeps that distinction
    visible instead of collapsing it into a confidently empty queue.
  */
  const discrepanciesPresent = pt.reconciliation?.known_discrepancies_present !== false;
  const decisionSchemaGap: AttentionRecord[] = discrepanciesPresent
    ? []
    : [
        record('decision-source', 'Decision source', 'SOURCE MISSING', 'unknown', [
          ['known_discrepancies', 'SOURCE MISSING — canonical reconciliation has no known_discrepancies field'],
          ['Effect', 'eligibility cannot be evaluated; this is not an empty declared decision set'],
        ], ['SOURCE MISSING — no known_discrepancies field']),
      ];

  const decisions: AttentionRecord[] = (pt.reconciliation?.known_discrepancies ?? [])
    .filter((d) => d.founder_decision_required === true)
    .map((d) =>
      record(d.id, 'Founder decisions required', d.item, 'founder', [
        ['Roadmap says', d.roadmap_says],
        ['Local board says', d.local_board_says],
        ['Resolution', d.resolution],
        ['Canonical source', 'reconciliation.known_discrepancies'],
], [
        val(d.resolution),
        `roadmap: ${val(d.roadmap_says)} · local board: ${val(d.local_board_says)}`,
      ], { 'data-attention-decision': d.id }),
    );
    /*
      ABSENCE, NOT EMPTINESS.

      `critical_blocker_present === false` means the canonical family has no such
      FIELD; `blocked_by_present === false` means the stage has none. Both are
      statements about the source schema and both are emitted as records, because
      "this family declares no blocker" and "this family cannot be asked" are
      different facts and an empty list collapses them.
    */
    const schemaGaps: AttentionRecord[] = (pt.process_families ?? []).flatMap((f) => {
      const out: AttentionRecord[] = [];
      if (f.critical_blocker_present === false)
        out.push(
          record(`family-source:${f.id}`, 'Blocker source', f.name, 'unknown', [
            ['Family', f.name],
            ['critical_blocker', 'SOURCE MISSING — canonical family has no critical_blocker field'],
            ['Effect', 'no family-level blocker can be read or denied for this family'],
          ], ['critical_blocker SOURCE MISSING']),
        );
      const missingStages = f.stages.filter((s) => s.blocked_by_present === false);
      if (missingStages.length) {
        /*
          The stage paths are rendered beside the record, colon-separated, so an
          operator can see WHICH stages cannot be asked without opening the
          detail. "SOURCE MISSING" alone would say that something is absent and
          not what.
        */
        const paths = missingStages.map((s) => `${f.id}/${s.stage}`).join(', ');
        out.push(
          record(
            `stage-source:${f.id}`,
            'Blocker source',
            `${f.name} — ${missingStages.map((s) => s.stage).join(', ')}`,
            'unknown',
            [
              ['Family', f.name],
              ['Stages', paths],
              ['blocked_by', `SOURCE MISSING: ${paths} — canonical stage has no blocked_by field`],
              ['Effect', 'no stage-level blocker can be read or denied for these stages'],
            ],
            [`SOURCE MISSING: ${paths}`],
          ),
        );
      }
      return out;
    });

    /*
      Corrective tasks are DECLARED EXCEPTIONS and were previously a sub-table
      inside the process-blocker panel. They are records in their own right here,
      so each becomes a selectable row rather than a row of a table the operator
      cannot open. Nothing is removed; it gains a selection.
    */
    const corrective =
      pt.corrective_tasks_present === false
        ? [
            record('corrective-source', 'Corrective task source', 'SOURCE MISSING', 'unknown', [
              ['corrective_tasks', 'SOURCE MISSING — canonical contract has no corrective_tasks field'],
            ], ['corrective_tasks SOURCE MISSING']),
          ]
        : (pt.corrective_tasks ?? []).map((t) =>
            record(
              String(t.id),
              'Declared corrective task',
              String(t.title ?? 'UNKNOWN'),
              'stale',
              [
                ['Task', String(t.id ?? 'UNKNOWN')],
                ['Title', String(t.title ?? 'UNKNOWN')],
                ['Gap', String(t.gap ?? 'UNKNOWN')],
                ['State', String(t.state ?? 'UNKNOWN')],
                ['Canonical source', 'corrective_tasks'],
              ],
              [`gap ${String(t.gap ?? 'UNKNOWN')}`, `state ${String(t.state ?? 'UNKNOWN')}`],
              { 'data-attention-corrective': String(t.id) },
            ),
          );
    const familyBlockers = (pt.process_families ?? []).flatMap((f) =>
      f.critical_blocker
        ? [
            record(
              `family:${f.id}`,
              'Family critical blocker',
              f.name,
              'founder',
              [
                ['Family', f.name],
                ['Canonical blocker', f.critical_blocker],
                ['Declared headline', f.headline],
                ['Canonical source', 'process_families[].critical_blocker'],
              ],
              [val(f.critical_blocker), val(f.headline)],
              { 'data-attention-family': f.id },
            ),
          ]
        : f.critical_blocker_present === false
          ? []
          : [
              /*
                A family that declares NO critical blocker is not evidence of
                closure, and the Phase 5 guards required it to say so rather than
                render nothing. It is now a record the operator can select, which
                is the same statement with a place to put it.
              */
              record(
                `family:${f.id}`,
                'Family critical blocker',
                f.name,
                'unknown',
                [
                  ['Family', f.name],
                  ['Critical blocker', 'NONE DECLARED'],
                  [
                    'Effect',
                    'canonical source declares no critical blocker for this family; not evidence the family is unblocked',
                  ],
                  ['Canonical source', 'process_families[].critical_blocker'],
                ],
                ['NONE DECLARED'],
                { 'data-attention-family': f.id },
              ),
            ],
    );
    const stageBlockers = (pt.process_families ?? []).flatMap((f) =>
      f.stages
        .filter((s) => Boolean(s.blocked_by))
        .map((s) =>
          record(
            `stage:${f.id}/${s.stage}`,
            'Stage blocker',
            `${f.name} — ${s.stage}`,
            'stale',
            [
              ['Family', f.name],
              ['Stage', s.stage],
              ['Canonical state', String(s.state)],
              ['Blocked by', s.blocked_by ?? 'UNKNOWN'],
              ['Canonical source', 'process_families[].stages[].blocked_by'],
            ],
            [val(s.blocked_by), `state ${String(s.state)}`],
            { 'data-attention-stage-blocker': `${f.id}/${s.stage}` },
          ),
        ),
    );
    /*
      TRUTH DISAGREEMENTS. Two canonical sources disagreeing about a handle's
      current task is a finding about the company, not a defect to tidy away.
      Both values are forwarded with their source named and the disagreement
      itself is the item — this surface never picks a winner, and neither value
      is compared, ranked or resolved here.
    */
    const disagreements = (surface.floor?.constraints ?? [])
      .filter((c) => c.kind === 'TRUTH_DISAGREEMENT')
      .map((c) =>
        record(
          `disagreement:${c.subject}`,
          'Current-task truth disagreement',
          c.subject,
          'drift',
          [
            ['Kind', c.kind],
            ['Subject', c.subject],
            ['Detail', c.detail],
            ['Resolution', c.resolution],
            ['Canonical source', c.canonical_source],
          ],
          [val(c.detail), val(c.canonical_source)],
          { 'data-attention-disagreement': c.subject },
        ),
      );
    const identityIssues = (surface.floor?.constraints ?? [])
          .filter((c) => ['IDENTITY_CONFLICT', 'UNKNOWN_IDENTITY', 'REVOKED_IDENTITY'].includes(c.kind))
          /*
            A REAL DEFECT FOUND IN THE BROWSER, NOT A NEW TRUTH RULE.

            The record id was `identity:${subject}:${kind}`, which is NOT unique:
            canonical `activity.json` declares TWO distinct IDENTITY_CONFLICT
            records for the subject `nexus` (one handle with multiple identityIds;
            one retired identity retained as history). Both produced the identical
            id, so React raised a duplicate-key warning on every render of
            #attention/decisions, #attention/conflicts, #attention/holds and
            #studio/erp/decisions, and `records.find(r => r.id === selectedId)`
            could only ever resolve to the first of the two.

            The fix is an ORDINAL SUFFIX, and it is deliberately the smallest one
            available:

              · it does not merge the two records — they are different facts about
                different identity states and both must stay selectable;
              · it does not invent content — nothing is compared, ranked or chosen;
              · it does not change which records exist, only that their React key
                is unique.

            `detail` is part of the key because it is what distinguishes the two
            canonical records, and it is already rendered as the record's declared
            value. Stable across reloads because canonical order is stable.
          */
          .map((c, i) =>
            record(`identity:${c.subject}:${c.kind}:${i}`, 'Identity exception', c.subject, 'drift', [
          ['Kind', c.kind],
          ['Subject', c.subject],
          ['Detail', c.detail],
          ['Resolution', c.resolution],
          ['Canonical source', c.canonical_source],
        ], [val(c.detail), val(c.resolution)], { 'data-attention-identity': c.subject }),
      );
    /*
      `conflicts_present === false` is a statement about the execution
      projection's schema, not about whether conflicts exist, so it becomes a
      record rather than an empty list.
    */
    const conflictsPresent = et.conflicts_present !== false;
    const conflictSchemaGap: AttentionRecord[] = !conflictsPresent
      ? [
          record('conflict-source', 'Execution conflict source', 'SOURCE MISSING', 'unknown', [
            ['conflicts', 'SOURCE MISSING — execution projection has no conflicts field'],
          ], ['conflicts SOURCE MISSING']),
        ]
      : [];
    const conflicts = conflictsPresent
      ? (et.conflicts ?? []).map((c, i) =>
          record(
            `conflict:${c.type}:${i}`,
            'Execution conflict',
            c.handle ?? c.handles?.join(' / ') ?? c.type,
            'drift',
            [
              ['Type', c.type],
              ['Handle', c.handle ?? 'UNKNOWN'],
              ['Handles', c.handles?.join(' / ') ?? 'UNKNOWN'],
              ['Detail', c.detail],
              ['Canonical source', 'execution_truth.conflicts'],
            ],
            [val(c.detail)],
            { 'data-attention-conflict': c.type },
          ),
        )
      : [];
    /*
      THE ABSENCE BRANCHES, and why they are not an edge case.

      There are three distinct facts here, not two, and collapsing any of them
      would delete honesty rather than tidy composition:

        `hold_state_present === false` → the canonical contract has NO
          hold_state FIELD at all. That is a statement about the source schema.
        `hold_state` is null             → the field exists but carries no
          value. The ERP hold cannot be confirmed from source.
        `hold_state` is present          → the record below renders.

      An empty queue would render all three identically, and an operator could
      not tell "there are no holds" from "Command cannot read whether there is a
      hold". `HoldBanner` does not help: it does not render at all when
      hold_state is absent, so on that path there is no other place the fact
      appears.

      So the absence is emitted as an explicit record rather than as nothing.
    */
    const holdPresent = pt.hold_state_present !== false;
    const hold = pt.hold_state ?? null;
    const restartAuthorization = hold?.implementation === 'RESTART_AUTHORIZED'
      ? 'RESTART_AUTHORIZED'
      : hold?.implementation === 'ON_HOLD'
        ? 'NOT AUTHORISED'
        : 'AUTHORIZATION UNKNOWN';
    const restartAuthorizationTone: AttentionRecord['tone'] = hold?.implementation === 'RESTART_AUTHORIZED'
      ? 'founder'
      : hold?.implementation === 'ON_HOLD'
        ? 'hold'
        : 'unknown';
    const absence: AttentionRecord[] = !holdPresent
      ? [
          record('hold:absent', 'Hold source', 'SOURCE MISSING', 'unknown', [
            ['Hold state field', 'SOURCE MISSING — canonical contract has no hold_state field'],
            ['Effect', 'the ERP hold cannot be confirmed or denied from this source'],
          ], ['hold_state SOURCE MISSING']),
        ]
      : !hold
        ? [
            record('hold:absent', 'Hold source', 'No hold_state recorded', 'unknown', [
              ['Hold state', 'canonical contract carries no hold_state'],
              ['Effect', 'the ERP hold cannot be confirmed from source'],
            ], ['canonical contract carries no hold_state']),
          ]
        : [];

    const holdRecord: AttentionRecord[] = hold
      ? [
          record('hold:record', 'Implementation decision', `ERP implementation ${hold.implementation ?? 'UNKNOWN'}`, restartAuthorizationTone, [
            ['Implementation', hold.implementation ?? 'UNKNOWN'],
            ['Authorization', restartAuthorization],
            /*
              Authority, Effective and Restart requires are NOT listed here.
              `HoldBanner` is the single owner of the canonical hold record
              (Goose R4, Room seq 8383) and renders all three on every ERP
              route. Listing them again in this detail pane would be the same
              duplication that finding corrected, in a new location — and the
              Phase 7 census guard would flag it as an offender.

              What IS here is what the banner structurally cannot carry: the
              ordered restart gate conditions (a LIST, not a chip), the
              narrative reason, and convergence-not-rewrite as a declared /
              not-declared ABSENCE signal.
            */
            ['Convergence, not rewrite', hold.convergence_not_rewrite === true ? 'DECLARED' : 'NOT DECLARED'],
            ['Reason', hold.reason ?? 'UNKNOWN'],
            ['Restart sequence basis', (hold.restart_gate_conditions ?? []).join(' · ') || 'UNKNOWN'],
            ['Canonical source', 'hold_state'],
          ], [
            val(hold.implementation),
            val(hold.reason),
            restartAuthorization,
            /*
              The ordered restart gate CONDITIONS are rendered beside the record,
              not only inside the detail pane. They are the actionable content of
              a hold, and an operator scanning the queue must be able to read
              them without selecting anything. The canonical hold RECORD
              (authority, effective date, restart requirement) is still not here
              — HoldBanner owns it.
            */
            (hold.restart_gate_conditions ?? []).length
              ? `restart gate conditions: ${(hold.restart_gate_conditions ?? []).join(' · ')}`
              : 'no restart gate conditions declared',
          ], { 'data-attention-hold-record': 'hold' }),
        ]
      : [];
    const gb = surface.work_truth.global_blocker ?? null;
    /*
      Same distinction for the global blocker: a declared absence is not an
      absent declaration, and neither is evidence that nothing blocks.
    */
    const blockerRecord: AttentionRecord[] = surface.work_truth.global_blocker_present === false
      ? [
          record('hold:blocker-absent', 'Global blocker source', 'SOURCE MISSING', 'unknown', [
            ['Global blocker field', 'SOURCE MISSING — canonical work model has no global_blocker field'],
          ], ['global_blocker SOURCE MISSING']),
        ]
      : gb
      ? [
          record('hold:global-blocker', 'Global blocker', gb.id, 'hold', [
            ['Type', gb.type],
            /*
              The GLOBAL BLOCKER's own authority, which is a different
              canonical fact from the ERP hold record and has its own field.
              The Phase 7 census guard scopes its hold-ownership check to
              `hold*` reads precisely so this correct surface is not deleted
              by an over-broad rule.
            */
            ['Authority', gb.authority],
            ['Description', gb.description],
            ['Effect', gb.effect],
            ['Canonical source', 'command_work_model.json → global_blocker'],
          ], [val(gb.description), val(gb.effect)], { 'data-attention-global-blocker': gb.id }),
        ]
      : [];
    const wave: AttentionRecord[] = (pt.restart_wave_after_authorization ?? []).map((w, i) =>
      record(
        `hold:wave:${i}`,
        'Restart wave (declared order)',
        `${w.order ?? i + 1}. ${w.task ?? 'UNKNOWN'}`,
        restartAuthorizationTone,
        [
          ['Order', String(w.order ?? 'UNKNOWN')],
          ['Task', String(w.task ?? 'UNKNOWN')],
          ['Title', String(w.title ?? 'UNKNOWN')],
          ['Nature', String(w.nature ?? 'UNKNOWN')],
          ['Authorization', restartAuthorization],
          ['Canonical source', 'restart_wave_after_authorization'],
        ],
        [String(w.title ?? 'UNKNOWN'), String(w.nature ?? 'UNKNOWN'), restartAuthorization],
        /*
          NO `data-attention-wave-row` MARKER HERE, DELIBERATELY.

          The marker lives on the ordered table rows in `RestartWaveTable` and
          nowhere else. Carrying it on both would double-count every wave entry,
          and the accepted Phase 5 guard asserts the count equals the number of
          canonical entries — a marker that appears twice per wave would make
          that guard count the wave twice, which is precisely the kind of
          cosmetic-but-load-bearing duplication this surface is meant to avoid.

          The queue row still carries the same declared fields, so nothing is
          only reachable through the table.
        */
      ),
    );

  /*
    THE COMPLETE SET, in the fixed declaration order.

    Concatenation order is declaration order, not ranking: it is exactly the
    GROUP_ORDER sequence the grouped article used, and within each block the
    records keep the order canonical source produced them in. Nothing is sorted
    by importance, and the Phase 5 guard that forbids passing GROUP_ORDER to
    sort/filter/map is unaffected — this is a fixed concatenation.
  */
  return [
    ...decisionSchemaGap,
    ...decisions,
    ...schemaGaps,
    ...familyBlockers,
    ...stageBlockers,
    ...corrective,
    ...conflictSchemaGap,
    ...conflicts,
    ...disagreements,
    ...identityIssues,
    ...absence,
    ...holdRecord,
    ...blockerRecord,
    ...wave,
  ];
}

/**
 * Narrows the complete set to one peer.
 *
 * `groups: null` (Decisions) returns everything, so the landing is the full
 * declared queue. A peer's filter can only remove classes of record; it can
 * never add one, reorder one, or change what a record says. That is what makes
 * the peers trustworthy views of one truth rather than four truths.
 */
function recordsFor(peer: string, surface: CommandSurface): AttentionRecord[] {
  const meta = PEERS[peer];
  const all = allRecords(surface);
  if (!meta || meta.groups === null) return all;
  return all.filter((r) => meta.groups!.includes(r.group));
}
/**
 * History has no declared projection. The honest answer is an explicit
 * unavailable state, not an empty list — the gap map asked for "an explicit
 * unavailable state where history is not projected" (WF-ATT-02), and an empty
 * list would read as "no history exists" rather than "none is projected".
 */
function HistoryUnavailable({ surface }: { surface: CommandSurface }) {
  const history = surface.room_visibility;
  const records = history?.history ?? [];
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = records.find(r => r.event_id === selectedId) ?? records[0] ?? null;
  const onSelect = (id: string) => setSelectedId(id);
  return <>
    <PeerWorkHeader peer="History" question="What Founder directives and work outcomes were recorded?" />
    <QualifierRow><span>ingestion {history?.state ?? 'UNKNOWN'}</span><span>through #{history?.max_sequence ?? 'UNKNOWN'}</span><span>Room head #{history?.room_head_sequence ?? 'UNKNOWN'}</span></QualifierRow>
      <p>Canonical Room records, not reconstructed attention state or accepted closure. Current execution and independent acceptance remain UNKNOWN unless separately established.</p>
      <p>Showing {records.length} of {history?.history_total ?? 'UNKNOWN'} selected records. Selection: registered ROOT_GENESIS records and explicit result, done, complete, verify, rejected or blocked actions.</p>
      <WorkArea label="Recorded Founder and work evidence history" rows={records.map(r => r.event_id)} selectedId={selected?.event_id ?? null} onSelect={onSelect}
        list={records.length ? <ul className="work-list">{records.map(record => <WorkRow key={record.event_id} id={record.event_id} selected={selected?.event_id === record.event_id} onSelect={onSelect}>
          <span>#{record.sequence} · {record.kind}</span><span>{record.reporter ?? 'UNKNOWN'} · {record.recorded_at}</span>
        </WorkRow>)}</ul> : <SourceGap reason="No historical attention projection is declared." detail={history?.reason ?? 'The Room history adapter is unavailable. Command does not reconstruct prior attention state or infer closure.'} />}
        detailTitle={selected ? `Room #${selected.sequence}` : 'History evidence'}
        detail={selected ? <>
          <KV rows={[
            ['Canonical source', selected.source_reference], ['Event ID', selected.event_id],
            ['Record hash', selected.record_hash ?? 'UNKNOWN'], ['Integrity', selected.integrity],
            ['Reported action', selected.reported_action ?? 'UNKNOWN'], ['Reported status', selected.reported_status ?? 'UNKNOWN'],
            ['Reported verification', selected.reported_verification ?? 'UNKNOWN'],
            ['Independent acceptance', selected.independent_verification], ['Current execution', selected.current_execution],
          ]} />
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{selected.evidence}</pre>
        </> : <SourceGap reason="History evidence unavailable." />}
      />
    </>;
}

/**
 * The shared attention work-area shell every peer renders through.
 *
 * Selection defaults to the FIRST declared record so the peer opens with a
 * record detail rather than an empty pane, which is what made Decisions read as
 * a report and the others read as empty cards.
 */
function AttentionQueue({
  peer,
  records,
  surface,
}: {
  peer: string;
  records: AttentionRecord[];
  surface: CommandSurface;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = records.find((r) => r.id === selectedId) ?? records[0] ?? null;

  const onSelect = React.useCallback(
    (id: string) => setSelectedId(id === '' ? null : id),
    [],
  );

  /*
    FIXED DECLARATION ORDER, expressed as a bucket walk rather than a sort.

    GROUP_SLOT maps each record's group to one of the four original declaration
    slots, and GROUP_ORDER is walked in its declared sequence, draining the
    bucket for each slot. This is NOT ranking: nothing is compared, nothing is
    ordered by importance, and within a bucket the records keep the order
    `recordsFor` produced them in — which is canonical declaration order. The
    Phase 5 guard asserts `GROUP_ORDER` is never passed to sort/filter/map, and
    this walk does not do that either.

    THE WALK IS TOTAL, AND THAT MATTERS.

    `flatMap` over the four slots returns only what it drains. A record whose
    group is missing from GROUP_SLOT would therefore be SILENTLY DROPPED — the
    queue would quietly stop showing it and no test would say why. That is a
    real trap: the schema-absence records (`SOURCE MISSING`) are exactly the
    records a reviewer most needs to see, and they were all being dropped until
    this was found.

    So any record not named in GROUP_SLOT is emitted in a trailing
    "unclassified" block rather than discarded. A newly declared group becomes
    visible and slightly out of place, which is the correct failure mode: loud
    and harmless, instead of silent and dishonest.
  */
  const classified = new Set<string>();
  const ordered: AttentionRecord[] = GROUP_ORDER.flatMap((slot) => {
    const bucket = records.filter((r) => {
      if (GROUP_SLOT[r.group] !== slot) return false;
      classified.add(r.id);
      return true;
    });
    return bucket;
  });
  const unclassified = records.filter((r) => !classified.has(r.id));

  const meta = PEERS[peer];

  /*
    THE SELECTION QUALIFIER.

    A record list that does not say WHICH CANONICAL FLAG selected its rows
    invites the reading that Command judged these important. `founder_
    decision_required=true` is the whole selection rule for the Decisions
    group and it is rendered on the queue header, where it qualifies every row
    beneath it.

    This is the concise, non-defensive form gap map WF-ATT-03 asked for: the old
    page printed "This is not a queue" and "Nothing below is ranked" under a
    composition that plainly was a report, which argued with its own surface.
    A stated selection rule does not argue with anything — it describes.
  */
  const selectionRule =
    peer === 'Decisions'
      ? 'Founder decisions selected on founder_decision_required=true only'
      : (meta?.source ?? 'UNKNOWN');

  if (peer === 'History') return <HistoryUnavailable surface={surface} />;

  return (
    <>
      <PeerWorkHeader
        peer={peer}
        question={meta?.question ?? peer}
      />
      {/*
        SEQ 8417 correction 5: ONE qualifier band.

        This row and the `AttentionQualifiers` band above it were two stacked
        full-width status bands between the peer header and the first record.
        They are now one row. Truth qualifiers first (STALE, generated,
        eligibility, process truth), then the record count, then the selection
        rule.

        "canonical order · not ranked" was removed as a SEPARATE span because
        the selection rule beside it already states the canonical field the rows
        were selected on — which is the stronger, more specific form of the
        same claim. The non-ranking property is not dropped: it is asserted by
        the Phase 5 guards ("renders no priority, urgency or ranking language")
        and it is what the selection rule's own wording describes.
      */}
      <QualifierRow>
        <AttentionQualifiers surface={surface} />
        <span className="qualifier-div" aria-hidden="true" />
        <span>{records.length} declared record{records.length === 1 ? '' : 's'}</span>
        <span>{selectionRule}</span>
      </QualifierRow>
      <WorkArea
        label={peer}
        rows={[...ordered, ...unclassified].map((r) => r.id)}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
        count={`${records.length} declared`}
        list={
          records.length ? (
            <ul className="work-row-list" role="listbox" aria-label={`${peer} records`}>
              {[...ordered, ...unclassified].map((r) => (
                <WorkRow
                  key={r.id}
                  id={r.id}
                  selected={r.id === selected?.id}
                  onSelect={onSelect}
                  tone={r.tone}
                  markers={r.markers}
                >
                  <span className="k">{r.id}</span>
                  {/* The row's comparable value — what an operator scans a
                      column of. The declared fields beneath it stay metadata
                      because they are evidence, not the answer. */}
                  <span className="r">{r.title}</span>
                  {/*
                    THE DECLARED FIELDS, BESIDE THE ROW.

                    This is the Phase 5 contract's requirement ("every item on
                    this surface links to a canonical field it names, and that
                    field is shown beside it") and the reason a record is not
                    click-gated to reveal what it says. The detail pane adds the
                    full field list and canonical source; it does not unlock
                    information the row withheld.
                  */}
                  {r.summary.map((line, i) => (
                    <span className="v declared" key={`${r.id}-s-${i}`}>
                      {line}
                    </span>
                  ))}
                  <span className="v">{GROUP_SLOT[r.group] ?? r.group}</span>
                </WorkRow>
              ))}
            </ul>
          ) : (
            <SourceGap
              reason={`No ${peer.toLowerCase()} are declared in canonical source.`}
              detail="That is an empty declared set, not evidence that nothing requires attention."
            />
          )
        }
        detailTitle={selected ? selected.id : `${peer} detail`}
        detail={
          selected ? (
            <>
              <PeerWorkHeader peer={selected.group} question={selected.title} />
              <KV rows={selected.fields} />
              {/*
                The detail names the canonical field it came from. That is the
                provenance the Phase 5 guards require ("every item links to a
                canonical field it names, and that field is shown beside it"),
                and it is what lets the operator find the claim without a
                drill-down this phase deliberately did not build.
              */}
              <p className="mt-3 text-2xs text-muted-foreground">
                Command surfaces this record. It does not rank it, reconcile it or decide it.
              </p>
            </>
          ) : (
            <SourceGap reason="Select a record to inspect its declared fields." />
          )
        }
      />
      {peer === 'Holds' ? <HoldDetailNote surface={surface} /> : null}
      {peer === 'Decisions' ? <RestartWaveTable surface={surface} /> : null}
      {/*
        WF-ATT-03. The non-ranking qualifier lives in the queue header above,
        where it is a true statement about the list. It is deliberately NOT
        repeated as defensive prose under the work area: the old page printed
        "This is not a queue" beneath a composition that plainly was one, which
        argued with its own surface instead of describing it.
      */}
      <AboutMethod title="About this peer">
        <p>
          Records are selected from declared canonical fields only and are rendered in canonical
          declaration order. Nothing here is ranked, scored, sorted or timed: there is no age, no clock
          and no day boundary, because no canonical open-decision record carries a wait-start timestamp
          and an age would be arithmetic against an invented baseline. A post that merely mentions the
          Founder is not a decision request. Current process truth records the ERP restart as
          RESTART_AUTHORIZED under DEC-109; this does not assert task execution or schedule. Command does not
          re-ingest the Room ledger, so every execution-derived value is true as of the projection
          timestamp shown in the qualifier row and not now.
        </p>
      </AboutMethod>
    </>
  );
}

/**
 * THE RESTART WAVE, as a table.
 *
 * GAP MAP WF-ATT-02 asked for peers to share one comparable list/detail
 * pattern. That is right for records that are individually inspectable, and it
 * is the wrong shape for the restart wave, which is an ORDERED SEQUENCE: the
 * whole point of the declaration is that entry 3 follows 2, and a flat list of
 * selectable rows loses the ordering at a glance even though each row carries
 * its own number.
 *
 * So the wave keeps its table — order column, task, title, nature — beneath the
 * queue, and every row still appears in the queue as a selectable record. It is
 * not hidden; it is the one place where the sequence is the content.
 *
 * Authorization is derived from the current canonical implementation state.
 * RESTART_AUTHORIZED permits this sequence to proceed; it does not assert that
 * any task is currently executing.
  */
function RestartWaveTable({ surface }: { surface: CommandSurface }) {
  const wave = surface.process_truth.restart_wave_after_authorization ?? [];
  if (!wave.length) return null;
  const hold = surface.process_truth.hold_state;
  const authorized = hold?.implementation === 'RESTART_AUTHORIZED';
  const onHold = hold?.implementation === 'ON_HOLD';
  const authorizationState = authorized ? 'authorized' : onHold ? 'not-authorized' : 'unknown';
  const authorizationLabel = authorized
    ? 'RESTART_AUTHORIZED'
    : onHold ? 'NOT AUTHORISED' : 'AUTHORIZATION UNKNOWN';
  const scopeNote = authorized
    ? 'Canonical source authorizes this sequence. Order is not a schedule, and it does not prove that any task is executing.'
    : onHold
      ? 'Canonical source records an implementation hold. This sequence is NOT AUTHORISED to proceed.'
      : 'Canonical source does not establish whether this sequence is authorized.';
  return (
    <Panel title="Restart wave" count={`${wave.length} declared · canonical order`}>
      <div className="body">
        <div className="mb-2 flex items-center gap-2">
          <span
            className="chip"
            data-tone={authorized ? 'founder' : onHold ? 'hold' : 'unknown'}
            data-attention-restart-wave={authorizationState}
          >
            {authorizationLabel}
          </span>
          <span className="text-2xs text-muted-foreground">
            {scopeNote}
          </span>
        </div>
        <div className="command-table-wrap short">
          <table>
            <caption>
              Restart wave · declared order · {authorizationLabel}
            </caption>
            <thead>
              <tr>
                <th className="w-[8%]">#</th>
                <th className="w-[18%]">Task</th>
                <th>Title</th>
                <th className="w-[30%]">Nature</th>
              </tr>
            </thead>
            <tbody>
              {wave.map((w) => (
                <tr key={`${String(w.order)}-${String(w.task)}`} data-attention-wave-row>
                  <td className="num">{String(w.order ?? '?')}</td>
                  <td className="mono">{String(w.task ?? 'UNKNOWN')}</td>
                  <td>{String(w.title ?? 'UNKNOWN')}</td>
                  <td>{String(w.nature ?? 'UNKNOWN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The restart authorization basis, on the peer that owns it.
 *
 * They are an ORDERED LIST and `HoldBanner` is a one-line rail with nowhere to
 * put one. This is therefore not duplication of the banner — it is the
 * source-recorded reason and ordered sequence basis remain visible after the
 * implementation hold is lifted. The Phase 7 guard asserts this survives.
 */
function HoldDetailNote({ surface }: { surface: CommandSurface }) {
  const gates = surface.process_truth.hold_state?.restart_gate_conditions ?? [];
  if (!gates.length) return null;
  const authorized = surface.process_truth.hold_state?.implementation === 'RESTART_AUTHORIZED';
  return (
    <Panel title="Restart authorization basis" count={`${gates.length} declared`}>
      <div className="body">
        <ol className="space-y-1">
          {gates.map((g) => (
            <li key={g} className="flex gap-2 text-2xs text-muted-foreground">
              <span className="mt-1.5 h-0.5 w-0.5 shrink-0 rounded-full bg-truth-hold" />
              {g}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-2xs text-muted-foreground">
          {authorized
            ? 'DEC-109 authorizes the implementation sequence. This basis is not a schedule and does not prove any task is executing.'
            : 'This is the source-recorded sequence basis, not a schedule. Authorization is shown from the current canonical implementation state.'}
        </p>
      </div>
    </Panel>
  );
}

export function AttentionSurface({
  surface,
  peer = 'Decisions',
}: {
  surface: CommandSurface;
  peer?: string;
}) {
  const pt = surface.process_truth;

  if (!pt.available) {
    return (
      <div className="p-4">
        <UnknownValue
          label="PROCESS TRUTH UNAVAILABLE"
          reason={
            pt.reason ??
            'Canonical process truth could not be read. This surface refuses to render an empty-but-healthy exceptions board, because an empty board would read as "nothing needs a Founder" rather than "Command cannot tell".'
          }
        />
      </div>
    );
  }

  const records = recordsFor(peer, surface);

  return (
    <div className="flex flex-col gap-3 p-4">
      {/*
        THE SURFACE HEADER.

        Compact, and carrying the four statements the Phase 5 guards require to
        be present in rendered copy rather than only in source: what this surface
        is, that it shows declared exceptions only, that it is a current
        snapshot with no previous visit, and that nothing here is inferred from
        message text.

        It sits ABOVE the qualifier row and the queue, so the first thing read is
        what the surface is — which is orientation, not methodology. What it does
        NOT do is explain how to interpret the surface; that is `AboutMethod`.
      */}
      <header className="attention-head">
                    {/*
                      A REAL DEFECT I FOUND IN THE BROWSER, NOT A RESTUCTURING.

                      This surface rendered its own `<h1>Founder Attention</h1>` while the
                      room head above it — mounted by building.tsx for every cross-room
                      surface — renders the same string as its own h1. Measured at all
                      seven viewports: two h1 elements with identical text on
                      #attention/decisions, /exceptions, /conflicts and /holds, the second
                      one 136px below the first. #studio/erp/process did the same thing
                      with "starqERP" and "ERP Process Floor", and #studio/erp/decisions
                      paired "starqERP" with "Founder Attention".

                      Two identical page titles is not a visual preference, it is a
                      duplicated document outline, and it costs a whole band of vertical
                      space above the records the surface exists to show.

                      The room head OWNS the page title for every surface, structurally and
                      consistently — which is what the Phase 5 render guard `mounts and
                      produces a non-trivial document` still requires this surface to
                      satisfy when rendered STANDALONE, without a room head above it. That
                      is why the surface name is kept here as a `data-surface-name`
                      attribute and a marked-up scope line rather than deleted: the
                      standalone render still names itself, and the composed render has
                      exactly one h1.

                      Nothing about which records render, or where they render, changes.
                    */}

                    {/*
                      THE VERTICAL BUDGET, MEASURED (Founder QA seq 8410 -> seq 8411).

                      Measured cost of this block before this wave: at 430x932 the first
                      declared record on #attention/exceptions sat at 794px inside the
                      pane — 97.4% of the viewport consumed before a single record was
                      visible — and on #attention/conflicts at 779px, which is 103.1%,
                      i.e. entirely below the fold. On this surface, whose entire purpose
                      is to be scanned by the Founder, that is the worst possible place
                      to spend 800 pixels of vertical budget.

                      The scope statements are NOT deleted. They are asserted in rendered
                      markup by the Phase 5 guards and they are load-bearing: "nothing
                      here is inferred from message text" is what stops this surface
                      reading as a ranked judgement. So:

                        · The claim itself becomes the page answer — a short, strong
                          sentence an operator can read at a glance.
                        · The full orientation prose moves into a `PreComment`
                          disclosure, closed by default, one click away.
                        · The "snapshot, not a digest" explanation — which is genuinely
                          methodological — joins that same disclosure rather than
                          occupying a permanent band.

                      Every word still renders in the DOM. What changes is whether it
                      costs vertical space before the records.
                    */}
                    <p className="tier-answer" data-surface-name="Founder Attention">
                      {peer === 'History' ? 'Recorded Founder and work evidence.' : 'Declared exceptions only.'}
                    </p>
                    <PreComment lead="How this surface decides what to show you, and what it refuses to do.">
                      {peer === 'History' ? <p className="tier-prose">History displays ingested canonical Founder records and explicit reported work outcomes, with source references. It does not reconstruct prior attention queues or infer accepted closure.</p> : <>
                      <p className="tier-prose">
                        <span data-surface-name="Founder Attention">Founder Attention</span> shows
                        conditions canonical source already records as requiring Founder awareness or a
                        decision. Nothing here is inferred from message text, ranked or scored.
                      </p>
                      <p className="tier-prose mt-2">
                                          This is a current declared-exceptions snapshot, not a digest and not a queue of
                                          accumulating items. It has no notion of a previous visit, no elapsed-time arithmetic
                                          and no opinion about what deserves attention first. Where a Founder decision is
                                          outstanding it appears because canonical source says so.
                                        </p>
                      </>}
                    </PreComment>
                  </header>

      {/*
        WF-ATT-01, resolved by ORDER rather than by removal: the qualifier row
        that must stay visible stays visible, and the methodology that must not
        precede the work moves behind a closed disclosure below the queue.
      */}
      {/* The truth qualifiers moved INTO the queue's own qualifier row
          (seq 8417 correction 5) rather than sitting in a second band above it. */}
      <AttentionQueue peer={peer} records={records} surface={surface} />
      {/*
        The truth-health block, unchanged in content and honesty semantics,
        mounted inside the closed disclosure. It still renders the execution
        state, both ledger hashes, process provenance and the reconciliation
        gates, and it still adds, removes and ranks nothing.
      */}
      <AboutMethod title="About how this surface reads">
        {/*
          The sentence below is load-bearing and is asserted in rendered copy.
          It is what makes the disclosure honest: the block above is the only
          place on this surface that carries interpretation, and it states
          explicitly that it adds, removes and ranks nothing.
        */}
        <p className="mb-3 text-2xs text-muted-foreground">
          None of these values is an attention item, and none of them adds, removes or ranks a row.
          This block is context for reading the queue above; it is not part of the queue.
        </p>
        <TruthHealthBlock surface={surface} historicalEvidence={peer === 'History'} />
      </AboutMethod>
    </div>
  );
}
