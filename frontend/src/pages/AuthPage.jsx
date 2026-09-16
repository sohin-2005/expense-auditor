import { useState, useEffect, useRef } from "react"
import { ShieldCheck, ScanLine, Compass, BadgeCheck, ArrowRight, ArrowLeft } from "lucide-react"
import axios from "axios"
import { supabase } from "../supabase"
import { API, API_TIMEOUT_MS } from "../lib/api"
import { THEME, S, R, T, SHADOW, BRAND_LOGO } from "../theme/tokens"
import { Input } from "../components/ui"
import { useIsMobile } from "../lib/useIsMobile"

// The landing state shows the product and nothing else. Credentials appear
// only when someone asks for them, which is both calmer to arrive at and
// honest about the order of things: you decide what this is before you decide
// to sign in.
const PILLARS = [
  { Icon: ScanLine, title: "Scan a receipt",
    body: "Photograph it. Merchant, amount and date come back structured." },
  { Icon: ShieldCheck, title: "Audited on capture",
    body: "Checked against your policy the moment it lands — not weeks later." },
  { Icon: Compass, title: "Plan before you spend",
    body: "Price a trip against the same rules while you can still change it." },
  { Icon: BadgeCheck, title: "Every verdict is cited",
    body: "Approved or flagged, the exact policy clause is attached." },
]

