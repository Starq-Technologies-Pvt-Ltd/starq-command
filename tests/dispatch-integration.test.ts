import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PmTaskExecutionStore } from '../integrations/control-plane/pm-task-execution-store.ts';
import { TaskStore } from '../integrations/control-plane/task-store.ts';
import { Dispatcher } from '../integrations/herdr/dispatcher.ts';
import { WorktreeManager } from '../integrations/workspace/worktree-manager.ts';
import { LeaseService } from '../integrations/workspace/lease-service.ts';
import { projectWorkforce } from '../server/workforce-runtime.mjs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const scratchRoot = path.resolve('D:/StarqTech/.scratch');
const fixtures: string[] = [];

function makeFixture() {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchRoot, 'dispatch-e2e-'));
  fixtures.push(root);
  const dbPath = path.join(root, 'pm-operating.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE pm_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,hold_state TEXT);
    CREATE TABLE pm_tasks(
      id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES pm_projects(id),title TEXT NOT NULL,
      description TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,
      prior_status TEXT,prior_stage TEXT,provenance TEXT NOT NULL,owner TEXT NOT NULL,verifier TEXT NOT NULL,
      room_authorization_ref TEXT,evidence_refs TEXT NOT NULL,depends_on TEXT NOT NULL,
      acceptance_json TEXT,requirements_json TEXT,notes TEXT NOT NULL,created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,closed_at TEXT
    );
    CREATE TABLE pm_status_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,event_type TEXT NOT NULL,
      from_status TEXT,to_status TEXT,actor TEXT NOT NULL,detail TEXT NOT NULL,timestamp TEXT NOT NULL,
      room_sync TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
    );
    INSERT INTO pm_projects VALUES('core','Core Infrastructure',NULL);
  `);
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO pm_tasks(id,project_id,title,description,priority,status,stage,provenance,owner,verifier,
    room_authorization_ref,evidence_refs,depends_on,acceptance_json,requirements_json,notes,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'PM-CORE-001','core','Dispatch integration','Implement the execution loop','P1','NEXT','READY','LIVE',
    'claude','vision',JSON.stringify({sequence:9001,eventId:'auth-9001'}),'[]','[]',
    JSON.stringify(['Candidate builds and passes independent verification.']),
    JSON.stringify({required_capabilities:['typescript']}),'','mustarq',stamp,stamp,
  );
  db.close();
  const repoPath = path.join(root,'repo');
  fs.mkdirSync(repoPath);
  execFileSync('git',['init','--quiet','--initial-branch=main'],{cwd:repoPath});
  execFileSync('git',['config','user.name','Command Dispatch Test'],{cwd:repoPath});
  execFileSync('git',['config','user.email','dispatch-test@example.invalid'],{cwd:repoPath});
  fs.writeFileSync(path.join(repoPath,'README.md'),'initial\n');
  execFileSync('git',['add','README.md'],{cwd:repoPath});
  execFileSync('git',['commit','--quiet','-m','fixture base'],{cwd:repoPath});
  const baseSha=execFileSync('git',['rev-parse','HEAD'],{cwd:repoPath,encoding:'utf8'}).trim();
  const store = new PmTaskExecutionStore(dbPath);
  return { root, dbPath, db: new DatabaseSync(dbPath), repoPath, baseSha, store };
}

function herdrState({ verifier = true } = {}) {
  const agents = [
    { id:'elder',state:'RUNNING',pid:101,session_id:'session-claude',broker_owned:true,workload_state:'IDLE',execution_ready:true },
    ...(verifier ? [{ id:'vision',state:'RUNNING',pid:202,session_id:'session-vision',broker_owned:true,workload_state:'IDLE',execution_ready:true }] : []),
  ];
  return {
    timestamp:new Date().toISOString(),broker:{online:true},herdr:{state:'AVAILABLE'},
    agents,
    sessions:agents.map((agent) => ({agent_id:agent.id,session_id:agent.session_id,state:'RUNNING'})),
    standalone:{bindings_state:'OK',panes:[
      {attribution:'BOUND',seat_id:'elder',binding_state:'BOUND',pane:{workspace_id:'w1',pane_id:'w1:p1',terminal_id:'term-builder'}},
      ...(verifier ? [{attribution:'BOUND',seat_id:'vision',binding_state:'BOUND',pane:{workspace_id:'w1',pane_id:'w1:p2',terminal_id:'term-verifier'}}] : []),
      {attribution:'UNATTRIBUTED',seat_id:null,binding_state:'UNBOUND',pane:{workspace_id:'w1',pane_id:'w1:p3',terminal_id:'term-unknown'}},
    ]},
  };
}

const capabilities = {
  claude:{status:'VERIFIED',capabilities:['typescript','verification'],evidence:['capability-review:claude']},
  vision:{status:'VERIFIED',capabilities:['typescript','verification'],evidence:['capability-review:vision']},
};

function makeDispatcher(f, roomAdapter = { emitEvent: async () => ({ room_ref:{sequence:9002,status:'POSTED'} }) }, state = herdrState()) {
  return new Dispatcher({
    store:f.store,
    getWorkforce:async () => projectWorkforce(state,{capabilities,activeWorkload:f.store.listActiveWorkload()}),
    worktreeManager:WorktreeManager,
    repoResolver:() => ({repoPath:f.repoPath,baseSha:f.baseSha,worktreesDir:path.join(f.root,'worktrees')}),
    roomAdapter,
    sender:'codex',
  });
}

function builderArtifact(taskId: string, builderSeat: string, baseSha: string, candidateSha: string, workspacePath: string) {
  return {
    schemaVersion:'1.0.0' as const,taskId,builderSeat,baseSha,candidateSha,workspacePath,
    filesChanged:['README.md'],diffStat:{insertions:1,deletions:0,filesCount:1},
    implementationSummary:'Completed the assigned change with deterministic evidence.',
    testsExecuted:[{command:'npm test',exitCode:0}],knownLimitations:[],
    evidenceReferences:['local:test-output'],completedAt:new Date().toISOString(),
  };
}

function verifierArtifact(taskId: string, verifierSeat: string, candidateSha: string, workspacePath: string) {
  return {
    schemaVersion:'1.0.0' as const,taskId,verifierSeat,evaluatedSha:candidateSha,verificationWorkspace:workspacePath,
    independenceClass:'STRICT_INDEPENDENT' as const,commandsExecuted:[{command:'npm test',exitCode:0}],
    result:'PASS' as const,findings:[],remainingRisk:'LOW' as const,verdictNotes:'Independent checks passed.',
    verifiedAt:new Date().toISOString(),
  };
}

function addRoomEvidence(f: ReturnType<typeof makeFixture>, refs: unknown[]) {
  f.db.prepare('UPDATE pm_tasks SET evidence_refs=? WHERE id=?').run(JSON.stringify(refs),'PM-CORE-001');
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    try { fs.rmSync(root,{recursive:true,force:true}); } catch { /* retain fixture if a worker still has it open */ }
  }
});

describe('PM to dispatch to execution integration', () => {
  it('dispatches with an exclusive worktree lease and preserves the PM task through review, acceptance, and closure', async () => {
    const f=makeFixture();
    const taskStore=TaskStore.forPmExecutionStore(f.store);
    const dispatcher=makeDispatcher(f);
    const assigned=await dispatcher.dispatchNext();
    expect(assigned.state).toBe('EXECUTING');
    expect(assigned.task.taskId).toBe('PM-CORE-001');
    expect(assigned.task.projectId).toBe('core');
    expect(assigned.task.execution.builderSeat).toBe('claude');
    expect(assigned.task.execution.herdrSessionId).toBe('session-claude');
    expect(assigned.task.acceptanceCriteria).toEqual(['Candidate builds and passes independent verification.']);
    expect(assigned.task.dependencies).toEqual([]);
    expect(assigned.task.stage).toBe('IN_PROGRESS');
    expect(assigned.roomRef.sequence).toBe(9002);
    expect(() => LeaseService.acquireLease({taskId:'OTHER',seat:'vision',role:'BUILDER',
      workspacePath:assigned.worktree.workspacePath,branch:'other',baseSha:f.baseSha})).toThrow(/actively leased/);

    fs.writeFileSync(path.join(assigned.worktree.workspacePath,'README.md'),'implemented\n');
    execFileSync('git',['add','README.md'],{cwd:assigned.worktree.workspacePath});
    execFileSync('git',['commit','--quiet','-m','candidate'],{cwd:assigned.worktree.workspacePath});
    const candidateSha=execFileSync('git',['rev-parse','HEAD'],{cwd:assigned.worktree.workspacePath,encoding:'utf8'}).trim();
    taskStore.attachBuilderArtifact('PM-CORE-001',builderArtifact('PM-CORE-001','claude',f.baseSha,candidateSha,assigned.worktree.workspacePath));
    const built=taskStore.transitionTask('PM-CORE-001','BUILDER_COMPLETE','claude','Builder artifact and tests submitted.');
    expect(built.execution.state).toBe('BUILDER_COMPLETE');
    expect(built.stage).toBe('REVIEW');

    const verification=await dispatcher.startVerification('PM-CORE-001');
    expect(verification.state).toBe('VERIFYING');
    expect(verification.task.execution.verifierSessionId).toBe('session-vision');
    expect(verification.task.stage).toBe('VERIFICATION');

    const verificationTime=new Date(Date.now()+2000).toISOString();
    addRoomEvidence(f,[{kind:'evidence',senderHandle:'vision',received_at:verificationTime,mentions_task:true,
      task_id:'PM-CORE-001',authority_level:'CORE_AGENT',root_authority:false,eventId:'verify-evidence'}]);
    taskStore.attachVerifierArtifact('PM-CORE-001',verifierArtifact(
      'PM-CORE-001','vision',candidateSha,verification.worktree.workspacePath,
    ));
    const accepted=taskStore.transitionTask('PM-CORE-001','ACCEPTED','vision','Independent verifier evidence accepted.');
    expect(accepted.execution.state).toBe('ACCEPTED');
    expect(accepted.stage).toBe('ACCEPTANCE');

    addRoomEvidence(f,[
      {kind:'evidence',senderHandle:'vision',received_at:verificationTime,mentions_task:true,task_id:'PM-CORE-001',root_authority:false,eventId:'verify-evidence'},
      {kind:'evidence',senderHandle:'mustarq',received_at:new Date(Date.now()+4000).toISOString(),mentions_task:true,
        task_id:'PM-CORE-001',authority_level:'ROOT_GENESIS',root_authority:true,eventId:'founder-acceptance'},
    ]);
    const closed=f.store.closePmTask('PM-CORE-001','mustarq');
    expect(closed.stage).toBe('CLOSED');
    expect(closed.execution.state).toBe('ACCEPTED');
    expect(closed.owner).toBe('claude');
    expect(closed.verifier).toBe('vision');
    expect(taskStore.getTransitionHistory('PM-CORE-001').map((row:any)=>row.to_state)).toEqual([
      'ALLOCATED','EXECUTING','BUILDER_COMPLETE','VERIFYING','ACCEPTED',
    ]);
  });

  it('fails closed when worker capability/session evidence is unavailable', async () => {
    const f=makeFixture();
    const dispatcher=makeDispatcher(f,{emitEvent:async()=>({room_ref:{sequence:1,status:'POSTED'}})},herdrState({verifier:false}));
    const result=await dispatcher.dispatchNext();
    expect(result.state).toBe('NO_ELIGIBLE_WORK');
    expect(result.plan.blocked[0].blockers).toContain('HERDR_SEAT_UNJOINED');
    expect(f.store.getTask('PM-CORE-001').execution).toBeNull();
  });

  it('rejects a second concurrent PM task claim', async () => {
    const f=makeFixture();
    const params={taskId:'PM-CORE-001',builderSeat:'claude',herdrSessionId:'session-claude',
      workspacePath:path.join(f.root,'lease-a'),branch:'a',baseSha:f.baseSha,leaseId:'lease-a',
      contract:{requiredCapabilities:['typescript']},roomAssignmentRef:{status:'PENDING'}};
    const first=f.store.allocate(params);
    expect(first.stage).toBe('IN_PROGRESS');
    expect(() => f.store.allocate({...params,workspacePath:path.join(f.root,'lease-b'),branch:'b',leaseId:'lease-b'})).toThrow(/active execution|not an authorized/);
  });

  it('blocks failed Room delivery and safely recovers to a fresh worktree attempt', async () => {
    const f=makeFixture();
    let fail=true;
    const roomAdapter={emitEvent:async()=>{
      if (fail) throw new Error('test Room route unavailable');
      return {room_ref:{sequence:9003,status:'POSTED'}};
    }};
    const dispatcher=makeDispatcher(f,roomAdapter);
    const failed=await dispatcher.dispatchNext();
    expect(failed.state).toBe('BLOCKED');
    expect(f.store.getTask('PM-CORE-001').stage).toBe('BLOCKED');
    fail=false;
    const recovered=await dispatcher.recover('PM-CORE-001','Room route restored; retry assignment.');
    expect(recovered.state).toBe('EXECUTING');
    expect(recovered.worktree.branch).toContain('-retry-1');
    expect(f.store.getTask('PM-CORE-001').stage).toBe('IN_PROGRESS');
    expect(f.store.getHistory('PM-CORE-001').map((row:any)=>row.to_state)).toEqual([
      'ALLOCATED','BLOCKED','QUEUED','ALLOCATED','EXECUTING',
    ]);
  });

  it('recovers a failed worker, saves dirty work, and retries on a new branch', async () => {
    const f=makeFixture();
    const dispatcher=makeDispatcher(f);
    const first=await dispatcher.dispatchNext();
    expect(first.state).toBe('EXECUTING');
    fs.writeFileSync(path.join(first.worktree.workspacePath,'README.md'),'unfinished builder work\n');
    f.store.transition('PM-CORE-001','FAILED','codex',{reason:'Herdr builder session exited during execution.'});
    expect(f.store.getTask('PM-CORE-001').stage).toBe('BLOCKED');
    const recovered=await dispatcher.recover('PM-CORE-001','Builder session exited; preserve its unfinished changes.');
    expect(recovered.state).toBe('EXECUTING');
    expect(recovered.worktree.branch).toContain('-retry-1');
    const rescueBranch=execFileSync('git',['branch','--list','rescue/PM-CORE-001-*'],{cwd:f.repoPath,encoding:'utf8'}).trim().replace(/^\*?\s*/,'');
    expect(rescueBranch).toMatch(/^rescue\/PM-CORE-001-/);
    expect(execFileSync('git',['show',`${rescueBranch}:README.md`],{cwd:f.repoPath,encoding:'utf8'})).toBe('unfinished builder work\n');
    expect(f.store.getTask('PM-CORE-001').stage).toBe('IN_PROGRESS');
  });
});
