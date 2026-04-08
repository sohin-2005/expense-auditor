import { useState, useEffect, useRef } from "react"
import { supabase } from "./supabase"
import axios from "axios"
import { FileText, ClipboardList, AlertTriangle, ScanLine, ShieldCheck, BadgeCheck, ChartNoAxesColumn, Bell, RefreshCw, MapPin, CalendarDays, Briefcase, Plane, BedDouble, UtensilsCrossed, ShieldAlert, WandSparkles } from "lucide-react"

const isLocalHost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
const configuredApiUrl = (import.meta.env.VITE_API_URL || "").trim()
const API = configuredApiUrl || (isLocalHost ? "http://127.0.0.1:8000" : "")
const API_TIMEOUT_MS = 45000
const API_CONFIG_ERROR = !API
  ? "Backend API is not configured. Set VITE_API_URL to your deployed backend URL in Vercel Project Settings and redeploy."
  : ""
const BRAND_NAME = "Audixa"
const BRAND_LOGO = "/audixa-logo.png?v=20260407"

const THEME = {
  bg: "#0d0d10",
  surface: "#13131a",
  surfaceAlt: "#0f0f15",
  border: "#1e1e26",
  borderHover: "#2a2a38",
  accent: "#76b900",
  accentHover: "#5a8c00",
  accentDim: "rgba(118,185,0,0.12)",
  blue: "#4da6ff",
  blueDim: "rgba(77,166,255,0.1)",
  amber: "#f59e0b",
  amberDim: "rgba(245,158,11,0.1)",
  textPrimary: "#e8e8e8",
  textSecond: "#888",
  textMuted: "#555",
}

const primaryBtnStyle = (disabled = false) => ({
  background: disabled
    ? "linear-gradient(135deg, #4b4b4b 0%, #2f2f2f 100%)"
    : "linear-gradient(135deg, #76b900 0%, #5a8c00 100%)",
  color: "#000",
  border: "none",
  borderRadius: 8,
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 0.22s ease",
})

const getToken = async () => {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}

const formatClaimDate = (claim) => {
  const raw = claim?.submitted_at || claim?.created_at || claim?.overridden_at
  if (!raw) return "—"
  return String(raw).split("T")[0]
}

const getClaimDisplayName = (claim) => {
  return claim?.report_name || claim?.purpose || claim?.entity || "Untitled Claim"
}

const STATUS_STYLES = {
  Draft: { bg: "rgba(100,100,120,0.15)", text: "#666", dot: "#555" },
  "Pending Approval": { bg: "rgba(245,158,11,0.1)", text: "#f59e0b", dot: "#f59e0b" },
  Approved: { bg: "rgba(118,185,0,0.12)", text: "#76b900", dot: "#76b900" },
  Rejected: { bg: "rgba(239,68,68,0.1)", text: "#ef4444", dot: "#ef4444" },
  Flagged: { bg: "rgba(245,158,11,0.1)", text: "#f59e0b", dot: "#f59e0b" },
}

const normalizeStatus = (status) => {
  const raw = String(status || "").trim().toLowerCase()
  if (!raw) return "Draft"
  if (raw === "pending approval") return "Flagged"
  if (raw === "approved") return "Approved"
  if (raw === "flagged") return "Flagged"
  if (raw === "rejected") return "Rejected"
  if (raw === "draft") return "Draft"
  return status || "Draft"
}

const getISTGreeting = () => {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date()))

  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 17) return "Good afternoon"
  if (hour >= 17 && hour < 21) return "Good evening"
  return "Good night"
}

const StatusBadge = ({ status }) => {
  const normalized = normalizeStatus(status)
  const s = STATUS_STYLES[normalized] || STATUS_STYLES.Draft
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, color: s.text,
      padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {normalized}
    </span>
  )
}

const Input = ({ label, required, error, ...props }) => (
  <div style={{ marginBottom: 14 }}>
    {label && (
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
      </label>
    )}
    <input {...props} style={{
      width: "100%", padding: "8px 11px", fontSize: 13,
      border: `1px solid ${error ? "#ef4444" : THEME.border}`,
      borderRadius: 6, boxSizing: "border-box", outline: "none",
      color: THEME.textPrimary,
      background: error ? "#2a1010" : THEME.surface,
      ...props.style
    }} />
    {error && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{error}</div>}
  </div>
)

const Select = ({ label, required, error, children, ...props }) => (
  <div style={{ marginBottom: 14 }}>
    {label && (
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
      </label>
    )}
    <select {...props} style={{
      width: "100%", padding: "8px 11px", fontSize: 13,
      border: `1px solid ${error ? "#ef4444" : THEME.border}`,
      borderRadius: 6, boxSizing: "border-box", background: THEME.surface, color: THEME.textPrimary, outline: "none",
      ...props.style
    }}>
      {children}
    </select>
    {error && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{error}</div>}
  </div>
)

