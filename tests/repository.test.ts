import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { IndexedDBRepository } from '../src/repository'
describe('IndexedDB persistence', () => {
  it('seeds once and persists user changes across repository instances', async () => { const first = new IndexedDBRepository(); const seed = await first.load(); expect(seed.logs).toEqual([]); const updated = { ...seed, profile: { ...seed.profile, name: 'Test Athlete' }, sessions: seed.sessions.slice(1) }; await first.save(updated); const second = new IndexedDBRepository(); expect(await second.load()).toEqual(updated); expect((await second.load()).sessions).toHaveLength(4) })
})
