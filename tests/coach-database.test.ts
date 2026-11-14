import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { defaultSharing } from '../src/coach-domain'
import { createInitialData, dateKey, uid } from '../src/domain'
import { toRecords } from '../src/sync-domain'
import { prepareProposal, type RawProposal } from '../src/coach-proposals'

const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
const first = '33333333-3333-4333-8333-333333333333', second = '44444444-4444-4444-8444-444444444444'
const limits = { hourly: 6, daily: 20, tokens: 500000, globalDaily: 100, globalTokens: 3000000 }
let db: PGlite
async function role(name: string, owner = a) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec(`set role ${name}`) }
async function begin(owner: string, request: string, conversation = request, settings = limits) {
  return (await db.query<{ value: { fresh: boolean; turn: { state: string; reply: unknown } } }>('select public.coach_begin($1,$2,$3,$4,$5,$6,$7,$8,$9) as value', [owner, request, conversation, conversation === request, 'Review my training', JSON.stringify(defaultSharing()), 'test-model', 20000, JSON.stringify(settings)])).rows[0].value
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
    insert into auth.users values ('${a}'),('${b}');`)
  await db.exec(readFileSync('supabase/migrations/202611140001_cloud_sync.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/202611140002_coaching_chat.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/202611140003_coaching_proposals.sql', 'utf8'))
}, 60000)
afterAll(async () => { await db?.close() })
describe('coaching PostgreSQL permissions, persistence and cost controls', () => {
  it('denies direct creation and service-only functions to browser and anonymous roles', async () => {
    await role('authenticated')
    await expect(begin(a, first)).rejects.toThrow('permission denied')
    await expect(db.query('insert into public.coach_conversations(owner_id,id,title) values ($1,$2,$3)', [a, first, 'Forgery'])).rejects.toThrow('permission denied')
    await role('anon'); await expect(db.query('select * from public.coach_turns')).rejects.toThrow('permission denied')
  })
  it('atomically reserves usage and persists one answer per idempotency key', async () => {
    await role('service_role')
    expect((await begin(a, first)).fresh).toBe(true)
    expect((await begin(a, first)).fresh).toBe(false)
    const answer = { answer: 'Review recorded facts.', facts: [], interpretations: [], unknowns: [] }
    await db.query('select public.coach_finish($1,$2,$3,$4,$5,$6)', [a, first, JSON.stringify(answer), 100, 20, null])
    const repeated = await begin(a, first)
    expect(repeated.turn.state).toBe('completed'); expect(repeated.turn.reply).toEqual(answer)
    expect((await db.query('select * from public.coach_usage')).rows).toHaveLength(1)
  })
  it('enforces account isolation on reads, deletion and cross-account foreign keys', async () => {
    await role('authenticated', b)
    expect((await db.query('select * from public.coach_conversations')).rows).toEqual([])
    expect((await db.query('select * from public.coach_turns')).rows).toEqual([])
    await db.query('delete from public.coach_conversations where id=$1', [first])
    await role('authenticated', a)
    expect((await db.query('select * from public.coach_turns')).rows).toHaveLength(1)
  })
  it('enforces daily request and token limits before creating another conversation', async () => {
    await role('service_role')
    await expect(begin(a, second, second, { ...limits, daily: 1 })).rejects.toThrow('USAGE_LIMIT')
    await expect(begin(a, second, second, { ...limits, tokens: 20001 })).rejects.toThrow('USAGE_LIMIT')
    expect((await db.query('select * from public.coach_conversations where id=$1', [second])).rows).toEqual([])
  })
  it('deletes conversation content while retaining content-free usage accounting', async () => {
    await role('authenticated', a)
    await db.query('delete from public.coach_conversations where id=$1', [first])
    expect((await db.query('select * from public.coach_turns')).rows).toEqual([])
    expect((await db.query('select * from public.coach_usage')).rows).toHaveLength(1)
    await role('service_role'); await expect(begin(a, first)).rejects.toThrow('REQUEST_REUSED')
  })
})

describe('atomic explicit proposal approval', () => {
  async function pending() {
    await db.exec('reset role')
    const data = createInitialData(), rows = toRecords(data)
    for (const row of Object.values(rows)) { row.revision = 1; await db.query('insert into public.athlete_records(owner_id,kind,id,revision,payload) values ($1,$2,$3,$4,$5) on conflict(owner_id,kind,id) do update set revision=excluded.revision,payload=excluded.payload', [a, row.kind, row.id, 1, JSON.stringify(row.payload)]) }
    const raw: RawProposal = { title: 'Proposal test', rationale: 'Synthetic test only', actions: [{ operation: 'add', targetId: null, session: { title: 'Proposed test session', date: dateKey(), category: 'Speed', minutes: 20, notes: '', exercises: [{ id: null, name: 'Controlled runs', sets: 2, prescription: '10 m controlled accelerations', rest: '2 min', notes: '', skill: null }] } }] }
    const proposal = prepareProposal(raw, rows, dateKey(), 7, false, new Date().toISOString()), request = uid()
    await role('service_role'); await begin(a, request, request, { ...limits, hourly: 100, daily: 100, tokens: 2000000 })
    await db.query('select public.coach_finish($1,$2,$3,$4,$5,$6,$7)', [a, request, JSON.stringify({ answer: 'Proposed work, not completed.', facts: [], interpretations: [], unknowns: [] }), 100, 100, null, JSON.stringify([proposal])])
    return proposal
  }
  it('requires confirmation, denies cross-account decisions, and applies a proposal exactly once', async () => {
    const p = await pending()
    await role('authenticated', b); await expect(db.query('select public.coach_decide($1,true,true)', [p.id])).rejects.toThrow('NOT_FOUND')
    expect((await db.query('select * from public.coach_proposals')).rows).toEqual([])
    await role('authenticated', a); await expect(db.query('select public.coach_decide($1,true,false)', [p.id])).rejects.toThrow('APPROVAL_REQUIRED')
    await db.query('select public.coach_decide($1,true,true)', [p.id])
    const saved = (await db.query<{ revision: number; payload: { title: string } }>('select revision,payload from public.athlete_records where owner_id=$1 and kind=$2 and id=$3', [a, 'session', p.changes[0].id])).rows[0]
    expect(saved.payload.title).toBe('Proposed test session')
    await db.query('select public.coach_decide($1,true,true)', [p.id])
    expect((await db.query<{ revision: number }>('select revision from public.athlete_records where owner_id=$1 and id=$2', [a, p.changes[0].id])).rows[0].revision).toBe(saved.revision)
  })
  it('rejects a stale proposal atomically and leaves all training untouched', async () => {
    const p = await pending(); await db.exec('reset role')
    await db.query("update public.athlete_records set revision=revision+1 where owner_id=$1 and kind='preferences'", [a])
    await role('authenticated', a); await expect(db.query('select public.coach_decide($1,true,true)', [p.id])).rejects.toThrow('STALE_PROPOSAL')
    expect((await db.query('select * from public.athlete_records where owner_id=$1 and id=$2', [a, p.changes[0].id])).rows).toEqual([])
    expect((await db.query<{ status: string }>('select status from public.coach_proposals where id=$1', [p.id])).rows[0].status).toBe('pending')
  })
  it('rejects without changing any training records', async () => {
    const p = await pending(); await role('authenticated', a)
    const before = (await db.query('select * from public.athlete_records order by kind,id')).rows
    await db.query('select public.coach_decide($1,false,false)', [p.id])
    expect((await db.query('select * from public.athlete_records order by kind,id')).rows).toEqual(before)
    expect((await db.query<{ status: string }>('select status from public.coach_proposals where id=$1', [p.id])).rows[0].status).toBe('rejected')
  })
  it('protects a session completed after the proposal even when its session revision did not change', async () => {
    const p = await pending(); await db.exec('reset role')
    await db.query("insert into public.athlete_records(owner_id,kind,id,revision,payload) values ($1,'workout','new-completion',1,$2)", [a, JSON.stringify({ id: 'new-completion', sessionId: p.changes[0].id })])
    await role('authenticated', a)
    await expect(db.query('select public.coach_decide($1,true,true)', [p.id])).rejects.toThrow('HISTORY_PROTECTED')
  })
})
