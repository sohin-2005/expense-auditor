import { useState, useEffect } from "react"
import axios from "axios"
import { CheckCircle2, AlertTriangle, RefreshCw, WifiOff } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T } from "../theme/tokens"
import { Card, PageHeader, Button, EmptyState, Notice } from "../components/ui"

// The point of this screen is the difference between "configured" and
// "actually doing something". Several parts of Audixa degrade silently when
// unset — retrieval falls back to keyword matching, unconverted expenses drop
// out of every total — so each check below reports what is live, not what is
// merely installed.
export default function SystemPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true); setError("")
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/admin/system`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
      })
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not read system status.")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const degraded = data?.status === "degraded"

  return (
    <div style={{ padding: `${S.xl}px ${S.xl}px`, maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        title="System"
        subtitle="What this deployment is actually doing right now — not what it was configured to do."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={1.9} /> Refresh
          </Button>
        }
      />

      {error && <Notice tone="bad">{error}</Notice>}

      {loading && !data ? (
        <EmptyState title="Reading system status…" />
      ) : data && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: S.md,
            padding: `${S.md}px ${S.lg}px`, marginBottom: S.lg,
            borderRadius: R.lg,
            background: degraded ? THEME.amberDim : THEME.greenDim,
            border: `1px solid ${THEME.border}`,
          }}>
            {degraded
              ? <AlertTriangle size={20} strokeWidth={1.8} color={THEME.amber} />
              : <CheckCircle2 size={20} strokeWidth={1.8} color={THEME.green} />}
            <div>
              <div style={{ ...T.title, fontSize: 15, color: THEME.textPrimary }}>
                {degraded ? "Running, with problems" : "All systems nominal"}
              </div>
              <div style={{ ...T.small, color: THEME.textSecond }}>
                Base currency {data.base_currency} · policy retrieval in{" "}
                <strong>{data.policy_retrieval_mode}</strong> mode
              </div>
            </div>
          </div>

          {data.policy_retrieval_mode === "shadow" && (
            <Notice tone="info">
              Retrieval is in <strong>shadow</strong> mode: the new hybrid search runs
              alongside the old keyword trimmer and its results are logged, but the
              keyword path still decides verdicts. Citations are not enforced until
              this is switched to <code>vector</code>.
            </Notice>
          )}

          <Card title="Checks" pad={false}>
            <div>
              {data.checks.map((c, i) => (
                <div key={c.name} style={{
                  display: "flex", alignItems: "flex-start", gap: S.md,
                  padding: `${S.md}px ${S.lg}px`,
                  borderTop: i ? `1px solid ${THEME.border}` : "none",
                }}>
                  <span style={{ marginTop: 1, flexShrink: 0 }}>
                    {c.ok
                      ? <CheckCircle2 size={16} strokeWidth={1.9} color={THEME.green} />
                      : <AlertTriangle size={16} strokeWidth={1.9} color={THEME.amber} />}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...T.body, fontWeight: 650, color: THEME.textPrimary }}>
                      {c.name}
                    </div>
                    <div style={{ ...T.small, color: THEME.textSecond, wordBreak: "break-word" }}>
                      {c.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {(data.boot_errors?.length > 0) && (
            <div style={{ marginTop: S.lg }}>
              <Card title="Boot errors">
                <div style={{ ...T.small, color: THEME.textSecond, marginBottom: S.sm }}>
                  Collected at startup instead of crashing the process — the service
                  keeps serving so you can see this page at all.
                </div>
                {data.boot_errors.map((e, i) => (
                  <div key={i} style={{
                    ...T.small, fontFamily: "ui-monospace, monospace",
                    color: THEME.red, background: THEME.redDim,
                    padding: `${S.sm}px ${S.md}px`, borderRadius: R.sm, marginBottom: 6,
                    wordBreak: "break-word",
                  }}>{e}</div>
                ))}
              </Card>
            </div>
          )}

          {(data.model_warnings?.length > 0) && (
            <div style={{ marginTop: S.lg }}>
              <Card title="Model warnings">
                <div style={{ ...T.small, color: THEME.textSecond, marginBottom: S.sm }}>
                  A configured model is not in the account's catalog. This is how a
                  provider deprecation surfaces before it becomes a 500 mid-upload.
                </div>
                {data.model_warnings.map((w, i) => (
                  <div key={i} style={{
                    ...T.small, fontFamily: "ui-monospace, monospace",
                    color: THEME.amber, background: THEME.amberDim,
                    padding: `${S.sm}px ${S.md}px`, borderRadius: R.sm, marginBottom: 6,
                    wordBreak: "break-word",
                  }}>{w}</div>
                ))}
              </Card>
            </div>
          )}

          {!data.boot_errors?.length && !data.model_warnings?.length && (
            <div style={{ marginTop: S.lg }}>
              <Card>
                <div style={{ display: "flex", gap: S.sm, alignItems: "center",
                              ...T.small, color: THEME.textMuted }}>
                  <WifiOff size={14} strokeWidth={1.8} />
                  No boot errors and no model warnings recorded.
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
