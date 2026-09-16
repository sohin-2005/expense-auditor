import { useState, useEffect } from "react"
import axios from "axios"
import {
  Users, RefreshCw, ArrowRight, CheckCircle2, AlertTriangle, UserCog,
  ShieldAlert, UserX, Clock, Settings2, Activity,
} from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, RoleBadge, Notice,
} from "../components/ui"

// An administrator's dashboard, not the finance one relabelled. Finance asks
// "what is waiting on my decision"; this asks "is this organisation healthy".
// Money appears as volume only — an admin cannot approve or reject, so giving
// them a spend chart to stare at would be decoration with a 403 behind it.
export default function AdminDashboard({ profile, setPage, isMobile = false }) {
  const [data, setData] = useState(null)
  const [system, setSystem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true); setError("")
    try {
      const headers = { Authorization: `Bearer ${await getToken()}` }
      const [o, s] = await Promise.allSettled([
        axios.get(`${API}/admin/overview`, { headers, timeout: API_TIMEOUT_MS }),
        axios.get(`${API}/admin/system`, { headers, timeout: API_TIMEOUT_MS }),
      ])
      if (o.status === "fulfilled") setData(o.value.data)
      else setError(o.reason?.response?.data?.detail || "Could not load the overview.")
      if (s.status === "fulfilled") setSystem(s.value.data)
    } catch {
      setError("Could not load the admin dashboard.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const p = data?.people
  const c = data?.claims
  const e = data?.expenses
  const base = data?.base_currency || ""
  const failing = (system?.checks || []).filter(x => !x.ok)

  return (
    <div style={{ padding: isMobile ? `${S.lg}px ${S.md}px` : `${S.xl}px ${S.xl}px`,
                  maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Administration"
        subtitle={`Health of ${data?.company_id || "your organisation"} — who is here, what is stuck, and whether the deployment is working.`}
        actions={
          <>
            <Button variant="primary" onClick={() => setPage?.("people")}>
              <UserCog size={14} strokeWidth={2} /> Manage people
            </Button>
            <Button onClick={() => setPage?.("system")}>
              <Settings2 size={14} strokeWidth={1.9} /> System
            </Button>
            <Button onClick={load} disabled={loading}>
              <RefreshCw size={14} strokeWidth={1.9} /> Refresh
            </Button>
          </>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}

      {/* The states that quietly break an organisation, each an admin's to fix. */}
      {!loading && p?.approvers === 0 && (
        <Notice tone="bad">
          <strong>Nobody can approve claims.</strong> Every submitted claim will sit
          unread until someone holds the manager or finance role.{" "}
          <Link onClick={() => setPage?.("people")}>Assign one now</Link>
        </Notice>
      )}
      {!loading && p?.administrators === 1 && (
        <Notice tone="warn">
          You are the only administrator. If you lose access, roles can only be changed
          directly in the database.
        </Notice>
      )}
      {!loading && c?.stalled > 0 && (
        <Notice tone="warn">
          <strong>{c.stalled}</strong> {c.stalled === 1 ? "claim has" : "claims have"} been
          waiting more than {c.stalled_days} days for a decision. Approving is not yours
          to do — but finding out why nobody is, is.
        </Notice>
      )}

      {/* ── people ── */}
      <SectionTitle Icon={Users} label="People" />
      <StatRow>
        <Stat label="Total users" value={p?.total ?? "—"} hint="In this organisation"
              onClick={() => setPage?.("people")} />
        <Stat label="Active (30 days)" value={p?.active_30d ?? "—"}
              hint={`${p?.dormant_count ?? 0} dormant`}
              tone={p?.dormant_count ? THEME.amber : THEME.green} />
        <Stat label="Approvers" value={p?.approvers ?? "—"} hint="Manager or finance"
              tone={p?.approvers ? undefined : THEME.red} />
        <Stat label="Cannot self-recover" value={p?.without_recovery_count ?? "—"}
              hint="No security question"
              tone={p?.without_recovery_count ? THEME.amber : THEME.green} />
      </StatRow>

      {/* ── workload ── */}
      <SectionTitle Icon={Activity} label="Workload" />
      <StatRow>
        <Stat label="Claims filed" value={c?.total ?? "—"} hint="All time" />
        <Stat label="Awaiting decision" value={c?.awaiting_decision ?? "—"}
              hint={c?.stalled ? `${c.stalled} over ${c.stalled_days} days` : "Moving normally"}
              tone={c?.stalled ? THEME.amber : undefined} />
        <Stat label="Approved, unpaid" value={c?.approved_unpaid ?? "—"}
              hint={c ? money(c.approved_unpaid_value, base) : ""} />
        <Stat label="Expense volume" value={e ? money(e.volume, base) : "—"}
              hint={`${e?.total ?? 0} expenses`} />
      </StatRow>

      <div style={{ display: "grid", gap: S.lg, marginBottom: S.lg,
                    gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)" }}>
        {/* ── roles ── */}
        <Card title="Role assignment" pad={false}
              action={<Button variant="ghost" onClick={() => setPage?.("people")}>
                Manage <ArrowRight size={12} strokeWidth={2.2} />
              </Button>}>
          {loading ? <EmptyState title="Loading…" /> : (
            <div style={{ padding: `${S.sm}px 0` }}>
              {["admin", "finance", "manager", "employee"].map(role => {
                const n = p?.by_role?.[role] || 0
                const share = p?.total ? (n / p.total) * 100 : 0
                return (
                  <div key={role} style={{ padding: `${S.sm}px ${S.lg}px` }}>
                    <div style={{ display: "flex", alignItems: "center",
                                  justifyContent: "space-between", gap: S.sm, marginBottom: 5 }}>
                      <RoleBadge role={role} />
                      <span style={{ ...T.body, fontWeight: 700, color: THEME.textPrimary,
                                     fontVariantNumeric: "tabular-nums" }}>
                        {n}
                        {n === 0 && role !== "employee" && (
                          <span style={{ ...T.micro, color: THEME.amber, marginLeft: 6 }}>
                            none
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 5, background: THEME.surfaceAlt,
                                  borderRadius: R.pill, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(share ? 2 : 0, share)}%`, height: "100%",
                                    background: THEME.accent, borderRadius: R.pill,
                                    transition: "width .4s ease" }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* ── deployment ── */}
        <Card title="Deployment" pad={false}
              action={<Button variant="ghost" onClick={() => setPage?.("system")}>
                Details <ArrowRight size={12} strokeWidth={2.2} />
              </Button>}>
          {loading || !system ? <EmptyState title="Checking…" /> : (
            <div>
              {(system.checks || []).map((chk, i) => (
                <div key={chk.name} style={{
                  display: "flex", alignItems: "flex-start", gap: S.sm,
                  padding: `${S.sm}px ${S.lg}px`,
                  borderTop: i ? `1px solid ${THEME.border}` : "none",
                }}>
                  {chk.ok
                    ? <CheckCircle2 size={14} strokeWidth={2} color={THEME.green}
                                    style={{ marginTop: 2, flexShrink: 0 }} />
                    : <AlertTriangle size={14} strokeWidth={2} color={THEME.amber}
                                     style={{ marginTop: 2, flexShrink: 0 }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...T.body, fontWeight: 600, color: THEME.textPrimary }}>
                      {chk.name}
                    </div>
                    <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                                  wordBreak: "break-word" }}>{chk.detail}</div>
                  </div>
                </div>
              ))}
              {failing.length === 0 && (
                <div style={{ ...T.small, color: THEME.green, padding: `${S.sm}px ${S.lg}px ${S.md}px` }}>
                  Everything configured is actually running.
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── people needing attention ── */}
      <div style={{ display: "grid", gap: S.lg,
                    gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)" }}>
        <Card title={`Dormant · no activity in 30 days`} pad={false}>
          {loading ? <EmptyState title="Loading…" />
            : !p?.dormant?.length ? (
              <EmptyState icon={<CheckCircle2 size={22} strokeWidth={1.4} color={THEME.green} />}
                          title="Everyone is active" />
            ) : (
              <TableWrap>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }}>
                  <thead><tr><Th>Person</Th><Th>Role</Th><Th>Last seen</Th></tr></thead>
                  <tbody>
                    {p.dormant.map(u => (
                      <tr key={u.id}>
                        <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                          {u.full_name || "—"}
                        </Td>
                        <Td><RoleBadge role={u.role} /></Td>
                        <Td style={{ color: THEME.textMuted }}>
                          {u.last_active ? String(u.last_active).slice(0, 10) : "Never"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                        padding: `${S.sm}px ${S.lg}px ${S.md}px`, display: "flex",
                        gap: 6, alignItems: "flex-start" }}>
            <Clock size={12} strokeWidth={1.9} style={{ marginTop: 2, flexShrink: 0 }} />
            Measured from their own claims and expenses, not from sign-ins — a dormant
            account is one nobody is filing with.
          </div>
        </Card>

        <Card title="Cannot recover their own account" pad={false}>
          {loading ? <EmptyState title="Loading…" />
            : !p?.without_recovery?.length ? (
              <EmptyState icon={<CheckCircle2 size={22} strokeWidth={1.4} color={THEME.green} />}
                          title="Everyone has a security question" />
            ) : (
              <div style={{ padding: `${S.sm}px 0` }}>
                {p.without_recovery.map(u => (
                  <div key={u.id} style={{
                    display: "flex", alignItems: "center", gap: S.sm,
                    padding: `${S.xs}px ${S.lg}px`, ...T.body, color: THEME.textPrimary,
                  }}>
                    <UserX size={13} strokeWidth={1.9} color={THEME.amber} />
                    {u.full_name || "—"}
                  </div>
                ))}
              </div>
            )}
          <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted,
                        padding: `${S.sm}px ${S.lg}px ${S.md}px`, display: "flex",
                        gap: 6, alignItems: "flex-start" }}>
            <ShieldAlert size={12} strokeWidth={1.9} style={{ marginTop: 2, flexShrink: 0 }} />
            If these people forget their password, only you can help — there is no
            security question for them to answer.
          </div>
        </Card>
      </div>

      {/* ── data quality ── */}
      {!loading && e && (e.unconverted > 0 || e.missing_receipts > 0 || e.unverified_citations > 0) && (
        <div style={{ marginTop: S.lg }}>
          <Card title="Data quality">
            <div style={{ display: "grid", gap: S.md,
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {e.unconverted > 0 && (
                <Quality tone={THEME.amber} n={e.unconverted}
                         label="expenses with no exchange rate"
                         detail={`${e.unconverted_currencies.join(", ")} — excluded from every total, not counted at 1:1.`} />
              )}
              {e.missing_receipts > 0 && (
                <Quality tone={THEME.amber} n={e.missing_receipts}
                         label="declared missing receipts"
                         detail="Employees recorded why. Finance reviews these." />
              )}
              {e.unverified_citations > 0 && (
                <Quality tone={THEME.red} n={e.unverified_citations}
                         label="verdicts without a verified citation"
                         detail="The audit could not ground its decision in a real policy passage." />
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

const SectionTitle = ({ Icon, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: S.sm, margin: `${S.lg}px 0 ${S.sm}px` }}>
    <Icon size={14} strokeWidth={2} color={THEME.textMuted} />
    <span style={{ ...T.micro, color: THEME.textMuted }}>{label}</span>
    <span style={{ flex: 1, height: 1, background: THEME.border }} />
  </div>
)

const Quality = ({ tone, n, label, detail }) => (
  <div>
    <div style={{ ...T.figure, fontSize: 22, color: tone }}>{n}</div>
    <div style={{ ...T.body, fontWeight: 600, color: THEME.textPrimary }}>{label}</div>
    <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, lineHeight: 1.55 }}>
      {detail}
    </div>
  </div>
)

const Link = ({ onClick, children }) => (
  <button onClick={onClick} style={{
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: THEME.accent, fontWeight: 700, fontSize: "inherit", fontFamily: "inherit",
    textDecoration: "underline", textUnderlineOffset: 2,
  }}>{children}</button>
)
