import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'ATHLETE_TEST_EMAIL_A', 'ATHLETE_TEST_PASSWORD_A', 'ATHLETE_TEST_EMAIL_B', 'ATHLETE_TEST_PASSWORD_B']
for (const name of required) if (!process.env[name]) throw new Error(`Set ${name} for two dedicated test accounts. Do not use athlete accounts.`)
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const clients = ['A', 'B'].map(() => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))
const sessions = await Promise.all(clients.map(async (client, index) => {
  const suffix = index === 0 ? 'A' : 'B'
  const { data, error } = await client.auth.signInWithPassword({ email: process.env[`ATHLETE_TEST_EMAIL_${suffix}`], password: process.env[`ATHLETE_TEST_PASSWORD_${suffix}`] })
  if (error) throw new Error(`Test account ${suffix} could not sign in. Check credentials and email confirmation.`)
  return data.user
}))
assert.notEqual(sessions[0].id, sessions[1].id, 'Two different accounts are required')
const id = `security-test-${randomUUID()}`
const change = { kind: 'programme', id, expected_revision: 0, payload: { id, name: 'Cloud verification only', description: '' } }
async function sync(client, changes) {
  const { data, error } = await client.rpc('athlete_sync', { changes })
  if (error) throw new Error(`Sync RPC failed (${error.code}). Apply migrations and check configuration.`)
  assert.equal(data.schemaVersion, 1)
  return data
}
try {
  assert.equal((await sync(clients[0], [change])).applied, true)
  assert.equal((await sync(clients[1], [])).records.some(r => r.id === id), false)
  const foreign = await clients[1].from('athlete_records').select('id').eq('owner_id', sessions[0].id)
  assert.equal(foreign.error, null); assert.deepEqual(foreign.data, [])
  const forbidden = await clients[1].from('athlete_records').update({ payload: null }).eq('owner_id', sessions[0].id)
  assert.ok(forbidden.error, 'Direct writes must be denied')
  const stale = await sync(clients[0], [change, { ...change, id: `${id}-atomic`, payload: { ...change.payload, id: `${id}-atomic` } }])
  assert.equal(stale.applied, false); assert.equal(stale.records.some(r => r.id === `${id}-atomic`), false)
  await sync(clients[0], [{ ...change, expected_revision: 1, payload: null }])
  const resurrect = await sync(clients[0], [change])
  assert.equal(resurrect.applied, false)
  assert.equal(resurrect.records.find(r => r.id === id).payload, null)
  const anonymous = createClient(url, key, { auth: { persistSession: false } })
  assert.ok((await anonymous.rpc('athlete_sync', { changes: [] })).error)
  console.log('PASS: two-account sign-in, RPC isolation, RLS reads, denied direct writes, atomic stale batches, tombstones and anonymous access.')
} finally {
  // Retain only the protocol-required deletion marker, never a live test programme.
  await sync(clients[0], [{ ...change, expected_revision: 1, payload: null }]).catch(() => undefined)
  await Promise.all(clients.map(c => c.auth.signOut({ scope: 'local' })))
}
