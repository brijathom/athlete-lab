import { createClient } from '@supabase/supabase-js'
import { IntegrationError, validateSharing } from '../src/integration-domain'
import { disabledToolGrant, type ToolDraft, type ToolGrant, type ToolPrincipal, type ToolStore } from '../src/athlete-tools'
import { checkedExchange } from '../src/cloud-sync'
import { parseRemote } from '../src/sync-domain'

function check(error: { message: string } | null) {
  if (!error) return
  const errors: [string, number, string][] = [['NOT_FOUND',404,'This draft is unavailable.'], ['REQUEST_REUSED',409,'This idempotency key was already used with different input.'], ['STALE_DRAFT',409,'Records changed or this draft expired. Create a fresh draft.'], ['HISTORY_PROTECTED',409,'A completion log already exists. Historical records cannot be replaced.'], ['APPROVAL_REQUIRED',403,'The athlete must explicitly approve inside Athlete Lab.'], ['AUTH_REQUIRED',403,'Use the signed-in Athlete Lab approval interface.'], ['PERMISSION_REQUIRED',403,'Enable or renew tool permissions in Athlete Lab.'], ['TOOL_LIMIT',429,'The daily draft limit has been reached.']]
  for (const [code, status, message] of errors) if (error.message.includes(code)) throw new IntegrationError(status,message,code.toLowerCase())
  throw new IntegrationError(503,'Athlete tools storage is unavailable. Check migrations and try again.','storage_unavailable')
}
export function athleteToolStore(url: string, key: string, serviceKey: string) {
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const client = (token: string) => createClient(url,key,{ ...options, global: { headers: { Authorization: `Bearer ${token}` } } })
  const admin = createClient(url,serviceKey,options)
  const draftValue = (row: { payload: ToolDraft; status: ToolDraft['status'] }): ToolDraft => ({ ...row.payload, status: row.status })
  const readGrant = async (token: string, actor: ToolPrincipal): Promise<ToolGrant> => {
    const result = await (actor.clientId ? admin : client(token)).from('athlete_tool_grants').select('enabled,allow_drafts,sharing,expires_at').eq('owner_id',actor.owner).maybeSingle(); check(result.error)
    return result.data ? { enabled: result.data.enabled, allowDrafts: result.data.allow_drafts, sharing: validateSharing(result.data.sharing), expiresAt: result.data.expires_at } : disabledToolGrant()
  }
  const store: ToolStore = {
    async authenticate(token) {
      const user = client(token), verified = await user.auth.getUser(token)
      if (verified.error || !verified.data.user) return null
      const claims = await user.auth.getClaims(token)
      if (claims.error || !claims.data?.claims || claims.data.claims.sub !== verified.data.user.id) return null
      return { owner: verified.data.user.id, clientId: typeof claims.data.claims.client_id === 'string' ? claims.data.claims.client_id : null }
    },
    grant: readGrant,
    async records(token, actor) {
      if (actor.clientId) { const result = await admin.rpc('athlete_tool_snapshot',{ actor: actor.owner }); check(result.error); return parseRemote(result.data) }
      const result = await client(token).rpc('athlete_sync',{ changes: [] }); check(result.error); return checkedExchange(result.data).records
    },
    async prior(actor,key,fingerprint) {
      const result = await admin.from('athlete_tool_drafts').select('payload,status,fingerprint').eq('owner_id',actor.owner).eq('idempotency_key',key).maybeSingle(); check(result.error)
      if (!result.data) return null
      if (result.data.fingerprint !== fingerprint) throw new IntegrationError(409,'This idempotency key was already used with different input.','request_reused')
      return draftValue(result.data)
    },
    async stage(actor,key,fingerprint,draft) { const result = await admin.rpc('athlete_tool_stage',{ actor: actor.owner, request_key: key, request_fingerprint: fingerprint, draft }); check(result.error); return result.data as ToolDraft },
    async draft(token,actor,id) { const result = await (actor.clientId ? admin : client(token)).from('athlete_tool_drafts').select('payload,status').eq('owner_id',actor.owner).eq('id',id).maybeSingle(); check(result.error); if (!result.data) throw new IntegrationError(404,'This draft is unavailable.'); return draftValue(result.data) },
  }
  return {
    ...store,
    async claims(token: string) { const result = await client(token).auth.getClaims(token); return result.error ? null : result.data?.claims },
    async settings(token: string, grant: ToolGrant) { const result = await client(token).rpc('athlete_tool_permissions',{ enabled: grant.enabled, allow_drafts: grant.allowDrafts, sharing: grant.sharing, expires_at: grant.expiresAt }); check(result.error) },
    async list(token: string,actor: ToolPrincipal) { const result = await client(token).from('athlete_tool_drafts').select('payload,status').eq('owner_id',actor.owner).order('created_at',{ ascending:false }).limit(100); check(result.error); return (result.data ?? []).map(draftValue) },
    async audit(token: string,actor: ToolPrincipal) { const result = await client(token).from('athlete_tool_audit').select('draft_id,event,operation,created_at').eq('owner_id',actor.owner).order('created_at',{ ascending:false }).limit(100); check(result.error); return result.data ?? [] },
    async decide(token: string,id: string,accept: boolean,confirmed: boolean) { const result = await client(token).rpc('athlete_tool_decide',{ draft_id: id, accept, confirmed }); check(result.error); return result.data },
  }
}
