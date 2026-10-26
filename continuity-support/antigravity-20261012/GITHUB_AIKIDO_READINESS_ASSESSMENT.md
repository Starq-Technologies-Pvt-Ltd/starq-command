# STARQ COMMAND — GITHUB / AIKIDO READINESS ASSESSMENT REPORT

**Document Type:** Evidence-Backed Preparation & Security Readiness Report  
**Authority:** Founder Room Directive #9371, Section 3  
**Author / Seat:** `@antigravity` (Core Agent)  
**Target Consumer:** Founder (`@mustarq`), Engineering Leads (`@elder`, `@codex`)  
**Status:** READ-ONLY AUDIT & PREPARATION ONLY.  
**Execution Boundaries Strictly Observed:** Zero remote creation; zero git push; zero repository mutation; zero Aikido API connection; zero source code changes; zero test execution altering state; zero runtime service starts; zero access or enumeration of `D:\!starq`. Room #9208 ALL-STOP remains strictly in effect.  
**Freshness Checkpoint:** Room HEAD at read: brokerSequence 9371 (`32003615147814b73b223ff972eb6f5053caefea96452f4007b1d6438675e369`).

---

## 1. EXECUTIVE SUMMARY & MANDATE

In Founder Room Directive #9371 (Section 3), the Founder authorized:
> *"@antigravity is authorized to conduct a read-only GitHub/Aikido readiness assessment of Starq Command.*  
> *Identify repository boundaries, secret exposure risks, dependency and licensing issues, required exclusions, reproducible setup requirements, CI readiness and any blockers to a safe private GitHub push.*  
> *Produce an evidence-backed preparation report and recommended next actions.*  
> *No remote creation, push, publication, repository mutation or Aikido connection is authorized in this assignment."*

This report delivers a comprehensive, evidence-based audit across all seven required dimensions. It identifies structural blockers, software supply chain risks, credential leak vectors, and CI prerequisites that must be resolved prior to an initial private GitHub push and subsequent Aikido Security scan.

---

## 2. REPOSITORY BOUNDARIES & STRUCTURAL TOPOLOGY

### 2.1 Absence of Git Version Control in the Canonical Workspace
- **Finding:** Neither the Starq workspace root (`D:\StarqTech`) nor the Starq Command application directory (`D:\StarqTech\00_STARQ_HQ\operations\starq-command`) is an active git repository.
- **Evidence:** `git rev-parse --show-toplevel` returns `fatal: not a git repository`. No `.git` directory exists anywhere within `D:\StarqTech` or its subdirectories.
- **Implication:** Before any GitHub push can occur, a deliberate git initialization and boundary determination must be made.

### 2.2 Deep Architectural Coupling to Workspace Ancestry
Starq Command is currently designed as an integrated subsystem of the Starq company tree rather than an isolated, standalone application:
- **Path Resolution:** As implemented in `server/paths.mjs` (lines 35–55), the data service locates its canonical sources by walking up directory ancestry from `APP_ROOT` (up to 12 levels) looking for the workspace fingerprint (`STARQ.md` and `00_STARQ_HQ`), or reading the `STARQ_WORKSPACE` environment variable.
- **External Canonical Sources Consumed:**
  - `STARQ.md` (at workspace root `D:\StarqTech\STARQ.md`)
  - `company-seats.json` (at workspace root `D:\StarqTech\company-seats.json`)
  - `00_STARQ_HQ/decisions.json`
  - `00_STARQ_HQ/operations/starqerp-control-board/*` (contract, activity, work model)
  - `00_STARQ_HQ/operations/herdr-floor/manifest.json`
  - `agent-comms/room.jsonl` (the canonical communications ledger)
  - `agent-comms/protocol/v1/*` (identities, staff-state, health, ledger-epoch)
  - `agent-comms/cursors/identity-leases/*`
- **Standalone Clone Hazard:** If `starq-command` is cloned in isolation (e.g., onto a clean developer machine or GitHub Actions CI runner without the rest of `D:\StarqTech`), `resolveWorkspace()` returns `{ root: null, source: 'UNRESOLVED' }`. The data service will fail to mount canonical sources and report `UNAVAILABLE` across all surfaces.

