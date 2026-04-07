# Approach Document — Audixa (Policy-First Expense Auditor)

## 1) Objective
Build a policy-first platform that reduces reimbursement delays and non-compliant spend by validating expenses early (at capture/planning time), not only at final finance review.

---

## 2) Problem Framing
Traditional workflows are reactive:
- Employees spend first and submit later.
- Finance manually validates receipts against long policy documents.
- Rework, delays, and inconsistent decisions increase operational cost.

Audixa addresses this by combining AI extraction, policy-aware auditing, and pre-trip compliance planning.

---

## 3) Core Approach

### A. Policy-Centric Architecture
- Company policy PDF is uploaded and converted to text.
- Policy text is stored per company and reused by all audit/planning flows.
- The same policy context drives both:
  - receipt-level audits
  - pre-trip itinerary compliance suggestions

### B. AI-Assisted Expense Pipeline
1. Receipt ingestion (image/PDF)
2. OCR extraction (merchant, date, amount, category, etc.)
3. Policy audit prompt generation
4. Structured decision output (`Approved`, `Flagged`, `Rejected`) with reason/snippet
5. Persisted expense + claim status sync

### C. Claim Lifecycle Integrity
- Claim status is treated as authoritative in the claims table.
- Expense-level derived status is used as a helper signal, not as a hard overwrite of manual/manager decisions.
- This ensures dashboard, notifications, and approvals stay consistent.

### D. Pre-Trip Planning (Compliance-Aware Itinerary Architect)
- Employee enters destination, dates, purpose, and planned activities.
- AI returns:
  - transport guidance
  - lodging cap interpretation
  - meal/per-diem limits
  - compliance risks
  - approval likelihood score
  - justification prompts for premium/last-minute choices
- Plan is saved for future cross-reference during reimbursement.

---

## 4) RAG-Inspired Policy Retrieval Strategy
Although lightweight, the implementation follows a retrieval-first pattern:
- Policy text is cached and context-trimmed before model calls.
- Relevant sections are selected using payload-aware keyword matching.
- Smaller focused prompts improve reliability, reduce latency, and lower token usage.

This applies to both expense auditing and pre-trip plan generation.

---

## 5) Reliability & Performance Strategy

### A. API Reliability
- Retries with backoff for model calls.
- Safe JSON parsing for partially malformed model outputs.
- Graceful fallback responses when model/provider is unavailable.

### B. Latency Optimizations
- Fast mode configuration for lower token budgets and fewer retries.
- Policy caching to avoid repeated DB fetches.
- Prompt/context size reduction.
- Paginated read endpoints for heavy list pages.

### C. Frontend Resilience
- Request timeouts for dashboard/notification polling.
- Independent endpoint resolution (`Promise.allSettled`) to avoid full-page blocking.
- Loading state finalization in all code paths.

---

## 6) Data Model & Traceability
Main entities:
- `policies`
- `expenses`
- `claims`
- `travel_plans`
- `profiles`

Design goal:
- every decision is explainable (`reason`, `policy_snippet`)
- every stage is cross-referenceable (pre-trip plan → actual receipt)

---

## 7) Security & Access
- Supabase Auth with bearer token validation in backend.
- User-scoped fetches (`employee_id`) for claims/expenses/plans.
- Role-based operations for manager/finance approvals.

---

## 8) UX Principles Used
- Dark, consistent enterprise UI language across modules.
- Minimal friction data capture (manual + OCR paths).
- Immediate status visibility through dashboard cards and notifications.
- Decision confidence via compliance score and policy-linked explanations.

---

## 9) Expected Impact
- Faster reimbursements
- Reduced non-compliant spend leakage
- Lower manual review load for finance
- Better employee confidence before spending (pre-trip guidance)
- Stronger audit trail and explainability

---

## 10) Future Enhancements
- True semantic retrieval over policy chunks (vector index)
- Background async job queue for OCR/audit
- Websocket or server-sent event updates for real-time status
- Policy versioning with diff-aware audit reasoning
- Automated receipt-to-plan matching confidence scoring
