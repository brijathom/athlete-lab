import type { AppData } from './domain'
import type { IndexedDBRepository } from './repository'
import { fromRecords, parseRemote, pendingChanges, reconcile, type PendingChange, type RecordMap, type SyncState } from './sync-domain'

export interface CloudTransport {
  exchange(changes: PendingChange[]): Promise<{ applied: boolean; records: RecordMap }>
}
export interface SyncStatus { phase: 'local' | 'setup' | 'syncing' | 'offline' | 'pending' | 'synced' | 'conflict' | 'error'; pending: number; lastSynced: string | null; message?: string }
export class CloudSync {
  private running = false
  constructor(private repo: IndexedDBRepository, private owner: string, private transport: CloudTransport, private changed: (data: AppData, state: SyncState) => void, private paused = () => false) {}
  async connect(mode: 'upload' | 'download', local: AppData) {
    const remote = (await this.transport.exchange([])).records
    if (this.paused()) throw new Error('Account connection was interrupted. Your original local records are unchanged.')
    const empty = !Object.values(remote).some(r => r.payload !== null)
    if (mode === 'download' && empty) throw new Error('This account has no cloud data yet. Upload your local records instead.')
    const data = mode === 'download' ? fromRecords(remote) : local
    const review = mode === 'upload' && !empty ? reconcile(local, {}, remote) : undefined
    const sync: SyncState = { version: 1, owner: this.owner, base: mode === 'download' ? remote : {}, pending: mode === 'download' ? [] : pendingChanges(data, {}), lastSynced: null, ...(review ? { review } : {}) }
    const checked = await this.repo.initialiseAccount(this.owner, data, sync)
    const selected = await this.repo.selectAccount(this.owner, () => !this.paused())
    if (!selected || this.paused()) throw new Error('The active account changed. The original local records are unchanged.')
    this.changed(checked, sync)
    return sync
  }
  async sync(): Promise<SyncState | null> {
    if (this.running || this.paused()) return null
    this.running = true
    try {
      const stored = await this.repo.accountState(this.owner)
      if (!stored || stored.sync.review) return stored?.sync ?? null
      // Always pull before pushing; no stale batch is allowed to overwrite a newer revision.
      let remote = (await this.transport.exchange([])).records
      if (this.paused()) return null
      let updated = await this.integrate(remote)
      if (updated.sync.review || !updated.sync.pending.length) return updated.sync
      const response = await this.transport.exchange(updated.sync.pending)
      remote = response.records
      if (this.paused()) return null
      // On an acknowledged push, base advances to the accepted batch. Any edits made while
      // the request was in flight are rebased, rather than overwritten or incorrectly conflicted.
      if (response.applied) {
        const sent = updated.sync.pending
        updated = await this.repo.updateAccount(this.owner, (data, sync) => {
          const base = { ...sync.base }
          for (const change of sent) {
            const key = `${change.kind}:${change.id}`
            if (remote[key] && remote[key].revision >= (base[key]?.revision ?? 0)) base[key] = remote[key]
          }
          return { data, sync: { ...sync, base, pending: pendingChanges(data, base) } }
        })
      }
      updated = await this.integrate(remote)
      return updated.sync
    } finally { this.running = false }
  }
  private async integrate(remote: RecordMap) {
    const updated = await this.repo.updateAccount(this.owner, (data, sync) => {
      if (sync.review) return { data, sync }
      // A different tab may already have processed a newer server snapshot.
      if (Object.entries(sync.base).some(([key, row]) => remote[key] && remote[key].revision < row.revision)) return { data, sync }
      const review = reconcile(data, sync.base, remote)
      if (review.conflicts.length || review.error) return { data, sync: { ...sync, review } }
      const merged = fromRecords(review.records)
      return { data: merged, sync: { ...sync, base: remote, pending: pendingChanges(merged, remote), lastSynced: new Date().toISOString() } }
    })
    this.changed(updated.data, updated.sync)
    return updated
  }
  async resolve(choices: Record<string, 'local' | 'cloud'>, useCompleteCloud = false) {
    const updated = await this.repo.updateAccount(this.owner, (data, sync) => {
      if (!sync.review) throw new Error('This conflict has already been resolved.')
      const { review } = sync
      const records = structuredClone(useCompleteCloud ? review.remote : review.records)
      if (!useCompleteCloud) for (const conflict of review.conflicts) {
        if (!choices[conflict.key]) throw new Error('Choose a version for every conflicting record.')
        records[conflict.key] = choices[conflict.key] === 'local' ? conflict.local : conflict.remote
      }
      let merged: AppData
      try { merged = fromRecords(records) } catch { throw new Error('These choices leave missing or incompatible related records. Choose matching versions or use the complete cloud version. Nothing has been replaced.') }
      return { data: merged, sync: { ...sync, base: review.remote, pending: pendingChanges(merged, review.remote), review: undefined } }
    })
    this.changed(updated.data, updated.sync)
    return updated.sync
  }
}
export function checkedExchange(value: unknown): { applied: boolean; records: RecordMap } {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('applied' in value) || typeof value.applied !== 'boolean' || !('records' in value)) throw new Error('The cloud schema is incompatible. Apply the Athlete Lab migrations before syncing.')
  return { applied: value.applied, records: parseRemote(value.records) }
}
