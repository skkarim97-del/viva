# Escalation Rules

**Status:** Pilot v1 (current)  
**Last updated:** 2026-05-11  
**Source of truth:** `artifacts/api-server/src/routes/patientInterventions.ts`

---

## Design philosophy

Current escalation rules are **intentionally deterministic and fully explainable**. Every escalation can be traced to a specific patient action or a specific data threshold. There is no ML scoring, no probabilistic inference, and no hidden weighting. This was a deliberate pilot-safety decision: providers need to understand *why* a patient appeared in their worklist without consulting a model card.

This keeps the pilot auditable and allows the team to validate that the system is surfacing real clinical signal before adding complexity.

---

## 1. What triggers an escalation

There are exactly two escalation triggers in the current system:

### A. Patient submits "worse" feedback on an intervention

**Route:** `POST /patient/interventions/:id/feedback`  
**Condition:** `feedbackResult === "worse"`  
**Mechanism:** Automatic — no patient intent to escalate is required  
**Escalation reason stored:** `patient_feedback_worse`

Flow:
1. Patient accepts an intervention card ("I'll try this")
2. Intervention status transitions to `pending_feedback`
3. Patient returns and selects "Worse" from the feedback options
4. Server immediately sets `status = "escalated"`, `escalatedAt = now`
5. Two care events are written: `intervention_feedback` (response: "worse") and `escalation_requested` (reason: "patient_feedback_worse")
6. Assigned doctor receives an email notification (see §3)
7. Patient appears in the dashboard "Worsening After Intervention" worklist bucket

### B. Patient explicitly requests care team review

**Route:** `POST /patient/interventions/:id/escalate`  
**Condition:** Patient taps "Ask my care team" button  
**Mechanism:** Manual patient action  
**Escalation reason stored:** `patient_requested`

Flow:
1. Patient taps "Ask my care team" on an active intervention card
2. Server sets `status = "escalated"`, `escalatedAt = now`, `escalationReason = "patient_requested"`
3. One care event is written: `escalation_requested` (reason: "patient_requested")
4. Assigned doctor receives an email notification (see §3)
5. Patient appears in the dashboard "Patient Requested Review" worklist bucket

**Eligible statuses for explicit escalate:** `shown`, `accepted`, `pending_feedback`, `feedback_collected`, `dismissed`.  
**Ineligible (returns 409):** `resolved`, `expired`, already `escalated`.

---

## 2. Manual vs. automatic escalation

| | Auto-escalation (worse feedback) | Manual escalation (explicit request) |
|---|---|---|
| **Trigger** | Patient selects "Worse" during feedback | Patient taps "Ask my care team" |
| **Patient intent** | Implicit — patient is reporting outcome | Explicit — patient is requesting help |
| **Escalation reason** | `patient_feedback_worse` | `patient_requested` |
| **Dashboard bucket** | "Worsening After Intervention" | "Patient Requested Review" |
| **Care event** | `escalation_requested` + `intervention_feedback` | `escalation_requested` only |
| **Analytics event** | `intervention_feedback_worse` + `intervention_escalated` | `intervention_escalated` |
| **Pre-requisite** | Intervention must be in `pending_feedback` status | Intervention must not be `resolved`, `expired`, or already `escalated` |

Both paths write the same `escalation_requested` care event type, which is what drives the dashboard needs-review badge (`GET /care-events/_ids/needs-review`).

---

## 3. Email notification

**File:** `artifacts/api-server/src/lib/emailSafe.ts`  
**Provider:** Resend HTTP API (configured via `RESEND_API_KEY` env var)

An email is sent to the **assigned doctor's email address** after every escalation (both auto and manual). The doctor address is looked up at send time via `patients.doctor_id → users.email`.

### What the email contains

```
Subject: Viva: Patient review requested

A patient in your Viva panel has requested review or been flagged for follow-up.

Open Viva Clinic: https://clinic.itsviva.com
```

### What is intentionally excluded

The email contains **no PHI**. The following are explicitly omitted:

- Patient name, identifier, or contact information
- Medication name, dose, or titration status
- Symptom details, feedback text, or patient notes
- Intervention content or recommendation text
- Diagnosis, clinical assessment, or risk score
- Any field sourced from `coach_messages.body`, `doctor_notes.body`, `care_events.metadata`, or `patient_interventions.*`

This is a deliberate HIPAA pilot constraint (T009): escalation emails cross third-party mail infrastructure. Notification copy is visible on a locked screen and is logged by mail providers.

### Failure behavior

