import { useState, useRef } from "react"
import axios from "axios"
import { FileText, Receipt } from "lucide-react"
import { API, getToken } from "../lib/api"
import { THEME, primaryBtnStyle } from "../theme/tokens"
import { Input, Select } from "../components/ui"

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.10)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: THEME.surface, borderRadius: 12, width: 700, maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(17,24,39,0.08)", border: `1px solid ${THEME.border}` }}>
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
                    <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><FileText size={26} strokeWidth={1.4} color={THEME.textMuted} /></div>
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
                  {scanning ? "Scanning with AI…" : "Scan & Auto-fill"}
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
              Business Purpose <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <textarea
              value={form.business_purpose} onChange={e => set("business_purpose", e.target.value)}
              placeholder="Describe the business purpose of this expense..."
              rows={3}
              style={{
                width: "100%", padding: "8px 11px", fontSize: 13,
                border: `1px solid ${errors.business_purpose ? "#dc2626" : THEME.border}`,
                background: errors.business_purpose ? "#fef2f2" : THEME.surface,
                color: THEME.textPrimary,
                borderRadius: 6, boxSizing: "border-box", resize: "vertical", outline: "none"
              }}
            />
            {errors.business_purpose && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{errors.business_purpose}</div>}
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

export default AddExpenseModal
