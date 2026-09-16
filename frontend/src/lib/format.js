// Display helpers. Pure functions -- no state, no I/O.

export const formatClaimDate = (claim) => {
  const raw = claim?.submitted_at || claim?.created_at || claim?.overridden_at
  if (!raw) return "—"
  return String(raw).split("T")[0]
}

export const getClaimDisplayName = (claim) => {
  return claim?.report_name || claim?.purpose || claim?.entity || "Untitled Claim"
}

// Text is the deepened variant so the label clears AA against its own tint; the dot
// keeps the vivid hue, since a 6px dot is decoration and reads better saturated.
export const STATUS_STYLES = {
  Draft: { bg: "rgba(107,114,128,0.14)", text: "#4b5563", dot: "#6b7280" },
  "Pending Approval": { bg: "rgba(245,158,11,0.16)", text: "#b45309", dot: "#f59e0b" },
  Approved: { bg: "rgba(118,185,0,0.16)", text: "#4d7a00", dot: "#76b900" },
  Rejected: { bg: "rgba(220,38,38,0.10)", text: "#dc2626", dot: "#dc2626" },
  Flagged: { bg: "rgba(245,158,11,0.16)", text: "#b45309", dot: "#f59e0b" },
}

export const normalizeStatus = (status) => {
  const raw = String(status || "").trim().toLowerCase()
  if (!raw) return "Draft"
  if (raw === "pending approval") return "Flagged"
  if (raw === "approved") return "Approved"
  if (raw === "flagged") return "Flagged"
  if (raw === "rejected") return "Rejected"
  if (raw === "draft") return "Draft"
  return status || "Draft"
}

export const getISTGreeting = () => {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date()))

  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 17) return "Good afternoon"
  if (hour >= 17 && hour < 21) return "Good evening"
  return "Good night"
}
