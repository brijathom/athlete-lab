import { createClient } from '@supabase/supabase-js'
import { build } from 'esbuild'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

// No OpenAI credential is read here. Only the deployed Edge Function can access it.
const paid = process.argv.includes('--allow-paid')
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'ATHLETE_TEST_EMAIL_A', 'ATHLETE_TEST_PASSWORD_A', 'ATHLETE_TEST_EMAIL_B', 'ATHLETE_TEST_PASSWORD_B']) if (!process.env[name]) throw new Error(`Set ${name} locally for two dedicated test accounts.`)
const clients = [0, 1].map(() => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
const sessions = await Promise.all(clients.map(async (client, index) => {
  const suffix = index === 0 ? 'A' : 'B'
  const result = await client.auth.signInWithPassword({ email: process.env[`ATHLETE_TEST_EMAIL_${suffix}`], password: process.env[`ATHLETE_TEST_PASSWORD_${suffix}`] })
  if (result.error) throw new Error(`Test account ${suffix} could not sign in.`)
  return result.data.session
}))
assert.notEqual(sessions[0].user.id, sessions[1].user.id)
async function invoke(body, index = 0, expected = 200) {
  const response = await fetch(`${url}/functions/v1/coach`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(index === null ? {} : { Authorization: `Bearer ${sessions[index].access_token}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) })
  let result
  try { result = await response.json() } catch { throw new Error(`Coaching endpoint returned HTTP ${response.status}. Check deployment.`) }
  if (response.status !== expected) throw new Error(`Coaching check expected HTTP ${expected}, received ${response.status}: ${result.error ?? 'Check migration, deployment and secrets.'}`)
  return result
}
async function cloud(changes = []) { const { data, error } = await clients[0].rpc('athlete_sync', { changes }); if (error || !data.applied) throw new Error('Cloud verification changes conflicted or failed.'); return data.records }
const cleanup = new Set(), conversationId = randomUUID()
try {
  await invoke({ action: 'list', offset: 0 }, null, 401)
  await invoke({ action: 'list', offset: 0 }, 0)
  await invoke({ action: 'list', offset: 0 }, 1)
  const foreign = await clients[1].from('coach_conversations').select('id').eq('owner_id', sessions[0].user.id)
  assert.equal(foreign.error, null); assert.deepEqual(foreign.data, [])
  const forged = await clients[0].from('coach_conversations').insert({ owner_id: sessions[0].user.id, id: randomUUID(), title: 'Forbidden direct insert' })
  assert.ok(forged.error)
  console.log('PASS: deployed authentication, two-account RLS reads and denied direct conversation creation. No paid AI calls in this check.')
  if (paid) {
    // Explicit opt-in uses only dedicated test accounts. Empty accounts receive proposed
    // plans with zero completed workouts, tests or health records; all additions are cleaned up.
    const bundled = await build({ stdin: { contents: "export {createInitialData,dateKey} from './src/domain.ts'; export {toRecords,fromRecords,parseRemote} from './src/sync-domain.ts'; export {defaultSharing} from './src/coach-domain.ts'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false })
    const shared = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
    let rows = await cloud()
    if (!rows.some(row => row.payload !== null)) {
      const seed = shared.createInitialData(); seed.programmes[0].name = 'Live verification: proposed plans only'
      const initial = shared.toRecords(seed)
      for (const name of Object.keys(initial)) cleanup.add(name)
      rows = await cloud(Object.values(initial).map(row => ({ kind: row.kind, id: row.id, expected_revision: rows.find(r => r.kind === row.kind && r.id === row.id)?.revision ?? 0, payload: row.payload })))
    }
    shared.fromRecords(shared.parseRemote(rows))
    const common = { sharing: shared.defaultSharing(), today: shared.dateKey() }
    const answer = await invoke({ ...common, action: 'chat', requestId: conversationId, conversationId: null, question: 'Summarise only the recorded training facts. Clearly identify missing history and current availability; do not invent measurements.' })
    assert.ok(answer.turn.reply.answer); assert.ok(Array.isArray(answer.turn.reply.unknowns))
    await invoke({ action: 'history', conversationId }, 1, 404)
    assert.ok((await invoke({ action: 'history', conversationId })).turns.length)
    const proposed = await invoke({ ...common, action: 'propose', requestId: randomUUID(), conversationId, question: 'Propose one optional 15-minute low-intensity ball-control session for tomorrow, as an addition only. No running, external load, edits or deletions. Acknowledge current symptoms and availability are unknown; do not imply medical clearance.' })
    const proposal = proposed.proposals?.[0]
    assert.ok(proposal, 'The model did not offer a proposal; verify the reply manually before claiming proposal generation.')
    assert.ok(proposal.changes.every(c => c.before === null && c.after !== null), 'Only new sessions can be approved by this live test.')
    for (const c of proposal.changes) cleanup.add(`session:${c.id}`)
    await invoke({ action: 'decide', proposalId: proposal.id, accept: true, confirmed: false, today: common.today }, 0, 400)
    await invoke({ action: 'decide', proposalId: proposal.id, accept: true, confirmed: true, today: common.today })
    const approved = await cloud(), revisions = proposal.changes.map(c => approved.find(r => r.kind === 'session' && r.id === c.id)?.revision)
    assert.ok(revisions.every(Boolean))
    await invoke({ action: 'decide', proposalId: proposal.id, accept: true, confirmed: true, today: common.today })
    const repeated = await cloud()
    assert.deepEqual(proposal.changes.map(c => repeated.find(r => r.kind === 'session' && r.id === c.id)?.revision), revisions)
    console.log(`PASS: live Responses API (${answer.turn.model}), persisted conversation, cross-account denial, structured proposal, explicit approval and duplicate-action protection. Two paid model requests were made.`)
  }
} finally {
  if (paid) {
    await invoke({ action: 'delete', conversationId }).catch(() => undefined)
    if (cleanup.size) { const rows = await cloud(); await cloud(rows.filter(r => cleanup.has(`${r.kind}:${r.id}`) && r.payload !== null).map(r => ({ kind: r.kind, id: r.id, expected_revision: r.revision, payload: null }))) }
  }
  await Promise.all(clients.map(client => client.auth.signOut({ scope: 'local' })))
}