function AuthPage({ onAuth }) {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState("employee")
  const [companyId, setCompanyId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handle = async () => {
    setLoading(true); setError("")
    try {
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        await supabase.from("profiles").insert({ id: data.user.id, full_name: name, role, company_id: companyId })
        setMode("login"); setError("Registered! Please log in.")
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        const profile = await supabase.from("profiles").select("*").eq("id", data.user.id).single()
        onAuth(data.user, data.session, profile.data)
      }
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0B0F19", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{
        width: "52%",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "72px 58px",
        color: "#E5E7EB",
        background: "radial-gradient(900px 520px at 20% 25%, rgba(132,204,22,0.22), transparent 60%), radial-gradient(700px 480px at 65% 60%, rgba(16,185,129,0.10), transparent 70%), linear-gradient(160deg, #0d1a00 0%, #0e1510 45%, #0B0F19 100%)",
        borderRight: `1px solid ${THEME.border}`
      }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.2, backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />
        <div style={{ position: "absolute", top: -120, left: -120, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(132,204,22,0.30) 0%, rgba(132,204,22,0) 70%)", filter: "blur(8px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -100, right: -80, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.22) 0%, rgba(16,185,129,0) 72%)", filter: "blur(10px)", pointerEvents: "none" }} />

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: "0.04em", lineHeight: 1, textTransform: "uppercase", fontFamily: "Inter, system-ui, sans-serif" }}>
            <span style={{ color: "#E5E7EB" }}>AUDI</span><span style={{ color: "#84CC16" }}>XA</span>
          </div>
        </div>

        <div style={{ position: "relative", fontSize: 43, fontWeight: 600, marginBottom: 18, lineHeight: 1.2, maxWidth: 560, fontFamily: "'Playfair Display', Georgia, serif", letterSpacing: "0.01em" }}>
          Smart Expense Management for Modern Teams
        </div>

        <div style={{ position: "relative", fontSize: 17, color: "#AAB4C4", lineHeight: 1.75, maxWidth: 560, marginBottom: 34 }}>
          Submit, track, and approve expense claims with AI-powered receipt scanning and real-time policy compliance.
        </div>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560 }}>
          {[
            { Icon: ScanLine, label: "AI receipt scanning" },
            { Icon: ShieldCheck, label: "Real-time policy checks" },
            { Icon: BadgeCheck, label: "One-click approvals" },
            { Icon: ChartNoAxesColumn, label: "Finance analytics" },
          ].map(({ Icon, label }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "11px 13px", borderRadius: 12,
              background: "rgba(11,15,25,0.35)", border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 26px rgba(0,0,0,0.25)",
              transition: "all 0.24s ease"
            }}>
              <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#A3E635", background: "rgba(132,204,22,0.08)", border: "1px solid rgba(132,204,22,0.28)", borderRadius: 6 }}>
                <Icon size={14} strokeWidth={2} />
              </span>
              <span style={{ fontSize: 13, color: "#D5DDEA", fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 48, background: "radial-gradient(600px 380px at 80% 20%, rgba(132,204,22,0.10), transparent 68%), #0B0F19" }}>
        <div style={{ width: 430, borderRadius: 18, padding: "28px 24px 24px", background: "linear-gradient(180deg, rgba(19,24,36,0.72) 0%, rgba(11,15,25,0.58) 100%)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(12px)", boxShadow: "0 14px 45px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 32, fontWeight: 600, color: "#E5E7EB", letterSpacing: "0.01em", fontFamily: "'Playfair Display', Georgia, serif" }}>
            {mode === "login" ? "Welcome back" : "Create account"}
          </h2>
          <p style={{ margin: "0 0 24px", color: "#94A3B8", fontSize: 15 }}>
            {mode === "login" ? `Sign in to your ${BRAND_NAME} account` : `Get started with ${BRAND_NAME}`}
          </p>

          <div style={{ display: "flex", marginBottom: 24, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 11, overflow: "hidden", background: "rgba(10,13,21,0.55)" }}>
            {[ ["login", "Sign In"], ["register", "Register"] ].map(([m, l]) => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "10px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                background: mode === m ? "linear-gradient(135deg, rgba(132,204,22,0.24), rgba(22,163,74,0.13))" : "transparent",
                color: mode === m ? "#84CC16" : "#94A3B8",
                transition: "all 0.26s ease"
              }}>{l}</button>
            ))}
          </div>

          {mode === "register" && <>
            <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} placeholder="John Smith" style={{ borderRadius: 10, padding: "11px 12px", background: "rgba(8,12,19,0.8)", border: "1px solid rgba(255,255,255,0.10)" }} />
            <Input label="Company ID" value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="e.g. acmecorp" style={{ borderRadius: 10, padding: "11px 12px", background: "rgba(8,12,19,0.8)", border: "1px solid rgba(255,255,255,0.10)" }} />
            <Select label="Role" value={role} onChange={e => setRole(e.target.value)} style={{ borderRadius: 10, padding: "11px 12px", background: "rgba(8,12,19,0.8)", border: "1px solid rgba(255,255,255,0.10)" }}>
              <option value="employee">Employee</option>
              <option value="finance">Finance Team</option>
              <option value="manager">Manager / Approver</option>
            </Select>
          </>}

          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={{ borderRadius: 10, padding: "11px 12px", background: "rgba(8,12,19,0.8)", border: "1px solid rgba(255,255,255,0.10)" }} />
          <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ borderRadius: 10, padding: "11px 12px", background: "rgba(8,12,19,0.8)", border: "1px solid rgba(255,255,255,0.10)" }} />

          {error && (
            <div style={{
              marginBottom: 16, padding: "10px 14px", borderRadius: 10, fontSize: 13,
              background: error.includes("Registered") ? "rgba(22,163,74,0.13)" : "rgba(239,68,68,0.14)",
              color: error.includes("Registered") ? "#86efac" : "#fca5a5",
              border: `1px solid ${error.includes("Registered") ? "rgba(34,197,94,0.35)" : "rgba(248,113,113,0.35)"}`
            }}>{error}</div>
          )}

          <button onClick={handle} disabled={loading} style={{ width: "100%", padding: "12px", fontSize: 15, fontWeight: 700, borderRadius: 11, boxShadow: loading ? "none" : "0 10px 24px rgba(132,204,22,0.30)", ...primaryBtnStyle(loading) }}>
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, profile, onLogout, onProfileUpdate }) {
  const isFinance = profile?.role === "finance" || profile?.role === "manager"
  const [showProfileEditor, setShowProfileEditor] = useState(false)
  const [editName, setEditName] = useState(profile?.full_name || "")
  const [editCompany, setEditCompany] = useState(profile?.company_id || "default")
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState("")

  useEffect(() => {
    setEditName(profile?.full_name || "")
    setEditCompany(profile?.company_id || "default")
  }, [profile?.id, profile?.full_name, profile?.company_id])

  const saveProfile = async () => {
    const nextName = (editName || "").trim()
    const nextCompany = (editCompany || "default").trim() || "default"
    if (!nextName) {
      setProfileMsg("Name is required")
      return
    }

    setSavingProfile(true)
    setProfileMsg("")
    try {
      if (profile?.id) {
        await supabase
          .from("profiles")
          .update({ full_name: nextName, company_id: nextCompany })
          .eq("id", profile.id)
      }

      onProfileUpdate?.({
        ...(profile || {}),
        full_name: nextName,
        company_id: nextCompany,
      })
      setProfileMsg("Saved")
      setShowProfileEditor(false)
    } catch (e) {
      setProfileMsg(e?.message || "Failed to save")
    }
    setSavingProfile(false)
  }

  const navGroups = [
    {
      label: "MAIN",
      items: [
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "notifications", icon: "🔔", label: "Notifications" },
        { id: "tripPlanner", icon: "🧭", label: "Trip Planner" },
        { id: "claims",    icon: "📋", label: "Expense Claims" },
        { id: "expenses",  icon: "🧾", label: "Available Expenses" },
      ]
    },
    ...(isFinance ? [{
      label: "MANAGEMENT",
      items: [
        { id: "approvals", icon: "✅", label: "Approvals" },
        { id: "finance",   icon: "📊", label: "Finance Dashboard" },
      ]
    }] : []),
    {
      label: "SETTINGS",
      items: [
        { id: "policy", icon: "📜", label: "Company Policy" },
      ]
    }
  ]

  return (
    <div style={{
      width: 232, background: "#111114", borderRight: `1px solid ${THEME.border}`,
      minHeight: "100vh", display: "flex", flexDirection: "column",
      fontFamily: "'Segoe UI', system-ui, sans-serif"
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${THEME.border}` }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "8px 0",
            borderRadius: 12,
            background: "linear-gradient(160deg, rgba(118,185,0,0.10) 0%, rgba(19,19,26,0.95) 55%, rgba(19,19,26,1) 100%)",
            border: `1px solid ${THEME.border}`,
            transition: "all 0.22s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)"
            e.currentTarget.style.boxShadow = "0 8px 18px rgba(118,185,0,0.14)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)"
            e.currentTarget.style.boxShadow = "none"
          }}
        >
          <img
            src={BRAND_LOGO}
            alt={`${BRAND_NAME} logo`}
            onError={(e) => { e.currentTarget.style.display = "none" }}
            style={{ width: 74, height: 74, objectFit: "contain" }}
          />
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: "0.04em",
              lineHeight: 1,
              marginBottom: 6,
              textTransform: "uppercase",
            }}>
              <span style={{ color: "#E5E7EB" }}>AUDI</span><span style={{ color: "#84CC16" }}>XA</span>
            </div>
            <div style={{ fontSize: 10, color: THEME.textMuted, letterSpacing: "0.03em" }}>Expense Management</div>
          </div>
        </div>
      </div>

      {/* User */}
      <div
        onClick={() => {
          setShowProfileEditor(v => !v)
          setProfileMsg("")
        }}
        style={{ padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: "50%", background: THEME.accentDim,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: THEME.accent
        }}>
          {(profile?.full_name || "U")[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.textPrimary }}>{profile?.full_name || "User"}</div>
          <div style={{ fontSize: 11, color: THEME.textMuted }}>{profile?.role === "finance" ? "Finance Team" : profile?.role === "manager" ? "Manager" : "Employee"}</div>
        </div>
      </div>

      {showProfileEditor && (
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
          <div style={{ fontSize: 11, color: THEME.textMuted, marginBottom: 8 }}>Update basic details</div>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Full name"
            style={{
              width: "100%", padding: "7px 9px", marginBottom: 7,
              border: `1px solid ${THEME.border}`, borderRadius: 6,
              background: THEME.surface, color: THEME.textPrimary, fontSize: 12,
              boxSizing: "border-box"
            }}
          />
          <input
            value={editCompany}
            onChange={(e) => setEditCompany(e.target.value)}
            placeholder="Company ID"
            style={{
              width: "100%", padding: "7px 9px", marginBottom: 8,
              border: `1px solid ${THEME.border}`, borderRadius: 6,
              background: THEME.surface, color: THEME.textPrimary, fontSize: 12,
              boxSizing: "border-box"
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={saveProfile} disabled={savingProfile} style={{ padding: "6px 10px", fontSize: 12, fontWeight: 700, borderRadius: 6, ...primaryBtnStyle(savingProfile) }}>
              {savingProfile ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setEditName(profile?.full_name || "")
                setEditCompany(profile?.company_id || "default")
                setShowProfileEditor(false)
                setProfileMsg("")
              }}
              style={{
                padding: "6px 10px", fontSize: 12, borderRadius: 6,
                border: `1px solid ${THEME.border}`, background: "transparent",
                color: THEME.textSecond, cursor: "pointer"
              }}
            >
              Cancel
            </button>
          </div>
          {!!profileMsg && <div style={{ marginTop: 6, fontSize: 11, color: profileMsg === "Saved" ? THEME.accent : "#ef4444" }}>{profileMsg}</div>}
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {navGroups.map(group => (
          <div key={group.label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: THEME.textMuted, letterSpacing: "0.08em", padding: "0 10px", marginBottom: 4 }}>
              {group.label}
            </div>
            {group.items.map(item => (
              <button key={item.id} onClick={() => setPage(item.id)} style={{
                width: "100%", padding: "8px 10px", border: "none", borderRadius: 6,
                background: page === item.id ? "rgba(118,185,0,0.12)" : "transparent",
                color: page === item.id ? "#76b900" : THEME.textSecond,
                textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: page === item.id ? 600 : 400,
                display: "flex", alignItems: "center", gap: 8, marginBottom: 1
              }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <button onClick={onLogout} style={{
        margin: "0 12px 16px", padding: "8px 12px", background: "transparent",
        border: `1px solid ${THEME.border}`, color: THEME.textSecond, borderRadius: 6,
        cursor: "pointer", fontSize: 13, textAlign: "left", display: "flex", alignItems: "center", gap: 8
      }}>
        <span>↩</span> Sign Out
      </button>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ profile, setPage, setCurrent }) {
  const [stats, setStats] = useState({ availableExpenses: 0, claims: 0, flaggedClaims: 0 })
  const [recentClaims, setRecentClaims] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const token = await getToken()
        const headers = { Authorization: `Bearer ${token}` }
        const [claimsReq, expensesReq] = await Promise.allSettled([
          axios.get(`${API}/claims/my?limit=20&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
          axios.get(`${API}/expenses/available?limit=50&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
        ])

        const claimsRes = claimsReq.status === "fulfilled" ? claimsReq.value : { data: { claims: [], paging: {} } }
        const expensesRes = expensesReq.status === "fulfilled" ? expensesReq.value : { data: { expenses: [], paging: {} } }

        const claims = claimsRes.data?.claims || []
        const claimsTotal = claimsRes.data?.paging?.total_count ?? claims.length
        const availableTotal = expensesRes.data?.paging?.total_count ?? (expensesRes.data?.expenses?.length || 0)

        setRecentClaims(claims.slice(0, 5))
        setStats({
          availableExpenses: availableTotal,
          claims: claimsTotal,
          flaggedClaims: claims.filter(c => normalizeStatus(c.status) === "Flagged").length,
        })
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const cards = [
    {
      label: "Available Expenses",
      value: stats.availableExpenses,
      icon: <FileText size={28} strokeWidth={1.5} color="#185FA5" />,
      color: "#2563eb",
      bg: "#eff6ff",
      page: "expenses",
      desc: "Unattached expense items"
    },
    {
      label: "Expense Claims",
      value: stats.claims,
      icon: <ClipboardList size={28} strokeWidth={1.5} color="#3B6D11" />,
      color: "#7c3aed",
      bg: "#f5f3ff",
      page: "claims",
      desc: "Your submitted claims"
    },
    {
      label: "Flagged Claims",
      value: stats.flaggedClaims,
      icon: <AlertTriangle size={28} strokeWidth={1.5} color="#854F0B" />,
      color: "#a16207",
      bg: "#fef9c3",
      page: "claims",
      desc: "Need policy review",
    },
  ]

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>
          {getISTGreeting()}, {profile?.full_name?.split(" ")[0] || "there"} 👋
        </h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>
          Here's an overview of your expense activity.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
        {cards.map(card => (
          <div key={card.label} onClick={() => setPage(card.page)}
            style={{
              background: THEME.surface, borderRadius: 12, padding: "20px 22px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.07)", cursor: "pointer",
              border: `1px solid ${THEME.border}`, transition: "all 0.22s ease",
              display: "flex", justifyContent: "space-between", alignItems: "flex-start"
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.07)"}
          >
            <div>
              <div style={{ fontSize: 13, color: THEME.textSecond, marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: card.color }}>{loading ? "—" : card.value}</div>
              <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 4 }}>{card.desc}</div>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: card.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {card.icon}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
        <button onClick={() => setPage("claims")} style={{ padding: "9px 18px", fontSize: 13, fontWeight: 700, ...primaryBtnStyle(false) }}>
          + Create Expense Claim
        </button>
        <button onClick={() => setPage("expenses")} style={{
          padding: "9px 18px", background: THEME.surface, color: THEME.textSecond,
          border: `1px solid ${THEME.border}`, borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.2s ease"
        }}>
          View Available Expenses
        </button>
      </div>

      <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.18)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>Recent Claims</div>
          <button onClick={() => setPage("claims")} style={{ fontSize: 12, color: THEME.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>View all →</button>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: THEME.textMuted, fontSize: 13 }}>Loading...</div>
        ) : recentClaims.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary, marginBottom: 4 }}>No expense claims yet</div>
            <div style={{ fontSize: 13, color: THEME.textMuted }}>Create your first expense claim to get started</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: THEME.surfaceAlt }}>
                {["Report Name", "Date", "Total Amount", "Status"].map(h => (
                  <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentClaims.map(c => (
                <tr key={c.id}
                  onClick={() => { setCurrent(c); setPage("claimDetail") }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = THEME.surface}
                  style={{ borderBottom: `1px solid ${THEME.border}`, cursor: "pointer" }}
                >
                  <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{getClaimDisplayName(c)}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13, color: THEME.textSecond }}>{formatClaimDate(c)}</td>
                  <td style={{ padding: "11px 16px", fontSize: 13 }}>{c.currency || "USD"} {parseFloat(c.total_amount || 0).toFixed(2)}</td>
                  <td style={{ padding: "11px 16px" }}><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Create Claim Modal ───────────────────────────────────────────────────────
function CreateClaimModal({ profile, onClose, onCreate }) {
  // "choose" | "manual" | "scan"
  const [step, setStep] = useState("choose")

  // --- manual form state ---
  const [form, setForm] = useState({
    report_name: "", entity: "", business_unit: "", department: "", cost_center: "", purpose: ""
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  // --- scan state ---
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [purpose, setPurpose] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [scanError, setScanError] = useState("")
  const [scanClaim, setScanClaim] = useState(null)
  const [creating, setCreating] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const validate = () => {
    const e = {}
    if (!form.report_name.trim()) e.report_name = "Report Name is required"
    if (!form.entity.trim()) e.entity = "Entity is required"
    return e
  }

  // Manual submit
  const handleManualSubmit = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setLoading(true)
    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append("report_name", form.report_name)
      fd.append("entity", form.entity)
      fd.append("employee_name", profile?.full_name || "")
      fd.append("company_id", profile?.company_id || "default")
      const res = await axios.post(`${API}/claims`, fd, { headers: { Authorization: `Bearer ${token}` } })
      onCreate(res.data.claim)
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  // Scan receipt file change
  const handleScanFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setScanResult(null)
    setScanError("")
    if ((f.type || "").includes("pdf")) setPreview(null)
    else setPreview(URL.createObjectURL(f))
  }

  // Run OCR + policy audit
  const handleScan = async () => {
    if (!file || !purpose.trim()) {
      setScanError("Please upload a receipt and enter business purpose.")
      return
    }
    setScanning(true)
    setScanError("")
    try {
      const token = await getToken()

      // Create claim first (once), so scanned expense is attached to a claim
      let claim = scanClaim
      if (!claim?.id) {
        const claimFd = new FormData()
        claimFd.append("report_name", `Receipt Claim - ${new Date().toISOString().split("T")[0]}`)
        claimFd.append("entity", profile?.company_id || "default")
        claimFd.append("employee_name", profile?.full_name || "")
        claimFd.append("company_id", profile?.company_id || "default")
        const claimRes = await axios.post(`${API}/claims`, claimFd, { headers: { Authorization: `Bearer ${token}` } })
        claim = claimRes.data?.claim
        setScanClaim(claim)
      }

      const fd = new FormData()
      fd.append("file", file)
      fd.append("business_purpose", purpose)
      fd.append("employee_name", profile?.full_name || "")
      fd.append("company_id", profile?.company_id || "default")
      fd.append("claim_id", claim?.id || "")
      const res = await axios.post(`${API}/extract-receipt`, fd, { headers: { Authorization: `Bearer ${token}` } })
      setScanResult(res.data.data)

      // Open the created claim so user can see it immediately in dashboard totals
      if (claim?.id) {
        onCreate(claim)
      }
    } catch (e) {
      setScanError(e.response?.data?.detail || e.message)
    }
    setScanning(false)
  }

  // Create claim from scan result
  const handleCreateFromScan = async () => {
    if (!scanResult) return
    if (scanClaim?.id) {
      onCreate(scanClaim)
      return
    }
    setCreating(true)
    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append("report_name", scanResult.merchant_name ? `${scanResult.merchant_name} – ${scanResult.date || "Receipt"}` : "Scanned Receipt Claim")
      fd.append("entity", profile?.company_id || "default")
      fd.append("employee_name", profile?.full_name || "")
      fd.append("company_id", profile?.company_id || "default")
      const res = await axios.post(`${API}/claims`, fd, { headers: { Authorization: `Bearer ${token}` } })
      onCreate(res.data.claim)
    } catch (err) { console.error(err) }
    setCreating(false)
  }

  // ── Choose screen ──────────────────────────────────────────────────────────
  if (step === "choose") {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Create Expense Claim</h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>How would you like to create your claim?</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Manual option */}
            <button
              onClick={() => setStep("manual")}
              style={{
                padding: "24px 20px", border: "2px solid #e5e7eb", borderRadius: 10,
                background: "white", cursor: "pointer", textAlign: "left",
                transition: "border-color 0.15s, box-shadow 0.15s"
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#1d4ed8"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(29,78,216,0.1)" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none" }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>✏️</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Manual Entry</div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                Fill in all expense details by hand. Best for structured records and itemised claims.
              </div>
            </button>

            {/* Scan option */}
            <button
              onClick={() => setStep("scan")}
              style={{
                padding: "24px 20px", border: "2px solid #e5e7eb", borderRadius: 10,
                background: "white", cursor: "pointer", textAlign: "left",
                transition: "border-color 0.15s, box-shadow 0.15s"
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#1d4ed8"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(29,78,216,0.1)" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none" }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>📷</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Scan Receipt</div>
              <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                Upload a receipt image or PDF. AI will extract details and run a policy audit automatically.
              </div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Manual screen ──────────────────────────────────────────────────────────
  if (step === "manual") {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: 580, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setStep("choose")} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                  ← Back
                </button>
              </div>
              <h2 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>Manual Entry</h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>Fill in the details below to create a new expense report</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24 }}>
            <Input
              label="Report Name" required
              value={form.report_name} onChange={e => set("report_name", e.target.value)}
              placeholder="e.g. Q1 Business Travel - New York"
              error={errors.report_name}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee ID</label>
                <input value={profile?.id?.slice(0,8) || "—"} disabled
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#9ca3af" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee Name</label>
                <input value={profile?.full_name || ""} disabled
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#9ca3af" }} />
              </div>
            </div>

            <Input
              label="Entity" required
              value={form.entity} onChange={e => set("entity", e.target.value)}
              placeholder="e.g. Acme Corporation US"
              error={errors.entity}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Input
                label="Business Unit"
                value={form.business_unit} onChange={e => set("business_unit", e.target.value)}
                placeholder="e.g. Sales"
              />
              <Input
                label="Department"
                value={form.department} onChange={e => set("department", e.target.value)}
                placeholder="e.g. Enterprise Sales"
              />
            </div>

            <Input
              label="Cost Center"
              value={form.cost_center} onChange={e => set("cost_center", e.target.value)}
              placeholder="e.g. CC-1042"
            />

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Business Purpose</label>
              <textarea
                value={form.purpose} onChange={e => set("purpose", e.target.value)}
                placeholder="Briefly describe the business purpose of this report..."
                rows={3}
                style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box", resize: "vertical", outline: "none" }}
              />
            </div>
          </div>

          <div style={{ padding: "16px 24px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "9px 20px", background: "white", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#374151", fontWeight: 500 }}>
              Cancel
            </button>
            <button onClick={handleManualSubmit} disabled={loading} style={{
              padding: "9px 20px", background: loading ? "#93c5fd" : "#1d4ed8",
              color: "white", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
            }}>
              {loading ? "Creating..." : "Create Claim"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Scan screen ────────────────────────────────────────────────────────────
  if (step === "scan") {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: 640, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <button onClick={() => { setStep("choose"); setScanResult(null); setScanError("") }} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13, padding: 0 }}>
                ← Back
              </button>
              <h2 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>Scan Receipt</h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>Upload a receipt — AI will extract details and run a policy audit</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee</label>
                <input value={profile?.full_name || ""} disabled style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#9ca3af" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Company</label>
                <input value={profile?.company_id || "default"} disabled style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#9ca3af" }} />
              </div>
            </div>

            {/* File upload */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Receipt Upload <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div
                onClick={() => document.getElementById("createClaimScanFile").click()}
                style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 20, textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
              >
                {preview ? (
                  <img src={preview} alt="receipt" style={{ maxHeight: 160, borderRadius: 8, maxWidth: "100%" }} />
                ) : file ? (
                  <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>📄 {file.name}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>Click to upload receipt (JPG / PNG / PDF)</div>
                )}
              </div>
              <input id="createClaimScanFile" type="file" accept="image/*,.pdf" onChange={handleScanFile} style={{ display: "none" }} />
            </div>

            {/* Business purpose */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Business Purpose <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                rows={3}
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. Client meeting lunch"
                style={{ width: "100%", padding: "9px 11px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box", fontSize: 13, resize: "vertical", outline: "none" }}
              />
            </div>

            <button onClick={handleScan} disabled={scanning} style={{
              width: "100%", padding: 11, border: "none", borderRadius: 8,
              background: scanning ? "#93c5fd" : "#1d4ed8", color: "white",
              fontSize: 14, fontWeight: 700, cursor: scanning ? "not-allowed" : "pointer", marginBottom: 4
            }}>
              {scanning ? "⏳ Processing with AI..." : "Submit & Run OCR + Policy Audit"}
            </button>

            {scanError && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13 }}>
                {scanError}
              </div>
            )}

            {/* Scan result */}
            {scanResult && (
              <div style={{ marginTop: 16, border: "1px solid #f3f4f6", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Audit Result</span>
                    <StatusBadge status={scanResult.status || "Flagged"} />
                  </div>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>Risk: <strong>{scanResult.risk_level || "Medium"}</strong></span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                  <div style={{ padding: 16, borderRight: "1px solid #f3f4f6" }}>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 8 }}>RECEIPT</div>
                    {preview ? (
                      <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                    ) : (
                      <div style={{ fontSize: 13, color: "#6b7280" }}>{file?.name}</div>
                    )}
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 8 }}>EXTRACTED DETAILS</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
                      <tbody>
                        {[
                          ["Merchant", scanResult.merchant_name || "—"],
                          ["Date", scanResult.date || "—"],
                          ["Amount", `${scanResult.currency || "USD"} ${scanResult.amount || "0"}`],
                          ["Category", scanResult.category || "—"],
                          ["Purpose", scanResult.business_purpose || purpose || "—"],
                        ].map(([k, v]) => (
                          <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "6px 0", fontSize: 11, color: "#6b7280", fontWeight: 600, width: 80 }}>{k}</td>
                            <td style={{ padding: "6px 0", fontSize: 12, color: "#111827" }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, marginBottom: 6 }}>
                      <div style={{ fontSize: 10, color: "#92400e", fontWeight: 700, marginBottom: 2 }}>AUDIT REASON</div>
                      <div style={{ fontSize: 12, color: "#78350f" }}>{scanResult.reason || "—"}</div>
                    </div>
                    <div style={{ padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6 }}>
                      <div style={{ fontSize: 10, color: "#1e3a8a", fontWeight: 700, marginBottom: 2 }}>POLICY APPLIED</div>
                      <div style={{ fontSize: 12, color: "#1e40af" }}>{scanResult.policy_snippet || "—"}</div>
                    </div>
                  </div>
                </div>

                <div style={{ padding: "14px 16px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={onClose} style={{ padding: "8px 18px", background: "white", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#374151" }}>
                    Cancel
                  </button>
                  <button onClick={handleCreateFromScan} disabled={creating} style={{
                    padding: "8px 18px", background: creating ? "#93c5fd" : "#1d4ed8",
                    color: "white", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: creating ? "not-allowed" : "pointer"
                  }}>
                    {creating ? "Creating..." : "Create Claim from Receipt →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return null
}

// ─── Claims List Page ─────────────────────────────────────────────────────────
function ClaimsPage({ profile, setPage, setCurrent }) {
  const [claims, setClaims] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateClaim, setShowCreateClaim] = useState(false)

  const load = async () => {
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [claimsRes, expensesRes] = await Promise.all([
        axios.get(`${API}/claims/my?limit=120&offset=0`, { headers }),
        axios.get(`${API}/expenses?limit=200&offset=0`, { headers }),
      ])
      setClaims(claimsRes.data.claims || [])
      setExpenses(expensesRes.data.expenses || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreateClaim = (newClaim) => {
    setClaims(prev => [newClaim, ...prev])
    setShowCreateClaim(false)
    setCurrent(newClaim)
    setPage("claimDetail")
  }

  const approvedClaimsCount = claims.filter(c => normalizeStatus(c.status) === "Approved").length
  const approvedExpensesUnclaimed = expenses.filter(e => e.status === "Approved" && !e.claim_id).length

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {showCreateClaim && (
        <CreateClaimModal
          profile={profile}
          onClose={() => setShowCreateClaim(false)}
          onCreate={handleCreateClaim}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Expense Claims</h1>
          <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>Manage and track all your expense reports</p>
        </div>
        <button onClick={() => setShowCreateClaim(true)} style={{
          padding: "9px 18px", fontSize: 13, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 6,
          ...primaryBtnStyle(false)
        }}>
          + Create Expense Claim
        </button>
      </div>

      {/* Status summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: claims.length, color: THEME.blue, accent: "rgba(77,166,255,0.2)" },
          { label: "Draft", value: claims.filter(c => c.status === "Draft").length, color: "#9ca3af", accent: "rgba(156,163,175,0.2)" },
          { label: "Flagged", value: claims.filter(c => normalizeStatus(c.status) === "Flagged").length, color: THEME.amber, accent: "rgba(245,158,11,0.24)" },
          { label: "Approved", value: claims.filter(c => normalizeStatus(c.status) === "Approved").length, color: THEME.accent, accent: "rgba(118,185,0,0.24)" },
        ].map(card => (
          <div key={card.label} style={{
            background: "linear-gradient(135deg, #15151d 0%, #101018 100%)",
            border: `1px solid ${THEME.border}`,
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 12, color: THEME.textSecond }}>{card.label}</div>
            <div style={{ marginTop: 8, width: 42, height: 3, borderRadius: 999, background: card.accent }} />
          </div>
        ))}
      </div>

      {approvedExpensesUnclaimed > 0 && (
        <div style={{
          marginBottom: 14,
          padding: "12px 14px",
          borderRadius: 10,
          background: "rgba(77,166,255,0.08)",
          border: `1px solid ${THEME.blue}`,
          color: "#b9dcff",
          fontSize: 12,
          lineHeight: 1.55,
        }}>
          You have {approvedExpensesUnclaimed} approved expense{approvedExpensesUnclaimed > 1 ? "s" : ""} not attached to a claim yet.
          Attach them to a claim and submit the claim to reflect approval in this dashboard.
        </div>
      )}

      <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.18)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>Loading claims...</div>
        ) : claims.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No expense claims</div>
            <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>Create your first expense claim to get started</div>
            <button onClick={() => setShowCreateClaim(true)} style={{
              padding: "9px 18px", fontSize: 13, fontWeight: 700,
              ...primaryBtnStyle(false)
            }}>+ Create Claim</button>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: THEME.surfaceAlt }}>
                {["Report Name", "Employee", "Entity", "Department", "Total", "Status", "AI Reason", "Date", ""].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id}
                  style={{ borderBottom: `1px solid ${THEME.border}`, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = THEME.surface}
                >
                  <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{c.report_name}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: THEME.textPrimary }}>{c.employee_name}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: THEME.textSecond }}>{c.entity}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13, color: THEME.textSecond }}>{c.department || "—"}</td>
                  <td style={{ padding: "11px 14px", fontSize: 13 }}>{c.currency || "USD"} {parseFloat(c.total_amount || 0).toFixed(2)}</td>
                  <td style={{ padding: "11px 14px" }}><StatusBadge status={c.status} /></td>
                  <td style={{ padding: "11px 14px", fontSize: 12, color: THEME.textSecond, maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.ai_summary || "No reason available"}>
                    {c.ai_summary || "No reason available"}
                  </td>
                  <td style={{ padding: "11px 14px", fontSize: 12, color: THEME.textMuted }}>{c.created_at?.split("T")[0]}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <button
                      onClick={() => { setCurrent(c); setPage("claimDetail") }}
                      style={{ padding: "5px 12px", background: THEME.blueDim, border: `1px solid ${THEME.border}`, color: THEME.blue, borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.2s ease" }}
                    >Open →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Simple Employee Receipt Submit Page ────────────────────────────────────
function SubmitExpensePage({ profile, setPage, setCurrent }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [purpose, setPurpose] = useState("")
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setError("")
    if ((f.type || "").includes("pdf")) {
      setPreview(null)
    } else {
      setPreview(URL.createObjectURL(f))
    }
  }

  const handleSubmit = async () => {
    if (!file || !purpose.trim()) {
      setError("Please upload a receipt and enter business purpose.")
      return
    }

    setLoading(true)
    setError("")
    try {
      const token = await getToken()

      // Create a claim first so scanned receipt is attached to a claim
      const claimForm = new FormData()
      claimForm.append("report_name", `Receipt Claim - ${new Date().toISOString().split("T")[0]}`)
      claimForm.append("entity", profile?.company_id || "Default Entity")
      claimForm.append("employee_name", profile?.full_name || "")
      claimForm.append("company_id", profile?.company_id || "default")
      const claimRes = await axios.post(`${API}/claims`, claimForm, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const createdClaim = claimRes.data?.claim

      const fd = new FormData()
      fd.append("file", file)
      fd.append("business_purpose", purpose)
      fd.append("employee_name", profile?.full_name || "")
      fd.append("company_id", profile?.company_id || "default")
      fd.append("claim_id", createdClaim?.id || "")

      const res = await axios.post(`${API}/extract-receipt`, fd, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setResult(res.data.data)

      if (createdClaim?.id) {
        setCurrent(createdClaim)
        setPage("claimDetail")
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>Create Expense Claim</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>Upload receipt, enter business purpose, then AI will extract details and audit against uploaded policy.</p>
        </div>
        <button onClick={() => setPage("claims")} style={{ padding: "8px 14px", background: "white", border: "1px solid #d1d5db", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
          ← Back to Claims
        </button>
      </div>

      <div style={{ background: "white", borderRadius: 12, border: "1px solid #f3f4f6", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 20, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <Input label="Employee" value={profile?.full_name || ""} disabled />
          <Input label="Company" value={profile?.company_id || "default"} disabled />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Receipt Upload <span style={{ color: "#ef4444" }}>*</span></label>
          <div onClick={() => document.getElementById("submitReceiptFile").click()}
            style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 20, textAlign: "center", cursor: "pointer", background: "#f9fafb" }}>
            {preview ? (
              <img src={preview} alt="receipt" style={{ maxHeight: 180, borderRadius: 8, maxWidth: "100%" }} />
            ) : file ? (
              <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>📄 {file.name}</div>
            ) : (
              <div style={{ fontSize: 13, color: "#6b7280" }}>Click to upload receipt (JPG/PNG/PDF)</div>
            )}
          </div>
          <input id="submitReceiptFile" type="file" accept="image/*,.pdf" onChange={handleFile} style={{ display: "none" }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Business Purpose <span style={{ color: "#ef4444" }}>*</span></label>
          <textarea
            rows={3}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="e.g. Client meeting lunch"
            style={{ width: "100%", padding: "9px 11px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box", fontSize: 13, resize: "vertical" }}
          />
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: 11, border: "none", borderRadius: 8, background: loading ? "#93c5fd" : "#1d4ed8", color: "white", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "⏳ Processing with AI..." : "Submit & Run OCR + Policy Audit"}
        </button>

        {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13 }}>{error}</div>}
      </div>

      {result && (
        <div style={{ background: "white", borderRadius: 12, border: "1px solid #f3f4f6", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>Audit Result</div>
              <StatusBadge status={result.status || "Flagged"} />
            </div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Risk: <strong>{result.risk_level || "Medium"}</strong></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: 18, borderRight: "1px solid #f3f4f6" }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 8 }}>RECEIPT</div>
              {preview ? (
                <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />
              ) : (
                <div style={{ fontSize: 13, color: "#6b7280" }}>{file?.name || "Uploaded file"}</div>
              )}
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 700, marginBottom: 8 }}>OCR EXTRACTED DETAILS</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                <tbody>
                  {[
                    ["Merchant", result.merchant_name || "—"],
                    ["Date", result.date || "—"],
                    ["Amount", `${result.currency || "USD"} ${result.amount || "0"}`],
                    ["Category", result.category || "—"],
                    ["Purpose", result.business_purpose || purpose || "—"],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "7px 0", fontSize: 12, color: "#6b7280", fontWeight: 600, width: 90 }}>{k}</td>
                      <td style={{ padding: "7px 0", fontSize: 13, color: "#111827" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, marginBottom: 4 }}>AUDIT REASON</div>
                <div style={{ fontSize: 13, color: "#78350f" }}>{result.reason || "—"}</div>
              </div>
              <div style={{ padding: "10px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "#1e3a8a", fontWeight: 700, marginBottom: 4 }}>POLICY APPLIED</div>
                <div style={{ fontSize: 13, color: "#1e40af" }}>{result.policy_snippet || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add Expense Modal ────────────────────────────────────────────────────────
function AddExpenseModal({ claimId, profile, onClose, onAdd }) {
  const [tab, setTab] = useState("manual") // "manual" | "scan"
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [form, setForm] = useState({
    expense_type: "", gl_code: "", transaction_date: "", vendor_name: "",
    amount: "", currency: "USD", city: "", payment_type: "Corporate Card",
    business_purpose: "", invoice_number: ""
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const fileRef = useRef()

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleFileChange = async (e) => {
    const f = e.target.files[0]
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const scanReceipt = async () => {
    if (!file) return
    setScanning(true)
    try {
      const token = await getToken()
      const fd = new FormData()
      fd.append("file", file)
      fd.append("company_id", profile?.company_id || "default")
      const res = await axios.post(`${API}/extract-receipt`, fd, { headers: { Authorization: `Bearer ${token}` } })
      const d = res.data.data || {}
      setForm(p => ({
        ...p,
        vendor_name: d.merchant_name || p.vendor_name,
        amount: d.amount || p.amount,
        currency: d.currency || p.currency,
        transaction_date: d.date || p.transaction_date,
        expense_type: d.category || p.expense_type,
        business_purpose: d.business_purpose || p.business_purpose,
      }))
    } catch (e) { console.error(e) }
    setScanning(false)
  }

  const validate = () => {
    const e = {}
    if (!form.expense_type.trim()) e.expense_type = "Required"
    if (!form.transaction_date) e.transaction_date = "Required"
    if (!form.vendor_name.trim()) e.vendor_name = "Required"
    if (!form.amount) e.amount = "Required"
    if (!form.business_purpose.trim()) e.business_purpose = "Required"
    return e
  }

  const handleSubmit = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setLoading(true)
    try {
      const token = await getToken()
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append("employee_name", profile?.full_name || "")
      fd.append("company_id", profile?.company_id || "default")
      fd.append("claim_id", claimId || "")
      if (file) fd.append("receipt", file)
      const res = await axios.post(`${API}/expenses`, fd, { headers: { Authorization: `Bearer ${token}` } })
      onAdd(res.data.expense)
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.58)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: THEME.surface, borderRadius: 12, width: 700, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", border: `1px solid ${THEME.border}` }}>
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: THEME.textPrimary }}>Add Expense</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: THEME.textMuted }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${THEME.border}` }}>
          {[["scan", "📷 Scan Receipt"], ["manual", "✏️ Manual Entry"]].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "10px 20px", border: "none", background: "none",
              borderBottom: tab === t ? `2px solid ${THEME.blue}` : "2px solid transparent",
              color: tab === t ? THEME.blue : THEME.textSecond,
              fontWeight: tab === t ? 600 : 400, fontSize: 13, cursor: "pointer"
            }}>{l}</button>
          ))}
        </div>

        <div style={{ padding: 24 }}>
          {tab === "scan" && (
            <div style={{ marginBottom: 20 }}>
              <div
                onClick={() => fileRef.current.click()}
                style={{
                  border: `2px dashed ${THEME.border}`, borderRadius: 8, padding: 32,
                  textAlign: "center", cursor: "pointer", background: THEME.surfaceAlt, marginBottom: 12
                }}
              >
                {preview ? (
                  <img src={preview} alt="receipt" style={{ maxHeight: 200, borderRadius: 8, maxWidth: "100%" }} />
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
                    <div style={{ fontSize: 13, color: THEME.textSecond }}>Click to upload receipt</div>
                    <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 4 }}>JPG, PNG, PDF supported</div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleFileChange} style={{ display: "none" }} />
              {file && (
                <button onClick={scanReceipt} disabled={scanning} style={{
                  width: "100%", padding: 10, ...primaryBtnStyle(scanning),
                  borderRadius: 6, fontSize: 13, fontWeight: 600
                }}>
                  {scanning ? "⏳ Scanning with AI..." : "🤖 Scan & Auto-fill"}
                </button>
              )}
            </div>
          )}

          {/* Form fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
            <Select label="Expense Type" required value={form.expense_type} onChange={e => set("expense_type", e.target.value)} error={errors.expense_type}>
              <option value="">Select type...</option>
              {["Airfare", "Hotel", "Meals & Entertainment", "Ground Transportation", "Car Rental", "Fuel", "Parking", "Conference/Training", "Office Supplies", "Other"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
            <Input label="GL Code" value={form.gl_code} onChange={e => set("gl_code", e.target.value)} placeholder="e.g. 6210" />
            <Input label="Transaction Date" required type="date" value={form.transaction_date} onChange={e => set("transaction_date", e.target.value)} error={errors.transaction_date} />
            <Input label="Vendor Name" required value={form.vendor_name} onChange={e => set("vendor_name", e.target.value)} placeholder="e.g. Marriott Hotel" error={errors.vendor_name} />
            <Input label="Amount" required type="number" step="0.01" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="0.00" error={errors.amount} />
            <Select label="Currency" value={form.currency} onChange={e => set("currency", e.target.value)}>
              {["USD", "EUR", "GBP", "INR", "AED", "SGD", "CAD", "AUD"].map(c => <option key={c}>{c}</option>)}
            </Select>
            <Input label="City of Purchase" value={form.city} onChange={e => set("city", e.target.value)} placeholder="e.g. New York" />
            <Select label="Payment Type" value={form.payment_type} onChange={e => set("payment_type", e.target.value)}>
              {["Corporate Card", "Personal Card", "Cash", "Bank Transfer"].map(t => <option key={t}>{t}</option>)}
            </Select>
          </div>

          <Input label="Invoice Number" value={form.invoice_number} onChange={e => set("invoice_number", e.target.value)} placeholder="e.g. INV-2024-0042" />

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 5 }}>
              Business Purpose <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              value={form.business_purpose} onChange={e => set("business_purpose", e.target.value)}
              placeholder="Describe the business purpose of this expense..."
              rows={3}
              style={{
                width: "100%", padding: "8px 11px", fontSize: 13,
                border: `1px solid ${errors.business_purpose ? "#ef4444" : THEME.border}`,
                background: errors.business_purpose ? "#2a1010" : THEME.surface,
                color: THEME.textPrimary,
                borderRadius: 6, boxSizing: "border-box", resize: "vertical", outline: "none"
              }}
            />
            {errors.business_purpose && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 3 }}>{errors.business_purpose}</div>}
          </div>
        </div>

        <div style={{ padding: "16px 24px", borderTop: `1px solid ${THEME.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", background: "transparent", border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 13, cursor: "pointer", color: THEME.textSecond }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{
            padding: "9px 20px", ...primaryBtnStyle(loading), borderRadius: 6, fontSize: 13, fontWeight: 600
          }}>
            {loading ? "Saving..." : "Save Expense"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Claim Detail Page ────────────────────────────────────────────────────────
function ClaimDetail({ claim, setPage, profile }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [addExpenseMode, setAddExpenseMode] = useState("manual")
  const [showDropdown, setShowDropdown] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentClaim, setCurrentClaim] = useState(claim)

  const loadExpenses = async () => {
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/expenses?claim_id=${claim.id}`, { headers: { Authorization: `Bearer ${token}` } })
      setExpenses(r.data.expenses || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadExpenses() }, [claim.id])

  const total = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== "")
  const normalizedExpenses = expenses.map(exp => {
    const normalizedStatus = normalizeStatus(exp.status)
    const receiptPath = pick(exp.receipt_url, exp.image_url)
    const receiptUrl = receiptPath
      ? (String(receiptPath).startsWith("http") ? receiptPath : `${API}${receiptPath}`)
      : ""

    return {
      ...exp,
      normalizedStatus,
      displayType: pick(exp.expense_type, exp.category, "Other"),
      displayDate: pick(exp.transaction_date, exp.date, exp.created_at?.split("T")?.[0], "—"),
      displayVendor: pick(exp.vendor_name, exp.merchant_name, "—"),
      displayCity: pick(exp.city, "—"),
      displayPayment: pick(exp.payment_type, "—"),
      displayPurpose: pick(exp.business_purpose, currentClaim.purpose, "—"),
      displayAmount: parseFloat(exp.amount || 0).toFixed(2),
      auditReason: pick(exp.reason, normalizedStatus === "Approved" ? "Approved by AI auditor after checking the policy rules." : "Potential policy mismatch detected. Please review this item."),
      policyNote: pick(exp.policy_snippet, normalizedStatus === "Approved" ? "No policy conflict detected." : "This item may not comply with one or more policy rules."),
      receiptUrl,
    }
  })
  const nonCompliant = normalizedExpenses.filter(e => ["Flagged", "Rejected"].includes(e.normalizedStatus))
  const derivedClaimStatus = (() => {
    if (!normalizedExpenses.length) return normalizeStatus(currentClaim.status)
    const statuses = normalizedExpenses.map(e => e.normalizedStatus)
    if (statuses.some(s => s === "Rejected")) return "Rejected"
    if (statuses.some(s => s === "Flagged")) return "Flagged"
    if (statuses.every(s => s === "Approved")) return "Approved"
    return normalizeStatus(currentClaim.status)
  })()

  const handleAddExpense = (exp) => {
    setExpenses(p => [...p, exp])
    setShowAddExpense(false)
  }

  const handleSubmitClaim = async () => {
    setSubmitting(true)
    try {
      const token = await getToken()
      const res = await axios.post(`${API}/claims/${claim.id}/submit`, {}, { headers: { Authorization: `Bearer ${token}` } })
      setCurrentClaim(res.data.claim)
    } catch (e) { console.error(e) }
    setSubmitting(false)
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {showAddExpense && (
        <AddExpenseModal
          claimId={claim.id}
          profile={profile}
          onClose={() => setShowAddExpense(false)}
          onAdd={handleAddExpense}
        />
      )}

      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, fontSize: 13, color: THEME.textSecond }}>
        <button onClick={() => setPage("claims")} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.blue, fontSize: 13, padding: 0 }}>
          Expense Claims
        </button>
        <span>›</span>
        <span style={{ color: THEME.textPrimary, fontWeight: 500 }}>{getClaimDisplayName(currentClaim)}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>{getClaimDisplayName(currentClaim)}</h1>
            <StatusBadge status={derivedClaimStatus} />
          </div>
          <div style={{ fontSize: 13, color: THEME.textSecond }}>
            {currentClaim.entity} {currentClaim.department ? `· ${currentClaim.department}` : ""}
            {currentClaim.cost_center ? ` · ${currentClaim.cost_center}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Add Expense dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowDropdown(p => !p)}
              style={{ padding: "9px 16px", background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 8, fontSize: 13, cursor: "pointer", color: THEME.textPrimary, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s ease" }}
            >
              + Add Expense ▾
            </button>
            {showDropdown && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", right: 0, background: THEME.surface,
                border: `1px solid ${THEME.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                width: 200, zIndex: 100, overflow: "hidden"
              }}>
                {[
                  ["📷", "Scan Receipt", "scan"],
                  ["✏️", "Manual Entry", "manual"],
                  ["📋", "Available Expenses", "available"]
                ].map(([icon, label, mode]) => (
                  <button key={mode} onClick={() => { setAddExpenseMode(mode); setShowAddExpense(true); setShowDropdown(false) }}
                    style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${THEME.border}`, color: THEME.textPrimary }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    <span>{icon}</span>{label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {currentClaim.status === "Draft" && (
            <button onClick={handleSubmitClaim} disabled={submitting || expenses.length === 0}
              style={{
                padding: "9px 18px",
                ...primaryBtnStyle(submitting || expenses.length === 0),
                color: expenses.length === 0 ? THEME.textMuted : "#000",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: expenses.length === 0 ? "not-allowed" : "pointer"
              }}
            >
              {submitting ? "Submitting..." : "Submit Claim"}
            </button>
          )}
        </div>
      </div>

      {/* Summary boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Amount", value: `${currentClaim.currency || "USD"} ${total.toFixed(2)}`, icon: "💰" },
          { label: "Expenses", value: `${expenses.length} item${expenses.length !== 1 ? "s" : ""}`, icon: "🧾" },
          { label: "Submitted", value: currentClaim.created_at?.split("T")[0] || "—", icon: "📅" },
        ].map(s => (
          <div key={s.label} style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 10, padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 11, color: THEME.textMuted }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: THEME.textPrimary }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Audit Summary */}
      <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 10, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: THEME.textPrimary }}>AI Compliance Summary</div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {nonCompliant.length === 0 ? (
            <div style={{ fontSize: 13, color: "#065f46", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "10px 12px", borderRadius: 8 }}>
              ✅ All expense items in this claim comply with your uploaded company policy.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {nonCompliant.map(exp => (
                <div key={`issue-${exp.id}`} style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#78350f" }}>{exp.displayType} • {exp.displayVendor}</div>
                    <StatusBadge status={exp.normalizedStatus} />
                  </div>
                  <div style={{ fontSize: 12, color: "#78350f", marginBottom: 4 }}><strong>Why:</strong> {exp.auditReason}</div>
                  <div style={{ fontSize: 12, color: "#92400e" }}><strong>Policy:</strong> {exp.policyNote}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expenses table */}
      <div style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>Expense Items</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.blue }}>{currentClaim.currency || "USD"} {total.toFixed(2)} total</div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9ca3af" }}>Loading expenses...</div>
        ) : normalizedExpenses.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🧾</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary, marginBottom: 4 }}>No expenses added yet</div>
            <div style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 20 }}>Add expenses to this claim using the button above</div>
            <button onClick={() => setShowAddExpense(true)} style={{
              padding: "9px 18px", fontSize: 13, fontWeight: 700,
              ...primaryBtnStyle(false)
            }}>+ Add Expense</button>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: THEME.surfaceAlt }}>
                {["Type", "Date", "Vendor", "City", "Payment", "Purpose", "Amount", "Audit", "Receipt"].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedExpenses.map(exp => ([
                <tr key={exp.id} style={{ borderBottom: `1px solid ${THEME.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{exp.displayType}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textSecond }}>{exp.displayDate}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textPrimary }}>{exp.displayVendor}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textSecond }}>{exp.displayCity}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: THEME.textSecond }}>{exp.displayPayment}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: THEME.textSecond, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.displayPurpose}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{exp.currency || currentClaim.currency || "USD"} {exp.displayAmount}</td>
                  <td style={{ padding: "10px 14px" }}><StatusBadge status={exp.normalizedStatus} /></td>
                  <td style={{ padding: "10px 14px" }}>
                    {exp.receiptUrl ? (
                      <a href={exp.receiptUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: THEME.blue, textDecoration: "none" }}>View 📎</a>
                    ) : <span style={{ fontSize: 11, color: THEME.textMuted }}>None</span>}
                  </td>
                </tr>,
                <tr key={`audit-${exp.id}`} style={{ background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${THEME.border}` }}>
                  <td colSpan={9} style={{ padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, color: THEME.textPrimary, marginBottom: 3 }}><strong>Why {exp.normalizedStatus === "Approved" ? "approved" : "flagged"}:</strong> {exp.auditReason}</div>
                    <div style={{ fontSize: 12, color: THEME.textSecond }}><strong>Policy check:</strong> {exp.policyNote}</div>
                  </td>
                </tr>
              ]))}
            </tbody>
          </table>
        )}
      </div>

      {/* Purpose / Notes */}
      {currentClaim.purpose && (
        <div style={{ marginTop: 16, background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 10, padding: "14px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: THEME.textMuted, marginBottom: 4 }}>BUSINESS PURPOSE</div>
          <div style={{ fontSize: 13, color: THEME.textSecond }}>{currentClaim.purpose}</div>
        </div>
      )}
    </div>
  )
}

