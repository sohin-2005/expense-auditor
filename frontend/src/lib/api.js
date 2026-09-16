import { supabase } from "../supabase"

// Backend address and the session-token accessor every page calls before a
// request. Extracted verbatim from App.jsx -- the comments below record why
// this caches rather than calling getSession() each time.

const isLocalHost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
const configuredApiUrl = (import.meta.env.VITE_API_URL || "").trim()
const PROD_API_FALLBACK = "https://expense-auditor-4f7b.onrender.com"
export const API = configuredApiUrl || (isLocalHost ? "http://127.0.0.1:8000" : PROD_API_FALLBACK)
export const API_TIMEOUT_MS = 45000
export const API_CONFIG_ERROR = !API
  ? "Backend API is not configured. Set VITE_API_URL to your deployed backend URL in Vercel Project Settings and redeploy."
  : ""

// Every authenticated request needs a bearer token, and supabase.auth.getSession()
// acquires the gotrue "lock:sb-<ref>-auth-token" navigator lock on each call. With a
// getToken() at ~14 call sites, concurrent actions pile up on that one lock; gotrue
// force-steals any lock held past 5s and the loser rejects with 'Lock "..." was
// released because another request stole it', which surfaced to users as a failed
// upload. The session we already track via onAuthStateChange carries the same token,
// so serve it from here and let N concurrent requests take zero locks.
let cachedSession = null
export const rememberSession = (session) => { cachedSession = session ?? null }

// Refresh a little before the JWT actually expires, so a request in flight when the
// clock rolls over doesn't land as a 401.
const TOKEN_EXPIRY_SKEW_SECONDS = 60

// How long the splash may stay up waiting on the SDK's INITIAL_SESSION before we give
// up and render the login form. Short by design: nothing the user needs is behind it.
export const SPLASH_FLOOR_MS = 1500

// Returning undefined here is not an option: every caller interpolates the result
// straight into `Bearer ${token}`, so a missing token used to leave as the literal
// string "Bearer undefined" and come back from the API as an opaque 401 "Invalid
// token". Throw instead — the callers all catch and surface err.message, so the user
// gets told to sign in again rather than being handed a server error.
const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again."

export const getToken = async () => {
  const expiresAt = cachedSession?.expires_at
  if (cachedSession?.access_token && expiresAt &&
      expiresAt - TOKEN_EXPIRY_SKEW_SECONDS > Date.now() / 1000) {
    return cachedSession.access_token
  }

  // Cache is empty or the token is at/near expiry — go to gotrue, which refreshes it
  // and fires TOKEN_REFRESHED, repopulating the cache through onAuthStateChange.
  let session
  try {
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch (err) {
    // A stolen lock rejects here.
    console.error("getToken: getSession() rejected (contended auth lock?):", err)
    throw new Error(SESSION_EXPIRED_MESSAGE)
  }

  rememberSession(session)
  if (!session?.access_token) {
    console.error("getToken: getSession() resolved with no session — signed out or storage cleared")
    throw new Error(SESSION_EXPIRED_MESSAGE)
  }
  return session.access_token
}