### 2.3 Strategic Repository Topology Options for Founder Decision
1. **Option 1: Standalone Repository (`starq-command`) [RECOMMENDED FOR AIKIDO]**
   - *Architecture:* Create an isolated repository containing only `00_STARQ_HQ/operations/starq-command/`.
   - *Requirement:* Provide a dedicated offline fixture/mock mode or bundle minimal static contract snapshots for external canonical sources so that Command can run, test, and build in standalone CI.
   - *Benefit:* Small attack surface, fast CI, clean Aikido scan scope, zero exposure of private company communications or corporate library.
2. **Option 2: Workspace Monorepo (`starq-tech`)**
   - *Architecture:* Git-initialize the entire `D:\StarqTech` tree.
   - *Hazard:* Massive repository size (contains 21 MB `room.jsonl`, visual PNG corpora), extreme secret exposure risk (`agent-comms/secrets/starq-bot.env`), and exposure of internal corporate governance documents.

---

## 3. SECRET EXPOSURE RISKS & CREDENTIAL AUDIT

### 3.1 Application Source Code Audit (`src/`, `server/`, `scripts/`)
- **Scan Method:** Exhaustive regex and pattern scan for API tokens (`ghp_`, `gho_`, `github_pat_`), JWTs (`eyJh...`), private keys (`BEGIN RSA/OPENSSH PRIVATE KEY`), bearer tokens, and cloud credentials.
- **Result:** **CLEAN.** Zero hardcoded secrets, private keys, or API tokens were found in application code.

### 3.2 Defensive Architectural Safeguards
- **`server/path-guard.mjs`:** Contains a strict containment and allowlist guard. Line 9 explicitly documents defense against path traversal attacks targeting `_secrets/*`.
- Absolute, UNC, and `..` path segments are rejected; paths must resolve strictly within the declared allowlist.

### 3.3 Critical Workspace-Level Leak Vectors (Must NOT Be Pushed)
- **`agent-comms/secrets/starq-bot.env`:** Contains live Telegram Bot API tokens for Starq Bot gateway (`FOUNDER_TELEGRAM_USER_ID = 790631400`). If a monorepo push is ever attempted, this file would be leaked immediately.
- **`.command-runtime/`:** Contains operational state files (`state.json`, `lifecycle-journal.jsonl`, `lifecycle.lock.stale-*`) and process logs. These contain local environment telemetry and must remain local.

---

## 4. DEPENDENCY & LICENSING ANALYSIS (SCA & LEGAL)

### 4.1 License Compliance: 100% Permissive Open Source
All direct dependencies and development dependencies were verified in `package.json` and `package-lock.json`:
- **Production Dependencies (8):**
  - `@radix-ui/react-slot` (MIT)
  - `@xterm/xterm` (MIT)
  - `class-variance-authority` (Apache-2.0)
  - `clsx` (MIT)
  - `lucide-react` (ISC)
  - `react` (MIT)
  - `react-dom` (MIT)
  - `tailwind-merge` (MIT)
- **Development Dependencies (12):**
  - `@types/node`, `@types/react`, `@types/react-dom` (MIT)
  - `@vitejs/plugin-react` (MIT)
  - `autoprefixer`, `postcss`, `tailwindcss` (MIT)
  - `concurrently` (MIT)
  - `jsdom` (MIT)
  - `typescript` (Apache-2.0)
  - `vite`, `vitest` (MIT)
- **Legal Assessment:** ZERO GPL, AGPL, or restrictive copyleft licenses. All packages are commercially usable and compliant with corporate IP standards.

