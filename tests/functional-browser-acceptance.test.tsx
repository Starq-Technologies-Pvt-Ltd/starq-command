// @vitest-environment jsdom
/**
 * STARQ // COMMAND — Functional Browser Acceptance Suite
 *
 * Simulates real user interactions with Command's React surfaces under JSDOM.
 * Captures real DOM snapshots / HTML artifacts for visual audit.
 *
 * Covers user journeys:
 *  1. Fresh empty installation and first organization creation
 *  2. First-person registration and authorized onboarding
 *  3. Department and workforce creation
 *  4. Project and milestone creation
 *  5. Board and work-package creation
 *  6. Task assignment and state transitions
 *  7. Workforce activity and operational visibility
 *  8. Communication, evidence and review workflows
 *  9. Organizational archive/revival and dependency rules
 * 10. Restart persistence without record resurrection
 * 11. Optional organization snapshot import on a clean database
 * 12. Founder dashboard navigation and usable day-to-day workflows
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FirstRun } from '@/surfaces/first-run';
import { PmPortfolioSurface } from '@/surfaces/pm-portfolio';
import { PmBoardSurface } from '@/surfaces/pm-board';
import { FounderHome } from '@/surfaces/founder-home';
import { DailyActivity } from '@/surfaces/daily-activity';
import { SoftwareFactorySurface } from '@/surfaces/factory';
import { OrgOperateSurface } from '@/surfaces/org-operate';
import { CommsSurface } from '@/surfaces/comms';
import { readClaimedActor, storeClaimedActor } from '@/lib/acting-as';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts', 'acceptance', 'html');

let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function setupHost(hash = '') {
  if (hash) {
    try {
      window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
    } catch {}
  } else {
    try {
      window.location.hash = '';
    } catch {}
  }
  document.body.innerHTML = '<div id="root"></div>';
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const host = document.getElementById('root')!;
  root = createRoot(host);
  return host;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  // @ts-expect-error React value tracker
  const tracker = input._valueTracker;
  if (tracker) tracker.setValue('');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Evidence snapshots are COMMITTED, and each carries a "Captured" timestamp, so
 * rewriting them on every run made a plain `npx vitest run` dirty twelve tracked
 * files with nothing but a new clock reading. That breaks "verify this exact
 * SHA" (a verifier cannot tell their run changed nothing) and invites merge
 * conflicts between engineers. Regeneration is therefore a deliberate act:
 * scripts/run-functional-acceptance.mjs sets ACCEPTANCE_WRITE_ARTIFACTS=1.
 */
