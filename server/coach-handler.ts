import { CoachError, coachContext, permittedHistory, strictObject, validateSharing, validateCoachDate, type CoachConversation, type CoachSharing, type CoachTurn } from '../src/coach-domain'
import { prepareProposal, proposalCandidate, proposalTargets, type PreparedProposal } from '../src/coach-proposals'
import { fromRecords, type RecordMap } from '../src/sync-domain'
import type { CoachModel, ModelOutput } from './openai-responses'

export interface CoachLimits { hourly: number; daily: number; tokens: number; globalDaily: number; globalTokens: number }
export interface CoachStore {
  authenticate(token: string): Promise<string | null>
  records(token: string): Promise<RecordMap>
  list(token: string, owner: string, offset: number): Promise<CoachConversation[]>
  history(token: string, owner: string, id: string): Promise<CoachTurn[]>
  remove(token: string, owner: string, id: string): Promise<void>
  export(token: string, owner: string): Promise<unknown>
  begin(owner: string, request: string, conversation: string, isNew: boolean, question: string, sharing: CoachSharing, model: string, reservation: number, limits: CoachLimits): Promise<{ turn: CoachTurn; fresh: boolean }>
  finish(owner: string, request: string, output: ModelOutput | null, failure?: string, proposals?: PreparedProposal[]): Promise<void>
  proposals?(token: string, owner: string, conversation: string): Promise<PreparedProposal[]>
  proposal?(token: string, owner: string, proposal: string): Promise<PreparedProposal>
  decide?(token: string, proposal: string, accept: boolean, confirmed: boolean): Promise<{ status: string; alreadyDecided: boolean }>
}
export const defaultLimits: CoachLimits = { hourly: 6, daily: 20, tokens: 500000, globalDaily: 100, globalTokens: 3000000 }
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id = (value: unknown): string => { if (typeof value !== 'string' || !uuidPattern.test(value)) throw new CoachError(400, 'Choose a valid conversation.', 'invalid_request'); return value }
async function requestJSON(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json') || !request.body) throw new CoachError(400, 'Send a JSON coaching request.', 'invalid_request')
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12000) { await reader.cancel(); throw new CoachError(413, 'This request is too large. Shorten your question.', 'request_too_large') }; chunks.push(value) }
  const combined = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(combined)) } catch { throw new CoachError(400, 'The coaching request is not valid JSON.', 'invalid_request') }
}
export function createCoachHandler(store: CoachStore, model: CoachModel, origins: string[], limits = defaultLimits, clock = () => new Date().toISOString()) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin'), headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
    if (origin && origins.includes(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info'; headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS' }
    const send = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers })
    let reserved: { owner: string; request: string } | null = null
    try {
      if (origin && !origins.includes(origin)) throw new CoachError(403, 'This app address is not allowed by the coaching server.', 'origin_denied')
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') throw new CoachError(405, 'Use a POST coaching request.', 'invalid_method')
      const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
      const owner = token ? await store.authenticate(token) : null
      if (!owner || !token) throw new CoachError(401, 'Sign in again to use AI coaching. Local training remains available.', 'unauthenticated')
      const body = await requestJSON(request)
      if (!body || typeof body !== 'object') throw new CoachError(400, 'Invalid coaching request.', 'invalid_request')
      if (body.action === 'decide') {
        strictObject(body, ['action', 'proposalId', 'accept', 'confirmed', 'today'])
        const proposalId = id(body.proposalId)
        if (typeof body.accept !== 'boolean' || typeof body.confirmed !== 'boolean') throw new CoachError(400, 'Choose an explicit approval or rejection.', 'invalid_request')
        if (!store.proposal || !store.decide) throw new CoachError(503, 'Proposal approval is not configured.')
        const proposal = await store.proposal(token, owner, proposalId)
        if (body.accept && proposal.status === 'pending') {
          if (!body.confirmed) throw new CoachError(400, 'Review the changes and confirm approval before saving.', 'approval_required')
          validateCoachDate(body.today, clock())
          proposalCandidate(await store.records(token), proposal, body.today, clock())
        }
        return send(await store.decide(token, proposalId, body.accept, body.confirmed))
      }
      if (body.action === 'list') { strictObject(body, ['action', 'offset']); if (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 10000) throw new CoachError(400, 'Invalid history page.'); return send({ conversations: await store.list(token, owner, body.offset), limits: { hourly: limits.hourly, daily: limits.daily } }) }
      if (body.action === 'history' || body.action === 'delete') {
        strictObject(body, ['action', 'conversationId']); const conversation = id(body.conversationId)
        if (body.action === 'delete') { await store.remove(token, owner, conversation); return send({ deleted: true }) }
        return send({ turns: await store.history(token, owner, conversation), proposals: await store.proposals?.(token, owner, conversation) ?? [] })
      }
      if (body.action === 'export') { strictObject(body, ['action']); return send({ format: 'athlete-lab-coaching-history', version: 1, exportedAt: clock(), data: await store.export(token, owner) }) }
      if (!['chat', 'propose', 'preview'].includes(body.action)) throw new CoachError(400, 'Unsupported coaching action.', 'invalid_request')
      strictObject(body, body.action !== 'preview' ? ['action', 'requestId', 'conversationId', 'question', 'sharing', 'today'] : ['action', 'conversationId', 'sharing', 'today'])
      const sharing = validateSharing(body.sharing), conversation = body.conversationId === null ? null : id(body.conversationId)
      const history = conversation ? permittedHistory(await store.history(token, owner, conversation), sharing, clock()) : []
      const records = await store.records(token), data = fromRecords(records)
      const context = coachContext(data, sharing, body.today, clock())
      if (new TextEncoder().encode(JSON.stringify(context)).length > 24000) throw new CoachError(413, 'The selected context is too large. Choose fewer sections or a shorter reporting period.', 'context_too_large')
      if (body.action === 'preview') return send({ context, history, source: 'Current authenticated cloud records; unsynchronised local changes are not included.' })
      const requestId = id(body.requestId)
      if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1000) throw new CoachError(400, 'Enter a question of 1–1,000 characters.', 'invalid_question')
      if (body.action === 'propose' && !sharing.sections.some(s => s === 'programme' || s === 'schedule')) throw new CoachError(400, 'Include Programme or Upcoming schedule before requesting a training proposal.', 'missing_plan_context')
      const input = { context, history, question: body.question.trim(), ...(body.action === 'propose' ? { targets: { ...proposalTargets(data, body.today, sharing.upcomingDays, sharing.notes), dateWindow: context.reportingPeriod } } : {}) }
      await model.verify()
      // Byte count is a conservative token reservation, including a fixed envelope for
      // instructions/schema. No optimistic refunds after provider/network failures.
      const reservation = model.reservation(input)
      if (reservation > 100000) throw new CoachError(413, 'The selected coaching context is too large. Choose fewer sections or a shorter window.', 'context_too_large')
      const started = await store.begin(owner, requestId, conversation ?? requestId, !conversation, input.question, sharing, model.name, reservation, limits)
      if (!started.fresh) {
        if (started.turn.state === 'completed') return send({ turn: started.turn, proposals: await store.proposals?.(token, owner, started.turn.conversation_id) ?? [] })
        throw new CoachError(409, started.turn.state === 'running' ? 'This request is already running. Retry shortly with the same request.' : 'This attempt failed. Edit your question or start a new request.', 'request_exists')
      }
      reserved = { owner, request: requestId }
      const output = await model.generate(input)
      const proposals = body.action === 'propose' && output.proposal != null ? [prepareProposal(output.proposal, records, body.today, sharing.upcomingDays, sharing.notes, clock())] : []
      await store.finish(owner, requestId, output, undefined, proposals)
      reserved = null
      return send({ turn: { ...started.turn, state: 'completed', reply: output.reply }, proposals, shared: { sharing, generatedAt: context.exportedAt, source: 'Authenticated cloud records', historyTurns: history.length / 2 } })
    } catch (error) {
      if (reserved) await store.finish(reserved.owner, reserved.request, null, error instanceof CoachError ? error.code : 'service_error').catch(() => undefined)
      const known = error instanceof CoachError ? reserved && error.status === 400 ? new CoachError(502, 'The coach returned malformed structured data. No training records changed.', 'invalid_response') : error : new CoachError(503, 'Coaching could not finish. Your training records are unchanged. Check service setup and try again.', 'service_error')
      return send({ error: known.message, code: known.code }, known.status)
    }
  }
}
