import { addDays, validDate, type AppData } from './domain'
import { contextSections, defaultContextOptions, generateCoachingContext, type ContextSection } from './coaching-context'

export class CoachError extends Error { constructor(public status: number, message: string, public code = 'coach_error') { super(message) } }
export interface CoachSharing {
  historyDays: number; upcomingDays: number; sections: ContextSection[]
  identity: boolean; symptoms: boolean; illness: boolean; recovery: boolean; notes: boolean
}
export interface CoachReply { answer: string; facts: string[]; interpretations: string[]; unknowns: string[] }
export interface CoachTurn { request_id: string; conversation_id: string; question: string; sharing: CoachSharing; reply: CoachReply | null; state: 'running' | 'completed' | 'failed'; model: string; created_at: string }
export interface CoachConversation { id: string; title: string; created_at: string }
export const defaultSharing = (): CoachSharing => ({ historyDays: 14, upcomingDays: 7, sections: Object.keys(contextSections) as ContextSection[], identity: false, symptoms: false, illness: false, recovery: false, notes: false })
export function strictObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) throw new CoachError(400, 'The request contains missing or unsupported fields.', 'invalid_request')
  return value as Record<string, unknown>
}
export function validateSharing(value: unknown): CoachSharing {
  const v = strictObject(value, ['historyDays', 'upcomingDays', 'sections', 'identity', 'symptoms', 'illness', 'recovery', 'notes'])
  if (![7, 14, 28, 90].includes(v.historyDays as number) || ![7, 14, 28].includes(v.upcomingDays as number) || !Array.isArray(v.sections) || !v.sections.length || v.sections.length > 8 || new Set(v.sections).size !== v.sections.length || v.sections.some(k => typeof k !== 'string' || !Object.hasOwn(contextSections, k)) || ['identity', 'symptoms', 'illness', 'recovery', 'notes'].some(k => typeof v[k] !== 'boolean')) throw new CoachError(400, 'Choose valid date windows, sections and data-sharing settings.', 'invalid_sharing')
  return structuredClone(v) as unknown as CoachSharing
}
export function coachContext(data: AppData, sharing: CoachSharing, today: string, now: string) {
  validateCoachDate(today, now)
  const options = { ...defaultContextOptions('detailed', today), historyStart: addDays(today, 1 - sharing.historyDays), upcomingEnd: addDays(today, sharing.upcomingDays - 1), sections: sharing.sections, includeIdentity: sharing.identity, includeSymptoms: sharing.symptoms, includeIllness: sharing.illness, includeRecovery: sharing.recovery, includeNotes: sharing.notes }
  return generateCoachingContext(data, options, now)
}
export function validateCoachDate(today: string, now: string) { if (!validDate(today) || Math.abs(Date.parse(`${today}T12:00:00Z`) - Date.parse(now)) > 36 * 3600000) throw new CoachError(400, 'Your device date is incorrect. Check it before using coaching.', 'invalid_date') }
export function parseReply(value: unknown): CoachReply {
  const v = strictObject(value, ['answer', 'facts', 'interpretations', 'unknowns'])
  if (typeof v.answer !== 'string' || !v.answer.trim() || v.answer.length > 16000 || ['facts', 'interpretations', 'unknowns'].some(k => !Array.isArray(v[k]) || (v[k] as unknown[]).length > 20 || (v[k] as unknown[]).some(item => typeof item !== 'string' || item.length > 2000))) throw new CoachError(502, 'The coach returned an invalid response. No training records have changed.', 'invalid_response')
  return v as unknown as CoachReply
}
export const schemaObject = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export const replySchema = schemaObject({ answer: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } }, interpretations: { type: 'array', items: { type: 'string' } }, unknowns: { type: 'array', items: { type: 'string' } } })
/** Only replay turns with the SAME privacy scope. Narrowing sharing never replays old health details. */
export function permittedHistory(turns: CoachTurn[], sharing: CoachSharing, now = new Date().toISOString()) {
  const fingerprint = (scope: CoachSharing) => JSON.stringify({ ...scope, sections: [...scope.sections].sort() })
  const cutoff = Date.parse(now) - sharing.historyDays * 86400000
  const eligible = turns.filter(t => t.state === 'completed' && t.reply && Date.parse(t.created_at) >= cutoff && Date.parse(t.created_at) <= Date.parse(now) && fingerprint(t.sharing) === fingerprint(sharing)).slice(-6)
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  let bytes = 0
  for (const turn of eligible.reverse()) {
    const pair = [{ role: 'user' as const, content: `Previous question (${turn.created_at}): ${turn.question}` }, { role: 'assistant' as const, content: `Previous answer (${turn.created_at}; historical, not a new observation): ${JSON.stringify(turn.reply)}` }]
    const size = new TextEncoder().encode(JSON.stringify(pair)).length
    if (bytes + size > 8000) break
    history.unshift(...pair); bytes += size
  }
  return history
}
