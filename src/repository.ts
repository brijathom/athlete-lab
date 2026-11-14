import { openDB, type DBSchema } from 'idb'
import { createInitialData, migrateData, type AppData, type StoredAppData } from './domain'
import { validateBackupData } from './backup'
import { pendingChanges, same, type SyncState } from './sync-domain'
interface AthleteDB extends DBSchema { state: { key: string; value: StoredAppData | SyncState } }
// UI depends on this interface; future remote adapters can implement it.
export interface AthleteRepository { load(): Promise<AppData>; save(data: AppData): Promise<void>; restore(data: unknown): Promise<AppData> }
export class IndexedDBRepository implements AthleteRepository {
  private db
  private owner: string | null = null
  constructor(name = 'athlete-lab') { this.db = openDB<AthleteDB>(name, 1, { upgrade(db) { db.createObjectStore('state') } }) }
  private get key() { return this.owner ? `account:${this.owner}` : 'app' }
  get accountId() { return this.owner }
  async load() {
    const db = await this.db, key = this.key
    const existing = await db.get('state', key) as StoredAppData | undefined
    if (existing) { const data = migrateData(existing); if (existing.version !== data.version) await db.put('state', data, key); return data }
    if (this.owner) throw new Error('Connect this account before opening its local records.')
    const data = createInitialData(); await db.put('state', data, key); return data
  }
  async selectAccount(owner: string | null, stillValid = () => true): Promise<AppData | null> {
    const db = await this.db
    const exists = !owner || await db.get('state', `account:${owner}`)
    if (!stillValid()) return null
    if (!exists) { this.owner = null; return null }
    this.owner = owner
    return this.load()
  }
  async accountState(owner: string): Promise<{ data: AppData; sync: SyncState } | null> {
    const db = await this.db, tx = db.transaction('state', 'readonly')
    const data = await tx.store.get(`account:${owner}`) as AppData | undefined
    const sync = await tx.store.get(`sync:${owner}`) as SyncState | undefined
    await tx.done
    return data && sync ? { data, sync } : null
  }
  async initialiseAccount(owner: string, data: AppData, sync: SyncState) {
    const checked = validateBackupData(data), db = await this.db, tx = db.transaction('state', 'readwrite')
    if (await tx.store.get(`account:${owner}`)) { tx.abort(); await tx.done.catch(() => undefined); throw new Error('This account is already connected. Reload to open its records.') }
    await tx.store.put(checked, `account:${owner}`); await tx.store.put(sync, `sync:${owner}`); await tx.done
    return checked
  }
  async updateAccount(owner: string, update: (data: AppData, sync: SyncState) => { data: AppData; sync: SyncState }) {
    const db = await this.db, tx = db.transaction('state', 'readwrite')
    try {
      const data = await tx.store.get(`account:${owner}`) as AppData, sync = await tx.store.get(`sync:${owner}`) as SyncState
      if (!data || !sync || sync.owner !== owner) throw new Error('The local account is unavailable.')
      const next = update(data, sync)
      await tx.store.put(next.data, `account:${owner}`); await tx.store.put(next.sync, `sync:${owner}`); await tx.done
      return next
    } catch (error) { try { tx.abort() } catch { /* already ended */ } await tx.done.catch(() => undefined); throw error }
  }
  async save(data: AppData, expected?: AppData) {
    const owner = this.owner, key = this.key, db = await this.db, tx = db.transaction('state', 'readwrite')
    try {
      const current = await tx.store.get(key)
      if (expected && !same(current, expected)) throw new Error('Records changed in another tab or during synchronisation. Reload before saving; your existing data is safe.')
      if (owner) {
        const sync = await tx.store.get(`sync:${owner}`) as SyncState
        if (sync.review) throw new Error('Resolve the cloud conflict before editing these records. Export a backup if needed.')
        await tx.store.put({ ...sync, pending: pendingChanges(data, sync.base) }, `sync:${owner}`)
      }
      await tx.store.put(data, key); await tx.done
    } catch (error) { try { tx.abort() } catch { /* already ended */ } await tx.done.catch(() => undefined); throw error }
  }
  async restore(candidate: unknown): Promise<AppData> {
    const owner = this.owner, key = this.key
    const data = validateBackupData(candidate)
    const db = await this.db
    const tx = db.transaction('state', 'readwrite')
    try {
      if (owner) {
        const sync = await tx.store.get(`sync:${owner}`) as SyncState
        if (sync.review) throw new Error('Resolve cloud conflicts before restoring a backup.')
        await tx.store.put({ ...sync, pending: pendingChanges(data, sync.base) }, `sync:${owner}`)
      }
      await tx.store.put(data, key)
      // A successful put request is not enough: only a committed transaction is success.
      await tx.done
      return data
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted or completed. */ }
      await tx.done.catch(() => undefined)
      throw error
    }
  }
}
export function exportData(data: AppData) { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `athlete-lab-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
