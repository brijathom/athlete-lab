import { categories, migrateData, type AppData, type StoredAppData } from './domain'
import { BackupError, fail, object, text, number, boolean, choice, date, timestamp, list, id, records, type RecordValue } from './validation'
import { validatePerformanceData } from './performance-validation'
export { BackupError } from './validation'
import { feet, pressures, skillAreas } from './skills-domain'
import { availabilityOptions, bodyLocations, bodySides, symptomKinds } from './recovery-domain'

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024
const drillFields = ['area', 'objective', 'successCriteria', 'foot', 'distance', 'angle', 'pressure']
function drill(value: unknown, path: string, result = false) {
  const d = object(value, path, [...drillFields, ...(result ? ['id', 'exerciseId', 'attempts', 'successes'] : [])])
  choice(d.area, `${path}.area`, skillAreas); choice(d.foot, `${path}.foot`, feet); choice(d.pressure, `${path}.pressure`, pressures)
  text(d.objective, `${path}.objective`, 500, true); text(d.successCriteria, `${path}.successCriteria`, 500, true); text(d.angle, `${path}.angle`, 80)
  if (d.distance !== null) number(d.distance, `${path}.distance`, 0, 150, false)
  if (result) {
    id(d.id, `${path}.id`); id(d.exerciseId, `${path}.exerciseId`)
    if (d.attempts !== null || d.successes !== null) {
      number(d.attempts, `${path}.attempts`, 0, 10000); number(d.successes, `${path}.successes`, 0, d.attempts)
    }
  }
}
function exercise(value: unknown, path: string) {
  const e = object(value, path, ['id', 'name', 'sets', 'prescription', 'rest', 'notes'], ['skill','measurement'])
  id(e.id, `${path}.id`); text(e.name, `${path}.name`, 100, true); number(e.sets, `${path}.sets`, 1, 20)
  text(e.prescription, `${path}.prescription`, 300, true); text(e.rest, `${path}.rest`, 100); text(e.notes, `${path}.notes`, 1000)
  if (Object.hasOwn(e, 'skill')) drill(e.skill, `${path}.skill`)
  if(e.measurement!==undefined)choice(e.measurement,`${path}.measurement`,['reps','distance','duration'])
}
function training(value: unknown, path: string, log = false) {
  const s = object(value, path, ['id', 'title', 'date', 'category', 'minutes', 'notes', 'exercises', ...(log ? ['sessionId', 'rpe', 'results', 'savedAt'] : ['programmeId', 'proposed'])], log ? ['skillResults','team'] : ['focus','schedule','recurrence','status'])
  id(s.id, `${path}.id`); text(s.title, `${path}.title`, 100, true); date(s.date, `${path}.date`); choice(s.category, `${path}.category`, categories)
  const missed=log&&!!s.team&&typeof s.team==='object'&&(s.team as RecordValue).attended===false
  number(s.minutes, `${path}.minutes`, missed||s.category==='Rest'?0:1, 600); text(s.notes, `${path}.notes`, log ? 4000 : 2000)
  const exercises = records(s.exercises, `${path}.exercises`, exercise, 30)
  if (!exercises.length&&!['Team','Match','Rest'].includes(s.category as string)) fail(`${path}.exercises`, 'at least one prescription is required.')
  if (!log) {
    id(s.programmeId, `${path}.programmeId`); boolean(s.proposed, `${path}.proposed`)
    if(s.status!==undefined)choice(s.status,`${path}.status`,['planned','missed','cancelled'])
    if(s.focus!==undefined){const f=list(s.focus,`${path}.focus`,categories.length);f.forEach(c=>choice(c,`${path}.focus`,categories));if(new Set(f).size!==f.length)fail(path,'duplicate training categories.')}
    if(s.schedule!==undefined){const e=object(s.schedule,`${path}.schedule`,['startTime','timeZone','team','location','type','opponent','competition','attendance']);for(const k of ['startTime','timeZone','team','location','type','opponent','competition'])text(e[k],`${path}.${k}`,200);if(e.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.startTime as string))fail(path,'invalid local start time.');try{new Intl.DateTimeFormat('en',{timeZone:e.timeZone as string})}catch{fail(path,'invalid time zone.')};choice(e.attendance,`${path}.attendance`,['Expected','Unavailable','Undecided']);if(s.category==='Team'&&!(e.team as string).trim())fail(path,'team training needs a team or club.');if(s.category==='Match'&&!(e.opponent as string).trim())fail(path,'a fixture needs an opponent.')}
    if(['Team','Match'].includes(s.category as string)&&!s.schedule)fail(path,'team training and fixtures need scheduling details.')
    if(s.recurrence!==undefined){const r=object(s.recurrence,`${path}.recurrence`,['seriesId','until','exception']);id(r.seriesId,`${path}.seriesId`);date(r.until,`${path}.until`);boolean(r.exception,`${path}.exception`);if(!r.exception&&(r.until as string)<(s.date as string))fail(path,'recurrence ends before this occurrence.')}
    return
  }
  id(s.sessionId, `${path}.sessionId`); number(s.rpe, `${path}.rpe`, missed?0:1, 10); timestamp(s.savedAt, `${path}.savedAt`)
  if(s.team!==undefined){const t=object(s.team,`${path}.team`,['attended','participation'],['runningMetres','sprintMetres','technicalWork','matchPlayMinutes']);boolean(t.attended,`${path}.attended`);choice(t.participation,`${path}.participation`,['Full','Partial','None']);for(const k of ['runningMetres','sprintMetres'])if(t[k]!==undefined)number(t[k],`${path}.${k}`,0,100000,false);if(t.technicalWork!==undefined)text(t.technicalWork,`${path}.technicalWork`,2000);if(t.matchPlayMinutes!==undefined)number(t.matchPlayMinutes,`${path}.matchPlayMinutes`,0,s.minutes as number,false);if((!t.attended&&(s.minutes!==0||s.rpe!==0||t.participation!=='None'))||(t.attended&&t.participation==='None'))fail(path,'attendance and performed training disagree.')}
  if(s.category==='Team'&&!s.team)fail(path,'team training needs attendance and participation.')
  const setKeys = new Set<string>()
  const results = list(s.results, `${path}.results`, 600)
  results.forEach((value, i) => {
    const p = `${path}.results[${i + 1}]`, r = object(value, p, ['exerciseId', 'set', 'done', 'reps', 'load'],['distanceM','durationSeconds','effort','substitution'])
    id(r.exerciseId, `${p}.exerciseId`)
    const ex = exercises.find(e => e.id === r.exerciseId)
    if (!ex) fail(p, 'set refers to a missing historical exercise.')
    number(r.set, `${p}.set`, 1, ex!.sets as number); boolean(r.done, `${p}.done`)
    text(r.reps, `${p}.reps`, 100); text(r.load, `${p}.load`, 100)
    if (r.reps !== '' && (!/^\d+$/.test(r.reps) || Number(r.reps) > 10000)) fail(`${p}.reps`, 'expected whole reps from 0 to 10,000, or blank.')
    if (r.load !== '' && (!r.load.trim() || !Number.isFinite(Number(r.load)) || Number(r.load) < 0 || Number(r.load) > 2000)) fail(`${p}.load`, 'expected a load from 0 to 2,000, or blank.')
    const key = JSON.stringify([r.exerciseId, r.set])
    if (setKeys.has(key)) fail(p, 'duplicate exercise/set result.')
    setKeys.add(key)
    for(const [k,max] of [['distanceM',100000],['durationSeconds',86400],['effort',10]] as const)if(r[k]!==undefined)number(r[k],`${p}.${k}`,0,max,false)
    if(r.substitution!==undefined)text(r.substitution,`${p}.substitution`,200)
  })
  if (Object.hasOwn(s, 'skillResults')) {
    const blocks = records(s.skillResults, `${path}.skillResults`, (v, p) => drill(v, p, true), 120)
    if (!blocks.some(b => typeof b.attempts === 'number' && b.attempts > 0)) fail(`${path}.skillResults`, 'at least one actual attempt is required.')
    for (const block of blocks) if (!exercises.some(e => e.id === block.exerciseId && e.skill)) fail(`${path}.skillResults`, 'result refers to a missing historical drill.')
  } else if (!s.team&&!results.some(r => (r as RecordValue).done)) fail(`${path}.results`, 'at least one performed set is required.')
  if(missed&&results.length)fail(path,'a missed session cannot contain performed results.')
}
function recovery(value: unknown, path: string) {
  const r = object(value, path, ['id', 'date', 'availability', 'illness', 'missedTraining', 'missedSessions', 'symptoms', 'notes', 'savedAt'])
  id(r.id, `${path}.id`); date(r.date, `${path}.date`); choice(r.availability, `${path}.availability`, availabilityOptions)
  boolean(r.illness, `${path}.illness`); boolean(r.missedTraining, `${path}.missedTraining`); text(r.notes, `${path}.notes`, 4000); timestamp(r.savedAt, `${path}.savedAt`)
  const missed = records(r.missedSessions, `${path}.missedSessions`, (value, p) => {
    const s = object(value, p, ['sessionId', 'title', 'date']); id(s.sessionId, `${p}.sessionId`); text(s.title, `${p}.title`, 100, true); date(s.date, `${p}.date`)
    if (s.date !== r.date) fail(p, 'missed-session date must match the check-in date.')
  }, undefined, 'sessionId')
  if (!r.missedTraining && missed.length) fail(path, 'linked missed sessions require missed training to be recorded.')
  const symptoms = records(r.symptoms, `${path}.symptoms`, (value, p) => {
    const s = object(value, p, ['id', 'kind', 'location', 'side', 'severity', 'durationDays', 'notes'])
    id(s.id, `${p}.id`); choice(s.kind, `${p}.kind`, symptomKinds); choice(s.location, `${p}.location`, bodyLocations); choice(s.side, `${p}.side`, bodySides)
    number(s.severity, `${p}.severity`, 0, 10); if (s.durationDays !== null) number(s.durationDays, `${p}.durationDays`, 0, 3650, false)
    text(s.notes, `${p}.notes`, 1000)
  }, 20)
  if (!symptoms.length && r.availability === 'Not recorded' && !r.illness && !r.missedTraining && !(r.notes as string).trim()) fail(path, 'empty recovery observation.')
}