- If `RESEND_API_KEY` is not set: call is skipped, logged at `debug` level, patient flow is unaffected
- If Resend rejects the request (4xx/5xx): logged at `warn` level with HTTP status, patient flow is unaffected
- If a network error occurs: logged at `warn` level, patient flow is unaffected
- If the doctor lookup query fails: logged at `warn` level, no email sent, patient flow is unaffected

The email send is **fire-and-forget** — it is initiated after `res.json()` returns. No email failure can block or delay the patient's API response.

### Demo account suppression

Emails to addresses matching `demo%@itsviva.com` or `%@vivaai.demo` are silently suppressed. This prevents synthetic test escalations from reaching real inboxes.

---

## 4. What does NOT currently trigger escalation

The following conditions generate intervention cards and appear in the provider worklist, but do **not** directly create an `escalation_requested` care event or send an email:

| Signal | What happens instead |
|---|---|
| **Constipation ≥ 2 of last 7 days** | `repeated_symptom` trigger → intervention card shown |
| **Constipation + low activity (steps down ≥25%)** | `constipation` trigger → intervention card shown |
| **Constipation + low hydration** | `constipation` trigger → intervention card shown |
| **Nausea + low food intake** | `nausea` trigger → intervention card shown |
| **Nausea within 3 days of last dose** | `nausea` trigger → intervention card shown |
| **Low energy + sleep < 6h** | `low_energy` trigger → intervention card shown |
| **Low hydration ≥ 2 of last 7 days** | `low_hydration` trigger → intervention card shown |
| **Weight drop > 3 lbs in ~7 days** | `rapid_weight_change` trigger → intervention card shown (elevated risk level). Intentionally non-escalating in pilot v1 — signal is useful but noisy; needs provider validation before becoming automatic. See §5. |
| **Worsening symptom trend** | `worsening_symptom` trigger → intervention card shown |
| **Missed check-ins ≥ 2 of last 7 days** | `missed_checkin` trigger → intervention card shown. Intentionally non-escalating in pilot v1 — treated as a disengagement signal for analytics and patient context only. See §5. |
| **Patient dismisses intervention** | `dismissed` status, no escalation |
| **Patient selects "same" feedback** | `feedback_collected` status, no escalation |
| **No feedback submitted within 48h** | Counted as non-engagement in KPIs, no escalation |
| **Elevated risk score on patient row** | Surfaces in dashboard risk buckets, no escalation |

In short: intervention *generation* and *display* are separate from escalation. Escalation only happens when the patient explicitly says something is not working or actively asks for help.

---

## 5. Future candidate escalation rules

The following are **pilot learning candidates only — none are implemented**. They are documented here to preserve institutional context from pilot observations and to inform a future rules review after the first cohort completes.

### Repeated worsening symptoms

Escalate if a patient reports the same symptom as "worse" across N consecutive check-ins without an intervening resolution, regardless of intervention engagement.

*Rationale:* The current rule requires the patient to engage with an intervention before auto-escalating. A patient who dismisses every card or never accepts could have persistently worsening symptoms with no escalation ever firing.

### Missed check-ins (extended)

Escalate (not just generate an intervention) if a patient misses ≥ 5 consecutive check-ins after an initial period of regular engagement. This would indicate true disengagement rather than a single off day.

*Rationale:* Current missed-checkin trigger generates a card, but the patient never sees it if they're not opening the app. A care event-level escalation would at least surface the silence to the provider.

**Pilot v1 decision:** Kept as a non-escalating disengagement signal. Missed check-ins are surfaced in patient context and analytics (DAU/WAU, silence buckets in `/api/internal/metrics`) but do not email providers by default. This avoids alert fatigue from patients who simply forget to log for a day or two. The threshold and appropriate provider response should be validated during pilot feedback before enabling auto-escalation.

### Rapid weight change auto-escalation

Escalate directly when weight drops > 3 lbs in ~7 days, bypassing the intervention card cycle.

*Rationale:* This trigger already fires with `riskLevel: "elevated"` — the highest risk level in the system — and generates an intervention card. The question is whether a weight signal at that magnitude should also notify the provider automatically rather than waiting for the patient to engage with the card and report "worse."

**Pilot v1 decision:** Kept as an intervention-only, non-escalating trigger. The signal has been observed to be noisy in practice (scale calibration differences, acute fluid changes post-dose, etc.). The appropriate escalation threshold and clinical response should be validated with providers during pilot before enabling automatic escalation.

### Severe symptom thresholds

Escalate directly (bypassing the intervention card cycle) when reported severity exceeds a threshold — e.g., nausea severity ≥ 4 with very low food intake, or digestion = "severe constipation" for ≥ 3 consecutive days.

*Rationale:* Some symptom combinations at high severity may warrant direct provider contact without waiting for the patient to complete an intervention feedback cycle.

### Persistent intervention non-response

