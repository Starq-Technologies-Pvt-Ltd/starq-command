# Public-facing documentation audit — 2026-11-02

Scope: a review of public-facing documentation and assets after the repository
became publicly visible, covering sensitive disclosures, outdated development
material, misleading product claims, and broken documentation links. This audit
**reports** findings; it changes no source code and deletes no historical
records. Recommendations are for Founder decision.

## Summary

- **No credentials, tokens, private keys, or production secrets** were found in
  tracked files. The only secret-shaped strings are read-only guards, idempotency
  tokens, and `.env.example` reference keys that are explicitly commented as
  reference-only with instructions never to store credentials.
- The largest disclosure concern is the **operational dashboard screenshot**,
  which shows one operator's real AI-provider stack and subscription-usage ratios.
- The previous `README.md` was **substantially outdated and founder-surface
  specific**, described the product as a read-only "Phases 1–5" projection, and
  contained **broken relative links** pointing outside the repository.
- Numerous **dated engineering records** in the repository root are historical
  and should be preserved as evidence, but are easy to mistake for current
  product documentation.

## Findings

### 1. Operational screenshot discloses real operating data — recommend Founder decision

`STARQ Command Centre Dashboard.png` (~2 MB) is a real capture of the Overview
surface. It discloses, for one operator's configuration:

- the digital-staff roster and each worker's provider/access and model mapping
  (e.g. which agents run on which of OpenAI / Anthropic / Google / xAI /
  Microsoft),
- **subscription-usage ratios** (per-provider percentages),
- host OS details and the Founder's identity as Administrator.

None of this is a credential, but together it is internal operating detail.

**Recommendation:** the Founder decides whether to (a) keep it as-is, (b) replace
it with a purpose-built screenshot using synthetic/demo data, or (c) remove it.
The rewritten README keeps the image as an interface example with a caption
pointing here, pending that decision. This audit does not remove it unilaterally.

### 2. Founder email present in one historical record

`TAKEOVER_RECONCILIATION_2026-10-27.md` records a git author identity with an
email address. This is a historical engineering record and is already present in
the Git commit history, so editing the single document does not un-disclose it.

**Recommendation:** no change to the historical record (preservation). If the
Founder wants the address out of forward-facing material, the control is at the
Git-identity / commit level, not in documentation edits.

### 3. Previous README was outdated and misleading as current product doc

The prior `README.md`:

- Described Command as "the permanent Founder operating surface for Starq Dev
  Studio" and a pure "DERIVED_PROJECTION … not an SSOT," which no longer matches
  the product — Command now owns **writable** operating records (PM, org, tasks,
  comms) alongside its read-only projections (see
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) and the `package.json` description).
- Led with a "Phases 1–5" narrative and historical phase authorizations as the
  product's headline identity.
- Carried **historical, pre-cutover startup instructions** that `cd` into
  `D:\!starq` (explicitly marked read-only history) and a documentation-status
  banner dated 03 Oct 2026.

**Action taken:** `README.md` rewritten to present Command as an AI-native
Organizational Operating System for human and AI workforces, grounded in the
current code, with an honest operating-status section. The phase history remains
available in the preserved `PHASE7_*.md` and convergence records.

### 4. Broken documentation links in the previous README

Three relative links pointed outside the repository and were broken on GitHub:

- `](../../corporate-library/STARQ_CANONICAL_CORPORATE_LIBRARY_2026-10-03/05_COMMAND_OS_CANONICAL_DEFINITION.md)`
- `](../../DOCUMENTATION_INDEX.md)`
- `](../starq-lifecycle/STARQ_LIFECYCLE.md)`

**Action taken:** removed from the rewritten README. The current README links
only to files that exist inside the repository.

### 5. `index.html` meta description is stale (source change — flagged, not changed)

`index.html` still describes the app as "the Founder operating surface for Starq
Dev Studio. A derived projection of canonical Starq truth." This is public-facing
copy but lives in a shipped source file.

**Recommendation:** update the `<meta name="description">` (and consider the
`<title>`) to match the current product framing. Not changed here, to respect the
"no functional source changes" boundary; propose it as a follow-up alongside any
other UI copy refresh.

### 6. Dated engineering records are easy to mistake for current docs

The repository root holds many dated records (WAVE_*, PHASE7_*, DESIGN_INTEGRATION_*,
COMMAND_*_AUDIT_*, handovers, etc.) plus `docs/convergence/`. These are valuable
historical evidence and must be preserved.

**Recommendation:** keep them in place (done), and route readers through the new
[`docs/README.md`](README.md) index, which separates **current** guides from a
clearly labelled **historical** section. A later, separately authorized cleanup
could move historical records under a `docs/history/` tree; this audit does not
move files.

### 7. Draft governance documents correctly disclaim themselves

`NOTICE.md`, `SECURITY.md`, and `CONTRIBUTING.md` are drafts and say so, claim no
completed audit, and record that license/ownership language is pending Founder
approval. `SECURITY.md` also honestly records the accepted-but-unresolved dev
dependency advisories.

**Recommendation:** no change; these are appropriately honest. Finalize when the
Founder approves license and security-contact language.

## What was deliberately not done

- No source/behavior changes, no data access, no deployments, no release tags, no
  repository visibility change, no merge.
- No historical record deleted, moved, or redacted.
- No founder-private operational data removed from the screenshot (flagged for
  Founder decision instead).

## Verification performed

- Repository-wide scan for emails, and for secret-shaped keywords (`secret`,
  `password`, `api[-_]key`, `token`, `bearer`, `private[-_]key`, PEM/AWS key
  patterns) across tracked docs, config, and server files — no credentials found.
- Confirmed the three README links resolve outside the repository.
- Read the dashboard screenshot to assess disclosure.
- Cross-checked the rewritten README and new guides against `package.json`,
  `vite.config.ts`, the `server/` route surface, `src/components/shell.tsx`
  navigation, and the lifecycle configs.
