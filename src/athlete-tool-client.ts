import { supabase } from './supabase'
import { CoachError } from './coach-domain'
export async function athleteToolRequest<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new CoachError(503,'Connect your Supabase account to use tools. Local training remains available.')
  if (!navigator.onLine) throw new CoachError(503,'Tools require connectivity. Training and logging remain available offline.')
  const result=await supabase.functions.invoke('athlete-tools',{body:body as Record<string,unknown>,signal:signal ?? AbortSignal.timeout(30000)})
  if(signal?.aborted) throw new DOMException('Tool page closed.','AbortError')
  if(result.error) {
    if('context' in result.error && result.error.context instanceof Response) {
      let problem: {error?:string;code?:string}={}
      try { problem=await result.error.context.json() } catch { /* Use safe connection error below. */ }
      if(problem.error) throw new CoachError(result.error.context.status,problem.error,problem.code)
    }
    throw new CoachError(503,'Athlete tools could not connect. Check deployment and try again. Training records are unchanged.')
  }
  return result.data as T
}
