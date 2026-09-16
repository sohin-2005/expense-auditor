import { useState, useEffect } from "react"
import axios from "axios"
import { FileText, ScanLine, ChartNoAxesColumn, CalendarDays, Receipt } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, primaryBtnStyle } from "../theme/tokens"
import { getClaimDisplayName, normalizeStatus } from "../lib/format"
import { StatusBadge } from "../components/ui"
import AddExpenseModal from "../pages/AddExpenseModal"

function ClaimDetail({ claim, setPage, profile, isMobile = false }) {
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

  // Receipts live in object storage behind signed URLs that expire, so the
  // link is minted per click. The blank tab is opened synchronously, before
  // the await — opening it afterwards trips popup blockers, which read a
  // window.open outside the click handler's own task as unsolicited.
  const openReceipt = async (expenseId) => {
    const tab = window.open("", "_blank", "noopener,noreferrer")
    try {
      const token = await getToken()
      const res = await axios.get(`${API}/receipts/${expenseId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: API_TIMEOUT_MS,
      })
      if (tab) tab.location = res.data.url
      else window.location.href = res.data.url
    } catch (e) {
      const detail = e.response?.data?.detail || "Could not open that receipt."
      if (tab) {
        tab.document.title = "Receipt unavailable"
        tab.document.body.textContent = detail
      } else {
        alert(detail)
      }
    }
  }

  const total = expenses.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && String(v).trim() !== "")
  const normalizedExpenses = expenses.map(exp => {
    const normalizedStatus = normalizeStatus(exp.status)
    // Whether a receipt exists, not where it lives. Receipts now sit in
    // object storage behind short-lived signed URLs, so the real link is
    // fetched on click via GET /receipts/{id} rather than built from a
    // stored path.
    const hasReceipt = Boolean(pick(exp.receipt_url, exp.image_url))

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
      hasReceipt,
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
    <div style={{ padding: isMobile ? "16px 14px" : "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
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
                border: `1px solid ${THEME.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(17,24,39,0.08)",
                width: 200, zIndex: 100, overflow: "hidden"
              }}>
                {[
                  [ScanLine, "Scan Receipt", "scan"],
                  [FileText, "Manual Entry", "manual"],
                  [Receipt, "Available Expenses", "available"]
                ].map(([MenuIcon, label, mode]) => (
                  <button key={mode} onClick={() => { setAddExpenseMode(mode); setShowAddExpense(true); setShowDropdown(false) }}
                    style={{ width: "100%", padding: "10px 14px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${THEME.border}`, color: THEME.textPrimary }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                    onMouseLeave={e => e.currentTarget.style.background = "none"}
                  >
                    <MenuIcon size={14} strokeWidth={1.8} color={THEME.textSecond} />{label}
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
          { label: "Total Amount", value: `${currentClaim.currency || "USD"} ${total.toFixed(2)}`, Icon: ChartNoAxesColumn },
          { label: "Expenses", value: `${expenses.length} item${expenses.length !== 1 ? "s" : ""}`, Icon: Receipt },
          { label: "Submitted", value: currentClaim.created_at?.split("T")[0] || "—", Icon: CalendarDays },
        ].map(s => (
          <div key={s.label} style={{ background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 10, padding: "16px 18px", boxShadow: "0 1px 3px rgba(17,24,39,0.06)", border: `1px solid ${THEME.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <s.Icon size={20} strokeWidth={1.6} color={THEME.accent} />
            <div>
              <div style={{ fontSize: 11, color: THEME.textMuted }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: THEME.textPrimary }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Audit Summary */}
      <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 10, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(17,24,39,0.06)", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: THEME.textPrimary }}>AI Compliance Summary</div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {nonCompliant.length === 0 ? (
            <div style={{ fontSize: 13, color: "#065f46", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "10px 12px", borderRadius: 8 }}>
              All expense items in this claim comply with your uploaded company policy.
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
      <div style={{ background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 12, boxShadow: "0 1px 3px rgba(17,24,39,0.06)", border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary }}>Expense Items</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.blue }}>{currentClaim.currency || "USD"} {total.toFixed(2)} total</div>
        </div>
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>Loading expenses...</div>
        ) : normalizedExpenses.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center" }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Receipt size={34} strokeWidth={1.3} color={THEME.textMuted} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: THEME.textPrimary, marginBottom: 4 }}>No expenses added yet</div>
            <div style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 20 }}>Add expenses to this claim using the button above</div>
            <button onClick={() => setShowAddExpense(true)} style={{
              padding: "9px 18px", fontSize: 13, fontWeight: 700,
              ...primaryBtnStyle(false)
            }}>+ Add Expense</button>
          </div>
        ) : isMobile ? (
          <div style={{ padding: 10 }}>
            {claims.map(c => (
              <div key={c.id} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12, marginBottom: 10, background: THEME.surfaceAlt }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.textPrimary, marginBottom: 5 }}>{c.report_name}</div>
                <div style={{ fontSize: 12, color: THEME.textSecond, marginBottom: 3 }}>Entity: {c.entity || "—"}</div>
                <div style={{ fontSize: 12, color: THEME.textSecond, marginBottom: 8 }}>Amount: {c.currency || "USD"} {parseFloat(c.total_amount || 0).toFixed(2)}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <StatusBadge status={c.status} />
                  <button
                    onClick={() => { setCurrent(c); setPage("claimDetail") }}
                    style={{ padding: "6px 12px", background: THEME.blueDim, border: `1px solid ${THEME.border}`, color: THEME.blue, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                  >
                    Open →
                  </button>
                </div>
              </div>
            ))}
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
                    {exp.hasReceipt ? (
                      <button
                        onClick={() => openReceipt(exp.id)}
                        style={{
                          fontSize: 11, fontFamily: "inherit", color: THEME.blue,
                          background: "none", border: "none", padding: 0,
                          cursor: "pointer", textDecoration: "underline"
                        }}>View receipt</button>
                    ) : <span style={{ fontSize: 11, color: THEME.textMuted }}>None</span>}
                  </td>
                </tr>,
                <tr key={`audit-${exp.id}`} style={{ background: "rgba(17,24,39,0.02)", borderBottom: `1px solid ${THEME.border}` }}>
                  <td colSpan={9} style={{ padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, color: THEME.textPrimary, marginBottom: 3 }}><strong>Why {exp.normalizedStatus === "Approved" ? "approved" : "flagged"}:</strong> {exp.auditReason}</div>
                    <div style={{ fontSize: 12, color: THEME.textSecond }}><strong>Policy check:</strong> {exp.policyNote}</div>
                    {/* Provenance. A verified citation means the quote above
                        was copied out of the policy at the version in force,
                        not written by the model — which is the difference
                        between an explanation and a plausible-sounding one. */}
                    {exp.citation_verified === true && exp.policy_section && (
                      <div style={{ fontSize: 11, color: THEME.accent, marginTop: 4, fontWeight: 600 }}>
                        Cited from {exp.policy_section}
                      </div>
                    )}
                    {exp.citation_verified === false && (
                      <div style={{ fontSize: 11, color: THEME.amber, marginTop: 4, fontWeight: 600 }}>
                        Unverified citation — held for review
                      </div>
                    )}
                  </td>
                </tr>
              ]))}
            </tbody>
          </table>
        )}
      </div>

      {/* Purpose / Notes */}
      {currentClaim.purpose && (
        <div style={{ marginTop: 16, background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 10, padding: "14px 18px", boxShadow: "0 1px 3px rgba(17,24,39,0.06)", border: `1px solid ${THEME.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: THEME.textMuted, marginBottom: 4 }}>BUSINESS PURPOSE</div>
          <div style={{ fontSize: 13, color: THEME.textSecond }}>{currentClaim.purpose}</div>
        </div>
      )}
    </div>
  )
}

// ─── Pre-Trip Planner Page ───────────────────────────────────────────────────

export default ClaimDetail