/** Checks the complete graph before migration or writes. Dates are preserved even if the device clock differs. */
export function validateBackupData(value: unknown): AppData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Backup', 'expected an exported JSON object.')
  const version = (value as RecordValue).version
  if (version !== 1 && version !== 2 && version !== 3&&version!==4) return fail('Backup version', 'only versions 1, 2, 3 and 4 are supported. Update the app if this backup is newer.')
  const data = object(value, 'Backup', ['version', 'programmes', 'activeProgrammeId', 'sessions', 'logs', 'profile', 'theme', ...(version >= 2 ? ['recoveryEntries'] : []), ...(version >= 3 ? ['performance'] : [])],['imports'])
  const programmes = records(data.programmes, 'Programmes', (value, p) => {
    const item = object(value, p, ['id', 'name', 'description'],['startDate','endDate']); id(item.id, `${p}.id`); text(item.name, `${p}.name`, 100, true); text(item.description, `${p}.description`, 500);for(const k of ['startDate','endDate'])if(item[k]!==undefined)date(item[k],`${p}.${k}`);if(item.startDate&&item.endDate&&(item.startDate as string)>(item.endDate as string))fail(p,'training block ends before it starts.')
  })
  id(data.activeProgrammeId, 'Active programme')
  const programmeIds = new Set(programmes.map(p => p.id))
  if (!programmeIds.has(data.activeProgrammeId)) fail('Active programme', 'does not refer to an included programme.')
  const sessions = records(data.sessions, 'Sessions', training)
  for (const s of sessions) if (!programmeIds.has(s.programmeId)) fail('Sessions', 'a planned session refers to a missing programme.')
  const logs = records(data.logs, 'Workout logs', (v, p) => training(v, p, true))
  if (new Set(logs.map(l => l.sessionId)).size !== logs.length) fail('Workout logs', 'more than one log refers to the same session.')
  const profile = object(data.profile, 'Profile', ['name', 'sport', 'position', 'weeklyTarget', 'goals'],['potentialPositions','priorities','preferences','equipment','constraints'])
  for (const key of ['name', 'sport', 'position']) text(profile[key], `Profile.${key}`, 80)
  number(profile.weeklyTarget, 'Weekly target', 1, 14)
  for(const k of ['potentialPositions','priorities','preferences','equipment','constraints'])if(profile[k]!==undefined)text(profile[k],`Profile.${k}`,1000)
  records(profile.goals, 'Goals', (value, p) => {
    const g = object(value, p, ['id', 'title', 'done']); id(g.id, `${p}.id`); text(g.title, `${p}.title`, 200, true); boolean(g.done, `${p}.done`)
  }, 20)
  choice(data.theme, 'Appearance preference', ['system', 'light', 'dark'])
  if (version >= 2) records(data.recoveryEntries, 'Recovery observations', recovery)
  if (version >= 3) {
    validatePerformanceData(data.performance)
    const fixtures=(data.performance as unknown as AppData['performance']).matches.flatMap(m=>m.fixtureId?[m.fixtureId]:[])
    if(new Set(fixtures).size!==fixtures.length)fail('Matches','more than one match result refers to the same fixture.')
  }
  if(data.imports!==undefined)records(data.imports,'Programme import receipts',(v,p)=>{const r=object(v,p,['key','fingerprint','at']);text(r.key,`${p}.key`,100,true);text(r.fingerprint,`${p}.fingerprint`,64,true);timestamp(r.at,`${p}.at`)},10000,'key')
  // Detach the validated document: later mutation of the input cannot change the restored snapshot.
  return migrateData(structuredClone(data) as unknown as StoredAppData)
}

