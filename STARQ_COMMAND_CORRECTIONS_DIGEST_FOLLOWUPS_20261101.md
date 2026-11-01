# STARQ Command — Corrections: digest-latest + follow-ups (CV-C, Room #17354 follow-on)

**Author:** @claude (Elder) — Claude Code
**Date:** 2026-11-01
**Branch:** `claude/command-browser-acceptance-20261101` (isolated; Vision owns merge)
**Scope authorized by:** Founder, in reply to Room #17354.

This reports the **corrected** results only. The original acceptance report
(`STARQ_COMMAND_BROWSER_ACCEPTANCE_CVC_20261101.md`, committed `3daded2`) and its
findings are preserved unchanged, so the before→after evidence stays clear.

## What was broken (from the acceptance report, criterion #5 FAIL)
- Founder Home "Today's digest" / "Completed in the latest digest" and Activity
  "Latest digest" showed **"No such route."** — `GET /api/pm/digests/latest` → **404**.
- Activity "Follow-ups" showed **"UNAVAILABLE. No follow-ups client is available.
  Missing route GET /api/pm/followups."** — the client never called the (existing) backend.

## Corrections (4 files, +89/-7)
1. **`server/pm-ops-routes.mjs`** — added `GET /api/pm/digests/latest`, returning the
   newest digest via `listDigests(db,{limit:1})` or `{digest:null}` (200) when none
   exists. Additive; no existing route touched. (The prior `/digests/<YYYY-MM-DD>`
   regex never matched `latest`, which is why it 404'd.)
2. **`src/lib/pm-client.ts`** — relaxed `pmLatestDigest` return to `{digest: PmDigest | null}`;
   added `PmFollowup` interface and `pmFollowups({status?, includeSnoozed?})` →
   `GET /api/pm/followups`.
3. **`src/surfaces/daily-activity.tsx`** — wired the Follow-ups section to `pmFollowups()`
   with loading/empty/unavailable/ready states and a `FollowupsBody` renderer; removed the
   hard-coded UNAVAILABLE placeholder and the stale "no client and no route yet" comment.
4. **`src/surfaces/founder-home.tsx`** — `DigestData` now allows `digest: null`; the existing
   `!digest` guard already renders a clean "missing" state.

No authority/lifecycle guard, write-client header, CORS pin, or gated-lifecycle behavior
was changed. Follow-up rows are rendered from the service, never invented.

## Verification — real browser (origin 127.0.0.1:5173, pm 5176 disposable DB)
Setup unchanged from the acceptance run (isolated worktree + disposable DB; Herdr/building/
Room/WSL offline; canonical untouched). A digest was generated (`POST /api/pm/digests/generate`)
and one real follow-up was seeded by running the product's own `detectStaleTasks` sweep with a
+5-day clock against the IN_PROGRESS task PM-CMD-001 (threshold 3d) — no invented data.

| Panel | Before | After (this branch) |
|---|---|---|
| `GET /api/pm/digests/latest` | **404** | **200 OK** (same network log shows 404 then 200) |
| Founder Home "Today's digest" | "No such route." | Renders digest 2026-11-01 (generated, delivery, lists) |
| Activity "Latest digest" | "REJECTED NOT_FOUND: No such route." | Renders the digest |
| `GET /api/pm/followups` | (client never called it) | **200 OK** |
| Activity "Follow-ups" | "UNAVAILABLE … Missing route" | `PM-CMD-001 · Operate Starq Technologies in Command · stale_in_progress · open · stale 5d · antigravity · last activity 2026-11-01T04:48:46Z` |

Browser-confirmed on both surfaces (screenshots/network traces captured in-session).

## Regression
- `npm run typecheck` — clean.
- `npm run build` (`tsc -b && vite build`) — clean.
- `tests/founder-home.test.tsx` — 4/4 (incl. "renders UNAVAILABLE when the digest call fails").
- `tests/ops-automation.test.mjs` — 2/2 (digest idempotency + standalone follow-ups).
- `tests/pm-board-ux.test.tsx` — 9/9.
No previously passing workflow regressed.

## Out of scope (left for Vision, per Founder)
- Browser controls for **project / milestone creation** (acceptance finding #3 PARTIAL) — not
  touched here; for Vision to allocate to a UI owner.

## Integration request
Hand-off to **@vision** for merge/canonical consolidation. Changes isolated on
`claude/command-browser-acceptance-20261101`; do not merge to canonical except through Vision.
