import { useEffect, useRef, useState, type FormEvent } from 'react'
import { contextSections } from './coaching-context'
import { CoachError, defaultSharing, parseReply, type CoachConversation, type CoachSharing, type CoachTurn } from './coach-domain'
import { coachRequest, downloadCoachJSON } from './coach-api'
import { dateKey, uid } from './domain'
import { readProposal, type PreparedProposal } from './coach-proposals'
import { ProposalCard } from './ProposalCard'

export function CoachPage({ signedIn, ready, sync, goProfile }: { signedIn: boolean; ready: boolean; sync: () => Promise<void>; goProfile: () => void }) {
  const [conversations, setConversations] = useState<CoachConversation[]>([]), [turns, setTurns] = useState<CoachTurn[]>([]), [conversationId, setConversationId] = useState<string | null>(null)
  const [sharing, setSharing] = useState(defaultSharing), [question, setQuestion] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [preview, setPreview] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [limits, setLimits] = useState<{ hourly: number; daily: number } | null>(null), [hasMore, setHasMore] = useState(false)
  const [proposals, setProposals] = useState<PreparedProposal[]>([]), [propose, setPropose] = useState(false)
  const request = useRef<{ id: string; fingerprint: string } | null>(null), live = useRef(true), controller = useRef<AbortController | null>(null)
  useEffect(() => { live.current = true; return () => { live.current = false; controller.current?.abort() } }, [])
  const report = (problem: unknown) => { if (live.current) setError(problem instanceof Error ? problem.message : 'Coaching could not finish. Your training records are unchanged.') }
  const list = async (offset = 0) => {
    const result = await coachRequest<{ conversations: CoachConversation[]; limits: { hourly: number; daily: number } }>({ action: 'list', offset })
    if (!live.current) return
    setConversations(previous => offset ? [...previous, ...result.conversations] : result.conversations); setLimits(result.limits); setHasMore(result.conversations.length === 50)
  }
  useEffect(() => { if (signedIn) void list().catch(report) }, [signedIn])
  const act = async (action: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await action() } catch (problem) { report(problem) } finally { if (live.current) setBusy(false) } }
  const scope = (next: CoachSharing) => { setSharing(next); setPreview(''); setConfirmed(false) }
  const open = async (id: string) => { await act(async () => { const result = await coachRequest<{ turns: CoachTurn[]; proposals?: unknown[] }>({ action: 'history', conversationId: id }); if (!live.current) return; setTurns(result.turns.map(t => ({ ...t, reply: t.reply ? parseReply(t.reply) : null }))); setProposals((result.proposals ?? []).map(readProposal)); setConversationId(id); setPreview(''); setConfirmed(false); request.current = null }) }
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready || !confirmed || busy || !question.trim()) return
    await act(async () => {
      const fingerprint = JSON.stringify({ conversationId, question: question.trim(), sharing, propose })
      if (!request.current || request.current.fingerprint !== fingerprint) request.current = { id: uid(), fingerprint }
      controller.current = new AbortController()
      const result = await coachRequest<{ turn: CoachTurn; proposals?: unknown[] }>({ action: propose ? 'propose' : 'chat', requestId: request.current.id, conversationId, question: question.trim(), sharing, today: dateKey() }, AbortSignal.any([controller.current.signal, AbortSignal.timeout(90000)]))
      if (!live.current) return
      const turn = { ...result.turn, reply: parseReply(result.turn.reply) }
      const incoming = (result.proposals ?? []).map(readProposal)
      setProposals(previous => [...previous.filter(p => !incoming.some(row => row.id === p.id)), ...incoming])
      setTurns(previous => [...previous.filter(t => t.request_id !== turn.request_id), turn]); setConversationId(turn.conversation_id); setQuestion(''); request.current = null; setPreview(''); setNotice('Answer saved. Training records have not been changed.'); await list()
    })
  }
  const decide = async (id: string, accept: boolean, confirmed: boolean) => {
    await act(async () => {
      if (accept && !ready) throw new CoachError(409, 'Synchronise pending changes before approving a proposal.')
      const result = await coachRequest<{ status: PreparedProposal['status']; alreadyDecided: boolean }>({ action: 'decide', proposalId: id, accept, confirmed, today: dateKey() })
      if (!live.current) return
      setProposals(previous => previous.map(p => p.id === id ? { ...p, status: result.status } : p))
      setNotice(result.status === 'approved' ? 'Proposal approved. Changes are saved in the cloud and will appear locally after synchronisation.' : 'Proposal rejected. Your training records have not changed.')
      if (result.status === 'approved') await sync()
    })
  }
  return <div className="coach-page stack">
    <div className="page-heading"><div><p className="eyebrow">GUIDANCE FOR YOUR GAME</p><h1>AI Coach</h1><p className="muted">Ask about your training, football development and next steps.</p></div></div>
    <div className="notice">This is a separate OpenAI API coaching service. It does not inherit your ChatGPT conversations or subscription. Advice may be wrong and does not provide a medical diagnosis or clearance to train.</div>
    {!signedIn ? <section className="panel stack"><h2>Sign in to use coaching</h2><p>Coaching uses your account’s synchronised records. Local training and Coaching Context exports remain available without signing in.</p><button className="button primary" onClick={goProfile}>Open account settings</button></section> : <>
      {!ready && <div className="notice">Synchronise your account and resolve pending changes before asking the coach. <button className="text-button" disabled={busy} onClick={() => void act(sync)}>Synchronise now</button><button className="text-button" onClick={goProfile}>Account & sync settings</button></div>}
      <section className="panel stack">
        <div className="flex flex-wrap gap-3"><button className="button secondary" disabled={busy} onClick={() => { setConversationId(null); setTurns([]); setProposals([]); setPropose(false); setQuestion(''); setSharing(defaultSharing()); setPreview(''); setConfirmed(false); setError(''); request.current = null }}>New conversation</button><button className="button secondary" disabled={busy} onClick={() => void act(async () => downloadCoachJSON(await coachRequest({ action: 'export' })))}>Export coaching history</button></div>
        <details><summary>Conversation history</summary><div className="stack mt-4">{conversations.length ? conversations.map(c => <div className="coach-history-row" key={c.id}><button className="text-button" disabled={busy} aria-current={conversationId === c.id ? 'true' : undefined} onClick={() => void open(c.id)}>{c.title}</button><button className="text-button danger-text" disabled={busy} aria-label={`Delete conversation ${c.title}`} onClick={() => { if (window.confirm('Delete this conversation and its answers? This cannot be undone. Training records are kept.')) void act(async () => { await coachRequest({ action: 'delete', conversationId: c.id }); if (conversationId === c.id) { setConversationId(null); setTurns([]); setProposals([]); request.current = null }; await list(); setNotice('Conversation deleted.') }) }}>Delete</button></div>) : <p className="muted">No saved conversations.</p>}{hasMore && <button className="text-button" disabled={busy} onClick={() => void act(() => list(conversations.length))}>Load more conversations</button>}</div></details>
      </section>
      <section className="panel stack"><h2>What the coach can see</h2><p className="muted small">Only the selected categories from your cloud account are shared. Your question and the answers are saved in this account. Names, titles, goals, notes and your question may contain sensitive information. Review the preview before sending. Changing sharing settings excludes earlier turns with different settings from future AI requests.</p>
        <details><summary>Data-sharing controls</summary><div className="stack mt-4"><div className="form-grid"><label>Recent history<select value={sharing.historyDays} onChange={e => scope({ ...sharing, historyDays: Number(e.target.value) })}>{[7, 14, 28, 90].map(n => <option key={n} value={n}>{n} days</option>)}</select></label><label>Upcoming plans<select value={sharing.upcomingDays} onChange={e => scope({ ...sharing, upcomingDays: Number(e.target.value) })}>{[7, 14, 28].map(n => <option key={n} value={n}>{n} days</option>)}</select></label></div>
          <fieldset className="stack"><legend>Training context</legend>{Object.entries(contextSections).map(([key, label]) => <label className="goal-check" key={key}><input type="checkbox" checked={sharing.sections.includes(key as keyof typeof contextSections)} onChange={e => scope({ ...sharing, sections: e.target.checked ? [...sharing.sections, key as keyof typeof contextSections] : sharing.sections.filter(s => s !== key) })}/><span>{label}</span></label>)}</fieldset>
          <fieldset className="stack"><legend>Optional personal and sensitive information</legend>{([['identity', 'Share my name'], ['symptoms', 'Share symptoms and injury observations'], ['illness', 'Share illness information'], ['recovery', 'Share availability and other recovery observations'], ['notes', 'Share free-text notes and reflections (may contain health information)']] as const).map(([key, label]) => <label className="goal-check" key={key}><input type="checkbox" checked={sharing[key]} onChange={e => scope({ ...sharing, [key]: e.target.checked })}/><span>{label}</span></label>)}</fieldset></div></details>
        <button className="button secondary" disabled={busy || !ready || !sharing.sections.length} onClick={() => void act(async () => { const result = await coachRequest({ action: 'preview', conversationId, sharing, today: dateKey() }); setPreview(JSON.stringify(result, null, 2)) })}>Preview shared context</button>
        {preview && <label>Authorised context preview<textarea readOnly className="coach-preview" value={preview}/></label>}
        <p className="small muted">The server refreshes cloud records before each request. Up to six previous turns with identical sharing settings may be sent; raw context snapshots are not retained in conversation history.</p>
      </section>
      <section className="panel stack" aria-label="Coaching conversation">{!turns.length && <p className="muted">Try “Review my last seven days”, “How is my two-point kicking progressing?” or “What should I train today?”</p>}{turns.map(turn => <article className="coach-turn stack" key={turn.request_id}><h2 className="coach-question">{turn.question}</h2>{turn.reply ? <><p className="whitespace-pre-wrap">{turn.reply.answer}</p>{([['facts', 'Recorded facts'], ['interpretations', 'Interpretations'], ['unknowns', 'Missing information']] as const).map(([key, label]) => turn.reply![key].length > 0 && <div key={key}><h3>{label}</h3><ul className="coach-facts">{turn.reply![key].map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}<p className="muted small">{new Date(turn.created_at).toLocaleString('en-IE')} · {turn.model}</p></> : <p className="muted">{turn.state === 'running' ? 'This request is still processing. Reopen the conversation shortly.' : 'This request failed. Training records were not changed.'}</p>}</article>)}
        <form className="stack" onSubmit={e => void send(e)}><label className="goal-check"><input type="checkbox" checked={propose} onChange={e => setPropose(e.target.checked)}/><span>Request a structured training proposal (requires separate approval)</span></label><label>Your coaching question<textarea rows={3} required maxLength={1000} value={question} onChange={e => { setQuestion(e.target.value); if (error) setError('') }} placeholder="What would you like to work on?"/></label><label className="goal-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>I approve sending this question and the selected context to OpenAI.</span></label><button className="button primary" disabled={busy || !ready || !confirmed || !question.trim() || !sharing.sections.length}>{busy ? 'Coach is working…' : 'Ask the coach'}</button></form>
        {limits && <p className="muted small">Server limits: up to {limits.hourly} requests per hour and {limits.daily} per day. Token and shared service budgets also apply.</p>}
      </section>
    </>}
    {proposals.map(p => <ProposalCard key={p.id} proposal={p} busy={busy} ready={ready} decide={decide}/>)}
    {error && <p className="error-text" role="alert">{error}{error.includes('attempt failed') && <button className="text-button" onClick={() => { request.current = null; setError('') }}>Start a new request</button>}</p>}{notice && <p role="status">{notice}</p>}
  </div>
}
