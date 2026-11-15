import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest'
import { AthleteTools,type ToolDraft,type ToolStore } from '../src/athlete-tools'
import { defaultSharing } from '../src/coach-domain'
import { createInitialData,dateKey,uid } from '../src/domain'
import { toRecords,parseRemote } from '../src/sync-domain'
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
let db:PGlite
async function role(name:string,owner=a,client='') {await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[owner,JSON.stringify({sub:owner,...(client?{client_id:client}:{})})]);await db.exec(`set role ${name}`)}
async function permissions(owner=a){await role('authenticated',owner);await db.query('select public.athlete_tool_permissions(true,true,$1,$2)',[JSON.stringify(defaultSharing()),new Date(Date.now()+3600000).toISOString()])}
const store:ToolStore={
  authenticate:async token=>token===a||token===b?{owner:token,clientId:null}:null,
  grant:async(_token,actor)=>{await role('authenticated',actor.owner);const row=(await db.query<{enabled:boolean;allow_drafts:boolean;sharing:ReturnType<typeof defaultSharing>;expires_at:string}>('select * from public.athlete_tool_grants')).rows[0];return{enabled:row.enabled,allowDrafts:row.allow_drafts,sharing:row.sharing,expiresAt:row.expires_at}},
  records:async(_token,actor)=>{await role('authenticated',actor.owner);const result=(await db.query<{v:{records:unknown}}>("select public.athlete_sync('[]'::jsonb) as v")).rows[0].v;return parseRemote(result.records)},
  prior:async(actor,key,fingerprint)=>{await role('service_role');const row=(await db.query<{payload:ToolDraft;status:ToolDraft['status'];fingerprint:string}>('select payload,status,fingerprint from public.athlete_tool_drafts where owner_id=$1 and idempotency_key=$2',[actor.owner,key])).rows[0];if(!row)return null;if(row.fingerprint!==fingerprint)throw new Error('REQUEST_REUSED');return{...row.payload,status:row.status}},
  stage:async(actor,key,fingerprint,draft)=>{await role('service_role');return(await db.query<{v:ToolDraft}>('select public.athlete_tool_stage($1,$2,$3,$4) as v',[actor.owner,key,fingerprint,JSON.stringify(draft)])).rows[0].v},
  draft:async(_token,actor,id)=>{await role('authenticated',actor.owner);const row=(await db.query<{payload:ToolDraft;status:ToolDraft['status']}>('select payload,status from public.athlete_tool_drafts where id=$1',[id])).rows[0];if(!row)throw new Error('NOT_FOUND');return{...row.payload,status:row.status}},
}
const tools=new AthleteTools(store,'https://app.test')
const args=()=>({idempotencyKey:uid(),title:'Proposed test session',rationale:'Synthetic test only.',today:dateKey(),workout:{title:'Proposed test',date:dateKey(),category:'Speed',minutes:15,notes:'',exercises:[{id:null,name:'Controlled technique',sets:2,prescription:'Technique practice',rest:'As needed',notes:'',skill:null}]}})
async function staged(){return await tools.execute(a,'propose_workout',args()) as {draftId:string}}
async function decide(id:string,accept=true,confirmed=true,owner=a){await role('authenticated',owner);return(await db.query<{v:{status:string;alreadyDecided:boolean}}>('select public.athlete_tool_decide($1,$2,$3) as v',[id,accept,confirmed])).rows[0].v}
beforeAll(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;insert into auth.users values('${a}'),('${b}');`)
  for(const file of ['202611140001_cloud_sync.sql','202611140002_coaching_chat.sql','202611140003_coaching_proposals.sql','202611150004_coaching_message_length.sql','202611150005_athlete_tools.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'))
},60000)
beforeEach(async()=>{
  await db.exec('reset role');await db.exec('delete from public.athlete_tool_audit;delete from public.athlete_tool_drafts;delete from public.athlete_tool_grants;delete from public.athlete_records;')
  const data=createInitialData();for(const row of Object.values(toRecords(data)))await db.query('insert into public.athlete_records(owner_id,kind,id,revision,payload) values($1,$2,$3,1,$4)',[a,row.kind,row.id,JSON.stringify(row.payload)])
  await permissions(a);await permissions(b)
})
afterAll(async()=>{await db?.close()})
describe('real PostgreSQL tool permissions, approvals, revisions and audit',()=>{
  it('denies raw staging, cross-account reads and OAuth bypasses of sync, health records and approval',async()=>{
    const draft=await staged();await role('authenticated',b)
    expect((await db.query('select * from public.athlete_tool_drafts')).rows).toHaveLength(0)
    await expect(decide(draft.draftId,true,true,b)).rejects.toThrow('NOT_FOUND')
    await expect(db.query('select public.athlete_tool_stage($1,$2,$3,$4)',[a,'fake-key-01','x'.repeat(64),'{}'])).rejects.toThrow('permission denied')
    await role('authenticated',a,'oauth-client')
    expect((await db.query('select * from public.athlete_records')).rows).toHaveLength(0)
    expect((await db.query('select * from public.athlete_tool_drafts')).rows).toHaveLength(0)
    await expect(db.query("select public.athlete_sync('[]'::jsonb)")).rejects.toThrow('AUTH_REQUIRED')
    await expect(db.query('select public.athlete_tool_decide($1,true,true)',[draft.draftId])).rejects.toThrow('AUTH_REQUIRED')
    await expect(db.query('select public.coach_decide($1,true,true)',[draft.draftId])).rejects.toThrow('AUTH_REQUIRED')
    await expect(db.query('select public.athlete_tool_permissions(true,true,$1,$2)',[JSON.stringify(defaultSharing()),new Date(Date.now()+1000).toISOString()])).rejects.toThrow('AUTH_REQUIRED')
  })
  it('requires explicit approval, saves once, preserves history and atomically records an audit trail',async()=>{
    const original=(await store.records(a,{owner:a,clientId:null})),draft=await staged()
    await expect(decide(draft.draftId,true,false)).rejects.toThrow('APPROVAL_REQUIRED')
    expect(await decide(draft.draftId)).toMatchObject({status:'approved',alreadyDecided:false})
    expect(await decide(draft.draftId)).toMatchObject({status:'approved',alreadyDecided:true})
    const rows=await store.records(a,{owner:a,clientId:null});expect(Object.values(rows).filter(r=>r.kind==='session')).toHaveLength(Object.values(original).filter(r=>r.kind==='session').length+1)
    expect(Object.values(rows).filter(r=>r.kind==='workout')).toEqual([])
    expect((await db.query('select event from public.athlete_tool_audit order by event')).rows).toEqual([{event:'approved'},{event:'staged'}])
  })
  it('rejects and expires drafts without changing training and rejects stale programme revisions atomically',async()=>{
    const rejected=await staged();await decide(rejected.draftId,false,false)
    const stale=await staged();await role('authenticated');const record=Object.values(await store.records(a,{owner:a,clientId:null})).find(r=>r.kind==='programme')!
    await db.query('select public.athlete_sync($1)',[JSON.stringify([{kind:record.kind,id:record.id,expected_revision:record.revision,payload:{...(record.payload as object),name:'Athlete edit'}}])])
    await expect(decide(stale.draftId)).rejects.toThrow('STALE_DRAFT')
    const expired=await staged();await db.exec('reset role');await db.query("update public.athlete_tool_drafts set expires_at=now()-interval '1 second' where id=$1",[expired.draftId]);await expect(decide(expired.draftId)).rejects.toThrow('STALE_DRAFT')
    await role('authenticated');expect((await db.query("select * from public.athlete_tool_audit where event='approved'")).rows).toEqual([])
  })
  it('updates only a current planned session and prevents a race with workout completion',async()=>{
    const rows=await store.records(a,{owner:a,clientId:null}),session=Object.values(rows).find(r=>r.kind==='session')!,prescription=session.payload as {id:string;exercises:{id:string}[]}
    const update=await tools.execute(a,'propose_workout_update',{...args(),sessionId:session.id,expectedRevision:1}) as {draftId:string}
    await decide(update.draftId)
    const current=await store.records(a,{owner:a,clientId:null});expect(current[`session:${session.id}`].revision).toBe(2)
    const next=await tools.execute(a,'propose_workout_update',{...args(),sessionId:session.id,expectedRevision:2}) as {draftId:string}
    const snapshot=current[`session:${session.id}`].payload as typeof prescription
    const logArgs={idempotencyKey:uid(),sessionId:session.id,expectedRevision:2,date:dateKey(),minutes:10,rpe:3,notes:'Actual report',results:[{exerciseId:snapshot.exercises[0].id,set:1,done:true,reps:'5',load:''}],skillResults:null}
    const log=await tools.execute(a,'log_completed_workout',logArgs) as {draftId:string};await decide(log.draftId)
    await expect(decide(next.draftId)).rejects.toThrow('HISTORY_PROTECTED')
    expect(await tools.execute(a,'log_completed_workout',logArgs)).toMatchObject({draftId:log.draftId,status:'approved'})
    const after=await store.records(a,{owner:a,clientId:null});expect(Object.values(after).filter(r=>r.kind==='workout')).toHaveLength(1);expect(after[`session:${session.id}`].revision).toBe(2)
  })
  it('revokes access to pending drafts and prevents direct audit or draft forgery',async()=>{
    const draft=await staged();await role('authenticated');await db.query('select public.athlete_tool_permissions(false,false,$1,$2)',[JSON.stringify(defaultSharing()),new Date().toISOString()])
    await expect(decide(draft.draftId)).rejects.toThrow('PERMISSION_REQUIRED')
    await expect(db.query("update public.athlete_tool_drafts set status='approved'")).rejects.toThrow('permission denied')
    await expect(db.query("delete from public.athlete_tool_audit")).rejects.toThrow('permission denied')
    await role('anon');await expect(db.query('select * from public.athlete_tool_drafts')).rejects.toThrow('permission denied')
  })
})
