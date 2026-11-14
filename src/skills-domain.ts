import type { Exercise, WorkoutLog } from './domain'

export const skillAreas = [
  'One-point shooting', 'Two-point shooting', 'Goal finishing', 'Free-taking',
  'Short kick-passing', 'Long kick-passing', 'Both-foot development',
  'Ball carrying and soloing', 'First touch and fielding', 'Marking and defending',
  'Separation and deception', 'Tactical intelligence and decisions',
] as const
export type SkillArea = typeof skillAreas[number]
export const feet = ['Unspecified', 'Left', 'Right', 'Both', 'Not applicable'] as const
export type Foot = typeof feet[number]
export const pressures = ['Unspecified', 'Unopposed', 'Passive opposition', 'Active opposition', 'Match-like'] as const
export type Pressure = typeof pressures[number]
export interface SkillDrill {
  area: SkillArea
  objective: string
  successCriteria: string
  foot: Foot
  distance: number | null
  angle: string
  pressure: Pressure
}
export interface SkillResult extends SkillDrill {
  id: string
  exerciseId: string
  attempts: number | null
  successes: number | null
}
export const blankSkill = (): SkillDrill => ({ area: 'One-point shooting', objective: '', successCriteria: '', foot: 'Unspecified', distance: null, angle: '', pressure: 'Unspecified' })
export function validateSkillDrill(drill: SkillDrill): string | null {
  if (!skillAreas.includes(drill.area)) return 'Choose a supported skill area.'
  if (!drill.objective.trim() || drill.objective.length > 500) return 'Each drill needs a practice objective (up to 500 characters).'
  if (!drill.successCriteria.trim() || drill.successCriteria.length > 500) return 'Define what counts as a successful attempt for each drill.'
  if (!feet.includes(drill.foot) || !pressures.includes(drill.pressure)) return 'Choose a valid foot and pressure level.'
  if (drill.distance !== null && (!Number.isFinite(drill.distance) || drill.distance < 0 || drill.distance > 150)) return 'Distance must be between 0 and 150 metres, or left blank.'
  if (drill.angle.length > 80) return 'Keep the angle description within 80 characters.'
  return null
}
export function validateSkillResults(results: SkillResult[], exercises: Exercise[]): string | null {
  if (!results.length || results.length > 120) return 'Record between 1 and 120 drill blocks.'
  let recorded = false
  const ids = new Set<string>()
  for (const result of results) {
    if (ids.has(result.id)) return 'Each drill block must have a unique identifier.'
    ids.add(result.id)
    if (!exercises.some(e => e.id === result.exerciseId && e.skill)) return 'A practice result must belong to a prescribed drill.'
    const error = validateSkillDrill(result)
    if (error) return error
    if (result.attempts === null && result.successes === null) continue
    if (result.attempts === null || !Number.isInteger(result.attempts) || result.attempts < 0 || result.attempts > 10000) return 'Attempts must be a whole number between 0 and 10,000.'
    if (result.successes === null || !Number.isInteger(result.successes) || result.successes < 0 || result.successes > result.attempts) return 'Successful attempts must be a whole number from 0 up to the attempt count.'
    if (result.attempts > 0) recorded = true
  }
  return recorded ? null : 'Record at least one actual attempt before saving.'
}
export interface PracticeObservation { log: WorkoutLog; result: SkillResult; drillName: string }
export function practiceObservations(logs: WorkoutLog[]): PracticeObservation[] {
  return logs.flatMap(log => (log.skillResults || []).filter(r => r.attempts !== null && r.attempts > 0 && r.successes !== null).map(result => ({ log, result, drillName: log.exercises.find(e => e.id === result.exerciseId)?.name || log.title })))
}
const normalise = (text: string) => text.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
export function comparisonKey(observation: PracticeObservation): string {
  const { result: r, drillName } = observation
  return JSON.stringify([r.area, normalise(drillName), normalise(r.objective), normalise(r.successCriteria), r.foot, r.distance, normalise(r.angle), r.pressure])
}
export function summarisePractice(items: PracticeObservation[]) {
  const attempts = items.reduce((sum, item) => sum + (item.result.attempts || 0), 0)
  const successes = items.reduce((sum, item) => sum + (item.result.successes || 0), 0)
  return { attempts, successes, rate: attempts ? successes / attempts * 100 : null, sessions: new Set(items.map(item => item.log.id)).size }
}
export function comparisonTrend(items: PracticeObservation[]) {
  if (new Set(items.map(comparisonKey)).size !== 1) return null
  const bySession = new Map<string, PracticeObservation[]>()
  for (const item of items) bySession.set(item.log.id, [...(bySession.get(item.log.id) || []), item])
  const sessions = [...bySession.values()].sort((a, b) => a[0].log.date.localeCompare(b[0].log.date) || a[0].log.savedAt.localeCompare(b[0].log.savedAt))
  if (sessions.length < 2) return null
  const split = Math.floor(sessions.length / 2)
  const earlier = summarisePractice(sessions.slice(0, split).flat())
  const recent = summarisePractice(sessions.slice(split).flat())
  return { earlier, recent, change: recent.rate! - earlier.rate! }
}
