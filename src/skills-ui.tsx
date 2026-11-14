import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Plus, RotateCcw, Target, Trash2 } from 'lucide-react'
import { addDays, dateKey, formatDate, uid, validateLog, type AppData, type Session, type WorkoutLog } from './domain'
import { Badge, Empty, SessionCard } from './components'
import { SkillFields } from './SkillFields'
import { comparisonKey, comparisonTrend, feet, practiceObservations, pressures, skillAreas, summarisePractice, type SkillResult, type PracticeObservation } from './skills-domain'

export function skillConditions(result: SkillResult) {
  return [result.foot === 'Unspecified' ? 'Foot unspecified' : `${result.foot} foot`, result.distance === null ? 'Distance unspecified' : `${result.distance} m`, result.angle || 'Angle unspecified', result.pressure].join(' · ')
}
export function SkillsLogger({ session, existing, save, close, busy }: { session: Session; existing?: WorkoutLog; save: (log: WorkoutLog) => Promise<boolean>; close: () => void; busy: boolean }) {
  const [draft, setDraft] = useState<WorkoutLog>(() => {
    if (existing?.skillResults) return structuredClone(existing)
    const exercises = structuredClone(existing?.exercises || session.exercises)
    return { id: existing?.id || uid(), sessionId: session.id, title: existing?.title || session.title, category: 'Skills', date: dateKey(), minutes: 0, rpe: 0, notes: '', results: [], exercises, savedAt: '', skillResults: exercises.flatMap(ex => ex.skill ? (ex.skill.foot === 'Both' ? ['Left', 'Right'] as const : [ex.skill.foot]).map(foot => ({ ...ex.skill!, foot, id: uid(), exerciseId: ex.id, attempts: null, successes: null })) : []) }
  })
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<Record<string, { attempts: number | null; successes: number | null }[]>>({})
  const rows = draft.skillResults || []
  const update = (id: string, patch: Partial<SkillResult>) => setDraft(d => ({ ...d, skillResults: d.skillResults!.map(r => r.id === id ? { ...r, ...patch } : r) }))
  const count = (row: SkillResult, success: boolean) => {
    setUndo(previous => ({ ...previous, [row.id]: [...(previous[row.id] || []), { attempts: row.attempts, successes: row.successes }] }))
    update(row.id, { attempts: (row.attempts || 0) + 1, successes: (row.successes || 0) + (success ? 1 : 0) })
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const error = validateLog(draft)
    if (error) return setError(error)
    const actual = rows.filter(r => r.attempts !== null && r.attempts > 0)
    if (await save({ ...draft, skillResults: actual, savedAt: new Date().toISOString() })) close()
  }
  const summary = summarisePractice(rows.filter(r => r.attempts && r.successes !== null).map(result => ({ result, log: draft, drillName: '' })))
  return <form className="modal-content stack" onSubmit={submit}>
    <div><Badge category="Skills">Skills practice</Badge><h3 className="mt-3">{draft.title}</h3><p className="small muted mt-2">Tap Success or Miss for each attempt, or enter totals. Conditions come from the plan; adjust them to match your actual practice. Untouched drills are not recorded.</p></div>
    {rows.map((row, index) => <fieldset className="practice-block stack" key={row.id}>
      <legend>{draft.exercises.find(ex => ex.id === row.exerciseId)?.name} · Block {index + 1}</legend>
      <p className="small muted">{row.objective}</p><p className="small"><strong>Success:</strong> {row.successCriteria}</p>
      <Badge>{skillConditions(row)}</Badge>
      <div className="attempt-totals"><strong>{row.successes ?? '—'}<span> / {row.attempts ?? '—'}</span></strong><span className="small muted">successful / attempted</span></div>
      <div className="attempt-actions">
        <button type="button" className="button primary" disabled={(row.attempts || 0) >= 10000} onClick={() => count(row, true)}><Check size={18}/>Success +1</button>
        <button type="button" className="button secondary" disabled={(row.attempts || 0) >= 10000} onClick={() => count(row, false)}><Plus size={18}/>Miss +1</button>
        <button type="button" className="icon-button" aria-label={`Undo last attempt in block ${index + 1}`} disabled={!undo[row.id]?.length} onClick={() => { const history = undo[row.id]; update(row.id, history[history.length - 1]); setUndo(previous => ({ ...previous, [row.id]: history.slice(0, -1) })) }}><RotateCcw size={18}/></button>
      </div>
      <div className="form-grid">
        <label>Attempts<input type="number" inputMode="numeric" min={0} max={10000} value={row.attempts ?? ''} placeholder="Not recorded" onChange={e => { update(row.id, { attempts: e.target.value === '' ? null : Number(e.target.value) }); setUndo(previous => ({ ...previous, [row.id]: [] })) }}/></label>
        <label>Successful attempts<input type="number" inputMode="numeric" min={0} max={row.attempts ?? 10000} value={row.successes ?? ''} placeholder="Not recorded" onChange={e => { update(row.id, { successes: e.target.value === '' ? null : Number(e.target.value) }); setUndo(previous => ({ ...previous, [row.id]: [] })) }}/></label>
      </div>
      <details className="conditions-editor"><summary>Edit drill conditions / success criteria</summary><div className="mt-4"><SkillFields value={row} change={value => update(row.id, value)}/></div></details>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-button" disabled={rows.length >= 120} onClick={() => setDraft(d => ({ ...d, skillResults: [...d.skillResults!, { ...row, id: uid(), attempts: null, successes: null }] }))}><Plus size={16}/>Add block for different conditions</button>
        {rows.length > 1 && <button type="button" className="icon-button" aria-label={`Remove block ${index + 1}`} onClick={() => setDraft(d => ({ ...d, skillResults: d.skillResults!.filter(r => r.id !== row.id) }))}><Trash2 size={17}/></button>}
      </div>
    </fieldset>)}
    <div className="form-grid"><label>Completion date<input required type="date" max={dateKey()} value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}/></label><label>Actual minutes<input required type="number" inputMode="numeric" min={1} max={600} value={draft.minutes || ''} onChange={e => setDraft(d => ({ ...d, minutes: Number(e.target.value) }))}/></label></div>
    <label>Session effort (RPE)<select aria-label="Session effort (RPE)" required value={draft.rpe || ''} onChange={e => setDraft(d => ({ ...d, rpe: Number(e.target.value) }))}><option value="">Choose your effort</option>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} / 10</option>)}</select></label>
    <label>Practice observations<textarea maxLength={4000} value={draft.notes} placeholder="What did you notice or change?" onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><span className="small muted">{summary.attempts} actual attempts</span><button className="button primary" disabled={busy}>{existing ? 'Update skills log' : 'Save skills practice'}</button></div>
  </form>
}

