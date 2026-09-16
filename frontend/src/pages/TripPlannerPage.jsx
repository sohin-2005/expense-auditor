import { useState, useEffect } from "react"
import axios from "axios"
import { MapPin, CalendarDays, Briefcase, Plane, BedDouble, UtensilsCrossed, ShieldAlert, WandSparkles } from "lucide-react"
import { API, getToken } from "../lib/api"
import { THEME, primaryBtnStyle } from "../theme/tokens"
import { Input } from "../components/ui"

function TripPlannerPage({ profile }) {
  const [step, setStep] = useState(1)
  const [destination, setDestination] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [purpose, setPurpose] = useState("")
  const [activityName, setActivityName] = useState("")
  const [activityCost, setActivityCost] = useState("")
  const [activityPremium, setActivityPremium] = useState(false)
  const [activityJustification, setActivityJustification] = useState("")
  const [activities, setActivities] = useState([])
  const [plans, setPlans] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [tripWarning, setTripWarning] = useState("")

  const companyId = profile?.company_id || "default"

  const loadPlans = async () => {
    try {
      const token = await getToken()
      const r = await axios.get(`${API}/trip-plans/my`, { headers: { Authorization: `Bearer ${token}` } })
      setPlans(r.data.plans || [])
    } catch (e) {
      setPlans([])
    }
  }

  useEffect(() => { loadPlans() }, [])

  const addActivity = () => {
    const name = activityName.trim()
    if (!name) return
    const next = {
      id: `${Date.now()}-${Math.random()}`,
      name,
      estimated_cost: activityCost ? Number(activityCost) : null,
      is_premium: activityPremium,
      justification: (activityJustification || "").trim(),
    }
    if (next.is_premium && !next.justification) {
      setError("Please add a justification for premium/last-minute activity")
      return
    }
    setActivities(prev => [...prev, next])
    setActivityName("")
    setActivityCost("")
    setActivityPremium(false)
    setActivityJustification("")
    setError("")
  }

  const removeActivity = (id) => {
    setActivities(prev => prev.filter(a => a.id !== id))
  }

  const goNext = () => {
    setError("")
    if (step === 1) {
      if (!destination.trim() || !startDate || !endDate) {
        setError("Please enter destination and travel dates")
        return
      }
    }
    if (step === 2) {
      if (!purpose.trim()) {
        setError("Please add business purpose")
        return
      }
      const invalid = activities.some(a => a.is_premium && !a.justification)
      if (invalid) {
        setError("Add justification for all premium/last-minute activities")
        return
      }
    }
    setStep(s => Math.min(3, s + 1))
  }

  const generatePlan = async () => {
    setLoading(true)
    setError("")
    setTripWarning("")
    try {
      const token = await getToken()
      const expensiveChoices = activities
        .filter(a => a.is_premium)
        .map(a => ({
          activity: a.name,
          estimated_cost: a.estimated_cost,
          reason: a.justification,
        }))

      const payload = {
        destination,
        start_date: startDate,
        end_date: endDate,
        business_purpose: purpose,
        activities: activities.map(a => ({
          activity: a.name,
          estimated_cost: a.estimated_cost,
          is_premium: a.is_premium,
          justification: a.justification,
        })),
        expensive_choices: expensiveChoices,
        company_id: companyId,
      }

      const r = await axios.post(`${API}/trip-plans/generate`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 45000,
      })

      setResult(r.data.plan || null)
      if (r?.data?.warning) {
        setTripWarning(r.data.warning)
      }
      await loadPlans()
      setStep(3)
    } catch (e) {
      if (e?.code === "ECONNABORTED") {
        setError("Generation timed out. Please try again in a few seconds.")
      } else {
        setError(e?.response?.data?.detail || e.message || "Failed to generate trip plan")
      }
    }
    setLoading(false)
  }

  const score = Math.max(0, Math.min(100, Number(result?.compliance_score || 0)))

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.textPrimary }}>Compliance-Aware Itinerary Architect</h1>
        <p style={{ margin: "4px 0 0", color: THEME.textSecond, fontSize: 14 }}>
          Build a pre-trip plan that is policy-compliant before you spend.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {[
          { id: 1, label: "Trip Basics", icon: MapPin },
          { id: 2, label: "Purpose & Activities", icon: Briefcase },
          { id: 3, label: "Compliance Plan", icon: WandSparkles },
        ].map(s => (
          <div key={s.id} style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: `1px solid ${step === s.id ? THEME.accent : THEME.border}`,
            color: step === s.id ? THEME.accent : THEME.textSecond,
            background: step === s.id ? "rgba(118,185,0,0.1)" : THEME.surface,
            fontSize: 12,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
            <s.icon size={14} /> {s.label}
          </div>
        ))}
      </div>

      <div style={{ background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 12, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(17,24,39,0.06)", padding: 18, marginBottom: 16 }}>
        {step === 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. New York" style={{ borderRadius: 8 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ borderRadius: 8 }} />
              <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ borderRadius: 8 }} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: THEME.textSecond, marginBottom: 6 }}>Business Purpose</label>
              <textarea
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Meeting a client in New York for 3 days for a product demo"
                style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, padding: 10, fontSize: 13, resize: "vertical" }}
              />
            </div>

            <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12, background: THEME.surfaceAlt }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 10 }}>Expected Activities</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, marginBottom: 8 }}>
                <input value={activityName} onChange={(e) => setActivityName(e.target.value)} placeholder="Dinner with client / Uber to HQ / Hotel near venue"
                  style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, fontSize: 12 }} />
                <input type="number" min="0" value={activityCost} onChange={(e) => setActivityCost(e.target.value)} placeholder="Est. cost"
                  style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, fontSize: 12 }} />
                <button onClick={addActivity} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(false) }}>+ Add</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <input id="premiumChoice" type="checkbox" checked={activityPremium} onChange={(e) => setActivityPremium(e.target.checked)} />
                <label htmlFor="premiumChoice" style={{ fontSize: 12, color: THEME.textSecond }}>Premium or last-minute option</label>
              </div>

              {activityPremium && (
                <textarea
                  rows={2}
                  value={activityJustification}
                  onChange={(e) => setActivityJustification(e.target.value)}
                  placeholder="Why is this higher-cost option needed? (This gets attached to the audit)"
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, color: THEME.textPrimary, padding: 10, fontSize: 12, marginBottom: 8 }}
                />
              )}

              {activities.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {activities.map(a => (
                    <div key={a.id} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surface, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.textPrimary }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: THEME.textSecond }}>
                          {a.estimated_cost ? `Estimated ${a.estimated_cost}` : "No estimate"}
                          {a.is_premium ? " • Premium/last-minute" : ""}
                        </div>
                        {!!a.justification && <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: 3 }}>{a.justification}</div>}
                      </div>
                      <button onClick={() => removeActivity(a.id)} style={{ border: `1px solid ${THEME.border}`, background: "transparent", color: THEME.textSecond, borderRadius: 6, fontSize: 11, padding: "4px 8px", cursor: "pointer", height: 28 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            {!result ? (
              <div style={{ color: THEME.textSecond, fontSize: 13 }}>Generate your policy-linked itinerary plan.</div>
            ) : (
              <div>
                <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "rgba(118,185,0,0.08)", border: `1px solid ${THEME.border}` }}>
                  <div style={{ fontSize: 12, color: THEME.textSecond, marginBottom: 6 }}>Likelihood of Approval</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: THEME.surfaceAlt, border: `1px solid ${THEME.border}`, overflow: "hidden" }}>
                      <div style={{ width: `${score}%`, height: "100%", background: "linear-gradient(90deg, #f59e0b 0%, #76b900 100%)" }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: THEME.accent }}>{score}%</div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Plane size={14} /> Transport Suggestions</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: THEME.textSecond, fontSize: 12, lineHeight: 1.7 }}>
                      {(result.transport_suggestions || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><BedDouble size={14} /> Lodging Caps</div>
                      <div style={{ fontSize: 12, color: THEME.textSecond, lineHeight: 1.7 }}>
                        {(result.lodging_caps?.summary) || "No lodging guidance available"}
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><UtensilsCrossed size={14} /> Food / Per Diem</div>
                      <div style={{ fontSize: 12, color: THEME.textSecond, lineHeight: 1.7 }}>
                        {(result.food_per_diem?.summary) || "No meal guidance available"}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><ShieldAlert size={14} /> Compliance Risk Summary</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: THEME.textSecond, fontSize: 12, lineHeight: 1.7 }}>
                      {(result.compliance_risk_summary || []).map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>

                  {!!(result.contextual_justification_prompts || []).length && (
                    <div style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${THEME.border}`, background: "rgba(245,158,11,0.08)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: THEME.amber, marginBottom: 6 }}>Justification Prompts</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#b45309", fontSize: 12, lineHeight: 1.7 }}>
                        {(result.contextual_justification_prompts || []).map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {!!error && <div style={{ marginTop: 12, fontSize: 12, color: "#dc2626" }}>{error}</div>}
        {!!tripWarning && <div style={{ marginTop: 8, fontSize: 12, color: THEME.amber }}>{tripWarning}</div>}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1 || loading}
            style={{
              padding: "8px 12px", fontSize: 12, borderRadius: 8,
              border: `1px solid ${THEME.border}`, background: "transparent", color: THEME.textSecond,
              cursor: step === 1 ? "not-allowed" : "pointer", opacity: step === 1 ? 0.45 : 1
            }}
          >
            Back
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {step < 3 && (
              <button onClick={goNext} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(false) }}>
                Next
              </button>
            )}
            <button onClick={generatePlan} disabled={loading} style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, ...primaryBtnStyle(loading) }}>
              {loading ? "Generating..." : "Generate Compliance Plan"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, #ffffff 0%, #f6f7f9 100%)", borderRadius: 12, border: `1px solid ${THEME.border}`, boxShadow: "0 1px 3px rgba(17,24,39,0.06)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${THEME.border}`, fontSize: 13, fontWeight: 700, color: THEME.textPrimary, display: "flex", alignItems: "center", gap: 6 }}>
          <CalendarDays size={14} /> Saved Pre-Trip Plans
        </div>
        {plans.length === 0 ? (
          <div style={{ padding: 18, color: THEME.textMuted, fontSize: 12 }}>No saved plans yet.</div>
        ) : (
          <div style={{ padding: 10, display: "grid", gap: 8 }}>
            {plans.slice(0, 8).map(p => (
              <div key={p.id} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: THEME.surfaceAlt }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textPrimary }}>{p.destination || "Destination"}</div>
                  <div style={{ fontSize: 11, color: THEME.accent }}>Score {Number(p.compliance_score || 0)}%</div>
                </div>
                <div style={{ fontSize: 11, color: THEME.textSecond }}>
                  {(p.start_date || "—")} to {(p.end_date || "—")} • {(p.created_at || "").split("T")[0] || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Available Expenses Page ───────────────────────────────────────────────────

export default TripPlannerPage