export default function AuthPage({ onAuth }) {
  const isMobile = useIsMobile(900)
  // "landing" -> the product, full bleed. "login" / "register" -> the form.
  const [view, setView] = useState("landing")
  const [mounted, setMounted] = useState(false)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [companyId, setCompanyId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const emailRef = useRef(null)

  // Registration now collects a security question, because it is the only
  // way back into an account without outbound email configured.
  const [questions, setQuestions] = useState([])
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")

  // Recovery is a three-step panel: email -> answer the question -> new
  // password. Kept in this component so the background never changes.
  const [resetStep, setResetStep] = useState(0)
  const [resetQuestion, setResetQuestion] = useState("")
  const [newPassword, setNewPassword] = useState("")

  useEffect(() => {
    if (view !== "register" || questions.length) return
    axios.get(`${API}/auth/security-questions`, { timeout: API_TIMEOUT_MS })
      .then(r => setQuestions(r.data?.questions || []))
      .catch(() => setQuestions([]))
  }, [view, questions.length])

  // One frame after mount, so the entrance transition has a "from" state to
  // animate out of rather than snapping.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Focus the first field when the panel opens — someone who clicked "Sign in"
  // has already said what they want to do next.
  useEffect(() => {
    if (view !== "landing") {
      const id = setTimeout(() => emailRef.current?.focus(), 320)
      return () => clearTimeout(id)
    }
  }, [view])

  // Escape returns to the landing view, matching every other dismissible panel.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && view !== "landing") setView("landing") }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view])

  const register = view === "register"
  const showForm = view !== "landing"

  const handle = async () => {
    setLoading(true); setError(""); setNotice("")
    try {
      if (register) {
        if (!name.trim()) throw new Error("Please enter your full name.")
        if (!companyId.trim()) throw new Error("Please enter your company ID.")
        if (!question) throw new Error("Choose a security question.")
        if (answer.trim().length < 3) throw new Error("Your security answer is too short.")
        // Server-side, not supabase.auth.signUp from the browser: the role is
        // set on the server and cannot be chosen, the security answer is
        // hashed before storage, and company_id is normalised so "Google" and
        // "google" stop becoming two separate companies.
        await axios.post(`${API}/auth/register`, {
          email, password, full_name: name.trim(), company_id: companyId.trim(),
          security_question: question, security_answer: answer,
        }, { timeout: API_TIMEOUT_MS })
        setView("login")
        setNotice("Account created. Sign in to continue.")
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        const profile = await supabase.from("profiles").select("*").eq("id", data.user.id).single()
        onAuth(data.user, data.session, profile.data)
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Something went wrong. Please try again.")
    }
    setLoading(false)
  }

  const lookupQuestion = async () => {
    setLoading(true); setError(""); setNotice("")
    try {
      const r = await axios.post(`${API}/auth/forgot-password`, { email },
                                 { timeout: API_TIMEOUT_MS })
      setResetQuestion(r.data.question)
      setResetStep(2)
    } catch (e) {
      setError(e.response?.data?.detail || "Could not start a reset. Try again shortly.")
    }
    setLoading(false)
  }

  const submitReset = async () => {
    setLoading(true); setError(""); setNotice("")
    try {
      await axios.post(`${API}/auth/reset-password`,
        { email, answer, new_password: newPassword }, { timeout: API_TIMEOUT_MS })
      setView("login"); setResetStep(0); setAnswer(""); setNewPassword("")
      setPassword("")
      setNotice("Password changed. Sign in with your new password.")
    } catch (e) {
      setError(e.response?.data?.detail || "Could not reset your password.")
    }
    setLoading(false)
  }

  const field = {
    borderRadius: R.sm, padding: "11px 12px", fontSize: 14,
    background: "rgba(255,255,255,0.04)", color: "#f4f7ee",
    border: "1px solid rgba(244,247,238,0.16)",
  }

  return (
    <div style={{
      minHeight: "100vh", position: "relative", overflow: "hidden",
      background: "linear-gradient(155deg, #0d1208 0%, #16210c 45%, #24350f 100%)",
      color: "#f4f7ee",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    }}>
      <Ambience />

      {/* ── brand, always present ── */}
      <header style={{
        position: "relative", zIndex: 3,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? `${S.lg}px ${S.lg}px` : `${S.xl}px ${S.xxl}px`,
        opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(-8px)",
        transition: "opacity .5s ease, transform .5s ease",
      }}>
        <button
          onClick={() => setView("landing")}
          aria-label="Audixa home"
          style={{
            display: "flex", alignItems: "center", gap: S.sm,
            background: "none", border: "none", padding: 0,
            cursor: showForm ? "pointer" : "default", fontFamily: "inherit",
          }}>
          <img src={BRAND_LOGO} alt="" width={26} height={26} style={{ borderRadius: R.sm }} />
          <span style={{ fontWeight: 800, letterSpacing: "0.05em", fontSize: 15 }}>
            <span style={{ color: "#ffffff" }}>AUDI</span>
            <span style={{ color: "#a3e635" }}>XA</span>
          </span>
        </button>

        {showForm && (
          <button onClick={() => setView("landing")} style={ghostBtn}>
            <ArrowLeft size={14} strokeWidth={2} /> Back
          </button>
        )}
      </header>

      {/* ── landing ── */}
      <section
        aria-hidden={showForm}
        style={{
          position: "relative", zIndex: 2,
          padding: isMobile ? `${S.lg}px ${S.lg}px ${S.xxl}px` : `0 ${S.xxl}px`,
          maxWidth: 1080, margin: "0 auto",
          minHeight: isMobile ? "auto" : "62vh",
          display: "flex", flexDirection: "column", justifyContent: "center",
          // Recedes rather than disappears, so the background stays the
          // continuous thing and the form feels layered over it.
          opacity: showForm ? 0 : (mounted ? 1 : 0),
          transform: showForm ? "translateY(-18px) scale(0.985)"
                              : (mounted ? "none" : "translateY(14px)"),
          filter: showForm ? "blur(3px)" : "none",
          pointerEvents: showForm ? "none" : "auto",
          transition: "opacity .45s ease, transform .55s cubic-bezier(.22,1,.36,1), filter .45s ease",
        }}>
        <h1 style={{
          fontSize: isMobile ? 32 : 50, fontWeight: 800, lineHeight: 1.1,
          letterSpacing: "-0.03em", margin: `0 0 ${S.lg}px`, maxWidth: "16ch",
          textWrap: "balance",
        }}>
          Your expense policy,{" "}
          <span style={{ color: "#a3e635" }}>enforced at the moment of spend.</span>
        </h1>

        <p style={{
          fontSize: isMobile ? 15 : 17, lineHeight: 1.65, margin: `0 0 ${S.xl}px`,
          color: "rgba(244,247,238,0.7)", maxWidth: "56ch",
        }}>
          Most expense tools find the violation weeks later, during reimbursement
          review. Audixa moves the check to the two moments where it can still
          change the outcome.
        </p>

        <div style={{ display: "flex", gap: S.md, flexWrap: "wrap", marginBottom: S.xxl }}>
          <button onClick={() => setView("login")} style={primaryCta}>
            Sign in <ArrowRight size={15} strokeWidth={2.2} />
          </button>
          <button onClick={() => setView("register")} style={secondaryCta}>
            Create an account
          </button>
        </div>

        <ul style={{
          listStyle: "none", padding: 0, margin: 0, display: "grid", gap: S.lg,
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(216px, 1fr))",
        }}>
          {PILLARS.map(({ Icon, title, body }, i) => (
            <li key={title} style={{
              display: "flex", gap: S.md, alignItems: "flex-start",
              opacity: mounted && !showForm ? 1 : 0,
              transform: mounted && !showForm ? "none" : "translateY(12px)",
              // Staggered so the four read as a sequence rather than a flash.
              transition: `opacity .5s ease ${0.18 + i * 0.09}s, transform .5s ease ${0.18 + i * 0.09}s`,
            }}>
              <span style={{
                display: "grid", placeItems: "center", flexShrink: 0,
                width: 32, height: 32, borderRadius: R.sm,
                background: "rgba(163,230,53,0.13)",
                border: "1px solid rgba(163,230,53,0.22)",
              }}>
                <Icon size={15} strokeWidth={1.9} color="#a3e635" />
              </span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 12.5, color: "rgba(244,247,238,0.6)", lineHeight: 1.55 }}>
                  {body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── form, revealed on demand ── */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget) setView("landing") }}
        style={{
          position: "fixed", inset: 0, zIndex: 4,
          display: "grid", placeItems: "center",
          padding: isMobile ? S.lg : S.xl,
          background: showForm ? "rgba(8,11,5,0.55)" : "transparent",
          backdropFilter: showForm ? "blur(6px)" : "none",
          WebkitBackdropFilter: showForm ? "blur(6px)" : "none",
          opacity: showForm ? 1 : 0,
          pointerEvents: showForm ? "auto" : "none",
          transition: "opacity .35s ease, backdrop-filter .35s ease",
        }}>
        <div
          role="dialog"
          aria-modal={showForm}
          aria-label={register ? "Create an account" : "Sign in"}
          style={{
            width: "100%", maxWidth: 396,
            background: "rgba(19,26,12,0.92)",
            border: "1px solid rgba(244,247,238,0.13)",
            borderRadius: R.lg, padding: isMobile ? S.lg : S.xl,
            boxShadow: SHADOW.overlay,
            transform: showForm ? "none" : "translateY(16px) scale(0.97)",
            transition: "transform .4s cubic-bezier(.22,1,.36,1)",
          }}>
          <h2 style={{ ...T.display, color: "#f4f7ee", margin: `0 0 ${S.xs}px` }}>
            {register ? "Create your account" : "Welcome back"}
          </h2>
          <p style={{ ...T.small, color: "rgba(244,247,238,0.6)", margin: `0 0 ${S.lg}px` }}>
            {register
              ? "You'll start as an employee. Approver access is granted by your finance team."
              : "Sign in to submit expenses and track your claims."}
          </p>

          {resetStep > 0 ? (
            <div onKeyDown={(e) => { if (e.key === "Enter" && !loading) {
              resetStep === 1 ? lookupQuestion() : submitReset()
            } }}>
              <Input label="Work email" type="email" value={email} style={field}
                     autoComplete="email" disabled={resetStep === 2}
                     onChange={e => setEmail(e.target.value)}
                     placeholder="you@company.com" />

              {resetStep === 2 && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 650, color: "#a3e635",
                                margin: `0 0 ${S.xs}px` }}>
                    {resetQuestion}
                  </div>
                  <Input label="Your answer" value={answer} style={field}
                         onChange={e => setAnswer(e.target.value)} />
                  <Input label="New password" type="password" value={newPassword}
                         style={field} autoComplete="new-password"
                         onChange={e => setNewPassword(e.target.value)}
                         placeholder="At least 8 characters" />
                </>
              )}

              {notice && <Flash tone="good">{notice}</Flash>}
              {error && <Flash tone="bad">{error}</Flash>}

              <button
                onClick={resetStep === 1 ? lookupQuestion : submitReset}
                disabled={loading || !email || (resetStep === 2 && (!answer || !newPassword))}
                style={{
                  width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 700,
                  fontFamily: "inherit", borderRadius: R.sm, border: "none",
                  marginTop: S.xs, cursor: loading ? "not-allowed" : "pointer",
                  color: "#0b1005",
                  background: "linear-gradient(135deg, #a3e635 0%, #76b900 100%)",
                }}>
                {loading ? "Working…"
                  : resetStep === 1 ? "Find my security question" : "Reset password"}
              </button>

              <p style={{ ...T.small, color: "rgba(244,247,238,0.55)", textAlign: "center",
                          margin: `${S.md}px 0 0` }}>
                <button onClick={() => { setResetStep(0); setError(""); setNotice("") }}
                        style={{ background: "none", border: "none", padding: 0,
                                 cursor: "pointer", color: "#a3e635", fontWeight: 700,
                                 fontSize: 12, fontFamily: "inherit",
                                 textDecoration: "underline", textUnderlineOffset: 2 }}>
                  Back to sign in
                </button>
              </p>
            </div>
          ) : (
          <div onKeyDown={(e) => { if (e.key === "Enter" && !loading) handle() }}>
            {register && (
              <>
                <Input label="Full name" value={name} autoComplete="name" style={field}
                       onChange={e => setName(e.target.value)} placeholder="Jordan Ellis" />
                <Input label="Company ID" value={companyId} autoComplete="organization"
                       style={field} onChange={e => setCompanyId(e.target.value)}
                       placeholder="e.g. acmecorp" />
              </>
            )}
            {register && (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600,
                                color: "rgba(244,247,238,0.75)", marginBottom: 5 }}>
                  Security question
                </label>
                <select value={question} onChange={e => setQuestion(e.target.value)}
                        style={{ ...field, width: "100%", marginBottom: 14,
                                 boxSizing: "border-box", fontFamily: "inherit" }}>
                  <option value="">Choose a question…</option>
                  {questions.map(q => (
                    <option key={q} value={q} style={{ color: "#111827" }}>{q}</option>
                  ))}
                </select>
                <Input label="Your answer" value={answer} style={field}
                       onChange={e => setAnswer(e.target.value)}
                       placeholder="Something only you would know" />
                <div style={{ fontSize: 11, color: "rgba(244,247,238,0.5)",
                              marginTop: -8, marginBottom: 14, lineHeight: 1.5 }}>
                  This is the only way back into your account if you forget your
                  password. It is hashed before storage, like a password.
                </div>
              </>
            )}
            <Input ref={emailRef} label="Work email" type="email" value={email}
                   autoComplete="email" style={field}
                   onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
            <Input label="Password" type="password" value={password} style={field}
                   autoComplete={register ? "new-password" : "current-password"}
                   onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

          {notice && <Flash tone="good">{notice}</Flash>}
          {error && <Flash tone="bad">{error}</Flash>}

          <button
            onClick={handle}
            disabled={loading || !email || !password}
            style={{
              width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 700,
              fontFamily: "inherit", borderRadius: R.sm, border: "none",
              marginTop: S.xs,
              cursor: (loading || !email || !password) ? "not-allowed" : "pointer",
              color: (loading || !email || !password) ? "rgba(244,247,238,0.35)" : "#0b1005",
              background: (loading || !email || !password)
                ? "rgba(244,247,238,0.08)"
                : "linear-gradient(135deg, #a3e635 0%, #76b900 100%)",
              transition: "all .18s ease",
            }}>
            {loading ? (register ? "Creating account…" : "Signing in…")
                     : (register ? "Create account" : "Sign in")}
          </button>

          {!register && (
            <p style={{ ...T.small, textAlign: "center", margin: `${S.sm}px 0 0` }}>
              <button onClick={() => { setResetStep(1); setError(""); setNotice("") }}
                      style={{ background: "none", border: "none", padding: 0,
                               cursor: "pointer", color: "rgba(244,247,238,0.6)",
                               fontSize: 12, fontFamily: "inherit",
                               textDecoration: "underline", textUnderlineOffset: 2 }}>
                Forgot your password?
              </button>
            </p>
          )}
          </div>
          )}

          <p style={{ ...T.small, color: "rgba(244,247,238,0.55)", textAlign: "center",
                      margin: `${S.md}px 0 0` }}>
            {register ? "Already have an account?" : "New to Audixa?"}{" "}
            <button
              onClick={() => { setView(register ? "login" : "register"); setError(""); setNotice("") }}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: "#a3e635", fontWeight: 700, fontSize: 12, fontFamily: "inherit",
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>
              {register ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </div>

      <footer style={{
        position: "relative", zIndex: 2, textAlign: "center",
        padding: `${S.lg}px`, fontSize: 11.5, color: "rgba(244,247,238,0.32)",
        opacity: showForm ? 0 : 1, transition: "opacity .3s ease",
      }}>
        Receipts are stored privately and served through short-lived links.
      </footer>
    </div>
  )
}

