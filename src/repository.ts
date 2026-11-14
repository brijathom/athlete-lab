import { openDB, type DBSchema } from 'idb'
import { createInitialData, type AppData } from './domain'
interface AthleteDB extends DBSchema { state: { key: string; value: AppData } }
// UI depends on this interface; future remote adapters can implement it.
export interface AthleteRepository { load(): Promise<AppData>; save(data: AppData): Promise<void> }
export class IndexedDBRepository implements AthleteRepository {
  private db = openDB<AthleteDB>('athlete-lab', 1, { upgrade(db) { db.createObjectStore('state') } })
  async load() { const db = await this.db; const existing = await db.get('state', 'app'); if (existing) { if (existing.version !== 1) throw new Error('This data version is unsupported.'); return existing } const data = createInitialData(); await db.put('state', data, 'app'); return data }
  async save(data: AppData) { await (await this.db).put('state', data, 'app') }
}
export function exportData(data: AppData) { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `athlete-lab-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
