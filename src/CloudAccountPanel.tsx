import { useState, type FormEvent } from 'react'
import type { AppData } from './domain'
import { backupCounts } from './backup'
import { exportData } from './repository'
import { supabase, cloudConfigurationError } from './supabase'
import type { useCloud } from './useCloud'

type Cloud = ReturnType<typeof useCloud>
export const syncLabels = { local: 'Saved on this device', setup: 'Cloud setup needed', syncing: 'Synchronising…', offline: 'Offline · changes kept locally', pending: 'Changes waiting to sync', synced: 'Cloud up to date', conflict: 'Cloud conflict · review needed', error: 'Sync needs attention' }
export function CloudAccountPanel({ data, cloud }: { data: AppData; cloud: Cloud }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin'), [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [consent, setConsent] = useState(false)
  const [choices, setChoices] = useState<Record<string, 'local' | 'cloud'>>({}), [confirmReview, setConfirmReview] = useState(false)
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'This action could not finish. Your local records are safe.') } finally { setBusy(false) }
  }
  const authenticate = (event: FormEvent) => {
    event.preventDefault()
    void act(async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const redirect = `${location.origin}/`
      if (cloud.recovery) {
        const result = await supabase.auth.updateUser({ password }); if (result.error) throw new Error('Unable to update the password. Request a new recovery email and try again.')
        cloud.finishRecovery(); setPassword(''); setMessage('Password updated.')
      } else if (mode === 'reset') {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect }); if (result.error) throw new Error('Recovery email could not be sent. Check your connection and try again.')
        setMessage('If an account exists, a recovery link will be sent. Open it in this browser to choose a new password.')
      } else if (mode === 'signup') {
        const result = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } }); if (result.error) throw new Error('Account creation failed. Check the email and password, or try signing in.')
        setPassword(''); setMessage('Check your email for a confirmation link if confirmation is required. Local records have not been uploaded.')
      } else {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (result.error) throw new Error('Sign-in failed. Check your email and password, or reset your password.')
        setPassword('')
      }
    })
  }
  const review = cloud.state?.review
  return <section className="panel stack mt-6 cloud-account" aria-labelledby="cloud-heading">
    <div className="section-heading"><h2 id="cloud-heading">Account & cloud sync</h2><span className="badge">{syncLabels[cloud.status.phase]}</span></div>
    <p className="muted small">Training stays available on this device offline. Cloud synchronisation is optional. Account data is kept separately from your original local records.</p>
    {!supabase ? <div className="notice">{cloudConfigurationError || 'Cloud access is not configured in this build. Local training, backups and Coaching Context remain available. Follow the Supabase setup in README to enable accounts.'}</div> : <>
      {(!cloud.user || cloud.recovery) && <form className="stack" onSubmit={authenticate}>
        {!cloud.recovery && <div className="flex flex-wrap gap-2">{([['signin', 'Sign in'], ['signup', 'Create account'], ['reset', 'Recover account']] as const).map(([value, label]) => <button className={`button secondary ${mode === value ? 'chosen' : ''}`} type="button" aria-pressed={mode === value} key={value} onClick={() => { setMode(value); setError(''); setMessage('') }}>{label}</button>)}</div>}
        {!cloud.recovery && <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>}
        {(mode !== 'reset' || cloud.recovery) && <label>{cloud.recovery ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'signin' && !cloud.recovery ? 'current-password' : 'new-password'} required minLength={mode === 'signup' || cloud.recovery ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>}
        <button className="button primary" disabled={busy || cloud.switching}>{busy ? 'Please wait…' : cloud.recovery ? 'Set new password' : mode === 'signin' ? 'Sign in securely' : mode === 'signup' ? 'Create my account' : 'Send recovery email'}</button>
      </form>}
      {cloud.user && !cloud.recovery && <>
        <p className="cloud-email">Signed in as <strong>{cloud.user.email}</strong></p>
        <p className="small" role="status">{syncLabels[cloud.status.phase]}{cloud.status.pending ? ` · ${cloud.status.pending} pending records` : ''}{cloud.status.lastSynced ? ` · Last sync ${new Date(cloud.status.lastSynced).toLocaleString('en-IE')}` : ''}</p>
        {cloud.status.message && <p className="error-text" role="alert">{cloud.status.message}</p>}
        {cloud.status.phase === 'setup' && <div className="stack cloud-migration">
          <h3>Choose how to connect this device</h3>
          <p className="small muted">Upload checks for existing cloud records first. Overlapping records require review. Opening cloud records keeps the original local dataset untouched; you can return to it by signing out. This shares your training and sensitive recovery records with your Supabase account.</p>
          <details><summary>Preview local records</summary><dl className="cloud-counts">{backupCounts(data).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl></details>
          <button className="button secondary" onClick={() => exportData(data)}>Download backup before connecting</button>
          <label className="goal-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I understand and approve linking the selected data to this account.</span></label>
          <div className="flex flex-wrap gap-3"><button className="button primary" disabled={!consent || busy} onClick={() => void act(async () => { await cloud.connect('upload', data); setConsent(false); await cloud.retry() })}>Upload local records</button><button className="button secondary" disabled={!consent || busy} onClick={() => void act(async () => { await cloud.connect('download', data); setConsent(false) })}>Open cloud records</button></div>
        </div>}
        {review && <div className="stack cloud-conflicts">
          <h3>Review conflicting changes</h3><p className="small muted">Nothing conflicting has been discarded. Editing is paused until you choose compatible versions. A deleted version removes the record; historical workout prescriptions remain within their workout logs.</p>
          {review.error && <p className="notice">{review.error}</p>}
          {!review.conflicts.length && !review.error && <p>These records can be merged without overlapping changes. Confirm to apply the previewed merge.</p>}
          {review.conflicts.map(conflict => <fieldset className="stack" key={conflict.key}><legend>{conflict.local.kind} · {conflict.local.id}</legend>{(['local', 'cloud'] as const).map(choice => {
            const row = choice === 'local' ? conflict.local : conflict.remote
            return <div key={choice}><label className="goal-check"><input type="radio" name={conflict.key} value={choice} checked={choices[conflict.key] === choice} onChange={() => setChoices({ ...choices, [conflict.key]: choice })}/><span>Keep {choice === 'local' ? 'this device’s' : 'cloud'} version{row.payload === null ? ' (deleted)' : ''}</span></label><details><summary>View {choice} version</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details></div>
          })}</fieldset>)}
          <button className="button secondary" onClick={() => exportData(data)}>Back up current local records</button>
          <label className="goal-check"><input type="checkbox" checked={confirmReview} onChange={e => setConfirmReview(e.target.checked)}/><span>I approve applying these choices to this device and synchronising them.</span></label>
          <button className="button primary" disabled={busy || !confirmReview || review.conflicts.some(c => !choices[c.key])} onClick={() => void act(async () => { await cloud.resolve(choices); setChoices({}); setConfirmReview(false) })}>Apply reviewed choices</button>
          <button className="button secondary" disabled={busy} onClick={() => { if (window.confirm('Replace this account’s local records with its complete cloud version? Export a backup first. Your original anonymous local records are kept.')) void act(async () => { await cloud.resolve({}, true); setChoices({}); setConfirmReview(false) }) }}>Use complete cloud version instead</button>
        </div>}
        <div className="flex flex-wrap gap-3">{cloud.state && <button className="button secondary" disabled={busy || cloud.status.phase === 'syncing'} onClick={() => void act(cloud.retry)}>Sync now / retry</button>}<button className="button secondary" disabled={busy} onClick={() => void act(async () => { const result = await supabase!.auth.signOut({ scope: 'local' }); if (result.error) throw new Error('Sign-out could not finish. Try again.'); setConsent(false); setChoices({}); setConfirmReview(false) })}>Sign out</button></div>
        <p className="small muted">Signing out returns to your original local dataset. Pending account changes remain on this device for the next sign-in. Browser storage is not encrypted; sign out and avoid shared devices for sensitive records.</p>
      </>}
    </>}
    {message && <p role="status">{message}</p>}{error && <p className="error-text" role="alert">{error}</p>}
  </section>
}
