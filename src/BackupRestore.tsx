import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, FileJson, RotateCcw } from 'lucide-react'
import type { AppData } from './domain'
import { backupCounts, MAX_BACKUP_BYTES, parseBackup, type PreparedBackup } from './backup'
import { exportData } from './repository'

export function BackupRestore({ current, restore, close, busy, cloudConnected = false }: {
  current: AppData; restore: (data: AppData) => Promise<void>; close: () => void; busy: boolean; cloudConnected?: boolean
}) {
  const [backup, setBackup] = useState<PreparedBackup | null>(null), [filename, setFilename] = useState('')
  const [error, setError] = useState(''), [reading, setReading] = useState(false), [confirmed, setConfirmed] = useState(false)
  const sequence = useRef(0)
  const currentCounts = backupCounts(current)
  useEffect(() => () => { sequence.current++ }, [])
  async function choose(file?: File) {
    const request = ++sequence.current
    setBackup(null); setConfirmed(false); setError(''); setFilename(file?.name || '')
    if (!file) { setReading(false); return }
    setReading(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This backup exceeds the 25 MB import limit.')
      const parsed = parseBackup(await file.text())
      if (request === sequence.current) setBackup(parsed)
    } catch (error) {
      if (request === sequence.current) setError(error instanceof Error ? error.message : 'This file could not be read. Choose the original JSON backup again.')
    } finally { if (request === sequence.current) setReading(false) }
  }
  async function submit() {
    if (!backup || !confirmed || busy) return
    setError('')
    try { await restore(backup.data) }
    catch { setError('Restore failed. Your previous data is still saved on this device. Check available storage and try again.'); setConfirmed(false) }
  }
  return <div className="modal-content stack">
    <p className="muted">Restore an Athlete Lab JSON export from this device or another device. The entire file is checked before anything is changed.</p>
    <label>Choose JSON backup<input type="file" accept=".json,application/json" disabled={busy} onChange={e => void choose(e.target.files?.[0])}/></label>
    <p className="muted small">Supports backup versions 1, 2, 3 and 4, up to 25 MB. Unsaved form edits are not included in backups.</p>
    {reading && <p role="status">Checking your backup…</p>}
    {backup && <section className="backup-preview stack" aria-label="Backup preview">
      <div className="flex items-center gap-2"><FileJson size={22}/><h3>Backup preview</h3></div>
      <p className="small backup-filename">{filename}</p>
      <dl className="backup-details"><dt>Exported</dt><dd>{new Date(backup.exportedAt).toLocaleString()}</dd><dt>Backup version</dt><dd>{backup.sourceVersion}</dd><dt>Athlete</dt><dd>{backup.data.profile.name || 'Name not entered'}</dd><dt>Active programme</dt><dd>{backup.data.programmes.find(p => p.id === backup.data.activeProgrammeId)!.name}</dd><dt>Appearance</dt><dd>{backup.data.theme}</dd><dt>Weekly target</dt><dd>{backup.data.profile.weeklyTarget} workouts</dd></dl>
      <table className="backup-table"><caption>Saved records to restore</caption><thead><tr><th scope="col">Contents</th><th scope="col">Backup</th><th scope="col">This device</th></tr></thead><tbody>{backupCounts(backup.data).map(([label, count], i) => <tr key={label}><th scope="row">{label}</th><td>{count}</td><td>{currentCounts[i][1]}</td></tr>)}</tbody></table>
      {backup.sourceVersion === 1 && <p className="notice">This older backup will be upgraded. It contains no recovery records; an empty recovery history will be restored.</p>}
      {backup.sourceVersion < 3 && <p className="notice">This backup predates Performance Testing and Match Analysis. Test and match histories will be empty; optional catalogue definitions will be added.</p>}
      <p className="small muted">Workout and drill prescriptions, results, profile, goals and preferences are preserved. Proposed sessions remain proposals.</p>
      <div className="notice">Restoration replaces the currently open dataset. It does not merge records and cannot be undone here. Export your current data first if you want to keep it. Close other Athlete Lab tabs before restoring. {cloudConnected && <strong>This account is connected: restored additions, changes and deletions will also synchronise to the cloud and other devices. Other accounts and the original local dataset are preserved.</strong>}</div>
      <button className="button secondary" disabled={busy} onClick={() => exportData(current)}><ArrowDownToLine size={18}/>Export current data</button>
      <label className="backup-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/><span>I understand this replaces all data on this device.</span></label>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={!backup || !confirmed || reading || busy} onClick={() => void submit()}><RotateCcw size={18}/>{busy ? 'Restoring…' : 'Restore backup'}</button></div>
  </div>
}
