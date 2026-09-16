import { useState, useEffect } from "react"
import axios from "axios"
import { FileText, CheckCircle2 } from "lucide-react"
import { API, getToken } from "../lib/api"
import { THEME, primaryBtnStyle } from "../theme/tokens"
import PolicyAskCard from "../pages/PolicyAskCard"

function PolicyPage({ session, profile, capabilities = {} }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [existing, setExisting] = useState(null)
  const [error, setError] = useState(null)

  // Everyone may read the policy they are judged against; only approvers may
  // replace it. The server enforces this (require_finance on /upload-policy) —
  // hiding the control here just avoids handing employees a 403 for a button
  // the page offered them.
  // From the server's capability set, not from the role string. A manager
  // approves against the policy; only finance rewrites it.
  const canUploadPolicy = Boolean(capabilities.edit_policy)

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
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>
          {canUploadPolicy
            ? "Upload your T&E policy — the AI auditor will use it to evaluate all expense claims"
            : "The policy every expense is audited against. Ask your finance team to update it."}
        </p>
      </div>

      {existing && (
        <div style={{ background: THEME.greenDim, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <FileText size={22} strokeWidth={1.6} color={THEME.green} />
          <div>
            <div style={{ fontWeight: 700, color: THEME.green, fontSize: 14 }}>Active Policy: {existing.file_name}</div>
            <div style={{ fontSize: 12, color: THEME.textSecond }}>Uploaded {new Date(existing.uploaded_at).toLocaleDateString()}</div>
          </div>
        </div>
      )}

      {!canUploadPolicy && !existing && (
        <div style={{ background: THEME.surfaceAlt, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 16, fontSize: 13, color: THEME.textSecond }}>
          No policy has been uploaded for your company yet. Until one is, expenses
          are audited against standard business expense rules.
        </div>
      )}

      {canUploadPolicy && (
      <div style={{ background: THEME.surface, borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(17,24,39,0.06)", border: `1px solid ${THEME.border}`, marginBottom: 16 }}>
        <div
          onClick={() => document.getElementById("policyFile").click()}
          style={{ border: `2px dashed ${THEME.border}`, borderRadius: 8, padding: 36, textAlign: "center", cursor: "pointer", background: THEME.surfaceAlt, marginBottom: 16 }}
        >
          {file ? (
            <div style={{ color: THEME.blue, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><FileText size={16} strokeWidth={1.8} /> {file.name}</div>
          ) : (
            <div>
              <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><FileText size={28} strokeWidth={1.4} color={THEME.textMuted} /></div>
              <div style={{ fontSize: 13, color: THEME.textSecond }}>Click to upload Policy PDF</div>
              <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 4 }}>PDF files only</div>
            </div>
          )}
        </div>
        <input id="policyFile" type="file" accept=".pdf" onChange={e => setFile(e.target.files[0])} style={{ display: "none" }} />

        <button onClick={handleUpload} disabled={loading} style={{
          width: "100%", padding: 12, ...primaryBtnStyle(loading), borderRadius: 8, fontSize: 14, fontWeight: 600
        }}>
          {loading ? "Processing…" : "Upload Policy"}
        </button>

        {error && <div style={{ marginTop: 12, padding: 12, background: THEME.redDim, border: `1px solid ${THEME.border}`, borderRadius: 6, color: THEME.red, fontSize: 13 }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 12, padding: 14, background: THEME.greenDim, borderRadius: 8, border: `1px solid ${THEME.border}` }}>
            <div style={{ fontWeight: 700, color: THEME.green, marginBottom: 4, display: "flex", alignItems: "center", gap: 7 }}><CheckCircle2 size={15} strokeWidth={2} /> Policy uploaded</div>
            <div style={{ fontSize: 12, color: THEME.textSecond }}>Extracted {result.characters?.toLocaleString()} characters</div>
          </div>
        )}
      </div>
      )}

      <PolicyAskCard profile={profile} />

      <div style={{ padding: "14px 16px", background: THEME.surfaceAlt, borderRadius: 8, border: `1px solid ${THEME.border}` }}>
        <div style={{ fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, fontSize: 13 }}>How it works</div>
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

// ─── Spend Analytics Page ─────────────────────────────────────────────────────

export default PolicyPage
