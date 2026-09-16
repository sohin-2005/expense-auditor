import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { Camera, KeyRound, ShieldQuestion, Save, Building2 } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, roleStyle } from "../theme/tokens"
import { Card, PageHeader, Button, Input, Select, Notice, RoleBadge } from "../components/ui"

export default function ProfilePage({ onProfileUpdate, isMobile = false }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [flash, setFlash] = useState("")

  const [form, setForm] = useState({ full_name: "", phone: "", job_title: "", company_name: "" })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" })
  const [pwBusy, setPwBusy] = useState(false)

  const [questions, setQuestions] = useState([])
  const [sec, setSec] = useState({ question: "", answer: "", current_password: "" })
  const [secBusy, setSecBusy] = useState(false)

  const auth = async () => ({ Authorization: `Bearer ${await getToken()}` })

  const load = async () => {
    setLoading(true); setError("")
    try {
      const headers = await auth()
      const [p, q] = await Promise.allSettled([
        axios.get(`${API}/profile`, { headers, timeout: API_TIMEOUT_MS }),
        axios.get(`${API}/auth/security-questions`, { timeout: API_TIMEOUT_MS }),
      ])
      if (p.status === "fulfilled") {
        const d = p.value.data
        setProfile(d)
        setForm({
          full_name: d.full_name || "", phone: d.phone || "",
          job_title: d.job_title || "", company_name: d.company_name || "",
        })
        setSec(s => ({ ...s, question: d.security_question || "" }))
      } else {
        setError(p.reason?.response?.data?.detail || "Could not load your profile.")
      }
      if (q.status === "fulfilled") setQuestions(q.value.data?.questions || [])
    } catch (e) {
      setError("Could not load your profile.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const saveDetails = async () => {
    setSaving(true); setError(""); setFlash("")
    try {
      const r = await axios.patch(`${API}/profile`, form,
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setProfile(r.data.profile)
      // Keep the shell's copy in step so the sidebar name updates without a
      // reload. Role is not passed along — that comes from /me.
      onProfileUpdate?.(r.data.profile)
      setFlash("Your details were saved.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not save your details.")
    }
    setSaving(false)
  }

  const uploadAvatar = async (file) => {
    if (!file) return
    setUploading(true); setError(""); setFlash("")
    try {
      const body = new FormData()
      body.append("file", file)
      const r = await axios.post(`${API}/profile/avatar`, body,
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setProfile(p => ({ ...p, avatar_url: r.data.avatar_url }))
      setFlash("Photo updated.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not upload that image.")
    }
    setUploading(false)
  }

  const changePassword = async () => {
    if (pw.new_password !== pw.confirm) { setError("The new passwords do not match."); return }
    setPwBusy(true); setError(""); setFlash("")
    try {
      await axios.post(`${API}/profile/password`,
        { current_password: pw.current_password, new_password: pw.new_password },
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setPw({ current_password: "", new_password: "", confirm: "" })
      setFlash("Password changed. It applies the next time you sign in.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not change your password.")
    }
    setPwBusy(false)
  }

  const saveSecurity = async () => {
    setSecBusy(true); setError(""); setFlash("")
    try {
      await axios.post(`${API}/profile/security-question`, sec,
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setSec(s => ({ ...s, answer: "", current_password: "" }))
      setProfile(p => ({ ...p, has_security_question: true, security_question: sec.question }))
      setFlash("Security question saved. You can use it to reset your password.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not save your security question.")
    }
    setSecBusy(false)
  }

  const field = { borderRadius: R.sm, padding: "10px 11px", background: THEME.surface }
  const rs = roleStyle(profile?.role)

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 860, margin: "0 auto" }}>
      <PageHeader
        title="My Profile"
        subtitle="Your details, your photo, and the credentials that get you back in if you are locked out."
      />

      {error && <Notice tone="bad">{error}</Notice>}
      {flash && <Notice tone="good">{flash}</Notice>}

      {loading ? (
        <Card><div style={{ ...T.body, color: THEME.textMuted }}>Loading your profile…</div></Card>
      ) : (
        <>
          {/* ── identity ── */}
          <Card title="Identity" style={{ marginBottom: S.lg }}>
            <div style={{ display: "flex", gap: S.lg, alignItems: "flex-start",
                          flexWrap: "wrap", marginBottom: S.lg }}>
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Change profile photo"
                  style={{
                    width: 84, height: 84, borderRadius: R.pill, cursor: "pointer",
                    border: `1px solid ${THEME.border}`, padding: 0, overflow: "hidden",
                    background: THEME.accentDim, display: "grid", placeItems: "center",
                    position: "relative",
                  }}>
                  {profile?.avatar_url
                    ? <img src={profile.avatar_url} alt=""
                           style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 26, fontWeight: 800, color: THEME.accent }}>
                        {initials(profile?.full_name)}
                      </span>}
                </button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                       onChange={e => uploadAvatar(e.target.files?.[0])} />
                <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginTop: 6 }}>
                  <Camera size={11} strokeWidth={1.9} style={{ verticalAlign: -1 }} />{" "}
                  {uploading ? "Uploading…" : "Change photo"}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: S.sm, marginBottom: 4 }}>
                  <span style={{ ...T.title, color: THEME.textPrimary }}>
                    {profile?.full_name || "—"}
                  </span>
                  <RoleBadge role={profile?.role} />
                </div>
                <div style={{ ...T.small, color: THEME.textSecond }}>{profile?.email || "—"}</div>
                <div style={{ ...T.small, color: THEME.textMuted, marginTop: 6,
                              display: "flex", alignItems: "center", gap: 5 }}>
                  <Building2 size={12} strokeWidth={1.9} />
                  {profile?.company_name || profile?.company_id}
                  <span style={{ opacity: 0.6 }}>· tenant “{profile?.company_id}”</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: S.md,
                          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
              <Input label="Full name" required value={form.full_name} style={field}
                     onChange={e => set("full_name", e.target.value)} />
              <Input label="Job title" value={form.job_title} placeholder="Optional"
                     style={field} onChange={e => set("job_title", e.target.value)} />
              <Input label="Mobile number" value={form.phone} placeholder="+91 98765 43210"
                     style={field} onChange={e => set("phone", e.target.value)} />
              <Input label="Company name" value={form.company_name} placeholder="Acme Corporation"
                     style={field} onChange={e => set("company_name", e.target.value)} />
            </div>

            {/* The distinction matters and is invisible otherwise: renaming a
                company must never move anyone's data between tenants. */}
            <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginBottom: S.md }}>
              Your email and role are managed by your administrator. Company name is a
              label; the tenant key <code>{profile?.company_id}</code> is what scopes your
              data and only an administrator can change it.
            </div>

            <Button variant="primary" onClick={saveDetails} disabled={saving}>
              <Save size={14} strokeWidth={2} /> {saving ? "Saving…" : "Save details"}
            </Button>
          </Card>

          {/* ── password ── */}
          <Card title="Password" style={{ marginBottom: S.lg }}>
            <div style={{ display: "grid", gap: S.md,
                          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)" }}>
              <Input label="Current password" type="password" style={field}
                     value={pw.current_password} autoComplete="current-password"
                     onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} />
              <Input label="New password" type="password" style={field}
                     value={pw.new_password} autoComplete="new-password"
                     onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} />
              <Input label="Confirm new password" type="password" style={field}
                     value={pw.confirm} autoComplete="new-password"
                     onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
            </div>
            <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginBottom: S.md }}>
              At least 8 characters. Your current password is re-checked on the server —
              a signed-in session proves who you were, not who is at the keyboard now.
            </div>
            <Button onClick={changePassword}
                    disabled={pwBusy || !pw.current_password || !pw.new_password}>
              <KeyRound size={14} strokeWidth={1.9} />
              {pwBusy ? "Changing…" : "Change password"}
            </Button>
          </Card>

          {/* ── recovery ── */}
          <Card title="Account recovery">
            <div style={{ ...T.body, color: THEME.textSecond, marginBottom: S.md }}>
              {profile?.has_security_question
                ? "A security question is set. You can use it to reset your password if you are locked out."
                : "No security question is set, so there is currently no way to recover this account without an administrator."}
            </div>

            <Select label="Security question" value={sec.question} style={field}
                    onChange={e => setSec(s => ({ ...s, question: e.target.value }))}>
              <option value="">Choose a question…</option>
              {questions.map(q => <option key={q} value={q}>{q}</option>)}
            </Select>

            <div style={{ display: "grid", gap: S.md,
                          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
              <Input label="Your answer" value={sec.answer} style={field}
                     onChange={e => setSec(s => ({ ...s, answer: e.target.value }))} />
              <Input label="Confirm with your password" type="password" style={field}
                     value={sec.current_password} autoComplete="current-password"
                     onChange={e => setSec(s => ({ ...s, current_password: e.target.value }))} />
            </div>

            <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginBottom: S.md }}>
              The answer is hashed before it is stored, exactly like a password — it
              unlocks a reset, so it is a credential. Case and spacing are ignored when
              you answer it later.
            </div>

            <Button onClick={saveSecurity}
                    disabled={secBusy || !sec.question || !sec.answer || !sec.current_password}>
              <ShieldQuestion size={14} strokeWidth={1.9} />
              {secBusy ? "Saving…" : profile?.has_security_question
                ? "Replace security question" : "Set security question"}
            </Button>
          </Card>
        </>
      )}
    </div>
  )
}

const initials = (name) =>
  String(name || "?").split(" ").filter(Boolean).slice(0, 2)
    .map(w => w[0]).join("").toUpperCase() || "?"
