import { describe, expect, it } from 'vitest'
import { completeBackup } from './fixtures/backup'
import { prepareProposal, proposalCandidate, proposalTargets, readProposal, type RawProposal } from '../src/coach-proposals'
import { fromRecords, toRecords } from '../src/sync-domain'

const today = '2025-04-01', now = `${today}T12:00:00Z`
const draft = (): RawProposal => ({ title: 'Proposed technical practice', rationale: 'A manageable proposed session; current readiness remains unknown.', actions: [{ operation: 'add', targetId: null, session: { title: 'Both-foot practice', date: today, category: 'Skills', minutes: 20, notes: '', exercises: [{ id: null, name: 'Kick passing', sets: 2, prescription: '10 controlled attempts each side', rest: '60 sec', notes: '', skill: null }] } }] })
const records = () => { const rows = toRecords(completeBackup()); Object.values(rows).forEach(row => { row.revision = 3 }); return rows }
describe('structured session proposals and historical integrity', () => {
  it('validates proposed additions without changing records, and only a candidate plan contains the new session', () => {
    const rows = records(), before = structuredClone(rows), proposal = prepareProposal(draft(), rows, today, 7, false, now)
    expect(rows).toEqual(before); expect(proposal.status).toBe('pending'); expect(proposal.changes[0].expectedRevision).toBe(0)
    expect(readProposal(proposal)).toEqual(proposal)
    const candidate = proposalCandidate(rows, proposal, today, now)
    expect(candidate.sessions).toHaveLength(completeBackup().sessions.length + 1)
    expect(candidate.logs).toEqual(fromRecords(rows).logs)
    expect(candidate.performance.results).toEqual(fromRecords(rows).performance.results)
  })
  it('previews edits and preserves unshared notes and historical prescriptions', () => {
    const rows = records(), original = rows['session:skills-plan'].payload as ReturnType<typeof completeBackup>['sessions'][number]
    const raw = draft(); raw.actions[0] = { operation: 'update', targetId: original.id, session: { ...raw.actions[0].session!, exercises: [{ ...raw.actions[0].session!.exercises[0], id: original.exercises[0].id }], notes: 'Overwrite private note' } }
    const proposal = prepareProposal(raw, rows, today, 7, false, now), change = proposal.changes[0]
    expect(change.before).toEqual(original); expect(change.after!.notes).toBe(original.notes)
    expect(change.after!.exercises[0].notes).toBe(original.exercises[0].notes)
    expect(proposalCandidate(rows, proposal, today, now).logs).toEqual(fromRecords(rows).logs)
  })
  it('supports planned-session removal while preserving history', () => {
    const rows = records(), raw = draft(); raw.actions = [{ operation: 'delete', targetId: 'skills-plan', session: null }]
    const proposal = prepareProposal(raw, rows, today, 7, false, now), candidate = proposalCandidate(rows, proposal, today, now)
    expect(candidate.sessions.some(s => s.id === 'skills-plan')).toBe(false)
    expect(candidate.logs).toEqual(fromRecords(rows).logs)
  })
  it('rejects unknown targets, extra executable fields, invalid prescriptions and out-of-window dates', () => {
    const rows = records()
    for (const mutate of [(p: RawProposal) => { p.actions[0].session!.minutes = 0 }, (p: RawProposal) => { p.actions[0].session!.date = '2025-05-01' }, (p: RawProposal) => { p.actions[0].operation = 'update'; p.actions[0].targetId = 'missing' }, (p: RawProposal) => { p.actions[0].session!.exercises[0].sets = 99 }]) {
      const raw = draft(); mutate(raw); expect(() => prepareProposal(raw, rows, today, 7, false, now)).toThrow()
    }
    expect(() => prepareProposal({ ...draft(), execute: 'delete workouts' }, rows, today, 7, false, now)).toThrow()
    expect(() => readProposal({ version: 99 })).toThrow('malformed')
  })
  it('never targets completed sessions or historical workout snapshots', () => {
    const data = completeBackup(); data.logs[1].sessionId = 'skills-plan'
    const rows = toRecords(data), raw = draft(); raw.actions = [{ operation: 'delete', targetId: 'skills-plan', session: null }]
    expect(proposalTargets(data, today, 7, false).eligibleSessions).toEqual([])
    expect(() => prepareProposal(raw, rows, today, 7, false, now)).toThrow('historical or completed')
  })
  it('rejects stale sessions, changed programme/preferences, completed work, expiry and repeated approval', () => {
    const initial = records(), raw = draft(); raw.actions = [{ operation: 'delete', targetId: 'skills-plan', session: null }]
    const p = prepareProposal(raw, initial, today, 7, false, now)
    for (const key of ['session:skills-plan', 'programme:second-programme', 'preferences:singleton']) { const changed = structuredClone(initial); changed[key].revision++; expect(() => proposalCandidate(changed, p, today, now)).toThrow() }
    const completed = structuredClone(initial); (completed['workout:skills-log'].payload as { sessionId: string }).sessionId = 'skills-plan'
    expect(() => proposalCandidate(completed, p, today, now)).toThrow('completed')
    expect(() => proposalCandidate(initial, p, today, '2025-04-03T12:00:00Z')).toThrow('expired')
    expect(() => proposalCandidate(initial, { ...p, status: 'approved' }, today, now)).toThrow('already been decided')
  })
})
