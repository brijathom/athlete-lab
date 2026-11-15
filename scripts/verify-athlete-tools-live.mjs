import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
// Dedicated test users only. No OpenAI endpoint/key, no real athlete notes/results.
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if(!url||!key)throw new Error('Public Supabase configuration is missing.')
const clients=['A','B'].map(()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}))
let tokenA,tokenB,ownerA,sessionId,originalGrant,seeded=[]
const invoke=async(token,body,expected=200)=>{
  const response=await fetch(`${url}/functions/v1/athlete-tools`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify(body)})
  const result=await response.json();if(response.status!==expected)throw new Error(`Tool verification expected ${expected}, received ${response.status}: ${result.error??'Unexpected response.'}`);return result
}
try{
  for(const [index,suffix] of ['A','B'].entries()){
    const result=await clients[index].auth.signInWithPassword({email:process.env[`ATHLETE_TEST_EMAIL_${suffix}`],password:process.env[`ATHLETE_TEST_PASSWORD_${suffix}`]})
    if(result.error)throw new Error(`Dedicated test-account ${suffix} sign-in failed.`)
    if(index===0){tokenA=result.data.session.access_token;ownerA=result.data.user.id}else tokenB=result.data.session.access_token
  }
  await invoke('invalid',{action:'settings'},401)
  originalGrant=(await invoke(tokenA,{action:'settings'})).grant
  const sharing={historyDays:14,upcomingDays:7,sections:['profile','programme','training','recovery','skills','testing','matches','schedule'],identity:false,symptoms:false,illness:false,recovery:false,notes:false}
  await invoke(tokenA,{action:'set_permissions',grant:{enabled:true,allowDrafts:true,sharing,expiresAt:new Date(Date.now()+3600000).toISOString()}})
  let exchange=await clients[0].rpc('athlete_sync',{changes:[]});if(exchange.error)throw new Error('Test snapshot read failed.')
  if(!exchange.data.records.some(r=>r.payload!==null)){
    const {build}=await import('esbuild'),built=await build({stdin:{contents:"export {createInitialData} from './src/domain.ts';export {toRecords} from './src/sync-domain.ts'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'})
    const {createInitialData,toRecords}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
    const data=createInitialData();data.programmes[0].name='Synthetic tool verification plans only'
    const previous=new Map(exchange.data.records.map(r=>[`${r.kind}:${r.id}`,r.revision]))
    seeded=Object.values(toRecords(data)).map(r=>({kind:r.kind,id:r.id,expected_revision:previous.get(`${r.kind}:${r.id}`)??0,payload:r.payload}))
    exchange=await clients[0].rpc('athlete_sync',{changes:seeded});if(exchange.error||!exchange.data.applied)throw new Error('Synthetic test plan setup failed.')
  }
  const today=new Date().toISOString().slice(0,10),idempotencyKey=randomUUID(),args={idempotencyKey,title:'Synthetic tool check',rationale:'Dedicated test account verification; proposed work only.',today,workout:{title:'Synthetic proposed tool session',date:today,category:'Skills',minutes:10,notes:'',exercises:[{id:null,name:'Synthetic controlled practice',sets:1,prescription:'Test prescription only',rest:'As needed',notes:'',skill:null}]}}
  const call=(name,arguments_)=>invoke(tokenA,{action:'call',name,arguments:arguments_})
  const context=await call('get_coaching_context',{recentFrom:today,recentThrough:today,upcomingFrom:today,upcomingThrough:today,categories:['profile','programme','training','schedule','recovery']})
  if(context.privacy.symptoms||context.privacy.illness||context.privacy.otherRecovery)throw new Error('Sensitive context was unexpectedly enabled.')
  const draft=await call('propose_workout',args),repeat=await call('propose_workout',args)
  if(draft.draftId!==repeat.draftId||draft.savedToTraining)throw new Error('Proposal idempotency or approval failed.')
  await invoke(tokenB,{action:'decide',draftId:draft.draftId,accept:true,confirmed:true},404)
  await invoke(tokenA,{action:'decide',draftId:draft.draftId,accept:true,confirmed:false},403)
  const check=await call('approve_and_save_workout',{draftId:draft.draftId});if(check.savedToTraining)throw new Error('Tool call manufactured approval.')
  const pending=(await invoke(tokenA,{action:'drafts'})).drafts.find(d=>d.id===draft.draftId);sessionId=pending.changes[0].id
  await invoke(tokenA,{action:'decide',draftId:draft.draftId,accept:true,confirmed:true})
  const again=await invoke(tokenA,{action:'decide',draftId:draft.draftId,accept:true,confirmed:true});if(!again.alreadyDecided)throw new Error('Duplicate approval was not prevented.')
  const detail=await call('get_workout_details',{id:sessionId});if(detail.completed!==null||detail.planned.revision!==1)throw new Error('Proposed session was confused with completed work.')
  const foreign=await clients[1].from('athlete_tool_drafts').select('id').eq('owner_id',ownerA);if(foreign.error||foreign.data.length)throw new Error('Draft isolation failed.')
  const mcp=await fetch(`${url}/functions/v1/athlete-tools/mcp`,{method:'POST',headers:{Authorization:`Bearer ${tokenA}`,'Content-Type':'application/json'},body:'{}'});if(mcp.status!==503)throw new Error('Remote MCP should remain disabled.')
  console.log('PASS: live auth, sensitive-data defaults, coaching context, idempotent staging, cross-account denial, explicit approval, duplicate protection, workout details and disabled remote MCP. No AI calls or completed workouts created.')
}finally{
  if(tokenA){
    try{
      const read=await clients[0].rpc('athlete_sync',{changes:[]})
      const targets=new Set(seeded.map(r=>`${r.kind}:${r.id}`));if(sessionId)targets.add(`session:${sessionId}`)
      const changes=(read.data?.records??[]).filter(r=>r.payload!==null&&targets.has(`${r.kind}:${r.id}`)).map(r=>({kind:r.kind,id:r.id,expected_revision:r.revision,payload:null}))
      if(changes.length){const result=await clients[0].rpc('athlete_sync',{changes});if(result.error||!result.data?.applied)throw new Error('Test-plan cleanup requires review.')}
      if(originalGrant)await invoke(tokenA,{action:'set_permissions',grant:originalGrant.enabled&&Date.parse(originalGrant.expiresAt)>Date.now()?originalGrant:{...originalGrant,enabled:false,allowDrafts:false}})
    }catch{console.error('Test cleanup needs review; only dedicated test-account records were touched.');process.exitCode=1}
  }
  for(const client of clients)await client.auth.signOut()
}
