import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isConfigured } from './env'

/**
 * Supabase is used for authentication ONLY. Never query tables through this client:
 * all business data goes through the KasiFlow API (see apiClient.ts).
 */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}
