import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CoachError, type CoachConversation, type CoachTurn } from '../src/coach-domain'
import { checkedExchange } from '../src/cloud-sync'
import type { CoachStore } from './coach-handler'
import type { PreparedProposal } from '../src/coach-proposals'

const turnColumns = 'request_id,conversation_id,question,sharing,reply,state,model,created_at'
const conversationColumns = 'id,title,created_at'
function check(error: { message: string } | null) {
  if (!error) return
  const map: [string, number, string][] = [
    ['USAGE_LIMIT', 429, 'Coaching usage limits have been reached. Try later.'], ['NOT_FOUND', 404, 'This conversation is unavailable.'],
    ['REQUEST_RUNNING', 409, 'Another question is still running in this conversation.'], ['CONVERSATION_FULL', 409, 'This conversation is full. Start a new conversation.'],
    ['REQUEST_REUSED', 409, 'This request identifier has already been used. Start a new request.'],
    ['STALE_PROPOSAL', 409, 'This proposal is stale. Request a new proposal; nothing was applied.'], ['HISTORY_PROTECTED', 409, 'This session has been completed. Historical training cannot be changed by the coach.'], ['APPROVAL_REQUIRED', 400, 'Explicit confirmation is required before approval.'],
  ]
  for (const [code, status, message] of map) if (error.message.includes(code)) throw new CoachError(status, message, code.toLowerCase())
  throw new CoachError(503, 'Coaching storage is unavailable. Check that the coaching migrations have been applied.', 'storage_unavailable')
}
export function supabaseCoachStore(url: string, publicKey: string, serviceKey: string): CoachStore {
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const userClient = (token: string) => createClient(url, publicKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } })
  const admin = createClient(url, serviceKey, options)
  const history = async (client: SupabaseClient, owner: string, conversation: string) => {
    const exists = await client.from('coach_conversations').select('id').eq('owner_id', owner).eq('id', conversation).maybeSingle(); check(exists.error)
    if (!exists.data) throw new CoachError(404, 'This conversation is unavailable.', 'not_found')
    const result = await client.from('coach_turns').select(turnColumns).eq('owner_id', owner).eq('conversation_id', conversation).order('created_at').order('request_id').limit(100); check(result.error)
    return result.data as CoachTurn[]
  }
  const proposalRows = async (client: SupabaseClient, owner: string, conversation?: string, id?: string) => {
    let query = client.from('coach_proposals').select('payload,status').eq('owner_id', owner)
    if (conversation) query = query.eq('conversation_id', conversation)
    if (id) query = query.eq('id', id)
    const result = await query.order('created_at').limit(100); check(result.error)
    return (result.data ?? []).map(row => ({ ...row.payload, status: row.status })) as PreparedProposal[]
  }
  return {
    async authenticate(token) { const { data, error } = await userClient(token).auth.getUser(token); return error ? null : data.user?.id ?? null },
    async records(token) { const { data, error } = await userClient(token).rpc('athlete_sync', { changes: [] }); check(error); return checkedExchange(data).records },
    async list(token, owner, offset) { const result = await userClient(token).from('coach_conversations').select(conversationColumns).eq('owner_id', owner).order('created_at', { ascending: false }).order('id').range(offset, offset + 49); check(result.error); return result.data as CoachConversation[] },
    async history(token, owner, conversation) { return history(userClient(token), owner, conversation) },
    async remove(token, owner, conversation) { const result = await userClient(token).from('coach_conversations').delete().eq('owner_id', owner).eq('id', conversation); check(result.error) },
    async export(token, owner) {
      const client = userClient(token), conversations: unknown[] = [], turns: unknown[] = []
      for (const [table, columns, rows] of [['coach_conversations', conversationColumns, conversations], ['coach_turns', turnColumns, turns]] as const) {
        for (let offset = 0; ; offset += 500) { const result = await client.from(table).select(columns).eq('owner_id', owner).order('created_at').range(offset, offset + 499); check(result.error); rows.push(...(result.data ?? [])); if ((result.data?.length ?? 0) < 500) break }
      }
      const proposals: unknown[] = []
      for (let offset = 0; ; offset += 500) { const result = await client.from('coach_proposals').select('payload,status').eq('owner_id', owner).order('created_at').range(offset, offset + 499); check(result.error); proposals.push(...(result.data ?? [])); if ((result.data?.length ?? 0) < 500) break }
      return { conversations, turns, proposals }
    },
    async begin(owner, request, conversation, isNew, question, sharing, model, reservation, limits) {
      const { data, error } = await admin.rpc('coach_begin', { actor: owner, request, conversation, create_conversation: isNew, question_text: question, share_options: sharing, model_name: model, reservation, limits }); check(error)
      return data as { turn: CoachTurn; fresh: boolean }
    },
    async finish(owner, request, output, failure, proposals = []) { const { error } = await admin.rpc('coach_finish', { actor: owner, request, answer: output?.reply ?? null, input_count: output?.inputTokens ?? 0, output_count: output?.outputTokens ?? 0, failure: failure ?? null, proposal_list: proposals }); check(error) },
    async proposals(token, owner, conversation) { return proposalRows(userClient(token), owner, conversation) },
    async proposal(token, owner, id) { const rows = await proposalRows(userClient(token), owner, undefined, id); if (!rows.length) throw new CoachError(404, 'This proposal is unavailable.', 'not_found'); return rows[0] },
    async decide(token, proposal, accept, confirmed) { const { data, error } = await userClient(token).rpc('coach_decide', { proposal, accept, confirmed }); check(error); return data },
  }
}
