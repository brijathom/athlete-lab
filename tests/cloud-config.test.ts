import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cloudConfiguration, supabaseTransport } from '../src/supabase'

describe('cloud configuration and authentication boundary', () => {
  it('keeps unconfigured builds local and rejects privileged keys or insecure remote URLs', () => {
    expect(cloudConfiguration(undefined, undefined)).toEqual({ client: null, error: null })
    expect(cloudConfiguration('https://project.supabase.co', 'sb_secret_private').client).toBeNull()
    expect(cloudConfiguration('https://project.supabase.co', `eyJ.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`).error).toContain('never a secret')
    expect(cloudConfiguration('http://remote.example', 'sb_publishable_test').error).toContain('HTTPS')
    expect(cloudConfiguration('not a URL', 'sb_publishable_test').client).toBeNull()
  })
  it('never calls the sync RPC when the session is missing or belongs to another account', async () => {
    const rpc = vi.fn(), getSession = vi.fn().mockResolvedValue({ data: { session: null } })
    const client = { auth: { getSession }, rpc } as unknown as SupabaseClient
    await expect(supabaseTransport(client, 'a').exchange([])).rejects.toThrow('Sign in')
    getSession.mockResolvedValue({ data: { session: { user: { id: 'b' } } } })
    await expect(supabaseTransport(client, 'a').exchange([])).rejects.toThrow('Sign in')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('handles expired sessions and incompatible schemas without exposing response details', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ error: { code: 'PGRST301', message: 'private server diagnostics' } })
    const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'a' } } } }) }, rpc: () => ({ abortSignal }) } as unknown as SupabaseClient
    await expect(supabaseTransport(client, 'a').exchange([])).rejects.toThrow('session expired')
    abortSignal.mockResolvedValue({ data: { schemaVersion: 99, records: [], applied: true } })
    await expect(supabaseTransport(client, 'a').exchange([])).rejects.toThrow('incompatible')
    abortSignal.mockResolvedValue({ data: { schemaVersion: 1, records: [], applied: true } })
    expect(await supabaseTransport(client, 'a').exchange([])).toEqual({ applied: true, records: {} })
  })
})
