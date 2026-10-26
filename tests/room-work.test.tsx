import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectRoomRecords, readRoomVisibility } from '../server/room-work.mjs';
import { computeRecordHash } from '../../../../agent-comms/protocol/v1/hashChain.mjs';
import { computeEventId } from '../../../../agent-comms/protocol/v1/envelope.mjs';
import { WorkPackagesSurface } from '@/surfaces/work-packages';
import { AttentionSurface } from '@/surfaces/attention';
import fixtureSurface from './fixtures/phase5-surface.json';
import type { CommandSurface } from '@/lib/contracts';

const projects={projects:[{slug:'general'},{slug:'starq-erp'},{slug:'hoadha'}]};
const identities={identities:[{identityId:'founder',canonicalHandle:'mustarq',status:'active',authorityLevel:'ROOT_GENESIS'}]};
function make(body: string, action: string|null='started', prior: any=null, extra: any={}) {
  const event={protocolVersion:'1.0',createdAt:'2026-10-15T07:00:00Z',senderIdentityId:'codex',senderHandle:'codex',nonce:String(prior?.brokerSequence??0),
    type:'MESSAGE',body,metadata:{project:'general',task:'WORK-1',action},...extra};
  const eventId=computeEventId(event);
  const record={event,eventId,brokerSequence:(prior?.brokerSequence??0)+1,previousRecordHash:prior?.recordHash??'0'.repeat(64),authorityDecision:{allowed:true,senderAuthorityLevel:'CORE_AGENT'}};
  return {...record,recordHash:computeRecordHash(record)};
}
function project(records: any[]) {
  return projectRoomRecords(records,{current:{anchor:{eventId:records[0].eventId}}},projects,identities);
}
function publishProjection(root: string, records: any[]) {
  const board=path.join(root,'00_STARQ_HQ/operations/starqerp-control-board');fs.mkdirSync(board,{recursive:true});
  const activity=JSON.stringify({record_event_ids:records.map(r=>r.eventId),activity_ledger:{max_broker_sequence:records.at(-1)?.brokerSequence,sha256_prefix:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'agent-comms/room.jsonl'))).digest('hex').slice(0,16)}});
  fs.writeFileSync(path.join(board,'activity.json'),activity);
  fs.writeFileSync(path.join(board,'activity_state.json'),JSON.stringify({activity_sha256:crypto.createHash('sha256').update(activity).digest('hex')}));
}
let root: string|null=null;
afterEach(()=>{
  if(root){const relative=path.relative(os.tmpdir(),root);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Unsafe fixture');fs.rmSync(root,{recursive:true});root=null;}
});
describe('#9538 canonical Room work evidence adapter',()=>{
  it('copies explicit fields verbatim and supplies traceable canonical record identity',()=>{
    const r=make('Title: Source title\nOwner: @codex\nVerifier: @vision\nStage: REVIEW\nBlocker: Founder decision\nStatus: Reported implementation\nVerification: Reported tests\nBoard lane: founder-gate');
    const row=project([r]).work[0];
    expect(row).toMatchObject({id:r.eventId,project_id:'general',title:'Source title',owner:'@codex',verifier:'@vision',current_stage:'REVIEW',board_lane:'founder-gate'});
    expect(row.record).toMatchObject({sequence:1,work_id:'WORK-1',blockers:'Founder decision',reported_status:'Reported implementation',reported_verification:'Reported tests',current_execution:'UNKNOWN',independent_verification:'UNKNOWN'});
    expect(row.source.reference).toContain(r.eventId);
  });
  it('never treats sender, recipient, mention, action or recent timestamp as current ownership or execution',()=>{
    const row=project([make('To: @vision\n@codex reports work done','done')]).work[0];
    expect(row.owner).toBeNull();expect(row.verifier).toBeNull();expect(row.current_stage).toBeNull();
    expect(row.record.kind).toBe('REPORTED_OUTCOME');expect(row.record.current_execution).toBe('UNKNOWN');expect(row.record.independent_verification).toBe('UNKNOWN');
  });
  it('does not call plain work references an assignment',()=>{
    expect(project([make('Source heading',null)]).work[0].record.kind).toBe('RECORDED_WORK_REFERENCE');
  });
  it('requires stable work identity, explicit known project and source heading',()=>{
    expect(project([make('Title',null,null,{metadata:{project:'unknown',task:'X'}})]).work).toEqual([]);
    expect(project([make('Title',null,null,{metadata:{project:'general'}})]).work).toEqual([]);
    expect(project([make('')]).work).toEqual([]);
    expect(project([make('Title\nProject: hoadha')]).work).toEqual([]);
  });
  it('keeps separate recorded outcomes for the same task, newest first, without synthesizing status',()=>{
    const a=make('Assignment');const b=make('Outcome','done',a);
    const rows=project([a,b]).work;expect(rows.map((r:any)=>r.id)).toEqual([b.eventId,a.eventId]);
    expect(rows.every((r:any)=>r.current_stage===null)).toBe(true);
  });
  it('fails closed on changed current-epoch hashes, event hashes and continuity',()=>{
    const a=make('Assignment');const b=make('Outcome','done',a);
    expect(()=>project([{...a,recordHash:'bad'}])).toThrow(/integrity/);
    expect(()=>project([a,{...b,previousRecordHash:'bad',recordHash:computeRecordHash({...b,previousRecordHash:'bad'})}])).toThrow(/integrity/);
    expect(()=>project([{...a,event:{...a.event,body:'changed'}}])).toThrow(/integrity/);
  });
  it('preserves historical records visibly unverified instead of blessing old hashes',()=>{
    const old={...make('Old recorded assignment'),recordHash:'historical-failure'};const current=make('Current record');
    const v=projectRoomRecords([old,current],{current:{anchor:{eventId:current.eventId}}},projects,identities);
    expect(v.work.find((r:any)=>r.id===old.eventId).record.integrity).toBe('HISTORICAL_UNVERIFIED');
  });
  it('requires registered ROOT_GENESIS identity and broker authority for Founder history',()=>{
    const founder=make('Founder record',null,null,{senderHandle:'mustarq',senderIdentityId:'founder',metadata:{project:'general'}});
    founder.authorityDecision.senderAuthorityLevel='ROOT_GENESIS';founder.recordHash=computeRecordHash(founder);
    expect(project([founder]).history[0].kind).toBe('FOUNDER_RECORD');
    const spoof=make('Spoof',null,null,{senderHandle:'mustarq',senderIdentityId:'codex',metadata:{project:'general'}});
    spoof.authorityDecision.senderAuthorityLevel='ROOT_GENESIS';spoof.recordHash=computeRecordHash(spoof);
    expect(project([spoof]).history).toEqual([]);
  });
  it('returns unavailable for missing sources and refuses cached values after a malformed append',()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'command-room-work-'));
    expect(readRoomVisibility(root).work).toBeNull();
    const r=make('Title'); const files:any={'agent-comms/room.jsonl':JSON.stringify(r),'agent-comms/protocol/v1/ledger-epoch.json':JSON.stringify({current:{anchor:{eventId:r.eventId}}}),'agent-comms/protocol/v1/projects.json':JSON.stringify(projects),'agent-comms/protocol/v1/identities.json':JSON.stringify(identities)};
    for(const [file,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body as string);}
    publishProjection(root,[r]);
    expect(readRoomVisibility(root).work).toHaveLength(1);
    const later=make('Later actual report','done',r);
    fs.appendFileSync(path.join(root,'agent-comms/room.jsonl'),'\n'+JSON.stringify(later));
    expect(readRoomVisibility(root).state).toBe('STALE');
    expect(readRoomVisibility(root).work).toHaveLength(1); // no bypass of ingestion
    publishProjection(root,[r,later]);
    expect(readRoomVisibility(root).state).toBe('OK');
    expect(readRoomVisibility(root).work).toHaveLength(2);
    expect(readRoomVisibility(root).work[0].record.event_id).toBe(later.eventId);
    fs.appendFileSync(path.join(root,'agent-comms/room.jsonl'),'\n{bad');
    expect(readRoomVisibility(root).work).toBeNull();
  });
  it('rejects a partial output/checkpoint handoff rather than consuming unmatched output',()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'command-room-work-'));
    const r=make('Source title');const files:any={'agent-comms/room.jsonl':JSON.stringify(r),'agent-comms/protocol/v1/ledger-epoch.json':JSON.stringify({current:{anchor:{eventId:r.eventId}}}),'agent-comms/protocol/v1/projects.json':JSON.stringify(projects),'agent-comms/protocol/v1/identities.json':JSON.stringify(identities)};
    for(const [file,body] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body as string);}
    publishProjection(root,[r]);
    fs.writeFileSync(path.join(root,'00_STARQ_HQ/operations/starqerp-control-board/activity_state.json'),'{}');
    expect(readRoomVisibility(root)).toMatchObject({work:null,state:'UNAVAILABLE',reason:'Activity output/checkpoint handoff mismatch'});
  });
  it('renders recorded evidence without displaying a report as verified completion',()=>{
    const rows=project([make('Title: Actual source title\nBlocker: Scope decision\nVerification: Reported tests','done')]).work;
    const html=renderToStaticMarkup(<WorkPackagesSurface rows={rows}/>);
    expect(html).toContain('Actual source title');expect(html).toContain('Scope decision');expect(html).toContain('Reported tests');expect(html).toContain('UNKNOWN');expect(html).toContain('REPORTED_OUTCOME');
  });
  it('bounds Work DOM while preserving all records through pagination',()=>{
    const row=project([make('Source title')]).work[0];const rows=Array.from({length:45},(_,i)=>({...row,id:String(i)}));
    const html=renderToStaticMarkup(<WorkPackagesSurface rows={rows}/>);
    expect((html.match(/data-work-package=/g)??[])).toHaveLength(20);expect(html).toContain('Next records');expect(html).toContain('45');
  });
  it('renders canonical Founder history without reconstructing attention closure',()=>{
    const r=make('Founder evidence',null,null,{senderHandle:'mustarq',senderIdentityId:'founder',metadata:{project:'general'}});
    r.authorityDecision.senderAuthorityLevel='ROOT_GENESIS';r.recordHash=computeRecordHash(r);
    const visibility=project([r]);
    const surface={...fixtureSurface,room_visibility:visibility} as unknown as CommandSurface;
    const html=renderToStaticMarkup(<AttentionSurface surface={surface} peer="History"/>);
    expect(html).toContain('Founder evidence');expect(html).toContain(r.eventId);expect(html).toContain('FOUNDER_RECORD');expect(html).toContain('UNKNOWN');expect(html).not.toContain('No historical attention projection is declared.');
    expect(html).toContain('Recorded Founder and work evidence.');
    expect(html).not.toContain('Message text is never read here.');
    expect(html).not.toContain('this phase built no evidence route');
  });
});
