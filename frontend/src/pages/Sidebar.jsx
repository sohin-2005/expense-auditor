import { useState, useEffect } from "react"
import {
  LayoutGrid, Bell, Compass, ClipboardList, Receipt, BarChart3,
  BadgeCheck, ChartNoAxesColumn, ScrollText, LogOut, Users, Settings2,
  PanelLeftClose, PanelLeftOpen, ScanLine, Car, UserCog,
} from "lucide-react"
import { supabase } from "../supabase"
import { THEME, S, R, T, SHADOW, BRAND_LOGO, roleStyle } from "../theme/tokens"

const RAIL = 62
const OPEN = 232
const STORAGE_KEY = "audixa.nav.collapsed"

// Navigation is grouped by what the group is FOR, not by which role unlocks
// it — a finance user reads "Oversight" and knows immediately which items are
// the ones only they can see. `needs` names a capability from GET /me, so the
// server decides visibility and the client never re-derives it from a role
// string the way isFinance used to.
const GROUPS = [
  {
    label: "Work",
    items: [
      { id: "dashboard", Icon: LayoutGrid, label: "Dashboard" },
      { id: "submitExpense", Icon: ScanLine, label: "Scan Receipt", needs: "submit_expenses" },
      { id: "claims", Icon: ClipboardList, label: "Expense Claims", needs: "submit_expenses" },
      { id: "mileage", Icon: Car, label: "Mileage", needs: "submit_expenses" },
      { id: "expenses", Icon: Receipt, label: "Unfiled Expenses", needs: "submit_expenses" },
      { id: "tripPlanner", Icon: Compass, label: "Trip Planner", needs: "submit_expenses" },
    ],
  },
  {
    label: "Insight",
    items: [
      { id: "analytics", Icon: BarChart3, label: "My Spend", needs: "submit_expenses" },
      { id: "notifications", Icon: Bell, label: "Notifications" },
    ],
  },
  {
    label: "Oversight",
    items: [
      { id: "approvals", Icon: BadgeCheck, label: "Approvals", needs: "approve_claims" },
      { id: "finance", Icon: ChartNoAxesColumn, label: "Finance Desk", needs: "view_company_analytics" },
    ],
  },
  {
    label: "Administration",
    items: [
      { id: "people", Icon: Users, label: "People", needs: "manage_users" },
      { id: "system", Icon: Settings2, label: "System", needs: "view_system_config" },
    ],
  },
  {
    label: "Company",
    items: [
      { id: "policy", Icon: ScrollText, label: "Policy" },
      { id: "profile", Icon: UserCog, label: "My Profile" },
    ],
  },
]

