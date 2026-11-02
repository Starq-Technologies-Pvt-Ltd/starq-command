# Handover — Cursor: Founder experience and frontend completion

**Assigned by:** Founder directive "Final Convergence" (31 Oct 2026). Issued and tracked by Vision on the `starq-command` Hermes board (cards CV-CU1…CV-CU5, see `04_KANBAN_RECONCILIATION.md`).
**Read first:** `00_MASTER_PLAN.md` (§2, §3 C5–C8 and C10, §4 rules), `06_INTEGRATION_AND_ACCEPTANCE.md` (journeys J1–J10), and AG's `API_CONTRACT_LOCAL_OS.md` once CV-AG0 is reviewed.
**Your role:** turn the existing React app into a polished, *functional* management interface. Every screen must write through the real API and show persisted readback. Don't build screens that only display unavailable data.

## Starting point (verified in a real browser, 31 Oct 2026)

- Stack: React 18 + TypeScript + Vite + Tailwind; typed PM client `src/lib/pm-client.ts`; hash routing `src/lib/building-route.ts` (`routeHash`). About 30 surfaces in `src/surfaces/`.
- **Works:** the project board (`pm-board.tsx`) renders real projects as a five-column Kanban. Task detail with title, priority, owner, verifier, description, move buttons, Save Changes (with CAS). The portfolio (`pm-portfolio.tsx`). Org create forms (`org-operate.tsx`). The scratch-instance badge.
- **Observed defects you own:**
  1. The task-detail panel is clipped at 1400×900 and the page doesn't scroll. The panel sits below the board inside a fixed-height layout.
  2. **Two parallel control sets** on one task: status (`→ To Do / In Progress / Blocked / Done`) and stage (`→ IN_PROGRESS / BACKLOG / BLOCKED / FOUNDER_GATE`). Founders can't tell which one matters.
  3. The default landing page (`seven-need-overview.tsx`) is governance-oriented. There is no "what needs me today" view.
  4. "Acting as" is a free dropdown of 24 handles, remembered in `localStorage` from earlier sessions. It must be explicit and visible, and must default to the Founder's own handle in the UI. It is a **claimed** actor for ordinary actions only and must never be presented as authentication.
  5. "Link Room Authorization" is shown as a prerequisite for starting work. Starting is now ungated (Founder D2), so the button belongs under "Advanced / Room" and is not part of the start flow.

## Work packages

### CV-CU1 — Founder Home (new default landing)
Sections: Needs attention (from `/api/pm/attention`), Today's digest (CV-AG4), Blocked (with owner, reason, age), In progress by person, Recently completed (7 days), Milestones at risk (CV-AG3). Each item deep-links to its task, person or milestone. Governance surfaces stay reachable under "System". **Acceptance:** J6, plus each section shows an explicit empty or UNAVAILABLE state rather than blanks.

### CV-CU2 — Organization management
Build on `org-operate.tsx`: a tree (company → division → department → team), positions with reporting lines, appointments, and edit, move, archive and end-appointment (CV-AG1 routes), with an org history panel. **Acceptance:** J2 through the UI only, with readback after a reload.

### CV-CU3 — Project board and task detail
- Fix the clipping: the detail opens as a right-side drawer or full route with its own scroll container. It works at 1280×720 and 1920×1080.
- **One move control:** show the stage (9 stages) as a single stepper, with the column derived from it. Server refusals (`NOTE_REQUIRED`, `DEPENDENCY_OPEN`, `OWNER_REQUIRED`, `VERIFIER_REQUIRED`, `VERIFIER_ATTESTATION_REQUIRED`, `FOUNDER_CLOSURE_REQUIRED`) appear inline in plain language with the fix ("Assign a verifier first").
- Owner and verifier pickers fed by the workforce registry (HUMAN and DIGITAL with badges), not a free text box.
- Milestone selector and milestone lane or filter (CV-AG3).
- Task timeline (status log, evidence, Room links) with actor and time.
- **Acceptance:** J4, J5, J7. `STALE_EDIT` keeps the user's unsaved edits and offers "reload and reapply".

### CV-CU4 — Workforce and person views
A directory of humans and agents (kind, harness, capabilities, status, appointments) and a person page (open work owned and verifying, blocked, last actions, from `/api/pm/workforce/:id/summary`). Observed runtime presence (Herdr/Hermes) is an optional overlay labelled with its source and time, or UNKNOWN. **Acceptance:** J3, J6.

### CV-CU5 — Persistence and interaction hardening (can start now)
Consistent loading, empty, UNAVAILABLE and error states. Every write shows a saved confirmation only after the server response, and re-reads the record. Navigation: Home · Organization · Workforce · Projects · Activity · Records, plus System. **Acceptance:** rendered tests for each state and real-browser J5 with a forced 409.

## Constraints (binding)

- `src/lib/pm-client.ts`: **don't edit lines 1–40.** Claude's scratch-port fix lives there: the scratch port is captured at app entry in `src/main.tsx` and persisted per tab. Append new typed calls at the end, matching AG's contract.
- No server edits. If an API is missing, raise it on CV-AG0 rather than working around it.
- Test against an isolated instance only. Copy the DB with `VACUUM INTO` (read-only), start PM with `PM_DB_PATH=<copy> PM_PORT=5191 PM_ROOM_POST=off`, and open `http://127.0.0.1:5173/#…?pm_port=5191`. Never against the live PM on :5176.
- Keep UNKNOWN and UNAVAILABLE honest. Never invent presence, progress or authority.
- Branch `cursor/command-convergence` from `2746c90`. Deliver commits, screenshots per journey, test output and limitations on each CV card. Post under **your own identity**, following `D:\StarqTech\AGENTS.md`.
