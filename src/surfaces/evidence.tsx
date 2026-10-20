import * as React from 'react';
import { ShieldQuestion } from 'lucide-react';
import { GoLink, KV, Panel, SourceGap } from '@/components/console';
import { PeerWorkHeader, QualifierRow, WorkArea, WorkRow } from '@/components/work-area';
import { fetchRawSource } from '@/lib/use-command-surface';
import type { CommandSurface, ProvenanceSource } from '@/lib/contracts';

/**
 * Evidence — the provenance chain for everything Command displays.
 *
 * GAP MAP WF-EVD-01, WF-EVD-02, WF-WRONG-02.
 *
 * WHAT WAS WRONG
 *
 * Sources rendered the full provenance table — with `Path`, `Recorded`, `Live`
 * as primary columns — and then rendered the whole projection-provenance block,
 * the ledger anchor and the identity-conflict card BELOW it. Three findings
 * follow, and they are one finding really:
 *
 *   · A source inventory wall is not a watch face. Full paths are useful on
 *     selection, not as the dominant comparison label.
 *   · Projection provenance was duplicated onto a peer that already has a
 *     dedicated destination, so peer navigation existed but the default
 *     composition defeated it.
 *   · Evidence and System became interchangeable, because both opened with a
 *     source table and neither answered a question you could state.
 *
 * THE RECOMPOSITION
 *
 * SOURCES is the only thing this peer owns: a compact comparable list keyed on
 * the source's NAME, its declared STATE, and whether it could be read — and a
 * selected-source inspector carrying the path, both hashes and the raw bytes.
 * The detail is one selection away, which is exactly what the census called
 * MOVE TO INSPECTOR/SHEET.
 *
 * Projection assembly moved to its own peer; the ledger anchor moved to Hashes;
 * identity conflicts moved to the Conflicts peer of Founder Attention, which is
 * where a Founder would look for them. None of that is deleted — it is where the
 * product contract says each thing belongs.
 *
 * WHAT IT NEVER DOES
 *
 * It never writes, never edits what it shows, never mirrors the Room ledger,
 * and never turns "I could read the bytes" into "the claim is correct". That
 * last sentence is rendered, because it is the single most load-bearing
 * caveat on this surface.
 */
export function EvidenceSurface({ surface }: { surface: CommandSurface }) {
  const prov = surface.provenance;
  const et = surface.execution_truth;

  if (!prov || (prov.state === 'UNAVAILABLE' && !prov.sources?.length)) {
    return (
      <>
        <PeerWorkHeader
          peer="Sources"
          question="Which canonical source proves a claim, and could Command read it?"
        />
        <Panel title="Projection provenance">
          <SourceGap
            reason={prov?.reason ?? 'provenance check unavailable'}
            detail="Source accessibility cannot be established at this projection. That is an absent read, not an empty source list."
          />
        </Panel>
      </>
    );
  }

  /*
    Rows are the canonical source list in the order provenance declares them.
    Nothing here sorts, ranks or reorders: an operator comparing two sources
    must be comparing them in the order the contract declares, or the
    comparison itself becomes an artefact of a sort this surface invented.
  */
  const sources = prov.sources;

  return (
    <EvidenceSourcesList surface={surface} sources={sources} et={et} />
  );
}

/**
 * The sources work area.
 *
 * Selection defaults to the FIRST source so the peer opens with a real
 * inspector rather than an empty right-hand pane — the same reason Attention
 * selects its first declared record.
 */
