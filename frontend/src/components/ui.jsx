import { forwardRef } from "react"
import { STATUS_STYLES, normalizeStatus } from "../lib/format"
import { THEME, S, R, T, SHADOW, roleStyle, primaryBtnStyle } from "../theme/tokens"

// Shared presentational primitives. StatusBadge is the only place a
// verdict's colour is decided.

export const StatusBadge = ({ status }) => {
  const normalized = normalizeStatus(status)
  const s = STATUS_STYLES[normalized] || STATUS_STYLES.Draft
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, color: s.text,
      padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {normalized}
    </span>
  )
}

// forwardRef so a caller can focus the field -- the sign-in panel focuses the
// email input when it opens. A plain function component silently swallows a
// ref and leaves it null, which fails as "nothing happened" rather than as an
// error.
export const Input = forwardRef(({ label, required, error, ...props }, ref) => (
  <div style={{ marginBottom: 14 }}>
    {label && (
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
      </label>
    )}
    <input ref={ref} {...props} style={{
      width: "100%", padding: "8px 11px", fontSize: 13,
      border: `1px solid ${error ? "#dc2626" : THEME.border}`,
      borderRadius: 6, boxSizing: "border-box", outline: "none",
      color: THEME.textPrimary,
      background: error ? "#fef2f2" : THEME.surface,
      ...props.style
    }} />
    {error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{error}</div>}
  </div>
))
Input.displayName = "Input"

export const Select = ({ label, required, error, children, ...props }) => (
  <div style={{ marginBottom: 14 }}>
    {label && (
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
      </label>
    )}
    <select {...props} style={{
      width: "100%", padding: "8px 11px", fontSize: 13,
      border: `1px solid ${error ? "#dc2626" : THEME.border}`,
      borderRadius: 6, boxSizing: "border-box", background: THEME.surface, color: THEME.textPrimary, outline: "none",
      ...props.style
    }}>
      {children}
    </select>
    {error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{error}</div>}
  </div>
)

// ── layout primitives ───────────────────────────────────────────────────
// Added so a page describes what it is rather than how it is painted. Every
// screen previously repeated the same card border, the same header margins
// and the same empty-state wording, slightly differently each time.

export const Card = ({ title, action, pad = true, children, style = {} }) => (
  <section style={{
    background: THEME.surface, border: `1px solid ${THEME.border}`,
    borderRadius: R.lg, boxShadow: SHADOW.card, overflow: "hidden", ...style,
  }}>
    {(title || action) && (
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: S.md, padding: `${S.md}px ${S.lg}px`,
        borderBottom: `1px solid ${THEME.border}`,
      }}>
        <h2 style={{ ...T.section, color: THEME.textPrimary, margin: 0 }}>{title}</h2>
        {action}
      </header>
    )}
    <div style={pad ? { padding: S.lg } : undefined}>{children}</div>
  </section>
)

export const PageHeader = ({ title, subtitle, actions }) => (
  <header style={{
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    gap: S.md, flexWrap: "wrap", marginBottom: S.xl,
  }}>
    <div style={{ minWidth: 0 }}>
      <h1 style={{ ...T.display, color: THEME.textPrimary, margin: 0 }}>{title}</h1>
      {subtitle && (
        <p style={{ ...T.body, color: THEME.textSecond, margin: `${S.xs}px 0 0`, maxWidth: "62ch" }}>
          {subtitle}
        </p>
      )}
    </div>
    {actions && <div style={{ display: "flex", gap: S.sm, flexWrap: "wrap" }}>{actions}</div>}
  </header>
)

// Big-number tile. `tone` colours the figure only — the card itself stays
// neutral, so a row of these reads as one object instead of a paint chart.
export const Stat = ({ label, value, hint, tone, onClick }) => (
  <div
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } } : undefined}
    style={{
      background: THEME.surface, border: `1px solid ${THEME.border}`,
      borderRadius: R.lg, padding: `${S.md}px ${S.lg}px`,
      boxShadow: SHADOW.card, cursor: onClick ? "pointer" : "default",
      transition: "border-color 0.15s ease",
    }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = THEME.borderHover }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = THEME.border }}
  >
    <div style={{ ...T.small, color: THEME.textSecond, marginBottom: S.xs }}>{label}</div>
    <div style={{ ...T.figure, color: tone || THEME.textPrimary }}>{value}</div>
    {hint && <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted, marginTop: 3 }}>{hint}</div>}
  </div>
)

