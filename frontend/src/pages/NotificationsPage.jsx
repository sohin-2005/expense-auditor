import { useState, useEffect, useRef } from "react"
import axios from "axios"
import {
  Bell, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock,
  Wallet, Receipt, ChevronRight,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { getClaimDisplayName, normalizeStatus } from "../lib/format"
import {
  Card, PageHeader, Button, EmptyState, Notice, StatusBadge,
} from "../components/ui"

// An activity feed, not a notification store. There is no notifications table
// and inventing one would mean a write on every status change; the same facts
// are already on the claims and expenses rows, so the feed is derived from
// them. The honest consequence is that "unread" means "changed since you last
// opened this page in this session", and the page says so rather than
// implying a persistent read state it does not have.
const TONE = {
  Approved: { Icon: CheckCircle2, color: THEME.green, verb: "approved" },
  Rejected: { Icon: XCircle, color: THEME.red, verb: "rejected" },
  Flagged: { Icon: AlertTriangle, color: THEME.amber, verb: "flagged for review" },
  "Pending Approval": { Icon: Clock, color: THEME.blue, verb: "sent for approval" },
  Draft: { Icon: Receipt, color: THEME.textMuted, verb: "saved as a draft" },
}

const PAYMENT_TONE = {
  Paid: { Icon: Wallet, color: THEME.green, verb: "paid out" },
  Scheduled: { Icon: Wallet, color: THEME.amber, verb: "scheduled for payment" },
}

export default function NotificationsPage({ setPage, setCurrent, isMobile = false }) {
  const [claims, setClaims] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [changed, setChanged] = useState([])
  const [lastChecked, setLastChecked] = useState(null)
  const seenRef = useRef(null)

  const load = async () => {
    setError("")
    try {
      const headers = { Authorization: `Bearer ${await getToken()}` }
      const [c, e] = await Promise.allSettled([
        axios.get(`${API}/claims/my?limit=100&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
        axios.get(`${API}/expenses?limit=100&offset=0`, { headers, timeout: API_TIMEOUT_MS }),
      ])
      const nextClaims = c.status === "fulfilled" ? (c.value.data?.claims || []) : []
      const nextExpenses = e.status === "fulfilled" ? (e.value.data?.expenses || []) : []

      // Diff against what this session last saw, so a change that happened
      // while you were elsewhere is marked rather than lost in the list.
      if (seenRef.current) {
        const before = seenRef.current
        const moved = []
        for (const cl of nextClaims) {
          const was = before.claims[cl.id]
          if (was && was !== `${cl.status}|${cl.reimbursement_status}`) moved.push(`claim-${cl.id}`)
        }
        for (const ex of nextExpenses) {
          const was = before.expenses[ex.id]
          if (was && was !== ex.status) moved.push(`expense-${ex.id}`)
        }
        setChanged(moved)
      }
      seenRef.current = {
        claims: Object.fromEntries(nextClaims.map(c2 => [c2.id, `${c2.status}|${c2.reimbursement_status}`])),
        expenses: Object.fromEntries(nextExpenses.map(e2 => [e2.id, e2.status])),
      }

      setClaims(nextClaims)
      setExpenses(nextExpenses)
      setLastChecked(new Date())
      if (c.status === "rejected") setError("Some updates could not be loaded.")
    } catch {
      setError("Could not load your activity.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const when = (row) =>
    row.overridden_at || row.reimbursed_at || row.submitted_at || row.created_at || ""

  const feed = [
    ...claims.map(c => {
      const status = normalizeStatus(c.status)
      const paid = PAYMENT_TONE[c.reimbursement_status]
      const tone = paid && status === "Approved" ? paid : (TONE[status] || TONE.Draft)
      return {
        key: `claim-${c.id}`,
        Icon: tone.Icon, color: tone.color,
        title: `Claim ${tone.verb}`,
        subject: getClaimDisplayName(c),
        detail: c.override_comment || c.ai_summary || "",
        amount: c.total_amount,
        status: c.status,
        ts: when(c),
        open: () => { setCurrent?.(c); setPage?.("claimDetail") },
      }
    }),
    ...expenses
      .filter(e => ["Flagged", "Rejected"].includes(normalizeStatus(e.status)))
      .map(e => {
        const tone = TONE[normalizeStatus(e.status)] || TONE.Draft
        return {
          key: `expense-${e.id}`,
          Icon: tone.Icon, color: tone.color,
          title: `Expense ${tone.verb}`,
          subject: e.vendor_name || e.merchant_name || e.expense_type || "Expense",
          detail: e.reason || "",
          amount: e.amount, currency: e.currency,
          status: e.status,
          ts: e.created_at || "",
          open: () => setPage?.("expenses"),
        }
      }),
  ].sort((a, b) => String(b.ts).localeCompare(String(a.ts)))

  const needsYou = feed.filter(f =>
    ["Flagged", "Rejected", "Draft"].includes(normalizeStatus(f.status)))

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 860, margin: "0 auto" }}>
      <PageHeader
        title="Activity"
        subtitle="Every decision made on your claims and expenses, newest first."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={1.9} /> Check for updates
          </Button>
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}

      {changed.length > 0 && (
        <Notice tone="info">
          <strong>{changed.length}</strong>{" "}
          {changed.length === 1 ? "item changed" : "items changed"} since you last checked.
        </Notice>
      )}

      {needsYou.length > 0 && (
        <Notice tone="warn">
          <strong>{needsYou.length}</strong>{" "}
          {needsYou.length === 1 ? "item needs" : "items need"} something from you —
          a draft to submit, or a flagged item to correct.
        </Notice>
      )}

      <Card title="Recent activity" pad={false}
            action={lastChecked && (
              <span style={{ ...T.small, fontSize: 11, color: THEME.textMuted }}>
                checked {lastChecked.toLocaleTimeString()}
              </span>
            )}>
        {loading ? <EmptyState title="Loading your activity…" />
          : !feed.length ? (
            <EmptyState
              icon={<Bell size={26} strokeWidth={1.4} color={THEME.textMuted} />}
              title="Nothing has happened yet"
              hint="Decisions on your claims and expenses will appear here."
            />
          ) : (
            <div>
              {feed.map((f, i) => {
                const isNew = changed.includes(f.key)
                return (
                  <button
                    key={f.key}
                    onClick={f.open}
                    style={{
                      width: "100%", display: "flex", gap: S.md, alignItems: "flex-start",
                      padding: `${S.md}px ${S.lg}px`, textAlign: "left",
                      background: isNew ? THEME.accentDim : "transparent",
                      border: "none", borderTop: i ? `1px solid ${THEME.border}` : "none",
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "background .12s ease",
                    }}
                    onMouseEnter={ev => { if (!isNew) ev.currentTarget.style.background = THEME.surfaceAlt }}
                    onMouseLeave={ev => { if (!isNew) ev.currentTarget.style.background = "transparent" }}
                  >
                    <f.Icon size={17} strokeWidth={1.9} color={f.color}
                            style={{ marginTop: 1, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: S.sm,
                                    flexWrap: "wrap" }}>
                        <span style={{ ...T.body, fontWeight: 650, color: THEME.textPrimary }}>
                          {f.title}
                        </span>
                        {isNew && (
                          <span style={{ ...T.micro, color: THEME.accent }}>new</span>
                        )}
                      </div>
                      <div style={{ ...T.body, color: THEME.textSecond,
                                    overflow: "hidden", textOverflow: "ellipsis",
                                    whiteSpace: "nowrap" }}>
                        {f.subject}
                      </div>
                      {f.detail && (
                        <div style={{ ...T.small, color: THEME.textMuted, marginTop: 3,
                                      lineHeight: 1.5 }}>
                          {f.detail}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ ...T.body, fontWeight: 700, color: THEME.textPrimary,
                                    fontVariantNumeric: "tabular-nums" }}>
                        {money(f.amount, f.currency)}
                      </div>
                      <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted }}>
                        {String(f.ts).slice(0, 10) || "—"}
                      </div>
                    </div>
                    <ChevronRight size={14} strokeWidth={2} color={THEME.textMuted}
                                  style={{ marginTop: 3, flexShrink: 0 }} />
                  </button>
                )
              })}
            </div>
          )}
      </Card>

      <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                    marginTop: S.md, lineHeight: 1.6 }}>
        This feed is built from your claims and expenses rather than stored separately,
        so “new” means changed since you last opened this page in this session.
      </div>
    </div>
  )
}
