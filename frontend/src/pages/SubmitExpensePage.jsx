import { useState } from "react"
import axios from "axios"
import { Receipt } from "lucide-react"
import { API, getToken } from "../lib/api"
import { Input, StatusBadge } from "../components/ui"

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
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Receipt Upload <span style={{ color: "#dc2626" }}>*</span></label>
          <div onClick={() => document.getElementById("submitReceiptFile").click()}
            style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 20, textAlign: "center", cursor: "pointer", background: "#f9fafb" }}>
            {preview ? (
              <img src={preview} alt="receipt" style={{ maxHeight: 180, borderRadius: 8, maxWidth: "100%" }} />
            ) : file ? (
              <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>{file.name}</div>
            ) : (
              <div style={{ fontSize: 13, color: "#6b7280" }}>Click to upload receipt (JPG/PNG/PDF)</div>
            )}
          </div>
          <input id="submitReceiptFile" type="file" accept="image/*,.pdf" onChange={handleFile} style={{ display: "none" }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Business Purpose <span style={{ color: "#dc2626" }}>*</span></label>
          <textarea
            rows={3}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="e.g. Client meeting lunch"
            style={{ width: "100%", padding: "9px 11px", border: "1px solid #d1d5db", borderRadius: 6, boxSizing: "border-box", fontSize: 13, resize: "vertical" }}
          />
        </div>

        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: 11, border: "none", borderRadius: 8, background: loading ? "#1d4ed8" : "#1d4ed8", color: "white", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Processing with AI…" : "Submit & Run OCR + Policy Audit"}
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
              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>RECEIPT</div>
              {preview ? (
                <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />
              ) : (
                <div style={{ fontSize: 13, color: "#6b7280" }}>{file?.name || "Uploaded file"}</div>
              )}
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>OCR EXTRACTED DETAILS</div>
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

export default SubmitExpensePage
