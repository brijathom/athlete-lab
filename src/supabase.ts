import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkedExchange, type CloudTransport } from './cloud-sync'

export function cloudConfiguration(url: string | undefined, key: string | undefined): { client: SupabaseClient | null; error: string | null } {
  if (!url && !key) return { client: null, error: null }
  try {
    const parsed = new URL(url ?? '')
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Use HTTPS for Supabase, or localhost for its local development server.')
    let publicKey = key?.startsWith('sb_publishable_') ?? false
    if (key?.startsWith('eyJ')) {
      try { publicKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon' } catch { publicKey = false }
    }
    if (!publicKey) throw new Error('Configure a Supabase publishable key (or legacy anon key), never a secret or service-role key.')
    return { client: createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }), error: null }
  } catch (error) { return { client: null, error: error instanceof Error ? error.message : 'Invalid Supabase configuration.' } }
}
const configuration = cloudConfiguration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
export const supabase = configuration.client
export const cloudConfigurationError = configuration.error
export function supabaseTransport(client: SupabaseClient, owner: string): CloudTransport {
  return {
    async exchange(changes) {
      const { data: { session } } = await client.auth.getSession()
      if (!session || session.user.id !== owner) throw new Error('Sign in to this account again to synchronise. Local changes are safe.')
      const { data, error } = await client.rpc('athlete_sync', { changes }).abortSignal(AbortSignal.timeout(30000))
      if (error) {
        if (error.code === 'PGRST301' || error.code === '28000' || error.code === 'PGRST303') throw new Error('Your session expired. Sign in again; pending changes remain on this device.')
        throw new Error('Cloud synchronisation could not finish. Check connectivity and Supabase setup, then retry. Local changes are safe.')
      }
      return checkedExchange(data)
    },
  }
}