export default function Sidebar({
  page, setPage, profile, capabilities = {}, onLogout, onProfileUpdate,
  isMobile = false, onNavigate,
}) {
  // Collapsed state survives reloads: someone who works in the rail should
  // not have to re-collapse it every session. Wrapped because a private
  // window throws on localStorage rather than returning null.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1" } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0") } catch {}
  }, [collapsed])

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(profile?.full_name || "")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => { setEditName(profile?.full_name || "") }, [profile?.full_name])

  // On mobile the rail is a drawer and is always fully expanded — an icon-only
  // drawer is all cost and no benefit when it overlays the page anyway.
  const showLabels = isMobile || !collapsed
  const width = isMobile ? OPEN : (collapsed ? RAIL : OPEN)

  const saveProfile = async () => {
    const next = editName.trim()
    if (!next) { setMsg("Name is required"); return }
    setSaving(true); setMsg("")
    try {
      if (profile?.id) {
        // full_name only. role and company_id are pinned server-side; sending
        // them would be silently discarded and make this claim a save that
        // did not happen.
        await supabase.from("profiles").update({ full_name: next }).eq("id", profile.id)
      }
      onProfileUpdate?.({ ...(profile || {}), full_name: next })
      setEditing(false)
    } catch (e) {
      setMsg(e?.message || "Could not save")
    }
    setSaving(false)
  }

  const go = (id) => { setPage(id); onNavigate?.() }

  const groups = GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => !i.needs || capabilities[i.needs]) }))
    .filter(g => g.items.length)

  // The role shown here comes from GET /me (capabilities.role), not from the
  // profiles row the browser fetched at sign-in. Those diverge the moment an
  // administrator changes someone's role -- and the client copy also falls
  // back to "employee" whenever that fetch fails, which is why this card kept
  // showing the wrong badge.
  const rs = roleStyle(capabilities.role || profile?.role)

  return (
    <nav
      aria-label="Main"
      style={{
        width, minWidth: width, height: "100vh", position: "sticky", top: 0,
        background: THEME.surface, borderRight: `1px solid ${THEME.border}`,
        display: "flex", flexDirection: "column",
        transition: "width 0.18s ease", overflow: "hidden",
      }}
    >
      {/* ── brand + collapse ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: S.sm,
        padding: showLabels ? `${S.md}px ${S.md}px` : `${S.md}px 0`,
        justifyContent: showLabels ? "space-between" : "center",
        borderBottom: `1px solid ${THEME.border}`, minHeight: 54,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: S.sm, minWidth: 0 }}>
          <img src={BRAND_LOGO} alt="" width={24} height={24} style={{ borderRadius: R.sm, flexShrink: 0 }} />
          {showLabels && (
            <span style={{ fontWeight: 800, letterSpacing: "0.04em", fontSize: 14 }}>
              <span style={{ color: THEME.textPrimary }}>AUDI</span>
              <span style={{ color: THEME.accent }}>XA</span>
            </span>
          )}
        </div>
        {!isMobile && showLabels && (
          <button onClick={() => setCollapsed(true)} aria-label="Collapse navigation"
            title="Collapse"
            style={iconBtn}>
            <PanelLeftClose size={15} strokeWidth={1.8} color={THEME.textMuted} />
          </button>
        )}
      </div>

      {!isMobile && collapsed && (
        <button onClick={() => setCollapsed(false)} aria-label="Expand navigation" title="Expand"
          style={{ ...iconBtn, margin: `${S.sm}px auto 0` }}>
          <PanelLeftOpen size={15} strokeWidth={1.8} color={THEME.textMuted} />
        </button>
      )}

      {/* ── nav ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: `${S.sm}px 0` }}>
        {groups.map(group => (
          <div key={group.label} style={{ marginBottom: S.sm }}>
            {showLabels && (
              <div style={{
                ...T.micro, color: THEME.textMuted,
                padding: `${S.sm}px ${S.md}px 4px`,
              }}>{group.label}</div>
            )}
            {!showLabels && <div style={{ height: 1, background: THEME.border, margin: `${S.sm}px ${S.md}px` }} />}

            {group.items.map(({ id, Icon, label }) => {
              const active = page === id
              return (
                <button
                  key={id}
                  onClick={() => go(id)}
                  title={showLabels ? undefined : label}
                  aria-current={active ? "page" : undefined}
                  style={{
                    width: showLabels ? `calc(100% - ${S.sm * 2}px)` : RAIL - 20,
                    margin: showLabels ? `1px ${S.sm}px` : "2px auto",
                    display: "flex", alignItems: "center",
                    justifyContent: showLabels ? "flex-start" : "center",
                    gap: S.sm, padding: showLabels ? "8px 10px" : "9px 0",
                    border: "none", borderRadius: R.sm, cursor: "pointer",
                    fontFamily: "inherit", fontSize: 13,
                    fontWeight: active ? 650 : 450,
                    background: active ? THEME.accentDim : "transparent",
                    color: active ? THEME.accent : THEME.textSecond,
                    textAlign: "left", transition: "background 0.12s ease",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = THEME.surfaceAlt }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}
                >
                  <Icon size={16} strokeWidth={active ? 2.1 : 1.7} style={{ flexShrink: 0 }} />
                  {showLabels && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── account ── */}
      <div style={{ borderTop: `1px solid ${THEME.border}`, padding: showLabels ? S.md : S.sm }}>
        {showLabels ? (
          <>
            {editing ? (
              <div style={{ marginBottom: S.sm }}>
                <input
                  value={editName} onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveProfile() }}
                  aria-label="Full name" autoFocus
                  style={{
                    width: "100%", padding: "7px 9px", marginBottom: 6,
                    border: `1px solid ${THEME.border}`, borderRadius: R.sm,
                    background: THEME.surface, color: THEME.textPrimary,
                    fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
                  }} />
                <div style={{ ...T.small, fontSize: 10.5, color: THEME.textMuted, marginBottom: 6 }}>
                  Role and company are set by your administrator.
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={saveProfile} disabled={saving} style={miniBtn(true)}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditing(false); setEditName(profile?.full_name || ""); setMsg("") }}
                          style={miniBtn(false)}>Cancel</button>
                </div>
                {msg && <div style={{ ...T.small, fontSize: 10.5, color: THEME.red, marginTop: 5 }}>{msg}</div>}
              </div>
            ) : (
              <button
                onClick={() => go("profile")}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: S.sm,
                  background: "transparent", border: "none", padding: `6px 4px`,
                  cursor: "pointer", textAlign: "left", borderRadius: R.sm,
                  marginBottom: S.xs, fontFamily: "inherit",
                }}>
                <Avatar name={profile?.full_name} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: "block", fontSize: 12.5, fontWeight: 650, color: THEME.textPrimary,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{profile?.full_name || "Account"}</span>
                  <span style={{ ...T.micro, color: rs.color }}>{rs.label}</span>
                </span>
              </button>
            )}

            <button onClick={onLogout} style={{
              width: "100%", display: "flex", alignItems: "center", gap: S.sm,
              padding: "7px 10px", border: `1px solid ${THEME.border}`,
              borderRadius: R.sm, background: THEME.surface, cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, color: THEME.textSecond, fontFamily: "inherit",
            }}>
              <LogOut size={14} strokeWidth={1.8} /> Sign out
            </button>
          </>
        ) : (
          <div style={{ display: "grid", gap: S.xs, justifyItems: "center" }}>
            <Avatar name={profile?.full_name} title={`${profile?.full_name || "Account"} · ${rs.label}`} />
            <button onClick={onLogout} aria-label="Sign out" title="Sign out" style={iconBtn}>
              <LogOut size={15} strokeWidth={1.8} color={THEME.textMuted} />
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}

function Avatar({ name, title }) {
  const initials = String(name || "?")
    .split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
  return (
    <span title={title} style={{
      width: 28, height: 28, borderRadius: R.pill, flexShrink: 0,
      display: "grid", placeItems: "center",
      background: THEME.accentDim, color: THEME.accent,
      fontSize: 11, fontWeight: 800, letterSpacing: "0.02em",
    }}>{initials}</span>
  )
}

const iconBtn = {
  display: "grid", placeItems: "center", width: 28, height: 28,
  background: "transparent", border: "none", borderRadius: R.sm,
  cursor: "pointer", padding: 0,
}

const miniBtn = (primary) => ({
  padding: "5px 10px", fontSize: 11.5, fontWeight: 700, borderRadius: R.sm,
  cursor: "pointer", fontFamily: "inherit",
  border: primary ? "none" : `1px solid ${THEME.border}`,
  background: primary ? "linear-gradient(135deg, #76b900 0%, #5a8c00 100%)" : THEME.surface,
  color: primary ? "#0b1005" : THEME.textSecond,
})
