import { createPerformanceData } from '../src/performance-domain'
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { backupCounts, MAX_BACKUP_BYTES, parseBackup, validateBackupData } from '../src/backup'
import { IndexedDBRepository } from '../src/repository'
import { completeBackup, encodeBackup } from './fixtures/backup'

describe('complete backup validation and compatibility', () => {
  it('round-trips every field, preserves snapshots and deleted-plan references, and detaches the data', () => {
    const source = completeBackup(), before = structuredClone(source)
    const parsed = parseBackup('\uFEFF' + encodeBackup(source))
    expect(parsed).toEqual({ data: before, sourceVersion: 3, exportedAt: '2025-04-02T10:00:00.000Z' })
    expect(source).toEqual(before)
    const copy = validateBackupData(source)
    source.profile.name = 'Changed after validation'
    expect(copy).toEqual(before)
    expect(backupCounts(copy)).toContainEqual(['Skills result blocks', 1])
    expect(backupCounts(copy)).toContainEqual(['Illness observations', 1])
  })
  it('upgrades an original version 1 export without inventing recovery or skills results', () => {
    const { recoveryEntries: _, performance: _performance, ...data } = completeBackup()
    data.sessions = data.sessions.filter(s => s.category !== 'Skills')
    data.logs = data.logs.filter(l => !l.skillResults)
    const old = { ...data, version: 1 }
    const parsed = parseBackup(encodeBackup(old))
    expect(parsed.sourceVersion).toBe(1)
    expect(parsed.data).toEqual({ ...old, version: 3, recoveryEntries: [], performance: createPerformanceData() })
    expect(old.version).toBe(1)
  })
  it.each(['', '{', 'null', '[]', '42', '"text"'])('rejects malformed or non-object JSON: %s', contents => {
    expect(() => parseBackup(contents)).toThrow(/JSON|Backup/)
  })
  it('rejects oversized files before parsing', () => {
    expect(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow('25 MB')
  })
  it.each([
    ['future version', (d: any) => { d.version = 4 }, /version/],
    ['missing version', (d: any) => { delete d.version }, /version/],
    ['missing recovery records', (d: any) => { delete d.recoveryEntries }, /recoveryEntries/],
    ['missing results', (d: any) => { delete d.logs[0].results }, /results/],
    ['wrong nested type', (d: any) => { d.profile.name = null }, /Profile.name/],
    ['unknown preference', (d: any) => { d.theme = 'blue' }, /Appearance/],
    ['unknown field', (d: any) => { d.profile.futureField = 'x' }, /not supported/],
    ['empty programmes', (d: any) => { d.programmes = [] }, /Active programme/],
    ['bad active programme', (d: any) => { d.activeProgrammeId = 'missing' }, /Active programme/],
    ['duplicate programme ID', (d: any) => { d.programmes.push(d.programmes[0]) }, /duplicate/],
    ['duplicate session ID', (d: any) => { d.sessions.push(d.sessions[0]) }, /duplicate/],
    ['missing programme reference', (d: any) => { d.sessions[0].programmeId = 'missing' }, /missing programme/],
    ['duplicate exercise ID', (d: any) => { d.sessions[0].exercises.push(d.sessions[0].exercises[0]) }, /duplicate/],
    ['empty prescriptions', (d: any) => { d.logs[0].exercises = [] }, /prescription/],
    ['invalid date', (d: any) => { d.logs[0].date = '2025-02-30' }, /date/],
    ['nonfinite duration', (d: any) => { d.sessions[0].minutes = Infinity }, /minutes/],
    ['invalid timestamp', (d: any) => { d.logs[0].savedAt = '2025-02-30T00:00:00.000Z' }, /timestamp/],
    ['missing historical exercise', (d: any) => { d.logs[0].results[0].exerciseId = 'missing' }, /historical exercise/],
    ['out of range set', (d: any) => { d.logs[0].results[0].set = 99 }, /set/],
    ['duplicate set', (d: any) => { d.logs[0].results.push(d.logs[0].results[0]) }, /duplicate/],
    ['no completed sets', (d: any) => { d.logs[0].results[0].done = false }, /performed set/],
    ['invalid reps', (d: any) => { d.logs[0].results[0].reps = '-1' }, /reps/],
    ['invalid load', (d: any) => { d.logs[0].results[0].load = 'Infinity' }, /load/],
    ['duplicate session log', (d: any) => { d.logs[1].sessionId = d.logs[0].sessionId }, /same session/],
    ['bad skill reference', (d: any) => { d.logs[1].skillResults[0].exerciseId = 'missing' }, /historical drill/],
    ['successes above attempts', (d: any) => { d.logs[1].skillResults[0].successes = 11 }, /successes/],
    ['invalid skill foot', (d: any) => { d.logs[1].skillResults[0].foot = 'Other' }, /foot/],
    ['empty skill results', (d: any) => { d.logs[1].skillResults = [] }, /actual attempt/],
    ['missing skill objective', (d: any) => { delete d.sessions[5].exercises[0].skill.objective }, /objective/],
    ['invalid severity', (d: any) => { d.recoveryEntries[0].symptoms[0].severity = 11 }, /severity/],
    ['invalid symptom side', (d: any) => { d.recoveryEntries[0].symptoms[0].side = '' }, /side/],
    ['wrong missed date', (d: any) => { d.recoveryEntries[0].missedSessions[0].date = '2025-04-02' }, /check-in date/],
    ['unmarked missed training', (d: any) => { d.recoveryEntries[0].missedTraining = false }, /missed training/],
    ['invalid boolean', (d: any) => { d.recoveryEntries[0].illness = 'yes' }, /true or false/],
    ['duplicate goal', (d: any) => { d.profile.goals.push(d.profile.goals[0]) }, /duplicate/],
  ])('rejects %s before restoration', (_, change, message) => {
    const data = completeBackup(); change(data)
    expect(() => validateBackupData(data)).toThrow(message)
  })
  it('requires export metadata and rejects unknown fields instead of silently dropping data', () => {
    expect(() => parseBackup(JSON.stringify(completeBackup()))).toThrow('Export date')
    expect(() => parseBackup(encodeBackup({ ...completeBackup(), futureRecords: [] }))).toThrow('not supported')
    expect(() => parseBackup(encodeBackup(completeBackup()).replace('"version":3', '"__proto__":{},"version":3'))).toThrow('not supported')
  })
  it('permits exercise IDs reused in different sessions and preserves dates ahead of a device clock', () => {
    const data = completeBackup()
    data.sessions.push({ ...structuredClone(data.sessions[0]), id: 'duplicate-plan' })
    data.logs[0].date = '2099-01-01'
    expect(validateBackupData(data)).toEqual(data)
  })
})

describe('atomic IndexedDB restoration', () => {
  it('restores all data and survives a new repository instance', async () => {
    const repo = new IndexedDBRepository(), data = completeBackup()
    await repo.load()
    expect(await repo.restore(data)).toEqual(data)
    expect(await new IndexedDBRepository().load()).toEqual(data)
  })
  it('rejects invalid data without starting a write or modifying existing records', async () => {
    const repo = new IndexedDBRepository(), original = await repo.load()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await expect(repo.restore({ ...completeBackup(), sessions: null })).rejects.toThrow('Sessions')
      expect(put).not.toHaveBeenCalled()
      expect(await repo.load()).toEqual(original)
    } finally { put.mockRestore() }
  })
  it('retains the old document on quota failure and permits a subsequent restore', async () => {
    const repo = new IndexedDBRepository(), original = await repo.load(), replacement = completeBackup()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Storage full', 'QuotaExceededError') })
    try { await expect(repo.restore(completeBackup())).rejects.toThrow('Storage full') } finally { put.mockRestore() }
    expect(await repo.load()).toEqual(original)
    await repo.restore(replacement)
    expect(await repo.load()).toEqual(replacement)
  })
  it('rolls back even if put succeeds but the transaction aborts before commit', async () => {
    const repo = new IndexedDBRepository(), original = await repo.load(), replacement = completeBackup()
    replacement.profile.name = 'Must not be committed'
    const nativePut = IDBObjectStore.prototype.put
    let requestSucceeded = false
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = nativePut.apply(this, args)
      request.addEventListener('success', () => { requestSucceeded = true; request.transaction!.abort() })
      return request
    })
    try { await expect(repo.restore(replacement)).rejects.toThrow() } finally { put.mockRestore() }
    expect(requestSucceeded).toBe(true)
    expect(await new IndexedDBRepository().load()).toEqual(original)
    await repo.restore(replacement)
    expect(await repo.load()).toEqual(replacement)
  })
})

