# Repository presentation proposal

Proposed GitHub repository metadata and documentation navigation for Founder
review. These are **proposals only** — this documentation work changes no
repository settings, visibility, topics, or About text. Apply them from the
repository **Settings** / the About panel if approved.

## GitHub "About" text

Short description (the About field, ~120 characters):

> AI-native Organizational Operating System for human and AI workforces — governed operating records with honest, read-only projections.

Alternative, shorter:

> An operating system for companies that run on human and AI workforces.

**Website field:** leave blank until a canonical product URL exists. Do not point
it at a local or internal host.

## Repository topics

Proposed topics (lowercase, hyphenated, as GitHub expects):

```
operating-system  organizational-os  ai-workforce  agentic-workflows
workforce-management  project-management  react  typescript  vite  nodejs
governance  internal-tooling
```

Rationale: the first row describes the product category and differentiator (an
OS for mixed human/AI workforces with governance); the second row is the honest
technical stack; `internal-tooling` signals this is not a general-purpose
open-source release.

## About-panel checkboxes

- **Releases:** leave disabled / empty. No release tags exist and none are
  authorized.
- **Packages / Environments / Deployments:** leave off. Nothing is published.
- **Include in the home page "Used by":** not applicable (no published package).

## Documentation navigation

Proposed top-level navigation, anchored by [`docs/README.md`](README.md):

1. **README** — product overview, principles, architecture at a glance, quick
   start, operating status.
2. **docs/ARCHITECTURE.md** — services, the two data regimes, honesty states,
   front end, lifecycle, testing.
3. **docs/QUICKSTART.md** — disposable vs. live operation, verification commands.
4. **docs/DOCUMENTATION_AUDIT_2026-11-02.md** — public-facing disclosure and
   accuracy review.
5. **CONTRIBUTING.md · SECURITY.md · NOTICE.md** — process, security reporting,
   IP notice (all drafts pending Founder approval).
6. **Historical records** — the dated root-level `*.md` files and
   `docs/convergence/` are preserved engineering history, linked from the docs
   index under a clearly labelled "Historical" heading, not mixed into the
   current-state guides.

## Notes and non-goals

- **Visibility:** no change proposed. The repository's public state was set for a
  specific inspection purpose, not as a launch; that decision stays with the
  Founder.
- **License:** none proposed here. `NOTICE.md` records that license and ownership
  language is pending Founder approval. A public repository with no license file
  grants no rights by default, which is consistent with the draft notice.
- **Social preview image:** if one is wanted, prefer a purpose-built image over
  the operational dashboard screenshot — see the documentation audit for the
  reason.
