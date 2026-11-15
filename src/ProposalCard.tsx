import { useState } from 'react'
import type { PreparedProposal } from './programme-proposals'
import type { Session } from './domain'

function Prescription({ session }: { session: Session | null }) {
  if (!session) return <p className="muted">No session (removed / not yet added).</p>
  return <div className="stack"><h4>{session.title}</h4><p className="small">{session.date} · {session.category} · {session.minutes} minutes</p>{session.schedule&&<p className="small">{[session.schedule.startTime,session.schedule.timeZone,session.schedule.team,session.schedule.opponent,session.schedule.type,session.schedule.location].filter(Boolean).join(' · ')}</p>}{session.notes && <p className="small whitespace-pre-wrap">{session.notes}</p>}<ol className="coach-facts">{session.exercises.map(e => <li key={e.id}><strong>{e.name}</strong> · {e.sets} sets<p>{e.prescription}</p><p className="small muted">Rest: {e.rest || 'Not specified'}</p>{e.notes && <p className="small whitespace-pre-wrap">{e.notes}</p>}{e.skill && <p className="small">{e.skill.area} · {e.skill.objective} · Success: {e.skill.successCriteria} · {e.skill.foot} foot · {e.skill.distance ?? 'Unknown'} m · Angle: {e.skill.angle || 'Unknown'} · Pressure: {e.skill.pressure}</p>}</li>)}</ol></div>
}
export function ProposalCard({ proposal, busy, ready, decide }: { proposal: Pick<PreparedProposal,'id'|'title'|'rationale'|'expiresAt'|'changes'|'status'>; busy: boolean; ready: boolean; decide: (id: string, accept: boolean, confirmed: boolean) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  return <article className="panel stack coach-proposal" aria-label={`Training proposal: ${proposal.title}`}><div className="section-heading"><h2>{proposal.title}</h2><span className="badge">{proposal.status === 'pending' ? 'Proposed · not saved to training' : proposal.status}</span></div><p>{proposal.rationale}</p>
    {proposal.changes.map(c => <section className="stack" key={c.id}><h3>{c.before === null ? 'Add session' : c.after === null ? 'Remove planned session' : 'Change planned session'}</h3><div className="proposal-comparison"><div><p className="eyebrow mb-3">Before</p><Prescription session={c.before}/></div><div><p className="eyebrow mb-3">After approval</p><Prescription session={c.after}/></div></div></section>)}
    <p className="small muted">Expires {new Date(proposal.expiresAt).toLocaleString('en-IE')}. Approval checks the programme and session revisions again. Completed workouts cannot be changed.</p>
    {proposal.status === 'pending' && <><label className="goal-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>I reviewed these changes and approve saving them to my training plan.</span></label><div className="flex flex-wrap gap-3"><button className="button primary" disabled={busy || !ready || !confirmed} onClick={() => void decide(proposal.id, true, confirmed)}>Approve and save changes</button><button className="button secondary" disabled={busy} onClick={() => void decide(proposal.id, false, false)}>Reject proposal</button></div></>}
  </article>
}