Escalate if a patient has received N interventions for the same trigger type over M days with no `resolved` outcome (all dismissed, all "same", or no feedback).

*Rationale:* Current system only escalates on active negative feedback. Silence or indifference across repeated interventions for the same symptom may also indicate unmet clinical need.

### Biometric drift vs. baseline

Escalate if a wearable-derived metric (resting heart rate, HRV, sleep) drifts beyond a patient-specific baseline by more than a configurable threshold sustained over ≥ 7 days.

*Rationale:* Would require: (a) baseline establishment period, (b) HealthKit data connected, (c) per-patient threshold configuration, (d) clinical validation that the thresholds are meaningful for GLP-1 patients specifically. All of these are deferred to post-pilot.

---

## 6. Current rule design rationale

The two current rules were chosen because they meet all of the following criteria:

1. **Explicit patient signal** — no inference required; the patient directly communicated a negative outcome
2. **Low false-positive risk** — "worse" and "ask my care team" are unambiguous signals from the patient's perspective
3. **Auditable** — every escalation has a timestamped `escalation_requested` care event with a clear `reason` field (`patient_feedback_worse` or `patient_requested`)
4. **Explainable to providers** — a doctor seeing an escalation badge can immediately understand why the patient appeared
5. **Safe to fail** — the email notification is best-effort; the core escalation record is written to the database regardless of email delivery

The future candidate rules above are deliberately held back until the pilot produces enough signal to validate whether deterministic rules are sufficient or whether probabilistic approaches (risk scoring, ML) are warranted.

---

## 7. Engagement / Operational Alerts (separate layer)

> **These are not clinical escalations.** Engagement alerts and clinical escalations are intentionally separate concepts and must not be merged into the same urgency bucket or notification channel.

### Clinical escalations vs. engagement alerts

| | Clinical escalation | Engagement / operational alert |
|---|---|---|
| **What it signals** | Patient has an active clinical need right now | Patient engagement, activation, or retention is at risk |
| **Urgency** | High — provider review required | Lower — operational follow-up or accountability |
| **Source** | Patient action (feedback, request) | Timestamp arithmetic on invite / check-in data |
| **Who acts** | Treating provider | Provider, care coordinator, or platform operator |
| **Current notification** | Email to assigned doctor | Dashboard-only for pilot v1 |
| **Audit trail** | `escalation_requested` care event | Computed dynamically (see implementation plan) |

### Why keep them separate

Merging engagement signals into the clinical escalation channel would:
- Dilute the urgency signal — providers would start ignoring emails if most are operational rather than clinical
- Create ambiguity about what action is required (call the patient? or just resend an invite?)
- Risk labeling routine disengagement as a medical alert, which is misleading and potentially creates liability

### Proposed pilot v1 engagement alert candidates

The following are **proposed alerts, not yet implemented**. See `docs/engagement-alerts-plan.md` for the implementation proposal.

| Alert | Trigger condition | Suggested label | Suggested action |
|---|---|---|---|
| **Activation pending** | Invited but not activated after 72 hours | `Activation pending` | Resend invite or remind patient |
| **No first check-in** | Activated but no check-in within 24 hours | `No first check-in` | Encourage patient to complete first check-in |
| **Engagement slipping** | No check-in for 3 consecutive days | `Engagement slipping` | Provider or care team reminder |
| **Engagement risk** | No check-in for 5+ consecutive days | `Engagement risk` | Provider outreach |
| **Re-engagement needed** | Had ≥ 3 check-ins, then silent for 5+ days | `Re-engagement needed` | Higher-signal dropout risk; distinguishable from never-started patients |
| **Invite friction** | Doctor has resent invite 2+ times without activation | `Invite friction` | Operational friction; may need direct patient contact |

### What engagement alerts should NOT do (pilot v1)

- **Do not send as urgent clinical escalation emails** — these are lower urgency and must use a separate channel or cadence when email is added
- **Do not label as medical alerts** — engagement signals do not imply clinical deterioration
- **Do not imply clinical deterioration** unless supported by reported symptoms
- **Do not overload providers** — if email is added later, consider a once-daily digest rather than per-event notifications

### Relationship to pilot metrics

Engagement signals feed directly into the pilot's activation and retention KPIs already tracked in `GET /api/internal/metrics`:
- `noCheckinAfterInvite` — patients who never checked in after activation
- `dropoff.threeDaysPlus / fiveDaysPlus / sevenDaysPlus` — silence buckets for previously-active patients
- `completedFirstCheckin` — activation funnel completion
- `checkedInLast7` — rolling weekly engagement

These are already computed server-side. Engagement alerts in the dashboard would give providers a per-patient view of the same signals the operator already sees in aggregate.

