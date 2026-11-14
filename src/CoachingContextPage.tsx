import { useMemo, useRef, useState } from 'react'
import { Copy, Download, ShieldCheck } from 'lucide-react'
import { dateKey, type AppData } from './domain'
import { APP_NAME } from './config'
import { coachingMarkdown, contextSections, defaultContextOptions, generateCoachingContext, validateContextOptions, type ContextOptions } from './coaching-context'
import { copyCoachingText, downloadCoachingFile } from './coaching-export'

const questions = ['What should I train today?', 'Should I modify my next session?', 'Review my recent training and recovery.', 'Am I improving my sprint performance?', 'Which football skills need the most attention?', 'Analyse my recent match performances.', 'Help plan my next training week.']
export function CoachingContextPage({ data }: { data: AppData }) {
  const [options, setOptions] = useState(() => defaultContextOptions('quick', dateKey()))
  const [exportedAt] = useState(() => new Date().toISOString())
  const [manual, setManual] = useState(false), [status, setStatus] = useState(''), [copying, setCopying] = useState(false)
  const preview = useRef<HTMLTextAreaElement>(null)
  const update = (patch: Partial<ContextOptions>) => { setOptions(o => ({ ...o, ...patch })); setManual(false); setStatus('') }
  const result = useMemo(() => {
    const error = validateContextOptions(options)
    if (error) return { error, document: null, markdown: '' }
    try { const document = generateCoachingContext(data, options, exportedAt, APP_NAME); return { error: '', document, markdown: coachingMarkdown(document) } }
    catch { return { error: 'Could not generate this context. Check the selected dates and sections, then try again.', document: null, markdown: '' } }
  }, [data, options, exportedAt])
  function selectPreview() {
    preview.current?.focus(); preview.current?.select(); preview.current?.setSelectionRange(0, result.markdown.length)
  }
  async function copy() {
    setCopying(true); setStatus('')
    try {
      if (await copyCoachingText(result.markdown, navigator.clipboard)) { setManual(false); setStatus('Context copied. Paste it into ChatGPT yourself when ready.') }
      else { setManual(true); setStatus('Clipboard access is unavailable. The preview is selected: use Copy from your browser or selection menu.'); requestAnimationFrame(selectPreview) }
    } finally { setCopying(false) }
  }
  function download(format: 'md' | 'json') {
    if (!result.document) return
    try { downloadCoachingFile(format === 'md' ? result.markdown : JSON.stringify(result.document, null, 2), format, exportedAt); setStatus('Download requested. Save the file using your browser or Files menu.') }
    catch { setManual(true); setStatus('Download could not start. You can select and copy the Markdown preview instead.') }
  }
  return <div className="coaching-context stack"><div className="page-heading"><div><p className="eyebrow">YOUR RECORDS, READY TO SHARE</p><h1>Coaching Context</h1><p className="muted">Review your context, copy it, then paste into ChatGPT yourself.</p></div></div><div className="notice"><ShieldCheck size={20}/><span>Generated locally and available offline. Nothing is sent to ChatGPT or another service. This is a context summary, separate from your full database backup.</span></div>
    <section className="panel stack"><h2>Choose your context</h2><div className="theme-options">{(['quick', 'detailed'] as const).map(mode => <button className={`button secondary ${options.mode === mode ? 'chosen' : ''}`} aria-pressed={options.mode === mode} key={mode} onClick={() => update({ ...defaultContextOptions(mode, dateKey()), sections: options.sections, question: options.question, additionalContext: options.additionalContext, includeIdentity: options.includeIdentity, includeSymptoms: options.includeSymptoms, includeIllness: options.includeIllness, includeRecovery: options.includeRecovery, includeNotes: options.includeNotes })}>{mode === 'quick' ? 'Quick Context' : 'Detailed Context'}</button>)}</div><p className="small muted">Quick: previous 14 days including today, upcoming 7 days, and latest focus tests with compatible history. Detailed: previous 90 days, upcoming 28 days, all tests and additional result detail. Change ranges or sections below.</p>
    <label>Suggested coaching question<select aria-label="Suggested coaching question" value={questions.includes(options.question) ? options.question : ''} onChange={e => update({ question: e.target.value })}><option value="">Choose a question (optional)</option>{questions.map(q => <option key={q}>{q}</option>)}</select></label><label>Your coaching question (optional)<textarea maxLength={1000} value={options.question} onChange={e => update({ question: e.target.value })}/></label>
    <details><summary>Date ranges and sections</summary><div className="stack mt-4"><div className="form-grid"><label>Recent from<input type="date" required value={options.historyStart} onChange={e => update({ historyStart: e.target.value })}/></label><label>Recent through<input type="date" required value={options.historyEnd} onChange={e => update({ historyEnd: e.target.value })}/></label><label>Upcoming from<input type="date" required value={options.upcomingStart} onChange={e => update({ upcomingStart: e.target.value })}/></label><label>Upcoming through<input type="date" required value={options.upcomingEnd} onChange={e => update({ upcomingEnd: e.target.value })}/></label></div><fieldset className="stack"><legend>Sections to share</legend><div className="performance-checks">{Object.entries(contextSections).map(([key, label]) => <label key={key}><input type="checkbox" checked={options.sections.includes(key as keyof typeof contextSections)} onChange={e => update({ sections: e.target.checked ? [...options.sections, key as keyof typeof contextSections] : options.sections.filter(s => s !== key) })}/>{label}</label>)}</div></fieldset></div></details>
    <details><summary>Additional athlete context (optional)</summary><div className="stack mt-3"><p className="small muted">Add potential positions, development priorities, current block, training preferences, facilities, equipment, constraints or known commitments that are not stored elsewhere. This text is used for this export only; it is not saved to your profile or history.</p><label>Additional context<textarea maxLength={3000} value={options.additionalContext} onChange={e => update({ additionalContext: e.target.value })}/></label></div></details></section>
    <section className="panel stack"><h2>Choose personal and sensitive information</h2><p className="small muted">These options start off each time you open this page. Titles, goals, protocol descriptions and your question can also contain personal information. Review the full preview before sharing. Free-text notes require a separate opt-in, including notes inside selected recovery categories.</p><div className="performance-checks">{([
      ['includeIdentity', 'Include athlete name'], ['includeSymptoms', 'Include injury and symptom history'], ['includeIllness', 'Include illness information'], ['includeRecovery', 'Include other recovery observations and availability'], ['includeNotes', 'Include free-text notes and reflections (may contain health information)']
    ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} onChange={e => update({ [key]: e.target.checked })}/>{label}</label>)}</div></section>
    <section className="panel stack"><div className="section-heading"><h2>Context preview</h2><span className="small muted">{result.markdown.length.toLocaleString()} characters</span></div>{result.error ? <p className="error" role="alert">{result.error}</p> : <><label>Markdown preview<textarea className="coaching-preview" ref={preview} readOnly value={result.markdown} spellCheck={false}/></label><p className="small muted">This exact preview is copied or downloaded as Markdown. JSON contains the same selected sections and facts, with structured values. Null means unknown, not zero.</p></>}{manual && <div className="notice"><span>Manual copy: tap Select preview text, then choose Copy. On iPhone, use the text selection menu; on desktop, use Ctrl+C or Cmd+C.</span><button className="button secondary" onClick={selectPreview}>Select preview text</button></div>}<div className="coaching-actions"><button className="button primary" disabled={!result.document || copying} onClick={() => void copy()}><Copy size={18}/>{copying ? 'Copying…' : 'Copy context'}</button><button className="button secondary" disabled={!result.document} onClick={() => download('md')}><Download size={18}/>Download Markdown</button><button className="button secondary" disabled={!result.document} onClick={() => download('json')}><Download size={18}/>Download JSON</button></div>{status && <p role="status" className="small">{status}</p>}</section>
  </div>
}
