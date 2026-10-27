import { FormEvent, useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, FileText, Search } from 'lucide-react';

interface LibraryDocumentRow {
  path: string;
  domain: string;
  title: string;
  bytes: number;
  modified_at: string;
  snippet: string;
}

interface LibrarySearchResult {
  state: string;
  authority: string;
  read_only: boolean;
  total: number;
  domains: string[];
  documents: LibraryDocumentRow[];
  error?: string;
}

interface LibraryDocument extends LibraryDocumentRow {
  sha256: string;
  content: string;
}

const SEARCH_URL = '/api/building/library/search';
const DOCUMENT_URL = '/api/building/library/document';

export function LibrarySurface() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<LibrarySearchResult | null>(null);
  const [document, setDocument] = useState<LibraryDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (q: string, selectedDomain: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, limit: '60' });
      if (selectedDomain) params.set('domain', selectedDomain);
      const response = await fetch(`${SEARCH_URL}?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as LibrarySearchResult;
      if (!response.ok) throw new Error(payload.error || `Library returned ${response.status}`);
      setResult(payload);
      setActiveQuery(q);
      setDocument(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void search('', ''); }, [search]);

  const openDocument = async (relativePath: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ path: relativePath });
      const response = await fetch(`${DOCUMENT_URL}?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as LibraryDocument & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Document returned ${response.status}`);
      setDocument(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(query, domain);
  };

  return (
    <div className="room-root" data-room="library">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <BookOpen className="h-4 w-4" />
          </span>
          <div>
            <p className="label-micro">Recovered from StarqNexus · read only</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight">Library</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Search and open the copied canonical records, specifications, contracts, and archives.
            </p>
          </div>
        </div>
        <span className="chip" data-tone={result?.state === 'AVAILABLE' ? 'ok' : 'unknown'}>
          {result?.total?.toLocaleString() ?? '…'} records
        </span>
      </header>

      <div className="grid min-h-[calc(100vh-10rem)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border p-3 lg:border-b-0 lg:border-r">
          <p className="label-micro px-2 py-2">Domains</p>
          <button
            type="button"
            onClick={() => { setDomain(''); void search(query, ''); }}
            aria-current={!domain ? 'page' : undefined}
            className="mb-1 w-full rounded-md px-2 py-2 text-left text-xs text-foreground hover:bg-foreground/[0.05]"
          >
            All records
          </button>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
            {(result?.domains ?? []).map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => { setDomain(item); void search(query, item); }}
                aria-current={domain === item ? 'page' : undefined}
                className={`truncate rounded-md px-2 py-2 text-left text-xs hover:bg-foreground/[0.05] ${domain === item ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground'}`}
              >
                {item.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 p-3 md:p-5">
          <form onSubmit={submit} className="mb-4 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="nexus-library-query">Search Library</label>
            <div className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-border bg-surface-1 px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                id="nexus-library-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents and records…"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button type="submit" className="rounded-md border border-primary/30 bg-primary/10 px-4 text-xs font-semibold text-primary hover:bg-primary/15">
              Search
            </button>
          </form>

          {error ? <div role="alert" className="mb-3 rounded-md border border-truth-drift/40 bg-truth-drift-soft/50 p-3 text-xs text-truth-drift">{error}</div> : null}
          {loading ? <p className="mb-3 text-xs text-muted-foreground">Loading recovered records…</p> : null}

          {document ? (
            <article className="rounded-lg border border-border bg-surface-1/60">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <button type="button" onClick={() => setDocument(null)} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="h-3.5 w-3.5" /> Back to results
                  </button>
                  <h2 className="text-base font-semibold">{document.title}</h2>
                  <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">{document.path}</p>
                </div>
                <span className="chip" data-tone="ok">SHA-256 {document.sha256.slice(0, 12)}</span>
              </div>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground/90">{document.content}</pre>
            </article>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                <span>{activeQuery ? `Results for “${activeQuery}”` : domain || 'All Library records'}</span>
                <span>{result?.total?.toLocaleString() ?? '0'} matches · showing up to 60</span>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border bg-surface-1/40">
                {(result?.documents ?? []).map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => void openDocument(item.path)}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-foreground/[0.035] md:px-4"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
                      <span className="mt-1 block truncate font-mono text-2xs text-muted-foreground">{item.path}</span>
                      {item.snippet ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{item.snippet}</span> : null}
                    </span>
                    <span className="hidden shrink-0 text-2xs text-muted-foreground sm:block">{item.domain}</span>
                  </button>
                ))}
                {!loading && result?.documents.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No records match this search.</p>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

