import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { AppData } from './domain'
import type { IndexedDBRepository } from './repository'
import { CloudSync, type SyncStatus } from './cloud-sync'
import type { SyncState } from './sync-domain'
import { supabase, supabaseTransport } from './supabase'

const statusFor = (sync: SyncState): SyncStatus => ({ phase: sync.review ? 'conflict' : sync.pending.length ? 'pending' : 'synced', pending: sync.pending.length, lastSynced: sync.lastSynced })
export function useCloud(repo: IndexedDBRepository | null, onData: (data: AppData) => void, paused: boolean) {
  const [user, setUser] = useState<User | null>(null), [state, setState] = useState<SyncState | null>(null)
  const [recovery, setRecovery] = useState(false), [switching, setSwitching] = useState(false)
  const [status, setStatus] = useState<SyncStatus>({ phase: 'local', pending: 0, lastSynced: null })
  const refs = useRef({ onData, paused }); refs.current = { onData, paused }
  const currentUser = useRef<string | null>(null), engine = useRef<CloudSync | null>(null), tickRunning = useRef(false)
  const run = useCallback(async () => {
    const worker = engine.current, owner = currentUser.current
    if (!worker || !repo || refs.current.paused || tickRunning.current) return
    tickRunning.current = true
    try {
      const stored = owner ? await repo.accountState(owner) : null
      if (!stored || owner !== currentUser.current) return
      setState(stored.sync)
      if (stored.sync.review) { setStatus(statusFor(stored.sync)); return }
      if (!navigator.onLine) { setStatus({ ...statusFor(stored.sync), phase: 'offline' }); return }
      setStatus({ ...statusFor(stored.sync), phase: 'syncing' })
      const next = await worker.sync()
      if (next && owner === currentUser.current) { setState(next); setStatus(statusFor(next)) }
    } catch (error) {
      if (owner === currentUser.current) setStatus(previous => ({ ...previous, phase: 'error', message: error instanceof Error ? error.message : 'Sync failed. Your local data is safe.' }))
    } finally { tickRunning.current = false }
  }, [repo])
  useEffect(() => {
    if (!repo || !supabase) return
    let live = true, initialized = false, chain = Promise.resolve()
    const changed = (owner: string) => (data: AppData, sync: SyncState) => {
      if (live && currentUser.current === owner && repo.accountId === owner) { refs.current.onData(data); setState(sync); setStatus(statusFor(sync)) }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      const owner = session?.user.id ?? null
      if (initialized && currentUser.current === owner) { setUser(session?.user ?? null); return }
      initialized = true; currentUser.current = owner; engine.current = null; setSwitching(true)
      // The auth callback remains synchronous: never await Supabase methods inside it.
      chain = chain.then(async () => {
        if (!live || currentUser.current !== owner) return
        const data = await repo.selectAccount(owner, () => live && currentUser.current === owner)
        if (!live || currentUser.current !== owner) return
        setUser(session?.user ?? null); setState(null)
        if (data) refs.current.onData(data)
        else refs.current.onData(await repo.load()) // untouched anonymous records until explicit setup
        if (owner && data) {
          const stored = await repo.accountState(owner)
          if (currentUser.current !== owner || !live) return
          engine.current = new CloudSync(repo, owner, supabaseTransport(supabase!, owner), changed(owner), () => refs.current.paused || currentUser.current !== owner || repo.accountId !== owner)
          if (stored) { setState(stored.sync); setStatus(statusFor(stored.sync)) }
        } else setStatus({ phase: owner ? 'setup' : 'local', pending: 0, lastSynced: null })
      }).catch(() => { if (live) setStatus({ phase: 'error', pending: 0, lastSynced: null, message: 'Unable to open this account’s local storage. Reload to retry.' }) }).finally(() => { if (live && currentUser.current === owner) setSwitching(false) })
    })
    const timer = setInterval(() => { void run() }, 15000)
    const online = () => { void run() }
    window.addEventListener('online', online); window.addEventListener('focus', online)
    return () => { live = false; subscription.unsubscribe(); clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('focus', online) }
  }, [repo, run])
  const connect = async (mode: 'upload' | 'download', data: AppData) => {
    if (!repo || !supabase || !user || currentUser.current !== user.id) throw new Error('Sign in first.')
    const owner = user.id
    setSwitching(true)
    try {
      const worker = new CloudSync(repo, owner, {
        async exchange(changes) {
          const result = await supabaseTransport(supabase!, owner).exchange(changes)
          if (currentUser.current !== owner) throw new Error('The signed-in account changed. Nothing was uploaded.')
          return result
        },
      }, (next, sync) => { if (currentUser.current === owner) { refs.current.onData(next); setState(sync); setStatus(statusFor(sync)) } }, () => refs.current.paused || currentUser.current !== owner)
      await worker.connect(mode, data)
      if (currentUser.current === owner) engine.current = worker
    } finally { setSwitching(false) }
  }
  const resolve = async (choices: Record<string, 'local' | 'cloud'>, completeCloud = false) => {
    if (!engine.current) throw new Error('Connect this account first.')
    await engine.current.resolve(choices, completeCloud)
    await run()
  }
  const localChanged = () => {
    const owner = currentUser.current
    if (!owner || !repo) return
    void repo.accountState(owner).then(stored => {
      if (stored && currentUser.current === owner) { setState(stored.sync); setStatus({ ...statusFor(stored.sync), ...(!navigator.onLine ? { phase: 'offline' as const } : {}) }) }
    }).catch(() => { /* The successful durable save is independent of status refresh. */ })
  }
  return { user, state, status, switching, recovery, finishRecovery: () => setRecovery(false), connect, resolve, retry: run, localChanged }
}
