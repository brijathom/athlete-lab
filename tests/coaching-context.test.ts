import { describe, expect, it, vi } from 'vitest'
import { createInitialData } from '../src/domain'
import { coachingMarkdown, defaultContextOptions, generateCoachingContext, generateContextFromRepository, validateContextOptions, type ContextSection } from '../src/coaching-context'
import { copyCoachingText } from '../src/coaching-export'
import { completeBackup } from './fixtures/backup'
import { testRecord } from './fixtures/performance'

const exportedAt = '2025-04-02T12:00:00.000Z'
const options = () => defaultContextOptions('quick', '2025-04-02')
const generate = (data = completeBackup(), patch = {}) => generateCoachingContext(data, { ...options(), ...patch }, exportedAt)
const section = (document: ReturnType<typeof generate>, key: ContextSection) => document.sections.find(s => s.key === key)!

describe('deterministic coaching context', () => {
  it('uses inclusive preset periods and validates dates, ranges, sections and text', () => {
    expect(options()).toMatchObject({ historyStart: '2025-03-20', historyEnd: '2025-04-02', upcomingStart: '2025-04-02', upcomingEnd: '2025-04-08' })
    expect(defaultContextOptions('detailed', '2025-04-02')).toMatchObject({ historyStart: '2025-01-03', upcomingEnd: '2025-04-29' })
    for (const patch of [{ historyStart: '2025-02-30' }, { historyStart: '2025-04-03' }, { upcomingEnd: '2025-04-01' }, { sections: [] }, { question: 'x'.repeat(1001) }]) expect(validateContextOptions({ ...options(), ...patch })).toBeTruthy()
    expect(() => generate(completeBackup(), { historyStart: '' })).toThrow('valid dates')
  })
  it('is repeatable, does not mutate records and exposes no database identifiers', () => {
    const data = completeBackup(), before = structuredClone(data)
    const first = generate(data)
    expect(generate(data)).toEqual(first); expect(data).toEqual(before)
    const text = JSON.stringify(first)
    expect(text).not.toContain('sessionId'); expect(text).not.toContain('deleted-gym-plan'); expect(text).not.toContain('activeProgrammeId')
    expect(first.format).toBe('athlete-lab-coaching-context')
  })
  it('filters training inclusively, uses historical prescriptions and distinguishes completed and planned', () => {
    const data = completeBackup(); data.logs[0].sessionId = data.sessions[0].id
    data.logs[0].results[0].reps = '0'; data.logs[0].results[0].load = ''
    const result = generate(data, { historyStart: '2025-03-31', historyEnd: '2025-03-31' })
    const training = section(result, 'training')
    expect(training.records).toHaveLength(1)
    expect(training.records[0].facts).toMatchObject({ Date: '2025-03-31', 'Actual minutes': 40, 'Session RPE (1–10)': 5, 'Sets marked performed': 1 })
    expect(JSON.stringify(training)).toContain('Historical prescription before plan edit')
    expect(JSON.stringify(training)).toContain('"Reps (recorded text; blank is unknown)":"0"')
    expect(JSON.stringify(training)).toContain('"Load (kg; recorded text; blank is unknown)":null')
    expect(JSON.stringify(section(result, 'schedule'))).not.toContain('Lower-body strength')
    expect(section(generate(data, { historyStart: '2025-04-01', historyEnd: '2025-04-01' }), 'training').records).toHaveLength(1)
    expect(section(generate(data, { historyStart: '2025-04-02' }), 'training').records).toHaveLength(0)
  })
  it('selects the active programme and reports uncompleted proposals without calling them missed', () => {
    const result = generate()
    const programme = section(result, 'programme')
    expect(programme.records[0].title).toBe('Test skills programme')
    expect(programme.records[1].title).toBe('Test skills plan')
    expect(programme.records[1].facts.Status).toBe('Proposed; no completion log')
    expect(JSON.stringify(programme)).not.toContain('Lower-body strength')
    const schedule = section(result, 'schedule')
    expect(schedule.records.every(r => String(r.facts.Date) >= '2025-04-02' && String(r.facts.Date) <= '2025-04-08')).toBe(true)
    expect(schedule.scope.join(' ')).toContain('Unscheduled days are not assumed rest days')
  })
  it('computes skill accuracy with actual denominators and keeps feet and conditions separate', () => {
    const data = completeBackup(), right = structuredClone(data.logs[1])
    right.id = 'second'; right.sessionId = 'second-plan'; right.skillResults![0].foot = 'Left'; right.skillResults![0].successes = 0
    data.logs.push(right)
    const rows = section(generate(data), 'skills').records
    expect(rows).toHaveLength(2)
    expect(rows[0].facts).toMatchObject({ Foot: 'Right', 'Successful attempts': 6, Attempts: 10, 'Accuracy (%)': 60, 'Completed logs (n)': 1 })
    expect(rows[1].facts['Accuracy (%)']).toBe(0)
    expect(rows[0].facts['Distance (m)']).toBe(40)
  })
  it('keeps incompatible tests separate, includes older relevant history and excludes future results', () => {
    const data = completeBackup()
    const second = testRecord({ id: 'second', date: '2025-03-01', attempts: [1.85, 1.8], value: 1.8 })
    const manual = testRecord({ id: 'manual', value: 1.2, attempts: [1.3, 1.2], protocol: { ...second.protocol, method: 'Handheld stopwatch' } })
    data.performance.results.push(second, manual, testRecord({ id: 'future', date: '2025-04-03' }))
    const rows = section(generate(data, { mode: 'detailed' }), 'testing').records
    expect(rows).toHaveLength(2)
    expect(rows[0].facts['Observations in this comparison group (n)']).toBe(2)
    expect(rows[0].facts['Comparable measured personal best']).toEqual({ Date: '2025-03-01', Value: 1.8, Unit: 's' })
    expect(rows[1].facts.Method).toBe('Handheld stopwatch')
    expect(JSON.stringify(rows)).not.toContain('2025-04-03')
    data.performance.results[0].quality = 'Estimated'
    expect(section(generate(data), 'testing').records.find(r => r.facts.Quality === 'Estimated')!.facts['Comparable measured personal best']).toBeNull()
  })
  it('uses match scoring rules, unknown versus zero and recorded source/quality', () => {
    const data = completeBackup()
    let row = section(generate(data), 'matches').records[0]
    expect(row.facts).toMatchObject({ 'Full scoring contribution (points)': 7, 'Minutes played': 50, 'Observation source': 'Match video', 'Statistics quality': 'Recorded' })
    data.performance.matches[0].minutes = null; data.performance.matches[0].aggregate.two = { attempts: 0, successes: 0 }
    row = section(generate(data), 'matches').records[0]
    expect(row.facts['Minutes played']).toBeNull()
    expect((row.facts.Scoring as any[])[1]).toMatchObject({ Attempts: 0, Conversions: 0, 'Conversion (%)': null })
  })
  it('emits useful empty states without manufacturing test results, fixtures, rest days or equipment', () => {
    const data = createInitialData('2025-04-02'), result = generate(data)
    for (const key of ['training', 'testing', 'matches', 'skills'] as ContextSection[]) expect(section(result, key).records).toEqual([])
    expect(section(result, 'programme').records[1].facts.Status).toContain('Proposed')
    expect(coachingMarkdown(result)).toContain('Not separately recorded')
    expect(result.privacy).toEqual({ identity: false, symptoms: false, illness: false, otherRecovery: false, freeTextNotes: false })
  })
  it('includes only selected sections and preserves Unicode and special characters in both formats', () => {
    const data = completeBackup(); data.profile.sport = 'Peil Ghaelach 🏐 <script>*'
    const result = generate(data, { sections: ['profile'], question: 'Cén fáth? 🏐 **Question**', additionalContext: 'Equipment: bands & bike. No gym this week.' })
    expect(result.sections).toHaveLength(1)
    const markdown = coachingMarkdown(result)
    expect(markdown).toContain('# Athlete Lab — Coaching context export')
    expect(markdown.indexOf('## Coaching question')).toBeLessThan(markdown.indexOf('## Athlete profile'))
    expect(markdown).toContain('Peil Ghaelach 🏐 \\<script\\>\\*')
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result.additionalAthleteContext).toContain('No gym')
    expect(result.sections[0].records[0].facts.Sport).toContain('<script>')
  })
})
describe('sensitive information and application boundary', () => {
  function sensitiveData() {
    const data = completeBackup()
    data.logs[0].notes = 'PRIVATE_WORKOUT_NOTE'; data.recoveryEntries[0].notes = 'PRIVATE_RECOVERY_NOTE'
    data.recoveryEntries[0].symptoms[0].notes = 'PRIVATE_SYMPTOM_NOTE'; data.performance.results[0].notes = 'PRIVATE_TEST_NOTE'
    data.performance.matches[0].reflections.overall = 'PRIVATE_MATCH_NOTE'
    return data
  }
  it('omits every sensitive category, identity and free-text notes by default', () => {
    const text = JSON.stringify(generate(sensitiveData()))
    for (const token of ['PRIVATE_', 'Backup test athlete', 'Reported symptoms', 'Illness noted (self-report)', 'Reported training availability', 'Historical missed plan', 'Knee']) expect(text).not.toContain(token)
    expect(section(generate(sensitiveData()), 'recovery').records).toEqual([])
  })
  it('requires each recovery category independently, with separate permission for notes', () => {
    const data = sensitiveData()
    const symptoms = JSON.stringify(section(generate(data, { includeSymptoms: true }), 'recovery'))
    expect(symptoms).toContain('Knee'); expect(symptoms).not.toContain('Illness noted'); expect(symptoms).not.toContain('PRIVATE_')
    const illness = JSON.stringify(section(generate(data, { includeIllness: true }), 'recovery'))
    expect(illness).toContain('"Illness noted (self-report)":true'); expect(illness).not.toContain('Knee'); expect(illness).not.toContain('Reported training availability')
    const recovery = JSON.stringify(section(generate(data, { includeRecovery: true }), 'recovery'))
    expect(recovery).toContain('Modified training'); expect(recovery).toContain('Historical missed plan'); expect(recovery).not.toContain('Knee')
    expect(JSON.stringify(generate(data, { includeNotes: true }))).not.toContain('PRIVATE_RECOVERY_NOTE')
    const all = JSON.stringify(generate(data, { includeNotes: true, includeSymptoms: true, includeIllness: true, includeRecovery: true, includeIdentity: true }))
    for (const token of ['PRIVATE_WORKOUT_NOTE', 'PRIVATE_SYMPTOM_NOTE', 'PRIVATE_RECOVERY_NOTE', 'PRIVATE_MATCH_NOTE', 'PRIVATE_TEST_NOTE', 'Backup test athlete']) expect(all).toContain(token)
  })
  it('reports symptom observations descriptively without inferring recovery or filling missing days', () => {
    const data = sensitiveData(), entry = structuredClone(data.recoveryEntries[0])
    entry.id = 'second'; entry.date = '2025-04-02'; entry.symptoms[0].severity = 0; data.recoveryEntries.push(entry)
    const recovery = section(generate(data, { mode: 'detailed', includeSymptoms: true }), 'recovery')
    expect(recovery.records.at(-1)!.facts['Recorded observations']).toBe(2)
    expect((recovery.records.at(-1)!.facts['Latest observation'] as any).severity).toBe(0)
    expect(JSON.stringify(recovery)).toContain('No diagnosis, resolution')
  })
  it('can use the existing repository load interface without saving context copies', async () => {
    const data = completeBackup(), repository = { load: vi.fn().mockResolvedValue(data), save: vi.fn() }
    expect(await generateContextFromRepository(repository, options(), exportedAt)).toEqual(generate(data))
    expect(repository.load).toHaveBeenCalledOnce(); expect(repository.save).not.toHaveBeenCalled()
  })
  it('handles successful clipboard copy, denial and unavailable insecure-origin APIs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await copyCoachingText('Actual context 🏐', { writeText })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Actual context 🏐')
    expect(await copyCoachingText('text', { writeText: vi.fn().mockRejectedValue(new Error('Denied')) })).toBe(false)
    expect(await copyCoachingText('text', undefined)).toBe(false)
  })
})
