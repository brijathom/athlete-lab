import { createInitialData, type AppData } from '../../src/domain'
import type { SkillDrill } from '../../src/skills-domain'

// Synthetic fixtures only; never loaded into the application or a user's database.
export function completeBackup(): AppData {
  const data = createInitialData('2025-04-01')
  data.profile = { name: 'Backup test athlete', sport: 'Gaelic football', position: 'Midfielder', weeklyTarget: 3, goals: [{ id: 'goal-1', title: 'Test goal', done: true }] }
  data.theme = 'dark'
  data.programmes.push({ id: 'second-programme', name: 'Test skills programme', description: 'Synthetic backup fixture' })
  data.activeProgrammeId = 'second-programme'
  const skill: SkillDrill = { area: 'Two-point shooting', objective: 'Test objective', successCriteria: 'Test criterion', foot: 'Left', distance: 45, angle: 'Central', pressure: 'Active opposition' }
  const drill = { id: 'drill-1', name: 'Test shooting drill', sets: 1, prescription: '10 attempts', rest: '60 sec', notes: 'Test coaching note', skill }
  data.sessions.push({ id: 'skills-plan', programmeId: data.activeProgrammeId, title: 'Test skills plan', date: '2025-04-01', category: 'Skills', minutes: 20, notes: 'Proposed, not completed', proposed: true, exercises: [drill] })
  const exercise = { ...data.sessions[0].exercises[0], name: 'Historical prescription before plan edit' }
  data.logs = [
    { id: 'gym-log', sessionId: 'deleted-gym-plan', title: 'Historical test workout', date: '2025-03-31', category: 'Strength', minutes: 40, rpe: 5, notes: 'Historical notes', savedAt: '2025-03-31T18:00:00.000Z', exercises: [exercise], results: [{ exerciseId: exercise.id, set: 1, done: true, reps: '8', load: '12.5' }] },
    { id: 'skills-log', sessionId: 'deleted-skills-plan', title: 'Historical test practice', date: '2025-04-01', category: 'Skills', minutes: 25, rpe: 4, notes: 'Test practice notes', savedAt: '2025-04-01T18:00:00.000Z', exercises: [drill], results: [], skillResults: [{ ...skill, id: 'block-1', exerciseId: drill.id, foot: 'Right', distance: 40, attempts: 10, successes: 6 }] },
  ]
  data.recoveryEntries = [{ id: 'recovery-1', date: '2025-04-01', availability: 'Modified training', illness: true, missedTraining: true, notes: 'Test recovery note', savedAt: '2025-04-01T19:00:00.000Z', missedSessions: [{ sessionId: 'deleted-session', title: 'Historical missed plan', date: '2025-04-01' }], symptoms: [{ id: 'symptom-1', kind: 'Joint', location: 'Knee', side: 'Left', severity: 3, durationDays: 1.5, notes: 'Test symptom note' }] }]
  return data
}
export const encodeBackup = (data: unknown) => JSON.stringify({ exportedAt: '2025-04-02T10:00:00.000Z', ...(data as object) })
