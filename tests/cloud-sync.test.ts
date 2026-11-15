import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { completeBackup } from './fixtures/backup'
import { IndexedDBRepository } from '../src/repository'
import { CloudSync, checkedExchange, type CloudTransport } from '../src/cloud-sync'
import { fromRecords, parseRemote, pendingChanges, reconcile, same, toRecords, type PendingChange, type RecordMap } from '../src/sync-domain'

class Server implements CloudTransport {
  records: RecordMap = {}; fail = false
  async exchange(changes: PendingChange[]) {
    if (this.fail) throw new Error('Offline')
    const applied = changes.every(c => (this.records[`${c.kind}:${c.id}`]?.revision ?? 0) === c.expected_revision)
    if (applied) for (const c of changes) this.records[`${c.kind}:${c.id}`] = { kind: c.kind, id: c.id, revision: c.expected_revision + 1, payload: structuredClone(c.payload) }
    return { applied, records: structuredClone(this.records) }
  }
}
let dbIndex = 0
const repo = () => new IndexedDBRepository(`sync-test-${++dbIndex}`)
async function connected(server: Server, data = completeBackup(), owner = 'athlete-a', download = false) {
  const repository = repo(); await repository.load()
  const engine = new CloudSync(repository, owner, server, () => undefined)
  await engine.connect(download ? 'download' : 'upload', data)
  if (!download) await engine.sync()
  return { repository, engine, owner }
}
describe('record mapping and sync protocol', () => {
  it('round-trips every backup entity, snapshots, skills, health and preferences without changing the backup schema', () => {
    const original = completeBackup(), records = toRecords(original), restored = fromRecords(records)
    expect(toRecords(restored)).toEqual(records)
    expect(restored.logs).toEqual(expect.arrayContaining(original.logs))
    expect(restored.recoveryEntries).toEqual(original.recoveryEntries)
    expect(restored.performance.matches).toEqual(original.performance.matches)
    expect(original.version).toBe(4)
    expect(same({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true)
  })
  it('rejects incompatible responses and invalid graphs without touching local records', () => {
    expect(() => checkedExchange({ schemaVersion: 2, applied: true, records: [] })).toThrow('incompatible')
    expect(() => parseRemote([{ kind: 'session', id: 'x', revision: 0, payload: {} }])).toThrow('invalid')
    expect(() => parseRemote([{ kind: 'session', id: 'x', revision: 1, payload: { id: 'y' } }])).toThrow('mismatched')
    const row = { kind: 'programme', id: 'x', revision: 1, payload: { id: 'x' } }
    expect(() => parseRemote([row, row])).toThrow('duplicate')
    expect(() => fromRecords({})).toThrow()
  })
  it('detects only changed records and retains deletion revisions', () => {
    const data = completeBackup(), base = toRecords(data)
    Object.values(base).forEach(row => { row.revision = 4 })
    const removed = data.sessions.pop()!
    expect(pendingChanges(data, base)).toEqual([{ kind: 'session', id: removed.id, expected_revision: 4, payload: null }])
  })
})
describe('durable, account-isolated offline synchronisation', () => {
  it('preserves original local data and requires an explicit account connection', async () => {
    const repository = repo(), original = await repository.load(), server = new Server()
    expect(await repository.selectAccount('new')).toBeNull()
    expect(await repository.load()).toEqual(original)
    expect(Object.values(server.records)).toHaveLength(0)
    const engine = new CloudSync(repository, 'new', server, () => undefined)
    await engine.connect('upload', original)
    expect((await repository.accountState('new'))!.sync.pending.length).toBeGreaterThan(0)
    await engine.sync()
    await repository.selectAccount(null)
    expect(await repository.load()).toEqual(original)
  })
  it('persists offline create/edit/delete outbox atomically and retries across engine restarts', async () => {
    const server = new Server(), { repository, engine, owner } = await connected(server)
    const original = await repository.load(), changed = structuredClone(original)
    changed.profile.position = 'Midfield'; changed.sessions = changed.sessions.slice(1)
    changed.programmes.push({ id: 'offline-new', name: 'Offline programme', description: '' })
    await repository.save(changed, original)
    server.fail = true
    await expect(engine.sync()).rejects.toThrow('Offline')
    expect((await repository.accountState(owner))!.sync.pending).toHaveLength(3)
    const restarted = new CloudSync(repository, owner, server, () => undefined)
    server.fail = false; await restarted.sync()
    expect((await repository.accountState(owner))!.sync.pending).toEqual([])
    expect(server.records[`session:${original.sessions[0].id}`].payload).toBeNull()
    expect((server.records['profile:singleton'].payload as { position: string }).position).toBe('Midfield')
  })
  it('merges independent changes from two devices', async () => {
    const server = new Server(), a = await connected(server), b = await connected(server, completeBackup(), 'athlete-a', true)
    const first = await a.repository.load(), second = await b.repository.load()
    await a.repository.save({ ...first, profile: { ...first.profile, position: 'Forward' } })
    await b.repository.save({ ...second, theme: 'dark' })
    await a.engine.sync(); await b.engine.sync(); await a.engine.sync()
    expect((await a.repository.load()).theme).toBe('dark')
    expect((await b.repository.load()).profile.position).toBe('Forward')
  })
  it('keeps divergent edits until explicit resolution and blocks editing while in review', async () => {
    const server = new Server(), a = await connected(server), b = await connected(server, completeBackup(), 'athlete-a', true)
    const first = await a.repository.load(), second = await b.repository.load()
    await a.repository.save({ ...first, profile: { ...first.profile, position: 'A' } })
    await b.repository.save({ ...second, profile: { ...second.profile, position: 'B' } })
    await a.engine.sync(); await b.engine.sync()
    const review = (await b.repository.accountState(b.owner))!.sync.review!
    expect(review.conflicts.map(c => c.key)).toEqual(['profile:singleton'])
    expect((await b.repository.load()).profile.position).toBe('B')
    await expect(b.repository.save(second)).rejects.toThrow('Resolve')
    await expect(b.engine.resolve({})).rejects.toThrow('every')
    await b.engine.resolve({ 'profile:singleton': 'local' }); await b.engine.sync(); await a.engine.sync()
    expect((await a.repository.load()).profile.position).toBe('B')
  })
  it('propagates deletion and cannot silently resurrect an edited record on a stale device', async () => {
    const server = new Server(), a = await connected(server), b = await connected(server, completeBackup(), 'athlete-a', true)
    const first = await a.repository.load(), second = await b.repository.load(), target = first.sessions[0].id
    await a.repository.save({ ...first, sessions: first.sessions.filter(s => s.id !== target) })
    await b.repository.save({ ...second, sessions: second.sessions.map(s => s.id === target ? { ...s, title: 'Stale edit' } : s) })
    await a.engine.sync(); await b.engine.sync()
    expect((await b.repository.accountState(b.owner))!.sync.review!.conflicts[0].remote.payload).toBeNull()
    await b.engine.resolve({ [`session:${target}`]: 'cloud' }); await b.engine.sync()
    expect((await b.repository.load()).sessions.some(s => s.id === target)).toBe(false)
    expect(server.records[`session:${target}`].payload).toBeNull()
    expect((await b.repository.load()).logs).toEqual(expect.arrayContaining(first.logs))
  })
  it('does not mix account branches or discard either account’s pending changes', async () => {
    const repository = repo(), anonymous = await repository.load(), serverA = new Server(), serverB = new Server()
    const a = new CloudSync(repository, 'a', serverA, () => undefined)
    await a.connect('upload', completeBackup()); const first = await repository.load()
    await repository.save({ ...first, profile: { ...first.profile, name: 'Private A' } })
    await repository.selectAccount(null)
    const b = new CloudSync(repository, 'b', serverB, () => undefined)
    await b.connect('upload', anonymous)
    expect((await repository.load()).profile.name).toBe('')
    await repository.selectAccount('a')
    expect((await repository.load()).profile.name).toBe('Private A')
    expect((await repository.accountState('a'))!.sync.pending.length).toBeGreaterThan(0)
    await repository.selectAccount(null); expect(await repository.load()).toEqual(anonymous)
  })
  it('previews existing cloud overlaps instead of silently replacing them at first upload', async () => {
    const server = new Server(); await connected(server)
    const repository = repo(), local = completeBackup(); local.profile.name = 'Different device'
    const engine = new CloudSync(repository, 'athlete-a', server, () => undefined)
    await engine.connect('upload', local)
    expect((await repository.accountState('athlete-a'))!.sync.review!.conflicts.some(c => c.key === 'profile:singleton')).toBe(true)
    expect((server.records['profile:singleton'].payload as { name: string }).name).not.toBe('Different device')
    await engine.resolve({}, true)
    expect((await repository.load()).profile.name).not.toBe('Different device')
  })
  it('preserves local data on invalid cloud data, expired authentication or failed restoration', async () => {
    const server = new Server(), { repository, engine } = await connected(server), original = await repository.load()
    delete server.records['profile:singleton']
    await engine.sync()
    expect((await repository.accountState('athlete-a'))!.sync.review?.error).toBeTruthy()
    await expect(engine.resolve({}, true)).rejects.toThrow('Nothing has been replaced')
    expect(await repository.load()).toEqual(original)
    await expect(repository.restore({ version: 99 })).rejects.toThrow()
    expect(await repository.load()).toEqual(original)
  })
  it('detects stale tab saves, validates restored backups and queues their changes', async () => {
    const server = new Server(), { repository } = await connected(server), original = await repository.load()
    await repository.save({ ...original, theme: original.theme === 'dark' ? 'light' : 'dark' }, original)
    await expect(repository.save({ ...original, theme: 'light' }, original)).rejects.toThrow('another tab')
    await repository.restore(original)
    expect((await repository.accountState('athlete-a'))!.sync.pending).toEqual([])
  })
  it('retains edits made during an in-flight push without losing the acknowledged revision', async () => {
    const server = new Server(), { repository, owner } = await connected(server), original = await repository.load()
    await repository.save({ ...original, profile: { ...original.profile, position: 'First' } })
    let changed = false
    const engine = new CloudSync(repository, owner, { async exchange(changes) {
      const response = await server.exchange(changes)
      if (changes.length && !changed) { changed = true; const current = await repository.load(); await repository.save({ ...current, profile: { ...current.profile, position: 'Second' } }) }
      return response
    } }, () => undefined)
    await engine.sync()
    expect((await repository.load()).profile.position).toBe('Second')
    expect((await repository.accountState(owner))!.sync.review).toBeUndefined()
    expect((await repository.accountState(owner))!.sync.pending).toHaveLength(1)
    await engine.sync(); expect((await repository.accountState(owner))!.sync.pending).toEqual([])
  })
  it('surfaces relationship conflicts without writing an invalid graph', () => {
    const data = completeBackup(), base = toRecords(data), remote = structuredClone(base)
    const programme = data.programmes[0]
    remote[`programme:${programme.id}`] = { ...remote[`programme:${programme.id}`], payload: null, revision: 2 }
    expect(reconcile(data, base, remote).error).toContain('related records')
  })
  it('does not activate an old account if authentication changes during connection', async () => {
    const repository = repo(), original = await repository.load(), server = new Server()
    let cancelled = false
    const engine = new CloudSync(repository, 'old-account', { async exchange(changes) { const result = await server.exchange(changes); cancelled = true; return result } }, () => undefined, () => cancelled)
    await expect(engine.connect('upload', original)).rejects.toThrow('interrupted')
    expect(repository.accountId).toBeNull()
    expect(await repository.load()).toEqual(original)
    expect(await repository.accountState('old-account')).toBeNull()
    await repository.selectAccount('old-account', () => false)
    expect(repository.accountId).toBeNull()
  })
})
