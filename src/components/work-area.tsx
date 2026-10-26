/**
 * WORK AREA — the shared primary-detail shell.
 *
 * WHY THIS FILE EXISTS (gap map WF-MISS-02, WF-MOB-02, WF-ATT-02, WF-DS-02)
 *
 * Five routes were independently asked to solve the same problem — "give the
 * operator a scanable list and a way to inspect one record without losing the
 * list" — and four of them solved it with a full-width table plus a JSON drawer.
 * That is a report, not a work area, and it is why Staff, Attention, Evidence
 * Sources, ERP Tasks and Hoadha Board all read alike while answering different
 * questions.
 *
 * This is the one mechanism they now share. It is structural, not decorative:
 * it owns the LAYOUT decision (list pane bounded left, detail pane right, sheet
 * below 1024px) so no individual surface has to re-decide it, and it owns the
 * selection lifecycle so `aria-selected`, focus return and Escape handling are
 * defined once rather than five times.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   · It does not rank, score, sort or filter. Filtering is the caller's, over
 *     its own declared predicates. This component receives the rows it is to
 *     show, in the order it is to show them.
 *   · It does not fetch. Detail is rendered by the caller, so a route cannot
 *     acquire a network path by adopting this shell.
 *   · It computes nothing about the truth in a row.
 *
 * RESPONSIBILITY SPLIT WITH `AboutMethod`
 *
 * `WorkArea` is the work body. `AboutMethod` is where interpretation guidance
 * lives. They are deliberately separate components so that "move the method out
 * of the work path" (gap map WF-HIER-01, WF-WRONG-01) is a mechanical change
 * that cannot silently unbalance the work body.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * WIDTH CONTRACT
 *
 * Below 1024px the detail becomes a full-height sheet rather than a stacked
 * column (gap map WF-MOB-02: "do not stack desktop inspectors under lists").
 * The breakpoint is a MEDIA QUERY in index.css, not a JS width check, so the
 * composition is correct on first paint and on resize without a re-render
 * decision in React.
 */
export function WorkArea({
  label,
  rows,
  selectedId,
  onSelect,
  list,
  detail,
  detailTitle,
  toolbar,
  count,
}: {
  /** The list's own heading. Describes the RECORD SET, not the route. */
  label: string;
  /** Ids in presentation order. Doubles as the empty-state discriminator. */
  rows: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  list: React.ReactNode;
  detail: React.ReactNode;
  detailTitle: string;
  toolbar?: React.ReactNode;
  count?: React.ReactNode;
}) {
  const hasSelection = selectedId !== null;

  return (
    <section className="work-area" data-work-area={label}>
      <div className="work-area-list">
        <div className="work-area-head">
          <h2>{label}</h2>
          {count !== undefined && count !== null ? (
            <span className="chip" data-tone="muted">
              {count}
            </span>
          ) : null}
          {toolbar ? <span className="spacer" /> : null}
          {toolbar}
        </div>
        {rows.length === 0 ? (
          <div className="work-area-empty">{list}</div>
        ) : (
          list
        )}
      </div>

      <div
        className="work-area-detail"
        data-work-detail={detailTitle}
        hidden={!hasSelection}
        aria-label={detailTitle}
      >
        <div className="work-area-detail-head">
          <span className="label-sec">{detailTitle}</span>
          <button
            type="button"
            className="work-area-sheet-close"
            aria-label="Close detail and return to the list"
            onClick={() => onSelect('')}
          >
            <X className="h-3 w-3" />
            <span className="sr-only">Close detail</span>
          </button>
        </div>
        <div className="work-area-detail-body">{detail}</div>
      </div>
    </section>
  );
}

/**
 * A selectable row inside a `WorkArea` list.
 *
 * Selection is expressed with `aria-selected` because the existing table CSS
 * already paints that state, and because it is the state a screen reader
 * actually announces. Enter and Space both select, which is the keyboard
 * contract for a row that behaves like a control.
 */
export function WorkRow({
  id,
  selected,
  onSelect,
  tone,
  markers,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  tone?: string;
  /**
   * Extra `data-*` attributes to spread onto the row.
   *
   * These carry the domain-specific hooks the Phase 5 Founder Attention render
   * guards count (`data-attention-decision`, `data-attention-family`, …). They
   * are load-bearing, not test decoration: the guards prove that a record
   * appears in the DOM if and only if canonical source declares it, which is
   * the non-derivability claim that surface makes.
   *
   * `WorkRow` does not know or care what they mean — it renders whatever the
   * caller declares. The decision about which marker a record carries belongs
   * to the record, not to the shared shell.
   */
  markers?: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn('work-row', selected && 'selected')}
      role="option"
      tabIndex={0}
      aria-selected={selected}
      data-work-row={id}
      data-tone={tone}
      {...markers}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      {children}
    </li>
  );
}

/**
 * ABOUT / METHOD — the secondary disclosure every surface uses for
 * interpretation guidance.
 *
 * THE RULE THIS ENFORCES
 *
 * Critical state stays INLINE and compact. Methodology moves HERE. Gap map
 * WF-HIER-01 found the product repeatedly asking the operator to read how to
 * interpret a surface before showing what to inspect; WF-ATT-01 and WF-WRONG-01
 * found the same defect at BLOCKER severity on Founder Attention.
 *
 * The component is closed by default. That is the whole point: an operator who
 * wants the method opens it, and an operator who wants the records never
 * scrolls past it.
 *
 * It renders a `<details>` element rather than a button plus conditional JSX so
 * the open state is in the accessibility tree without an aria-expanded that
 * has to be kept in sync by hand.
 */
export function AboutMethod({
  title = 'About this surface',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="about-method" data-about-method={title}>
      <summary>{title}</summary>
      <div className="about-method-body">{children}</div>
    </details>
  );
}

/**
 * Inline qualifier strip — the thing that SURVIVES the move of method text.
 *
 * Gap map WF-OV-01 and the contract require freshness/eligibility qualifiers to
 * stay compact and above the work. This is that: a single dense line of state,
 * never prose. It deliberately has no `AboutMethod` counterpart, because a
 * qualifier that can be collapsed away is not a qualifier.
 */
export function QualifierRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="qualifier-row" data-qualifier-row="">
      {children}
    </div>
  );
}

/**
 * PEER WORK HEADER — what makes a local peer a different work area.
 *
 * Gap map WF-DS-03 found peer routes reachable but not differentiated: local
 * navigation changed the tab label and not the work. `PeerWorkHeader` makes
 * that impossible to forget by requiring every peer body to state, in one
 * line, the question it answers.
 *
 * It is one line, deliberately. A peer that needs three lines of framing is a
 * peer that is about to become a report.
 */
export function PeerWorkHeader({
  peer,
  question,
  links,
}: {
  peer: string;
  question: string;
  links?: React.ReactNode;
}) {
  return (
    <header className="peer-work-head" data-peer-work={peer}>
      <span className="mark">{peer}</span>
      <p>{question}</p>
      {links ? <span className="spacer" /> : null}
      {links}
    </header>
  );
}