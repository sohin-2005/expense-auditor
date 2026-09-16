import { useState, useEffect } from "react"
import axios from "axios"
import { Users, ShieldAlert, RefreshCw, ChevronRight } from "lucide-react"
import PersonDetail from "./PersonDetail"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money, roleStyle } from "../theme/tokens"
import {
  Card, PageHeader, Stat, StatRow, Button, TableWrap, Th, Td,
  EmptyState, RoleBadge, Notice,
} from "../components/ui"

// What each role can do, in the words of the person granting it. Shown next
// to the picker because "manager vs finance vs admin" is not self-evident,
// and getting it wrong is how someone ends up able to approve their own
// company's spend.
const ROLE_HELP = {
  employee: "Submits their own expenses, claims and trips. Sees only their own data.",
  manager: "Everything an employee does, plus approving other people's claims.",
  finance: "Approves claims, owns the policy and the exchange rates, sees company-wide spend.",
  admin: "Manages people, roles and system configuration. Cannot approve spend.",
}

export default function PeoplePage({ profile }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [flash, setFlash] = useState("")
  // Which person the slide-over is showing. Null = closed.
  const [openId, setOpenId] = useState(null)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
      })
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load your organisation.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const changeRole = async (userId, role) => {
    setBusy(userId); setFlash(""); setError("")
    try {
      const token = await getToken()
      await axios.post(`${API}/admin/users/${userId}/role`, { role }, {
        headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
      })
      setFlash(`Role updated to ${roleStyle(role).label}.`)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || "Could not change that role.")
    }
    setBusy("")
  }

  const byRole = data?.by_role || {}
  const approvers = (byRole.manager || 0) + (byRole.finance || 0)

  return (
    <div style={{ padding: `${S.xl}px ${S.xl}px`, maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="People"
        subtitle="Everyone in your company, and what each of them is allowed to do. Select a name to see their activity or remove them. Roles are enforced by the server — changing one here changes what that person can actually reach."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={1.9} /> Refresh
          </Button>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}
      {flash && <Notice tone="good">{flash}</Notice>}

      {approvers === 0 && !loading && (
        <Notice tone="warn">
          <strong>Nobody can approve claims.</strong> Submitted claims will sit in
          the queue until at least one person holds the manager or finance role.
        </Notice>
      )}

      <StatRow>
        <Stat label="People" value={data?.total ?? "—"} hint="In your company" />
        <Stat label="Approvers" value={approvers || 0}
              hint="Manager or finance"
              tone={approvers ? THEME.textPrimary : THEME.amber} />
        <Stat label="Administrators" value={byRole.admin || 0}
              hint="Manage people and config" />
        <Stat label="Employees" value={byRole.employee || 0} hint="Submit only" />
      </StatRow>

      <Card title="Directory" pad={false}>
        {loading ? (
          <EmptyState title="Loading your organisation…" />
        ) : !data?.users?.length ? (
          <EmptyState
            icon={<Users size={26} strokeWidth={1.4} color={THEME.textMuted} />}
            title="No one else here yet"
            hint="People appear once they sign up with your company ID."
          />
        ) : (
          <TableWrap>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Current role</Th>
                  <Th align="right">Expenses</Th>
                  <Th align="right">Flagged</Th>
                  <Th align="right">Spend ({data.base_currency})</Th>
                  <Th>Change role to</Th>
                </tr>
              </thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id}>
                    <Td style={{ color: THEME.textPrimary, fontWeight: 600 }}>
                      <button
                        onClick={() => setOpenId(u.id)}
                        style={{
                          background: "none", border: "none", padding: 0, cursor: "pointer",
                          font: "inherit", color: THEME.textPrimary, fontWeight: 600,
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                        {u.full_name || "—"}
                        <ChevronRight size={13} strokeWidth={2} color={THEME.textMuted} />
                      </button>
                      {u.is_self && (
                        <span style={{ ...T.micro, color: THEME.textMuted, marginLeft: 6 }}>you</span>
                      )}
                    </Td>
                    <Td><RoleBadge role={u.role} /></Td>
                    <Td align="right" mono>{u.expenses}</Td>
                    <Td align="right" mono style={{ color: u.flagged ? THEME.amber : THEME.textMuted }}>
                      {u.flagged}
                    </Td>
                    <Td align="right" mono>{money(u.spend)}</Td>
                    <Td>
                      {u.is_self ? (
                        <span style={{ ...T.small, color: THEME.textMuted }}>
                          Ask another admin
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          disabled={busy === u.id}
                          onChange={e => changeRole(u.id, e.target.value)}
                          style={{
                            padding: "6px 9px", fontSize: 12.5, fontFamily: "inherit",
                            border: `1px solid ${THEME.border}`, borderRadius: R.sm,
                            background: THEME.surface, color: THEME.textPrimary,
                            cursor: busy === u.id ? "wait" : "pointer",
                          }}>
                          {(data.assignable_roles || []).map(r => (
                            <option key={r} value={r}>{roleStyle(r).label}</option>
                          ))}
                        </select>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {openId && (
        <PersonDetail
          userId={openId}
          people={data?.users || []}
          onClose={() => setOpenId(null)}
          onChanged={(message) => { setFlash(message); load() }}
        />
      )}

      <div style={{ marginTop: S.lg }}>
        <Card title="What each role means">
          <div style={{ display: "grid", gap: S.md }}>
            {Object.entries(ROLE_HELP).map(([role, text]) => (
              <div key={role} style={{ display: "flex", gap: S.md, alignItems: "flex-start" }}>
                <div style={{ minWidth: 84 }}><RoleBadge role={role} /></div>
                <div style={{ ...T.body, color: THEME.textSecond }}>{text}</div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: S.lg, paddingTop: S.md, borderTop: `1px dashed ${THEME.border}`,
            display: "flex", gap: S.sm, alignItems: "flex-start",
          }}>
            <ShieldAlert size={15} strokeWidth={1.8} color={THEME.textMuted}
                         style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ ...T.small, color: THEME.textMuted, lineHeight: 1.6 }}>
              Admin is deliberately not a superset of finance. Whoever can grant
              approval rights should not also be able to use them — otherwise one
              account can quietly give itself the power to approve its own spend.
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
