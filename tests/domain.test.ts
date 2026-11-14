import { describe, expect, it, vi } from 'vitest'
import { addDays, createInitialData, uid, validDate, validateLog, validateSession, weekStart, type WorkoutLog } from '../src/domain'
it('generates unique UUIDs on a non-secure LAN origin', () => { const cryptoBackup = globalThis.crypto; vi.stubGlobal('crypto', { getRandomValues: cryptoBackup.getRandomValues.bind(cryptoBackup) }); try { const first = uid(); expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); expect(uid()).not.toBe(first) } finally { vi.unstubAllGlobals() } })
describe('honest initial state', () => {
  it('only seeds proposed sessions, with no history or measurements', () => { const data = createInitialData('2026-11-14'); expect(data.logs).toEqual([]); expect(data.sessions.every(s => s.proposed)).toBe(true); expect(data.sessions[0].date).toBe('2026-11-14'); expect(data.profile.name).toBe(''); expect(data.profile.goals).toEqual([]); expect(data.programmes[0].name).toBe('Gaelic Football Performance'); expect(data.sessions.every(s => validateSession(s) === null)).toBe(true) })
})
describe('local calendar dates', () => {
  it('uses Monday weeks across month and year boundaries', () => { expect(weekStart('2026-11-15')).toBe('2026-11-09'); expect(weekStart('2027-01-01')).toBe('2026-12-28'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01') })
  it('rejects impossible dates', () => { expect(validDate('2026-02-30')).toBe(false); expect(validDate('2026-02-29')).toBe(false); expect(validDate('2028-02-29')).toBe(true); expect(validDate('not-a-date')).toBe(false) })
})
describe('prescription validation', () => {
  it('rejects empty, invalid or oversized sessions', () => { const s = createInitialData().sessions[0]; expect(validateSession({ ...s, title: '  ' })).toBeTruthy(); expect(validateSession({ ...s, minutes: 0 })).toBeTruthy(); expect(validateSession({ ...s, exercises: [] })).toBeTruthy(); expect(validateSession({ ...s, exercises: [{ ...s.exercises[0], sets: 1.5 }] })).toBeTruthy(); expect(validateSession({ ...s, exercises: [{ ...s.exercises[0], prescription: '' }] })).toBeTruthy() })
})
describe('actual workout validation', () => {
  const log: WorkoutLog = { id: 'log', sessionId: 'session', title: 'Training', category: 'Strength', date: '2020-01-01', minutes: 35, rpe: 6, notes: '', exercises: [], results: [{ exerciseId: 'e', set: 1, done: true, reps: '', load: '' }], savedAt: '' }
  it('requires explicit performed sets, duration and effort', () => { expect(validateLog(log)).toBeNull(); expect(validateLog({ ...log, results: [] })).toBeTruthy(); expect(validateLog({ ...log, results: [{ ...log.results[0], done: false }] })).toBeTruthy(); expect(validateLog({ ...log, minutes: 0 })).toBeTruthy(); expect(validateLog({ ...log, rpe: 0 })).toBeTruthy() })
  it('rejects future completion dates and invalid actual values', () => { expect(validateLog({ ...log, date: '2099-01-01' })).toBeTruthy(); expect(validateLog({ ...log, results: [{ ...log.results[0], reps: '3.5' }] })).toBeTruthy(); expect(validateLog({ ...log, results: [{ ...log.results[0], load: '-2' }] })).toBeTruthy() })
  it('accepts a partial workout without inventing results', () => { expect(validateLog({ ...log, results: [...log.results, { exerciseId: 'e', set: 2, done: false, reps: '', load: '' }] })).toBeNull() })
})
