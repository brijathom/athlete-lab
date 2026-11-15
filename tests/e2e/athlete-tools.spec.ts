import {navigate} from './navigation'
import { test,expect } from '@playwright/test'
import { createInitialData,dateKey,uid } from '../../src/domain'
import { toRecords } from '../../src/sync-domain'
import { prepareProposal } from '../../src/programme-proposals'
import { defaultSharing } from '../../src/integration-domain'
import type { ToolDraft,ToolGrant } from '../../src/athlete-tools'
test.use({serviceWorkers:'block'})
const owner='11111111-1111-4111-8111-111111111111',cloud='https://athlete-lab-test.supabase.co'
test('a signed-in new browser can save permissions before cloud setup, with an actionable next step',async({page,context})=>{
  let saves=0,syncs=0
  await context.route(`${cloud}/**`,async route=>{
    const body=route.request().postDataJSON(),path=new URL(route.request().url()).pathname
    if(path==='/rest/v1/rpc/athlete_sync'){syncs++;return route.fulfill({status:400,json:{message:'Cloud setup must remain explicit'}})}
    if(path!=='/functions/v1/athlete-tools')return route.fulfill({status:400,json:{message:'Unexpected test request'}})
    if(body.action==='settings')return route.fulfill({json:{grant:{enabled:false,allowDrafts:false,sharing:defaultSharing(),expiresAt:new Date(0).toISOString()},remoteMcpEnabled:false,mcpUrl:''}})
    if(body.action==='drafts')return route.fulfill({json:{drafts:[],audit:[]}})
    if(body.action==='set_permissions'){
      saves++;expect(body.grant.enabled).toBe(true);expect(body.grant.sharing.symptoms).toBe(false)
      if(saves===1)return route.fulfill({status:503,json:{error:'Temporary connection failure. Try again.'}})
      return route.fulfill({json:{grant:body.grant}})
    }
    return route.fulfill({status:400,json:{error:'Unexpected operation'}})
  })
  await page.goto('/connection-check.html')
  await page.evaluate(({owner})=>{
    localStorage.setItem('sb-athlete-lab-test-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:owner,email:'synthetic@example.test',aud:'authenticated',app_metadata:{},user_metadata:{}}}))
  },{owner})
  await page.goto('/')
  const nav=page.getByRole('navigation',{name:test.info().project.name.startsWith('iPhone')?'Skills and recovery':'Main navigation',exact:true})
  await navigate(page,'ChatGPT Tools')
  await expect(page.getByText('Tool access disabled or expired.',{exact:true})).toBeVisible()
  await expect(page.getByText('You can save tool permissions now.',{exact:false})).toBeVisible()
  const save=page.getByRole('button',{name:'Save tool permissions',exact:true})
  await expect(save).toBeDisabled()
  await page.getByLabel('I approve sharing these selected records with the connected coaching tools for 24 hours.',{exact:true}).check()
  await expect(save).toBeEnabled();await save.click()
  await expect(page.getByRole('alert')).toHaveText('Temporary connection failure. Try again.')
  await expect(page.getByText('Tool access disabled or expired.',{exact:true})).toBeVisible()
  await save.click()
  await expect(page.getByText('Tool permissions saved for 24 hours. You can revoke access at any time.',{exact:true})).toBeVisible()
  await expect(page.getByText(/^Access enabled until /)).toBeVisible()
  expect(saves).toBe(2);expect(syncs).toBe(0)
  await expect(page.getByText('Site tools registered in this browser. Keep this page open while coaching.',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Open account settings',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Choose how to connect this device',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Open cloud records',exact:true})).toBeDisabled()
})

test('site tools, explicit permissions, validated import, approval and revocation share one protected workflow',async({page,context})=>{
  const fixture=createInitialData(),base=toRecords(fixture);Object.values(base).forEach(r=>r.revision=1)
  let grant:ToolGrant={enabled:false,allowDrafts:false,sharing:defaultSharing(),expiresAt:new Date(0).toISOString()},draft:ToolDraft|null=null,decisions=0,reads=0
  const raw={title:'Reviewed optional session',rationale:'Synthetic proposal only.',actions:[{operation:'add',targetId:null,session:{title:'Test approved ball work',date:dateKey(),category:'Skills',minutes:15,notes:'',exercises:[{id:null,name:'Controlled practice',sets:1,prescription:'Technique only',rest:'As needed',notes:'',skill:null}]}}]}
  await context.route(`${cloud}/**`,async route=>{
    const req=route.request(),body=req.postDataJSON(),path=new URL(req.url()).pathname
    if(path==='/rest/v1/rpc/athlete_sync')return route.fulfill({json:{schemaVersion:1,applied:true,records:Object.values(base)}})
    if(path!=='/functions/v1/athlete-tools')return route.fulfill({status:400,json:{message:'Unexpected test request'}})
    if(body.action==='settings')return route.fulfill({json:{grant,remoteMcpEnabled:false,mcpUrl:`${cloud}/functions/v1/athlete-tools/mcp`}})
    if(body.action==='set_permissions'){grant=body.grant;return route.fulfill({json:{grant}})}
    if(body.action==='drafts')return route.fulfill({json:{drafts:draft?[draft]:[],audit:[]}})
    if(body.action==='call'){
      expect(grant.enabled).toBe(true)
      if(body.name==='get_coaching_context'){reads++;return route.fulfill({json:{source:'Authenticated Athlete Lab records',sections:[],missingInformation:['No completed workouts']}})}
      expect(body.name).toBe('propose_workout');expect(body.arguments).not.toHaveProperty('approved')
      const proposal=prepareProposal(raw,base,dateKey(),7,false,new Date().toISOString())
      draft={id:proposal.id,operation:'workout',status:'pending',title:proposal.title,rationale:proposal.rationale,expiresAt:proposal.expiresAt,proposal,log:null,guards:[],changes:proposal.changes.map(c=>({kind:'session',id:c.id,expected_revision:c.expectedRevision,payload:c.after}))}
      return route.fulfill({json:{draftId:draft.id,status:'pending',savedToTraining:false}})
    }
    if(body.action==='decide'){
      expect(body.confirmed).toBe(true);expect(body.accept).toBe(true);decisions++;draft!.status='approved'
      for(const change of draft!.changes)base[`${change.kind}:${change.id}`]={kind:change.kind,id:change.id,revision:1,payload:change.payload}
      return route.fulfill({json:{status:'approved',alreadyDecided:false}})
    }
    return route.fulfill({status:400,json:{error:'Unexpected operation'}})
  })
  await page.addInitScript(()=>{
    const tools:Record<string,{execute:(args:unknown)=>Promise<unknown>}>={}
    Object.assign(window,{testSiteTools:tools})
    Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:(tool:{name:string;execute:(args:unknown)=>Promise<unknown>})=>{tools[tool.name]=tool},unregisterTool:(name:string)=>{delete tools[name]}}})
  })
  await page.goto('/connection-check.html')
  await page.evaluate(async({fixture,base,owner})=>{
    localStorage.setItem('sb-athlete-lab-test-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:owner,email:'synthetic@example.test',aud:'authenticated',app_metadata:{},user_metadata:{}}}))
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('athlete-lab',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite'),store=tx.objectStore('state');store.put(fixture,'app');store.put(fixture,`account:${owner}`);store.put({version:1,owner,base,pending:[],lastSynced:new Date().toISOString()},`sync:${owner}`);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})
  },{fixture,base,owner})
  await page.goto('/')
  const nav=page.getByRole('navigation',{name:test.info().project.name.startsWith('iPhone')?'Skills and recovery':'Main navigation',exact:true})
  await navigate(page,'ChatGPT Tools')
  await expect(page.getByRole('heading',{name:'ChatGPT Tools',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Save tool permissions',exact:true})).toBeDisabled()
  await page.getByLabel('Allow draft proposals and completion drafts (each requires separate approval)',{exact:true}).check()
  await page.getByLabel('I approve sharing these selected records with the connected coaching tools for 24 hours.',{exact:true}).check()
  await page.getByRole('button',{name:'Save tool permissions',exact:true}).click()
  await expect(page.getByText('Site tools registered in this browser. Keep this page open while coaching.',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>Object.keys((window as unknown as {testSiteTools:Record<string,unknown>}).testSiteTools).length)).toBe(2)
  await page.evaluate(async()=>{const tools=(window as unknown as {testSiteTools:Record<string,{execute:(args:unknown)=>Promise<unknown>}>}).testSiteTools;await tools.get_coaching_context.execute({recentFrom:'2025-01-01',recentThrough:'2025-01-01',upcomingFrom:'2025-01-01',upcomingThrough:'2025-01-01',categories:['training']})})
  expect(reads).toBe(1);expect(grant.sharing.symptoms).toBe(false)
  await page.getByLabel('Workout draft JSON',{exact:true}).fill(JSON.stringify({tool:'propose_workout',arguments:{idempotencyKey:uid(),title:raw.title,rationale:raw.rationale,today:dateKey(),workout:raw.actions[0].session}}))
  await page.getByRole('button',{name:'Validate and preview draft',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Reviewed optional session',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Approve and save changes',exact:true})).toBeDisabled();expect(decisions).toBe(0)
  await page.getByLabel('I reviewed these changes and approve saving them to my training plan.',{exact:true}).check()
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'Approve and save changes',exact:true}).click()
  await expect(page.getByText('Approved changes saved and synchronised.',{exact:true})).toBeVisible();expect(decisions).toBe(1)
  await page.getByRole('button',{name:'Revoke tool access',exact:true}).click()
  await expect(page.getByText('Tool access revoked.',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>Object.keys((window as unknown as {testSiteTools:Record<string,unknown>}).testSiteTools).length)).toBe(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
