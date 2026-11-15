import { athleteToolStore } from './athlete-tool-store'
import { createAthleteToolHandler } from './athlete-tool-handler'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler:(request:Request)=>Promise<Response>):void }
const env=(name:string)=>Deno.env.get(name) ?? ''
const url=env('SUPABASE_URL'), resource=`${url}/functions/v1/athlete-tools/mcp`
Deno.serve(createAthleteToolHandler(athleteToolStore(url,env('SUPABASE_ANON_KEY'),env('SUPABASE_SERVICE_ROLE_KEY')),{
  origins:(env('ATHLETE_TOOL_ORIGINS') || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s=>s.trim()),
  appOrigin:env('ATHLETE_APP_ORIGIN') || 'http://localhost:5173',resource,authorizationServer:`${url}/auth/v1`,
  remoteEnabled:env('ATHLETE_MCP_ENABLED')==='true',clientIds:env('ATHLETE_MCP_CLIENT_IDS').split(',').map(s=>s.trim()).filter(Boolean),
}))