export interface PreparedBackup { data: AppData; sourceVersion: 1 | 2 | 3 | 4; exportedAt: string }
export function parseBackup(contents: string): PreparedBackup {
  if (new TextEncoder().encode(contents).byteLength > MAX_BACKUP_BYTES) throw new BackupError('This backup exceeds the 25 MB import limit.')
  let value: unknown
  try { value = JSON.parse(contents.replace(/^\uFEFF/, '')) } catch { throw new BackupError('This file is not valid JSON. Choose the original exported .json backup.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Backup', 'expected an exported JSON object.')
  const { exportedAt, ...document } = value as RecordValue
  timestamp(exportedAt, 'Export date')
  return { data: validateBackupData(document), sourceVersion: document.version as 1 | 2 | 3 | 4, exportedAt: exportedAt as string }
}

export function backupCounts(data: AppData): [string, number][] {
  return [['Programmes', data.programmes.length], ['Planned / proposed sessions', data.sessions.length], ['Completed workouts', data.logs.length], ['Skills sessions planned', data.sessions.filter(s => s.category === 'Skills').length], ['Skills result blocks', data.logs.reduce((n, l) => n + (l.skillResults?.length || 0), 0)], ['Recovery observations', data.recoveryEntries.length], ['Illness observations', data.recoveryEntries.filter(e => e.illness).length], ['Symptoms recorded', data.recoveryEntries.reduce((n, e) => n + e.symptoms.length, 0)], ['Goals', data.profile.goals.length], ['Test definitions', data.performance.definitions.length], ['Test results', data.performance.results.length], ['Matches', data.performance.matches.length], ['Match metric definitions', data.performance.matchMetrics.length]]
}
