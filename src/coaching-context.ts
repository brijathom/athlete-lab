import { addDays, validDate, type AppData, type Exercise } from './domain'
import { comparableTestGroups, detailLabels, matchScoring, reflectionLabels, shotLabels, shotTypes } from './performance-domain'
import { comparisonKey, comparisonTrend, practiceObservations, summarisePractice } from './skills-domain'
import { symptomKey } from './recovery-domain'
import type { AthleteRepository } from './repository'

export const contextSections = { profile: 'Athlete profile & goals', programme: 'Current programme & planned work', training: 'Completed training', recovery: 'Recovery & availability', skills: 'Football development', testing: 'Performance testing', matches: 'Match performance', schedule: 'Upcoming schedule' } as const
export type ContextSection = keyof typeof contextSections
export interface ContextOptions {
  mode: 'quick' | 'detailed'; historyStart: string; historyEnd: string; upcomingStart: string; upcomingEnd: string
  sections: ContextSection[]; includeIdentity: boolean; includeSymptoms: boolean; includeIllness: boolean; includeRecovery: boolean; includeNotes: boolean
  question: string; additionalContext: string
  /** Internal coaching adapter can identify repeated references without changing default exports. */
  includeSessionIds?: boolean
}
export type ContextValue = string | number | boolean | null | ContextValue[] | { [key: string]: ContextValue }
export interface ContextRecord { title: string; facts: Record<string, ContextValue> }
export interface CoachingSection { key: ContextSection; title: string; scope: string[]; records: ContextRecord[] }
export interface CoachingDocument {
  format: 'athlete-lab-coaching-context'; version: 1; application: string; exportedAt: string; mode: ContextOptions['mode']
  reportingPeriod: { recentFrom: string; recentThrough: string; upcomingFrom: string; upcomingThrough: string }
  coachingQuestion: string; additionalAthleteContext: string; privacy: { identity: boolean; symptoms: boolean; illness: boolean; otherRecovery: boolean; freeTextNotes: boolean }
  interpretation: string[]; sections: CoachingSection[]
}
export function defaultContextOptions(mode: ContextOptions['mode'], today: string): ContextOptions {
  return { mode, historyStart: addDays(today, mode === 'quick' ? -13 : -89), historyEnd: today, upcomingStart: today, upcomingEnd: addDays(today, mode === 'quick' ? 6 : 27), sections: Object.keys(contextSections) as ContextSection[], includeIdentity: false, includeSymptoms: false, includeIllness: false, includeRecovery: false, includeNotes: false, question: '', additionalContext: '' }
}
export function validateContextOptions(options: ContextOptions): string | null {
  if (!['quick', 'detailed'].includes(options.mode)) return 'Choose Quick or Detailed Context.'
  if (![options.historyStart, options.historyEnd, options.upcomingStart, options.upcomingEnd].every(validDate)) return 'Choose valid dates for both reporting periods.'
  if (options.historyStart > options.historyEnd || options.upcomingStart > options.upcomingEnd) return 'Each start date must be on or before its end date.'
  if (!options.sections.length || options.sections.some(s => !Object.hasOwn(contextSections, s)) || new Set(options.sections).size !== options.sections.length) return 'Select at least one valid section.'
  if (options.question.length > 1000 || options.additionalContext.length > 3000) return 'Keep the question within 1,000 characters and additional context within 3,000.'
  return null
}
const ascending = <T extends { date: string }>(items: T[]) => [...items].sort((a, b) => a.date.localeCompare(b.date))
const unknown = (text: string) => text.trim() || 'Unknown / not recorded'
const percentage = (value: number | null) => value === null ? null : Math.round(value * 100) / 100
function prescription(ex: Exercise, notes: boolean): ContextValue {
  return { Exercise: ex.name, Sets: ex.sets, Prescription: ex.prescription, Rest: unknown(ex.rest), ...(notes && ex.notes ? { 'Coaching notes': ex.notes } : {}), ...(ex.skill ? { 'Skill area': ex.skill.area, Objective: ex.skill.objective, 'Success criterion': ex.skill.successCriteria, Foot: ex.skill.foot, 'Distance (m)': ex.skill.distance, Angle: unknown(ex.skill.angle), Pressure: ex.skill.pressure } : {}) }
}
/** Pure local projection. The same stored snapshot, options and timestamp produce identical outputs. */
export function generateCoachingContext(data: AppData, options: ContextOptions, exportedAt: string, appName = 'Athlete Lab'): CoachingDocument {
  const error = validateContextOptions(options)
  if (error) throw new Error(error)
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('Choose a valid export timestamp.')
  const recent = (date: string) => date >= options.historyStart && date <= options.historyEnd
  const upcoming = (date: string) => date >= options.upcomingStart && date <= options.upcomingEnd
  const detailed = options.mode === 'detailed'
  const logs = ascending(data.logs.filter(l => recent(l.date)))
  const entries = ascending(data.recoveryEntries.filter(e => recent(e.date)))
  const active = data.programmes.find(p => p.id === data.activeProgrammeId)
  const allCompleted = new Set(data.logs.map(l => l.sessionId))
  const planned = ascending(data.sessions.filter(s => !allCompleted.has(s.id)))
  const sections: CoachingSection[] = []
  function section(key: ContextSection, scope: string[], records: ContextRecord[]) {
    if (options.sections.includes(key)) sections.push({ key, title: contextSections[key], scope, records })
  }
  section('profile', ['Only stored profile fields are reported. A weekly target is a planning preference, not completed training.'], [{ title: 'Athlete', facts: {
    ...(options.includeIdentity ? { Name: unknown(data.profile.name) } : {}), Sport: unknown(data.profile.sport), Position: unknown(data.profile.position), 'Weekly workout target': data.profile.weeklyTarget,
    Goals: data.profile.goals.map(g => ({ Goal: g.title, Status: g.done ? 'Marked achieved by athlete' : 'Active goal' })),
    'Not separately recorded': 'Potential positions, training preferences, facilities/equipment, constraints and development priorities. Optional athlete-provided context appears at the beginning.'
  } }])
  const programmeSessions = planned.filter(s => s.programmeId === data.activeProgrammeId && (recent(s.date) || upcoming(s.date)))
  section('programme', ['Active programme only. These are prescriptions, not completed exercise performance.', 'An elapsed plan date does not prove missed training. The app does not keep rescheduling history.'], [
    { title: active?.name || 'Active programme unknown', facts: { ...(options.includeNotes && active?.description ? { Description: active.description } : {}), 'Training block / programme-specific goals': 'Not separately recorded', 'Current performance focus': data.performance.preferences.focusTestIds.map(id => data.performance.definitions.find(d => d.id === id)?.name || 'Historical measure') } },
    ...programmeSessions.map(s => ({ title: s.title, facts: { ...(options.includeSessionIds ? { 'Session record ID': s.id } : {}), Date: s.date, Status: s.proposed ? 'Proposed; no completion log' : 'Planned; no completion log', Type: s.category, 'Planned minutes': s.minutes, Prescriptions: s.exercises.map(e => prescription(e, options.includeNotes)), ...(options.includeNotes && s.notes ? { Notes: s.notes } : {}) } }))
  ])
  section('training', [`Recent window, all programmes: ${logs.length} completed workout logs; ${logs.reduce((n, l) => n + l.minutes, 0)} recorded minutes. Unlogged training is unknown.`, 'Exercise prescriptions are historical snapshots; only sets marked performed are counted. Running/cycling distances and times are not inferred from prescriptions or notes.', 'Explicit missed-training observations are available only when Other recovery observations is included. Rescheduling history is not recorded.'], logs.map(l => ({ title: l.title, facts: {
    Date: l.date, Status: 'Completed workout log (may be partial)', Type: l.category, 'Actual minutes': l.minutes, 'Session RPE (1–10)': l.rpe,
    'Sets marked performed': l.results.filter(r => r.done).length, 'Sets not marked performed': l.results.filter(r => !r.done).length,
    Exercises: l.exercises.map(ex => ({ Exercise: ex.name, 'Prescribed sets': ex.sets, Prescription: ex.prescription, 'Recorded set results': l.results.filter(r => r.exerciseId === ex.id && (detailed || r.done)).map(r => ({ Set: r.set, Performed: r.done, 'Reps (recorded text; blank is unknown)': r.reps || null, 'Load (kg; recorded text; blank is unknown)': r.load || null })) })),
    ...(l.skillResults ? { 'Skills results': 'Actual attempts are summarised in Football development; set checkboxes are not used for these logs.' } : {}), ...(options.includeNotes && l.notes ? { 'Athlete notes': l.notes } : {})
  } })))
  const recoveryRecords: ContextRecord[] = []
  for (const e of entries) {
    const facts: Record<string, ContextValue> = { Date: e.date }
    if (options.includeSymptoms && e.symptoms.length) facts['Reported symptoms'] = e.symptoms.map(s => ({ Type: s.kind, Location: s.location, Side: s.side, 'Severity (self-reported 0–10)': s.severity, 'Duration reported (days)': s.durationDays, ...(options.includeNotes && s.notes ? { Notes: s.notes } : {}) }))
    if (options.includeIllness) facts['Illness noted (self-report)'] = e.illness
    if (options.includeRecovery) {
      facts['Reported training availability'] = e.availability; facts['Missed training reported'] = e.missedTraining
      facts['Linked missed sessions (historical names)'] = e.missedSessions.map(s => ({ Date: s.date, Session: s.title }))
      if (options.includeNotes && e.notes) facts['Recovery observations'] = e.notes
    }
    if (Object.keys(facts).length > 1) recoveryRecords.push({ title: `Check-in ${e.date}`, facts })
  }
  if (options.includeSymptoms && detailed) {
    const groups = new Map<string, { date: string; severity: number | null; label: string }[]>()
    for (const e of entries) for (const s of e.symptoms) { const key = symptomKey(s); groups.set(key, [...(groups.get(key) || []), { date: e.date, severity: s.severity, label: `${s.side} ${s.location} / ${s.kind}` }]) }
    for (const rows of groups.values()) if (rows.length > 1) recoveryRecords.push({ title: `Observed symptom history: ${rows[0].label}`, facts: { 'Recorded observations': rows.length, 'First observation': rows[0], 'Latest observation': rows.at(-1)!, Interpretation: 'Observed reports only. No diagnosis, resolution, trend significance or medical clearance is inferred.' } })
  }
  section('recovery', [options.includeSymptoms || options.includeIllness || options.includeRecovery ? 'Only explicitly selected categories are included. Historical availability is not assumed current; absent check-ins are unknown.' : 'Sensitive recovery categories excluded. No health records or health-record counts are shared.', 'Outstanding concerns and symptom resolution are not inferred from old observations.'], recoveryRecords)
  const observations = practiceObservations(logs)
  const skillGroups = new Map<string, typeof observations>()
  for (const item of observations) { const key = comparisonKey(item); skillGroups.set(key, [...(skillGroups.get(key) || []), item]) }
  section('skills', [`${new Set(observations.map(o => o.log.id)).size} completed skills logs; ${observations.length} recorded result blocks in the recent window. Grouped by matching drill, objective, success criterion and actual conditions.`, 'Foot exposure counts attempts, not assumed proficiency. Conditions not recorded may conceal differences. Planned skills are not actual attempts.'], [...skillGroups.values()].map(items => {
    const first = items[0], result = first.result, summary = summarisePractice(items), trend = detailed ? comparisonTrend(items) : null
    return { title: first.drillName, facts: { 'Skill area': result.area, Objective: result.objective, 'Success criterion': result.successCriteria, Foot: result.foot, 'Distance (m)': result.distance, Angle: unknown(result.angle), Pressure: result.pressure, 'Dates recorded': [...new Set(items.map(o => o.log.date))], 'Completed logs (n)': summary.sessions, 'Successful attempts': summary.successes, Attempts: summary.attempts, 'Accuracy (%)': percentage(summary.rate), ...(trend ? { 'Earlier vs later comparable sessions': { 'Earlier successes': trend.earlier.successes, 'Earlier attempts': trend.earlier.attempts, 'Later successes': trend.recent.successes, 'Later attempts': trend.recent.attempts, 'Change (percentage points)': percentage(trend.change), Method: 'Earlier half vs later half of sessions, weighted by attempts; descriptive, not causal.' } } : {}) } }
  }))
  const historicalTests = ascending(data.performance.results.filter(r => r.date <= options.historyEnd))
  const focused = new Set(data.performance.preferences.focusTestIds)
  const relevantTests = !detailed && historicalTests.some(r => focused.has(r.testId)) ? historicalTests.filter(r => focused.has(r.testId)) : historicalTests
  const testGroups = comparableTestGroups(relevantTests)
  section('testing', ['Test comparisons use stored results through the reporting end date, including earlier history. Each group is separate: never compare across protocols, methods, units, equipment, conditions or quality.', !detailed && focused.size ? 'Quick mode prioritises dashboard focus tests when results exist; Detailed mode includes all tests.' : 'All recorded test types included.', 'Estimated and subjective results have no measured personal best. Small samples and measurement error limit interpretation.'], testGroups.map(group => {
    const latest = group.rows.at(-1)!, first = group.rows[0]
    return { title: latest.definition.name, facts: { 'Observations in this comparison group (n)': group.rows.length, Unit: latest.definition.unit, 'Better direction': latest.definition.direction, Calculation: latest.definition.calculation, Quality: latest.quality, Method: latest.protocol.method, Equipment: latest.protocol.equipment, 'Protocol used': latest.protocol.description, 'Operational definition': latest.definition.evidence.operationalDefinition, 'Evidence category': latest.definition.evidence.category, Reference: latest.definition.evidence.reference || null, Limitations: latest.definition.evidence.limitations || null, Conditions: Object.fromEntries(Object.entries(latest.protocol.details).filter(([, v]) => v).map(([k, v]) => [detailLabels[k as keyof typeof detailLabels], v])), 'Latest result': { Date: latest.date, Value: latest.value, 'Attempts (n)': latest.attemptCount, 'Successful attempts': latest.successes, ...(detailed ? { 'Individual attempts': latest.attempts } : {}) }, 'Comparable measured personal best': group.best ? { Date: group.best.date, Value: group.best.value, Unit: group.best.definition.unit } : null, ...(detailed ? { 'First result': { Date: first.date, Value: first.value }, 'Latest minus first (percentage points for %)': group.change, 'Historical results': group.rows.map(r => ({ Date: r.date, Value: r.value, 'Attempts (n)': r.attemptCount, 'Successful attempts': r.successes })) } : {}), ...(options.includeNotes && latest.notes ? { Notes: latest.notes } : {}) } }
  }))
  const matches = ascending(data.performance.matches.filter(m => recent(m.date)))
  section('matches', [`${matches.length} match records in the recent window. Sources, quality, metric definitions and scoring rules are preserved per match; no composite player rating is calculated.`, 'Partial shot samples do not establish full-match scoring totals. Conversion refers to the intended shot type; points use actual awarded outcomes.'], matches.map(m => {
    const scoring = matchScoring(m)
    return { title: `vs ${m.opponent}`, facts: { Date: m.date, Team: unknown(m.team), Competition: unknown(m.competition), Position: unknown(m.position), 'Minutes played': m.minutes, 'Match result': m.result, 'Final team score': unknown(m.finalScore), 'Observation source': m.source, 'Statistics quality': m.quality, 'Scoring entry': m.scoringMode, ...(m.scoringMode === 'Shots' ? { 'Shot coverage': m.shotCoverage } : {}), 'Scoring rules': { Name: m.rules.name, 'One-point weight': m.rules.one, 'Two-point weight': m.rules.two, 'Goal weight': m.rules.goal }, 'Full scoring contribution (points)': scoring.totalPoints, 'Known scoring subtotal (points; may be incomplete)': scoring.knownPoints, Scoring: shotTypes.map(t => ({ 'Intended shot type': shotLabels[t], Attempts: scoring.groups[t].attempts, Conversions: scoring.groups[t].successes, 'Conversion (%)': percentage(scoring.groups[t].rate), 'Unknown outcomes': scoring.groups[t].unresolved, 'Confirmed awarded scores of this type': scoring.awarded[t] })), Contributions: m.metrics.filter(r => r.value !== null).map(r => ({ Metric: r.definition.name, Value: r.value, Definition: r.definition.evidence.operationalDefinition, 'Evidence category': r.definition.evidence.category, Reference: r.definition.evidence.reference || null })), ...(detailed && m.shots.length ? { 'Individual shots': m.shots.map(s => ({ Type: shotLabels[s.type], Outcome: s.outcome, 'Distance (m)': s.distance, Angle: unknown(s.angle), Foot: s.foot, Pressure: s.pressure, 'Phase of play': s.play })) } : {}), ...(options.includeNotes ? { 'Qualitative observations (subjective)': Object.fromEntries(Object.entries(m.reflections).filter(([, v]) => v).map(([k, v]) => [reflectionLabels[k as keyof typeof reflectionLabels], v])), 'Tactical notes': m.tacticalNotes || null, 'Match conditions': m.conditions || null, 'Source details': m.sourceDetails || null } : {}) } }
  }))
  section('schedule', ['All programmes; only planned/proposed sessions without a completion log. The application does not separately record future match fixtures, commitments or availability. Unscheduled days are not assumed rest days.', 'Rescheduling history and confirmed future rest days are unknown. Add known commitments in the optional athlete-provided context.'], planned.filter(s => upcoming(s.date)).map(s => ({ title: s.title, facts: { ...(options.includeSessionIds ? { 'Session record ID': s.id } : {}), Date: s.date, Programme: data.programmes.find(p => p.id === s.programmeId)?.name || 'Unknown programme', Status: s.proposed ? 'Proposed, not completed' : 'Planned, not completed', Type: s.category, 'Planned minutes': s.minutes, ...(detailed ? { Prescriptions: s.exercises.map(e => prescription(e, options.includeNotes)) } : {}) } })))
  return { format: 'athlete-lab-coaching-context', version: 1, application: appName, exportedAt, mode: options.mode, reportingPeriod: { recentFrom: options.historyStart, recentThrough: options.historyEnd, upcomingFrom: options.upcomingStart, upcomingThrough: options.upcomingEnd }, coachingQuestion: options.question.trim(), additionalAthleteContext: options.additionalContext.trim(), privacy: { identity: options.includeIdentity, symptoms: options.includeSymptoms, illness: options.includeIllness, otherRecovery: options.includeRecovery, freeTextNotes: options.includeNotes }, interpretation: ['This is a deterministic context export, not an AI assessment or coaching recommendation.', 'Null / unknown means not recorded, not zero. Planned prescriptions are not performed work. No diagnoses, readiness decisions or causal conclusions are inferred.', 'Notes are athlete-entered observations, not independently verified facts. Titles, goals, questions and protocol descriptions may contain personal information; review before sharing.', 'No data has been transmitted. Submit this context to ChatGPT separately if you choose. This JSON is not a database backup.'], sections }
}
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/([`*_{}\[\]<>#|])/g, '\\$1').replace(/\r?\n/g, ' / ')
function markdownValue(value: ContextValue, indent = ''): string[] {
  if (Array.isArray(value)) return value.length ? value.flatMap(v => typeof v === 'object' && v !== null ? [`${indent}-`, ...markdownValue(v, indent + '  ')] : [`${indent}- ${v === null ? 'Unknown / not recorded' : escape(String(v))}`]) : [`${indent}- None recorded in this scope.`]
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([key, v]) => typeof v === 'object' && v !== null ? [`${indent}- **${escape(key)}:**`, ...markdownValue(v, indent + '  ')] : [`${indent}- **${escape(key)}:** ${v === null ? 'Unknown / not recorded' : escape(String(v))}`])
  return [`${indent}${value === null ? 'Unknown / not recorded' : escape(String(value))}`]
}
export function coachingMarkdown(document: CoachingDocument): string {
  const p = document.reportingPeriod
  return [`# ${escape(document.application)} — Coaching context export`, '', ...(document.coachingQuestion ? ['## Coaching question', escape(document.coachingQuestion), ''] : []), `Export date: ${document.exportedAt}`, `Mode: ${document.mode}`, `Recent reporting period: ${p.recentFrom} through ${p.recentThrough} (inclusive)`, `Upcoming period: ${p.upcomingFrom} through ${p.upcomingThrough} (inclusive)`, '', ...(document.additionalAthleteContext ? ['## Additional athlete-provided context', escape(document.additionalAthleteContext), ''] : []), ...document.interpretation.map(s => `- ${s}`), '', ...document.sections.flatMap(s => [`## ${s.title}`, '', ...s.scope.map(t => `- ${t}`), '', ...(s.records.length ? s.records.flatMap(r => [`### ${escape(r.title)}`, ...markdownValue(r.facts), '']) : ['No records included in this section.', ''])])].join('\n')
}
/** Optional application boundary for later adapters; no second history or export cache. */
export async function generateContextFromRepository(repository: Pick<AthleteRepository, 'load'>, options: ContextOptions, exportedAt: string, appName?: string) {
  return generateCoachingContext(await repository.load(), options, exportedAt, appName)
}
