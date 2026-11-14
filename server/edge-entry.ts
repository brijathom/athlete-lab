import { createCoachHandler, defaultLimits } from './coach-handler'
import { OpenAIResponses } from './openai-responses'
import { supabaseCoachStore } from './supabase-coach-store'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
const env = (name: string) => Deno.env.get(name) ?? ''
const limit = (name: string, fallback: number, max: number) => { const n = Number(env(name)); return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback }
// Only this Edge entry reads private secrets. It is never imported by the client.
const store = supabaseCoachStore(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), env('SUPABASE_SERVICE_ROLE_KEY'))
const model = new OpenAIResponses(env('OPENAI_API_KEY'), env('OPENAI_MODEL') || 'gpt-6.1-sol', limit('COACH_MAX_OUTPUT_TOKENS', 3000, 6000), fetch, env('COACH_EXTRA_INSTRUCTIONS'))
Deno.serve(createCoachHandler(store, model, (env('COACH_ALLOWED_ORIGINS') || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()), {
  hourly: limit('COACH_HOURLY_REQUESTS', defaultLimits.hourly, 100), daily: limit('COACH_DAILY_REQUESTS', defaultLimits.daily, 1000), tokens: limit('COACH_DAILY_TOKENS', defaultLimits.tokens, 5000000), globalDaily: limit('COACH_GLOBAL_DAILY_REQUESTS', defaultLimits.globalDaily, 10000), globalTokens: limit('COACH_GLOBAL_DAILY_TOKENS', defaultLimits.globalTokens, 50000000),
}))