// ─── Pre-Trip Planner Page ───────────────────────────────────────────────────
function TripPlannerPage({ profile }) {
  const [step, setStep] = useState(1)
  const [destination, setDestination] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [purpose, setPurpose] = useState("")
  const [activityName, setActivityName] = useState("")
  const [activityCost, setActivityCost] = useState("")
  const [activityPremium, setActivityPremium] = useState(false)
  const [activityJustification, setActivityJustification] = useState("")
  const [activities, setActivities] = useState([])
  const [plans, setPlans] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [tripWarning, setTripWarning] = useState("")

  const companyId = profile?.company_id || "default"

  const loadPlans = async () => {
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/trip-plans/my`, { headers: { Authorization: `Bearer ${token}` } })
      setPlans(r.data.plans || [])
    } catch (e) {
      setPlans([])
    }
  }

  useEffect(() => { loadPlans() }, [])

  const addActivity = () => {
    const name = activityName.trim()
    if (!name) return
    const next = {
      id: `${Date.now()}-${Math.random()}`,
      name,
      estimated_cost: activityCost ? Number(activityCost) : null,
      is_premium: activityPremium,
      justification: (activityJustification || "").trim(),
    }
    if (next.is_premium && !next.justification) {
      setError("Please add a justification for premium/last-minute activity")
      return
    }
    setActivities(prev => [...prev, next])
    setActivityName("")
    setActivityCost("")
    setActivityPremium(false)
    setActivityJustification("")
    setError("")
  }

  const removeActivity = (id) => {
    setActivities(prev => prev.filter(a => a.id !== id))
  }

  const goNext = () => {
    setError("")
    if (step === 1) {
      if (!destination.trim() || !startDate || !endDate) {
        setError("Please enter destination and travel dates")
        return
      }
    }
    if (step === 2) {
      if (!purpose.trim()) {
        setError("Please add business purpose")
        return
      }
      const invalid = activities.some(a => a.is_premium && !a.justification)
      if (invalid) {
        setError("Add justification for all premium/last-minute activities")
        return
      }
    }
    setStep(s => Math.min(3, s + 1))
  }

  const generatePlan = async () => {
    setLoading(true)
    setError("")
    setTripWarning("")
    try {
      const token = await getToken()
      const expensiveChoices = activities
        .filter(a => a.is_premium)
        .map(a => ({
          activity: a.name,
          estimated_cost: a.estimated_cost,
          reason: a.justification,
        }))

      const payload = {
        destination,
        start_date: startDate,
        end_date: endDate,
        business_purpose: purpose,
        activities: activities.map(a => ({
          activity: a.name,
          estimated_cost: a.estimated_cost,
          is_premium: a.is_premium,
          justification: a.justification,
        })),
        expensive_choices: expensiveChoices,
        company_id: companyId,
      }

      const r = await axios.post(`${API}/trip-plans/generate`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 45000,
      })

      setResult(r.data.plan || null)
      if (r?.data?.warning) {
        setTripWarning(r.data.warning)
      }
      await loadPlans()
      setStep(3)
    } catch (e) {
      if (e?.code === "ECONNABORTED") {
        setError("Generation timed out. Please try again in a few seconds.")
      } else {
        setError(e?.response?.data?.detail || e.message || "Failed to generate trip plan")
      }
    }
    setLoading(false)
  }

  const score = Math.max(0, Math.min(100, Number(result?.compliance_score || 0)))

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Compliance-Aware Itinerary Architect</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>
          Build a pre-trip plan that is policy-compliant before you spend.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[
          { id: 1, label: "Trip Basics", icon: MapPin },
          { id: 2, label: "Purpose & Activities", icon: Briefcase },
          { id: 3, label: "Compliance Plan", icon: WandSparkles },
        ].map(s => (
          <div key={s.id} style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: `1px solid ${step === s.id ? THEME.accent : THEME.border}`,
            color: step === s.id ? THEME.accent : THEME.textSecond,
            background: step === s.id ? "rgba(118,185,0,0.1)" : THEME.surface,
            fontSize: 12,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
            <s.icon size={14} /> {s.label}
          </div>
        ))}
      </div>

      <div style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 12, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", padding: 18, marginBottom: 16 }}>
        {step === 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. New York" style={{ borderRadius: 8 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ borderRadius: 8 }} />
              <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ borderRadius: 8 }} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 6 }}>Business Purpose</label>
              <textarea
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Meeting a client in New York for 3 days for a product demo"
                style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, padding: 10, fontSize: 13, resize: "vertical" }}
              />
            </div>

            <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12, background: THEME.surfaceAlt }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 10 }}>Expected Activities</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, marginBottom: 8 }}>
                <input value={activityName} onChange={(e) => setActivityName(e.target.value)} placeholder="Dinner with client / Uber to HQ / Hotel near venue"
                  style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, fontSize: 12 }} />
                <input type="number" min="0" value={activityCost} onChange={(e) => setActivityCost(e.target.value)} placeholder="Est. cost"
                  style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, fontSize: 12 }} />
                <button onClick={addActivity} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(false) }}>+ Add</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input id="premiumChoice" type="checkbox" checked={activityPremium} onChange={(e) => setActivityPremium(e.target.checked)} />
                <label htmlFor="premiumChoice" style={{ fontSize: 12, color: THEME.textSecond }}>Premium or last-minute option</label>
              </div>

              {activityPremium && (
                <textarea
                  rows={2}
                  value={activityJustification}
                  onChange={(e) => setActivityJustification(e.target.value)}
                  placeholder="Why is this higher-cost option needed? (This gets attached to the audit)"
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, padding: 10, fontSize: 12, marginBottom: 8 }}
                />
              )}

              {activities.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {activities.map(a => (
                    <div key={a.id} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.textPrimary }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: THEME.textSecond }}>
                          {a.estimated_cost ? `Estimated ${a.estimated_cost}` : "No estimate"}
                          {a.is_premium ? " • Premium/last-minute" : ""}
                        </div>
                        {!!a.justification && <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 3 }}>{a.justification}</div>}
                      </div>
                      <button onClick={() => removeActivity(a.id)} style={{ border: `1px solid ${THEME.border}`, background: "transparent", color: THEME.textSecond, borderRadius: 6, fontSize: 11, padding: "4px 8px", cursor: "pointer", height: 28 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {!result ? (
              <div style={{ color: THEME.textSecond, fontSize: 13 }}>Generate your policy-linked itinerary plan.</div>
            ) : (
              <div>
                <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "rgba(118,185,0,0.08)", border: `1px solid ${THEME.border}` }}>
                  <div style={{ fontSize: 12, color: THEME.textSecond, marginBottom: 6 }}>Likelihood of Approval</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: THEME.surfaceAlt, border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
                      <div style={{ width: `${score}%`, height: "100%", background: "linear-gradient(90deg, #f59e0b 0%, #76b900 100%)" }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: THEME.accent }}>{score}%</div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Plane size={14} /> Transport Suggestions</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: THEME.textSecond, fontSize: 12, lineHeight: 1.7 }}>
                      {(result.transport_suggestions || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><BedDouble size={14} /> Lodging Caps</div>
                      <div style={{ fontSize: 12, color: THEME.textSecond, lineHeight: 1.7 }}>
                        {(result.lodging_caps?.summary) || "No lodging guidance available"}
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><UtensilsCrossed size={14} /> Food / Per Diem</div>
                      <div style={{ fontSize: 12, color: THEME.textSecond, lineHeight: 1.7 }}>
                        {(result.food_per_diem?.summary) || "No meal guidance available"}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><ShieldAlert size={14} /> Compliance Risk Summary</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: THEME.textSecond, fontSize: 12, lineHeight: 1.7 }}>
                      {(result.compliance_risk_summary || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>

                  {!!(result.contextual_justification_prompts || []).length && (
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: "rgba(245,158,11,0.08)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.amber, marginBottom: 6 }}>Justification Prompts</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#fcd34d", fontSize: 12, lineHeight: 1.7 }}>
                        {(result.contextual_justification_prompts || []).map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!!error && <div style={{ marginTop: 12, fontSize: 12, color: "#ef4444" }}>{error}</div>}
        {!!tripWarning && <div style={{ marginTop: 8, fontSize: 12, color: THEME.amber }}>{tripWarning}</div>}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1 || loading}
            style={{
              padding: "8px 12px", fontSize: 12, borderRadius: 8,
              border: `1px solid ${THEME.border}`, background: "transparent", color: THEME.textSecond,
              cursor: step === 1 ? "not-allowed" : "pointer", opacity: step === 1 ? 0.45 : 1
            }}
          >
            Back
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {step < 3 && (
              <button onClick={goNext} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(false) }}>
                Next
              </button>
            )}
            <button onClick={generatePlan} disabled={loading} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(loading) }}>
              {loading ? "Generating..." : "Generate Compliance Plan"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 12, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${THEME.border}`, fontSize: 13, fontWeight: 700, color: THEME.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={14} /> Saved Pre-Trip Plans
        </div>
        {plans.length === 0 ? (
          <div style={{ padding: 18, color: THEME.textMuted, fontSize: 12 }}>No saved plans yet.</div>
        ) : (
          <div style={{ padding: 10, display: "grid", gap: 8 }}>
            {plans.slice(0, 8).map(p => (
              <div key={p.id} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary }}>{p.destination || "Destination"}</div>
                  <div style={{ fontSize: 11, color: THEME.accent }}>Score {Number(p.compliance_score || 0)}%</div>
                </div>
                <div style={{ fontSize: 11, color: THEME.textSecond }}>
                  {(p.start_date || "—")} to {(p.end_date || "—")} • {(p.created_at || "").split("T")[0] || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Available Expenses Page ───────────────────────────────────────────────────
function AvailableExpensesPage() {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const token = await getToken()
        const r = await axios.get(`${API}/expenses/available`, { headers: { Authorization: `Bearer ${token}` } })
        setExpenses(r.data.expenses || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Available Expenses</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>Expenses not yet attached to a claim</p>
      </div>

      <div style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: THEME.textMuted }}>Loading...</div>
        ) : expenses.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary, marginBottom: 4 }}>No available expenses</div>
            <div style={{ fontSize: 13, color: THEME.textMuted }}>All your expenses are attached to claims</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: THEME.surfaceAlt }}>
                {["Type", "Date", "Vendor", "Amount", "Payment", "Purpose"].map(h => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map(exp => {
                const displayType = exp.expense_type || exp.type || exp.category || "Uncategorized"
                const displayVendor = exp.vendor_name || exp.merchant_name || exp.vendor || "Unknown vendor"
                const displayDate = exp.transaction_date || exp.date || "—"
                const displayPayment = exp.payment_type || "—"
                const displayPurpose = exp.business_purpose || "—"
                const displayCurrency = exp.currency || "USD"
                const displayAmount = Number.isFinite(Number(exp.amount)) ? Number(exp.amount).toFixed(2) : "0.00"

                return (
                  <tr key={exp.id} style={{ borderBottom: `1px solid ${THEME.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{displayType}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textSecond }}>{displayDate}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textPrimary }}>{displayVendor}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: THEME.textPrimary }}>{displayCurrency} {displayAmount}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: THEME.textSecond }}>{displayPayment}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textSecond, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayPurpose}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Notifications Page ───────────────────────────────────────────────────────
function NotificationsPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedIds, setUpdatedIds] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const previousMapRef = useRef({ claims: {}, expenses: {} })
  const hasLoadedRef = useRef(false)

  const statusCopy = {
    Approved: "approved",
    Flagged: "flagged",
    Rejected: "rejected",
    Draft: "saved as draft",
  }

  const toDisplayTime = (value) => {
    if (!value) return "—"
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString()
  }

  const createFeed = (claims = [], expenses = []) => {
    const claimEvents = claims
      .map((c) => {
        const status = normalizeStatus(c.status)
        const ts = c.overridden_at || c.submitted_at || c.updated_at || c.created_at
        return {
          id: `claim-${c.id}`,
          kind: "claim",
          status,
          title: `Claim ${statusCopy[status] || "updated"}`,
          subtitle: getClaimDisplayName(c),
          reason: c.ai_summary || c.comment || "",
          ts,
          sortableTs: new Date(ts || 0).getTime() || 0,
        }
      })
      .filter((e) => !!e.ts)

    const expenseEvents = expenses
      .map((e) => {
        const status = normalizeStatus(e.status)
        const vendor = e.vendor_name || e.merchant_name || e.vendor || "Receipt"
        const amount = Number.isFinite(Number(e.amount)) ? Number(e.amount).toFixed(2) : null
        const currency = e.currency || "USD"
        const ts = e.overridden_at || e.updated_at || e.created_at || e.transaction_date
        return {
          id: `expense-${e.id}`,
          kind: "receipt",
          status,
          title: `Receipt ${statusCopy[status] || "updated"}`,
          subtitle: amount ? `${vendor} • ${currency} ${amount}` : vendor,
          reason: e.reason || e.audit_reason || "",
          ts,
          sortableTs: new Date(ts || 0).getTime() || 0,
        }
      })
      .filter((e) => !!e.ts)

    return [...expenseEvents, ...claimEvents]
      .filter((e) => !(e.kind === "receipt" && e.status === "Draft"))
      .sort((a, b) => b.sortableTs - a.sortableTs)
      .slice(0, 60)
  }

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    setRefreshing(true)
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [claimsReq, expensesReq] = await Promise.allSettled([
        axios.get(`${API}/claims/my?limit=120&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
        axios.get(`${API}/expenses?limit=200&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
      ])

      const claimsRes = claimsReq.status === "fulfilled" ? claimsReq.value : { data: { claims: [] } }
      const expensesRes = expensesReq.status === "fulfilled" ? expensesReq.value : { data: { expenses: [] } }

      const claims = claimsRes.data.claims || []
      const expenses = expensesRes.data.expenses || []

      const nextClaimsMap = {}
      claims.forEach(c => { nextClaimsMap[String(c.id)] = normalizeStatus(c.status) })

      const nextExpensesMap = {}
      expenses.forEach(e => { nextExpensesMap[String(e.id)] = normalizeStatus(e.status) })

      const changed = []
      if (hasLoadedRef.current) {
        Object.entries(nextClaimsMap).forEach(([id, status]) => {
          const prev = previousMapRef.current.claims[id]
          if (prev && prev !== status) changed.push(`claim-${id}`)
        })
        Object.entries(nextExpensesMap).forEach(([id, status]) => {
          const prev = previousMapRef.current.expenses[id]
          if (prev && prev !== status) changed.push(`expense-${id}`)
        })
      }

      previousMapRef.current = { claims: nextClaimsMap, expenses: nextExpensesMap }
      hasLoadedRef.current = true

      setUpdatedIds(changed)
      setItems(createFeed(claims, expenses))
      setLastUpdated(new Date())
    } catch (e) {
      console.error(e)
    }
    finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => load(true), 30000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={17} /> Notifications
          </h1>
          <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>
            Live updates when receipts and claims are approved, flagged, rejected, or changed.
          </p>
        </div>

        <button
          onClick={() => load(true)}
          disabled={refreshing}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "8px 12px", fontSize: 13, fontWeight: 600,
            borderRadius: 8, border: `1px solid ${THEME.border}`,
            background: THEME.surface, color: THEME.textPrimary, cursor: "pointer"
          }}
        >
          <RefreshCw size={14} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ marginBottom: 14, fontSize: 12, color: THEME.textMuted }}>
        Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
      </div>

      <div style={{ background: "linear-gradient(135deg, #15151d 0%, #101018 100%)", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: THEME.textMuted }}>Loading notifications...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary, marginBottom: 4 }}>No notifications yet</div>
            <div style={{ fontSize: 13, color: THEME.textMuted }}>Status updates will appear here automatically</div>
          </div>
        ) : (
          <div style={{ padding: 12 }}>
            {items.map((n) => {
              const st = STATUS_STYLES[n.status] || STATUS_STYLES.Draft
              const isUpdated = updatedIds.includes(n.id)
              return (
                <div key={n.id} style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  marginBottom: 10,
                  border: `1px solid ${isUpdated ? "rgba(118,185,0,0.45)" : THEME.border}`,
                  background: isUpdated ? "rgba(118,185,0,0.08)" : THEME.surfaceAlt,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: st.dot, display: "inline-block" }} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: THEME.textPrimary }}>{n.title}</div>
                    </div>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: st.bg, color: st.text,
                      padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600
                    }}>{n.status}</span>
                  </div>

                  <div style={{ fontSize: 13, color: THEME.textSecond, marginTop: 6 }}>{n.subtitle}</div>
                  {!!n.reason && (
                    <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 5, lineHeight: 1.5 }}>
                      {n.reason}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 7 }}>
                    {n.kind === "receipt" ? "Receipt update" : "Claim update"} • {toDisplayTime(n.ts)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Approvals Page ────────────────────────────────────────────────────────────
function ApprovalsPage() {
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState("")
  const [acting, setActing] = useState(false)

  const load = async () => {
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/approvals`, { headers: { Authorization: `Bearer ${token}` } })
      setApprovals(r.data.approvals || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const act = async (action) => {
    if (!selected) return
    setActing(true)
    try {
      const token = await getToken()
      await axios.post(`${API}/claims/${selected.id}/override`,
        { status: action === "approve" ? "Approved" : "Rejected", comment },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      await load()
      setSelected(null); setComment("")
    } catch (e) { console.error(e) }
    setActing(false)
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Approvals</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>Review and approve pending expense claims</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 360px" : "1fr", gap: 20 }}>
        <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: THEME.textMuted }}>Loading...</div>
          ) : approvals.length === 0 ? (
            <div style={{ padding: 64, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 4 }}>No records found</div>
              <div style={{ fontSize: 13, color: "#9ca3af" }}>No claims are waiting for approval</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: THEME.surfaceAlt }}>
                  {["Claim Name", "Employee", "Date Submitted", "Amount", "Status", ""].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {approvals.map(a => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${THEME.border}`, background: selected?.id === a.id ? THEME.blueDim : "transparent" }}
                    onMouseEnter={e => { if (selected?.id !== a.id) e.currentTarget.style.background = THEME.surfaceAlt }}
                    onMouseLeave={e => { if (selected?.id !== a.id) e.currentTarget.style.background = "transparent" }}
                  >
                    <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{a.report_name}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: THEME.textPrimary }}>{a.employee_name}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, color: THEME.textSecond }}>{a.submitted_at?.split("T")[0]}</td>
                    <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600, color: THEME.textPrimary }}>{a.currency || "USD"} {parseFloat(a.total_amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "11px 14px" }}><StatusBadge status={a.status} /></td>
                    <td style={{ padding: "11px 14px" }}>
                      <button onClick={() => { setSelected(a); setComment("") }}
                        style={{ padding: "5px 12px", background: THEME.blueDim, border: `1px solid ${THEME.border}`, color: THEME.blue, borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        Review →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, alignSelf: "start", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>Review Claim</div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.textMuted, fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
                <tbody>
                  {[
                    ["Claim", selected.report_name],
                    ["Employee", selected.employee_name],
                    ["Entity", selected.entity || "—"],
                    ["Amount", `${selected.currency || "USD"} ${parseFloat(selected.total_amount || 0).toFixed(2)}`],
                    ["Status", selected.status],
                    ["Submitted", selected.submitted_at?.split("T")[0]],
                  ].map(([l, v]) => (
                      <tr key={l} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                        <td style={{ padding: "7px 0", fontSize: 11, fontWeight: 600, color: THEME.textMuted, width: 80 }}>{l}</td>
                        <td style={{ padding: "7px 0", fontSize: 13, color: THEME.textPrimary }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {selected.purpose && (
                  <div style={{ padding: "10px 12px", background: THEME.surfaceAlt, border: `1px solid ${THEME.border}`, borderRadius: 6, marginBottom: 14, fontSize: 13, color: THEME.textSecond }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: THEME.textMuted, marginBottom: 3 }}>PURPOSE</div>
                  {selected.purpose}
                </div>
              )}

              <textarea
                placeholder="Add a comment (optional)..."
                value={comment} onChange={e => setComment(e.target.value)} rows={3}
                style={{ width: "100%", padding: "8px 11px", fontSize: 13, background: THEME.surfaceAlt, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: 6, boxSizing: "border-box", resize: "none", marginBottom: 10, outline: "none" }}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => act("reject")} disabled={acting} style={{
                  padding: 10, background: THEME.redDim, border: `1px solid ${THEME.border}`,
                  color: THEME.red, borderRadius: 6, cursor: acting ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600
                }}>
                  ✕ Reject
                </button>
                <button onClick={() => act("approve")} disabled={acting} style={{
                  padding: 10, ...primaryBtnStyle(acting), borderRadius: 6, fontSize: 13, fontWeight: 600
                }}>
                  ✓ Approve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Finance Dashboard ────────────────────────────────────────────────────────
function FinanceDashboard({ session }) {
  const [claims, setClaims] = useState([])
  const [selected, setSelected] = useState(null)
  const [overrideStatus, setOverrideStatus] = useState("")
  const [overrideComment, setOverrideComment] = useState("")
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("All")

  const fetchClaims = async () => {
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/claims`, { headers: { Authorization: `Bearer ${token}` } })
      setClaims(r.data.claims || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { fetchClaims() }, [])

  const handleOverride = async () => {
    if (!selected || !overrideStatus) return
    const token = await getToken()
    await axios.post(`${API}/claims/${selected.id}/override`,
      { status: overrideStatus, comment: overrideComment },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    await fetchClaims()
    setOverrideStatus(""); setOverrideComment("")
  }

  const filtered = filter === "All" ? claims : claims.filter(c => normalizeStatus(c.status) === filter)

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Finance Dashboard</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>Overview of all company expense claims</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: claims.length, color: THEME.blue, bg: THEME.blueDim },
          { label: "Flagged", value: claims.filter(c => normalizeStatus(c.status) === "Flagged").length, color: THEME.amber, bg: THEME.amberDim },
          { label: "Approved", value: claims.filter(c => normalizeStatus(c.status) === "Approved").length, color: THEME.green, bg: THEME.greenDim },
          { label: "Rejected", value: claims.filter(c => normalizeStatus(c.status) === "Rejected").length, color: THEME.red, bg: THEME.redDim },
        ].map(c => (
          <div key={c.label} onClick={() => setFilter(c.label === "Total" ? "All" : c.label)}
            style={{ background: c.bg, borderRadius: 8, padding: "14px 16px", cursor: "pointer", border: filter === (c.label === "Total" ? "All" : c.label) ? `1px solid ${c.color}` : `1px solid ${THEME.border}` }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 12, color: c.color, opacity: 0.8 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 380px" : "1fr", gap: 20 }}>
        <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, display: "flex", gap: 8 }}>
            {["All", "Draft", "Flagged", "Approved", "Rejected"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "4px 12px", borderRadius: 6, border: `1px solid ${THEME.border}`,
                background: filter === f ? THEME.blueDim : THEME.surfaceAlt,
                color: filter === f ? THEME.blue : THEME.textSecond, cursor: "pointer", fontSize: 12, fontWeight: 500
              }}>{f}</button>
            ))}
          </div>
          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: THEME.textMuted }}>Loading...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: THEME.surfaceAlt }}>
                  {["Report", "Employee", "Entity", "Amount", "Status", "Date", ""].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: THEME.textSecond, borderBottom: `1px solid ${THEME.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${THEME.border}`, background: selected?.id === c.id ? THEME.blueDim : "transparent" }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500, color: THEME.textPrimary }}>{c.report_name}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textPrimary }}>{c.employee_name}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: THEME.textSecond }}>{c.entity}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, color: THEME.textPrimary }}>{c.currency || "USD"} {parseFloat(c.total_amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "10px 14px" }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: THEME.textMuted }}>{c.created_at?.split("T")[0]}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <button onClick={() => setSelected(c)} style={{ padding: "4px 10px", background: THEME.blueDim, border: `1px solid ${THEME.border}`, color: THEME.blue, borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>View →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, alignSelf: "start", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>Claim Detail</div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.textMuted, fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              <StatusBadge status={selected.status} />
              <table style={{ width: "100%", borderCollapse: "collapse", margin: "14px 0" }}>
                <tbody>
                  {[["Report", selected.report_name], ["Employee", selected.employee_name], ["Entity", selected.entity], ["Dept.", selected.department || "—"], ["Amount", `${selected.currency || "USD"} ${parseFloat(selected.total_amount || 0).toFixed(2)}`]].map(([l, v]) => (
                    <tr key={l} style={{ borderBottom: `1px solid ${THEME.border}` }}>
                      <td style={{ padding: "6px 0", fontSize: 11, fontWeight: 600, color: THEME.textMuted, width: 70 }}>{l}</td>
                      <td style={{ padding: "6px 0", fontSize: 13, color: THEME.textPrimary }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {selected.override_comment && (
                <div style={{ padding: "10px 12px", background: THEME.amberDim, color: THEME.amber, borderRadius: 6, marginBottom: 12, fontSize: 12, border: `1px solid ${THEME.border}` }}>
                  <strong>Last override:</strong> {selected.override_comment}
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textSecond, marginBottom: 8 }}>Override Decision</div>
              <select value={overrideStatus} onChange={e => setOverrideStatus(e.target.value)}
                style={{ width: "100%", padding: "8px 11px", border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 13, marginBottom: 8, background: THEME.surfaceAlt, color: THEME.textPrimary }}>
                <option value="">— Select new status —</option>
                <option value="Approved">✅ Approve</option>
                <option value="Pending Approval">⏳ Send for Review</option>
                <option value="Rejected">❌ Reject</option>
              </select>
              <textarea rows={2} placeholder="Reason for decision..." value={overrideComment} onChange={e => setOverrideComment(e.target.value)}
                style={{ width: "100%", padding: "8px 11px", border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 8, resize: "none", outline: "none", background: THEME.surfaceAlt, color: THEME.textPrimary }} />
              <button onClick={handleOverride} disabled={!overrideStatus} style={{
                width: "100%", padding: 10, ...primaryBtnStyle(!overrideStatus), borderRadius: 6,
                fontWeight: 700, fontSize: 13
              }}>Apply Decision</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Policy Page ──────────────────────────────────────────────────────────────
function PolicyPage({ session, profile }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [existing, setExisting] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!profile?.company_id) return
    getToken().then(token => {
      axios.get(`${API}/policy/${profile.company_id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => {
          if (r.data.exists) {
            setExisting({
              file_name: r.data.file_name || "Policy.pdf",
              uploaded_at: r.data.uploaded_at,
            })
          } else {
            setExisting(null)
          }
        }).catch(console.error)
    })
  }, [profile])

  const handleUpload = async () => {
    if (!file) { setError("Please select a PDF file"); return }
    setLoading(true); setError(null)
    const form = new FormData()
    form.append("file", file)
    form.append("company_id", profile?.company_id || "default")
    try {
      const token = await getToken()
      const res = await axios.post(`${API}/upload-policy`, form, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      })
      setResult(res.data)
      setExisting({ file_name: file.name, uploaded_at: new Date().toISOString() })
    } catch (e) {
      if (e.code === "ECONNABORTED") {
        setError("Upload timed out. The PDF may be too large or image-only. Try a smaller/text-based PDF.")
      } else {
        setError("Error: " + (e.response?.data?.detail || e.message))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Company Policy</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>Upload your T&E policy — the AI auditor will use it to evaluate all expense claims</p>
      </div>

      {existing && (
        <div style={{ background: THEME.greenDim, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>📄</span>
          <div>
            <div style={{ fontWeight: 700, color: THEME.green, fontSize: 14 }}>Active Policy: {existing.file_name}</div>
            <div style={{ fontSize: 12, color: THEME.textSecond }}>Uploaded {new Date(existing.uploaded_at).toLocaleDateString()}</div>
          </div>
        </div>
      )}

      <div style={{ background: THEME.surface, borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.24)", border: `1px solid ${THEME.border}`, marginBottom: 16 }}>
        <div
          onClick={() => document.getElementById("policyFile").click()}
          style={{ border: `2px dashed ${THEME.border}`, borderRadius: 8, padding: 36, textAlign: "center", cursor: "pointer", background: THEME.surfaceAlt, marginBottom: 16 }}
        >
          {file ? (
            <div style={{ color: THEME.blue, fontWeight: 600 }}>📄 {file.name}</div>
          ) : (
            <div>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
              <div style={{ fontSize: 13, color: THEME.textSecond }}>Click to upload Policy PDF</div>
              <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 4 }}>PDF files only</div>
            </div>
          )}
        </div>
        <input id="policyFile" type="file" accept=".pdf" onChange={e => setFile(e.target.files[0])} style={{ display: "none" }} />

        <button onClick={handleUpload} disabled={loading} style={{
          width: "100%", padding: 12, ...primaryBtnStyle(loading), borderRadius: 8, fontSize: 14, fontWeight: 600
        }}>
          {loading ? "⏳ Processing..." : "Upload Policy"}
        </button>

        {error && <div style={{ marginTop: 12, padding: 12, background: THEME.redDim, border: `1px solid ${THEME.border}`, borderRadius: 6, color: THEME.red, fontSize: 13 }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 12, padding: 14, background: THEME.greenDim, borderRadius: 8, border: `1px solid ${THEME.border}` }}>
            <div style={{ fontWeight: 700, color: THEME.green, marginBottom: 4 }}>✅ Policy uploaded!</div>
            <div style={{ fontSize: 12, color: THEME.textSecond }}>Extracted {result.characters?.toLocaleString()} characters</div>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px", background: THEME.surfaceAlt, borderRadius: 8, border: `1px solid ${THEME.border}` }}>
        <div style={{ fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, fontSize: 13 }}>💡 How it works</div>
        <div style={{ fontSize: 12, color: THEME.textSecond, lineHeight: 1.7 }}>
          1. Upload your Travel & Expense Policy PDF<br />
          2. AI extracts and indexes all policy rules<br />
          3. Every new expense is automatically checked against these rules<br />
          4. AI cites the exact rule when approving, flagging, or rejecting claims
        </div>
      </div>
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [page, setPage] = useState("dashboard")
  const [currentClaim, setCurrentClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState("")

  const checkBackend = async () => {
    if (API_CONFIG_ERROR) {
      setApiError(API_CONFIG_ERROR)
      return
    }

    try {
      await axios.get(`${API}/health`, { timeout: API_TIMEOUT_MS })
      setApiError("")
    } catch {
      setApiError(`Cannot reach backend at ${API}. Check backend deployment and CORS settings.`)
    }
  }

  useEffect(() => {
    let cancelled = false

    const verifyApi = async () => {
      if (API_CONFIG_ERROR) {
        if (!cancelled) setApiError(API_CONFIG_ERROR)
        return
      }

      try {
        await axios.get(`${API}/health`, { timeout: API_TIMEOUT_MS })
        if (!cancelled) setApiError("")
      } catch {
        if (!cancelled) {
          setApiError(`Cannot reach backend at ${API}. Check backend deployment and CORS settings.`)
        }
      }
    }

    verifyApi()

    return () => {
      cancelled = true
    }
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

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setSession(session)
        await loadProfile(session)
      }
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setSession(session)
      if (!session) {
        setProfile(null)
        setPage("dashboard")
        return
      }
      await loadProfile(session)
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null); setProfile(null)
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

  if (apiError) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", background: THEME.bg, color: THEME.textPrimary, padding: 24 }}>
        <div style={{ maxWidth: 760, width: "100%", background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Backend connection issue</div>
          <div style={{ fontSize: 14, color: THEME.textSecond, lineHeight: 1.6, marginBottom: 12 }}>{apiError}</div>
          <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 14 }}>
            Active API URL: {API || "(empty)"}
          </div>
          <div style={{ fontSize: 13, color: THEME.textSecond, lineHeight: 1.6 }}>
            Quick fix: set <b>VITE_API_URL</b> to your backend base URL (for example: <b>https://your-backend-domain.com</b>) and redeploy frontend.
          </div>
          <button onClick={checkBackend} style={{ marginTop: 14, padding: "8px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt, color: THEME.textPrimary, cursor: "pointer", fontWeight: 600 }}>
            Retry backend check
          </button>
        </div>
      </div>
    )
  }

  if (!session) return <AuthPage onAuth={(user, sess, prof) => { setSession(sess); setProfile(prof) }} />

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", background: THEME.bg, color: THEME.textPrimary }}>
      <Sidebar
        page={page}
        setPage={(p) => { setPage(p) }}
        profile={profile}
        onLogout={handleLogout}
        onProfileUpdate={setProfile}
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {page === "dashboard"    && <Dashboard profile={profile} setPage={setPage} setCurrent={setCurrentClaim} />}
        {page === "notifications" && <NotificationsPage />}
        {page === "tripPlanner"  && <TripPlannerPage profile={profile} />}
        {page === "claims"       && <ClaimsPage profile={profile} setPage={setPage} setCurrent={setCurrentClaim} />}
        {page === "submitExpense" && <SubmitExpensePage profile={profile} setPage={setPage} setCurrent={setCurrentClaim} />}
        {page === "claimDetail"  && currentClaim && <ClaimDetail claim={currentClaim} setPage={setPage} profile={profile} />}
        {page === "expenses"     && <AvailableExpensesPage />}
        {page === "approvals"    && <ApprovalsPage />}
        {page === "finance"      && <FinanceDashboard session={session} />}
        {page === "policy"       && <PolicyPage session={session} profile={profile} />}
      </div>
    </div>
  )
}