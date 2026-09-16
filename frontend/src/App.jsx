import { useState, useEffect, lazy, Suspense } from "react"
import axios from "axios"
import { supabase, readPersistedSession, clearPersistedSession } from "./supabase"
import { API, API_TIMEOUT_MS, API_CONFIG_ERROR, getToken, rememberSession, SPLASH_FLOOR_MS } from "./lib/api"
import { THEME, BRAND_NAME, BRAND_LOGO } from "./theme/tokens"
import { useIsMobile } from "./lib/useIsMobile"

// Eager: the shell itself. AuthPage is the first thing a signed-out visitor
// sees, and Sidebar is on screen for every signed-in one, so code-splitting
// either would only add a blank frame.
import AuthPage from "./pages/AuthPage"
import Sidebar from "./pages/Sidebar"

// Lazy: one chunk per route. An employee never opens Approvals or the Finance
// Dashboard, and previously downloaded and parsed both on first paint --
// everything lived in one 3.6k-line module. Modals and cards used by a page
// (CreateClaimModal, AddExpenseModal, PolicyAskCard) ride along in that page's
// own chunk because the page imports them directly.
const Dashboard = lazy(() => import("./pages/Dashboard"))
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"))
const TripPlannerPage = lazy(() => import("./pages/TripPlannerPage"))
const ClaimsPage = lazy(() => import("./pages/ClaimsPage"))
const SubmitExpensePage = lazy(() => import("./pages/SubmitExpensePage"))
const ClaimDetail = lazy(() => import("./pages/ClaimDetail"))
const AvailableExpensesPage = lazy(() => import("./pages/AvailableExpensesPage"))
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"))
const ApprovalsPage = lazy(() => import("./pages/ApprovalsPage"))
const FinanceDashboard = lazy(() => import("./pages/FinanceDashboard"))
const PolicyPage = lazy(() => import("./pages/PolicyPage"))
const PeoplePage = lazy(() => import("./pages/PeoplePage"))
const SystemPage = lazy(() => import("./pages/SystemPage"))
const MileagePage = lazy(() => import("./pages/MileagePage"))
const ProfilePage = lazy(() => import("./pages/ProfilePage"))
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"))

// Shown while a route chunk is in flight. Deliberately plain: on a warm cache
// these resolve in a frame or two, and a spinner that flashes reads worse than
// a line of text.
function RouteFallback() {
  return (
    <div style={{ padding: 60, textAlign: "center", color: THEME.textMuted, fontSize: 13 }}>
      Loading…
    </div>
  )
}

