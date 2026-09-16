import { useState } from "react"
import axios from "axios"
import { Receipt } from "lucide-react"
import { API, getToken } from "../lib/api"
import { Input, StatusBadge } from "../components/ui"

function CreateClaimModal({ profile, onClose, onCreate, isMobile = false }) {
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
        position: "fixed", inset: 0, background: "rgba(17,24,39,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: isMobile ? "94vw" : 520, maxWidth: 520, boxShadow: "0 20px 60px rgba(17,24,39,0.06)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Create Expense Claim</h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>How would you like to create your claim?</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
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
        position: "fixed", inset: 0, background: "rgba(17,24,39,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: isMobile ? "94vw" : 580, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(17,24,39,0.06)" }}>
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
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24 }}>
            <Input
              label="Report Name" required
              value={form.report_name} onChange={e => set("report_name", e.target.value)}
              placeholder="e.g. Q1 Business Travel - New York"
              error={errors.report_name}
            />

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee ID</label>
                <input value={profile?.id?.slice(0,8) || "—"} disabled
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#6b7280" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee Name</label>
                <input value={profile?.full_name || ""} disabled
                  style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#6b7280" }} />
              </div>
            </div>

            <Input
              label="Entity" required
              value={form.entity} onChange={e => set("entity", e.target.value)}
              placeholder="e.g. Acme Corporation US"
              error={errors.entity}
            />

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
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
              padding: "9px 20px", background: loading ? "#1d4ed8" : "#1d4ed8",
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
        position: "fixed", inset: 0, background: "rgba(17,24,39,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
      }}>
        <div style={{ background: "white", borderRadius: 12, width: isMobile ? "96vw" : 640, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(17,24,39,0.06)" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <button onClick={() => { setStep("choose"); setScanResult(null); setScanError("") }} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 13, padding: 0 }}>
                ← Back
              </button>
              <h2 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 700, color: "#111827" }}>Scan Receipt</h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>Upload a receipt — AI will extract details and run a policy audit</p>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Employee</label>
                <input value={profile?.full_name || ""} disabled style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#6b7280" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Company</label>
                <input value={profile?.company_id || "default"} disabled style={{ width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", boxSizing: "border-box", color: "#6b7280" }} />
              </div>
            </div>

            {/* File upload */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Receipt Upload <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <div
                onClick={() => document.getElementById("createClaimScanFile").click()}
                style={{ border: "2px dashed #d1d5db", borderRadius: 8, padding: 20, textAlign: "center", cursor: "pointer", background: "#f9fafb" }}
              >
                {preview ? (
                  <img src={preview} alt="receipt" style={{ maxHeight: 160, borderRadius: 8, maxWidth: "100%" }} />
                ) : file ? (
                  <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>{file.name}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>Click to upload receipt (JPG / PNG / PDF)</div>
                )}
              </div>
              <input id="createClaimScanFile" type="file" accept="image/*,.pdf" onChange={handleScanFile} style={{ display: "none" }} />
            </div>

            {/* Business purpose */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Business Purpose <span style={{ color: "#dc2626" }}>*</span>
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
              background: scanning ? "#1d4ed8" : "#1d4ed8", color: "white",
              fontSize: 14, fontWeight: 700, cursor: scanning ? "not-allowed" : "pointer", marginBottom: 4
            }}>
              {scanning ? "Processing with AI…" : "Submit & Run OCR + Policy Audit"}
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

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
                  <div style={{ padding: 16, borderRight: "1px solid #f3f4f6" }}>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>RECEIPT</div>
                    {preview ? (
                      <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                    ) : (
                      <div style={{ fontSize: 13, color: "#6b7280" }}>{file?.name}</div>
                    )}
                  </div>
                  <div style={{ padding: 16 }}>
                    <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>EXTRACTED DETAILS</div>
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
                    padding: "8px 18px", background: creating ? "#1d4ed8" : "#1d4ed8",
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

export default CreateClaimModal
