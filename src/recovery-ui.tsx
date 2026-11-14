import { useState, type FormEvent } from 'react'
import { ArrowRight, HeartPulse, Plus, Trash2 } from 'lucide-react'
import { addDays, dateKey, formatDate, uid, type Session } from './domain'
import { Badge, Empty } from './components'
import { availabilityOptions, bodyLocations, bodySides, recoverySummary, symptomKey, symptomKinds, validateRecovery, type RecoveryEntry, type RecoverySymptom } from './recovery-domain'

export function RecoveryForm({ entry, date, sessions, save, close, busy }: { entry?: RecoveryEntry; date: string; sessions: Session[]; save: (entry: RecoveryEntry) => Promise<boolean>; close: () => void; busy: boolean }) {
  const [draft, setDraft] = useState<RecoveryEntry>(() => entry ? structuredClone(entry) : { id: uid(), date, availability: 'Not recorded', illness: false, missedTraining: false, missedSessions: [], symptoms: [], notes: '', savedAt: '' })
  const [error, setError] = useState('')
  const update = (patch: Partial<RecoveryEntry>) => setDraft(d => ({ ...d, ...patch }))
  const symptom = (id: string, patch: Partial<RecoverySymptom>) => update({ symptoms: draft.symptoms.map(s => s.id === id ? { ...s, ...patch } : s) })
  const availableSessions = sessions.filter(s => s.date === draft.date)
  const missedOptions = [...availableSessions.map(s => ({ sessionId: s.id, title: s.title, date: s.date })), ...draft.missedSessions.filter(m => !availableSessions.some(s => s.id === m.sessionId))]
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const error = validateRecovery(draft)
    if (error) return setError(error)
    if (await save({ ...draft, savedAt: new Date().toISOString() })) close()
  }
  return <form className="modal-content stack" onSubmit={submit}>
    <p className="small muted">A quick record of how things are today. Add only what’s relevant. Symptoms are your observations, not a diagnosis.</p>
    <label>Check-in date<input required type="date" max={dateKey()} value={draft.date} onChange={e => update({ date: e.target.value, missedSessions: [] })}/></label>
    <fieldset className="stack"><legend>Training availability</legend><div className="availability-options">{availabilityOptions.map(value => <button key={value} className={`button secondary ${draft.availability === value ? 'chosen' : ''}`} type="button" aria-pressed={draft.availability === value} onClick={() => update({ availability: value })}>{value}</button>)}</div></fieldset>
    <div className="recovery-flags"><label><input type="checkbox" checked={draft.illness} onChange={e => update({ illness: e.target.checked })}/>Illness to note</label><label><input type="checkbox" checked={draft.missedTraining} onChange={e => update({ missedTraining: e.target.checked, missedSessions: e.target.checked ? draft.missedSessions : [] })}/>Missed training</label></div>
    {draft.missedTraining && <fieldset className="stack"><legend>Link missed sessions (optional)</legend><p className="small muted">From all programmes on this date. These links preserve the session name even if the plan changes. Completed workout logs are kept separately.</p>{missedOptions.length ? missedOptions.map(s => <label className="goal-check" key={s.sessionId}><input type="checkbox" checked={draft.missedSessions.some(m => m.sessionId === s.sessionId)} onChange={e => update({ missedSessions: e.target.checked ? [...draft.missedSessions, s] : draft.missedSessions.filter(m => m.sessionId !== s.sessionId) })}/>{s.title}</label>) : <p className="small muted">No sessions on this date. You can still record missed training and describe it below.</p>}</fieldset>}
    <div className="section-heading"><h3>Muscle & joint symptoms</h3><button type="button" className="button secondary" disabled={draft.symptoms.length >= 20} onClick={() => update({ symptoms: [...draft.symptoms, { id: uid(), kind: 'Muscle', location: '', side: '', severity: null, durationDays: null, notes: '' }] })}><Plus size={17}/>Add symptom</button></div>
    {draft.symptoms.map((s, index) => <fieldset className="practice-block stack" key={s.id}><legend>Symptom {index + 1}</legend>
      <div className="section-heading"><span className="small muted">Only enter what you’ve observed.</span><button type="button" className="icon-button" aria-label={`Remove symptom ${index + 1}`} onClick={() => update({ symptoms: draft.symptoms.filter(x => x.id !== s.id) })}><Trash2 size={17}/></button></div>
      <div className="form-grid"><label>Symptom type<select aria-label="Symptom type" value={s.kind} onChange={e => symptom(s.id, { kind: e.target.value as RecoverySymptom['kind'] })}>{symptomKinds.map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Body location<select aria-label="Body location" required value={s.location} onChange={e => symptom(s.id, { location: e.target.value as RecoverySymptom['location'] })}><option value="">Choose a location</option>{bodyLocations.map(l => <option key={l}>{l}</option>)}</select></label>
      <label>Side<select aria-label="Side" required value={s.side} onChange={e => symptom(s.id, { side: e.target.value as RecoverySymptom['side'] })}><option value="">Choose a side</option>{bodySides.map(side => <option key={side}>{side}</option>)}</select></label>
      <label>Severity (0–10)<input required type="number" inputMode="numeric" min={0} max={10} step={1} placeholder="0 none · 10 most severe" value={s.severity ?? ''} onChange={e => symptom(s.id, { severity: e.target.value === '' ? null : Number(e.target.value) })}/></label>
      <label>Duration (days, optional)<input type="number" inputMode="decimal" min={0} max={3650} step="any" placeholder="e.g. 0.5 or 3" value={s.durationDays ?? ''} onChange={e => symptom(s.id, { durationDays: e.target.value === '' ? null : Number(e.target.value) })}/></label></div>
      <label>Symptom observation<input maxLength={1000} placeholder="e.g. Noticed during warm-up" value={s.notes} onChange={e => symptom(s.id, { notes: e.target.value })}/></label>
    </fieldset>)}
    <label>Recovery observations<textarea maxLength={4000} placeholder="Anything relevant: illness, sleep, rest, missed practice or changes you noticed." value={draft.notes} onChange={e => update({ notes: e.target.value })}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button primary" disabled={busy}>{entry ? 'Update check-in' : 'Save check-in'}</button></div>
  </form>
}

