import { useState, useEffect } from "react"
import { supabase } from "./supabase"
import axios from "axios"

const API = "http://127.0.0.1:8000"
const getToken = async () => {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}
const statusColor = {
  Approved: { bg: "#f0fdf4", border: "#86efac", text: "#166534", badge: "#22c55e" },
  Flagged:  { bg: "#fefce8", border: "#fde047", text: "#854d0e", badge: "#eab308" },
  Rejected: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", badge: "#ef4444" },
  Pending:  { bg: "#f0f9ff", border: "#7dd3fc", text: "#0c4a6e", badge: "#0ea5e9" },
}
const riskColor = { High: "#ef4444", Medium: "#eab308", Low: "#22c55e" }

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [])
  const bg = type === "success" ? "#22c55e" : type === "warn" ? "#eab308" : "#ef4444"
  return (
    <div style={{ position: "fixed", top: 24, right: 24, zIndex: 9999, background: bg,
      color: "white", padding: "14px 20px", borderRadius: 10,
      boxShadow: "0 4px 12px rgba(0,0,0,0.2)", fontSize: 14, fontWeight: 600,
      maxWidth: 360, display: "flex", gap: 12, alignItems: "center" }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 18 }}>✕</button>
    </div>
  )
}

// ── Auth Page ──────────────────────────────────────────────────────────────────
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
        await supabase.from("profiles").insert({
          id: data.user.id, full_name: name, role, company_id: companyId
        })
        setMode("login")
        setError("Registered! Please log in.")
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
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 40, width: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36 }}>💼</div>
          <h1 style={{ margin: "8px 0 4px", fontSize: 24, fontWeight: 800, color: "#1e40af" }}>ExpenseAuditor</h1>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>AI-Powered Expense Compliance</p>
        </div>

        <div style={{ display: "flex", marginBottom: 24, background: "#f3f4f6", borderRadius: 8, padding: 4 }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: "8px", border: "none", borderRadius: 6, cursor: "pointer",
                background: mode === m ? "white" : "transparent",
                fontWeight: mode === m ? 700 : 400, fontSize: 14,
                boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
              {m === "login" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        {mode === "register" && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="John Smith"
                style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
                  border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Company ID</label>
              <input value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="e.g. acmecorp"
                style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
                  border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>All employees of same company use the same ID</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
                  border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}>
                <option value="employee">Employee</option>
                <option value="finance">Finance Team</option>
              </select>
            </div>
          </>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com"
            style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
              border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
            style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
              border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
        </div>

        {error && <div style={{ marginBottom: 14, padding: 10, background: error.includes("Registered") ? "#f0fdf4" : "#fef2f2",
          borderRadius: 6, fontSize: 13, color: error.includes("Registered") ? "#166534" : "#991b1b" }}>{error}</div>}

        <button onClick={handle} disabled={loading}
          style={{ width: "100%", padding: 13, background: loading ? "#93c5fd" : "#1e40af",
            color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  )
}

// ── Sidebar Nav ────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, profile, onLogout, notifications }) {
  const unread = notifications.filter(n => !n.read).length
  const isFinance = profile?.role === "finance"
  const navItems = [
    { id: "submit", icon: "📋", label: "Submit Expense" },
    { id: "myClaims", icon: "📁", label: "My Claims" },
    { id: "policy", icon: "📜", label: "Company Policy" },
    ...(isFinance ? [
      { id: "finance", icon: "📊", label: "Finance Dashboard" },
    ] : []),
    { id: "notifications", icon: "🔔", label: `Alerts ${unread > 0 ? `(${unread})` : ""}` },
  ]
  return (
    <div style={{ width: 220, background: "#1e293b", minHeight: "100vh", display: "flex",
      flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ padding: "24px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "white" }}>💼 ExpenseAI</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{profile?.full_name || "User"}</div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          {profile?.role === "finance" ? "🏦 Finance Team" : "👤 Employee"} · {profile?.company_id}
        </div>
      </div>
      <nav style={{ flex: 1, padding: "12px 0" }}>
        {navItems.map(item => (
          <button key={item.id} onClick={() => setPage(item.id)}
            style={{ width: "100%", padding: "12px 20px", background: page === item.id ? "rgba(59,130,246,0.2)" : "none",
              border: "none", borderLeft: page === item.id ? "3px solid #3b82f6" : "3px solid transparent",
              color: page === item.id ? "#93c5fd" : "#94a3b8", textAlign: "left", cursor: "pointer",
              fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <button onClick={onLogout}
        style={{ margin: 16, padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          color: "#f87171", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
        Sign Out
      </button>
    </div>
  )
}

// ── Submit Expense ─────────────────────────────────────────────────────────────
function SubmitExpense({ session, profile, addNotification }) {

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [purpose, setPurpose] = useState("")
  const [claimedDate, setClaimedDate] = useState("")
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = e => {
    const f = e.target.files[0]
    setFile(f); setPreview(URL.createObjectURL(f))
    setResult(null); setError(null)
  }

  const handleSubmit = async () => {
    if (!file || !purpose.trim()) { setError("Please upload a receipt and enter a business purpose."); return }
    setLoading(true); setError(null)
    const form = new FormData()
    form.append("file", file)
    form.append("business_purpose", purpose)
    form.append("employee_name", profile?.full_name || "Anonymous")
    form.append("claimed_date", claimedDate)
    form.append("company_id", profile?.company_id || "default")
    try {
      const token = await getToken()
      const res = await axios.post(`${API}/extract-receipt`, form, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = res.data.data
      setResult(data)
      const msg = data.status === "Approved"
        ? `✅ Claim from ${data.merchant_name} was Approved!`
        : data.status === "Rejected"
        ? `❌ Claim from ${data.merchant_name} Rejected: ${data.reason}`
        : `⚠️ Claim from ${data.merchant_name} Flagged for review`
      addNotification(msg, data.status === "Approved" ? "success" : data.status === "Rejected" ? "error" : "warn")
    } catch (e) {
      setError("Error: " + (e.response?.data?.detail || e.message))
    }
    setLoading(false)
  }

  const s = result ? (statusColor[result.status] || statusColor.Flagged) : null

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: 32 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#1e293b" }}>Submit Expense Claim</h2>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>Upload your receipt — our AI will audit it against your company policy instantly.</p>

      <div style={{ background: "white", borderRadius: 12, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Employee</label>
            <input value={profile?.full_name || ""} disabled
              style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
                border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, background: "#f9fafb", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Expense Date</label>
            <input type="date" value={claimedDate} onChange={e => setClaimedDate(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
                border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Receipt (JPG / PNG / PDF)</label>
          <div onClick={() => document.getElementById("fi").click()}
            style={{ marginTop: 6, border: "2px dashed #d1d5db", borderRadius: 8, padding: 28,
              textAlign: "center", cursor: "pointer", background: "#f9fafb" }}>
            {preview
              ? <img src={preview} alt="preview" style={{ maxHeight: 160, borderRadius: 8, maxWidth: "100%" }} />
              : <div style={{ color: "#6b7280" }}>📎 Click to upload receipt<br /><span style={{ fontSize: 12 }}>JPG, PNG, PDF supported</span></div>}
          </div>
          <input id="fi" type="file" accept="image/*,.pdf" onChange={handleFile} style={{ display: "none" }} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Business Purpose</label>
          <textarea rows={3} value={purpose} onChange={e => setPurpose(e.target.value)}
            placeholder="e.g. Client dinner with Acme Corp to discuss Q3 contract renewal"
            style={{ display: "block", width: "100%", marginTop: 6, padding: "10px 12px",
              border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
        </div>

        <button onClick={handleSubmit} disabled={loading}
          style={{ width: "100%", padding: 13, background: loading ? "#93c5fd" : "#1e40af",
            color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "⏳ AI is auditing your receipt..." : "Submit & Audit Expense"}
        </button>
        {error && <div style={{ marginTop: 12, padding: 12, background: "#fef2f2",
          border: "1px solid #fca5a5", borderRadius: 8, color: "#991b1b", fontSize: 14 }}>{error}</div>}
      </div>

      {result && (
        <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", background: s.bg, borderBottom: `1px solid ${s.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: s.text }}>
              {result.status === "Approved" ? "✅" : result.status === "Flagged" ? "⚠️" : "❌"} {result.status}
            </div>
            <span style={{ background: s.badge, color: "white", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
              {result.risk_level} Risk
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: 24, borderRight: "1px solid #f3f4f6" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 10 }}>RECEIPT IMAGE</div>
              {preview && <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />}
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 10 }}>EXTRACTED DATA</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <tbody>
                  {[["Merchant", result.merchant_name], ["Date", result.date],
                    ["Amount", `${result.currency} ${result.total_amount}`],
                    ["Category", result.category], ["Purpose", result.business_purpose]
                  ].map(([l, v]) => (
                    <tr key={l} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "7px 0", fontSize: 12, fontWeight: 600, color: "#6b7280", width: 80 }}>{l}</td>
                      <td style={{ padding: "7px 0", fontSize: 13 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8, borderLeft: `4px solid ${s.badge}`, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>AUDIT REASON</div>
                <div style={{ fontSize: 13 }}>{result.reason}</div>
              </div>
              <div style={{ padding: 12, background: "#f0f9ff", borderRadius: 8, borderLeft: "4px solid #0ea5e9" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>POLICY APPLIED</div>
                <div style={{ fontSize: 13, fontStyle: "italic", color: "#0c4a6e" }}>{result.policy_snippet}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── My Claims ──────────────────────────────────────────────────────────────────
function MyClaims({ session }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

 useEffect(() => {
  getToken().then(token => {
    axios.get(`${API}/claims/my`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setClaims(r.data.claims))
      .catch(console.error)
      .finally(() => setLoading(false))
  })
}, [])

  const badge = status => {
    const c = statusColor[status] || statusColor.Pending
    return <span style={{ background: c.badge, color: "white", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{status}</span>
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#1e293b" }}>My Claims</h2>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>Track all your submitted expense claims and their audit status.</p>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total", value: claims.length, color: "#1e40af", bg: "#eff6ff" },
          { label: "Approved", value: claims.filter(c => c.status === "Approved").length, color: "#166534", bg: "#f0fdf4" },
          { label: "Flagged", value: claims.filter(c => c.status === "Flagged").length, color: "#854d0e", bg: "#fefce8" },
          { label: "Rejected", value: claims.filter(c => c.status === "Rejected").length, color: "#991b1b", bg: "#fef2f2" },
        ].map(card => (
          <div key={card.label} style={{ background: card.bg, borderRadius: 10, padding: "16px 20px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 13, color: card.color }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>Loading your claims...</div>
        ) : claims.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>No claims submitted yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Merchant", "Date", "Amount", "Category", "Purpose", "Status", "Risk"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12,
                    fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #f3f4f6" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                  <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{c.merchant_name}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.date}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>{c.currency} {c.total_amount}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.category}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.business_purpose}</td>
                  <td style={{ padding: "12px 16px" }}>{badge(c.status)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ color: riskColor[c.risk_level], fontWeight: 700, fontSize: 13 }}>● {c.risk_level}</span>
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

// ── Policy Upload ──────────────────────────────────────────────────────────────
function PolicyPage({ session, profile }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [existing, setExisting] = useState(null)
  const [error, setError] = useState(null)
useEffect(() => {
  if (!profile?.company_id) return
  getToken().then(token => {
    axios.get(`${API}/policy/${profile.company_id}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => { if (r.data.exists) setExisting(r.data.policy) })
      .catch(console.error)
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
      headers: { Authorization: `Bearer ${token}` }
    })
    setResult(res.data)
    setExisting({ file_name: file.name, uploaded_at: new Date().toISOString() })
  } catch (e) {
    setError("Error: " + (e.response?.data?.detail || e.message))
  }
  setLoading(false)
}
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#1e293b" }}>Company Policy</h2>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>
        Upload your Travel & Expense Policy PDF. The AI auditor will use this to evaluate all claims.
      </p>

      {existing && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: 16, marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>📄</span>
          <div>
            <div style={{ fontWeight: 700, color: "#166534", fontSize: 14 }}>Policy Active: {existing.file_name}</div>
            <div style={{ fontSize: 12, color: "#4ade80" }}>Uploaded {new Date(existing.uploaded_at).toLocaleDateString()} · All new claims will use this policy</div>
          </div>
        </div>
      )}

      <div style={{ background: "white", borderRadius: 12, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Upload Policy PDF</label>
          <div onClick={() => document.getElementById("policyFile").click()}
            style={{ marginTop: 8, border: "2px dashed #d1d5db", borderRadius: 8, padding: 32,
              textAlign: "center", cursor: "pointer", background: "#f9fafb" }}>
            {file
              ? <div style={{ color: "#1e40af", fontWeight: 600 }}>📄 {file.name}</div>
              : <div style={{ color: "#6b7280" }}>📎 Click to upload PDF policy document<br /><span style={{ fontSize: 12 }}>PDF files only · Max 40 pages recommended</span></div>}
          </div>
          <input id="policyFile" type="file" accept=".pdf" onChange={e => setFile(e.target.files[0])} style={{ display: "none" }} />
        </div>

        <button onClick={handleUpload} disabled={loading}
          style={{ width: "100%", padding: 13, background: loading ? "#93c5fd" : "#1e40af",
            color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "⏳ Uploading & processing..." : "Upload Policy"}
        </button>

        {error && <div style={{ marginTop: 12, padding: 12, background: "#fef2f2", borderRadius: 8, color: "#991b1b", fontSize: 14 }}>{error}</div>}

        {result && (
          <div style={{ marginTop: 16, padding: 16, background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac" }}>
            <div style={{ fontWeight: 700, color: "#166534", marginBottom: 8 }}>✅ Policy uploaded successfully!</div>
            <div style={{ fontSize: 13, color: "#374151" }}>Extracted {result.characters.toLocaleString()} characters</div>
            <div style={{ marginTop: 8, padding: 10, background: "white", borderRadius: 6, fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>
              Preview: {result.preview}...
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, padding: 16, background: "#fefce8", borderRadius: 10, border: "1px solid #fde047" }}>
        <div style={{ fontWeight: 700, color: "#854d0e", marginBottom: 6, fontSize: 14 }}>💡 How it works</div>
        <div style={{ fontSize: 13, color: "#713f12", lineHeight: 1.6 }}>
          1. Upload your company's Travel & Expense Policy PDF<br />
          2. The AI extracts and stores all policy rules<br />
          3. Every new expense claim is automatically checked against these rules<br />
          4. The AI cites the exact policy rule when approving, flagging, or rejecting claims
        </div>
      </div>
    </div>
  )
}

// ── Finance Dashboard ──────────────────────────────────────────────────────────
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
      setClaims(r.data.claims)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const handleOverride = async () => {
    if (!selected || !overrideStatus) return
    const token = await getToken()
    await axios.post(`${API}/claims/${selected.id}/override`,
      { status: overrideStatus, comment: overrideComment },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    await fetchClaims()
    const r = await axios.get(`${API}/claims/${selected.id}`, { headers: { Authorization: `Bearer ${token}` } })
    setSelected(r.data.claim)
    setOverrideStatus(""); setOverrideComment("")
  }

  const badge = status => {
    const c = statusColor[status] || statusColor.Pending
    return <span style={{ background: c.badge, color: "white", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{status}</span>
  }

  const filtered = filter === "All" ? claims : claims.filter(c => c.status === filter)
  const counts = { All: claims.length, Approved: 0, Flagged: 0, Rejected: 0 }
  claims.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++ })

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#1e293b" }}>Finance Dashboard</h2>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>Review all claims sorted by risk level. Override AI decisions with your own judgment.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Total Claims", value: counts.All, color: "#1e40af", bg: "#eff6ff" },
          { label: "Approved", value: counts.Approved, color: "#166534", bg: "#f0fdf4" },
          { label: "Flagged", value: counts.Flagged, color: "#854d0e", bg: "#fefce8" },
          { label: "Rejected", value: counts.Rejected, color: "#991b1b", bg: "#fef2f2" },
        ].map(card => (
          <div key={card.label} onClick={() => setFilter(card.label === "Total Claims" ? "All" : card.label)}
            style={{ background: card.bg, borderRadius: 10, padding: "16px 20px", cursor: "pointer",
              border: filter === (card.label === "Total Claims" ? "All" : card.label) ? `2px solid ${card.color}` : "2px solid transparent" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 13, color: card.color }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 400px" : "1fr", gap: 24 }}>
        <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {["All", "Approved", "Flagged", "Rejected"].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
                    background: filter === f ? "#1e40af" : "white", color: filter === f ? "white" : "#374151",
                    cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{f}</button>
              ))}
            </div>
            <button onClick={fetchClaims} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: 12 }}>🔄 Refresh</button>
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>No claims found.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Employee", "Merchant", "Amount", "Category", "Status", "Risk", "Date", ""].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #f3f4f6" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: "1px solid #f9fafb", background: selected?.id === c.id ? "#eff6ff" : "white" }}>
                    <td style={{ padding: "12px 16px", fontSize: 14 }}>{c.employee_name}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500 }}>{c.merchant_name}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14 }}>{c.currency} {c.total_amount}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.category}</td>
                    <td style={{ padding: "12px 16px" }}>{badge(c.status)}</td>
                    <td style={{ padding: "12px 16px" }}><span style={{ color: riskColor[c.risk_level], fontWeight: 700, fontSize: 13 }}>● {c.risk_level}</span></td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{c.date}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <button onClick={() => setSelected(c)}
                        style={{ padding: "5px 12px", background: "#eff6ff", border: "none", color: "#1e40af", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (() => {
          const s = statusColor[selected.status] || statusColor.Pending
          return (
            <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", alignSelf: "start", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Audit Detail</h3>
                <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#9ca3af" }}>✕</button>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ padding: "10px 14px", background: s.bg, borderRadius: 8, border: `1px solid ${s.border}`, marginBottom: 16, color: s.text, fontWeight: 700, fontSize: 14 }}>
                  {selected.status === "Approved" ? "✅" : selected.status === "Flagged" ? "⚠️" : "❌"} {selected.status}
                  <span style={{ float: "right", background: s.badge, color: "white", padding: "2px 10px", borderRadius: 999, fontSize: 11 }}>{selected.risk_level} Risk</span>
                </div>

                {selected.image_url && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 8 }}>RECEIPT IMAGE</div>
                    <img src={selected.image_url} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                  </div>
                )}

                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
                  <tbody>
                    {[["Employee", selected.employee_name], ["Merchant", selected.merchant_name],
                      ["Amount", `${selected.currency} ${selected.total_amount}`],
                      ["Category", selected.category], ["Date", selected.date],
                      ["Purpose", selected.business_purpose]
                    ].map(([l, v]) => (
                      <tr key={l} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "7px 0", fontSize: 12, fontWeight: 600, color: "#6b7280", width: 80 }}>{l}</td>
                        <td style={{ padding: "7px 0", fontSize: 13 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ padding: 12, background: "#f8fafc", borderRadius: 8, borderLeft: `4px solid ${s.badge}`, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>AI AUDIT REASON</div>
                  <div style={{ fontSize: 13 }}>{selected.reason}</div>
                </div>
                <div style={{ padding: 12, background: "#f0f9ff", borderRadius: 8, borderLeft: "4px solid #0ea5e9", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>POLICY APPLIED</div>
                  <div style={{ fontSize: 13, fontStyle: "italic", color: "#0c4a6e" }}>{selected.policy_snippet}</div>
                </div>

                {selected.override_comment && (
                  <div style={{ padding: 12, background: "#fefce8", borderRadius: 8, marginBottom: 16, fontSize: 13, border: "1px solid #fde047" }}>
                    <strong>📝 Override:</strong> {selected.override_comment}
                  </div>
                )}

                <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>🔧 Human Override</div>
                  <select value={overrideStatus} onChange={e => setOverrideStatus(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
                    <option value="">-- Select new status --</option>
                    <option value="Approved">✅ Approve</option>
                    <option value="Flagged">⚠️ Flag</option>
                    <option value="Rejected">❌ Reject</option>
                  </select>
                  <textarea rows={2} placeholder="Reason for override..."
                    value={overrideComment} onChange={e => setOverrideComment(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 8, resize: "none" }} />
                  <button onClick={handleOverride} disabled={!overrideStatus}
                    style={{ width: "100%", padding: 10, background: overrideStatus ? "#1e40af" : "#e5e7eb",
                      color: overrideStatus ? "white" : "#9ca3af", border: "none", borderRadius: 6,
                      cursor: overrideStatus ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13 }}>
                    Apply Override
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Notifications ──────────────────────────────────────────────────────────────
function NotificationsPage({ notifications, setNotifications }) {
  useEffect(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: 32 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, color: "#1e293b" }}>Notifications</h2>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>Updates on your expense claims.</p>
      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
        {notifications.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#6b7280" }}>🔔 No notifications yet.</div>
        ) : notifications.slice().reverse().map(n => {
          const bg = n.type === "success" ? "#f0fdf4" : n.type === "error" ? "#fef2f2" : "#fefce8"
          const border = n.type === "success" ? "#86efac" : n.type === "error" ? "#fca5a5" : "#fde047"
          return (
            <div key={n.id} style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", background: bg, borderLeft: `4px solid ${border}` }}>
              <div style={{ fontSize: 14, color: "#1f2937", fontWeight: 500 }}>{n.msg}</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{n.time}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── App Root ───────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [page, setPage] = useState("submit")
  const [notifications, setNotifications] = useState([])
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session)
        supabase.from("profiles").select("*").eq("id", session.user.id).single()
          .then(({ data }) => setProfile(data))
      }
      setLoading(false)
    })
    supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
      if (!session) { setProfile(null); setPage("submit") }
    })
  }, [])

  const addNotification = (msg, type) => {
    const n = { id: Date.now(), msg, type, time: new Date().toLocaleTimeString(), read: false }
    setNotifications(prev => [...prev, n])
    setToast({ msg, type })
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null); setProfile(null)
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>💼</div>
        <div style={{ marginTop: 12, color: "#6b7280" }}>Loading...</div>
      </div>
    </div>
  )

  if (!session) return <AuthPage onAuth={(user, sess, prof) => { setSession(sess); setProfile(prof) }} />

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", background: "#f1f5f9" }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      <Sidebar page={page} setPage={setPage} profile={profile} onLogout={handleLogout} notifications={notifications} />
      <div style={{ flex: 1, overflowY: "auto" }}>
        {page === "submit"        && <SubmitExpense session={session} profile={profile} addNotification={addNotification} />}
        {page === "myClaims"      && <MyClaims session={session} />}
        {page === "policy"        && <PolicyPage session={session} profile={profile} />}
        {page === "finance"       && <FinanceDashboard session={session} />}
        {page === "notifications" && <NotificationsPage notifications={notifications} setNotifications={setNotifications} />}
      </div>
    </div>
  )
}