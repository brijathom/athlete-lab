import { toolCatalog, type AthleteToolName } from './athlete-tools'
export interface SiteToolHost {
  registerTool(tool: { name:string;description:string;inputSchema:unknown;annotations:unknown;execute:(args:unknown)=>Promise<unknown> }): void | Promise<void>
  unregisterTool(name:string): void | Promise<void>
}
export function siteToolHost(): SiteToolHost | undefined {
  if(!isSecureContext) return undefined
  const host=(document as Document & {modelContext?:SiteToolHost}).modelContext ?? (navigator as Navigator & {modelContext?:SiteToolHost}).modelContext
  return typeof host?.registerTool==='function' && typeof host?.unregisterTool==='function' ? host : undefined
}
/** Protocol adapter only: all authentication, permission checks and writes stay in the shared service. */
export function registerAthleteSiteTools(host:SiteToolHost,invoke:(name:AthleteToolName,args:unknown)=>Promise<unknown>) {
  let active=true
  const registered:string[]=[]
  const ready=(async()=>{
    try {
      for(const tool of toolCatalog) {
        if(!active) break
        await host.registerTool({...tool,execute:async args=>{if(!active) throw new Error('This tool page is no longer active.');return invoke(tool.name,args)}})
        if(!active) { await host.unregisterTool(tool.name); break }
        registered.push(tool.name)
      }
    } catch(error) { for(const name of registered.splice(0)) await host.unregisterTool(name); throw error }
  })()
  return {ready,async dispose(){active=false;await ready.catch(()=>undefined);for(const name of registered.splice(0)) await host.unregisterTool(name)}}
}
