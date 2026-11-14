import { supabase } from './supabase'
import { CoachError } from './coach-domain'

export async function coachRequest<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  if (!supabase) throw new CoachError(503, 'Cloud coaching is not configured. You can continue training locally.')
  if (!navigator.onLine) throw new CoachError(503, 'Coaching needs an internet connection. Your training is still available offline.')
  const { data, error } = await supabase.functions.invoke('coach', { body: body as Record<string, unknown>, signal: signal ?? AbortSignal.timeout(90000) })
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      try { const problem = await error.context.json(); if (typeof problem.error === 'string') throw new CoachError(error.context.status, problem.error, problem.code) } catch (problem) { if (problem instanceof CoachError) throw problem }
    }
    throw new CoachError(503, 'AI coaching could not connect. Check the Edge Function setup or try later. Training remains available.', 'connection_failed')
  }
  return data as T
}
export function downloadCoachJSON(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `athlete-lab-coaching-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