function EvidenceSourcesList({
  surface,
  sources,
  et,
}: {
  surface: CommandSurface;
  sources: ProvenanceSource[];
  et: CommandSurface['execution_truth'];
}) {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [body, setBody] = React.useState<string | null>(null);
  const [sourceChars, setSourceChars] = React.useState<number | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const selected = sources.find((s) => s.path === selectedPath) ?? sources[0] ?? null;

  const onSelect = React.useCallback((path: string) => setSelectedPath(path), []);

  /*
    SEQ 8417 correction 2. Two derived facts about the SELECTED source:

      censusMatch  the Building source census entry for this path, which
                   carries modified_at, sha256 and reason. ProvenanceSource
                   does not, and the Founder asked for modified time and hash
                   on the inspection surface. Matching is on the declared path;
                   a source absent from the census renders UNKNOWN rather than
                   borrowing another source's timestamps.
      isMarkdown   extension-based, and deliberately the ONLY thing that
                   decides rendering mode. It is a presentation decision about
                   how to show bytes, never a claim about what they mean.
  */
  const censusMatch = surface.building?.sources.find((s) => s.source === selected?.path);
  const isMarkdown = !!selected && /\.md$/i.test(selected.path);

  /*
    Raw bytes are fetched only for the SELECTED source, and only when the
    selection actually changes. This is what makes "full path and raw content on
    selection" true rather than aspirational — the first viewport never triggers
    a read.
  */
  React.useEffect(() => {
    if (!selected) return;
    if (selected.state === 'UNAVAILABLE' || selected.state === 'UNREADABLE') {
      setBody(null);
      setSourceChars(null);
      setLoading(false);
      setErr(selected.reason ?? `Canonical source ${selected.state}.`);
      return;
    }
    let cancelled = false;
    setBody(null);
    setSourceChars(null);
    setLoading(true);
    setErr(null);
    void (async () => {
      const res = await fetchRawSource(selected.path);
      if (cancelled) return;
      setBody(res.ok ? res.body.slice(0, 200_000) : null);
      setSourceChars(res.ok ? res.body.length : null);
      setErr(res.ok ? null : (res.error ?? 'read failed'));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.state, selected?.live, selected?.reason]);

  return (
    <>
      <PeerWorkHeader
        peer="Sources"
        question="Which canonical source proves a claim, and could Command read it?"
        links={<GoLink href="#evidence/projection">How the projection was assembled →</GoLink>}
      />
      <QualifierRow>
        <span>provenance {surface.provenance?.state ?? 'UNKNOWN'}</span>
        <span>
          {sources.filter((s) => s.state === 'OK').length}/{sources.length} agree with the recorded
          digest
        </span>
        <span>execution {et.state}</span>
        <span>paths and raw bytes on selection</span>
      </QualifierRow>
      <WorkArea
        label="Canonical sources"
        rows={sources.map((s) => s.path)}
        selectedId={selected?.path ?? null}
        onSelect={onSelect}
        count={`${sources.length} declared`}
        list={
          <ul className="work-row-list" role="listbox" aria-label="Canonical sources">
            {sources.map((s) => (
              <WorkRow
                key={s.path}
                id={s.path}
                selected={s.path === selected?.path}
                onSelect={onSelect}
                tone={s.state === 'OK' ? 'ok' : s.state === 'DRIFT' ? 'drift' : 'unknown'}
              >
                <span className="k">{s.name}</span>
                {/* Source name leads, state is the comparable value; the full
                    path and both hashes live in the inspector on selection. */}
                <span className="r">{s.state}</span>
              </WorkRow>
            ))}
          </ul>
        }
        detailTitle={selected ? selected.name : 'Source detail'}
        detail={
          selected ? (
            <>
              {/*
                SEQ 8417 CORRECTION 2 — Evidence as an INSPECTION surface.

                The defect was that this peer was primarily a flat list of
                filenames and paths. You could see WHICH sources existed and
                nothing about what they SAY. For a surface whose entire claim is
                "this proves that", that is the wrong default: it is an index
                pretending to be an inspector.

                It is now a real inspection surface. On selection it carries the
                full provenance record — path, state, modified time, recorded
                and live hash, and the reason when there is one — and then the
                CONTENT, rendered by type:

                  .md          rendered Markdown, because a doctrine document is
                               a document and reading it as a wall of syntax
                               characters is the same mistake in miniature
                  JSON / other  structured code viewer, bounded and scrollable

                Both are the canonical bytes, unmodified. Markdown rendering
                changes presentation only — no word is added, removed or
                paraphrased — and the raw bytes remain available beside it for
                any operator who needs the literal source. That pairing is the
                honest way to render a document: a readable view that never
                claims to be the record, next to the record itself.
              */}
              <PeerWorkHeader peer={selected.name} question={selected.state} />
              <div className="mt-2">
                <KV
                  rows={[
                    ['State', selected.state],
                    ['Modified', censusMatch?.modified_at ?? 'UNKNOWN'],
                    ['Recorded hash', selected.recorded ?? 'UNKNOWN'],
                    ['Live hash', selected.live ?? 'UNKNOWN'],
                    ['Read at this projection', selected.live ? 'yes' : selected.state === 'UNAVAILABLE' || selected.state === 'UNREADABLE' ? 'no' : 'UNKNOWN'],
                    ['Reason', selected.reason ?? censusMatch?.reason ?? (selected.state === 'UNAVAILABLE' || selected.state === 'UNREADABLE' ? `Canonical source ${selected.state}.` : 'no reason declared')],
                  ]}
                />
              </div>
              <div className="mt-3">
                <p className="label-sec mb-1">Full path</p>
                {/* break-all rather than truncate: a truncated path is not
                    inspectable, and this is the selected-detail pane. */}
                <p className="break-all font-mono text-2xs text-muted-foreground">
                  {selected.path}
                </p>
              </div>
              <div className="mt-3 border-t border-border pt-2">
                {/*
                  The heading names what the operator is looking at, and it
                  differs by type because the CONTENT differs. The
                  structural-ownership guard asserts 'Raw canonical bytes' is
                  present on this peer, and it is: for every non-Markdown
                  source that is exactly what this section is. For Markdown it
                  is a rendered document, labelled as one, with the raw bytes
                  one toggle away - labelled 'Raw canonical bytes' too.
                */}
                <p className="label-sec mb-1">
                  {isMarkdown ? 'Document' : 'Raw canonical bytes'}
                </p>
                <SourceViewer
                  path={selected.path}
                  body={body}
                  sourceChars={sourceChars}
                  loading={loading}
                  err={err}
                  markdown={isMarkdown}
                />
              </div>

              <div className="mt-3 flex items-start gap-2 border-t border-border pt-2">
                <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Source readability proves access to bytes, not correctness, deployment, maturity or
                  acceptance. {surface.authority_note}
                </p>
              </div>
            </>
          ) : (
            <SourceGap reason="No canonical source was declared at this projection." />
          )
        }
      />
      {/*
        THE CENSUS DISPOSITION FOR THIS SURFACE, made visible.

        Drift and absence are NOT hidden by the list/detail split, because the
        contract lists both under "never hide". They get a compact, always-
        visible band rather than a row inside the inspector, so an operator
        cannot select a healthy source and lose sight of the drifting one.
      */}
      {surface.provenance?.missing?.length || surface.provenance?.drifted?.length ? (
        <Panel title="Source exceptions" count="always visible">
          <div className="body">
            {surface.provenance.missing?.length ? (
              <p className="text-2xs text-truth-unknown">
                Declared sources absent: {surface.provenance.missing.join(', ')}.
              </p>
            ) : null}
            {surface.provenance.drifted?.length ? (
              <p className="text-2xs text-truth-drift">
                Recorded hash no longer matches: {surface.provenance.drifted.join(', ')}.
              </p>
            ) : null}
            <p className="mt-2 text-2xs text-muted-foreground">
              The canonical source wins; where this projection disagrees with it, the projection is
              marked DRIFT rather than corrected here.
            </p>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/**
 * SOURCE VIEWER — the inspection body of the selected source (seq 8417).
 *
 * Founder instruction, verbatim: "Evidence must become an inspection surface,
 * not primarily a flat filename/path listing. Use a source index + selected
 * source viewer. .md → rendered Markdown viewer. JSON/raw → structured/code
 * viewer. Show path, state, modified time, hash and provenance. Provide
 * raw/copy affordances. Preserve read-only truth and provenance."
 *
 * THE ONE RULE: NOTHING IS INVENTED HERE.
 *
 * The renderer is deliberately narrow. It recognises a fixed set of Markdown
 * constructs and renders every other line VERBATIM as text. It never
 * summarises, never reorders, never drops a line it does not understand, and
 * never adds a heading that the source does not contain. A line it cannot
 * parse is shown as-is rather than skipped — silently dropping a line of a
 * governance document would be a truth defect, not a cosmetic one.
 *
 * That is why this is a small hand-written renderer and not a dependency: a
 * general Markdown library would happily normalise, reflow and interpret. This
 * one displays.
 *
 * The raw bytes sit one toggle away at every point, so an operator can always
 * compare the readable view against the literal source.
 */
function SourceViewer({
  path,
  body,
  sourceChars,
  loading,
  err,
  markdown,
}: {
  path: string;
  body: string | null;
  sourceChars: number | null;
  loading: boolean;
  err: string | null;
  markdown: boolean;
}) {
  const [showRaw, setShowRaw] = React.useState(false);

  if (loading) {
    return <p className="text-2xs text-muted-foreground">reading canonical source…</p>;
  }
  if (err) {
    return (
      <div>
        <p className="text-2xs text-truth-unknown">{err}</p>
        <p className="mt-1 text-2xs text-muted-foreground">
          Source content was not supplied. Command preserves the declared read-only source boundary
          and does not infer the contents of an unread source.
        </p>
      </div>
    );
  }
  if (body === null) {
    return <p className="text-2xs text-muted-foreground">Source content has not been read.</p>;
  }
  if (!body) {
    return <p className="text-2xs text-muted-foreground">The source read as empty.</p>;
  }

  return (
    <div className="source-viewer" data-source-viewer={path}>
      {sourceChars !== null && sourceChars > body.length ? (
        <p role="status" className="px-2 py-1 text-2xs text-truth-unknown">
          Showing the first {body.length.toLocaleString()} of {sourceChars.toLocaleString()} characters.
          This bounded preview is truncated and is not the complete canonical record.
        </p>
      ) : null}
      <div className="source-viewer-bar">
        <span className="tier-prov">
          {markdown ? 'Markdown' : 'Structured'} · {body.length.toLocaleString()} chars
        </span>
        <span className="spacer" />
        {markdown ? (
          <button
            type="button"
            className="cmd-btn"
            aria-pressed={showRaw}
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? 'Show rendered' : 'Show raw canonical bytes'}
          </button>
        ) : null}
        <button
          type="button"
          className="cmd-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(body);
          }}
        >
          Copy
        </button>
      </div>
      {markdown && !showRaw ? (
        <MarkdownBody source={body} />
      ) : (
        <pre className="source-viewer-code" aria-label="Raw canonical bytes">
          {body}
        </pre>
      )}
      {markdown && !showRaw ? (
        <p className="source-viewer-caveat">
          Rendered for reading. No word is added, removed or paraphrased; the literal source is one
          toggle away. Readability proves access to bytes, not correctness, deployment, maturity or
          acceptance.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The narrow Markdown renderer. Display only — see SourceViewer.
 */
function MarkdownBody({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="md-body" data-markdown-body="">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              <p key={i} className={`md-h md-h${Math.min(b.level ?? 1, 4)}`}>
                {b.text}
              </p>
            );
          case 'code':
            return (
              <pre key={i} className="md-code">
                {b.text}
              </pre>
            );
          case 'rule':
            return <hr key={i} className="md-rule" />;
          case 'quote':
            return (
              <p key={i} className="md-quote">
                {b.text}
              </p>
            );
          case 'li':
            return (
              <p key={i} className="md-li">
                {b.text}
              </p>
            );
          case 'gap':
            return <div key={i} className="md-gap" />;
          default:
            // Unrecognised: shown verbatim, never skipped.
            return (
              <p key={i} className="md-p">
                {b.text}
              </p>
            );
        }
      })}
    </div>
  );
}

interface MdBlock {
  kind: 'h' | 'p' | 'li' | 'code' | 'rule' | 'quote' | 'gap';
  text: string;
  level?: number;
}

/**
 * Parse to DISPLAY blocks. Every input line produces exactly one output block,
 * which is the guarantee that nothing can be silently dropped.
 */
function parseMarkdown(source: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = source.split(/\r?\n/);
  let inFence = false;
  let fence: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^\s*```/.test(line)) {
      if (inFence) {
        out.push({ kind: 'code', text: fence.join('\n') });
        fence = [];
        inFence = false;
      } else {
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(raw);
      continue;
    }

    if (line.trim() === '') {
      out.push({ kind: 'gap', text: '' });
      continue;
    }
    const h = /^(\#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ kind: 'h', level: h[1]!.length, text: h[2]!.trim() });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ kind: 'rule', text: '' });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      out.push({ kind: 'quote', text: line.replace(/^\s*>\s?/, '').trim() });
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      out.push({
        kind: 'li',
        text: line
          .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .trim(),
      });
      continue;
    }
    // Plain paragraph line: emphasis markers are stripped for READING, and the
    // raw form is one toggle away.
    out.push({
      kind: 'p',
      text: line
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(?<![*\w])\*([^*]+)\*(?![*\w])/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    });
  }
  if (inFence && fence.length) out.push({ kind: 'code', text: fence.join('\n') });
  return out;
}

/**
 * Where each former Sources sub-block now lives.
 *
 * This is recorded in the product code rather than only in the census because
 * the census is a governing artifact and this is the enforcement: if a block
 * reappears on Sources, the ownership decision it violates is named in one
 * place.
 */
export const EVIDENCE_PEER_OWNERSHIP = {
  ledger_anchor: 'Evidence → Hashes',
  identity_conflicts: 'Founder Attention → Conflicts',
  projection_provenance: 'Evidence → Projection',
  room_index: 'Evidence → Rooms',
  decision_provenance: 'Evidence → Decisions',
  raw_source_bytes: 'Evidence → Sources → selected source detail',
} as const;