// Slow drifting glows. Two of them, well under the content, at low opacity:
// enough to make the page feel alive, not enough to compete with the words.
// Disabled entirely under prefers-reduced-motion.
function Ambience() {
  return (
    <>
      <style>{`
        @keyframes audixaDriftA {
          0%,100% { transform: translate(-8%, -6%) scale(1); }
          50%     { transform: translate(6%, 8%) scale(1.14); }
        }
        @keyframes audixaDriftB {
          0%,100% { transform: translate(10%, 4%) scale(1.08); }
          50%     { transform: translate(-6%, -8%) scale(0.94); }
        }
        @media (prefers-reduced-motion: reduce) {
          .audixa-orb { animation: none !important; }
        }
      `}</style>
      <div className="audixa-orb" aria-hidden="true" style={{
        position: "absolute", top: "-18%", left: "-10%",
        width: "58vw", height: "58vw", maxWidth: 760, maxHeight: 760,
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(circle, rgba(118,185,0,0.22) 0%, rgba(118,185,0,0) 68%)",
        animation: "audixaDriftA 26s ease-in-out infinite",
      }} />
      <div className="audixa-orb" aria-hidden="true" style={{
        position: "absolute", bottom: "-24%", right: "-12%",
        width: "52vw", height: "52vw", maxWidth: 680, maxHeight: 680,
        borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(circle, rgba(163,230,53,0.15) 0%, rgba(163,230,53,0) 70%)",
        animation: "audixaDriftB 32s ease-in-out infinite",
      }} />
    </>
  )
}

