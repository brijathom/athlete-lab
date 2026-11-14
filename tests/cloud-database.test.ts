import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Executes the real migration on embedded PostgreSQL. Auth claims represent two
// distinct authenticated accounts; this does not substitute for live Supabase Auth tests.
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
let db: PGlite
const row = (id: string, revision = 0, payload: unknown = { id, name: 'Test', description: '' }) => ({ kind: 'programme', id, expected_revision: revision, payload })
async function account(id: string) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
}
async function exchange(changes: unknown[]) {
  return (await db.query<{ result: { applied: boolean; records: { kind: string; id: string; revision: number; payload: unknown }[] } }>('select public.athlete_sync($1::jsonb) as result', [JSON.stringify(changes)])).rows[0].result
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${a}'), ('${b}');`)
  await db.exec(readFileSync('supabase/migrations/202611140001_cloud_sync.sql', 'utf8'))
}, 60000)
afterAll(async () => { await db?.close() })
describe('cloud migration, PostgreSQL RLS and revision-checked transactions', () => {
  it('applies the migration with forced RLS enabled', async () => {
    const result = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'athlete_records'")
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
  })
  it('rejects unauthenticated RPC and direct reads', async () => {
    await db.exec('set role anon')
    await expect(exchange([])).rejects.toThrow('permission denied')
    await expect(db.query('select * from public.athlete_records')).rejects.toThrow('permission denied')
  })
  it('isolates two accounts through both RPC and direct RLS reads', async () => {
    await account(a); await exchange([row('a-only')])
    await account(b)
    expect((await exchange([])).records).toEqual([])
    await exchange([row('b-only')])
    const visible = await db.query<{ id: string }>('select id from public.athlete_records')
    expect(visible.rows.map(r => r.id)).toEqual(['b-only'])
    expect((await db.query('select * from public.athlete_records where owner_id = $1', [a])).rows).toEqual([])
    await account(a); expect((await exchange([])).records.map(r => r.id)).toEqual(['a-only'])
  })
  it('rejects direct inserts, updates and deletion to prevent revision bypass', async () => {
    await account(b)
    await expect(db.query("update public.athlete_records set payload = '{}'::jsonb")).rejects.toThrow('permission denied')
    await expect(db.query('delete from public.athlete_records')).rejects.toThrow('permission denied')
    await expect(db.query("insert into public.athlete_records values ($1,'programme','evil',1,'{}',now())", [a])).rejects.toThrow('permission denied')
  })
  it('rejects stale revisions atomically across the whole batch', async () => {
    await account(a)
    const result = await exchange([row('a-only', 0), row('must-not-exist')])
    expect(result.applied).toBe(false)
    expect(result.records.some(r => r.id === 'must-not-exist')).toBe(false)
    expect(result.records.find(r => r.id === 'a-only')!.revision).toBe(1)
  })
  it('keeps tombstones and rejects resurrection by a stale device', async () => {
    await account(a); await exchange([row('a-only', 1, null)])
    const result = await exchange([row('a-only', 0)])
    expect(result.applied).toBe(false)
    expect(result.records.find(r => r.id === 'a-only')).toMatchObject({ payload: null, revision: 2 })
  })
  it('rolls back a complete batch when any record violates validation', async () => {
    await account(a)
    await expect(exchange([row('rolled-back'), row('bad', 0, { id: 'different-id' })])).rejects.toThrow()
    expect((await exchange([])).records.some(r => r.id === 'rolled-back')).toBe(false)
    await expect(exchange([row('duplicate'), row('duplicate')])).rejects.toThrow('Duplicate')
    await expect(exchange([{ ...row('owner-injection'), owner_id: b }])).rejects.toThrow('Invalid')
    await expect(exchange([{ ...row('negative'), expected_revision: -1 }])).rejects.toThrow('Invalid')
  })
})
