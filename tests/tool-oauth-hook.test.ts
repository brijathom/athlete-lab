import { it,expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
it('optional OAuth hook adds a resource audience only for approved clients and cannot be called by browser roles',async()=>{
  const db=new PGlite()
  try{
    await db.exec('create role anon;create role authenticated;create role supabase_auth_admin;')
    await db.exec(readFileSync('supabase/optional/athlete_tool_oauth.sql','utf8'))
    const id='11111111-1111-4111-8111-111111111111',resource='https://example.supabase.co/functions/v1/athlete-tools/mcp'
    await db.query('insert into public.athlete_tool_oauth_clients values($1,$2)',[id,resource])
    await db.exec('set role supabase_auth_admin')
    const invoke=async(event:unknown)=>(await db.query<{v:unknown}>('select public.athlete_tool_access_token_hook($1) as v',[JSON.stringify(event)])).rows[0].v
    const normal={claims:{sub:id,aud:'authenticated'}}
    expect(await invoke(normal)).toEqual(normal)
    const unknown={claims:{sub:id,aud:'authenticated',client_id:'unapproved'}}
    expect(await invoke(unknown)).toEqual(unknown)
    expect(await invoke({claims:{...normal.claims,client_id:id}})).toEqual({claims:{sub:id,aud:['authenticated',resource],client_id:id}})
    await db.exec('reset role;set role authenticated')
    await expect(invoke(normal)).rejects.toThrow('permission denied')
    await expect(db.query('select * from public.athlete_tool_oauth_clients')).rejects.toThrow('permission denied')
  }finally{await db.close()}
},60000)
