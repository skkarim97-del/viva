# Engagement / Operational Alerts — Implementation Plan

**Status:** Proposal (not implemented)  
**Date:** 2026-05-11  
**Companion doc:** `docs/escalation-rules.md §7`

---

## Scope and separation

Engagement alerts are **operationally distinct from clinical escalations** and must be implemented as a separate layer. See `docs/escalation-rules.md §7` for the conceptual separation. This document covers how to build it.

---

## 1. Is there an existing table or event model we can reuse?

**Short answer: yes, for most signals. No new tables needed for pilot v1.**

### What already exists in the database

| Signal | Existing source | Notes |
|---|---|---|
| Invited but not activated | `patients.activation_token_issued_at` + `patients.activated_at IS NULL` | `inviteAgeHours` already computed in `GET /api/patients` response |
| Activated but no first check-in | `patients.activated_at IS NOT NULL` + no row in `patient_checkins` | Already computed as `noCheckinAfterInvite` in internal metrics |
| No check-in for N days | `max(patient_checkins.date) < now() - N days` | Already computed as `dropoff3/5/7` buckets in internal metrics |
| Re-engagement needed (had prior activity, then went silent) | Same `patient_checkins` query — filter for patients with ≥ 3 check-ins + last check-in > 5 days ago | Subset of the existing dropoff query; no new table |
| Invite resent multiple times | `patients.activation_token_issued_at` resets on each resend — **the resend count is not currently stored** | This signal would require either a counter column or a log entry to track. Only candidate that needs a schema addition. |

### What the patient list API already returns per-patient

`GET /api/patients` (doctor-scoped) already includes:
- `inviteAgeHours` — hours since invite was issued (refreshes on resend)
- `staleInvite` — boolean, true when `inviteAgeHours >= 48`
- `inactive12d` — boolean, true when patient has been inactive for 12+ days
- `lastCheckin` — date string of most recent check-in
- `status` — `"invited"` | `"activated"` | `"monitoring"`
- `pending` — true for invited or activated-but-no-checkin patients

All alert conditions except "invite friction" (resend count) can be **computed client-side** from fields already returned by this endpoint. No new API routes or DB queries are strictly required for pilot v1.

### Verdict

**Compute dynamically from existing data for pilot v1.** This avoids a schema migration, a new table, and a new write path. The downside is that the alerts are point-in-time (recomputed on page load) rather than persistent records — acceptable for pilot v1 where the dashboard is the primary interface.

If a future requirement is to *acknowledge* or *dismiss* an engagement alert and have that persist, a lightweight `engagement_alerts` table would be the right model at that point.

---

## 2. Storage: separate records vs. computed dynamically?

**Recommendation: computed dynamically for pilot v1.**

| Approach | Pros | Cons |
|---|---|---|
| **Computed dynamically** (recommended) | No schema change, no migration, no write path, no staleness | Point-in-time only; can't acknowledge/dismiss; no history |
| **Stored alert records** | Persistent; can be acknowledged; auditable | Requires new table + write path + migration; must handle deduplication; adds complexity before clinical value is validated |

The stored approach makes sense once providers have validated that engagement alerts are actionable and worth tracking over time. For a first pilot cohort, the dashboard showing "this patient hasn't checked in in 5 days" is sufficient.

---

## 3. Where should engagement alerts appear in Viva Clinic?

**Recommendation: a collapsible "Engagement" section in the existing patient list, below the clinical buckets.**

### Option A — Collapsible "Engagement" section (recommended)

Add a new collapsible section to `PatientsPage.tsx` below the existing action buckets (needs_followup → monitor → stable → pending). Section renders patients with one or more active engagement signals, grouped by alert severity.

```
[ Patient Requested Review  (2) ]    ← clinical, always top
[ Needs Follow-Up           (3) ]    ← risk-scored clinical
[ Monitoring                (5) ]
[ Stable                    (8) ]
[ Pending activation        (2) ]    ← existing pending section
[▸ Engagement alerts        (4) ]    ← new collapsible section
   └─ Engagement risk: [Patient A] — 7 days silent
   └─ No first check-in: [Patient B] — activated 3 days ago
   └─ Activation pending: [Patient C] — invite sent 5 days ago
[ Archived                  (1) ]    ← existing, hidden by default
```

**Why below clinical buckets:** engagement alerts are lower urgency. The clinical queue must remain visually dominant.

**Why collapsible:** providers with a busy panel should not see 12 engagement alert rows on every page load. The section header can show a count badge so the signal is visible without the noise.

### Option B — Patient list badge

Add an inline badge (`Engagement risk`, `No first check-in`) to existing patient cards rather than a separate section. Simpler to implement but harder to scan — the badge is easy to miss when the card has other indicators.

### Option C — Pilot analytics only

Surface engagement signals only in `GET /api/internal/metrics` (already exists) and the pilot analytics dashboard. Providers never see per-patient engagement alerts. This is the lowest-touch option but removes the per-patient accountability signal that providers need to take action.

### Option D — Review Now queue

Add engagement alerts to the existing "Patient Requested Review" section with a different badge style. **Not recommended** — this merges clinical and operational signals into one queue, creating the urgency ambiguity the separation is designed to prevent.

**Recommended path:** Option A for pilot v1, with Option C as a fallback if dashboard changes are not in scope.

---

## 4. Should providers receive email for engagement alerts?

**Recommendation: dashboard-only for pilot v1. Revisit a daily digest in phase 2.**

The current clinical escalation email fires per-event and goes to the assigned doctor immediately. Applying the same cadence to engagement alerts would:
- Produce 4-6x more email volume than clinical escalations
- Blur the urgency signal (is this email "patient is in crisis" or "patient hasn't logged in")
- Risk providers marking all Viva emails as spam if the volume becomes noise

