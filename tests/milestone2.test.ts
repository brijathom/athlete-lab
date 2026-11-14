import { describe, expect, it } from 'vitest'
import { createInitialData, migrateData, validateLog, validateSession, type AppData, type LegacyAppData, type WorkoutLog } from '../src/domain'
import { blankSkill, comparisonKey, comparisonTrend, practiceObservations, skillAreas, summarisePractice, validateSkillResults, type SkillResult } from '../src/skills-domain'
import { recoverySummary, symptomKey, validateRecovery, type RecoveryEntry } from '../src/recovery-domain'

const drill = { ...blankSkill(), objective: 'Use both feet with control', successCriteria: 'Ball reaches target without bouncing', area: 'Short kick-passing' as const, foot: 'Left' as const, distance: 15, angle: 'Central', pressure: 'Unopposed' as const }
const exercise = { id: 'drill', name: 'Target pass', sets: 1, prescription: '10 attempts each foot', rest: 'As needed', notes: '', skill: drill }
const result: SkillResult = { ...drill, id: 'block', exerciseId: 'drill', attempts: 10, successes: 6 }
const log: WorkoutLog = { id: 'log', sessionId: 'session', title: 'Skills practice', category: 'Skills', date: '2020-01-01', minutes: 20, rpe: 4, notes: '', results: [], exercises: [exercise], skillResults: [result], savedAt: '2020-01-01T12:00:00Z' }
const recovery: RecoveryEntry = { id: 'entry', date: '2020-01-01', availability: 'Modified training', illness: false, missedTraining: false, missedSessions: [], symptoms: [{ id: 'symptom', kind: 'Joint', location: 'Knee', side: 'Left', severity: 3, durationDays: 2, notes: 'Stiff after practice' }], notes: '', savedAt: '2020-01-01T18:00:00Z' }

describe('non-destructive schema migration', () => {
  it('preserves all version 1 records and adds an empty recovery collection', () => {
    const { recoveryEntries: _, ...initial } = createInitialData()
    const legacy: LegacyAppData = { ...initial, version: 1, logs: [{ ...log, skillResults: undefined }], profile: { ...initial.profile, name: 'Actual athlete' } }
    const migrated = migrateData(legacy)
    expect(migrated).toEqual({ ...legacy, version: 2, recoveryEntries: [] })
    expect(legacy.version).toBe(1)
    expect(migrateData(migrated)).toBe(migrated)
    expect(migrated.sessions).toEqual(legacy.sessions)
  })
  it('does not seed actual skills, symptoms or availability', () => { const data = createInitialData(); expect(data.logs).toEqual([]); expect(data.recoveryEntries).toEqual([]) })
  it('rejects unsupported versions rather than replacing the data', () => { expect(() => migrateData({ version: 99 } as unknown as AppData)).toThrow() })
})

describe('skills validation', () => {
  it('supports every requested skill area and validates objective and criteria', () => {
    const base = createInitialData().sessions[0]
    for (const area of skillAreas) expect(validateSession({ ...base, category: 'Skills', exercises: [{ ...exercise, skill: { ...drill, area } }] })).toBeNull()
    expect(validateSession({ ...base, exercises: [{ ...exercise, skill: { ...drill, successCriteria: '' } }] })).toBeTruthy()
    expect(validateSession({ ...base, exercises: [{ ...exercise, skill: { ...drill, distance: -1 } }] })).toBeTruthy()
  })
  it('requires actual attempts and explicit successful totals', () => {
    expect(validateSkillResults([{ ...result, attempts: null, successes: null }], [exercise])).toBeTruthy()
    expect(validateSkillResults([{ ...result, successes: null }], [exercise])).toBeTruthy()
    expect(validateSkillResults([{ ...result, attempts: 0, successes: 0 }], [exercise])).toBeTruthy()
    expect(validateLog(log)).toBeNull()
    expect(validateLog({ ...log, skillResults: [{ ...result, successes: 0 }] })).toBeNull()
  })
  it('rejects impossible, fractional, non-finite and unrelated results', () => {
    for (const patch of [{ successes: 11 }, { attempts: -1 }, { attempts: 1.5 }, { successes: NaN }, { attempts: Infinity }, { exerciseId: 'unrelated' }, { distance: Infinity }]) expect(validateSkillResults([{ ...result, ...patch }], [exercise])).toBeTruthy()
    expect(validateSkillResults([result, result], [exercise])).toBeTruthy()
  })
})

describe('meaningful skill comparisons', () => {
  it('weights by attempts rather than averaging percentages', () => {
    const observations = practiceObservations([log, { ...log, id: 'second', skillResults: [{ ...result, attempts: 90, successes: 9 }] }])
    expect(summarisePractice(observations)).toEqual({ attempts: 100, successes: 15, rate: 15, sessions: 2 })
  })
  it('keeps feet, distances, angles, criteria and pressure separate', () => {
    const [observation] = practiceObservations([log])
    for (const patch of [{ foot: 'Right' as const }, { distance: 30 }, { angle: '30 degrees left' }, { pressure: 'Active opposition' as const }, { successCriteria: 'Catch on the run' }, { objective: 'Pass under time pressure' }]) expect(comparisonKey({ ...observation, result: { ...result, ...patch } })).not.toBe(comparisonKey(observation))
    expect(comparisonTrend([observation])).toBeNull()
    expect(comparisonTrend([observation, { ...observation, log: { ...log, id: 'other' }, result: { ...result, foot: 'Right' } }])).toBeNull()
  })
  it('compares separate sessions, not blocks within one session', () => {
    const one = practiceObservations([{ ...log, skillResults: [result, { ...result, id: 'block2' }] }])
    expect(comparisonTrend(one)).toBeNull()
    const two = practiceObservations([log, { ...log, id: 'second', date: '2020-01-02', skillResults: [{ ...result, successes: 8 }] }])
    expect(comparisonTrend(two)?.change).toBe(20)
  })
})

describe('recovery observations', () => {
  it('allows quick availability-only check-ins and observations', () => {
    expect(validateRecovery({ ...recovery, symptoms: [] })).toBeNull()
    expect(validateRecovery({ ...recovery, symptoms: [], availability: 'Not recorded', notes: 'Rested today' })).toBeNull()
    expect(validateRecovery({ ...recovery, symptoms: [], availability: 'Not recorded' })).toBeTruthy()
  })
  it('validates symptoms, dates, duration and missed-session linkage', () => {
    expect(validateRecovery(recovery)).toBeNull()
    for (const patch of [{ severity: null }, { severity: -1 }, { severity: 11 }, { severity: 1.5 }, { durationDays: NaN }, { durationDays: -1 }, { location: '' as const }, { side: '' as const }]) expect(validateRecovery({ ...recovery, symptoms: [{ ...recovery.symptoms[0], ...patch }] })).toBeTruthy()
    expect(validateRecovery({ ...recovery, date: '2099-01-01' })).toBeTruthy()
    expect(validateRecovery({ ...recovery, missedTraining: true, missedSessions: [{ sessionId: 's', title: 'Training', date: '2020-01-02' }] })).toBeTruthy()
  })
  it('counts recorded days once and does not infer missing days', () => {
    const entries = [recovery, { ...recovery, id: 'again', illness: true, missedTraining: true }]
    expect(recoverySummary(entries)).toEqual({ checkIns: 2, symptomDays: 1, illnessDays: 1, missedDays: 1 })
    expect(recoverySummary([]).symptomDays).toBe(0)
    expect(symptomKey({ ...recovery.symptoms[0], side: 'Right' })).not.toBe(symptomKey(recovery.symptoms[0]))
  })
})
