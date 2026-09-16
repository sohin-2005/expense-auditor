import { useState, useEffect } from "react"
import axios from "axios"
import {
  Receipt, Download, Trash2, RefreshCw, AlertTriangle, FileWarning, Car,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { normalizeStatus } from "../lib/format"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, StatusBadge, Notice, Input,
} from "../components/ui"

// Expenses that exist but belong to no claim. Nothing here is being
// reimbursed — that is the whole message of the page, and the previous
// version buried it under a plain list.
export default function AvailableExpensesPage({ setPage, isMobile = false }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [flash, setFlash] = useState("")
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  const auth = async () => ({ Authorization: `Bearer ${await getToken()}` })

  const load = async () => {
    setLoading(true); setError("")
    try {
      const r = await axios.get(`${API}/expenses/available?limit=200&offset=0`,
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setExpenses(r.data.expenses || [])
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load your unfiled expenses.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const remove = async (id) => {
    setDeleting(id); setError(""); setFlash("")
    try {
      await axios.delete(`${API}/expenses/${id}`,
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setExpenses(list => list.filter(e => e.id !== id))
      setFlash("Expense deleted.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not delete that expense.")
    }
    setDeleting(null)
  }

  const declareMissing = async (id) => {
    if (reason.trim().length < 10) {
      setError("Explain briefly what happened to the receipt — finance reviews these.")
      return
    }
    setSaving(true); setError(""); setFlash("")
    try {
      await axios.post(`${API}/expenses/${id}/missing-receipt`, { reason },
        { headers: await auth(), timeout: API_TIMEOUT_MS })
      setReasonFor(null); setReason("")
      setFlash("Declaration recorded. This expense is flagged for manual review.")
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || "Could not record that declaration.")
    }
    setSaving(false)
  }

  const exportCsv = async () => {
    setExporting(true); setError("")
    try {
      const r = await axios.get(`${API}/expenses/export.csv`, {
        headers: await auth(), responseType: "blob", timeout: API_TIMEOUT_MS,
      })
      const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }))
      const a = document.createElement("a")
      a.href = url; a.download = "audixa_expenses.csv"; a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError("Could not build your export.")
    }
    setExporting(false)
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount_base || 0), 0)
  const noReceipt = expenses.filter(e => !e.receipt_url && !e.receipt_missing).length
  const unconverted = expenses.filter(e => e.amount_base == null).length

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Unfiled Expenses"
        subtitle="Captured but not attached to any claim — so none of it is being reimbursed yet."
        actions={
          <>
            <Button variant="primary" onClick={() => setPage?.("claims")}>
              <Receipt size={14} strokeWidth={2} /> File into a claim
            </Button>
            <Button onClick={exportCsv} disabled={exporting}>
              <Download size={14} strokeWidth={1.9} /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={14} strokeWidth={1.9} /> Refresh
            </Button>
          </>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}
      {flash && <Notice tone="good">{flash}</Notice>}

      {unconverted > 0 && (
        <Notice tone="warn">
          <strong>{unconverted}</strong> of these have no exchange rate on file, so they
          are excluded from the total below rather than counted at 1:1. Ask your finance
          team to add a rate.
        </Notice>
      )}

      <StatRow>
        <Stat label="Unfiled expenses" value={loading ? "—" : expenses.length}
              hint="Not on any claim"
              tone={expenses.length ? THEME.blue : undefined} />
        <Stat label="Value waiting" value={loading ? "—" : money(total)}
              hint="Once filed and approved" />
        <Stat label="Without a receipt" value={loading ? "—" : noReceipt}
              hint="Attach one or declare it missing"
              tone={noReceipt ? THEME.amber : undefined} />
        <Stat label="Unconverted" value={loading ? "—" : unconverted}
              hint="No FX rate on file"
              tone={unconverted ? THEME.amber : undefined} />
      </StatRow>

      <Card title="Expenses" pad={false}>
        {loading ? <EmptyState title="Loading…" />
          : !expenses.length ? (
            <EmptyState
              icon={<Receipt size={26} strokeWidth={1.4} color={THEME.textMuted} />}
              title="Nothing unfiled"
              hint="Every expense you have captured is attached to a claim."
            />
          ) : (
            <TableWrap>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr>
                    <Th>Vendor</Th><Th>Type</Th><Th>Date</Th>
                    <Th align="right">Amount</Th><Th>Status</Th><Th>Receipt</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(e => {
                    const isMileage = e.expense_type === "Mileage"
                    const asking = reasonFor === e.id
                    return [
                      <tr key={e.id}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {isMileage && (
                            <Car size={12} strokeWidth={2} color={THEME.textMuted}
                                 style={{ marginRight: 5, verticalAlign: -1 }} />
                          )}
                          {e.vendor_name || e.merchant_name || "—"}
                        </Td>
                        <Td>{e.expense_type || e.category || "—"}</Td>
                        <Td>{String(e.transaction_date || e.date || e.created_at || "").slice(0, 10) || "—"}</Td>
                        <Td align="right" mono>
                          {money(e.amount, e.currency)}
                          {e.amount_base == null && (
                            <div style={{ ...T.small, fontSize: 10, color: THEME.amber }}>
                              not converted
                            </div>
                          )}
                        </Td>
                        <Td><StatusBadge status={e.status} /></Td>
                        <Td>
                          {e.receipt_url ? (
                            <span style={{ ...T.small, color: THEME.green }}>Attached</span>
                          ) : e.receipt_missing ? (
                            <span style={{ ...T.small, color: THEME.amber,
                                           display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <FileWarning size={12} strokeWidth={2} /> Declared missing
                            </span>
                          ) : isMileage ? (
                            <span style={{ ...T.small, color: THEME.textMuted }}>Not needed</span>
                          ) : (
                            <Button variant="ghost"
                                    onClick={() => { setReasonFor(asking ? null : e.id); setReason("") }}>
                              <AlertTriangle size={12} strokeWidth={2} /> No receipt
                            </Button>
                          )}
                        </Td>
                        <Td align="right">
                          <Button variant="ghost" disabled={deleting === e.id}
                                  onClick={() => remove(e.id)}>
                            <Trash2 size={13} strokeWidth={1.9} color={THEME.red} />
                          </Button>
                        </Td>
                      </tr>,

                      asking && (
                        <tr key={`${e.id}-declare`} style={{ background: THEME.surfaceAlt }}>
                          <td colSpan={7} style={{ padding: `${S.md}px ${S.lg}px`,
                                                   borderBottom: `1px solid ${THEME.border}` }}>
                            <div style={{ ...T.body, color: THEME.textSecond, marginBottom: S.sm }}>
                              Receipts get lost. Say what happened — this is recorded on the
                              expense and reviewed by finance, and the expense is flagged
                              rather than approved.
                            </div>
                            <Input label="What happened to the receipt?" value={reason}
                                   placeholder="Card terminal issued no receipt; paid at the counter."
                                   onChange={ev => setReason(ev.target.value)}
                                   style={{ borderRadius: R.sm, padding: "9px 11px",
                                            background: THEME.surface }} />
                            <div style={{ display: "flex", gap: S.sm }}>
                              <Button variant="primary" disabled={saving}
                                      onClick={() => declareMissing(e.id)}>
                                {saving ? "Recording…" : "Record declaration"}
                              </Button>
                              <Button onClick={() => { setReasonFor(null); setReason("") }}>
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
    </div>
  )
}