### Proposed phasing

| Phase | Mechanism | Timing |
|---|---|---|
| **v1 (pilot)** | Dashboard-only — engagement alerts visible in the collapsible section | Launch |
| **v2 (post-pilot validation)** | Once-daily provider digest: "3 patients need engagement follow-up" + list with labels | After pilot feedback confirms alerts are actionable |
| **v3 (future)** | Per-event email for severe signals only (e.g., `Engagement risk` = 5+ days silent for previously-active patient) | After v2 demonstrates digest is insufficient |

If a daily digest is added, it must:
- Use a distinct email template from clinical escalations
- Be clearly labeled as an operational/workflow summary, not a clinical alert
- Be suppressible per-doctor (opt-out)
- Contain no PHI in subject or preview text (same rule as `emailSafe.ts`)

---

## 5. Which alerts count toward pilot metrics?

All six proposed engagement signals already have corresponding aggregate counters in `GET /api/internal/metrics` (computed in `artifacts/api-server/src/routes/internal.ts`):

| Alert | Pilot metric field | Notes |
|---|---|---|
| Invited but not activated (72h) | `noCheckinAfterInvite` (proxy) | Counts patients with no check-in ever; 72h filter would need a sub-query tweak |
| No first check-in (24h) | `noCheckinAfterInvite` | Same field; add 24h threshold to complement |
| Engagement slipping (3d) | `dropoff.threeDaysPlus` | Already exists |
| Engagement risk (5d) | `dropoff.fiveDaysPlus` | Already exists |
| Re-engagement needed (had ≥3 checkins, silent 5d) | Subset of `dropoff.fiveDaysPlus` | Already computed; not yet exposed as its own metric |
| Invite friction | Not tracked | Would need resend count column to measure |

**No new pilot metric definitions are required for the five timestamp-based alerts.** They are subsets or refinements of existing `dropoff` and `noCheckinAfterInvite` buckets. Adding them to the per-patient dashboard view doesn't require changing the aggregate metrics endpoint.

---

## 6. Smallest safe implementation for pilot v1

Ordered by ascending complexity. Implement only what's needed, in order.

### Step 0 — Already done (no work needed)

- Aggregate engagement metrics: `noCheckinAfterInvite`, `dropoff3/5/7` in `GET /api/internal/metrics` ✅
- Per-patient signals: `inviteAgeHours`, `staleInvite`, `inactive12d`, `lastCheckin`, `status` in `GET /api/patients` ✅
- Stale invite chip in PendingCard (≥48h, already rendered) ✅
- Invite expiry chip in PendingCard (≤3 days TTL, added in PR #10) ✅

### Step 1 — Add `daysSinceLastCheckin` and `hadPriorEngagement` to patient list API

**File:** `artifacts/api-server/src/routes/patients.ts`

Add two computed fields to the patient row shape:
- `daysSinceLastCheckin: number | null` — `null` for never-checked-in patients; integer days for all others
- `hadPriorEngagement: boolean` — true if patient has ≥ 3 historical check-ins (distinguishes true disengagement from weak activation)

Both are derivable from the `byPatient` map already built in the route — no additional DB query.

### Step 2 — Add engagement alert classification function

**File:** `artifacts/viva-dashboard/src/lib/engagementAlerts.ts` (new)

A pure function that takes a `PatientRow` and returns one or more `EngagementAlert` objects:

```typescript
type EngagementAlertKind =
  | "activation_pending"     // invited, not activated, >72h
  | "no_first_checkin"       // activated, no check-in, >24h
  | "engagement_slipping"    // last check-in 3-4 days ago
  | "engagement_risk"        // last check-in 5+ days ago
  | "reengagement_needed"    // had ≥3 check-ins, silent 5+ days

interface EngagementAlert {
  kind: EngagementAlertKind;
  label: string;        // display label for the UI chip
  description: string;  // one-line explanation for the card
}

export function classifyEngagementAlerts(p: PatientRow): EngagementAlert[]
```

Pure function — no fetch, no side effects. Testable without a running server.

### Step 3 — Add collapsible Engagement section to PatientsPage

**File:** `artifacts/viva-dashboard/src/pages/PatientsPage.tsx`

- Compute engagement alerts for every patient client-side using Step 2 function
- Filter to patients with ≥ 1 alert and no active clinical escalation (patients already in "Patient Requested Review" should not also appear in the Engagement section — clinical takes priority)
- Render a collapsible section below the Pending section with a count badge
- Each row shows the patient name, the alert label chip, and a "Resend" or "Copy link" quick action where applicable

**Dashboard position:**
```
Patient Requested Review  (clinical — always visible at top)
Needs Follow-Up
Monitoring
Stable
Pending
▸ Engagement alerts (N)   ← new, collapsed by default
Archived
```

### Step 4 (later) — Daily digest email

Not for pilot v1. Design in a follow-up once providers confirm the dashboard alerts are actionable.

---

## Summary: recommended pilot v1 approach

| Question | Answer |
|---|---|
| New DB table needed? | No — compute dynamically from existing data |
| New API routes needed? | No for core alerts — only add `daysSinceLastCheckin` + `hadPriorEngagement` fields to existing patient list response |
| Dashboard change? | Yes — one new collapsible section below Pending |
| Email notifications? | No — dashboard-only for pilot v1 |
| Pilot metrics impact? | None — aggregate signals already tracked; per-patient view is additive |
| Risk of breaking existing clinical escalations? | Zero — completely separate code path |
| Schema migration required? | No for the five timestamp-based alerts. "Invite friction" (resend count) would require one column addition if that alert is prioritized |

The clinical escalation channel (email + dashboard badge via `escalation_requested` care event) remains **unchanged and isolated**. Engagement alerts are a read-only display layer computed from timestamps that already exist in the database.