const Flash = ({ tone, children }) => (
  <div role={tone === "bad" ? "alert" : "status"} style={{
    margin: `${S.sm}px 0`, padding: `${S.sm}px ${S.md}px`, borderRadius: R.sm,
    fontSize: 12.5, fontWeight: 600,
    background: tone === "bad" ? "rgba(220,38,38,0.16)" : "rgba(163,230,53,0.14)",
    color: tone === "bad" ? "#fca5a5" : "#bef264",
  }}>{children}</div>
)

const primaryCta = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "13px 22px", fontSize: 14.5, fontWeight: 700, fontFamily: "inherit",
  borderRadius: R.sm, border: "none", cursor: "pointer", color: "#0b1005",
  background: "linear-gradient(135deg, #a3e635 0%, #76b900 100%)",
  boxShadow: "0 6px 20px rgba(118,185,0,0.28)",
  transition: "transform .16s ease, box-shadow .16s ease",
}

const secondaryCta = {
  display: "inline-flex", alignItems: "center",
  padding: "13px 22px", fontSize: 14.5, fontWeight: 650, fontFamily: "inherit",
  borderRadius: R.sm, cursor: "pointer", color: "#f4f7ee",
  background: "rgba(244,247,238,0.06)",
  border: "1px solid rgba(244,247,238,0.18)",
  transition: "background .16s ease",
}

const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 13px", fontSize: 12.5, fontWeight: 650, fontFamily: "inherit",
  borderRadius: R.sm, cursor: "pointer", color: "rgba(244,247,238,0.8)",
  background: "rgba(244,247,238,0.06)",
  border: "1px solid rgba(244,247,238,0.16)",
}
