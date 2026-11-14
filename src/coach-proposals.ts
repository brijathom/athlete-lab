import { CoachError, schemaObject, strictObject } from './coach-domain'
import { addDays, uid, validateSession, type AppData, type Session } from './domain'
import { validateBackupData } from './backup'
import { fromRecords, same, type RecordMap } from './sync-domain'
import { feet, pressures, skillAreas, type SkillDrill } from './skills-domain'

export interface SessionDraft { title: string; date: string; category: Session['category']; minutes: number; notes: string; exercises: { id: string | null; name: string; sets: number; prescription: string; rest: string; notes: string; skill: SkillDrill | null }[] }
export interface RawProposal { title: string; rationale: string; actions: { operation: 'add' | 'update' | 'delete'; targetId: string | null; session: SessionDraft | null }[] }
export interface SessionChange { id: string; expectedRevision: number; before: Session | null; after: Session | null }
export interface PreparedProposal { id: string; version: 1; title: string; rationale: string; expiresAt: string; programmeId: string; programmeRevision: number; preferencesRevision: number; changes: SessionChange[]; status: 'pending' | 'approved' | 'rejected' }
export function readProposal(value: unknown): PreparedProposal {
  try {
    const p = strictObject(value, ['id', 'version', 'title', 'rationale', 'expiresAt', 'programmeId', 'programmeRevision', 'preferencesRevision', 'changes', 'status'])
    if (p.version !== 1 || typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.rationale !== 'string' || typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt)) || typeof p.programmeId !== 'string' || !Number.isSafeInteger(p.programmeRevision) || !Number.isSafeInteger(p.preferencesRevision) || !['pending', 'approved', 'rejected'].includes(p.status as string) || !Array.isArray(p.changes) || !p.changes.length || p.changes.length > 8) throw new Error('Invalid proposal')
    for (const change of p.changes) {
      const c = strictObject(change, ['id', 'expectedRevision', 'before', 'after'])
      if (typeof c.id !== 'string' || !Number.isSafeInteger(c.expectedRevision) || (c.expectedRevision as number) < 0 || (c.before === null && c.after === null)) throw new Error('Invalid change')
      for (const candidate of [c.before, c.after]) if (candidate !== null) {
        const s = strictObject(candidate, ['id', 'programmeId', 'title', 'date', 'category', 'minutes', 'notes', 'exercises', 'proposed']) as unknown as Session
        if (s.id !== c.id || typeof s.programmeId !== 'string' || typeof s.notes !== 'string' || typeof s.proposed !== 'boolean' || validateSession(s) || s.exercises.some(e => typeof e.id !== 'string' || typeof e.rest !== 'string' || typeof e.notes !== 'string')) throw new Error('Invalid session')
      }
    }
    return p as unknown as PreparedProposal
  } catch { throw new CoachError(502, 'A saved proposal is malformed and cannot be displayed or approved.', 'invalid_proposal') }
}
const string = { type: 'string' }, nullableString = { anyOf: [string, { type: 'null' }] }
const skillSchema = schemaObject({ area: { type: 'string', enum: skillAreas }, objective: string, successCriteria: string, foot: { type: 'string', enum: feet }, distance: { anyOf: [{ type: 'number' }, { type: 'null' }] }, angle: string, pressure: { type: 'string', enum: pressures } })
export const proposalSchema = schemaObject({ title: string, rationale: string, actions: { type: 'array', items: schemaObject({ operation: { type: 'string', enum: ['add', 'update', 'delete'] }, targetId: nullableString, session: { anyOf: [schemaObject({ title: string, date: string, category: { type: 'string', enum: ['Strength', 'Conditioning', 'Speed', 'Recovery', 'Skills'] }, minutes: { type: 'integer' }, notes: string, exercises: { type: 'array', items: schemaObject({ id: nullableString, name: string, sets: { type: 'integer' }, prescription: string, rest: string, notes: string, skill: { anyOf: [skillSchema, { type: 'null' }] } }) } }), { type: 'null' }] } }) } })
export function proposalTargets(data: AppData, today: string, days: number, notes: boolean) {
  return { activeProgrammeId: data.activeProgrammeId, eligibleSessions: data.sessions.filter(s => s.programmeId === data.activeProgrammeId && s.date >= today && s.date <= addDays(today, days - 1) && !data.logs.some(l => l.sessionId === s.id)).map(s => ({ ...s, notes: notes ? s.notes : '', exercises: s.exercises.map(e => ({ ...e, notes: notes ? e.notes : '' })) })) }
}
export function prepareProposal(raw: unknown, records: RecordMap, today: string, days: number, notes: boolean, now: string): PreparedProposal {
  const p = strictObject(raw, ['title', 'rationale', 'actions'])
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100 || typeof p.rationale !== 'string' || !p.rationale.trim() || p.rationale.length > 2000 || !Array.isArray(p.actions) || !p.actions.length || p.actions.length > 8) throw new CoachError(502, 'The proposed training plan is invalid. Nothing has changed.', 'invalid_proposal')
  const data = fromRecords(records), eligible = new Set(proposalTargets(data, today, days, notes).eligibleSessions.map(s => s.id)), used = new Set<string>()
  const changes: SessionChange[] = p.actions.map(value => {
    const a = strictObject(value, ['operation', 'targetId', 'session'])
    if (!['add', 'update', 'delete'].includes(a.operation as string) || (a.operation === 'add' ? a.targetId !== null : typeof a.targetId !== 'string' || !eligible.has(a.targetId))) throw new CoachError(502, 'A proposal targeted an unavailable, historical or completed session.', 'invalid_proposal')
    const id = a.operation === 'add' ? uid() : a.targetId as string
    if (used.has(id)) throw new CoachError(502, 'A proposal changes the same session more than once.', 'invalid_proposal')
    used.add(id)
    const before = a.operation === 'add' ? null : data.sessions.find(s => s.id === id)!
    let after: Session | null = null
    if (a.operation === 'delete') { if (a.session !== null) throw new CoachError(502, 'A deleted session must not contain a replacement.', 'invalid_proposal') }
    else {
      const s = strictObject(a.session, ['title', 'date', 'category', 'minutes', 'notes', 'exercises'])
      if (!Array.isArray(s.exercises) || !s.exercises.length || s.exercises.length > 30) throw new CoachError(502, 'The proposed exercise list is invalid.', 'invalid_proposal')
      const exercises = s.exercises.map(value => {
        const e = strictObject(value, ['id', 'name', 'sets', 'prescription', 'rest', 'notes', 'skill'])
        if (e.id !== null && (typeof e.id !== 'string' || !before?.exercises.some(ex => ex.id === e.id))) throw new CoachError(502, 'An exercise identifier is invalid.', 'invalid_proposal')
        const previous = before?.exercises.find(ex => ex.id === e.id)
        return { id: typeof e.id === 'string' ? e.id : uid(), name: e.name, sets: e.sets, prescription: e.prescription, rest: e.rest, notes: !notes && previous ? previous.notes : e.notes, ...(e.skill !== null ? { skill: e.skill } : {}) }
      })
      after = { id, programmeId: data.activeProgrammeId, title: s.title, date: s.date, category: s.category, minutes: s.minutes, notes: !notes && before ? before.notes : s.notes, exercises, proposed: false } as Session
      // Full graph validation below also checks all nested types and unknown fields.
      try { const error = validateSession(after); if (error || after.date < today || after.date > addDays(today, days - 1)) throw new Error(error ?? 'Date outside scope') } catch { throw new CoachError(502, 'A proposed session has invalid prescriptions or dates. Nothing has changed.', 'invalid_proposal') }
    }
    return { id, expectedRevision: records[`session:${id}`]?.revision ?? 0, before, after }
  })
  const proposal: PreparedProposal = { id: uid(), version: 1, title: p.title, rationale: p.rationale, expiresAt: new Date(Date.parse(now) + 86400000).toISOString(), programmeId: data.activeProgrammeId, programmeRevision: records[`programme:${data.activeProgrammeId}`].revision, preferencesRevision: records['preferences:singleton'].revision, changes, status: 'pending' }
  proposalCandidate(records, proposal, today, now)
  return proposal
}
export function proposalCandidate(records: RecordMap, proposal: PreparedProposal, today: string, now: string): AppData {
  if (proposal.version !== 1 || proposal.status !== 'pending' || Date.parse(proposal.expiresAt) <= Date.parse(now)) throw new CoachError(409, 'This proposal expired or has already been decided. Request a fresh proposal.', 'stale_proposal')
  const data = fromRecords(records)
  if (data.activeProgrammeId !== proposal.programmeId || records[`programme:${proposal.programmeId}`]?.revision !== proposal.programmeRevision || records['preferences:singleton']?.revision !== proposal.preferencesRevision) throw new CoachError(409, 'The programme changed since this proposal was created. Request a fresh proposal.', 'stale_proposal')
  for (const c of proposal.changes) {
    if ((records[`session:${c.id}`]?.revision ?? 0) !== c.expectedRevision || !same(records[`session:${c.id}`]?.payload ?? null, c.before) || data.logs.some(l => l.sessionId === c.id) || (c.before && c.before.date < today) || (c.after && c.after.date < today)) throw new CoachError(409, 'A session changed or was completed since this proposal. Nothing has been applied.', 'stale_proposal')
  }
  try { return validateBackupData({ ...data, sessions: [...data.sessions.filter(s => !proposal.changes.some(c => c.id === s.id)), ...proposal.changes.flatMap(c => c.after ? [c.after] : [])] }) }
  catch { throw new CoachError(502, 'The proposed plan is incompatible with your records. Nothing has changed.', 'invalid_proposal') }
}
