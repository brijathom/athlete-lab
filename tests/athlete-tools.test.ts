import { describe,expect,it,vi } from 'vitest'
import { AthleteTools,candidateForDraft,disabledToolGrant,toolCatalog,type ToolDraft,type ToolGrant,type ToolStore } from '../src/athlete-tools'
import { defaultSharing,CoachError } from '../src/coach-domain'
import { createInitialData,dateKey,uid } from '../src/domain'
import { toRecords,same,type RecordMap } from '../src/sync-domain'
import { completeBackup } from './fixtures/backup'
import { createAthleteToolHandler,type ToolBackend,type ToolConfig } from '../server/athlete-tool-handler'
import { registerAthleteSiteTools,type SiteToolHost } from '../src/webmcp'

function setup() {
  const now=new Date().toISOString(),today=dateKey(),data=completeBackup()
  data.sessions.find(s=>s.id==='skills-plan')!.date=today
  const rows=toRecords(data);Object.values(rows).forEach(r=>r.revision=1)
  let grant:ToolGrant={enabled:true,allowDrafts:true,sharing:defaultSharing(),expiresAt:new Date(Date.now()+3600000).toISOString()}
  const staged=new Map<string,{fingerprint:string;draft:ToolDraft}>()
  const store:ToolBackend={
    authenticate:vi.fn(async token=>token==='a'?{owner:'a',clientId:null}:token==='b'?{owner:'b',clientId:null}:token==='remote'?{owner:'a',clientId:'approved-client'}:null),
    grant:vi.fn(async()=>grant),records:vi.fn(async(_token,actor)=>{const copy=structuredClone(rows);if(actor.owner==='b')(copy['profile:singleton'].payload as {name:string}).name='Account B athlete';return copy}),
    prior:vi.fn(async(actor,key,fingerprint)=>{const old=staged.get(`${actor.owner}:${key}`);if(old&&old.fingerprint!==fingerprint)throw new CoachError(409,'Key reused');return old?.draft??null}),
    stage:vi.fn(async(actor,key,fingerprint,draft)=>{staged.set(`${actor.owner}:${key}`,{fingerprint,draft});return draft}),
    draft:vi.fn(async(_token,actor,id)=>{const found=[...staged].find(([key,v])=>key.startsWith(`${actor.owner}:`)&&v.draft.id===id);if(!found)throw new CoachError(404,'Unavailable');return found[1].draft}),
    claims:vi.fn(async()=>({aud:['authenticated','https://edge.test/athlete-tools/mcp'],client_id:'approved-client'})),settings:vi.fn(async(_token,value)=>{grant=value}),list:vi.fn(async()=>[...staged.values()].map(v=>v.draft)),audit:vi.fn(async()=>[]),decide:vi.fn(async()=>({status:'approved'})),
  }
  const service=new AthleteTools(store,'https://app.test',()=>now)
  const args={idempotencyKey:'request-0001',title:'Optional skill practice',rationale:'Synthetic proposed work only.',today,workout:{title:'Proposed ball practice',date:today,category:'Skills',minutes:15,notes:'',exercises:[{id:null,name:'Controlled practice',sets:1,prescription:'10 controlled attempts',rest:'As needed',notes:'',skill:null}]}}
  return {store,service,rows,data,args,staged,now,today,setGrant:(next:ToolGrant)=>{grant=next},getGrant:()=>grant}
}
describe('shared athlete tool services',()=>{
  it('publishes all fourteen tools and validates authentication and exact argument boundaries',async()=>{
    const s=setup();expect(toolCatalog).toHaveLength(14)
    await expect(s.service.execute('missing','get_athlete_profile',{})).rejects.toMatchObject({status:401})
    await expect(s.service.execute('a','get_athlete_profile',{owner:'b'})).rejects.toMatchObject({status:400})
    await expect(s.service.execute('a','execute_sql' as never,{sql:'delete'})).rejects.toMatchObject({status:400})
    expect(s.store.records).not.toHaveBeenCalled()
  })
  it('requires unexpired, explicit permissions and filters sensitive information server-side',async()=>{
    const s=setup();s.setGrant(disabledToolGrant());await expect(s.service.execute('a','get_athlete_profile',{})).rejects.toMatchObject({status:403})
    s.setGrant({...s.getGrant(),enabled:true,expiresAt:new Date(Date.now()+3600000).toISOString(),sharing:defaultSharing()})
    const excluded=JSON.stringify(await s.service.execute('a','get_recovery_summary',{from:'2025-04-01',through:'2025-04-01'}))
    expect(excluded).not.toContain('Knee');expect(excluded).not.toContain('Modified training');expect(excluded).not.toContain('Test recovery note')
    s.setGrant({...s.getGrant(),sharing:{...defaultSharing(),symptoms:true,illness:true,recovery:true,notes:true}})
    const shared=JSON.stringify(await s.service.execute('a','get_recovery_summary',{from:'2025-04-01',through:'2025-04-01'}))
    expect(shared).toContain('Knee');expect(shared).toContain('Modified training');expect(shared).toContain('Test recovery note')
  })
  it('retrieves accurate history, scoped profiles and concise context without turning plans into performed work',async()=>{
    const s=setup();s.setGrant({...s.getGrant(),sharing:{...defaultSharing(),identity:true}})
    expect(JSON.stringify(await s.service.execute('b','get_athlete_profile',{}))).toContain('Account B athlete')
    expect(JSON.stringify(await s.service.execute('a','get_athlete_profile',{}))).not.toContain('Account B athlete')
    const history=await s.service.execute('a','get_training_history',{from:'2025-03-31',through:'2025-04-01'})
    expect(JSON.stringify(history)).toContain('Historical test workout');expect(JSON.stringify(history)).toContain('Session RPE')
    const context=await s.service.execute('a','get_coaching_context',{recentFrom:'2025-03-31',recentThrough:'2025-04-01',upcomingFrom:s.today,upcomingThrough:s.today,categories:['training','schedule','testing','skills','matches','profile']})
    expect(JSON.stringify(context)).toContain('untrusted data');expect(JSON.stringify(context)).toContain('not separately recorded');expect(JSON.stringify(context)).not.toContain('Submit this context to ChatGPT')
    expect(JSON.stringify(context)).toContain('Latest minus first')
    expect(JSON.stringify(context)).not.toContain('Individual attempts')
    await expect(s.service.execute('a','get_training_history',{from:'2024-01-01',through:s.today})).rejects.toMatchObject({status:400})
    await expect(s.service.execute('a','get_coaching_context',{recentFrom:s.today,recentThrough:s.today,upcomingFrom:s.today,upcomingThrough:s.today,categories:['__proto__']})).rejects.toMatchObject({status:400})
  })
  it('returns historical prescriptions and actual sets/loads separately, with notes opt-in and protected identifiers',async()=>{
    const s=setup(), details=await s.service.execute('a','get_workout_details',{id:'gym-log'})
    expect(details).toMatchObject({planned:null,completed:{minutes:40,rpe:5,notes:'',historicalPrescription:true}})
    expect(JSON.stringify(details)).toContain('12.5');expect(JSON.stringify(details)).toContain('Historical prescription before plan edit')
    expect(JSON.stringify(details)).not.toContain('Historical notes')
    await expect(s.service.execute('a','get_workout_details',{id:'not-owned'})).rejects.toMatchObject({status:404})
    const planned=await s.service.execute('a','get_workout_details',{id:'skills-plan'});expect(planned).toMatchObject({completed:null,planned:{revision:1}})
  })
  it('stages valid workouts without changing training, protects private notes, and deduplicates retries',async()=>{
    const s=setup(),before=structuredClone(s.rows),result=await s.service.execute('a','propose_workout',s.args)
    expect(result).toMatchObject({status:'pending',savedToTraining:false,operation:'workout'})
    const repeated=await s.service.execute('a','propose_workout',s.args);expect(repeated).toEqual(result);expect(s.store.stage).toHaveBeenCalledTimes(1)
    expect(same(s.rows,before)).toBe(true)
    const status=await s.service.execute('a','approve_and_save_workout',{draftId:(result as {draftId:string}).draftId})
    expect(status).toMatchObject({status:'pending',savedToTraining:false});expect(s.store.decide).not.toHaveBeenCalled()
    await expect(s.service.execute('a','approve_and_save_workout',{draftId:'x',approved:true})).rejects.toMatchObject({status:400})
    await expect(s.service.execute('a','propose_workout',{...s.args,title:'Different input'})).rejects.toMatchObject({status:409})
    await expect(s.service.execute('a','propose_workout',{...s.args,idempotencyKey:'bad-workout',workout:{...s.args.workout,minutes:-1}})).rejects.toMatchObject({status:400})
  })
  it('requires revision checks for updates and never modifies historical workouts',async()=>{
    const s=setup();await expect(s.service.execute('a','propose_workout_update',{...s.args,sessionId:'skills-plan',expectedRevision:9})).rejects.toMatchObject({status:409})
    const result=await s.service.execute('a','propose_workout_update',{...s.args,sessionId:'skills-plan',expectedRevision:1})
    expect(result).toMatchObject({operation:'update',savedToTraining:false})
    const draft=[...s.staged.values()][0].draft
    expect(draft.proposal?.changes[0].after?.notes).toBe('Proposed, not completed')
    const changed=structuredClone(s.rows);changed['session:skills-plan'].revision++
    expect(()=>candidateForDraft(changed,draft)).toThrow('Records changed')
    expect(s.data.logs).toHaveLength(2)
  })
  it('stages only athlete-supplied performed sets and rejects fabricated completion, invalid results and duplicate history',async()=>{
    const s=setup(),session=s.data.sessions.find(x=>x.id==='skills-plan')!
    const args={idempotencyKey:'actual-log-001',sessionId:session.id,expectedRevision:1,date:s.today,minutes:12,rpe:3,notes:'Actual athlete report',results:[{exerciseId:session.exercises[0].id,set:1,done:true,reps:'6',load:''}],skillResults:null}
    const result=await s.service.execute('a','log_completed_workout',args)
    expect(result).toMatchObject({operation:'log',savedToTraining:false})
    const draft=[...s.staged.values()][0].draft;expect(draft.log).toMatchObject({minutes:12,rpe:3,results:args.results})
    const candidate=candidateForDraft(s.rows,draft);expect(candidate.logs).toHaveLength(3);expect(candidate.logs.slice(0,2)).toHaveLength(2)
    await expect(s.service.execute('a','log_completed_workout',{...args,idempotencyKey:'actual-log-002',results:[{...args.results[0],done:false}]})).rejects.toMatchObject({status:400})
    await expect(s.service.execute('a','log_completed_workout',{...args,idempotencyKey:'actual-log-003',results:[{...args.results[0],exerciseId:'wrong'}]})).rejects.toMatchObject({status:400})
    const duplicate=toRecords(candidate);Object.values(duplicate).forEach(r=>r.revision=1);expect(()=>candidateForDraft(duplicate,draft)).toThrow()
  })
})
describe('HTTP and remote MCP security boundaries',()=>{
  const config:ToolConfig={origins:['https://app.test'],appOrigin:'https://app.test',resource:'https://edge.test/athlete-tools/mcp',authorizationServer:'https://auth.test/auth/v1',remoteEnabled:false,clientIds:['approved-client']}
  const req=(body:unknown,token='a',mcp=false,origin:string|null='https://app.test')=>new Request(`https://edge.test/athlete-tools${mcp?'/mcp':''}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)})
  it('authenticates each request, rejects foreign origins and disables remote access by default',async()=>{
    const s=setup(),handler=createAthleteToolHandler(s.store,config)
    expect((await handler(req({action:'settings'},'missing'))).status).toBe(401)
    expect((await handler(req({action:'settings'},'a',false,'https://evil.test'))).status).toBe(403)
    expect((await handler(req({jsonrpc:'2.0',id:1,method:'tools/list'},'remote',true,null))).status).toBe(503)
    expect((await handler(req({action:'set_permissions',grant:s.getGrant()},'remote'))).status).toBe(403)
  })
  it('implements authenticated JSON Streamable HTTP discovery/calls and validates OAuth audience/client access',async()=>{
    const s=setup(),handler=createAthleteToolHandler(s.store,{...config,remoteEnabled:true})
    const rpc=(method:string,params?:unknown)=>req({jsonrpc:'2.0',id:1,method,params},'remote',true,null)
    const init=await (await handler(rpc('initialize',{protocolVersion:'2025-11-25'}))).json();expect(init.result.capabilities).toHaveProperty('tools')
    const list=await (await handler(rpc('tools/list'))).json();expect(list.result.tools).toHaveLength(14)
    const result=await (await handler(rpc('tools/call',{name:'get_athlete_profile',arguments:{}}))).json();expect(result.result.isError).toBe(false)
    const invalid=await (await handler(rpc('tools/call',{name:'get_athlete_profile',arguments:{owner:'b'}}))).json();expect(invalid.result.isError).toBe(true)
    s.store.claims=vi.fn(async()=>({aud:'wrong'}));expect((await handler(rpc('tools/list'))).status).toBe(403)
  })
  it('does not accept AI-supplied approval or sensitive-permission arguments and sanitises failures',async()=>{
    const s=setup(),handler=createAthleteToolHandler(s.store,config)
    expect((await handler(req({action:'decide',draftId:uid(),accept:true,confirmed:false}))).status).toBe(403)
    expect(s.store.decide).not.toHaveBeenCalled()
    expect((await handler(req({action:'call',name:'get_recovery_summary',arguments:{from:'2025-04-01',through:'2025-04-01',includeSensitive:true}}))).status).toBe(400)
    s.store.grant=vi.fn(async()=>{throw new Error('private database credential')})
    const response=await handler(req({action:'settings'}));expect(response.status).toBe(503);expect(await response.text()).not.toContain('credential')
  })
})
describe('WebMCP adapter',()=>{
  it('registers all tools with the same service, and unregisters on account/page teardown',async()=>{
    const registered=new Map<string,{execute:(input:unknown)=>Promise<unknown>}>(),host:SiteToolHost={registerTool:vi.fn(tool=>{registered.set(tool.name,tool)}),unregisterTool:vi.fn(name=>{registered.delete(name)})},invoke=vi.fn(async(name,input)=>({name,input}))
    const adapter=registerAthleteSiteTools(host,invoke);await adapter.ready;expect(registered.size).toBe(14)
    expect(await registered.get('get_athlete_profile')!.execute({})).toEqual({name:'get_athlete_profile',input:{}})
    const old=registered.get('propose_workout')!;await adapter.dispose();expect(registered.size).toBe(0)
    await expect(old.execute({})).rejects.toThrow('no longer active');expect(invoke).toHaveBeenCalledTimes(1)
  })
})
