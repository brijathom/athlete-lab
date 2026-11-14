import { dateKey, validDate } from './domain'

export const availabilityOptions = ['Not recorded', 'Full training', 'Modified training', 'Unavailable', 'Rest day'] as const
export type Availability = typeof availabilityOptions[number]
export const bodyLocations = ['Head', 'Neck', 'Shoulder', 'Upper arm', 'Elbow', 'Forearm', 'Wrist / hand', 'Chest / ribs', 'Upper back', 'Lower back', 'Hip / groin', 'Thigh / hamstring', 'Knee', 'Calf / shin', 'Ankle', 'Foot', 'Other'] as const
export const bodySides = ['Left', 'Right', 'Both', 'Central', 'Not applicable'] as const
export const symptomKinds = ['Muscle', 'Joint', 'Other'] as const
export interface RecoverySymptom {
  id: string
  kind: typeof symptomKinds[number]
  location: typeof bodyLocations[number] | ''
  side: typeof bodySides[number] | ''
  severity: number | null
  durationDays: number | null
  notes: string
}
export interface RecoveryEntry {
  id: string
  date: string
  availability: Availability
  illness: boolean
  missedTraining: boolean
  missedSessions: { sessionId: string; title: string; date: string }[]
  symptoms: RecoverySymptom[]
  notes: string
  savedAt: string
}
export function validateRecovery(entry: RecoveryEntry): string | null {
  if (!validDate(entry.date) || entry.date > dateKey()) return 'Choose today or an earlier date for a recovery check-in.'
  if (!availabilityOptions.includes(entry.availability)) return 'Choose a valid training availability.'
  if (entry.notes.length > 4000 || entry.symptoms.length > 20) return 'Keep observations within 4,000 characters and symptoms within 20 entries.'
  if (!entry.symptoms.length && entry.availability === 'Not recorded' && !entry.illness && !entry.missedTraining && !entry.notes.trim()) return 'Add an observation, symptom or training availability before saving.'
  if (!entry.missedTraining && entry.missedSessions.length) return 'Mark missed training before linking missed sessions.'
  if (new Set(entry.missedSessions.map(s => s.sessionId)).size !== entry.missedSessions.length || entry.missedSessions.some(s => s.date !== entry.date || !s.title.trim())) return 'Linked missed sessions must be unique and on the check-in date.'
  for (const symptom of entry.symptoms) {
    if (!symptomKinds.includes(symptom.kind) || !bodyLocations.includes(symptom.location as typeof bodyLocations[number]) || !bodySides.includes(symptom.side as typeof bodySides[number])) return 'Choose a symptom type, body location and side.'
    if (symptom.severity === null || !Number.isInteger(symptom.severity) || symptom.severity < 0 || symptom.severity > 10) return 'Rate each symptom from 0 (none) to 10 (most severe).'
    if (symptom.durationDays !== null && (!Number.isFinite(symptom.durationDays) || symptom.durationDays < 0 || symptom.durationDays > 3650)) return 'Symptom duration must be between 0 and 3,650 days, or left blank.'
    if (symptom.notes.length > 1000) return 'Keep each symptom observation within 1,000 characters.'
  }
  return null
}
export const symptomKey = (symptom: RecoverySymptom) => JSON.stringify([symptom.kind, symptom.location, symptom.side])
export function recoverySummary(entries: RecoveryEntry[]) {
  return {
    checkIns: entries.length,
    symptomDays: new Set(entries.filter(e => e.symptoms.some(s => s.severity !== null && s.severity > 0)).map(e => e.date)).size,
    illnessDays: new Set(entries.filter(e => e.illness).map(e => e.date)).size,
    missedDays: new Set(entries.filter(e => e.missedTraining).map(e => e.date)).size,
  }
}