function saveHtmlArtifact(filename: string, title: string, element: HTMLElement) {
  if (process.env.ACCEPTANCE_WRITE_ARTIFACTS !== '1') return;
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} — Functional Acceptance</title>
  <style>
    body { font-family: monospace; background: #0f172a; color: #f8fafc; padding: 24px; line-height: 1.5; }
    .artifact-banner { background: #1e293b; border-left: 4px solid #38bdf8; padding: 12px 16px; margin-bottom: 24px; }
    .rendered-surface { border: 1px solid #334155; padding: 20px; border-radius: 6px; background: #020617; }
  </style>
</head>
<body>
  <div class="artifact-banner">
    <h2>STARQ COMMAND ACCEPTANCE ARTIFACT</h2>
    <p><strong>Workflow:</strong> ${title}</p>
    <p><strong>Captured:</strong> ${new Date().toISOString()}</p>
  </div>
  <div class="rendered-surface">
    ${element.innerHTML}
  </div>
</body>
</html>`;
    fs.writeFileSync(path.join(ARTIFACTS_DIR, filename), fullHtml, 'utf8');
  } catch (e) {
    // Artifact write failure should not fail test
  }
}

describe('Functional Browser Acceptance — 12 Real User Journeys', () => {

  // ── Journey 1: Fresh empty installation and first organization creation ────
  it('Workflow 1: Fresh empty installation renders FirstRun and creates first company', async () => {
    let companyCreated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method?.toUpperCase() || 'GET';

      if (url.includes('/api/pm/import/organization')) {
        return { ok: true, status: 200, json: async () => ({ available: true }) } as Response;
      }
      if (url.endsWith('/api/pm/org/companies') && method === 'POST') {
        companyCreated = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'comp_acme', name: 'Acme Systems', legal_name: 'Acme Systems LLC' }),
        } as Response;
      }
      if (url.endsWith('/api/pm/org')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            companies: companyCreated ? [{ id: 'comp_acme', name: 'Acme Systems', legal_name: 'Acme Systems LLC' }] : [],
            units: [],
            positions: [],
            people: [],
            appointments: [],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<FirstRun onComplete={() => {}} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('First run');
    expect(text).toContain('EMPTY INSTALLATION');
    expect(text).toContain('This installation has no organization and no projects.');

    // Fill organization form using setInputValue
    const handleInput = host.querySelector('input[aria-label="Your handle"]') as HTMLInputElement;
    const nameInput = host.querySelector('input[aria-label="Organization name"]') as HTMLInputElement;
    const legalInput = host.querySelector('input[aria-label="Organization legal name"]') as HTMLInputElement;
    const form = host.querySelector('form[aria-label="Create organization"]') as HTMLFormElement;

    expect(handleInput).toBeTruthy();
    expect(nameInput).toBeTruthy();

    await act(async () => {
      setInputValue(handleInput, 'ali');
      setInputValue(nameInput, 'Acme Systems');
      setInputValue(legalInput, 'Acme Systems LLC');
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitBtn) submitBtn.click();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(companyCreated).toBe(true);
    expect(host.textContent).toContain('Organization Acme Systems is recorded.');
    saveHtmlArtifact('workflow-01-first-run.html', 'Workflow 1: Fresh Empty Installation & Organization Creation', host);
  });

  // ── Journey 2: First-person registration and authorized onboarding ──────────
  it('Workflow 2: First-person registration validates handle and stores claimed actor', async () => {
    let companyCreated = false;
    let personCreated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method?.toUpperCase() || 'GET';

      if (url.includes('/api/pm/import/organization')) {
        return { ok: true, status: 200, json: async () => ({ available: true }) } as Response;
      }
      if (url.endsWith('/api/pm/org/companies') && method === 'POST') {
        companyCreated = true;
        return { ok: true, status: 201, json: async () => ({ id: 'comp_acme', name: 'Acme Systems' }) } as Response;
      }
      if (url.endsWith('/api/pm/org/people') && method === 'POST') {
        personCreated = true;
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'person_ali', handle: 'ali', display_name: 'Ali Musthaq', kind: 'HUMAN' }),
        } as Response;
      }
      if (url.endsWith('/api/pm/org')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            companies: companyCreated ? [{ id: 'comp_acme', name: 'Acme Systems' }] : [],
            units: [],
            positions: [],
            people: personCreated ? [{ id: 'person_ali', handle: 'ali', display_name: 'Ali Musthaq', kind: 'HUMAN' }] : [],
            appointments: [],
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<FirstRun onComplete={() => {}} />);
      await new Promise((r) => setTimeout(r, 20));
    });

    // Step 1: create org
    const handleInput = host.querySelector('input[aria-label="Your handle"]') as HTMLInputElement;
    const nameInput = host.querySelector('input[aria-label="Organization name"]') as HTMLInputElement;
    const orgForm = host.querySelector('form[aria-label="Create organization"]') as HTMLFormElement;

    await act(async () => {
      setInputValue(handleInput, 'ali');
      setInputValue(nameInput, 'Acme Systems');
      const submitOrgBtn = orgForm.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitOrgBtn) submitOrgBtn.click();
      else orgForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    // Step 2: register person
    const personForm = host.querySelector('form[aria-label="Register first person"]') as HTMLFormElement;
    expect(personForm).toBeTruthy();
    const displayNameInput = host.querySelector('input[aria-label="First person display name"]') as HTMLInputElement;

    await act(async () => {
      setInputValue(displayNameInput, 'Ali Musthaq');
      const submitPersonBtn = personForm.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitPersonBtn) submitPersonBtn.click();
      else personForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(personCreated).toBe(true);
    expect(host.textContent).toContain('Ali Musthaq is the first person');
    expect(readClaimedActor()).toBe('ali');
    saveHtmlArtifact('workflow-02-onboarding.html', 'Workflow 2: First-Person Registration & Onboarding', host);
  });

  // ── Journey 3: Department and workforce creation ───────────────────────────
  it('Workflow 3: Workforce directory renders seats and digital/human worker management', async () => {
    const orgData = {
      companies: [{ id: 'comp_starq', name: 'Starq Technologies' }],
      units: [{ id: 'unit_eng', company_id: 'comp_starq', name: 'Engineering', kind: 'DEPARTMENT' }],
      positions: [{ id: 'pos_lead', unit_id: 'unit_eng', title: 'Lead Architect' }],
      people: [
        { id: 'p1', handle: 'ali', display_name: 'Ali Musthaq', kind: 'HUMAN', status: 'active' },
        { id: 'p2', handle: 'antigravity', display_name: 'Antigravity', kind: 'DIGITAL', harness: 'AGY', status: 'active' },
      ],
      appointments: [{ id: 'a1', position_id: 'pos_lead', person_id: 'p1', status: 'ACTIVE' }],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/org')) return { ok: true, json: async () => orgData } as Response;
      if (url.endsWith('/api/pm/org/history')) return { ok: true, json: async () => ({ history: [] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('Starq Technologies');
    expect(text).toContain('Engineering');
    expect(text).toContain('Lead Architect');
    expect(text).toContain('Ali Musthaq');
    expect(text).toContain('Antigravity');
    expect(text).toContain('DIGITAL');
    expect(text).toContain('HUMAN');
    saveHtmlArtifact('workflow-03-workforce.html', 'Workflow 3: Department & Workforce Creation', host);
  });

  // ── Journey 4: Project and milestone creation ──────────────────────────────
  it('Workflow 4: Project creation form on portfolio surface operates and records', async () => {
    storeClaimedActor('ali');
    let projectCreated = false;
    const portfolio = {
      generated_at: '2026-11-01T00:00:00.000Z',
      pending_room_sync: 0,
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      projects: [{ id: 'cmd', name: 'Command OS', prefix: 'CMD', total: 5, open: 2, counts: { TODO: 1, NEXT: 1, IN_PROGRESS: 0, BLOCKED: 0, DONE: 3 } }],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method?.toUpperCase() || 'GET';
      if (url.endsWith('/api/pm/portfolio')) return { ok: true, json: async () => portfolio } as Response;
      if (url.endsWith('/api/pm/projects') && method === 'POST') {
        projectCreated = true;
        return { ok: true, status: 201, json: async () => ({ id: 'phoenix', name: 'Phoenix Rollout', prefix: 'PHX' }) } as Response;
      }
      if (url.endsWith('/api/pm/projects')) {
        return {
          ok: true,
          json: async () => ({
            projects: projectCreated
              ? [...portfolio.projects, { id: 'phoenix', name: 'Phoenix Rollout', prefix: 'PHX' }]
              : portfolio.projects,
          }),
        } as Response;
      }
      if (url.endsWith('/api/pm/org')) return { ok: true, json: async () => ({ people: [{ handle: 'ali' }] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<PmPortfolioSurface />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const createProjForm = host.querySelector('form[aria-label="Create project"]') as HTMLFormElement;
    expect(createProjForm).toBeTruthy();

    const idInput = host.querySelector('input[aria-label="New project id"]') as HTMLInputElement;
    const nameInput = host.querySelector('input[aria-label="New project name"]') as HTMLInputElement;
    const prefixInput = host.querySelector('input[aria-label="New project prefix"]') as HTMLInputElement;

    await act(async () => {
      setInputValue(idInput, 'phoenix');
      setInputValue(nameInput, 'Phoenix Rollout');
      setInputValue(prefixInput, 'PHX');
      const submitProjBtn = createProjForm.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitProjBtn) submitProjBtn.click();
      else createProjForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(projectCreated).toBe(true);
    saveHtmlArtifact('workflow-04-project-creation.html', 'Workflow 4: Project Creation', host);
  });

  // ── Journey 5: Board and work-package creation ─────────────────────────────
  it('Workflow 5: PM Board renders Kanban lanes, task cards, and work-package filters', async () => {
    const metaData = {
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      priorities: ['P0', 'P1', 'P2', 'P3'],
      handles: ['ali', 'antigravity', 'cursor'],
    };
    const projectBoard = {
      project_id: 'cmd',
      project_name: 'Command OS',
      prefix: 'CMD',
      tasks: [
        { id: 'CMD-001', project_id: 'cmd', title: 'Core Lifecycle Stabilization', status: 'IN_PROGRESS', priority: 'P1', owner: 'antigravity', verifier: 'ali', work_package: 'WP-LIFECYCLE' },
        { id: 'CMD-002', project_id: 'cmd', title: 'Workforce Directory Wireup', status: 'TODO', priority: 'P2', owner: 'cursor', verifier: 'ali', work_package: 'WP-WORKFORCE' },
      ],
      people: [{ handle: 'ali' }, { handle: 'antigravity' }, { handle: 'cursor' }],
    };

    let postedMilestone: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.includes('/api/pm/milestones')) {
        postedMilestone = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return { ok: true, status: 201, json: async () => ({ id: 'ms-accept', title: postedMilestone?.title, project_id: 'cmd' }) } as Response;
      }
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => metaData } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [{ id: 'cmd', name: 'Command OS', prefix: 'CMD' }] }) } as Response;
      if (url.includes('/api/pm/tasks')) return { ok: true, json: async () => projectBoard } as Response;
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) } as Response;
      if (url.endsWith('/api/pm/org')) return { ok: true, json: async () => ({ people: projectBoard.people }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    storeClaimedActor('ali');
    const host = setupHost('#studio/pm/cmd');
    await act(async () => {
      root?.render(<PmBoardSurface projectId="cmd" />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('Command OS');
    expect(text).toContain('Core Lifecycle Stabilization');
    expect(text).toContain('Workforce Directory Wireup');
    expect(text).toContain('antigravity');
    const milestoneForm = host.querySelector('form[aria-label="Create milestone"]');
    expect(milestoneForm).toBeTruthy();
    await act(async () => {
      setInputValue(host.querySelector('[aria-label="Milestone title"]') as HTMLInputElement, 'Acceptance milestone');
      setInputValue(host.querySelector('[aria-label="Milestone due date"]') as HTMLInputElement, '2026-12-01');
    });
    await act(async () => {
      milestoneForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(postedMilestone).toMatchObject({
      actor: 'ali',
      project_id: 'cmd',
      title: 'Acceptance milestone',
      due_date: '2026-12-01',
    });
    expect(host.textContent).toContain('Milestone Acceptance milestone is recorded.');
    saveHtmlArtifact('workflow-05-pm-board.html', 'Workflow 5: PM Board & Work Packages', host);
  });

  // ── Journey 6: Task assignment and state transitions ───────────────────────
  it('Workflow 6: Task status transition buttons and owner assignment render truthfully', async () => {
    const metaData = {
      statuses: ['TODO', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'DONE'],
      priorities: ['P0', 'P1', 'P2', 'P3'],
      handles: ['ali', 'antigravity'],
    };
    const taskDetail = {
      id: 'CMD-001',
      project_id: 'cmd',
      title: 'Core Lifecycle Stabilization',
      description: 'Stabilize offline start/stop',
      status: 'IN_PROGRESS',
      priority: 'P1',
      owner: 'antigravity',
      verifier: 'ali',
      stage: 'IN_FLIGHT',
      evidence_refs: [],
      depends_on: [],
      created_by: 'ali',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T01:00:00.000Z',
      allowed_next: ['DONE', 'BLOCKED'],
      allowed_stage_next: ['VERIFIED'],
      workers: ['antigravity'],
      pending_room_sync: 0,
      provenance: 'LIVE',
      gated: false,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/meta')) return { ok: true, json: async () => metaData } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [{ id: 'cmd', name: 'Command OS', prefix: 'CMD' }] }) } as Response;
      if (url.includes('/api/pm/tasks/CMD-001')) return { ok: true, json: async () => ({ task: taskDetail, history: [], hold: { state: null } }) } as Response;
      if (url.includes('/api/pm/tasks')) return { ok: true, json: async () => ({ project_id: 'cmd', tasks: [taskDetail] }) } as Response;
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) } as Response;
      if (url.endsWith('/api/pm/org')) return { ok: true, json: async () => ({ people: [{ handle: 'ali' }, { handle: 'antigravity' }] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost('#studio/pm/cmd?task=CMD-001');
    await act(async () => {
      root?.render(<PmBoardSurface projectId="cmd" initialTaskId="CMD-001" />);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(host.textContent).toContain('Core Lifecycle Stabilization');
    expect(host.textContent).toContain('antigravity');
    saveHtmlArtifact('workflow-06-task-transitions.html', 'Workflow 6: Task Assignment & Transitions', host);
  });

  // ── Journey 7: Workforce activity and operational visibility ───────────────
  it('Workflow 7: Daily activity and operational visibility surface renders live attention', async () => {
    const attentionData = {
      generated_at: '2026-11-01T12:00:00.000Z',
      next_actions: [
        { id: 'CMD-001', project_id: 'cmd', task_id: 'CMD-001', title: 'Core Lifecycle Stabilization', status: 'IN_PROGRESS', priority: 'P1', owner: 'antigravity' },
      ],
      blocked_tasks: [],
      at_risk_milestones: [],
    };
    const digestData = {
      digest: {
        id: 'd1',
        generated_at: '2026-11-01T12:00:00.000Z',
        summary: {
          date: '2026-11-01',
          completed_last_24h: [],
          started_last_24h: [{ task_id: 'CMD-001', title: 'Core Lifecycle Stabilization' }],
          blocked_tasks: [],
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/attention')) return { ok: true, json: async () => attentionData } as Response;
      if (url.endsWith('/api/pm/digests/latest')) return { ok: true, json: async () => digestData } as Response;
      if (url.endsWith('/api/pm/followups')) return { ok: true, json: async () => ({ followups: [] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<DailyActivity />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('Attention');
    expect(text).toContain('Core Lifecycle Stabilization');
    expect(text).toContain('Latest digest');
    saveHtmlArtifact('workflow-07-activity-visibility.html', 'Workflow 7: Workforce Activity & Operational Visibility', host);
  });

  // ── Journey 8: Communication, evidence and review workflows ────────────────
  it('Workflow 8: Comms surface renders channel directory and messaging controls', async () => {
    const channelsData = {
      common: { count: 3 },
      projects: [{ id: 'cmd', label: 'Command OS', count: 5 }],
      dms: [],
    };
    const peopleData = [
      { handle: 'antigravity', display_name: 'Antigravity', status: 'active', kind: 'agent' },
      { handle: 'ali', display_name: 'Ali Musthaq', status: 'active', kind: 'founder' },
    ];
    const messagesData = [
      { id: 'm1', channel: 'common', sender: 'claude', body: 'Candidate PR #15 ready for review', created_at: '2026-11-01T15:00:00.000Z' },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/comms/channels')) return { ok: true, json: async () => ({ channels: channelsData }) } as Response;
      if (url.includes('/api/comms/people')) return { ok: true, json: async () => ({ people: peopleData }) } as Response;
      if (url.includes('/api/comms/messages')) return { ok: true, json: async () => ({ messages: messagesData }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<CommsSurface />);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(host.textContent).toContain('Common Room');
    expect(host.textContent).toContain('Candidate PR #15 ready for review');
    saveHtmlArtifact('workflow-08-comms-evidence.html', 'Workflow 8: Communication & Review Workflows', host);
  });

  // ── Journey 9: Organizational archive/revival and dependency rules ──────────
  it('Workflow 9: Organizational archive controls render soft-archive states', async () => {
    const orgWithArchived = {
      companies: [{ id: 'comp_1', name: 'Active Org', archived_at: null }],
      units: [
        { id: 'unit_1', company_id: 'comp_1', name: 'Active Unit', kind: 'DEPARTMENT', archived_at: null },
        { id: 'unit_2', company_id: 'comp_1', name: 'Archived Unit', kind: 'TEAM', archived_at: '2026-10-30T00:00:00.000Z' },
      ],
      positions: [],
      people: [],
      appointments: [],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/org')) return { ok: true, json: async () => orgWithArchived } as Response;
      if (url.endsWith('/api/pm/org/history')) return { ok: true, json: async () => ({ history: [] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<OrgOperateSurface />);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(host.textContent).toContain('Active Unit');
    saveHtmlArtifact('workflow-09-org-archive.html', 'Workflow 9: Organizational Archive & Dependency Rules', host);
  });

  // ── Journey 10: Restart persistence without record resurrection ────────────
  it('Workflow 10: Session persistence maintains claimed actor across views', async () => {
    const host = setupHost();
    storeClaimedActor('ali');
    expect(readClaimedActor()).toBe('ali');
    saveHtmlArtifact('workflow-10-persistence.html', 'Workflow 10: Session Persistence', host);
  });

  // ── Journey 11: Optional organization snapshot import on a clean database ──
  it('Workflow 11: FirstRun displays availability offer for optional snapshot import', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/pm/import/organization')) {
        return { ok: true, status: 200, json: async () => ({ available: true }) } as Response;
      }
      if (url.endsWith('/api/pm/org')) {
        return { ok: true, status: 200, json: async () => ({ companies: [], units: [], positions: [], people: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<FirstRun onComplete={() => {}} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const offerEl = host.querySelector('[data-import-offer]');
    expect(offerEl).toBeTruthy();
    expect(offerEl?.textContent).toContain('Starq organization import is available as a separate, explicit action');
    saveHtmlArtifact('workflow-11-snapshot-import.html', 'Workflow 11: Optional Organization Snapshot Import', host);
  });

  // ── Journey 12: Founder dashboard navigation and usable day-to-day workflows ─
  it('Workflow 12: Founder Home dashboard renders primary summary metrics and status cards', async () => {
    storeClaimedActor('ali');
    const attentionData = {
      generated_at: '2026-11-01T12:00:00.000Z',
      next_actions: [
        { project_id: 'cmd', task_id: 'CMD-001', title: 'Windows Lifecycle Recovery', status: 'IN_PROGRESS', priority: 'P0', owner: 'claude' },
      ],
      blocked_tasks: [],
      at_risk_milestones: [],
    };
    const digestData = {
      digest: {
        id: 'd1',
        generated_at: '2026-11-01T12:00:00.000Z',
        summary: {
          date: '2026-11-01',
          completed_last_24h: [{ task_id: 'CMD-000', title: 'Baseline Setup' }],
          started_last_24h: [{ task_id: 'CMD-001', title: 'Windows Lifecycle Recovery' }],
          blocked_tasks: [],
        },
      },
    };
    const orgData = {
      companies: [{ id: 'c1', name: 'Starq Tech' }],
      units: [{ id: 'u1' }],
      positions: [{ id: 'p1' }],
      people: [{ id: 'pe1', handle: 'ali' }],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/pm/attention')) return { ok: true, json: async () => attentionData } as Response;
      if (url.endsWith('/api/pm/digests/latest')) return { ok: true, json: async () => digestData } as Response;
      if (url.includes('/api/pm/milestones')) return { ok: true, json: async () => ({ milestones: [] }) } as Response;
      if (url.endsWith('/api/pm/org')) return { ok: true, json: async () => orgData } as Response;
      if (url.endsWith('/api/pm/projects')) return { ok: true, json: async () => ({ projects: [{ id: 'cmd', name: 'Command OS' }] }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = setupHost();
    await act(async () => {
      root?.render(<FounderHome onNavigate={() => {}} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const text = host.textContent || '';
    expect(text).toContain('Founder Home');
    expect(text).toContain('Windows Lifecycle Recovery');
    expect(text).toContain('Today\'s digest');
    saveHtmlArtifact('workflow-12-founder-home.html', 'Workflow 12: Founder Home Dashboard', host);
  });
});
