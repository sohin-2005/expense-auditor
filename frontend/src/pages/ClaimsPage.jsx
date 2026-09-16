import { useState, useEffect } from "react"
import axios from "axios"
import {
  ClipboardList, Plus, RefreshCw, ChevronRight, Clock, CheckCircle2,
  AlertTriangle, Wallet,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { formatClaimDate, getClaimDisplayName, normalizeStatus } from "../lib/format"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, StatusBadge, Notice,
} from "../components/ui"
import CreateClaimModal from "./CreateClaimModal"

// Filters mirror the lifecycle rather than the database: someone looking at
// this page is asking "what have I not sent yet" or "what am I still owed",
// not "show me rows where status equals a string".
const FILTERS = [
  { id: "all", label: "All" },
  { id: "Draft", label: "Drafts", hint: "Not submitted" },
  { id: "Pending Approval", label: "Awaiting decision" },
  { id: "Approved", label: "Approved" },
  { id: "Flagged", label: "Needs attention" },
  { id: "Rejected", label: "Rejected" },
]

export default function ClaimsPage({ profile, setPage, setCurrent, isMobile = false }) {
  const [claims, setClaims] = useState([])
  const [unfiled, setUnfiled] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const headers = { Authorization: `Bearer ${await getToken()}` }
      const [c, e] = await Promise.allSettled([
        axios.get(`${API}/claims/my?limit=120&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
        axios.get(`${API}/expenses/available?limit=200&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
      ])
      if (c.status === "fulfilled") setClaims(c.value.data?.claims || [])
      else setError("Could not load your claims.")
      if (e.status === "fulfilled") {
        const d = e.value.data
        setUnfiled(d?.paging?.total_count ?? (d?.expenses?.length || 0))
      }
    } catch {
      setError("Could not load your claims.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const onCreated = (claim) => {
    setCreating(false)
    setCurrent?.(claim)
    setPage?.("claimDetail")
  }

  const open = (claim) => { setCurrent?.(claim); setPage?.("claimDetail") }

  const by = (s) => claims.filter(c => normalizeStatus(c.status) === s)
  const drafts = by("Draft")
  const pending = by("Pending Approval")
  const approved = by("Approved")
  const attention = [...by("Flagged"), ...by("Rejected")]

  const owed = approved
    .filter(c => String(c.reimbursement_status || "Not started") !== "Paid")
    .reduce((s, c) => s + Number(c.total_amount || 0), 0)

  const visible = filter === "all"
    ? claims
    : claims.filter(c => normalizeStatus(c.status) === filter)

  const sorted = [...visible].sort((a, b) =>
    String(b.submitted_at || b.created_at || "").localeCompare(
      String(a.submitted_at || a.created_at || "")))

  const countFor = (id) => id === "all" ? claims.length : by(id).length

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Expense Claims"
        subtitle="Group your expenses into a claim, then submit it for approval."
        actions={
          <>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} strokeWidth={2.2} /> New claim
            </Button>
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={14} strokeWidth={1.9} /> Refresh
            </Button>
          </>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}

      {unfiled > 0 && (
        <Notice tone="info">
          <strong>{unfiled}</strong> {unfiled === 1 ? "expense is" : "expenses are"} not
          attached to any claim, so {unfiled === 1 ? "it is" : "they are"} not being
          reimbursed.{" "}
          <button onClick={() => setPage?.("expenses")} style={linkBtn}>File them</button>
        </Notice>
      )}

      <StatRow>
        <Stat label="Awaiting reimbursement" value={loading ? "—" : money(owed)}
              hint="Approved but unpaid"
              tone={owed > 0 ? THEME.accent : undefined} />
        <Stat label="Awaiting decision" value={loading ? "—" : pending.length}
              hint="With an approver"
              tone={pending.length ? THEME.blue : undefined} />
        <Stat label="Drafts" value={loading ? "—" : drafts.length}
              hint="Never submitted"
              tone={drafts.length ? THEME.amber : undefined} />
        <Stat label="Needs attention" value={loading ? "—" : attention.length}
              hint="Flagged or rejected"
              tone={attention.length ? THEME.red : undefined} />
      </StatRow>

      <Card
        title="Your claims"
        pad={false}
        action={
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {FILTERS.map(f => {
              const active = filter === f.id
              const n = countFor(f.id)
              return (
                <button key={f.id} onClick={() => setFilter(f.id)} title={f.hint}
                  style={{
                    padding: "5px 10px", fontSize: 12, fontWeight: active ? 700 : 500,
                    fontFamily: "inherit", borderRadius: R.pill, cursor: "pointer",
                    border: `1px solid ${active ? "transparent" : THEME.border}`,
                    background: active ? THEME.accentDim : "transparent",
                    color: active ? THEME.accent : THEME.textSecond,
                  }}>
                  {f.label}{n > 0 && <span style={{ opacity: 0.65 }}> {n}</span>}
                </button>
              )
            })}
          </div>
        }>
        {loading ? <EmptyState title="Loading your claims…" />
          : !claims.length ? (
            <EmptyState
              icon={<ClipboardList size={26} strokeWidth={1.4} color={THEME.textMuted} />}
              title="No claims yet"
              hint="Scan a receipt or log a journey first, then group them into a claim to submit."
            />
          ) : !sorted.length ? (
            <EmptyState title={`No ${FILTERS.find(f => f.id === filter)?.label.toLowerCase()} claims`}
                        hint="Try a different filter." />
          ) : (
            <TableWrap>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                <thead>
                  <tr>
                    <Th>Claim</Th><Th>Status</Th><Th>Payment</Th>
                    <Th align="right">Total</Th><Th>Filed</Th><Th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(c => {
                    const status = normalizeStatus(c.status)
                    return (
                      <tr key={c.id} onClick={() => open(c)} style={{ cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceAlt}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {getClaimDisplayName(c)}
                          {c.entity && (
                            <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted }}>
                              {c.entity}
                            </div>
                          )}
                        </Td>
                        <Td><StatusBadge status={c.status} /></Td>
                        <Td>
                          {status === "Approved"
                            ? <Payment state={c.reimbursement_status} />
                            : <span style={{ ...T.small, color: THEME.textMuted }}>—</span>}
                        </Td>
                        <Td align="right" mono>{money(c.total_amount)}</Td>
                        <Td>{formatClaimDate(c)}</Td>
                        <Td align="right">
                          <ChevronRight size={14} strokeWidth={2} color={THEME.textMuted} />
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>

      {creating && (
        <CreateClaimModal
          profile={profile}
          isMobile={isMobile}
          onClose={() => setCreating(false)}
          onCreate={onCreated}
        />
      )}
    </div>
  )
}

// Approved is not paid, and the difference is the thing people actually
// want from this column.
const Payment = ({ state }) => {
  const s = String(state || "Not started")
  const map = {
    "Paid": { Icon: CheckCircle2, tone: THEME.green, label: "Paid" },
    "Scheduled": { Icon: Wallet, tone: THEME.amber, label: "Scheduled" },
    "Not started": { Icon: Clock, tone: THEME.textMuted, label: "Awaiting payment" },
  }
  const { Icon, tone, label } = map[s] || map["Not started"]
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5,
                   ...T.small, color: tone }}>
      <Icon size={12} strokeWidth={2} /> {label}
    </span>
  )
}

const linkBtn = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: THEME.accent, fontWeight: 700, fontSize: "inherit", fontFamily: "inherit",
  textDecoration: "underline", textUnderlineOffset: 2,
}
