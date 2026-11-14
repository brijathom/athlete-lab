import { openDB, type DBSchema } from 'idb'
import { createInitialData, migrateData, type AppData, type LegacyAppData } from './domain'
import { validateBackupData } from './backup'
interface AthleteDB extends DBSchema { state: { key: string; value: AppData | LegacyAppData } }
// UI depends on this interface; future remote adapters can implement it.
export interface AthleteRepository { load(): Promise<AppData>; save(data: AppData): Promise<void>; restore(data: unknown): Promise<AppData> }
export class IndexedDBRepository implements AthleteRepository {
  private db = openDB<AthleteDB>('athlete-lab', 1, { upgrade(db) { db.createObjectStore('state') } })
  async load() { const db = await this.db; const existing = await db.get('state', 'app'); if (existing) { const data = migrateData(existing); if (existing.version !== data.version) await db.put('state', data, 'app'); return data } const data = createInitialData(); await db.put('state', data, 'app'); return data }
  async save(data: AppData) { await (await this.db).put('state', data, 'app') }
  async restore(candidate: unknown): Promise<AppData> {
    const data = validateBackupData(candidate)
    const db = await this.db
    const tx = db.transaction('state', 'readwrite')
    try {
      await tx.store.put(data, 'app')
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