### 4.2 Software Composition Analysis (SCA) & Vulnerability Audit
A read-only `npm audit --json` scan identified **16 vulnerabilities** across 354 total packages:
- **Production Dependencies:** **0 vulnerabilities.** (Production bundle is completely clean).
- **Development Tooling:** **16 vulnerabilities (4 Critical, 7 High, 5 Moderate).**
- **Specific Vulnerability Breakdown:**
  1. **`vitest` / `tinypool` (Critical):**
     - Prototype pollution in `tinypool` worker options leading to RCE (GHSA-5gmw-xhrv-c9v3 / GHSA-85c8-ppgw-ccpr).
     - Arbitrary file read / execution via Vitest UI server and mocker redirect (GHSA-5xrq-8626-4rwp, CVSS 9.8).
  2. **`shell-quote` (Critical):**
     - Command injection via line terminators in `quote()` (GHSA-pqg4-j6r4-53mv, CVSS 8.1; pulled in via `concurrently`).
  3. **`vite` (High):**
     - Path traversal in optimized dependency map handling (GHSA-4w7w-66w2-5vf9).
     - `server.fs.deny` bypass on Windows alternate paths (GHSA-fx2h-pf6j-xcff, CVSS 7.5).
     - NTLMv2 hash disclosure via UNC path handling on Windows (GHSA-v6wh-96g9-6wx3).
  4. **`source-map-js` (High):**
     - Event-loop denial of service via indexed source-map section offsets (GHSA-68fv-2mgg-jv7q).
  5. **`tailwindcss` (High):**
     - Vulnerabilities in transitive parsers (`postcss-selector-parser`).
- **Aikido Impact:**
  - When Aikido is connected to this repository on GitHub, its SCA engine will **immediately trigger alerts** for these 16 devDependency vulnerabilities.
  - *Recommendation:* Prior to connecting Aikido, run an authorized devDependency upgrade wave (`vitest` $\ge$ 3.2.6, `vite` $\ge$ 6.4.3, `concurrently` / `shell-quote` update) or configure Aikido rules to classify devDependency vulnerabilities as non-production build-time risks.

---

## 5. REQUIRED EXCLUSIONS & .GITIGNORE AUDIT

### 5.1 Existing `.gitignore` Evaluation
The current `.gitignore` in `00_STARQ_HQ/operations/starq-command/.gitignore` covers:
- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- `.env*`
- `.command-runtime/`
- `data/*.db*`
- `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/*` (except `extensions.json`)

### 5.2 Critical Unignored Artifacts Currently on Disk
The following files and directories currently reside in `starq-command` and would be **erroneously committed** if a naive `git add .` were executed:
1. **Unignored Build Distributions:**
   - `dist-observation/` (compiled build directory)
   - `dist-observation-hardening-20261009/` (compiled build directory)
   - *Fix:* Add `dist*/` to `.gitignore`.
2. **Committed Build Artifact on Disk:**
   - `tsconfig.tsbuildinfo` (1,600 bytes, generated 10/10/2026). Although `*.tsbuildinfo` is in `.gitignore`, this file is already sitting on disk.
3. **Heavy Design & Binary Assets:**
   - `Starq Command interface redesign.zip` (3.48 MB)
   - `STARQ Command Centre Dashboard.png` (2.0 MB)
   - `STARQ_COMMAND_END_STATE_ARCHITECTURE_MAP_2026-10-10.docx` (43.4 KB)
   - `._arch_map_extract.txt` (15.1 KB, AppleDouble metadata)
   - *Fix:* Exclude large binary ZIPs and office docs from the code repository, or store them in a dedicated asset release/LFS.
4. **Internal Caches & Observation Logs:**
   - `cache/`
   - `observation/`
5. **Heavy Evidence Capture Directories:**
   - `evidence/vision-visual-2026-10-12-recovery/` (contains 328 PNG screenshots, tens of megabytes). Evidence corpora should be archived externally or tracked via checksum manifests rather than bloating git history.

---

## 6. REPRODUCIBLE SETUP REQUIREMENTS

### 6.1 Prerequisites & Tooling
- **Node.js Engine:** `>=20` (enforced in `package.json` engines; tested on Node v24.15.0).
- **Package Manager:** npm (canonical `package-lock.json` lockfileVersion 3 is present and coherent).
- **Operating System:** Cross-platform design (tested on Windows 11 and WSL; path normalization handled via `path-guard.mjs`).

### 6.2 Standard Build Lifecycle Scripts
Verified from `package.json`:
- Clean Dependency Install: `npm ci`
- Typecheck: `npm run typecheck` (`tsc --noEmit`) — **VERIFIED PASSING (0 errors)**.
- Production Build: `npm run build` (`tsc -b && vite build`).
- Unit/Component Tests: `npm test` (`vitest run`).
- Standalone Server Launch: `npm run dev` (starts `data-service.mjs` on 5177 + Vite UI on 5173).