export function SkillsPage({ data, create, open, editLog }: { data: AppData; create: () => void; open: (session: Session) => void; editLog: (log: WorkoutLog) => void }) {
  const [area, setArea] = useState(''), [foot, setFoot] = useState(''), [pressure, setPressure] = useState(''), [period, setPeriod] = useState('all'), [comparison, setComparison] = useState('')
  const cutoff = period === 'all' ? '' : addDays(dateKey(), -Number(period) + 1)
  const observations = practiceObservations(data.logs).filter(item => (!area || item.result.area === area) && (!foot || item.result.foot === foot) && (!pressure || item.result.pressure === pressure) && item.log.date >= cutoff)
  const summary = summarisePractice(observations)
  const groups = new Map<string, PracticeObservation[]>()
  for (const item of observations) { const key = comparisonKey(item); groups.set(key, [...(groups.get(key) || []), item]) }
  const selectedKey = groups.has(comparison) ? comparison : [...groups.keys()][0]
  const comparable = groups.get(selectedKey) || []
  const comparableSummary = summarisePractice(comparable), trend = comparisonTrend(comparable)
  const planned = data.sessions.filter(s => s.programmeId === data.activeProgrammeId && s.category === 'Skills').sort((a, b) => a.date.localeCompare(b.date))
  const logGroups = new Map<string, PracticeObservation[]>()
  for (const item of [...observations].sort((a, b) => b.log.date.localeCompare(a.log.date) || b.log.savedAt.localeCompare(a.log.savedAt))) logGroups.set(item.log.id, [...(logGroups.get(item.log.id) || []), item])
  const left = observations.filter(item => item.result.foot === 'Left').reduce((n, item) => n + item.result.attempts!, 0)
  const right = observations.filter(item => item.result.foot === 'Right').reduce((n, item) => n + item.result.attempts!, 0)
  return <>
    <div className="page-heading"><div><p className="eyebrow muted">FOOTBALL SKILLS</p><h1>Practice with purpose.</h1><p className="muted">Build your game. Record what happened. Compare like with like.</p></div><button className="button primary" onClick={create}><Plus size={18}/>Create skills session</button></div>
    <section className="panel stack"><div className="section-heading"><h2>Your skills plan</h2><Target size={19}/></div><p className="small muted">Active programme · All 12 skill areas are available in the drill editor, from shooting and both-foot work to defending and tactical decisions.</p><div className="session-list">{planned.length ? planned.map(s => <div key={s.id}><p className="small muted mb-2">{formatDate(s.date)}</p><SessionCard session={s} complete={data.logs.some(l => l.sessionId === s.id)} onClick={() => open(s)}/></div>) : <Empty title="Give your next practice a focus">Create a skills session, define your drills and decide what a successful attempt means.</Empty>}</div></section>
    <section className="panel stack mt-6"><h2>Practice history & progress</h2><div className="form-grid">
      <label>Filter skill area<select aria-label="Filter skill area" value={area} onChange={e => setArea(e.target.value)}><option value="">All skills</option>{skillAreas.map(a => <option key={a}>{a}</option>)}</select></label>
      <label>Filter foot<select aria-label="Filter foot" value={foot} onChange={e => setFoot(e.target.value)}><option value="">All feet</option>{feet.map(f => <option key={f}>{f}</option>)}</select></label>
      <label>Filter pressure<select aria-label="Filter pressure" value={pressure} onChange={e => setPressure(e.target.value)}><option value="">All pressure levels</option>{pressures.map(p => <option key={p}>{p}</option>)}</select></label>
      <label>History period<select aria-label="History period" value={period} onChange={e => setPeriod(e.target.value)}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
    </div><div className="module-stats"><div><strong>{summary.sessions}</strong><span>Sessions practised</span></div><div><strong>{summary.attempts}</strong><span>Recorded attempts</span></div><div><strong>{left} / {right}</strong><span>Left / right attempts</span></div></div><p className="small muted">Volume includes matching records across all programmes. Left/right totals exclude mixed, unspecified and non-foot drills; they measure practice exposure, not ability.</p>
    {!observations.length ? <Empty title="No practice results yet">Planned sessions do not count as performance. Log actual attempts after practising.</Empty> : <>
      <label>Compare a drill and its conditions<select aria-label="Compare a drill and its conditions" value={selectedKey} onChange={e => setComparison(e.target.value)}>{[...groups.entries()].map(([key, items]) => <option key={key} value={key}>{items[0].drillName} · {items[0].result.area} · {skillConditions(items[0].result)} · {items[0].result.objective} · {items[0].result.successCriteria}</option>)}</select></label>
      <div className="comparison-card stack"><h3>{comparable[0]?.drillName}</h3><p className="small muted">{comparable[0]?.result.area} · {comparable[0] && skillConditions(comparable[0].result)}</p><p className="small">Objective: {comparable[0]?.result.objective}</p><p className="small">Success means: {comparable[0]?.result.successCriteria}</p><div className="module-stats"><div><strong>{comparableSummary.rate?.toFixed(1)}%</strong><span>{comparableSummary.successes} / {comparableSummary.attempts} successful</span></div><div><strong>{comparableSummary.sessions}</strong><span>Comparable sessions</span></div><div><strong>{trend ? `${trend.change > 0 ? '+' : ''}${trend.change.toFixed(1)} pp` : '—'}</strong><span>Recent vs earlier practice</span></div></div>
      <p className="small muted">Matching recorded drill, objective, success criteria, foot, distance, angle and pressure. Unspecified conditions may hide differences. Rates are weighted by attempts. {trend ? `Earlier ${trend.earlier.sessions} sessions: ${trend.earlier.rate!.toFixed(1)}% (${trend.earlier.successes}/${trend.earlier.attempts}); recent ${trend.recent.sessions}: ${trend.recent.rate!.toFixed(1)}% (${trend.recent.successes}/${trend.recent.attempts}). Percentage points describe observed change, not a forecast.` : 'Record at least two comparable sessions to see a change.'}</p>
      <div className="table-scroll"><table><caption>Comparable practice observations</caption><thead><tr><th>Date</th><th>Successful / attempts</th><th>Rate</th></tr></thead><tbody>{[...comparable].sort((a, b) => a.log.date.localeCompare(b.log.date)).map(item => <tr key={`${item.log.id}-${item.result.id}`}><td>{formatDate(item.log.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{item.result.successes} / {item.result.attempts}</td><td>{(item.result.successes! / item.result.attempts! * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></div>
      {[...logGroups.values()].map(items => <article className="history-card" key={items[0].log.id}><div className="section-heading"><div><h3>{items[0].log.title}</h3><p className="small muted">{formatDate(items[0].log.date)} · {items[0].log.minutes} min</p></div><button className="icon-button" aria-label={`Edit skills log ${items[0].log.title}`} onClick={() => editLog(items[0].log)}><ArrowRight size={19}/></button></div>{items.map(item => <div className="practice-history-row" key={item.result.id}><strong>{item.drillName}: {item.result.successes} / {item.result.attempts}</strong><p className="small muted">{skillConditions(item.result)}</p></div>)}</article>)}
    </>}
    </section>
  </>
}
