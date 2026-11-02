import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import {computeRecordHash} from '@workspace/agent-comms/protocol/v1/hashChain.mjs';
import {computeEventId} from '@workspace/agent-comms/protocol/v1/envelope.mjs';
import {readRoomVisibility} from '../server/room-work.mjs';
import { workspacePath } from './support/workspace';

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const rel = path.relative(os.tmpdir(), root);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(root, { recursive: true });
  }
});
function fixture(events: any[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'command-ingestion-'));
  fixtures.push(root);
  const board = path.join(root, '00_STARQ_HQ/operations/starqerp-control-board');
  fs.mkdirSync(board, { recursive: true });
  fs.mkdirSync(path.join(root, 'agent-comms/protocol/v1'), { recursive: true });
  for (const name of ['ingest_room_activity.py', 'starq_paths.py']) {
    // Resolved from the workspace root. `path.resolve('../starqerp-control-board')`
    // was relative to the CWD, so it only found the control board when the
    // process ran from the canonical checkout directory.
    fs.copyFileSync(workspacePath('00_STARQ_HQ/operations/starqerp-control-board', name), path.join(board, name));
  }
  fs.writeFileSync(path.join(board, 'contract.json'), '{}');
  fs.writeFileSync(path.join(root, 'agent-comms/protocol/v1/identities.json'), JSON.stringify({identities:[{canonicalHandle:'codex',status:'active'}]}));
  fs.writeFileSync(path.join(root, 'agent-comms/room.jsonl'), events.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const run = () => spawnSync('python', ['-B', path.join(board, 'ingest_room_activity.py')], {
    encoding: 'utf8', timeout: 15000,
    env: {...process.env, STARQ_WORKSPACE: root, PYTHONDONTWRITEBYTECODE:'1'},
  });
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(board, name), 'utf8'));
  return {root, board, run, read};
}
function event(action?: string, task?: string) {
  return {recordHash:'fixture', eventId:'fixture-event', brokerSequence:1, authorityDecision:{allowed:true}, event:{
    senderHandle:'codex', senderIdentityId:'fixture-codex', createdAt:new Date().toISOString(), body:'Recorded fixture',
    metadata:{action, task, project:'general'},
  }};
}
describe('existing activity producer, isolated workspace only (#9538)', () => {
  it('writes its two projections in a disposable fixture, not the canonical workspace', () => {
    const f=fixture([event('started','TASK-1')]);
    const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').activity_ledger.max_broker_sequence).toBe(1);
    expect(f.read('activity_state.json').checkpoint.event_count).toBe(1);
  });
  it('does not call an unclassified communication active work', () => {
    const f=fixture([event()]); const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').activity_events[0].state).toBe('UNKNOWN');
  });
  it('handles a claim without a declared task without inventing one or crashing', () => {
    const f=fixture([event('claim')]); const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').agents[0].current_assignment).toBe('UNKNOWN');
  });
  it('deduplicates identical event IDs within the input', () => {
    const e=event('done','TASK-1'); const f=fixture([e,e]); const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').activity_events).toHaveLength(1);
  });
  it('fails closed on malformed input before creating projections', () => {
    const f=fixture([event()]); fs.appendFileSync(path.join(f.root,'agent-comms/room.jsonl'),'{broken\n');
    expect(f.run().status).not.toBe(0);
    expect(fs.existsSync(path.join(f.board,'activity.json'))).toBe(false);
  });
  it('reports an unreadable registry instead of crashing with an unbound variable', () => {
    const f=fixture([event()]); fs.writeFileSync(path.join(f.root,'agent-comms/protocol/v1/identities.json'),'{');
    const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').conflicts.some((c: any)=>c.type==='IDENTITY_REGISTRY_UNREADABLE')).toBe(true);
  });
  it('refuses another writer and preserves its lock', () => {
    const f=fixture([event()]); const lock=path.join(f.board,'.activity-ingest.lock'); fs.writeFileSync(lock,'other writer');
    expect(f.run().status).not.toBe(0); expect(fs.readFileSync(lock,'utf8')).toBe('other writer');
    expect(fs.existsSync(path.join(f.board,'activity.json'))).toBe(false);
  });
  it('does not project an authority-denied event as work', () => {
    const e=event('started','TASK-1'); e.authorityDecision.allowed=false;
    const f=fixture([e]); const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').activity_events).toHaveLength(0);
  });
  it('preserves reported assignments without presenting Room claims as current runtime proof', () => {
    const f=fixture([event('started','TASK-1')]);const r=f.run();expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').agents[0]).toMatchObject({last_reported_state:'active',last_reported_assignment:'TASK-1',current_state:'UNKNOWN',current_task:'UNKNOWN',current_assignment:'UNKNOWN'});
  });
  it('rehearses the actual current sources in an isolated copy and binds the checkpoint to output bytes', () => {
    const f=fixture([]);
    const canonical=workspacePath();
    for (const relative of ['agent-comms/room.jsonl','agent-comms/protocol/v1/identities.json',
      '00_STARQ_HQ/operations/starqerp-control-board/contract.json',
      '00_STARQ_HQ/operations/starqerp-control-board/activity_state.json']) {
      fs.copyFileSync(path.join(canonical, relative), path.join(f.root, relative));
    }
    const r=f.run(); expect(r.status,r.stderr).toBe(0);
    expect(f.read('activity.json').activity_ledger.max_broker_sequence).toBeGreaterThanOrEqual(9538);
    expect(f.read('activity_state.json').activity_sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(f.board,'activity.json'))).digest('hex'));
    expect(fs.existsSync(path.join(f.board,'.activity-ingest.lock'))).toBe(false);
  });
  it('automatically hands a changed copied ledger through ingestion into the Work consumer, with a finite writer', async () => {
    const f=fixture([]); const canonical=workspacePath();
    for(const relative of ['agent-comms/room.jsonl','agent-comms/protocol/v1/identities.json','agent-comms/protocol/v1/projects.json',
      'agent-comms/protocol/v1/ledger-epoch.json','agent-comms/protocol/v1/ledger-epoch.mjs','agent-comms/protocol/v1/envelope.mjs','agent-comms/protocol/v1/hashChain.mjs',
      '00_STARQ_HQ/operations/starqerp-control-board/contract.json','00_STARQ_HQ/operations/starqerp-control-board/activity.json','00_STARQ_HQ/operations/starqerp-control-board/activity_state.json']){
      fs.copyFileSync(path.join(canonical,relative),path.join(f.root,relative));
    }
    const room=path.join(f.root,'agent-comms/room.jsonl');
    const original=fs.readFileSync(room,'utf8'); const previous=JSON.parse(original.trim().split(/\r?\n/).at(-1)!);
    const event:any={protocolVersion:'1.0',createdAt:new Date().toISOString(),senderHandle:'codex',senderIdentityId:'fixture-only-codex',nonce:'offline-fixture-only',type:'MESSAGE',
      body:'Title: Copied-ledger automatic handoff\nOwner: @codex\nStatus: Fixture report\nBlocker: Fixture gate\nVerification: Fixture test',metadata:{project:'general',task:'FIXTURE-AUTOMATIC-HANDOFF',action:'result'}};
    const record:any={brokerRecordVersion:'1.0',brokerSequence:previous.brokerSequence+1,ledgerEpochId:previous.ledgerEpochId||'epoch-3-post-room-incident-2026-10-18',previousRecordHash:previous.recordHash,event,eventId:computeEventId(event),authorityDecision:{allowed:true,senderAuthorityLevel:'CORE_AGENT'}};
    record.recordHash=computeRecordHash(record);
    const child=spawn('python',['-B',path.join(f.board,'ingest_room_activity.py'),'--watch','--poll-seconds','1','--max-refreshes','1'],{env:{...process.env,STARQ_WORKSPACE:f.root,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
    let output='',errors='',appended=false;
    child.stdout.on('data',chunk=>{output+=chunk;if(!appended&&output.includes('awaiting canonical Room changes')){appended=true;fs.appendFileSync(room,(original.endsWith('\n')?'':'\n')+JSON.stringify(record)+'\n');}});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    const status=await new Promise<number|null>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Disposable fixture writer timed out'));},25000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
    expect(status,errors).toBe(0);expect(appended).toBe(true);
    const row=readRoomVisibility(f.root).work?.find((r:any)=>r.id===record.eventId);
    expect(row).toMatchObject({title:'Copied-ledger automatic handoff',owner:'@codex',record:{reported_status:'Fixture report',blockers:'Fixture gate',reported_verification:'Fixture test',current_execution:'UNKNOWN',projection_state:'OK'}});
    expect(f.read('activity.json').record_event_ids).toContain(record.eventId);
    expect(fs.existsSync(path.join(f.board,'.activity-ingest.lock'))).toBe(false);
    expect(fs.readdirSync(path.join(f.root,'00_STARQ_HQ/operations/starq-command/evidence/visibility-ingestion-backups'))).toHaveLength(1);
  },30000);
  it('enforces its authorized duration while idle without another projection write', () => {
    const f=fixture([event()]);expect(f.run().status).toBe(0);
    const before=fs.readFileSync(path.join(f.board,'activity.json'),'utf8');
    const r=spawnSync('python',['-B',path.join(f.board,'ingest_room_activity.py'),'--watch','--poll-seconds','1','--max-seconds','1'],{encoding:'utf8',timeout:10000,env:{...process.env,STARQ_WORKSPACE:f.root,PYTHONDONTWRITEBYTECODE:'1'}});
    expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('duration reached');
    expect(fs.readFileSync(path.join(f.board,'activity.json'),'utf8')).toBe(before);
    expect(fs.existsSync(path.join(f.board,'.activity-ingest.lock'))).toBe(false);
  });
});
