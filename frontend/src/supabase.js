import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_KEY || '').trim()

export const missingSupabaseEnv = [
  !SUPABASE_URL && 'VITE_SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'VITE_SUPABASE_KEY',
].filter(Boolean)

export const isSupabaseConfigured = missingSupabaseEnv.length === 0

// createClient() throws synchronously when the URL/key are missing. At module
// scope that kills the bundle before React ever mounts, and the deployed site
// renders as a blank white page with no clue what went wrong. Fall back to an
// inert placeholder client so the app can boot and show an actionable setup
// screen instead (see main.jsx).
export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? SUPABASE_ANON_KEY : 'placeholder-anon-key',
)

// The SDK persists the session under sb-<project-ref>-auth-token, and guards every
// read of it through a navigator lock named after the same key. That lock is the one
// that deadlocks across tabs — so for first paint we read the storage entry directly.
// Same bytes, no lock, no await. The SDK stays the source of truth afterwards, via
// onAuthStateChange.
const projectRef = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0]
  } catch {
    return ''
  }
})()

export const AUTH_STORAGE_KEY = `sb-${projectRef}-auth-token`

export const readPersistedSession = () => {
  if (!isSupabaseConfigured || !projectRef) return null
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    if (!session?.access_token) return null
    // Don't seed an already-dead token: let the SDK refresh it instead.
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) return null
    return session
  } catch {
    return null
  }
}

export const clearPersistedSession = () => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {}
}