export function RecoveryCard({ entry, edit, remove }: { entry: RecoveryEntry; edit: () => void; remove?: () => void }) {
  return <article className="panel recovery-card stack">
    <div className="section-heading"><div><h3>{formatDate(entry.date)}</h3><p className="small muted">Recorded {new Date(entry.savedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}</p></div><button className="icon-button" aria-label={`Edit recovery check-in ${entry.date}`} onClick={edit}><ArrowRight size={20}/></button></div>
    <div className="flex flex-wrap gap-2">{entry.availability !== 'Not recorded' && <Badge>{entry.availability}</Badge>}{entry.illness && <Badge>Illness noted</Badge>}{entry.missedTraining && <Badge>Missed training</Badge>}</div>
    {entry.symptoms.map(s => <div className="symptom-summary" key={s.id}><div className="section-heading"><strong>{s.side} · {s.location} · {s.kind}</strong><span>{s.severity} / 10</span></div><p className="small muted">{s.durationDays === null ? 'Duration not recorded' : `${s.durationDays} days reported`}{s.notes && ` · ${s.notes}`}</p></div>)}
    {entry.missedSessions.length > 0 && <p className="small">Missed: {entry.missedSessions.map(s => s.title).join(', ')}</p>}
    {entry.notes && <p className="small whitespace-pre-wrap">{entry.notes}</p>}
    {remove && <button className="text-button danger-text self-start" onClick={remove}>Delete check-in</button>}
  </article>
}

export function RecoveryPage({ entries, create, edit, remove }: { entries: RecoveryEntry[]; create: () => void; edit: (entry: RecoveryEntry) => void; remove: (entry: RecoveryEntry) => void }) {
  const [period, setPeriod] = useState('30'), [location, setLocation] = useState(''), [side, setSide] = useState(''), [selected, setSelected] = useState('')
  const cutoff = period === 'all' ? '' : addDays(dateKey(), -Number(period) + 1)
  const filtered = entries.filter(e => e.date >= cutoff && ((!location && !side) || e.symptoms.some(s => (!location || s.location === location) && (!side || s.side === side)))).sort((a, b) => b.date.localeCompare(a.date) || b.savedAt.localeCompare(a.savedAt))
  const summary = recoverySummary(filtered)
  const symptomRows = filtered.flatMap(entry => entry.symptoms.filter(s => (!location || s.location === location) && (!side || s.side === side)).map(symptom => ({ entry, symptom })))
  const groups = new Map<string, typeof symptomRows>()
  for (const row of symptomRows) { const key = symptomKey(row.symptom); groups.set(key, [...(groups.get(key) || []), row]) }
  const selectedKey = groups.has(selected) ? selected : [...groups.keys()][0]
  const comparable = [...(groups.get(selectedKey) || [])].sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.savedAt.localeCompare(b.entry.savedAt))
  return <>
    <div className="page-heading"><div><p className="eyebrow muted">RECOVERY & RESILIENCE</p><h1>Notice. Record. Reflect.</h1><p className="muted">A simple record of symptoms, availability and recovery.</p></div><button className="button primary" onClick={create}><Plus size={18}/>Quick check-in</button></div>
    <section className="panel stack"><div className="section-heading"><h2>Your observations</h2><HeartPulse size={20}/></div><p className="small muted">Optional check-ins. No entry means no information, rather than symptom-free or available. Trends show what you reported; they do not diagnose a condition or estimate injury risk.</p>
      <div className="form-grid"><label>Recovery period<select aria-label="Recovery period" value={period} onChange={e => setPeriod(e.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label><label>Filter body location<select aria-label="Filter body location" value={location} onChange={e => setLocation(e.target.value)}><option value="">All locations</option>{bodyLocations.map(l => <option key={l}>{l}</option>)}</select></label><label>Filter side<select aria-label="Filter side" value={side} onChange={e => setSide(e.target.value)}><option value="">All sides</option>{bodySides.map(s => <option key={s}>{s}</option>)}</select></label></div>
      <div className="module-stats four"><div><strong>{summary.checkIns}</strong><span>Check-ins</span></div><div><strong>{summary.symptomDays}</strong><span>Days with symptoms</span></div><div><strong>{summary.illnessDays}</strong><span>Days illness noted</span></div><div><strong>{summary.missedDays}</strong><span>Days training missed</span></div></div>
      <p className="small muted">Counts reflect the selected records. Multiple reports on the same date count once per day; missing days are not filled in.</p>
    </section>
    {comparable.length > 0 && <section className="panel stack mt-6"><h2>Symptom history</h2><label>Compare one symptom location<select aria-label="Compare one symptom location" value={selectedKey} onChange={e => setSelected(e.target.value)}>{[...groups.entries()].map(([key, rows]) => <option value={key} key={key}>{rows[0].symptom.side} · {rows[0].symptom.location} · {rows[0].symptom.kind}</option>)}</select></label><p className="small muted">Same type, location and side. Severity is self-reported, from 0 (none) to 10 (most severe). Duration is the value you entered at that check-in.</p>
      <div className="symptom-trend" aria-label="Reported symptom severity over time">{comparable.slice(-12).map(({ entry, symptom }) => <div className="symptom-trend-row" key={`${entry.id}-${symptom.id}`}><span>{formatDate(entry.date, { day: 'numeric', month: 'short' })}</span><div className="severity-track"><span style={{ width: `${(symptom.severity || 0) * 10}%` }}/></div><strong>{symptom.severity}/10</strong></div>)}</div>
      <div className="table-scroll"><table><caption>Reported symptoms, without interpolation</caption><thead><tr><th>Date</th><th>Severity</th><th>Duration</th><th>Availability</th></tr></thead><tbody>{comparable.map(({ entry, symptom }) => <tr key={`${entry.id}-${symptom.id}`}><td>{formatDate(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{symptom.severity}/10</td><td>{symptom.durationDays === null ? 'Not recorded' : `${symptom.durationDays} days`}</td><td>{entry.availability}</td></tr>)}</tbody></table></div>
    </section>}
    <div className="section-heading mt-8 mb-4"><h2>Check-in history</h2><span className="small muted">{filtered.length} records</span></div><div className="session-list">{filtered.length ? filtered.map(entry => <RecoveryCard key={entry.id} entry={entry} edit={() => edit(entry)} remove={() => remove(entry)}/>) : <Empty title="Check in when it helps">There are no matching recovery records. Add a quick check-in when you have something to note.</Empty>}</div>
  </>
}

export function RecoveryToday({ entries, today, create, edit }: { entries: RecoveryEntry[]; today: string; create: () => void; edit: (entry: RecoveryEntry) => void }) {
  const latest = entries.filter(e => e.date === today).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
  return <section className="panel today-recovery"><div className="flex items-center gap-3"><HeartPulse size={22}/><div><h2>Recovery, at your pace</h2><p className="small muted">{latest ? `Latest check-in today: ${latest.availability === 'Not recorded' ? 'availability not recorded' : latest.availability}${latest.illness ? ' · illness noted' : ''}${latest.missedTraining ? ' · missed training' : ''}` : 'No check-in today. Record an observation whenever it helps.'}</p></div></div><div className="flex gap-3">{latest && <button className="text-button" onClick={() => edit(latest)}>View</button>}<button className="button secondary" onClick={create}><Plus size={16}/>Check in</button></div></section>
}
