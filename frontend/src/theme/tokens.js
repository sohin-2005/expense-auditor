// Design tokens and the one derived button style, lifted out of App.jsx so
// every page imports the same palette instead of re-declaring colours.

const BRAND_NAME = "Audixa"
const BRAND_LOGO = "/audixa-logo.png?v=20260407"

// Light theme. Foreground colors are picked to clear WCAG AA (4.5:1) against the
// white background — the brand lime reads at only ~2.5:1 on white, so THEME.accent is
// a deepened version of it for text and borders, while the bright lime is kept for
// filled buttons and tints where it sits behind black text or acts as a wash.
export const THEME = {
  bg: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f6f7f9",
  border: "#e5e7eb",
  borderHover: "#d1d5db",
  accent: "#4d7a00",
  accentHover: "#3d6100",
  accentDim: "rgba(118,185,0,0.14)",
  blue: "#1d4ed8",
  blueDim: "rgba(29,78,216,0.08)",
  amber: "#b45309",
  amberDim: "rgba(245,158,11,0.14)",
  textPrimary: "#111827",
  textSecond: "#4b5563",
  textMuted: "#6b7280",
  green: "#4d7a00",
  greenDim: "rgba(118,185,0,0.12)",
  red: "#dc2626",
  redDim: "rgba(220,38,38,0.08)",
}

export const primaryBtnStyle = (disabled = false) => ({
  background: disabled
    ? "linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)"
    : "linear-gradient(135deg, #76b900 0%, #5a8c00 100%)",
  // Black on the lime fill still reads well; the disabled fill is now light, so its
  // label has to go grey or the button stops looking disabled.
  color: disabled ? "#9ca3af" : "#000",
  border: "none",
  borderRadius: 8,
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 0.22s ease",
})

export { BRAND_NAME, BRAND_LOGO }

// ── design scale ────────────────────────────────────────────────────────
// The palette above is unchanged; what was missing was everything around it.
// Spacing, radii and shadows were previously typed inline at each of ~630
// call sites, so no two cards agreed on their own padding. One scale, used
// everywhere, is most of what separates "styled" from "designed".
export const S = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, xxl: 40 }
export const R = { sm: 6, md: 10, lg: 14, pill: 999 }

export const SHADOW = {
  none: "none",
  card: "0 1px 2px rgba(17,24,39,0.05)",
  raised: "0 4px 16px rgba(17,24,39,0.08)",
  overlay: "0 18px 48px rgba(17,24,39,0.18)",
}

// Type scale. Sizes are deliberately few: a page that uses five sizes reads
// as considered, one that uses fifteen reads as accreted.
export const T = {
  display: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" },
  title:   { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" },
  section: { fontSize: 14, fontWeight: 700 },
  body:    { fontSize: 13.5, fontWeight: 400 },
  small:   { fontSize: 12, fontWeight: 400 },
  micro:   { fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" },
  figure:  { fontSize: 27, fontWeight: 800, letterSpacing: "-0.02em",
             fontVariantNumeric: "tabular-nums" },
}

// Each role gets one colour, used for its badge and for the accent on its own
// dashboard, so "which hat am I wearing" is answerable at a glance rather
// than by reading the sidebar.
export const ROLE_STYLE = {
  employee: { label: "Employee",  color: THEME.textSecond, bg: THEME.surfaceAlt },
  manager:  { label: "Manager",   color: THEME.blue,       bg: THEME.blueDim },
  finance:  { label: "Finance",   color: THEME.accent,     bg: THEME.accentDim },
  admin:    { label: "Admin",     color: THEME.amber,      bg: THEME.amberDim },
}

export const roleStyle = (role) =>
  ROLE_STYLE[String(role || "employee").toLowerCase()] || ROLE_STYLE.employee

export const money = (amount, currency) =>
  `${currency ? currency + " " : ""}${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
