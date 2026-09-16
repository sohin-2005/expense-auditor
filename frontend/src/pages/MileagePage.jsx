import { useState, useEffect } from "react"
import axios from "axios"
import { Car, MapPin, Calculator, CheckCircle2 } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, S, R, T, money } from "../theme/tokens"
import { Card, PageHeader, Button, EmptyState, Notice, Input, Select } from "../components/ui"

// Mileage is the one claim with nothing to photograph. The amount is
// distance x the company rate, computed server-side in code rather than by a
// model — so this form can show the employee exactly what they will be paid
// before they submit it, which no receipt upload can do.
export default function MileagePage({ profile, setPage }) {
  const [rate, setRate] = useState(null)
  const [loadingRate, setLoadingRate] = useState(true)
  const [unit, setUnit] = useState("km")

  const [form, setForm] = useState({
    distance: "", transaction_date: new Date().toISOString().slice(0, 10),
    from_location: "", to_location: "", business_purpose: "",
    cost_center: "", project_code: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const loadRate = async (u) => {
    setLoadingRate(true)
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/expenses/mileage-rate?unit=${u}`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
      })
      setRate(r.data)
    } catch {
      setRate({ available: false, detail: "Could not read the mileage rate." })
    }
    setLoadingRate(false)
  }

  useEffect(() => { loadRate(unit) }, [unit])

  const distance = parseFloat(form.distance)
  const preview = (rate?.available && distance > 0)
    ? distance * Number(rate.rate)
    : null

  const submit = async () => {
    setError(""); setSaved(null)
    if (!(distance > 0)) { setError("Enter the distance travelled."); return }
    if (!form.business_purpose.trim()) { setError("Describe the business purpose."); return }
    setSaving(true)
    try {
      const token = await getToken()
      const body = new FormData()
      body.append("distance", String(distance))
      body.append("unit", unit)
      body.append("employee_name", profile?.full_name || "")
      Object.entries(form).forEach(([k, v]) => { if (k !== "distance") body.append(k, v) })
      const r = await axios.post(`${API}/expenses/mileage`, body, {
        headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS,
      })
      setSaved(r.data)
      setForm(f => ({ ...f, distance: "", from_location: "", to_location: "", business_purpose: "" }))
    } catch (e) {
      setError(e.response?.data?.detail || "Could not save that journey.")
    }
    setSaving(false)
  }

  const field = { borderRadius: R.sm, padding: "10px 11px", background: THEME.surface }

  return (
    <div style={{ padding: `${S.xl}px ${S.xl}px`, maxWidth: 780, margin: "0 auto" }}>
      <PageHeader
        title="Mileage"
        subtitle="Claim a journey in your own vehicle. There is no receipt to upload — the amount is your distance at the company rate, calculated exactly."
      />

      {error && <Notice tone="bad">{error}</Notice>}

      {saved && (
        <Notice tone="good">
          <strong>Journey saved.</strong>{" "}
          {money(saved.computed.amount, saved.computed.currency)} added to your
          unfiled expenses.{" "}
          <button onClick={() => setPage?.("expenses")} style={linkBtn}>View it</button>
        </Notice>
      )}

      {!loadingRate && !rate?.available && (
        <Notice tone="warn">
          <strong>No mileage rate is set for your company.</strong>{" "}
          {rate?.detail} Ask your finance team to add one — until then, mileage
          cannot be claimed, because there is no defensible amount to pay.
        </Notice>
      )}

      <Card title="Journey">
        <div style={{ display: "grid", gap: S.md,
                      gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Input label="Distance" required value={form.distance} inputMode="decimal"
                 placeholder="48.5" style={field}
                 onChange={e => set("distance", e.target.value)} />
          <Select label="Unit" value={unit} style={field}
                  onChange={e => setUnit(e.target.value)}>
            <option value="km">Kilometres</option>
            <option value="mi">Miles</option>
          </Select>
          <Input label="Date" type="date" value={form.transaction_date} style={field}
                 onChange={e => set("transaction_date", e.target.value)} />
        </div>

        <div style={{ display: "grid", gap: S.md,
                      gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Input label="From" value={form.from_location} placeholder="Office" style={field}
                 onChange={e => set("from_location", e.target.value)} />
          <Input label="To" value={form.to_location} placeholder="Client site, Leeds" style={field}
                 onChange={e => set("to_location", e.target.value)} />
        </div>

        <Input label="Business purpose" required value={form.business_purpose}
               placeholder="Quarterly review with client" style={field}
               onChange={e => set("business_purpose", e.target.value)} />

        <div style={{ display: "grid", gap: S.md,
                      gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Input label="Cost centre" value={form.cost_center} placeholder="Optional" style={field}
                 onChange={e => set("cost_center", e.target.value)} />
          <Input label="Project code" value={form.project_code} placeholder="Optional" style={field}
                 onChange={e => set("project_code", e.target.value)} />
        </div>

        {/* Shown before submitting, not after. The whole advantage of a
            computed claim is that the employee can see the number in advance. */}
        <div style={{
          display: "flex", alignItems: "center", gap: S.md, flexWrap: "wrap",
          background: THEME.surfaceAlt, border: `1px solid ${THEME.border}`,
          borderRadius: R.md, padding: `${S.md}px ${S.lg}px`, marginBottom: S.md,
        }}>
          <Calculator size={18} strokeWidth={1.7}
                      color={preview != null ? THEME.accent : THEME.textMuted} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ ...T.micro, color: THEME.textMuted }}>You will be reimbursed</div>
            <div style={{ ...T.figure, fontSize: 22,
                          color: preview != null ? THEME.textPrimary : THEME.textMuted }}>
              {preview != null ? money(preview, rate.currency) : "—"}
            </div>
          </div>
          {rate?.available && (
            <div style={{ ...T.small, color: THEME.textSecond, textAlign: "right" }}>
              {rate.currency} {rate.rate} per {rate.unit}
              <div style={{ ...T.small, fontSize: 11, color: THEME.textMuted }}>
                effective {String(rate.effective_from || "").slice(0, 10)}
              </div>
            </div>
          )}
        </div>

        <Button variant="primary" onClick={submit}
                disabled={saving || !rate?.available}
                style={{ width: "100%", justifyContent: "center", padding: "11px 16px" }}>
          <Car size={15} strokeWidth={1.9} />
          {saving ? "Saving…" : "Add mileage claim"}
        </Button>
      </Card>

      <div style={{ marginTop: S.lg }}>
        <Card title="How this is calculated">
          <div style={{ display: "grid", gap: S.md }}>
            <Row icon={<Calculator size={15} strokeWidth={1.8} color={THEME.accent} />}
                 title="Arithmetic, not judgement"
                 body="Distance times your company's published rate. No AI model is involved, so the figure is exact, instant, and identical every time." />
            <Row icon={<MapPin size={15} strokeWidth={1.8} color={THEME.blue} />}
                 title="The route is recorded"
                 body="From and to are stored with the claim, so an approver can see what the journey was for without asking." />
            <Row icon={<CheckCircle2 size={15} strokeWidth={1.8} color={THEME.green} />}
                 title="Approved on submission"
                 body="The rate is the rule, so there is nothing to audit at line level. Policy limits on total mileage are applied when the claim is reviewed." />
          </div>
        </Card>
      </div>
    </div>
  )
}

const Row = ({ icon, title, body }) => (
  <div style={{ display: "flex", gap: S.md, alignItems: "flex-start" }}>
    <span style={{ marginTop: 2, flexShrink: 0 }}>{icon}</span>
    <div>
      <div style={{ ...T.body, fontWeight: 650, color: THEME.textPrimary }}>{title}</div>
      <div style={{ ...T.small, color: THEME.textSecond, lineHeight: 1.6 }}>{body}</div>
    </div>
  </div>
)

const linkBtn = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: THEME.accent, fontWeight: 700, fontSize: "inherit", fontFamily: "inherit",
  textDecoration: "underline", textUnderlineOffset: 2,
}
