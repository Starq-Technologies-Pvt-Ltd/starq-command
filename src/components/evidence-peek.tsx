import * as React from 'react';
import { ChevronDown, ChevronRight, FileWarning, Loader2 } from 'lucide-react';
import { fetchRawSource } from '@/lib/use-command-surface';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/**
 * EvidencePeek — drill down from any asserted fact to the canonical file it
 * came from.
 *
 * Two rules govern what this component is allowed to do:
 *
 *   1. IT ONLY READS. It calls the existing /api/raw route, which is guarded by
 *      path-guard.mjs. There is no path here that reaches outside the declared
 *      read-only surface, and no path that writes.
 *
 *   2. IT NEVER SILENTLY TRUNCATES. A canonical source that is too large to
 *      inline is reported as too large, with its real byte count. A viewer that
 *      quietly showed the first 200 KB of a 17 MB ledger would be worse than
 *      one that refuses, because the Founder would read a fragment as the file.
 */
export function EvidencePeek({
  path,
  label,
  defaultOpen = false,
  maxChars = 24000,
}: {
  path: string;
  label?: string;
  defaultOpen?: boolean;
  maxChars?: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [state, setState] = React.useState<'IDLE' | 'LOADING' | 'LOADED' | 'REFUSED'>('IDLE');
  const [body, setBody] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setState('LOADING');
    setError(null);
    const res = await fetchRawSource(path);
    if (res.ok) {
      setBody(res.body);
      setState('LOADED');
    } else {
      setBody('');
      setError(res.error ?? 'read refused');
      setState('REFUSED');
    }
  }, [path]);

  return (
    <div className="rounded-md border border-border bg-surface-0/40">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Content is fetched on demand, never preloaded. A surface that
          // pulled thirteen canonical files on every poll would be slow for a
          // view the Founder may never open.
          if (next && state === 'IDLE') void load();
        }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.03]"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-2xs text-muted-foreground">{label ?? path}</span>
        {state === 'LOADING' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" /> : null}
        {state === 'REFUSED' ? (
          <Badge variant="outline" className="ml-auto shrink-0 border-truth-unknown/30 text-truth-unknown">
            NOT READABLE
          </Badge>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-border px-2.5 py-2">
          {state === 'LOADING' ? (
            <p className="text-2xs text-muted-foreground">Reading canonical source…</p>
          ) : null}

          {state === 'REFUSED' ? (
            <div className="flex items-start gap-2 text-2xs text-truth-unknown">
              <FileWarning className="mt-0.5 h-3 w-3 shrink-0" />
              <div>
                <p className="font-medium">This source could not be inlined.</p>
                <p className="mt-0.5 text-muted-foreground">{error}</p>
                <p className="mt-1 text-muted-foreground/80">
                  The path is outside the declared read-only surface, absent, or too large to inline.
                  Command reports that rather than serving you a fragment.
                </p>
              </div>
            </div>
          ) : null}

          {state === 'LOADED' ? (
            <>
              <pre
                className={cn(
                  'max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-1 p-2 font-mono text-[10px] leading-relaxed text-foreground/85',
                )}
              >
                {body.length > maxChars ? body.slice(0, maxChars) : body}
              </pre>
              {body.length > maxChars ? (
                <p className="mt-1.5 text-2xs text-truth-stale">
                  Display truncated at {maxChars.toLocaleString()} of {body.length.toLocaleString()}{' '}
                  characters <strong>for display only</strong> — the file on disk is unmodified and
                  complete. This is a viewer limit, not a property of the source.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A row of evidence paths under a fact. */
export function EvidenceList({ paths, label = 'Evidence' }: { paths: string[]; label?: string }) {
  if (!paths.length) {
    return (
      <p className="text-2xs text-muted-foreground/70">
        {label}: none declared for this finding.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="label-micro">{label}</p>
      <div className="space-y-1">
        {paths.map((p) => (
          <EvidencePeek key={p} path={p} />
        ))}
      </div>
    </div>
  );
}

/**
 * Opens the versioned snapshot in a new tab.
 *
 * It is a link to a local read-only route, not a download the app performs: the
 * envelope is large and the Founder may want it in a scratch file for a future
 * client to be written against. Nothing is pushed anywhere.
 */
export function SnapshotLink({ scope = 'summary' }: { scope?: 'full' | 'summary' }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={`/api/snapshot?scope=${scope}`} target="_blank" rel="noreferrer">
        View versioned snapshot ({scope})
      </a>
    </Button>
  );
}
