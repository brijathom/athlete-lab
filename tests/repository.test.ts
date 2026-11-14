import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IndexedDBRepository } from '../src/repository'
import { openDB } from 'idb'
import { createInitialData } from '../src/domain'
describe('IndexedDB persistence', () => {
  it('seeds once and persists user changes across repository instances', async () => { const first = new IndexedDBRepository(); const seed = await first.load(); expect(seed.logs).toEqual([]); const updated = { ...seed, profile: { ...seed.profile, name: 'Test Athlete' }, sessions: seed.sessions.slice(1) }; await first.save(updated); const second = new IndexedDBRepository(); expect(await second.load()).toEqual(updated); expect((await second.load()).sessions).toHaveLength(4) })
  it('upgrades a stored Milestone 1 document in place without clearing records', async () => {
    const repo = new IndexedDBRepository()
    await repo.load()
    const db = await openDB('athlete-lab', 1)
    const { recoveryEntries: _, ...seed } = createInitialData()
    const legacy = { ...seed, version: 1, profile: { ...seed.profile, name: 'Preserved athlete' }, sessions: seed.sessions.slice(0, 2) }
    await db.put('state', legacy, 'app')
    const upgraded = await repo.load()
    expect(upgraded).toEqual({ ...legacy, version: 2, recoveryEntries: [] })
    expect(await db.get('state', 'app')).toEqual(upgraded)
    db.close()
  })
})
