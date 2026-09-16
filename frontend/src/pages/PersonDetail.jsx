import { useState, useEffect } from "react"
import axios from "axios"
import {
  X, Trash2, Mail, Phone, Briefcase, ShieldCheck, ShieldAlert,
  Clock, AlertTriangle, ReceiptText,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money, roleStyle } from "../theme/tokens"
import { formatClaimDate, normalizeStatus } from "../lib/format"
import {
  Button, TableWrap, Th, Td, EmptyState, RoleBadge, Notice, StatusBadge, Select,
} from "../components/ui"

// A slide-over rather than a page: an admin is scanning a directory and wants
// one person's story without losing their place in the list.
export default function PersonDetail({ userId, people = [], onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [transferTo, setTransferTo] = useState("")
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError("")
      try {
        const r = await axios.get(`${API}/admin/users/${userId}`, {
          headers: { Authorization: `Bearer ${await getToken()}` },
          timeout: API_TIMEOUT_MS,
        })
        if (!cancelled) setData(r.data)
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.detail || "Could not load this person.")
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const remove = async () => {
    setRemoving(true); setError("")
    try {
      const r = await axios.delete(`${API}/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
        data: { transfer_to: transferTo || "" },
        timeout: API_TIMEOUT_MS,
      })
      onChanged?.(r.data.detail)
      onClose?.()
    } catch (e) {
      setError(e.response?.data?.detail || "Could not remove this person.")
      setRemoving(false)
    }
  }

  const u = data?.user
  const a = data?.activity
  const base = data?.base_currency || ""
  const others = people.filter(p => p.id !== userId)

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(17,24,39,0.34)", display: "flex", justifyContent: "flex-end",
      }}>
      <aside
        role="dialog" aria-modal="true" aria-label="Person details"
        style={{
          width: "min(560px, 100%)", height: "100%", overflowY: "auto",
          background: THEME.bg, borderLeft: `1px solid ${THEME.border}`,
          boxShadow: "-18px 0 48px rgba(17,24,39,0.14)",
        }}>
        <header style={{
          position: "sticky", top: 0, zIndex: 2, background: THEME.surface,
          borderBottom: `1px solid ${THEME.border}`,
          padding: `${S.md}px ${S.lg}px`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.md,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...T.title, color: THEME.textPrimary,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {loading ? "Loading…" : (u?.full_name || "Unknown")}
            </div>
            {u && (
              <div style={{ display: "flex", alignItems: "center", gap: S.sm, marginTop: 3 }}>
                <RoleBadge role={u.role} />
                {u.is_self && <span style={{ ...T.micro, color: THEME.textMuted }}>you</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: "transparent", border: `1px solid ${THEME.border}`,
            borderRadius: R.sm, padding: 6, cursor: "pointer", display: "grid",
            placeItems: "center",
          }}>
            <X size={15} strokeWidth={2} color={THEME.textSecond} />
          </button>
        </header>

        <div style={{ padding: S.lg }}>
          {error && <Notice tone="bad">{error}</Notice>}

          {loading ? <EmptyState title="Loading this person…" /> : u && (
            <>
              {/* ── contact ── */}
              <Section title="Contact">
                <Line Icon={Mail} label="Email" value={u.email || "—"} />
                <Line Icon={Phone} label="Mobile" value={u.phone || "Not provided"} />
                <Line Icon={Briefcase} label="Job title" value={u.job_title || "Not provided"} />
                <Line Icon={ReceiptText} label="Company"
                      value={`${u.company_name || u.company_id} (${u.company_id})`} />
                <Line
                  Icon={u.has_security_question ? ShieldCheck : ShieldAlert}
                  tone={u.has_security_question ? THEME.green : THEME.amber}
                  label="Account recovery"
                  value={u.has_security_question
                    ? "Security question set — can self-reset"
                    : "No security question — cannot recover without you"} />
                <Line Icon={Clock} label="Last activity"
                      value={a?.last_active ? String(a.last_active).slice(0, 10) : "Never"} />
              </Section>

              {/* ── activity ── */}
              <Section title="Activity">
                <div style={{ display: "grid", gap: S.sm,
                              gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))" }}>
                  <Metric label="Claims filed" value={a.claims} />
                  <Metric label="Approved" value={a.approved_claims} tone={THEME.green} />
                  <Metric label="Approved value" value={money(a.approved_value, base)} />
                  <Metric label="Expenses" value={a.expenses} />
                  <Metric label="Total spend" value={money(a.spend, base)} />
                  <Metric label="Unfiled" value={a.unfiled_expenses}
                          tone={a.unfiled_expenses ? THEME.blue : undefined} />
                  <Metric label="Missing receipts" value={a.missing_receipts}
                          tone={a.missing_receipts ? THEME.amber : undefined} />
                  <Metric label="Unconverted" value={a.unconverted_expenses}
                          tone={a.unconverted_expenses ? THEME.amber : undefined} />
                </div>
                {a.unconverted_expenses > 0 && (
                  <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginTop: S.sm }}>
                    Unconverted expenses have no exchange rate on file, so they are
                    excluded from the spend figure above rather than added at 1:1.
                  </div>
                )}
              </Section>

              {/* ── claims ── */}
              <Section title="Recent claims">
                {!data.recent_claims?.length ? (
                  <EmptyState title="No claims filed" hint="Nothing to review yet." />
                ) : (
                  <TableWrap>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                      <thead>
                        <tr><Th>Claim</Th><Th>Status</Th>
                            <Th align="right">Total</Th><Th>Payment</Th></tr>
                      </thead>
                      <tbody>
                        {data.recent_claims.map(c => (
                          <tr key={c.id}>
                            <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                              {c.report_name || "Untitled"}
                              <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted }}>
                                {formatClaimDate(c)}
                              </div>
                            </Td>
                            <Td><StatusBadge status={c.status} /></Td>
                            <Td align="right" mono>{money(c.total_amount)}</Td>
                            <Td style={{ fontSize: 11.5 }}>
                              {c.reimbursement_status || "Not started"}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Section>

              {/* ── expenses ── */}
              <Section title="Recent expenses">
                {!data.recent_expenses?.length ? (
                  <EmptyState title="No expenses" />
                ) : (
                  <TableWrap>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                      <thead>
                        <tr><Th>Vendor</Th><Th>Type</Th>
                            <Th align="right">Amount</Th><Th>Status</Th></tr>
                      </thead>
                      <tbody>
                        {data.recent_expenses.map(e => (
                          <tr key={e.id}>
                            <Td style={{ color: THEME.textPrimary }}>
                              {e.vendor_name || "—"}
                              {e.receipt_missing && (
                                <AlertTriangle size={11} strokeWidth={2.2} color={THEME.amber}
                                               style={{ marginLeft: 5, verticalAlign: -1 }} />
                              )}
                            </Td>
                            <Td>{e.expense_type || "—"}</Td>
                            <Td align="right" mono>{money(e.amount, e.currency)}</Td>
                            <Td><StatusBadge status={e.status} /></Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Section>

              {/* ── removal ── */}
              {!u.is_self && (
                <Section title="Remove from organisation" danger>
                  <div style={{ ...T.body, color: THEME.textSecond, marginBottom: S.md }}>
                    Revokes access immediately. Their expenses and claims are{" "}
                    <strong>kept</strong> — an approved claim is evidence of a payment, and
                    deleting it because somebody left is how an audit trail grows holes.
                  </div>

                  {!confirming ? (
                    <Button variant="danger" onClick={() => setConfirming(true)}>
                      <Trash2 size={14} strokeWidth={1.9} /> Remove {u.full_name?.split(" ")[0] || "this person"}
                    </Button>
                  ) : (
                    <>
                      <Select label="Reassign their records to (optional)"
                              value={transferTo}
                              onChange={e => setTransferTo(e.target.value)}>
                        <option value="">Leave the records in place</option>
                        {others.map(p => (
                          <option key={p.id} value={p.id}>{p.full_name || p.id}</option>
                        ))}
                      </Select>
                      <div style={{ display: "flex", gap: S.sm, flexWrap: "wrap" }}>
                        <Button variant="danger" onClick={remove} disabled={removing}>
                          {removing ? "Removing…" : "Yes, remove them"}
                        </Button>
                        <Button onClick={() => setConfirming(false)} disabled={removing}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

const Section = ({ title, danger, children }) => (
  <section style={{
    background: THEME.surface, borderRadius: R.lg, marginBottom: S.md,
    border: `1px solid ${danger ? "rgba(220,38,38,0.28)" : THEME.border}`,
  }}>
    <div style={{
      ...T.micro, color: danger ? THEME.red : THEME.textMuted,
      padding: `${S.sm}px ${S.lg}px`, borderBottom: `1px solid ${THEME.border}`,
    }}>{title}</div>
    <div style={{ padding: S.lg }}>{children}</div>
  </section>
)

const Line = ({ Icon, label, value, tone }) => (
  <div style={{ display: "flex", gap: S.sm, alignItems: "flex-start", padding: "5px 0" }}>
    <Icon size={14} strokeWidth={1.85} color={tone || THEME.textMuted}
          style={{ marginTop: 2, flexShrink: 0 }} />
    <div style={{ minWidth: 0 }}>
      <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted }}>{label}</div>
      <div style={{ ...T.body, color: tone || THEME.textPrimary, wordBreak: "break-word" }}>
        {value}
      </div>
    </div>
  </div>
)

const Metric = ({ label, value, tone }) => (
  <div style={{
    background: THEME.surfaceAlt, borderRadius: R.sm, padding: `${S.sm}px ${S.md}px`,
  }}>
    <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted }}>{label}</div>
    <div style={{ ...T.body, fontWeight: 700, color: tone || THEME.textPrimary,
                  fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
)
