import { useState, useEffect } from "react"
import axios from "axios"
import {
  RefreshCw, AlertTriangle, FileText, Plus, ShieldCheck, Coins,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, Notice, Input,
} from "../components/ui"

export default function FinanceDashboard({ profile, capabilities = {}, setPage }) {
  const [data, setData] = useState(null)
  const [rates, setRates] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [flash, setFlash] = useState("")

  const [newCode, setNewCode] = useState("")
  const [newRate, setNewRate] = useState("")
  const [savingRate, setSavingRate] = useState(false)

  const canEditRates = Boolean(capabilities.manage_rates)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const token = await getToken()
      const headers = { Authorization: `Bearer ${token}` }
      const [overview, fx] = await Promise.allSettled([
        axios.get(`${API}/finance/overview`, { headers, timeout: API_TIMEOUT_MS }),
        canEditRates
          ? axios.get(`${API}/admin/fx-rates`, { headers, timeout: API_TIMEOUT_MS })
          : Promise.resolve({ data: null }),
      ])
      if (overview.status === "fulfilled") setData(overview.value.data)
      else setError(overview.reason?.response?.data?.detail || "Could not load the finance overview.")
      if (fx.status === "fulfilled" && fx.value.data) setRates(fx.value.data)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load the finance overview.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const addRate = async () => {
    const code = newCode.trim().toUpperCase()
    const rate = parseFloat(newRate)
    if (!code) { setError("Enter a currency code."); return }
    if (!(rate > 0)) { setError("Enter a rate greater than zero."); return }
    setSavingRate(true); setError(""); setFlash("")
    try {
      const token = await getToken()
      await axios.post(`${API}/admin/fx-rates`,
        { currency: code, rate_to_base: rate },
        { headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS })
      setFlash(`Rate saved. ${code} expenses will convert from now on.`)
      setNewCode(""); setNewRate("")
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || "Could not save that rate.")
    }
    setSavingRate(false)
  }

  const base = data?.base_currency || ""

  return (
    <div style={{ padding: `${S.xl}px ${S.xl}px`, maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Finance Desk"
        subtitle="What is waiting on a decision, and what is quietly wrong. Spend breakdowns live under My Spend — this page is the work queue."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={1.9} /> Refresh
          </Button>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}
      {flash && <Notice tone="good">{flash}</Notice>}

      {data?.retrieval_mode === "shadow" && (
        <Notice tone="info">
          Policy retrieval is in <strong>shadow</strong> mode, so verdicts are still
          decided by keyword matching and citations are not enforced. Ask your
          administrator to switch it to <code>vector</code> once the comparison logs look right.
        </Notice>
      )}

      {data?.unconverted?.count > 0 && (
        <Notice tone="warn">
          <strong>{data.unconverted.count}</strong>{" "}
          {data.unconverted.count === 1 ? "expense is" : "expenses are"} missing from
          every total — no exchange rate on file for{" "}
          {data.unconverted.currencies.join(", ")}.
          {canEditRates && " Add one below and they will be included."}
        </Notice>
      )}

      <StatRow>
        <Stat label="Awaiting decision" value={data?.awaiting_decision ?? "—"}
              hint="Submitted claims"
              tone={data?.awaiting_decision ? THEME.blue : undefined}
              onClick={() => setPage?.("approvals")} />
        <Stat label="Value in queue"
              value={data ? money(data.awaiting_value, base) : "—"}
              hint="Not yet approved" />
        <Stat label="Flagged claims" value={data?.flagged_claims ?? "—"}
              hint="Need policy review"
              tone={data?.flagged_claims ? THEME.amber : undefined} />
        <Stat label="Unverified citations" value={data?.unverified_citations ?? "—"}
              hint="Verdict could not be grounded"
              tone={data?.unverified_citations ? THEME.red : undefined} />
      </StatRow>

      <div style={{ display: "grid", gap: S.lg, gridTemplateColumns: "1fr", marginBottom: S.lg }}>
        <Card title="Approval queue" pad={false}
              action={<Button variant="ghost" onClick={() => setPage?.("approvals")}>Open approvals</Button>}>
          {loading ? <EmptyState title="Loading…" />
            : !data?.queue?.length ? (
              <EmptyState
                icon={<ShieldCheck size={24} strokeWidth={1.4} color={THEME.green} />}
                title="Nothing waiting"
                hint="Submitted claims appear here the moment an employee files them."
              />
            ) : (
              <TableWrap>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead>
                    <tr>
                      <Th>Claim</Th><Th>Employee</Th>
                      <Th align="right">Total ({base})</Th><Th>Submitted</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queue.map(c => (
                      <tr key={c.id}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {c.report_name || "Untitled claim"}
                        </Td>
                        <Td>{c.employee_name || "—"}</Td>
                        <Td align="right" mono>{money(c.total_amount)}</Td>
                        <Td>{(c.submitted_at || c.created_at || "").slice(0, 10) || "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        </Card>

        <Card title="Flagged for review" pad={false}>
          {loading ? <EmptyState title="Loading…" />
            : !data?.flagged?.length ? (
              <EmptyState
                icon={<ShieldCheck size={24} strokeWidth={1.4} color={THEME.green} />}
                title="Nothing flagged"
                hint="Claims whose expenses breached policy would show here."
              />
            ) : (
              <TableWrap>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead>
                    <tr>
                      <Th>Claim</Th><Th>Employee</Th>
                      <Th align="right">Total ({base})</Th><Th>Raised</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flagged.map(c => (
                      <tr key={c.id}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          <AlertTriangle size={12} strokeWidth={2} color={THEME.amber}
                                         style={{ verticalAlign: -1, marginRight: 5 }} />
                          {c.report_name || "Untitled claim"}
                        </Td>
                        <Td>{c.employee_name || "—"}</Td>
                        <Td align="right" mono>{money(c.total_amount)}</Td>
                        <Td>{(c.created_at || "").slice(0, 10) || "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
        </Card>
      </div>

      <div style={{ display: "grid", gap: S.lg,
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Card title="Active policy">
          {data?.policy ? (
            <>
              <div style={{ display: "flex", gap: S.sm, alignItems: "center", marginBottom: S.sm }}>
                <FileText size={18} strokeWidth={1.6} color={THEME.accent} />
                <div>
                  <div style={{ ...T.body, fontWeight: 650, color: THEME.textPrimary }}>
                    {data.policy.file_name || "Policy.pdf"}
                  </div>
                  <div style={{ ...T.small, color: THEME.textMuted }}>
                    Version {data.policy.version ?? 1} · uploaded{" "}
                    {(data.policy.uploaded_at || "").slice(0, 10) || "—"}
                  </div>
                </div>
              </div>
              <div style={{ ...T.small, color: THEME.textSecond, lineHeight: 1.6 }}>
                Verdicts cite the version in force when they were made, so replacing
                this policy will not restate decisions already taken against the old one.
              </div>
              <div style={{ marginTop: S.md }}>
                <Button onClick={() => setPage?.("policy")}>Manage policy</Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No policy uploaded"
              hint="Until one exists, expenses are audited against generic business rules."
            />
          )}
        </Card>

        {canEditRates && (
          <Card title={`Exchange rates → ${base}`}>
            <div style={{ ...T.small, color: THEME.textSecond, marginBottom: S.md, lineHeight: 1.6 }}>
              An expense in a currency with no rate is excluded from every total
              rather than added at 1:1. Nothing here is guessed.
            </div>

            {rates?.missing?.length > 0 && (
              <div style={{ marginBottom: S.md }}>
                {rates.missing.map(m => (
                  <div key={m.currency} style={{
                    display: "flex", justifyContent: "space-between", gap: S.sm,
                    ...T.small, padding: "5px 0", color: THEME.amber, fontWeight: 600,
                  }}>
                    <span>{m.currency} — no rate</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {m.count} {m.count === 1 ? "expense" : "expenses"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {rates?.rates?.length > 0 && (
              <div style={{ marginBottom: S.md }}>
                {rates.rates.map(r => (
                  <div key={r.currency} style={{
                    display: "flex", justifyContent: "space-between", gap: S.sm,
                    ...T.small, padding: "5px 0", color: THEME.textSecond,
                    borderBottom: `1px solid ${THEME.border}`,
                  }}>
                    <span style={{ fontWeight: 600, color: THEME.textPrimary }}>
                      1 {r.currency}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.rate_to_base} {base}
                      <span style={{ color: THEME.textMuted, marginLeft: 6 }}>
                        {String(r.rate_date || "").slice(0, 10)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: S.sm, alignItems: "flex-end" }}>
              <div style={{ width: 96 }}>
                <Input label="Currency" value={newCode} placeholder="INR"
                       onChange={e => setNewCode(e.target.value.toUpperCase())} />
              </div>
              <div style={{ flex: 1, minWidth: 96 }}>
                <Input label={`Rate → ${base}`} value={newRate} placeholder="0.0120"
                       inputMode="decimal"
                       onChange={e => setNewRate(e.target.value)} />
              </div>
              <Button variant="primary" onClick={addRate} disabled={savingRate}
                      style={{ marginBottom: 14 }}>
                <Plus size={14} strokeWidth={2.2} /> {savingRate ? "Saving…" : "Add"}
              </Button>
            </div>
            <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, display: "flex",
                          gap: 6, alignItems: "flex-start" }}>
              <Coins size={12} strokeWidth={1.8} style={{ marginTop: 2, flexShrink: 0 }} />
              Rates are dated. Adding one today does not restate expenses that already
              converted at an older rate.
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
