import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, MessageSquare, Search, Send, Users, AtSign, ChevronRight } from 'lucide-react';
import { pmPort } from '@/lib/pm-client';

/**
 * Communications — the messenger, over the canonical Room.
 *
 * Read side is a projection of agent-comms/room.jsonl served by the data
 * service (/api/comms/*). Send goes through the PM service, which shells out to
 * the canonical send.mjs, so every message Command posts is hash-chained,
 * identity-stamped and subject to the Founder anti-impersonation rule exactly
 * like any other Room post. Nothing here is a second message store.
 */

interface Message {
  id: string;
  sequence: number | null;
  from: string;
  at: string | null;
  type: string;
  subject: string | null;
  body: string;
  mentions: string[];
  project: string | null;
  task_id: string | null;
  reply_to: string | null;
  action_required: string | null;
  authority: string | null;
  coordination: boolean;
  verified: boolean;
}

interface ChannelSummary { id: string; kind: string; label: string; slug?: string; count: number; members?: string[]; last_at?: string | null }
interface Channels { common: ChannelSummary; projects: ChannelSummary[]; dms: ChannelSummary[] }
interface Person { handle: string; display_name: string; role: string | null; status: string; authority: string; kind: string; messages: number; last_active_at: string | null }

const DATA = '';
const pmBase = () => `http://127.0.0.1:${pmPort()}`;

