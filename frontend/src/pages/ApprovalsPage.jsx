import { useState, useEffect } from "react"
import axios from "axios"
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, ShieldCheck,
  ChevronRight, Sparkles,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { formatClaimDate, getClaimDisplayName, normalizeStatus } from "../lib/format"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, StatusBadge, Notice, Input,
} from "../components/ui"

// The approver's working surface. A claim reaches here only because a person
// submitted it; the AI's opinion travels with it as a hint, never as the
// decision. Until recently a clean claim was auto-approved on submission and
// this queue was permanently empty — the whole point of the page is that a
// human closes the loop.
export default function ApprovalsPage({ isMobile = false }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [flash, setFlash] = useState("")
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState("")
  const [acting, setActing] = useState("")

  const load = async () => {
    setLoading(true); setError("")
    try {
      const headers = { Authorization: `Bearer ${await getToken()}` }
      const r = await axios.get(`${API}/approvals`, { headers, timeout: API_TIMEOUT_MS })
      setClaims(r.data.approvals || [])
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load the approval queue.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const decide = async (claim, decision) => {
    setActing(claim.id); setError(""); setFlash("")
    try {
      await axios.post(`${API}/claims/${claim.id}/override`,
        { status: decision, comment },
        { headers: { Authorization: `Bearer ${await getToken()}` }, timeout: API_TIMEOUT_MS })
      setFlash(`${getClaimDisplayName(claim)} ${decision.toLowerCase()}.`)
      setSelected(null); setComment("")
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || "Could not record that decision.")
    }
    setActing("")
  }

  const value = claims.reduce((s, c) => s + Number(c.total_amount || 0), 0)
  // The audit's own read of each claim, where the backend supplied it.
  const auditFlagged = claims.filter(
    c => ["Flagged", "Rejected"].includes(normalizeStatus(c.derived_status))).length
  const auditClean = claims.length - auditFlagged

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Approvals"
        subtitle="Claims waiting on your decision. The policy audit's verdict is shown as guidance — approving or rejecting is yours."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={1.9} /> Refresh
          </Button>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}
      {flash && <Notice tone="good">{flash}</Notice>}

      <StatRow>
        <Stat label="Awaiting your decision" value={loading ? "—" : claims.length}
              hint="Submitted claims"
              tone={claims.length ? THEME.blue : undefined} />
        <Stat label="Value in queue" value={loading ? "—" : money(value)}
              hint="Not yet released" />
        <Stat label="Audit found issues" value={loading ? "—" : auditFlagged}
              hint="Worth reading first"
              tone={auditFlagged ? THEME.amber : undefined} />
        <Stat label="Audit found nothing" value={loading ? "—" : auditClean}
              hint="Still needs a human"
              tone={THEME.green} />
      </StatRow>

      <Card title="Queue" pad={false}>
        {loading ? <EmptyState title="Loading the queue…" />
          : !claims.length ? (
            <EmptyState
              icon={<ShieldCheck size={26} strokeWidth={1.4} color={THEME.green} />}
              title="Nothing waiting"
              hint="Claims appear here the moment an employee submits one."
            />
          ) : (
            <TableWrap>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr>
                    <Th>Claim</Th><Th>Employee</Th><Th>Audit verdict</Th>
                    <Th align="right">Total</Th><Th>Submitted</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {claims.map(c => {
                    const open = selected?.id === c.id
                    const derived = normalizeStatus(c.derived_status)
                    const concerning = ["Flagged", "Rejected"].includes(derived)
                    return [
                      <tr key={c.id}
                          style={{ background: open ? THEME.surfaceAlt : "transparent" }}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {getClaimDisplayName(c)}
                        </Td>
                        <Td>{c.employee_name || "—"}</Td>
                        <Td>
                          {c.derived_status ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              {concerning
                                ? <AlertTriangle size={12} strokeWidth={2.2} color={THEME.amber} />
                                : <Sparkles size={12} strokeWidth={2} color={THEME.textMuted} />}
                              <span style={{ ...T.small,
                                             color: concerning ? THEME.amber : THEME.textMuted }}>
                                {derived}
                              </span>
                            </span>
                          ) : <span style={{ ...T.small, color: THEME.textMuted }}>—</span>}
                        </Td>
                        <Td align="right" mono>{money(c.total_amount)}</Td>
                        <Td>{formatClaimDate(c)}</Td>
                        <Td align="right">
                          <Button variant="ghost"
                                  onClick={() => { setSelected(open ? null : c); setComment("") }}>
                            {open ? "Close" : "Review"}
                            <ChevronRight size={12} strokeWidth={2.2}
                                          style={{ transform: open ? "rotate(90deg)" : "none",
                                                   transition: "transform .15s ease" }} />
                          </Button>
                        </Td>
                      </tr>,

                      open && (
                        <tr key={`${c.id}-review`} style={{ background: THEME.surfaceAlt }}>
                          <td colSpan={6} style={{ padding: `${S.md}px ${S.lg}px`,
                                                   borderBottom: `1px solid ${THEME.border}` }}>
                            {c.ai_summary && (
                              <div style={{ ...T.body, color: THEME.textPrimary, marginBottom: S.sm }}>
                                <strong>Audit said:</strong> {c.ai_summary}
                              </div>
                            )}
                            {c.ai_policy_snippet && (
                              <div style={{
                                ...T.small, color: THEME.textSecond, fontStyle: "italic",
                                borderLeft: `3px solid ${THEME.accent}`, paddingLeft: S.sm,
                                marginBottom: S.md,
                              }}>
                                “{c.ai_policy_snippet}”
                              </div>
                            )}

                            <Input label="Comment (optional, shown to the employee)"
                                   value={comment} placeholder="Why you decided this way"
                                   onChange={e => setComment(e.target.value)}
                                   style={{ borderRadius: R.sm, padding: "9px 11px",
                                            background: THEME.surface }} />

                            <div style={{ display: "flex", gap: S.sm, flexWrap: "wrap" }}>
                              <Button variant="primary" disabled={acting === c.id}
                                      onClick={() => decide(c, "Approved")}>
                                <CheckCircle2 size={14} strokeWidth={2} />
                                {acting === c.id ? "Saving…" : "Approve"}
                              </Button>
                              <Button variant="danger" disabled={acting === c.id}
                                      onClick={() => decide(c, "Rejected")}>
                                <XCircle size={14} strokeWidth={2} /> Reject
                              </Button>
                              <Button disabled={acting === c.id}
                                      onClick={() => decide(c, "Flagged")}>
                                <AlertTriangle size={14} strokeWidth={1.9} /> Send back
                              </Button>
                            </div>

                            <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                                          marginTop: S.sm }}>
                              You cannot decide your own claim — another approver has to.
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
