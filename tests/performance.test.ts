import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { createInitialData, migrateData, type Version2AppData } from '../src/domain'
import { parseBackup, validateBackupData } from '../src/backup'
import { IndexedDBRepository } from '../src/repository'
import { aggregateMatchAccuracy, blankMatch, blankTestDefinition, calculateTestValue, comparableMatchMetric, comparableTestGroups, createPerformanceData, emptyAggregate, matchScoring, testComparisonKey, trainingContext, type Shot, type TestResult } from '../src/performance-domain'
import { entryError, validateMatch, validateMetricDefinition, validatePerformanceData, validateScoringRules, validateTestDefinition, validateTestResult } from '../src/performance-validation'
import { completeBackup, encodeBackup } from './fixtures/backup'
import { matchRecord, testRecord } from './fixtures/performance'

describe('optional catalogue and safe document migrations', () => {
  it('includes the requested tests and never seeds actual results or matches', () => {
    const data = createInitialData()
    expect(data.version).toBe(3)
    expect(data.performance.results).toEqual([]); expect(data.performance.matches).toEqual([])
    expect(data.performance.definitions).toHaveLength(20)
    expect(() => validatePerformanceData(data.performance)).not.toThrow()
    expect(data.performance.definitions.filter(d => d.enabled).length).toBeLessThan(20)
  })
  it('migrates version 2 preserving every existing field and leaves the input unchanged', () => {
    const { performance: _, ...source } = completeBackup()
    const legacy: Version2AppData = { ...source, version: 2 }, before = structuredClone(legacy)
    const result = migrateData(legacy)
    expect(result).toEqual({ ...legacy, version: 3, performance: createPerformanceData() })
    expect(legacy).toEqual(before)
    expect(result.logs).toEqual(legacy.logs); expect(result.recoveryEntries).toEqual(legacy.recoveryEntries)
    expect(migrateData(result)).toBe(result)
  })
  it('imports original version 2 backups and exports/restores complete version 3 records', () => {
    const fixture = completeBackup(), { performance: _, ...old } = fixture
    const parsed = parseBackup(encodeBackup({ ...old, version: 2 }))
    expect(parsed.sourceVersion).toBe(2)
    expect(parsed.data).toEqual({ ...old, version: 3, performance: createPerformanceData() })
    expect(parseBackup(encodeBackup(fixture)).data).toEqual(fixture)
  })
  it('upgrades existing IndexedDB data and keeps version 2 intact if the upgrade write fails', async () => {
    const repository = new IndexedDBRepository(); await repository.load()
    const db = await openDB('athlete-lab', 1), { performance: _, ...source } = completeBackup()
    const old = { ...source, version: 2 }
    await db.put('state', old, 'app')
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    try { await expect(repository.load()).rejects.toThrow('Full') } finally { put.mockRestore() }
    expect(await db.get('state', 'app')).toEqual(old)
    const migrated = await repository.load()
    expect(migrated).toEqual({ ...old, version: 3, performance: createPerformanceData() })
    expect(await db.get('state', 'app')).toEqual(migrated); db.close()
  })
})
describe('test calculation, units and compatible personal bests', () => {
  it('calculates lower/higher best, arithmetic mean, manual and weighted accuracy correctly', () => {
    const definition = testRecord().definition
    expect(calculateTestValue(definition, [2, 1.8, 1.9], 3, null, 0)).toBe(1.8)
    expect(calculateTestValue({ ...definition, direction: 'Higher' }, [30, 35, 31], 3, null, 0)).toBe(35)
    expect(calculateTestValue({ ...definition, calculation: 'Mean' }, [2, 4], 2, null, 0)).toBe(3)
    expect(calculateTestValue({ ...definition, calculation: 'Manual' }, [], 1, null, 1800)).toBe(1800)
    expect(calculateTestValue({ ...definition, calculation: 'Accuracy' }, [], 10, 0, 0)).toBe(0)
    expect(calculateTestValue({ ...definition, calculation: 'Accuracy' }, [], 3, 2, 0)).toBeCloseTo(66.6666667)
  })
  it('finds personal bests only inside one exact measured protocol group', () => {
    const first = testRecord(), second = testRecord({ id: 'second', date: '2025-05-01', attempts: [1.85, 1.8], value: 1.8 })
    const manual = { ...testRecord({ id: 'stopwatch', value: 1.2, attempts: [1.3, 1.2] }), protocol: { ...first.protocol, method: 'Handheld stopwatch' as const } }
    const groups = comparableTestGroups([second, first, manual])
    expect(groups).toHaveLength(2); expect(groups[0].best?.id).toBe('second'); expect(groups[0].change).toBeCloseTo(-.1)
    expect(groups[1].best?.id).toBe('stopwatch')
    expect(comparableTestGroups([{ ...first, quality: 'Estimated' }])[0].best).toBeNull()
    expect(comparableTestGroups([{ ...first, quality: 'Subjective' }])[0].best).toBeNull()
    expect(comparableTestGroups([first])[0].change).toBeNull()
  })
  it.each(['unit', 'direction', 'calculation', 'protocol', 'operationalDefinition', 'quality', 'method', 'equipment', 'surface', 'start', 'runIn', 'technique', 'distance', 'foot', 'angle', 'pressure', 'conditions', 'recovery', 'attemptCount'])('separates changes to %s', field => {
    const first = testRecord(), second = structuredClone(first)
    if (field === 'operationalDefinition') second.definition.evidence.operationalDefinition += ' changed'
    else if (field === 'unit') second.definition.unit = 'cm'
    else if (field === 'direction') second.definition.direction = 'Higher'
    else if (field === 'calculation') second.definition.calculation = 'Mean'
    else if (field === 'protocol') second.definition.protocol += ' changed'
    else if (field === 'quality') second.quality = 'Estimated'
    else if (field === 'method') second.protocol.method = 'Handheld stopwatch'
    else if (field === 'equipment') second.protocol.equipment += ' changed'
    else if (field === 'attemptCount') second.attemptCount = 3
    else second.protocol.details[field as keyof TestResult['protocol']['details']] += ' changed'
    expect(testComparisonKey(first)).not.toBe(testComparisonKey(second))
  })
  it('preserves original definitions and does not silently convert units after editing a catalogue entry', () => {
    const data = createPerformanceData(), result = testRecord({}, data.definitions.find(d => d.id === 'sprint-10'))
    const snapshot = structuredClone(result)
    data.definitions.find(d => d.id === 'sprint-10')!.unit = 'm'
    expect(result).toEqual(snapshot)
    expect(result.definition.unit).toBe('s')
  })
  it.each([
    ['wrong representative value', (r: TestResult) => { r.value = 100 }],
    ['missing attempts', (r: TestResult) => { r.attempts = [] }],
    ['mismatched attempt count', (r: TestResult) => { r.attemptCount = 1 }],
    ['invalid method', (r: TestResult) => { r.protocol.method = '' }],
    ['missing protocol detail', (r: TestResult) => { r.protocol.details.start = '' }],
    ['zero time', (r: TestResult) => { r.attempts = [0, 2]; r.value = 0 }],
    ['non-finite time', (r: TestResult) => { r.value = Infinity }],
    ['mismatched definition', (r: TestResult) => { r.testId = 'other' }],
    ['negative run-in', (r: TestResult) => { r.protocol.details.runIn = '-1' }],
  ])('rejects %s', (_, change) => { const result = testRecord(); change(result); expect(() => validateTestResult(result)).toThrow() })
  it('checks accuracy bounds and real whole repetition counts', () => {
    const d = createPerformanceData().definitions.find(d => d.id === 'kick-two')!
    const result = testRecord({ attempts: [], attemptCount: 10, successes: 0, value: 0, definition: { ...d, requiredDetails: [] }, testId: d.id })
    expect(() => validateTestResult(result)).not.toThrow()
    expect(() => validateTestResult({ ...result, successes: null })).toThrow()
    expect(() => validateTestResult({ ...result, successes: 11 })).toThrow()
    const reps = testRecord({ definition: { ...testRecord().definition, unit: 'reps' }, attempts: [1.5, 2], value: 1.5 })
    expect(() => validateTestResult(reps)).toThrow()
  })
})
describe('match scoring without duplicate counting or unknown-to-zero conversion', () => {
  it('keeps unknown values distinct from explicit zero and sums 1/2/3 scoring once', () => {
    const empty = blankMatch(createPerformanceData())
    expect(matchScoring(empty).totalPoints).toBeNull(); expect(matchScoring(empty).groups.one.attempts).toBeNull()
    empty.aggregate = { one: { attempts: 0, successes: 0 }, two: { attempts: 0, successes: 0 }, goal: { attempts: 0, successes: 0 } }
    expect(matchScoring(empty).totalPoints).toBe(0); expect(matchScoring(empty).groups.one.rate).toBeNull()
    const match = matchRecord(), score = matchScoring(match)
    expect(score.totalPoints).toBe(7); expect(score.groups.two.rate).toBeCloseTo(100 / 3)
    match.rules.goal = 4; expect(matchScoring(match).totalPoints).toBe(8)
  })
  const shot = (patch: Partial<Shot>): Shot => ({ id: 'shot-1', type: 'goal', outcome: 'one', distance: null, foot: 'Unspecified', angle: '', pressure: 'Unspecified', play: 'Unknown', ...patch })
  it('counts a goal attempt over the bar as one attempt, zero goal conversions and one awarded point', () => {
    const match = { ...matchRecord(), scoringMode: 'Shots' as const, shotCoverage: 'Complete' as const, aggregate: emptyAggregate(), shots: [shot({})] }
    const summary = matchScoring(match)
    expect(summary.totalPoints).toBe(1)
    expect(summary.groups.goal).toMatchObject({ attempts: 1, successes: 0, rate: 0 })
    expect(summary.awarded).toEqual({ one: 1, two: 0, goal: 0 })
    expect(summary.groups.one.attempts).toBe(0)
    expect(() => validateMatch(match)).not.toThrow()
    expect(() => validateMatch({ ...match, aggregate: matchRecord().aggregate })).toThrow('source of truth')
    expect(() => validateMatch({ ...match, scoringMode: 'Aggregate' })).toThrow('individual shots')
  })
  it('does not infer full totals from a partial shot sample or classify unknown outcomes as misses', () => {
    const match = { ...matchRecord(), scoringMode: 'Shots' as const, aggregate: emptyAggregate(), shots: [shot({ type: 'two', outcome: 'two' }), shot({ id: 'unknown-shot', type: 'two', outcome: 'unknown' })] }
    const summary = matchScoring(match)
    expect(summary.knownPoints).toBe(2); expect(summary.totalPoints).toBeNull()
    expect(summary.groups.two).toMatchObject({ attempts: 2, successes: null, rate: null, unresolved: 1 })
    expect(summary.groups.goal.attempts).toBeNull()
  })
  it('weights conversion by known attempts and reports exclusions', () => {
    const first = matchRecord(), second = matchRecord(), third = blankMatch(createPerformanceData())
    first.aggregate.two = { attempts: 10, successes: 5 }; second.aggregate.two = { attempts: 90, successes: 9 }
    const accuracy = aggregateMatchAccuracy([first, second, third], 'two')
    expect(accuracy).toMatchObject({ attempts: 100, successes: 14, matches: 2, excluded: 1 })
    expect(accuracy.rate).toBeCloseTo(14)
  })
  it('preserves match definitions and rules and handles minutes without fabricating normalised values', () => {
    const match = matchRecord(), snapshot = structuredClone(match), current = createPerformanceData()
    current.scoringRules.goal = 5; current.matchMetrics[0].evidence.operationalDefinition = 'Edited'
    expect(match).toEqual(snapshot)
    const definition = match.metrics.find(m => m.definition.id === 'chances')!.definition
    expect(comparableMatchMetric([match], definition)[0].per70).toBeCloseTo(2.8)
    expect(comparableMatchMetric([{ ...match, minutes: null }], definition)[0].per70).toBeNull()
    expect(comparableMatchMetric([{ ...match, minutes: 0 }], definition)[0].per70).toBeNull()
    expect(comparableMatchMetric([match], { ...definition, evidence: { ...definition.evidence, operationalDefinition: 'Different criterion' } })).toEqual([])
  })
  it.each([
    ['conversions exceed attempts', (m: any) => { m.aggregate.two.successes = 4 }],
    ['negative minutes', (m: any) => { m.minutes = -1 }],
    ['mixed scoring sources', (m: any) => { m.shots = [shot({})] }],
    ['invalid missing value', (m: any) => { m.aggregate.one.attempts = '' }],
    ['invalid evidence', (m: any) => { m.metrics[0].definition.evidence.category = 'Validated elite score' }],
    ['duplicate metric', (m: any) => { m.metrics.push(structuredClone(m.metrics[0])) }],
    ['passing success exceeds attempts', (m: any) => { m.metrics.find((r: any) => r.definition.id === 'passes').value = 10; m.metrics.find((r: any) => r.definition.id === 'pass-attempts').value = 5 }],
    ['missing source details', (m: any) => { m.source = 'Other recorded source' }],
    ['fractional contribution', (m: any) => { m.metrics[0].value = .5 }],
  ])('rejects %s', (_, change) => { const match = matchRecord(); change(match); expect(() => validateMatch(match)).toThrow() })
})
describe('evidence, complete backup validation and training context', () => {
  it('defaults custom definitions to coaching-defined and requires real reference URLs for research labels', () => {
    const definition = { ...blankTestDefinition(), name: 'Test', protocol: 'Fixed protocol' }
    definition.evidence.operationalDefinition = 'Operational definition'
    expect(definition.evidence.category).toBe('Coaching-defined observation')
    expect(() => validateTestDefinition(definition)).not.toThrow()
    expect(() => validateTestDefinition({ ...definition, evidence: { ...definition.evidence, category: 'Research-supported physical test' } })).toThrow('supporting reference')
    expect(() => validateTestDefinition({ ...definition, evidence: { ...definition.evidence, reference: 'javascript:alert(1)' } })).toThrow()
    expect(() => validateMetricDefinition({ ...createPerformanceData().matchMetrics[0], evidence: { ...definition.evidence, category: 'Exploratory personal metric' } })).not.toThrow()
    expect(() => validateScoringRules({ ...createPerformanceData().scoringRules, goal: 0 })).toThrow()
  })
  it.each([
    ['missing performance', (d: any) => { delete d.performance }],
    ['missing matches', (d: any) => { delete d.performance.matches }],
    ['invalid nested result', (d: any) => { d.performance.results[0].value = -1 }],
    ['missing snapshot', (d: any) => { delete d.performance.results[0].definition }],
    ['duplicate results', (d: any) => { d.performance.results.push(d.performance.results[0]) }],
    ['duplicate matches', (d: any) => { d.performance.matches.push(d.performance.matches[0]) }],
    ['missing focus definition', (d: any) => { d.performance.preferences.focusTestIds = ['missing'] }],
    ['unsafe reference', (d: any) => { d.performance.matches[0].rules.reference = 'data:text/html,test' }],
  ])('rejects %s before any restoration', (_, change) => { const data = completeBackup(); change(data); expect(() => validateBackupData(data)).toThrow() })
  it('retains independent historical snapshots even if definitions or linked sessions are absent', () => {
    const data = completeBackup()
    data.performance.definitions = data.performance.definitions.filter(d => d.id !== 'sprint-10')
    data.performance.preferences.focusTestIds = []
    data.performance.results[0].context = { programmeId: 'deleted', programmeName: 'Old programme', sessionId: 'deleted', sessionTitle: 'Old session', goalId: 'deleted', goalTitle: 'Old goal' }
    expect(validateBackupData(data)).toEqual(data)
  })
  it('counts actual preceding exposure only, excludes future/same-day records and never fills missing days', () => {
    const data = completeBackup(), context = trainingContext(data, '2025-04-02')
    expect(context.workouts).toBe(2); expect(context.minutes).toBe(65); expect(context.load).toBe(300)
    expect(context.recovery).toHaveLength(1); expect(context.illnessDays).toBe(1)
    expect(trainingContext(data, '2025-03-01').workouts).toBe(0)
    const result = { ...testRecord(), date: '2099-01-01' }
    expect(entryError(validateTestResult, result)).toContain('today or an earlier')
    expect(() => validateTestResult(result)).not.toThrow() // Imported clocks can differ.
  })
})