function timeShort(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function CommsSurface() {
  const [channels, setChannels] = useState<Channels | null>(null);
  const [channel, setChannel] = useState<string>('common');
  const [messages, setMessages] = useState<Message[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const [hideCoordination, setHideCoordination] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const [sender, setSender] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    try {
      const r = await fetch(`${DATA}/api/comms/channels`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`channels ${r.status}`);
      setChannels(await r.json().then((j) => j.channels));
    } catch (e) { setError(e instanceof Error ? e.message : 'channels failed'); }
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      const r = await fetch(`${DATA}/api/comms/people`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`people ${r.status}`);
      const j = await r.json();
      setPeople(j.people ?? []);
      // default the sender to the first active agent (never the Founder — that
      // post would be refused by the anti-impersonation rule anyway).
      setSender((s) => s || (j.people ?? []).find((p: Person) => p.status === 'active' && p.kind === 'agent')?.handle || '');
    } catch { /* directory is optional for composing */ }
  }, []);

  const loadMessages = useCallback(async (ch: string, hideCoord: boolean) => {
    setLoading(true); setError(null); setSearching(false);
    try {
      const url = `${DATA}/api/comms/messages?channel=${encodeURIComponent(ch)}&limit=200${hideCoord ? '&coordination=exclude' : ''}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`messages ${r.status}`);
      const j = await r.json();
      setMessages(j.messages ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'messages failed'); }
    finally { setLoading(false); }
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearching(false); void loadMessages(channel, hideCoordination); return; }
    setLoading(true); setSearching(true); setError(null);
    try {
      const r = await fetch(`${DATA}/api/comms/search?q=${encodeURIComponent(q)}&limit=100`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`search ${r.status}`);
      const j = await r.json();
      setMessages((j.messages ?? []).slice().reverse());
    } catch (e) { setError(e instanceof Error ? e.message : 'search failed'); }
    finally { setLoading(false); }
  }, [channel, hideCoordination, loadMessages]);

  useEffect(() => { void loadChannels(); void loadPeople(); }, [loadChannels, loadPeople]);
  useEffect(() => { if (!searching) void loadMessages(channel, hideCoordination); }, [channel, hideCoordination, searching, loadMessages]);
  useEffect(() => {
    const id = window.setInterval(() => { if (!searching) { void loadChannels(); void loadMessages(channel, hideCoordination); } }, 20000);
    return () => window.clearInterval(id);
  }, [channel, hideCoordination, searching, loadChannels, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !sender) return;
    setSending(true); setSendError(null);
    try {
      const r = await fetch(`${pmBase()}/api/pm/comms/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pm-client': 'starq-command' },
        body: JSON.stringify({ from: sender, body: draft, channel, reply_to: replyTo?.id ?? undefined }),
        signal: AbortSignal.timeout(50000),
      });
      const j = await r.json();
      if (!r.ok || !j.posted) throw new Error(j.message || j.error || `send ${r.status}`);
      setDraft(''); setReplyTo(null);
      await loadMessages(channel, hideCoordination);
      void loadChannels();
    } catch (e2) { setSendError(e2 instanceof Error ? e2.message : 'send failed'); }
    finally { setSending(false); }
  }, [draft, sender, channel, replyTo, hideCoordination, loadMessages, loadChannels]);

  const channelLabel = useMemo(() => {
    if (channel === 'common') return 'Common Room';
    if (channel.startsWith('project:')) return channel.slice('project:'.length);
    if (channel.startsWith('dm:')) return channel.slice('dm:'.length).replace('~', ' ↔ ');
    return channel;
  }, [channel]);

  const activeAgents = people.filter((p) => p.status === 'active' && p.kind !== 'founder');

  return (
    <div className="comms-surface flex h-[calc(100vh-180px)] min-h-[520px] gap-3 px-4 pb-4 text-sm">
      {/* Channel rail */}
      <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto">
        <div className="rounded-md border border-border/60 bg-surface-1/50 p-2">
          <div className="flex items-center gap-2 px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><MessageSquare className="h-3 w-3" /> Channels</div>
          <button onClick={() => setChannel('common')} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${channel === 'common' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-surface-2/60'}`}>
            <Hash className="h-3.5 w-3.5" /> Common Room
            {channels ? <span className="ml-auto font-mono text-[10px] opacity-60">{channels.common.count}</span> : null}
          </button>
        </div>
        <div className="rounded-md border border-border/60 bg-surface-1/50 p-2">
          <div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Projects</div>
          {channels?.projects.map((c) => (
            <button key={c.id} onClick={() => setChannel(c.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${channel === c.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-surface-2/60'}`}>
              <Hash className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.label}</span>
              <span className="ml-auto font-mono text-[10px] opacity-60">{c.count}</span>
            </button>
          )) ?? <div className="px-2 py-1 text-xs text-muted-foreground">…</div>}
        </div>
        {channels?.dms.length ? (
          <div className="rounded-md border border-border/60 bg-surface-1/50 p-2">
            <div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Direct</div>
            {channels.dms.slice(0, 12).map((c) => (
              <button key={c.id} onClick={() => setChannel(c.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${channel === c.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-surface-2/60'}`}>
                <AtSign className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.members?.join(' ↔ ')}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col rounded-md border border-border/60 bg-surface-1/30">
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">{channelLabel}</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={hideCoordination} onChange={(e) => setHideCoordination(e.target.checked)} />
            fold ACK/readiness
          </label>
          <button onClick={() => setShowPeople((v) => !v)} className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-surface-2/60"><Users className="h-3.5 w-3.5" /> People</button>
        </header>

        <form onSubmit={(e) => { e.preventDefault(); void runSearch(searchQuery); }} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search messages…" className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60" />
          {searching ? <button type="button" onClick={() => { setSearchQuery(''); setSearching(false); void loadMessages(channel, hideCoordination); }} className="text-xs text-muted-foreground hover:text-foreground">clear</button> : null}
        </form>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading && !messages.length ? <div className="p-4 text-center text-xs text-muted-foreground">Loading…</div> : null}
          {error ? <div className="m-2 rounded border border-truth-drift/40 bg-truth-drift-soft/50 p-2 text-xs text-truth-drift">{error}</div> : null}
          {!loading && !messages.length && !error ? <div className="p-4 text-center text-xs text-muted-foreground">No messages.</div> : null}
          {messages.map((m) => (
            <div key={m.id} className={`group border-b border-border/30 py-2 ${m.coordination ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-foreground">@{m.from}</span>
                {m.authority === 'ROOT_GENESIS' ? <span className="rounded bg-amber-500/20 px-1 text-[9px] font-mono uppercase text-amber-500">founder</span> : null}
                {m.project ? <span className="rounded bg-primary/10 px-1 text-[9px] font-mono text-primary/80">{m.project}</span> : null}
                {m.task_id ? <span className="rounded bg-surface-2 px-1 text-[9px] font-mono text-muted-foreground">{m.task_id}</span> : null}
                {m.coordination ? <span className="text-[9px] font-mono uppercase text-muted-foreground/60">coordination</span> : null}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{timeShort(m.at)}{m.sequence ? ` · #${m.sequence}` : ''}</span>
                <button onClick={() => setReplyTo(m)} className="opacity-0 transition group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-foreground">reply</button>
              </div>
              {m.subject && m.subject !== m.body.split('\n')[0].slice(0, 80) ? <div className="text-xs font-medium text-foreground/90">{m.subject}</div> : null}
              <div className="whitespace-pre-wrap break-words text-foreground/85">{m.body.slice(0, 2000)}</div>
              {m.action_required ? <div className="mt-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">ACTION: {m.action_required}</div> : null}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <form onSubmit={send} className="border-t border-border/60 p-2">
          {replyTo ? (
            <div className="mb-1 flex items-center gap-2 rounded bg-surface-2/60 px-2 py-1 text-[11px] text-muted-foreground">
              <ChevronRight className="h-3 w-3" /> replying to @{replyTo.from}: {(replyTo.subject || replyTo.body).slice(0, 60)}
              <button type="button" onClick={() => setReplyTo(null)} className="ml-auto hover:text-foreground">×</button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <select value={sender} onChange={(e) => setSender(e.target.value)} className="shrink-0 rounded border border-border/60 bg-surface-1 px-2 py-1.5 text-xs" title="Send as">
              {activeAgents.map((p) => <option key={p.handle} value={p.handle}>@{p.handle}</option>)}
            </select>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(e); }}
              rows={1}
              placeholder={`Message ${channelLabel}…  (⌘/Ctrl+Enter to send)`}
              className="min-h-[38px] flex-1 resize-y rounded border border-border/60 bg-surface-1 px-2 py-1.5 text-sm outline-none focus:border-primary/50"
            />
            <button type="submit" disabled={sending || !draft.trim() || !sender} className="flex shrink-0 items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40">
              <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          {sendError ? <div className="mt-1 text-[11px] text-truth-drift">{sendError}</div> : null}
          <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">Posts to the canonical Room, hash-chained as @{sender}. The Founder handle cannot be posted from here.</div>
        </form>
      </section>

      {/* People directory */}
      {showPeople ? (
        <aside className="flex w-60 shrink-0 flex-col overflow-y-auto rounded-md border border-border/60 bg-surface-1/50 p-2">
          <div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">People ({people.length})</div>
          {people.map((p) => (
            <div key={p.handle} className="border-b border-border/30 px-1 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground">@{p.handle}</span>
                {p.kind === 'founder' ? <span className="rounded bg-amber-500/20 px-1 text-[9px] font-mono uppercase text-amber-500">founder</span> : null}
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{p.messages}</span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{p.display_name}{p.status !== 'active' ? ` · ${p.status}` : ''}</div>
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
