import { useState, useEffect } from "react"
import axios from "axios"
import { Download, RefreshCw, TrendingUp } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import {
  Card, PageHeader, Stat, StatRow, Button, EmptyState, Notice, StatusBadge,
} from "../components/ui"

// One accent hue for spend, with semantic colour reserved for verdicts. A
// chart per metric in a different colour reads as decoration; the point here
// is comparison within each list, so the bars share a scale and a hue and let
// length do the work.
export default function AnalyticsPage({ profile, capabilities = {}, isMobile = false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState(false)
  const [scope, setScope] = useState("my")

  const canSeeCompany = Boolean(capabilities.view_company_analytics)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const r = await axios.get(`${API}/analytics/summary?scope=${scope}`, {
        headers: { Authorization: `Bearer ${await getToken()}` }, timeout: API_TIMEOUT_MS,
      })
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load analytics.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [scope])

  const exportCsv = async () => {
    setExporting(true); setError("")
    try {
      const r = await axios.get(`${API}/expenses/export.csv`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
        responseType: "blob", timeout: API_TIMEOUT_MS,
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

  const base = data?.base_currency || ""
  const flagged = (data?.by_status?.Flagged || 0) + (data?.by_status?.Rejected || 0)
  // The server decides scope from the caller's role and reports what it
  // actually applied, so the heading reflects the data rather than the request.
  const companyWide = data?.scope === "company"

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title={companyWide ? "Company Spend" : "My Spend"}
        subtitle={companyWide
          ? "Every expense in your company, converted to one currency."
          : "Your own expenses, converted to one currency."}
        actions={
          <>
            {canSeeCompany && (
              <select value={scope} onChange={e => setScope(e.target.value)}
                style={{
                  padding: "8px 11px", fontSize: 13, fontFamily: "inherit",
                  border: `1px solid ${THEME.border}`, borderRadius: R.sm,
                  background: THEME.surface, color: THEME.textPrimary, cursor: "pointer",
                }}>
                <option value="my">My expenses</option>
                <option value="all">Everyone</option>
              </select>
            )}
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

      {/* Expenses left out of every figure on this page. Saying so is the
          difference between an understated total and a wrong one. */}
      {data?.unconverted?.count > 0 && (
        <Notice tone="warn">
          <strong>{data.unconverted.count}</strong>{" "}
          {data.unconverted.count === 1 ? "expense is" : "expenses are"} missing from
          these totals — no exchange rate on file for{" "}
          {(data.unconverted.currencies || []).join(", ") || "their currency"}
          {data.unconverted.original_amount
            ? `, worth ${data.unconverted.original_amount.toLocaleString()} in their own currency`
            : ""}.
          {canSeeCompany && " Add a rate on the Finance Desk to include them."}
        </Notice>
      )}

      {loading && !data ? (
        <Card><EmptyState title="Loading analytics…" /></Card>
      ) : data && (
        <>
          <StatRow>
            <Stat label="Expenses" value={data.total_expenses}
                  hint={companyWide ? "Company-wide" : "Yours"} />
            <Stat label="Total spend" value={money(data.total_amount, base)}
                  hint={`Converted to ${base || "base currency"}`} />
            <Stat label="Compliance rate" value={`${data.compliance_rate}%`}
                  hint="Approved on first audit"
                  tone={data.compliance_rate >= 70 ? THEME.green : THEME.amber} />
            <Stat label="Needs attention" value={flagged}
                  hint="Flagged or rejected"
                  tone={flagged ? THEME.red : THEME.textPrimary} />
          </StatRow>

          <div style={{ display: "grid", gap: S.lg, marginBottom: S.lg,
                        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
            <Bars title="Spend by category" items={data.top_categories} base={base} />
            <Bars title="Top vendors" items={data.top_vendors} base={base} />
          </div>

          <div style={{ display: "grid", gap: S.lg,
                        gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr" }}>
            <Bars title="Monthly trend" items={data.monthly} base={base} labelKey="month" />

            <Card title="Audit outcomes">
              {["Approved", "Flagged", "Rejected"].map(status => {
                const count = data.by_status?.[status] || 0
                const amount = data.status_amounts?.[status] || 0
                const pct = data.total_expenses
                  ? Math.round(100 * count / data.total_expenses) : 0
                return (
                  <div key={status} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: S.md, padding: `${S.sm}px 0`,
                    borderBottom: status !== "Rejected" ? `1px solid ${THEME.border}` : "none",
                  }}>
                    <StatusBadge status={status} />
                    <div style={{ textAlign: "right" }}>
                      <div style={{ ...T.body, fontWeight: 700, color: THEME.textPrimary,
                                    fontVariantNumeric: "tabular-nums" }}>
                        {count} <span style={{ ...T.small, color: THEME.textMuted,
                                               fontWeight: 400 }}>· {pct}%</span>
                      </div>
                      <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                                    fontVariantNumeric: "tabular-nums" }}>
                        {money(amount, base)}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                            marginTop: S.md, lineHeight: 1.6 }}>
                Compliance rate is the share approved by the policy audit on capture,
                before any human decision.
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// Horizontal bars on one shared scale, so length is comparable down the list.
// Every label names a value the chart actually reaches.
const Bars = ({ title, items = [], base, labelKey = "name" }) => {
  const max = Math.max(...items.map(i => Number(i.amount) || 0), 1)
  return (
    <Card title={title}>
      {!items.length ? (
        <EmptyState icon={<TrendingUp size={22} strokeWidth={1.4} color={THEME.textMuted} />}
                    title="No data yet"
                    hint="Figures appear once expenses are captured." />
      ) : items.map(item => {
        const value = Number(item.amount) || 0
        const label = item[labelKey] || item.name || item.month || "—"
        return (
          <div key={label} style={{ marginBottom: S.md }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: S.sm,
                          ...T.small, marginBottom: 4 }}>
              <span style={{ color: THEME.textPrimary, overflow: "hidden",
                             textOverflow: "ellipsis", whiteSpace: "nowrap",
                             maxWidth: "62%" }}>{label}</span>
              <span style={{ color: THEME.textSecond, fontVariantNumeric: "tabular-nums" }}>
                {money(value, base)}
              </span>
            </div>
            <div style={{ height: 7, background: THEME.surfaceAlt, borderRadius: R.pill,
                          overflow: "hidden" }}>
              <div style={{
                width: `${Math.max(2, (value / max) * 100)}%`, height: "100%",
                background: THEME.accent, borderRadius: R.pill,
                transition: "width .4s cubic-bezier(.22,1,.36,1)",
              }} />
            </div>
          </div>
        )
      })}
    </Card>
  )
}
