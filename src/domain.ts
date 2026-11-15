import { validateSkillDrill, validateSkillResults, type SkillDrill, type SkillResult } from './skills-domain'
import type { RecoveryEntry } from './recovery-domain'
import { createPerformanceData, type PerformanceData } from './performance-domain'
export type Category = 'Strength' | 'Power' | 'Conditioning' | 'Speed' | 'Recovery' | 'Skills' | 'Tactical' | 'Team' | 'Match' | 'Testing' | 'Rest'
export type Theme = 'system' | 'light' | 'dark'
export interface Exercise { id: string; name: string; sets: number; prescription: string; rest: string; notes: string; skill?: SkillDrill; measurement?:'reps'|'distance'|'duration' }
export interface Schedule {startTime:string;timeZone:string;team:string;location:string;type:string;opponent:string;competition:string;attendance:'Expected'|'Unavailable'|'Undecided'}
export interface Session { id: string; programmeId: string; title: string; date: string; category: Category; minutes: number; notes: string; exercises: Exercise[]; proposed: boolean; focus?:Category[];schedule?:Schedule;recurrence?:{seriesId:string;until:string;exception:boolean};status?:'planned'|'missed'|'cancelled' }
export interface Programme { id: string; name: string; description: string;startDate?:string;endDate?:string }
export interface SetResult { exerciseId: string; set: number; done: boolean; reps: string; load: string;distanceM?:number;durationSeconds?:number;effort?:number;substitution?:string }
export interface TeamLog {attended:boolean;participation:'Full'|'Partial'|'None';runningMetres?:number;sprintMetres?:number;technicalWork?:string;matchPlayMinutes?:number}
export interface WorkoutLog { id: string; sessionId: string; title: string; category: Category; date: string; minutes: number; rpe: number; notes: string; results: SetResult[]; exercises: Exercise[]; savedAt: string; skillResults?: SkillResult[];team?:TeamLog }
export interface Profile { name: string; sport: string; position: string; weeklyTarget: number; goals: { id: string; title: string; done: boolean }[];potentialPositions?:string;priorities?:string;preferences?:string;equipment?:string;constraints?:string }
export interface AppData { version: 4; programmes: Programme[]; activeProgrammeId: string; sessions: Session[]; logs: WorkoutLog[]; profile: Profile; theme: Theme; recoveryEntries: RecoveryEntry[]; performance: PerformanceData;imports?:{key:string;fingerprint:string;at:string}[] }
export type Version3AppData=Omit<AppData,'version'> & {version:3}
export type Version2AppData = Omit<AppData, 'version' | 'performance'> & { version: 2 }
export type LegacyAppData = Omit<Version2AppData, 'version' | 'recoveryEntries'> & { version: 1 }
export type StoredAppData = AppData | Version3AppData | Version2AppData | LegacyAppData
export function migrateData(data: StoredAppData): AppData {
  if (data.version === 1) return { ...data, version: 4, recoveryEntries: [], performance: createPerformanceData() }
  if (data.version === 2 && Array.isArray(data.recoveryEntries)) return { ...data, version: 4, performance: createPerformanceData() }
  if (data.version===4 && Array.isArray(data.recoveryEntries) && data.performance) return data
  if (data.version===3 && Array.isArray(data.recoveryEntries) && data.performance) return {...data,version:4}
  throw new Error('This data version is unsupported.')
}
export const categories: Category[] = ['Strength','Power','Conditioning','Speed','Recovery','Skills','Tactical','Team','Match','Testing','Rest']
export const uid = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // getRandomValues also works on HTTP LAN previews where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const dateKey = (date = new Date()): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const fromDate = (value: string) => new Date(`${value}T12:00:00`)
export const addDays = (value: string, amount: number) => { const date = fromDate(value); date.setDate(date.getDate() + amount); return dateKey(date) }
export const weekStart = (value: string) => addDays(value, -((fromDate(value).getDay() + 6) % 7))
export const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) => fromDate(value).toLocaleDateString('en-IE', options)
export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromDate(value).getTime()) && dateKey(fromDate(value)) === value
export function validateSession(session: Session): string | null {
  if (!session.title.trim() || session.title.length > 100) return 'Enter a session title of 1–100 characters.'
  if (!validDate(session.date)) return 'Choose a valid session date.'
  if (!Number.isInteger(session.minutes) || session.minutes < (session.category==='Rest'?0:1) || session.minutes > 600) return 'Duration must be between 1 and 600 minutes (zero for a rest day).'
  if (!categories.includes(session.category)) return 'Choose a session type.'
  if ((!['Team','Match','Rest'].includes(session.category)&&!session.exercises.length) || session.exercises.length > 30) return 'Add between 1 and 30 exercises.'
  if(session.focus?.some(c=>!categories.includes(c)))return 'Choose valid training categories.'
  if(session.schedule){const s=session.schedule;if(s.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.startTime))return 'Use a valid local start time.';try{new Intl.DateTimeFormat('en',{timeZone:s.timeZone})}catch{return 'Choose a valid time zone.'}if(session.category==='Team'&&!s.team.trim())return 'Enter the team or club.';if(session.category==='Match'&&!s.opponent.trim())return 'Enter the opponent.'}
  if(session.recurrence&&(!validDate(session.recurrence.until)||(!session.recurrence.exception&&session.recurrence.until<session.date)))return 'The recurrence end date must include this occurrence.'
  if (session.exercises.some(e => !e.name.trim() || e.name.length > 100 || !e.prescription.trim() || e.prescription.length > 300 || !Number.isInteger(e.sets) || e.sets < 1 || e.sets > 20)) return 'Each exercise needs a name, a prescription and 1–20 sets.'
  for (const exercise of session.exercises) { if (exercise.skill) { const error = validateSkillDrill(exercise.skill); if (error) return error } }
  return null
}
export function validateLog(log: WorkoutLog): string | null {
  if (!validDate(log.date) || log.date > dateKey()) return 'The completion date must be today or earlier.'
  if(log.team&&!log.team.attended)return log.minutes===0&&log.rpe===0&&log.team.participation==='None'&&!log.results.length?null:'A missed team session must have zero duration and effort, with no performed work.'
  if (!Number.isInteger(log.minutes) || log.minutes < 1 || log.minutes > 600) return 'Enter an actual duration between 1 and 600 minutes.'
  if (!Number.isInteger(log.rpe) || log.rpe < 1 || log.rpe > 10) return 'Choose an effort rating from 1 to 10.'
  if (log.skillResults) { const error = validateSkillResults(log.skillResults, log.exercises); if (error) return error }
  else if (!log.team && !log.results.some(r => r.done)) return 'Mark at least one set as performed before saving.'
  if(log.team&&log.team.participation==='None')return 'Choose full or partial participation.'
  if(log.results.some(r=>(r.distanceM!==undefined&&(!Number.isFinite(r.distanceM)||r.distanceM<0||r.distanceM>100000))||(r.durationSeconds!==undefined&&(!Number.isFinite(r.durationSeconds)||r.durationSeconds<0||r.durationSeconds>86400))||(r.effort!==undefined&&(!Number.isFinite(r.effort)||r.effort<0||r.effort>10))))return 'Check actual distances, durations and effort.'
  if (log.results.some(r => (r.reps !== '' && (!/^\d+$/.test(r.reps) || Number(r.reps) > 10000)) || (r.load !== '' && (!Number.isFinite(Number(r.load)) || Number(r.load) < 0 || Number(r.load) > 2000)))) return 'Reps must be whole numbers (0–10,000); load must be 0–2,000 kg.'
  return null
}
export function createInitialData(today = dateKey()): AppData {
  const programmeId = 'gaelic-performance'
  const exercise = (name: string, sets: number, prescription: string, rest: string, notes = ''): Exercise => ({ id: uid(), name, sets, prescription, rest, notes })
  const templates: Omit<Session, 'id' | 'date' | 'programmeId' | 'proposed'>[] = [
    { title: 'Lower-body strength', category: 'Strength', minutes: 55, notes: 'Proposed foundation session. Adapt loads and movements to your experience, equipment and coaching plan. Warm up before starting.', exercises: [exercise('Dynamic warm-up', 1, '8 min · easy movement, mobility and bodyweight squats', 'As needed'), exercise('Goblet squat', 3, '8 controlled reps · choose a comfortable load', '90 sec', 'Keep a steady tempo and leave a few reps in reserve.'), exercise('Romanian deadlift', 3, '8 reps · light to moderate load', '90 sec'), exercise('Reverse lunge', 3, '8 reps each side', '60 sec'), exercise('Side plank', 2, '20–30 sec each side', '30 sec')] },
    { title: 'Aerobic engine', category: 'Conditioning', minutes: 35, notes: 'Proposed easy conditioning session. Keep the pace conversational and adjust the duration to your current fitness.', exercises: [exercise('Easy warm-up', 1, '5 min walk or easy jog', 'As needed'), exercise('Steady aerobic run', 1, '20 min · conversational pace', 'As needed'), exercise('Cool-down', 1, '5–10 min easy walk and mobility', 'As needed')] },
    { title: 'Move & recover', category: 'Recovery', minutes: 20, notes: 'Proposed low-intensity movement. Use a comfortable range of motion.', exercises: [exercise('Easy walk', 1, '10 min at a relaxed pace', 'As needed'), exercise('Hip and ankle mobility', 2, '60 sec each side', '30 sec'), exercise('Thoracic rotations', 2, '8 reps each side', '30 sec')] },
    { title: 'Acceleration & ball work', category: 'Speed', minutes: 40, notes: 'Proposed pitch session. Prioritise movement quality; take full recovery between runs.', exercises: [exercise('Progressive warm-up', 1, '10 min · easy running, skips and build-ups', 'As needed'), exercise('Controlled accelerations', 4, '15 m · build speed progressively', '2 min'), exercise('Solo and hand-pass practice', 3, '3 min · both sides', '60 sec'), exercise('Easy cool-down', 1, '5 min walk', 'As needed')] },
    { title: 'Upper-body & trunk', category: 'Strength', minutes: 45, notes: 'Proposed strength session. Choose variations suited to your ability.', exercises: [exercise('Dynamic warm-up', 1, '5–8 min · shoulder and trunk mobility', 'As needed'), exercise('Push-up', 3, '6–10 reps · incline if needed', '90 sec'), exercise('Single-arm row', 3, '10 reps each side', '90 sec'), exercise('Dead bug', 3, '8 reps each side', '45 sec')] }
  ]
  return { version: 4, performance: createPerformanceData(), recoveryEntries: [], programmes: [{ id: programmeId, name: 'Gaelic Football Performance', description: 'Build strength. Move faster. Be ready for the pitch.' }], activeProgrammeId: programmeId, sessions: templates.map((t, i) => ({ ...t, id: uid(), programmeId, date: addDays(today, [0, 1, 2, 4, 6][i]), proposed: true })), logs: [], profile: { name: '', sport: 'Gaelic football', position: '', weeklyTarget: 4, goals: [] }, theme: 'system' }
}
