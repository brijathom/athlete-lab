import {trainingHistory} from './training-activities'
import { addDays, dateKey, uid, type AppData } from './domain'
import { defaultTestDefinitions, defaultMatchMetrics } from './performance-catalogue'
import type { Foot, Pressure } from './skills-domain'

export const evidenceCategories = ['Research-supported physical test', 'Research-supported match-performance indicator', 'Coaching-defined observation', 'Exploratory personal metric'] as const
export interface Evidence { category: typeof evidenceCategories[number]; operationalDefinition: string; reference: string; limitations: string }
export const testCategories = ['Speed', 'Power', 'Strength', 'Endurance', 'Football', 'Other'] as const
export const testUnits = ['s', 'cm', 'm', 'kg', 'reps', '%', 'km/h'] as const
export const calculations = ['Best', 'Mean', 'Manual', 'Accuracy'] as const
export const measurementMethods = ['Electronic timing gates', 'Handheld stopwatch', 'GPS-derived measurement', 'Jump measurement system', 'Tape measure', 'Manually recorded result', 'Other'] as const
export const detailLabels = { surface: 'Surface', start: 'Start method', runIn: 'Flying run-in (m)', distance: 'Test distance / course', technique: 'Technique / repetitions', conditions: 'Conditions / wind', foot: 'Foot', angle: 'Angle', pressure: 'Pressure level', recovery: 'Recovery between attempts' }
export type DetailKey = keyof typeof detailLabels
export interface TestDefinition {
  id: string; name: string; sport: string; category: typeof testCategories[number]; unit: typeof testUnits[number]
  direction: 'Higher' | 'Lower'; calculation: typeof calculations[number]; enabled: boolean
  protocol: string; requiredDetails: DetailKey[]; evidence: Evidence
}
export interface TestProtocol {
  method: typeof measurementMethods[number] | ''; equipment: string; description: string
  details: Record<DetailKey, string>
}
export const qualities = ['Measured', 'Estimated', 'Subjective'] as const
export interface RecordContext { programmeId: string | null; programmeName: string; sessionId: string | null; sessionTitle: string; goalId: string | null; goalTitle: string }
export const emptyContext = (): RecordContext => ({ programmeId: null, programmeName: '', sessionId: null, sessionTitle: '', goalId: null, goalTitle: '' })
export interface TestResult {
  id: string; testId: string; date: string; definition: TestDefinition; protocol: TestProtocol
  quality: typeof qualities[number]; attempts: number[]; attemptCount: number; value: number; successes: number | null
  notes: string; context: RecordContext; savedAt: string
}
export const shotTypes = ['one', 'two', 'goal'] as const
export type ShotType = typeof shotTypes[number]
export const shotLabels = { one: 'One-point', two: 'Two-point', goal: 'Goal' }
export const shotOutcomes = ['one', 'two', 'goal', 'miss', 'saved', 'blocked', 'unknown'] as const
export const outcomeLabels = { one: 'One-point score', two: 'Two-point score', goal: 'Goal scored', miss: 'Wide / missed', saved: 'Saved', blocked: 'Blocked', unknown: 'Outcome unknown' }
export interface Shot { id: string; type: ShotType; outcome: typeof shotOutcomes[number]; distance: number | null; angle: string; foot: Foot; pressure: Pressure; play: 'Unknown' | 'Open play' | 'Set play' }
export interface ScoringRules { name: string; one: number; two: number; goal: number; reference: string }
export interface CountPair { attempts: number | null; successes: number | null }
export const emptyAggregate = (): Record<ShotType, CountPair> => ({ one: { attempts: null, successes: null }, two: { attempts: null, successes: null }, goal: { attempts: null, successes: null } })
export const observationSources = ['Self-report', 'Coach assessment', 'Match video', 'Other recorded source'] as const
export const metricGroups = ['Attacking', 'Defensive', 'General'] as const
export interface MatchMetricDefinition { id: string; name: string; group: typeof metricGroups[number]; enabled: boolean; evidence: Evidence }
export const reflectionLabels = { position: 'Position-specific observations', decisions: 'Decision-making', tactical: 'Tactical intelligence', leadership: 'Leadership and communication', overall: 'Overall reflections' }
export interface MatchRecord {
  fixtureId?:string;rpe?:number;participation?:'Played'|'Did not play'
  id: string; date: string; opponent: string; competition: string; team: string; position: string; minutes: number | null
  result: 'Unknown' | 'Win' | 'Draw' | 'Loss'; finalScore: string; conditions: string; tacticalNotes: string
  source: typeof observationSources[number]; sourceDetails: string; quality: 'Recorded' | 'Estimated'
  rules: ScoringRules; scoringMode: 'Aggregate' | 'Shots'; shotCoverage: 'Complete' | 'Partial'
  aggregate: Record<ShotType, CountPair>; shots: Shot[]
  metrics: { definition: MatchMetricDefinition; value: number | null }[]
  reflections: Record<keyof typeof reflectionLabels, string>; context: RecordContext; savedAt: string
}
export interface PerformancePreferences { focusTestIds: string[]; focusMetricIds: string[]; showSkills: boolean; showTraining: boolean }
export interface PerformanceData { definitions: TestDefinition[]; results: TestResult[]; matches: MatchRecord[]; matchMetrics: MatchMetricDefinition[]; scoringRules: ScoringRules; preferences: PerformancePreferences }
export function createPerformanceData(): PerformanceData {
  return { definitions: defaultTestDefinitions(), results: [], matches: [], matchMetrics: defaultMatchMetrics(), scoringRules: { name: 'Gaelic football: 1 / 2 / 3', one: 1, two: 2, goal: 3, reference: 'https://learning.gaa.ie/sites/default/files/2026-04/GAA%20Rule%20Book%20April%202026.pdf' }, preferences: { focusTestIds: ['sprint-10', 'cmj', 'yoyo-ir1'], focusMetricIds: ['chances', 'turnovers'], showSkills: true, showTraining: true } }
}
export function blankTestDefinition(): TestDefinition {
  return { id: uid(), name: '', sport: 'Gaelic football', category: 'Other', unit: 's', direction: 'Lower', calculation: 'Manual', enabled: true, protocol: '', requiredDetails: [], evidence: { category: 'Coaching-defined observation', operationalDefinition: '', reference: '', limitations: '' } }
}
export function blankTestResult(definition: TestDefinition, date = dateKey()): TestResult {
  return { id: uid(), testId: definition.id, date, definition: structuredClone(definition), protocol: { method: '', equipment: '', description: definition.protocol, details: { surface: '', start: '', runIn: '', distance: '', technique: '', conditions: '', foot: '', angle: '', pressure: '', recovery: '' } }, quality: 'Measured', attempts: [], attemptCount: 1, value: 0, successes: null, notes: '', context: emptyContext(), savedAt: '' }
}
export function blankMatch(data: PerformanceData, date = dateKey()): MatchRecord {
  return { id: uid(), date, opponent: '', competition: '', team: '', position: '', minutes: null, result: 'Unknown', finalScore: '', conditions: '', tacticalNotes: '', source: 'Self-report', sourceDetails: '', quality: 'Estimated', rules: structuredClone(data.scoringRules), scoringMode: 'Aggregate', shotCoverage: 'Partial', aggregate: emptyAggregate(), shots: [], metrics: data.matchMetrics.filter(m => m.enabled).map(definition => ({ definition: structuredClone(definition), value: null })), reflections: { position: '', decisions: '', tactical: '', leadership: '', overall: '' }, context: emptyContext(), savedAt: '' }
}
export function calculateTestValue(definition: TestDefinition, attempts: number[], count: number, successes: number | null, manual: number): number {
  if (definition.calculation === 'Accuracy') return count > 0 && successes !== null ? successes / count * 100 : NaN
  if (definition.calculation === 'Manual') return manual
  if (!attempts.length) return NaN
  if (definition.calculation === 'Mean') return attempts.reduce((n, v) => n + v, 0) / attempts.length
  return definition.direction === 'Lower' ? Math.min(...attempts) : Math.max(...attempts)
}
const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
/** Conservative comparison: all recorded context, technique, quality and calculation must match. */
export function testComparisonKey(result: TestResult): string {
  const d = result.definition, p = result.protocol
  return JSON.stringify([result.testId, d.category, d.unit, d.direction, d.calculation, d.calculation === 'Accuracy' ? null : result.attemptCount, normalise(d.protocol), normalise(d.evidence.operationalDefinition), [...d.requiredDetails].sort(), result.quality, p.method, normalise(p.equipment), normalise(p.description), Object.keys(detailLabels).map(k => normalise(p.details[k as DetailKey]))])
}
export function comparableTestGroups(results: TestResult[]) {
  const groups = new Map<string, TestResult[]>()
  for (const r of results) { const key = testComparisonKey(r); groups.set(key, [...(groups.get(key) || []), r]) }
  return [...groups.values()].map(rows => {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id))
    const measured = rows[0].quality === 'Measured'
    const best = measured ? rows.reduce((a, b) => (b.definition.direction === 'Lower' ? b.value < a.value : b.value > a.value) ? b : a) : null
    const first = rows[0], latest = rows.at(-1)!
    return { key: testComparisonKey(first), rows, best, change: rows.length > 1 && first.date !== latest.date ? latest.value - first.value : null }
  })
}
export interface ShotSummary extends CountPair { rate: number | null; unresolved: number }
export function matchScoring(match: MatchRecord) {
  const groups = {} as Record<ShotType, ShotSummary>
  const awarded = {} as Record<ShotType, number | null>
  let knownPoints = 0, complete = true
  for (const type of shotTypes) {
    if (match.scoringMode === 'Aggregate') {
      const pair = match.aggregate[type]
      awarded[type] = pair.successes
      groups[type] = { ...pair, rate: pair.attempts !== null && pair.attempts > 0 && pair.successes !== null ? pair.successes / pair.attempts * 100 : null, unresolved: 0 }
      if (pair.successes === null) complete = false
      else knownPoints += pair.successes * match.rules[type]
    } else {
      awarded[type] = match.shots.filter(s => s.outcome === type).length
      const shots = match.shots.filter(s => s.type === type), unresolved = shots.filter(s => s.outcome === 'unknown').length
      const known = shots.filter(s => s.outcome === type).length
      const absent = !shots.length && match.shotCoverage === 'Partial'
      groups[type] = { attempts: absent ? null : shots.length, successes: absent || unresolved ? null : known, rate: shots.length && !unresolved ? known / shots.length * 100 : null, unresolved }
    }
  }
  if (match.scoringMode === 'Shots') {
    knownPoints = match.shots.reduce((n, s) => n + (shotTypes.includes(s.outcome as ShotType) ? match.rules[s.outcome as ShotType] : 0), 0)
    complete = match.shotCoverage === 'Complete' && !match.shots.some(s => s.outcome === 'unknown')
  }
  return { groups, awarded, knownPoints, totalPoints: complete ? knownPoints : null }
}
export function aggregateMatchAccuracy(matches: MatchRecord[], type: ShotType) {
  let attempts = 0, successes = 0, included = 0
  for (const m of matches) {
    const g = matchScoring(m).groups[type]
    if (g.attempts === null || g.successes === null) continue
    attempts += g.attempts; successes += g.successes; included++
  }
  return { attempts, successes, matches: included, excluded: matches.length - included, rate: attempts ? successes / attempts * 100 : null }
}
export const metricKey = (definition: MatchMetricDefinition) => JSON.stringify([definition.id, normalise(definition.evidence.operationalDefinition), definition.evidence.category])
export function comparableMatchMetric(matches: MatchRecord[], definition: MatchMetricDefinition) {
  return matches.flatMap(match => {
    const metric = match.metrics.find(m => metricKey(m.definition) === metricKey(definition))
    return metric?.value !== null && metric?.value !== undefined ? [{ match, value: metric.value, per70: match.minutes !== null && match.minutes > 0 ? metric.value / match.minutes * 70 : null }] : []
  })
}
export function trainingContext(data: AppData, date: string) {
  const start = addDays(date, -28)
  const logs = trainingHistory(data).filter(l => l.kind!=='test'&&l.participated&&l.date >= start && l.date < date)
  const recovery = data.recoveryEntries.filter(r => r.date >= start && r.date < date)
  return { start, end: addDays(date, -1), workouts: logs.length, minutes: logs.reduce((n, l) => n + (l.minutes??0), 0), load: logs.reduce((n, l) => n + (l.load??0), 0), recovery, illnessDays: new Set(recovery.filter(r => r.illness).map(r => r.date)).size, modifiedDays: new Set(recovery.filter(r => r.availability === 'Modified training' || r.availability === 'Unavailable').map(r => r.date)).size }
}
export const formatValue = (value: number | null, digits = 2) => value === null ? 'Not recorded' : new Intl.NumberFormat('en-IE', { maximumFractionDigits: digits }).format(value)
