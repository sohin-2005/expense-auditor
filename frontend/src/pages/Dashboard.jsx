import { useState, useEffect } from "react"
import axios from "axios"
import {
  ScanLine, Car, ClipboardList, Receipt, AlertTriangle, ArrowRight,
  Clock, CheckCircle2, Wallet, ChevronRight,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { formatClaimDate, getClaimDisplayName, getISTGreeting, normalizeStatus } from "../lib/format"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, StatusBadge, Notice,
} from "../components/ui"

// Laid out the way an expense tool is actually used: the first question is
// "is anything blocking me", the second is "when do I get paid", and only
// then "what did I spend". The previous dashboard opened with three counters
// of equal weight, which answered none of those and made every number look
// equally urgent.
export default function Dashboard({ profile, setPage, setCurrent, isMobile = false }) {
  const [claims, setClaims] = useState([])
  const [unfiled, setUnfiled] = useState(0)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError("")
      try {
        const token = await getToken()
        const headers = { Authorization: `Bearer ${token}` }
        const [c, e, a] = await Promise.allSettled([
          axios.get(`${API}/claims/my?limit=50&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
          axios.get(`${API}/expenses/available?limit=200&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
          axios.get(`${API}/analytics/summary`, { headers, timeout: API_TIMEOUT_MS }),
        ])
        if (cancelled) return
        if (c.status === "fulfilled") setClaims(c.value.data?.claims || [])
        if (e.status === "fulfilled") {
          const d = e.value.data
          setUnfiled(d?.paging?.total_count ?? (d?.expenses?.length || 0))
        }
        if (a.status === "fulfilled") setAnalytics(a.value.data)
        if (c.status === "rejected") setError("Some of your data could not be loaded.")
      } catch {
        if (!cancelled) setError("Could not load your dashboard.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const base = analytics?.base_currency || ""
  const by = (s) => claims.filter(c => normalizeStatus(c.status) === s)

  const drafts = by("Draft")
  const flagged = by("Flagged")
  const rejected = by("Rejected")
  const approved = by("Approved")

  // Money the company owes you: approved, not yet marked paid. This is the
  // number people actually open an expense tool to see, and nothing in the
  // old dashboard showed it.
  const owed = approved
    .filter(c => String(c.reimbursement_status || "Not started") !== "Paid")
    .reduce((sum, c) => sum + Number(c.total_amount || 0), 0)
  const paidCount = approved.filter(c => c.reimbursement_status === "Paid").length

  // Anything the employee must personally act on. Ordered by how stuck it is.
  const todo = [
    unfiled > 0 && {
      key: "unfiled", tone: "info", Icon: Receipt,
      text: `${unfiled} ${unfiled === 1 ? "expense is" : "expenses are"} not attached to a claim`,
      action: "File them", page: "expenses",
    },
    drafts.length > 0 && {
      key: "draft", tone: "warn", Icon: Clock,
      text: `${drafts.length} ${drafts.length === 1 ? "claim has" : "claims have"} never been submitted`,
      action: "Review drafts", page: "claims",
    },
    (flagged.length + rejected.length) > 0 && {
      key: "flagged", tone: "bad", Icon: AlertTriangle,
      text: `${flagged.length + rejected.length} ${flagged.length + rejected.length === 1 ? "claim needs" : "claims need"} attention after a policy check`,
      action: "See why", page: "claims",
    },
  ].filter(Boolean)

  const recent = [...claims].sort((a, b) =>
    String(b.submitted_at || b.created_at || "").localeCompare(
      String(a.submitted_at || a.created_at || ""))).slice(0, 6)

  const openClaim = (claim) => { setCurrent?.(claim); setPage?.("claimDetail") }

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title={`${getISTGreeting()}, ${profile?.full_name?.split(" ")[0] || "there"}`}
        subtitle="Everything waiting on you, and where your money is."
        actions={
          <>
            <Button variant="primary" onClick={() => setPage?.("submitExpense")}>
              <ScanLine size={14} strokeWidth={2} /> Scan receipt
            </Button>
            <Button onClick={() => setPage?.("mileage")}>
              <Car size={14} strokeWidth={1.9} /> Mileage
            </Button>
            <Button onClick={() => setPage?.("claims")}>
              <ClipboardList size={14} strokeWidth={1.9} /> New claim
            </Button>
          </>
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}

      {/* ── needs you ── */}
      {!loading && (
        todo.length > 0 ? (
          <Card title="Needs your attention" pad={false} style={{ marginBottom: S.lg }}>
            {todo.map(({ key, tone, Icon, text, action, page }, i) => (
              <button
                key={key}
                onClick={() => setPage?.(page)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: S.md,
                  padding: `${S.md}px ${S.lg}px`, background: "transparent",
                  border: "none", borderTop: i ? `1px solid ${THEME.border}` : "none",
                  cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  transition: "background .12s ease",
                }}
                onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <Icon size={16} strokeWidth={1.9}
                      color={tone === "bad" ? THEME.red : tone === "warn" ? THEME.amber : THEME.blue}
                      style={{ flexShrink: 0 }} />
                <span style={{ ...T.body, color: THEME.textPrimary, flex: 1 }}>{text}</span>
                <span style={{ ...T.small, color: THEME.accent, fontWeight: 650,
                               display: "flex", alignItems: "center", gap: 3 }}>
                  {action} <ArrowRight size={13} strokeWidth={2.2} />
                </span>
              </button>
            ))}
          </Card>
        ) : (
          <Notice tone="good">
            Nothing is waiting on you. Every expense is filed and every claim is submitted.
          </Notice>
        )
      )}

      {/* ── money ── */}
      <StatRow>
        <Stat label="Awaiting reimbursement"
              value={loading ? "—" : money(owed, base)}
              hint={`${approved.length - paidCount} approved claim${approved.length - paidCount === 1 ? "" : "s"} unpaid`}
              tone={owed > 0 ? THEME.accent : undefined} />
        <Stat label="In review"
              value={loading ? "—" : by("Pending Approval").length + drafts.length}
              hint="Submitted or still a draft"
              onClick={() => setPage?.("claims")} />
        <Stat label="Unfiled expenses" value={loading ? "—" : unfiled}
              hint="Not on any claim"
              tone={unfiled > 0 ? THEME.blue : undefined}
              onClick={() => setPage?.("expenses")} />
        <Stat label="Compliance rate"
              value={loading || !analytics ? "—" : `${analytics.compliance_rate}%`}
              hint="Approved on first audit"
              tone={analytics && analytics.compliance_rate < 70 ? THEME.amber : THEME.green}
              onClick={() => setPage?.("analytics")} />
      </StatRow>

      <div style={{ display: "grid", gap: S.lg,
                    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        {/* ── recent claims ── */}
        <Card title="Recent claims" pad={false}
              action={<Button variant="ghost" onClick={() => setPage?.("claims")}>View all</Button>}>
          {loading ? <EmptyState title="Loading your claims…" />
            : !recent.length ? (
              <EmptyState
                icon={<ClipboardList size={24} strokeWidth={1.4} color={THEME.textMuted} />}
                title="No claims yet"
                hint="Scan a receipt or log a journey, then group them into a claim to submit."
              />
            ) : (
              <TableWrap>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <Th>Claim</Th><Th>Status</Th>
                      <Th align="right">Total{base ? ` (${base})` : ""}</Th>
                      <Th>Filed</Th><Th />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(c => (
                      <tr key={c.id}
                          onClick={() => openClaim(c)}
                          style={{ cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {getClaimDisplayName(c)}
                        </Td>
                        <Td><StatusBadge status={c.status} /></Td>
                        <Td align="right" mono>{money(c.total_amount)}</Td>
                        <Td>{formatClaimDate(c)}</Td>
                        <Td align="right">
                          <ChevronRight size={14} strokeWidth={2} color={THEME.textMuted} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        </Card>

        {/* ── reimbursement ── */}
        <Card title="Reimbursement">
          {loading ? <EmptyState title="Loading…" /> : (
            <>
              <div style={{ marginBottom: S.lg }}>
                <div style={{ ...T.micro, color: THEME.textMuted, marginBottom: 4 }}>
                  Owed to you
                </div>
                <div style={{ ...T.figure, color: owed > 0 ? THEME.accent : THEME.textMuted }}>
                  {money(owed, base)}
                </div>
              </div>

              {/* Approved is not the same as paid, and the gap between them is
                  the question this tool gets asked most. */}
              <Track label="Approved, awaiting payment" Icon={Clock}
                     count={approved.length - paidCount} tone={THEME.blue} />
              <Track label="Scheduled for payment" Icon={Wallet}
                     count={approved.filter(c => c.reimbursement_status === "Scheduled").length}
                     tone={THEME.amber} />
              <Track label="Paid" Icon={CheckCircle2} count={paidCount} tone={THEME.green} last />

              <div style={{ ...T.small, color: THEME.textMuted, marginTop: S.md,
                            lineHeight: 1.6, paddingTop: S.md,
                            borderTop: `1px dashed ${THEME.border}` }}>
                Payment status is set by your finance team once a claim is approved.
                Approved does not mean paid.
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

const Track = ({ label, Icon, count, tone, last }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: S.sm,
    padding: `${S.sm}px 0`,
    borderBottom: last ? "none" : `1px solid ${THEME.border}`,
  }}>
    <Icon size={15} strokeWidth={1.85} color={tone} style={{ flexShrink: 0 }} />
    <span style={{ ...T.body, color: THEME.textSecond, flex: 1 }}>{label}</span>
    <span style={{ ...T.body, fontWeight: 700, color: THEME.textPrimary,
                   fontVariantNumeric: "tabular-nums" }}>{count}</span>
  </div>
)
