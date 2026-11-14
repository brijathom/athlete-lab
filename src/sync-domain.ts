import type { AppData } from './domain'
import { validateBackupData } from './backup'

export const recordKinds = ['programme', 'session', 'workout', 'recovery', 'testDefinition', 'testResult', 'match', 'matchMetric', 'profile', 'preferences', 'scoringRules'] as const
export type RecordKind = typeof recordKinds[number]
export interface CloudRecord { kind: RecordKind; id: string; revision: number; payload: unknown | null }
export type RecordMap = Record<string, CloudRecord>
export interface PendingChange { kind: RecordKind; id: string; expected_revision: number; payload: unknown | null }
export interface SyncConflict { key: string; local: CloudRecord; remote: CloudRecord }
export interface SyncState {
  version: 1; owner: string; base: RecordMap; pending: PendingChange[]; lastSynced: string | null
  review?: { records: RecordMap; remote: RecordMap; conflicts: SyncConflict[]; error: string | null }
}
export const recordKey = (row: Pick<CloudRecord, 'kind' | 'id'>) => `${row.kind}:${row.id}`
export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function toRecords(data: AppData): RecordMap {
  const records: RecordMap = {}
  const add = (kind: RecordKind, id: string, payload: unknown) => { const row = { kind, id, revision: 0, payload: structuredClone(payload) }; records[recordKey(row)] = row }
  const list = (kind: RecordKind, values: { id: string }[]) => values.forEach(row => add(kind, row.id, row))
  list('programme', data.programmes); list('session', data.sessions); list('workout', data.logs); list('recovery', data.recoveryEntries)
  list('testDefinition', data.performance.definitions); list('testResult', data.performance.results); list('match', data.performance.matches); list('matchMetric', data.performance.matchMetrics)
  add('profile', 'singleton', data.profile)
  add('preferences', 'singleton', { activeProgrammeId: data.activeProgrammeId, theme: data.theme, performance: data.performance.preferences })
  add('scoringRules', 'singleton', data.performance.scoringRules)
  return records
}
export function fromRecords(records: RecordMap): AppData {
  const rows = Object.values(records).filter(r => r.payload !== null)
  const list = (kind: RecordKind) => rows.filter(r => r.kind === kind).sort((a, b) => a.id.localeCompare(b.id)).map(r => r.payload)
  const one = (kind: RecordKind) => records[`${kind}:singleton`]?.payload
  const preferences = one('preferences') as { activeProgrammeId?: string; theme?: string; performance?: unknown } | null | undefined
  return validateBackupData({ version: 3, programmes: list('programme'), sessions: list('session'), logs: list('workout'), recoveryEntries: list('recovery'), profile: one('profile'), activeProgrammeId: preferences?.activeProgrammeId, theme: preferences?.theme, performance: { definitions: list('testDefinition'), results: list('testResult'), matches: list('match'), matchMetrics: list('matchMetric'), preferences: preferences?.performance, scoringRules: one('scoringRules') } })
}
export function parseRemote(value: unknown): RecordMap {
  if (!Array.isArray(value) || value.length > 100000) throw new Error('The cloud response is incompatible. Local data has been kept.')
  const result: RecordMap = {}
  for (const row of value) {
    if (!row || typeof row !== 'object' || !recordKinds.includes(row.kind) || typeof row.id !== 'string' || !row.id || row.id.length > 200 || !Number.isSafeInteger(row.revision) || row.revision < 1 || !(row.payload === null || (typeof row.payload === 'object' && !Array.isArray(row.payload)))) throw new Error('The cloud response contains an invalid record. Local data has been kept.')
    const clean: CloudRecord = { kind: row.kind, id: row.id, revision: row.revision, payload: row.payload }
    if (Object.hasOwn(result, recordKey(clean))) throw new Error('The cloud response contains duplicate records.')
    if (clean.payload !== null && !['profile', 'preferences', 'scoringRules'].includes(clean.kind) && (clean.payload as { id?: string }).id !== clean.id) throw new Error('A cloud record has a mismatched identifier.')
    result[recordKey(clean)] = clean
  }
  return result
}
export function pendingChanges(data: AppData, base: RecordMap): PendingChange[] {
  const local = toRecords(data)
  return [...new Set([...Object.keys(local), ...Object.keys(base)])].sort().flatMap(key => {
    const row = local[key] ?? base[key], payload = local[key]?.payload ?? null
    return same(payload, base[key]?.payload ?? null) ? [] : [{ kind: row.kind, id: row.id, expected_revision: base[key]?.revision ?? 0, payload }]
  })
}
/** Three-way merge. Revisions are server-owned; tombstones remain in the baseline forever. */
export function reconcile(data: AppData, base: RecordMap, remote: RecordMap) {
  const local = toRecords(data), records: RecordMap = {}, conflicts: SyncConflict[] = []
  for (const key of new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(remote)])) {
    const origin = base[key]?.payload ?? null, here = local[key]?.payload ?? null, there = remote[key]?.payload ?? null
    const row = remote[key] ?? base[key] ?? local[key]
    const localChanged = !same(here, origin), remoteChanged = !same(there, origin)
    const chosen = { ...row, payload: localChanged ? here : there }
    if (localChanged && remoteChanged && !same(here, there)) conflicts.push({ key, local: { ...row, payload: here }, remote: { ...row, payload: there } })
    records[key] = chosen
  }
  let error: string | null = null
  try { fromRecords(records) } catch { error = 'These changes affect related records. Choose compatible versions, or use the complete cloud version. Your current local records are still intact.' }
  return { records, remote, conflicts, error }
}