---

## 7. CI READINESS & TEST SUITE BEHAVIOUR

### 7.1 Absence of CI Workflows
- **Finding:** No `.github/workflows/` directory or CI pipeline configuration exists.

### 7.2 The Known-Red Test Gate Challenge (B5 / F3–F8)
- **Suite Composition:** 31 test files, 821 collected tests.
- **Baseline Behavior:** 815 tests pass; **6 tests fail (F3–F8)**.
- **The Core Issue for CI:**
  - In a standard GitHub Actions workflow running `npm test`, Vitest exits with code `1` due to the 6 known-red failures.
  - F3–F8 failures are **deliberate environmental integrity guards** (reflecting absent external Hoadha and Nexus roots). They must NOT be silenced or turned green with fake fixtures.
- **CI Solution:**
  - Create a dedicated CI test harness or runner script (`npm run test:ci`) that executes Vitest and explicitly validates that:
    1. Exactly 815 tests pass.
    2. Exactly the 6 named known-red tests fail (F3–F8).
    3. Zero unexpected regressions or unclassified failures occur.
  - This preserves the Starq known-red discipline without breaking automated CI pipelines.

---

## 8. BLOCKER MATRIX & ACTIONABLE NEXT STEPS

### 8.1 Summary Blocker Matrix

| Severity | Issue | Impact | Resolution Required Before Push |
|---|---|---|---|
| **CRITICAL** | Git repository not initialized | No git tracking or commit history exists | Formally initialize git repository with defined boundary. |
| **CRITICAL** | Workspace coupling in `paths.mjs` | Standalone clone cannot find canonical files | Provide fallback offline fixture mode or `STARQ_WORKSPACE` mock harness. |
| **HIGH** | Unignored build distributions & large binaries | Will pollute git history with 5.5MB+ binaries and stale builds | Update `.gitignore` to exclude `dist*/`, `*.zip`, `.docx`, and clean disk. |
| **HIGH** | 16 devDependency vulnerabilities | Aikido SCA scan will alert immediately on first scan | Authorize targeted devDependency bump (`vitest`, `vite`, `shell-quote`). |
| **MEDIUM** | Missing GitHub Actions CI workflow | No automated verification on PRs/pushes | Authorize creation of `.github/workflows/ci.yml` with known-red harness. |

### 8.2 Recommended Staged Action Plan for the Founder

1. **Stage 1: Exclusion & Hygiene Pass (Authorized Documentation/Config Only)**
   - Update `.gitignore` in `starq-command` to ignore `dist*/`, `cache/`, `*.zip`, `*.docx`, and AppleDouble artifacts.
   - Remove orphan build output (`tsconfig.tsbuildinfo`) from the workspace.
2. **Stage 2: Standalone Fallback & CI Harness**
   - Add a fallback mechanism in `server/paths.mjs` that loads bundled mock fixtures when `STARQ_WORKSPACE` is unresolved, enabling standalone execution.
   - Implement `test:ci` script that recognizes the B5 known-red baseline (815 pass, 6 known-red).
   - Write `.github/workflows/ci.yml`.
3. **Stage 3: DevDependency Remediation Wave**
   - Authorize an isolated devDependency update to resolve the 16 CVEs flagged by `npm audit` prior to connecting Aikido.
4. **Stage 4: Git Initialization & Private Remote Configuration**
   - Initialize git, commit the verified clean baseline, and link to a private GitHub repository.
   - Connect Aikido Security scanner to the private repository for initial baseline assessment.

---

## 9. CONCLUSION

Starq Command is architecturally clean, uses 100% permissive open-source licensing, has zero hardcoded secrets in its application code, and passes TypeScript typechecking cleanly.

The primary obstacles to an immediate GitHub push are structural: git must be initialized, repository boundaries must be isolated from the parent workspace, unignored build/binary artifacts must be excluded, and devDependency vulnerabilities must be addressed to ensure a clean first scan in Aikido.

*Status: Readiness assessment complete. Report filed to continuity support. Awaiting Founder review. STOP.*