export const StatRow = ({ children, min = 190 }) => (
  <div style={{
    display: "grid", gap: S.md, marginBottom: S.lg,
    gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  }}>{children}</div>
)

export const Button = ({ variant = "secondary", disabled, children, style = {}, ...props }) => {
  const base = {
    display: "inline-flex", alignItems: "center", gap: S.xs,
    padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
    borderRadius: R.sm, cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s ease", whiteSpace: "nowrap",
  }
  const variants = {
    primary: { ...primaryBtnStyle(disabled), ...base, ...primaryBtnStyle(disabled) },
    secondary: {
      ...base, background: THEME.surface, color: THEME.textPrimary,
      border: `1px solid ${THEME.border}`, opacity: disabled ? 0.55 : 1,
    },
    ghost: {
      ...base, background: "transparent", color: THEME.textSecond,
      border: "1px solid transparent", opacity: disabled ? 0.55 : 1,
    },
    danger: {
      ...base, background: THEME.redDim, color: THEME.red,
      border: `1px solid ${THEME.border}`, opacity: disabled ? 0.55 : 1,
    },
  }
  return (
    <button disabled={disabled} style={{ ...variants[variant] || variants.secondary, ...style }} {...props}>
      {children}
    </button>
  )
}

// Wide content scrolls inside its own container so the page body never
// scrolls sideways — the failure mode every table on a phone used to have.
export const TableWrap = ({ children }) => (
  <div style={{ overflowX: "auto", margin: `0 -${S.lg}px`, padding: `0 ${S.lg}px` }}>
    {children}
  </div>
)

export const Th = ({ children, align = "left" }) => (
  <th style={{
    ...T.micro, color: THEME.textMuted, textAlign: align,
    padding: `${S.sm}px ${S.md}px`, borderBottom: `1px solid ${THEME.border}`,
    whiteSpace: "nowrap", background: THEME.surfaceAlt,
  }}>{children}</th>
)

export const Td = ({ children, align = "left", mono, style = {} }) => (
  <td style={{
    ...T.body, color: THEME.textSecond, textAlign: align,
    padding: `${S.sm}px ${S.md}px`, borderBottom: `1px solid ${THEME.border}`,
    fontVariantNumeric: mono ? "tabular-nums" : undefined, ...style,
  }}>{children}</td>
)

export const EmptyState = ({ icon, title, hint }) => (
  <div style={{ padding: `${S.xxl}px ${S.lg}px`, textAlign: "center" }}>
    {icon && <div style={{ marginBottom: S.sm, opacity: 0.5 }}>{icon}</div>}
    <div style={{ ...T.body, fontWeight: 600, color: THEME.textPrimary }}>{title}</div>
    {hint && <div style={{ ...T.small, color: THEME.textMuted, marginTop: 4, maxWidth: "44ch", marginInline: "auto" }}>{hint}</div>}
  </div>
)

export const RoleBadge = ({ role }) => {
  const s = roleStyle(role)
  return (
    <span style={{
      ...T.micro, color: s.color, background: s.bg,
      padding: "3px 8px", borderRadius: R.sm, whiteSpace: "nowrap",
    }}>{s.label}</span>
  )
}

// Severity-coloured strip for a thing that needs attention. Used sparingly:
// if everything is highlighted, nothing is.
export const Notice = ({ tone = "info", children }) => {
  const tones = {
    info: { bg: THEME.blueDim, fg: THEME.blue },
    warn: { bg: THEME.amberDim, fg: THEME.amber },
    good: { bg: THEME.greenDim, fg: THEME.green },
    bad: { bg: THEME.redDim, fg: THEME.red },
  }
  const t = tones[tone] || tones.info
  return (
    <div style={{
      background: t.bg, borderLeft: `3px solid ${t.fg}`,
      borderRadius: `0 ${R.sm}px ${R.sm}px 0`, padding: `${S.sm}px ${S.md}px`,
      ...T.body, color: THEME.textPrimary, marginBottom: S.md,
    }}>{children}</div>
  )
}