export default function App() {
  const isMobile = useIsMobile(900)
  // Seeded straight from localStorage, synchronously, so a signed-in user paints the
  // app on the first frame. Waiting on supabase.auth.getSession() here is what made
  // every load sit at the splash for the full restore timeout: that call queues on a
  // navigator lock that stays contended across tabs and, once wedged, never clears.
  const [session, setSession] = useState(readPersistedSession)
  const [profile, setProfile] = useState(null)
  const [page, setPage] = useState("dashboard")
  const [currentClaim, setCurrentClaim] = useState(null)
  const [loading, setLoading] = useState(() => !readPersistedSession())
  const [apiError, setApiError] = useState("")
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // What the SERVER says this caller may do. The UI used to derive its
  // navigation from profile.role read straight from Supabase in the browser,
  // which meant client and server each held their own opinion about what a
  // role could reach. This is the server's answer, and the only one the nav
  // renders from — every endpoint still enforces independently.
  const [capabilities, setCapabilities] = useState({})

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false)
  }, [isMobile])

  // "checking" | "waking" | "ok" | "down" | "degraded"
  const [apiStatus, setApiStatus] = useState("checking")

  const checkBackend = async () => {
    setApiStatus("checking")
    setApiError("")
    try {
      const r = await axios.get(`${API}/health`, { timeout: API_TIMEOUT_MS })
      if (r.data?.status === "degraded") {
        setApiStatus("degraded")
        setApiError(`Backend is running but misconfigured: ${(r.data.boot_errors || []).join(" ")}`)
      } else {
        setApiStatus("ok")
      }
    } catch {
      setApiStatus("down")
      setApiError(`Cannot reach backend at ${API}.`)
    }
  }

  useEffect(() => {
    if (API_CONFIG_ERROR) {
      setApiStatus("down")
      setApiError(API_CONFIG_ERROR)
      return
    }

    let cancelled = false
    // Free-tier backends (Render) sleep after inactivity and can take up to
    // ~60s to wake. Retry with backoff instead of blocking the whole app.
    const verifyApi = async () => {
      const MAX_ATTEMPTS = 6
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const r = await axios.get(`${API}/health`, { timeout: API_TIMEOUT_MS })
          if (cancelled) return
          if (r.data?.status === "degraded") {
            setApiStatus("degraded")
            setApiError(`Backend is running but misconfigured: ${(r.data.boot_errors || []).join(" ")}`)
          } else {
            setApiStatus("ok")
            setApiError("")
          }
          return
        } catch {
          if (cancelled) return
          if (attempt < MAX_ATTEMPTS) {
            setApiStatus("waking")
            await new Promise(res => setTimeout(res, 8000))
          } else {
            setApiStatus("down")
            setApiError(`Cannot reach backend at ${API}. Check that the backend service is deployed and running.`)
          }
        }
      }
    }

    verifyApi()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const loadProfile = async (sess) => {
      if (!sess?.user?.id) {
        setProfile(null)
        return
      }

      try {
        const { data } = await supabase.from("profiles").select("*").eq("id", sess.user.id).single()
        if (data) {
          setProfile(data)
          return
        }
      } catch {}

      const emailPrefix = sess.user.email?.split("@")[0]
      const fallbackName = sess.user.user_metadata?.full_name || sess.user.user_metadata?.name || emailPrefix || "User"
      setProfile({
        id: sess.user.id,
        full_name: fallbackName,
        role: "employee",
        company_id: "default",
      })
    }

    let cancelled = false

    // No getSession() call here on purpose. It queues on the SDK's navigator lock,
    // which stays wedged across tabs, so it reliably never resolved and held the whole
    // app at the splash. The session was already seeded from storage above; the SDK
    // emits INITIAL_SESSION through this listener once its own init completes, plus
    // TOKEN_REFRESHED on every silent refresh, so the lock resolving is an upgrade
    // rather than something first paint depends on.
    const seeded = readPersistedSession()
    rememberSession(seeded)
    if (seeded) loadProfile(seeded)

    // Floor under the splash for the no-stored-session case, where the SDK's own
    // INITIAL_SESSION is the only thing that would clear it — and that event is itself
    // behind the lock. Showing the login form a beat early costs nothing: if a session
    // does arrive afterwards, the listener above renders straight into the app.
    const splashFloor = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, SPLASH_FLOOR_MS)

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (cancelled) return
      rememberSession(session)
      setSession(session)
      // Whatever the event says is now authoritative — including a null session, which
      // is how a sign-out in another tab reaches this one.
      setLoading(false)
      if (!session) {
        setProfile(null)
        setPage("dashboard")
        return
      }
      await loadProfile(session)
    })

    return () => {
      cancelled = true
      clearTimeout(splashFloor)
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) { setCapabilities({}); return }
    let cancelled = false
    const loadCapabilities = async () => {
      try {
        const token = await getToken()
        const r = await axios.get(`${API}/me`, {
          headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
        })
        if (!cancelled) setCapabilities(r.data?.capabilities || {})
      } catch {
        // A failed capability read must not lock anyone out of their own work:
        // fall back to the employee set, which every account has.
        if (!cancelled) setCapabilities({})
      }
    }
    loadCapabilities()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const handleLogout = async () => {
    // signOut() goes through the same wedged navigator lock as getSession(), so
    // awaiting it before clearing state is why the button appeared dead. Sign out
    // locally first — dropping the session state and the stored token is what actually
    // logs the user out of this browser — then let the SDK's own call settle whenever
    // it can. If it never does, the user is still signed out here and on reload.
    setSession(null)
    setProfile(null)
    setPage("dashboard")
    rememberSession(null)
    clearPersistedSession()

    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error("Server-side sign-out did not complete:", err)
    }
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", background: THEME.bg }}>
      <div style={{ textAlign: "center" }}>
        <img
          src={BRAND_LOGO}
          alt={`${BRAND_NAME} logo`}
          onError={(e) => { e.currentTarget.style.display = "none" }}
          style={{ width: 64, height: 64, objectFit: "contain", marginBottom: 12 }}
        />
        <div style={{ color: THEME.textSecond, fontSize: 14 }}>Loading {BRAND_NAME}...</div>
      </div>
    </div>
  )

  const apiBanner = (apiStatus === "waking" || apiStatus === "down" || apiStatus === "degraded") && (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "9px 16px", fontSize: 13,
      background: apiStatus === "waking" ? "rgba(245,158,11,0.10)" : THEME.redDim,
      borderBottom: `1px solid ${apiStatus === "waking" ? "rgba(245,158,11,0.35)" : "rgba(239,68,68,0.35)"}`,
      color: apiStatus === "waking" ? THEME.amber : THEME.red,
    }}>
      <WifiOff size={14} strokeWidth={1.8} />
      {apiStatus === "waking" ? (
        <span>Connecting to server — free-tier backends can take up to a minute to wake. Retrying automatically…</span>
      ) : (
        <span>{apiError} <span style={{ color: THEME.textMuted }}>({API})</span></span>
      )}
      {apiStatus !== "waking" && (
        <button onClick={checkBackend} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt, color: THEME.textPrimary, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Retry
        </button>
      )}
    </div>
  )

  if (!session) return (
    <div>
      {apiBanner}
      <AuthPage onAuth={(user, sess, prof) => { setSession(sess); setProfile(prof) }} />
    </div>
  )

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", background: THEME.bg, color: THEME.textPrimary }}>
      {!isMobile && (
        <Sidebar
          page={page}
          setPage={(p) => { setPage(p) }}
          profile={profile}
          capabilities={capabilities}
          onLogout={handleLogout}
          onProfileUpdate={setProfile}
        />
      )}

      {isMobile && mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.08)", zIndex: 1190 }}
        />
      )}
      {isMobile && mobileNavOpen && (
        <Sidebar
          page={page}
          setPage={(p) => { setPage(p) }}
          profile={profile}
          capabilities={capabilities}
          onLogout={handleLogout}
          onProfileUpdate={setProfile}
          isMobile
          onNavigate={() => setMobileNavOpen(false)}
        />
      )}

      <div style={{ flex: 1, overflowY: "auto", width: "100%" }}>
        {apiBanner}
        {isMobile && (
          <div style={{ position: "sticky", top: 0, zIndex: 800, background: THEME.bg, borderBottom: `1px solid ${THEME.border}`, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              onClick={() => setMobileNavOpen(true)}
              style={{ background: "transparent", border: `1px solid ${THEME.border}`, color: THEME.textPrimary, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13 }}
            >
              ☰ Menu
            </button>
            <div style={{ fontWeight: 700, letterSpacing: "0.02em" }}><span style={{ color: "#111827" }}>AUDI</span><span style={{ color: "#4d7a00" }}>XA</span></div>
          </div>
        )}

        <Suspense fallback={<RouteFallback />}>
          {page === "dashboard" && (
            capabilities.manage_users
              ? <AdminDashboard profile={profile} setPage={setPage} isMobile={isMobile} />
              : capabilities.approve_claims && !capabilities.submit_expenses
                ? <FinanceDashboard profile={profile} capabilities={capabilities} setPage={setPage} />
                : <Dashboard profile={profile} setPage={setPage} setCurrent={setCurrentClaim} isMobile={isMobile} />
          )}
          {page === "notifications" && <NotificationsPage setPage={setPage} setCurrent={setCurrentClaim} isMobile={isMobile} />}
          {page === "tripPlanner"  && <TripPlannerPage profile={profile} isMobile={isMobile} />}
          {page === "claims"       && <ClaimsPage profile={profile} setPage={setPage} setCurrent={setCurrentClaim} isMobile={isMobile} />}
          {page === "submitExpense" && <SubmitExpensePage profile={profile} setPage={setPage} setCurrent={setCurrentClaim} />}
          {page === "claimDetail"  && currentClaim && <ClaimDetail claim={currentClaim} setPage={setPage} profile={profile} isMobile={isMobile} />}
          {page === "expenses"     && <AvailableExpensesPage setPage={setPage} isMobile={isMobile} />}
          {page === "analytics"    && <AnalyticsPage profile={profile} capabilities={capabilities} isMobile={isMobile} />}
          {page === "approvals"    && <ApprovalsPage />}
          {page === "finance"      && <FinanceDashboard profile={profile} capabilities={capabilities} setPage={setPage} />}
          {page === "policy"       && <PolicyPage session={session} profile={profile} capabilities={capabilities} />}
          {page === "people"       && <PeoplePage profile={profile} />}
          {page === "system"       && <SystemPage />}
          {page === "mileage"      && <MileagePage profile={profile} setPage={setPage} />}
          {page === "profile"      && <ProfilePage onProfileUpdate={setProfile} isMobile={isMobile} />}

        </Suspense>
      </div>
    </div>
  )
}
