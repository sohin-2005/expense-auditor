import { useState } from "react"
import axios from "axios"
import { MessageCircleQuestion } from "lucide-react"
import { API, API_TIMEOUT_MS, getToken } from "../lib/api"
import { THEME, primaryBtnStyle } from "../theme/tokens"

function PolicyAskCard({ profile }) {
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState("")

  const ask = async () => {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true); setError(""); setAnswer(null)
    try {
      const token = await getToken()
      const r = await axios.post(`${API}/policy/ask`,
        { question: q, company_id: profile?.company_id || "default" },
        { headers: { Authorization: `Bearer ${token}` }, timeout: API_TIMEOUT_MS })
      setAnswer(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not get an answer. Try again.")
    }
    setAsking(false)
  }

  const confidenceColor = { High: THEME.green, Medium: THEME.amber, Low: THEME.red }

  return (
    <div style={{ background: THEME.surface, borderRadius: 12, padding: 24, border: `1px solid ${THEME.border}`, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <MessageCircleQuestion size={17} strokeWidth={1.8} color={THEME.accent} />
        <div style={{ fontSize: 15, fontWeight: 700, color: THEME.textPrimary }}>Ask the Policy</div>
      </div>
      <div style={{ fontSize: 12, color: THEME.textSecond, marginBottom: 14 }}>
        Get instant answers grounded in your uploaded policy — before you spend.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === "Enter" && ask()}
          placeholder='e.g. "What is the hotel limit for Mumbai?"'
          style={{ flex: 1, padding: "10px 12px", fontSize: 13, border: `1px solid ${THEME.border}`, borderRadius: 8, background: THEME.surfaceAlt, color: THEME.textPrimary, outline: "none" }}
        />
        <button onClick={ask} disabled={asking || !question.trim()} style={{ padding: "10px 18px", fontSize: 13, fontWeight: 700, ...primaryBtnStyle(asking || !question.trim()) }}>
          {asking ? "Thinking…" : "Ask"}
        </button>
      </div>
      {error && <div style={{ marginTop: 12, padding: 12, background: THEME.redDim, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, color: THEME.red, fontSize: 13 }}>{error}</div>}
      {answer && (
        <div style={{ marginTop: 14, padding: 16, background: THEME.surfaceAlt, borderRadius: 10, border: `1px solid ${THEME.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: THEME.textSecond, letterSpacing: "0.05em" }}>ANSWER</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: confidenceColor[answer.confidence] || THEME.textMuted }}>
              Confidence: {answer.confidence}
            </span>
          </div>
          <div style={{ fontSize: 14, color: THEME.textPrimary, lineHeight: 1.65 }}>{answer.answer}</div>
          {answer.policy_snippet && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderLeft: `3px solid ${THEME.accent}`, background: THEME.accentDim, borderRadius: "0 8px 8px 0", fontSize: 12, color: THEME.textSecond, fontStyle: "italic" }}>
              {/* When policy_section is present the quote was copied from the
                  cited chunk, so it is the document talking rather than the
                  model's recollection of it. Naming the section is what makes
                  that difference visible. */}
              {answer.policy_section && (
                <div style={{ fontStyle: "normal", fontWeight: 700, color: THEME.accent, marginBottom: 4, fontSize: 11 }}>
                  {answer.policy_section}
                </div>
              )}
              “{answer.policy_snippet}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PolicyAskCard
