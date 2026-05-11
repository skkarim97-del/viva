# Viva Onboarding & Pilot Operations Audit

**Date:** 2026-05-11  
**Branch:** `claude/audit-bugs-zbCQI`  
**Scope:** End-to-end pilot operations — provider setup through pilot readout  
**Methodology:** Static analysis of production source code; no mocked paths assumed working

---

## Table of Contents

1. [Provider Setup & Authentication](#1-provider-setup--authentication)
2. [Invite Creation & Delivery](#2-invite-creation--delivery)
3. [TestFlight Install & Deep Link Activation](#3-testflight-install--deep-link-activation)
4. [Patient Activation & Account Creation](#4-patient-activation--account-creation)
5. [Onboarding Wizard & First Session](#5-onboarding-wizard--first-session)
6. [Daily Check-in & Offline Sync](#6-daily-check-in--offline-sync)
7. [Intervention Generation & Patient Interaction](#7-intervention-generation--patient-interaction)
8. [Escalation Flow & Provider Notification](#8-escalation-flow--provider-notification)
9. [Provider Dashboard Review Workflow](#9-provider-dashboard-review-workflow)
10. [Pilot Analytics & Demo Exclusion](#10-pilot-analytics--demo-exclusion)
11. [Operational Monitoring & Runbook](#11-operational-monitoring--runbook)
12. [Critical Gaps & Risks Summary](#12-critical-gaps--risks-summary)

---

## 1. Provider Setup & Authentication

### Doctor Signup

**Route:** `POST /auth/signup`  
**File:** `artifacts/api-server/src/routes/auth.ts:54-115`

- Self-service — no operator seed, no email verification required
- Required fields: `name`, `email`, `password` (8–200 chars)
- **`CRITICAL`** Platform assignment is hardcoded: `getDemoPlatformId()` (line 76). All newly registered doctors land on the "demo" platform. A second pilot customer breaks this — there is no admin UI or API to assign a doctor to a non-demo platform.
- Onboarding gate: `needsOnboarding = !user.clinicName` — first post-signup action is filling in clinic details (clinic name, specialty, practice type).

### MFA (TOTP)

**Files:** `artifacts/api-server/src/middleware/requireDoctorMfa.ts`, `artifacts/api-server/src/routes/auth.ts:250-380`

- TOTP required for all PHI access (`requireDoctorMfa` middleware on every clinical route)
- No grace period — first PHI request after session start requires `session.mfaVerified = true`
- Setup: `POST /auth/mfa/setup` generates TOTP secret + QR; `POST /auth/mfa/verify` confirms code and marks `mfaEnabled = true`
- Recovery: backup codes issued at TOTP setup; no SMS fallback
- **Gap:** No enforcement that provider has completed MFA setup before inviting patients. A doctor who skips MFA setup can still invite patients; they will be blocked on first PHI view but the friction is deferred rather than upfront.

### Session & Auth Tokens

- Bearer token issued on login: `issueApiToken(userId, "doctor")` → 30-day TTL
- Dashboard: token stored in `localStorage` (`@viva_dashboard_auth`)
- Mobile: token stored in `AsyncStorage` (`@viva_session_token`)

---

## 2. Invite Creation & Delivery

### Creating an Invite

**Route:** `POST /api/patients/invite`  
**File:** `artifacts/api-server/src/routes/patients.ts:558-611`

Doctor provides:
- `name` (patient display name)
- `phone` (used for identity, not for SMS)
- `glp1Drug` (medication)
- `glp1Dose` (starting dose)

Server:
- Creates patient user row + patient record
- Generates `activationToken`: 24-byte `crypto.randomBytes`, base64url-encoded (unique, collision-resistant)
- Sets `activationTokenIssuedAt = now()` (TTL anchor)
- Returns `{ inviteLink: "https://api.itsviva.com/invite/<token>" }`

**Token TTL:** 14 days (`INVITE_TOKEN_TTL_DAYS = 14` in `artifacts/api-server/src/lib/inviteTokens.ts:12`)

### Invite Delivery UI (Dashboard)

**File:** `artifacts/viva-dashboard/src/pages/PatientsPage.tsx` (PendingCard component)

Fully built — no manual step required:
- **Copy invite link** button (copies full `https://api.itsviva.com/invite/<token>` URL to clipboard)
- **Copy SMS text** button (copies pre-formatted SMS: `"Hi [name], here's your Viva invite: <link>"`)
- **Resend invite** button → `POST /api/patients/:id/resend` (rotates token, fresh 14-day TTL)

Doctor pastes or sends the link manually via any channel (SMS app, email, iMessage). No in-app SMS sending or email delivery exists.

### Resend / Token Rotation

**Route:** `POST /api/patients/:id/resend`  
**File:** `artifacts/api-server/src/routes/patients.ts:663-717`

- Atomic CAS: only succeeds if `activatedAt IS NULL`
- Returns `{ inviteLink }` with fresh token
- Returns `409 already_activated` if patient already completed activation

---

## 3. TestFlight Install & Deep Link Activation

### Invite Landing Page

**Route:** `GET /invite/:token`  
**File:** `artifacts/api-server/src/routes/invite.ts:1-523`

#### iOS Users (lines 210-288)

- Personalized welcome: patient first name, clinician name, clinic (if set)
- Meta tag `apple-itunes-app` for iOS Smart App Banner with `app-argument=viva://invite/{token}` (line 230)
- **Two CTAs:**
  1. "Install via TestFlight" → `VIVA_TESTFLIGHT_URL` env var; falls back to App Store URL `https://apps.apple.com/app/id6762158265` if unset (logs warning: lines 48-50)
  2. "Continue Setup" → `viva://invite/{token}` deep link
- **Auto-redirect JavaScript** (lines 275-284): fires `viva://invite/{token}` after 250ms if app is already installed (sessionStorage-deduplicated to prevent loop)

#### Android / Desktop Users (lines 181-207)

- Renders `renderNonIosPage()`: "Open this link on your iPhone"
- No install CTAs, no deep link, no token redemption possible — intentional (no Android app)

#### Token Validation (lines 68-110)

| Condition | Response |
|-----------|----------|
| Token not found | Generic "no longer valid" page (no info leak) |
| `activatedAt` already set | Generic "no longer valid" page |
| TTL exceeded (`now - issuedAt > 14 days`) | Generic "no longer valid" page |
| Valid token | Full iOS invite page with CTAs |

Rate-limited via `strictAuthLimiter` on the JSON preview endpoint (line 116) to prevent enumeration.

### Deep Link Configuration (App)

**File:** `artifacts/pulse-pilot/app.json`

- Scheme: `viva://` (line 8)
- iOS Bundle ID: `com.sullyk97.vivaai` (line 20)
- iOS Universal Links (lines 22-25): `applinks:api.itsviva.com`, `applinks:viva-ai.replit.app`
- Android App Links (lines 38-58): `https://{api.itsviva.com,viva-ai.replit.app}/invite/*` with `autoVerify: true`

### Deep Link Handler (Cold Start)

**File:** `artifacts/pulse-pilot/app/_layout.tsx:115-128` (`useInviteDeepLink()`)

1. `Linking.getInitialURL()` fires on cold start; `Linking.addEventListener("url")` handles foreground taps
2. `extractInviteToken(url)` regex extracts token from either `viva://invite/{token}` or `https://api.itsviva.com/invite/{token}` shapes
3. `router.replace({ pathname: "/connect", params: { token } })` — uses `replace()` so back stack starts at `/connect`, not the raw invite URL

**`RISK`** If TestFlight is not installed when the patient taps "Continue Setup", the deep link (`viva://...`) fails silently. The browser shows "Cannot open this page" with no automatic redirect to the TestFlight install page. Patient must manually:
1. Tap the "Install via TestFlight" CTA on the landing page (if still on browser)
2. Install TestFlight + Viva
3. Return to the original invite link and tap again

There is no app-not-installed detection or graceful fallback in the current deep link flow.

---

## 4. Patient Activation & Account Creation

### Token Redemption

**Route:** `POST /auth/activate`  
**File:** `artifacts/api-server/src/routes/auth.ts:121-249`

**Request:**
```json
{ "token": "<activation_token>", "password": "<chosen_password>" }
```

**Validation:**
- Token: 8-200 chars (client extracts from full URL via `extractInviteToken()`)
- Password: 8-200 chars (checked client-side at `connect.tsx:58-61` before API call)

**Database changes (atomic transaction, lines 174-201):**
```sql
UPDATE patients SET activatedAt = NOW(), activationToken = NULL, activationTokenIssuedAt = NULL
  WHERE activationToken = $token AND activatedAt IS NULL;
UPDATE users SET passwordHash = bcrypt($password) WHERE id = $userId;
```

- CAS pattern prevents concurrent double-activation: if UPDATE returns 0 rows, server re-reads and returns precise error
- `bcrypt` hashing (~100ms) done *before* the critical UPDATE section to minimize transaction lock time

**Error codes (connect.tsx:71-88 maps to patient-facing strings):**

| HTTP | Code | Patient sees |
|------|------|-------------|
| 404 | `invalid_token` | "That invite link is not valid." |
| 409 | `already_activated` | "This invite has already been used. Sign in with your email instead." |
| 410 | `token_expired` | "This invite link has expired. Ask your clinician to send you a fresh one." |
| 400 | `invalid_input` | Password/token length errors |

**Post-activation:**
- Bearer token issued (`issueApiToken(userId, "patient")`)
- Stored in AsyncStorage
- `_layout.tsx` routes to `/onboarding/index` (since `profile.onboardingComplete = false`)

---

## 5. Onboarding Wizard & First Session

### Connect Screen

**File:** `artifacts/pulse-pilot/app/connect.tsx`

Two modes:
1. **Activate** (default): paste invite link + choose password → `POST /auth/activate`
2. **Sign in**: email + password → `POST /auth/signin` (for returning users / re-installs)

Token pre-populated from deep link param `?token=<token>` so patient only needs to choose a password.

### Onboarding Wizard (13 Steps)

**File:** `artifacts/pulse-pilot/app/onboarding/index.tsx:34-48` (STEPS constant)

| Step | Screen | What patient does |
|------|--------|-------------------|
| 1 | `welcome` | See tagline + Apple Health callout |
| 2 | `name` | Enter preferred name |
| 3 | `goals` | Select health goals (6 options: fat loss, metabolic, muscle, energy, consistency, general) |
| 4 | `medication` | Select GLP-1 (Ozempic, Mounjaro, Saxenda, Compounded, Other) |
| 5 | `dose` | Select/enter current dose |
| 6 | `titration` | Was dose changed in last 14 days? If yes, enter previous dose |
| 7 | `time_on_med` | Duration on medication (bucket: <30d → 2yr+) |
| 8 | `telehealth` | Treatment platform (searchable list: Ro, Amazon Clinic, Teladoc, etc.) |
| 9 | `side_effects` | Multi-select baseline symptoms (nausea, fatigue, constipation, poor appetite, dizziness, sleep, none) |
| 10 | `nutrition` | Protein/hydration confidence, meals/day, under-eating concern, strength training baseline |
| 11 | `activity` | Activity level (inactive → very active) |
| 12 | `integrations` | "Connect Apple Health" (with skip option) |
| 13 | `summary` | Review: medication, dose, platform, goals, support topics → "Start Your Plan" |

"Start Your Plan" fires `router.replace("/(tabs)")` → lands on **Today** tab (daily check-in screen).

### Apple Health Permissions

**File:** `artifacts/pulse-pilot/data/healthProviders.ts`

Permissions requested (read-only):
- `StepCount`, `HeartRate`, `RestingHeartRate`, `HeartRateVariability`
- `SleepAnalysis`, `DistanceWalkingRunning`
- `ActiveEnergyBurned`, `BasalEnergyBurned`

**`RISK`** No pre-prompt explanation screen before the iOS system permission dialog. Error on denial is logged to debug console only (not surfaced in app UI). Patients who deny HealthKit access see an empty Trends tab with no guidance on how to re-enable. This is recoverable post-install but causes confusion at first launch.

---

## 6. Daily Check-in & Offline Sync

### Check-in Screen

**File:** `artifacts/pulse-pilot/app/(tabs)/index.tsx`

Daily check-in captures:
- Energy level (1-5 scale)
- Nausea (boolean)
- Mood (boolean)
- Appetite (normal/reduced/increased)
- Digestion (scale)
- Bowel movement (normal/constipation/diarrhea)
- Optional: weight (lbs)
- Optional: notes

### Submit Flow

**Route:** `POST /me/checkins`  
**Source tag:** `today_checkin_autosave`

Server response includes `triggeredInterventionRefresh: boolean`. When `true`, client immediately calls `POST /patient/interventions/generate` with `source: "checkin"` (index.tsx line 311).

### Offline Sync

**File:** `artifacts/pulse-pilot/lib/checkinSync.ts`

- Offline queue persisted in AsyncStorage
- On submit failure: check-in serialized to queue, UI shows optimistic success
- On foreground resume (`AppState` "active" event): `flushCheckinSync()` drains queue
- Single-flight: concurrent flush attempts are no-ops
- Exponential backoff: 1s → 2s → 4s → 8s (max 3 retries before drop to avoid stale data)
- Flushed automatically on foreground via `useReminderScheduler` hook in `_layout.tsx:144-151`

### Check-in Reminders

**File:** `artifacts/pulse-pilot/lib/reminders.ts`

- Two daily local notifications (Expo Notifications API):
  - 12:00 PM: "Log your daily check-in"
  - 7:00 PM: "Don't forget your check-in today"
- Smart skip: if `hasCheckedInToday = true`, skips remaining today reminders (line 181)
- Scheduled 7 days ahead; rescheduled on app launch, after check-in, on sign-out
- PHI-safe: notification body contains no patient data
- No notification on Web/browser (no-op, line 42-44)

---

## 7. Intervention Generation & Patient Interaction

### Trigger Sources

**File:** `artifacts/api-server/src/lib/interventionEngine/index.ts:107`

Two trigger paths:

| Path | When | How |
|------|------|-----|
| **Post-check-in (auto)** | After daily check-in | Client calls `POST /patient/interventions/generate` when server returns `triggeredInterventionRefresh: true` |
| **Manual "Ask my care team"** | Patient taps button | Client calls `POST /patient/interventions/generate` with `source: "manual", triggerType: "patient_requested_review"` |

No scheduled/cron-based triggering. No background re-evaluation after dismissal.

### Signal Detection

**File:** `artifacts/api-server/src/lib/interventionEngine/triggers.ts:119-350`

Detected conditions (`detectInterventionTriggers()`):
- Nausea + low food intake (moderate risk)
- Constipation + low activity/hydration (low-moderate risk)
- Low energy + poor sleep (low risk)
- Rapid weight change >3 lbs (elevated risk)
- Worsening symptom trend (moderate risk)
- Missed check-ins ≥2 days (low risk)
- Low hydration ≥2 days (low risk)
- Per-symptom presence: any constipation/nausea/low energy reported

`pickRelevantTriggers()` deduplicates and caps at 4 concurrent triggers; multiple triggers merge into a single unified card.

### AI vs. Fallback Mode

- **Pilot default:** `INTERVENTION_AI_MODE=fallback` (no OpenAI calls)
- **Fallback templates:** `artifacts/api-server/src/lib/interventionEngine/templates.ts`
  - Per-symptom templates (e.g., `constipation.low_steps.v2`: "Walk for 10 minutes after your next meal and finish a full glass of water")
  - Multi-symptom synthesis via `renderSynthesizedFallback()` (≥2 triggers)
  - Catch-all `care_team_review` template as final fallback
- `contextSummary` column (PHI-bearing JSONB): NOT written to DB in safe mode (PR D guard: `isInterventionAiModeEnabled() ? generated.contextSummary : {}`)
- `contextSummary` stripped from all API responses (PR A: `toClientIntervention()` applied at all 7 response sites)

### Intervention Types

**File:** `lib/db/src/schema/patientInterventions.ts:48-59` (`PATIENT_INTERVENTION_TRIGGER_TYPES`)

`nausea`, `constipation`, `low_energy`, `low_hydration`, `low_food_intake`, `missed_checkin`, `rapid_weight_change`, `worsening_symptom`, `repeated_symptom`, `patient_requested_review`

### Patient UI

**File:** `artifacts/pulse-pilot/components/InterventionCard.tsx`

- Title: "Symptom support"
- Subtitle: "Based on your check-in, here's what may help today"
- "What we noticed" section: plain-language symptom summary
- Primary recommendation (highest-priority trigger)
- "I'll try this" / "Show me another option" toggle through alternates
- Collapsed "More support for today" section for secondary triggers
- Clinical guardrail copy in footer

### Patient Actions

| Action | API | Status transition |
|--------|-----|------------------|
| Accept | `POST /:id/accept` | `shown → pending_feedback` |
| Dismiss | `POST /:id/dismiss` | `shown → dismissed` (requires reason) |
| Feedback | `POST /:id/feedback` | `pending_feedback → resolved / feedback_collected / escalated` |
| Escalate | `POST /:id/escalate` | any active → `escalated` |

**Auto-escalate on "worse" feedback:** Server automatically sets `status = escalated` and writes `escalation_requested` care event when patient selects "Worse" in the feedback flow (line 577-581 in `patientInterventions.ts`).

---

## 8. Escalation Flow & Provider Notification

### Escalation Trigger (Patient Side)

Two paths:
1. **Explicit:** Patient taps "Ask my care team" → `POST /patient/interventions/:id/escalate`
2. **Automatic:** Server auto-escalates on `feedback = "worse"` during `POST /:id/feedback`

### Server-Side Handling

**File:** `artifacts/api-server/src/routes/patientInterventions.ts:671-728`

Database updates:
- `status = "escalated"`, `escalatedAt = now()`, `escalationReason = "patient_requested" OR "patient_feedback_worse"`
- Writes two care events:
  1. `intervention_feedback` (if via feedback path): `{ response: "worse" }`
  2. `escalation_requested`: `{ intervention_id, reason, channel: "intervention" }`

The `escalation_requested` care event is what triggers the escalation badge in the provider dashboard.

### Provider Notification

| Channel | Status |
|---------|--------|
| **Dashboard polling** | **Working** — 10s cadence (reduced from 30s by PR C) |
| **Browser Notification API** | **Working** — fires when `needsReviewIds` count increases (PR C) |
| **Push notification (APNs/FCM)** | **STUBBED** — `pushSafe.ts:129-138` logs payload but does not send. Comment: "TODO(post-pilot): hand payload off to APNs/FCM sender here" |
| **Email to doctor** | **NOT IMPLEMENTED** — no code path exists |
| **SMS to doctor** | **NOT IMPLEMENTED** — no code path exists |

**`CRITICAL`** The only real-time out-of-app signal available to providers today is the browser Notification API, which requires the dashboard tab to be open (or have previously granted permission). No email or SMS is sent on escalation. Doctors who are not actively monitoring the dashboard may miss time-sensitive escalations.

### Time to Provider Visibility

- **Dashboard open:** ≤10 seconds (polling cadence after PR C)
- **Dashboard closed:** Never (no push, no email, no SMS)

---

## 9. Provider Dashboard Review Workflow

### Patient List (Escalation Triage)

**File:** `artifacts/viva-dashboard/src/pages/PatientsPage.tsx`

Four priority buckets (lines 123-174):
1. **"Patient Requested Review"** — `patient_requested_review` trigger type
2. **"Worsening After Intervention"** — feedback result = "worse"
3. **"Elevated Risk"** — risk level = "elevated"
4. **"Repeated Symptoms"** — trigger type = "repeated_symptom"

Escalation badge: patient appears in "Patient Requested Review" section when `needsReviewSet.has(p.id)` — sourced from `GET /care-events/_ids/needs-review` (open `escalation_requested` with no matching `doctor_reviewed`).

### Patient Detail Page

**File:** `artifacts/viva-dashboard/src/pages/PatientDetailPage.tsx`

Clinical data shown:
- Most recent check-in: energy, nausea, mood, appetite, digestion, bowel movement
- Symptom flags: severity, persistence, days observed
- Risk score + trending rules
- Treatment status (active/stopped/unknown) + weight tracking with trend
- Care events timeline (last 60 days, reverse chronological)

### Review Actions

| Action | Route | DB effect |
|--------|-------|-----------|
| **Mark as reviewed** | `POST /care-events/:patientId/reviewed` | Writes `doctor_reviewed` care event; removes from escalation badge |
| **Mark follow-up complete** | `POST /care-events/:patientId/follow-up-completed` | Writes `follow_up_completed`; sets `followUpPending = false` |

`follow-up-completed` requires **MFA step-up** (`requireDoctorMfa` middleware) — TOTP must be verified before completing clinical follow-up. `follow_up_completed` includes `triggerEventId` pointing to the specific `escalation_requested` event it closes.

### Escalation-Closed Logic

Patient is removed from "Patient Requested Review" when:
```
MAX(doctor_reviewed.occurredAt) > MAX(escalation_requested.occurredAt)
```
or
```
follow_up_completed.triggerEventId = escalation_requested.id (most recent)
```
**File:** `artifacts/api-server/src/routes/careEvents.ts:363-389`

### Care Event Types

All defined in `lib/db/src/schema/careEvents.ts:30-50`:

| Event | Actor | Purpose |
|-------|-------|---------|
| `recommendation_shown` | system | Intervention card generated and displayed |
| `intervention_feedback` | patient | Patient submitted feedback (better/same/worse/didn't_try) |
| `escalation_requested` | patient | Patient escalated or gave "worse" feedback |
| `doctor_reviewed` | doctor | Doctor acknowledged escalation (badge cleared) |
| `follow_up_completed` | doctor | Doctor completed clinical follow-up (MFA required) |
| `coach_message` | system | AI coach message (disabled in safe mode) |
| `doctor_note` | doctor | Doctor added a free-text note |

---

## 10. Pilot Analytics & Demo Exclusion

### KPI Groups

**File:** `artifacts/api-server/src/lib/pilotMetrics.ts` (716 lines)

**Group 1 — Risk (lines 92-105):**
- `flaggedPatients`: count with ≥1 active risk flag in window
- `pctFlagged`: flagged / total activated patients
- `avgSignalsPerPatient`: average risk signals per flagged patient
- `topCategories`: top 5 rule types by hit count
- `bandDistribution`: low / medium / high patient counts

**Group 2 — Interventions (lines 107-116):**
- `triggered`: intervention cards generated in window
- `perPatient`: triggered / activated patients
- `engaged`: interventions with feedback within 48h (`ENGAGEMENT_WINDOW = 48h`)
- `pctEngaged`: engaged / triggered
- `autoResolved`: interventions resolved without escalation within 48h (`AUTO_RESOLVE_WINDOW = 48h`)
- `pctAutoResolved`: autoResolved / triggered
- `escalated`: escalations within 48h of trigger
- `pctEscalated`: escalated / triggered

**Group 3 — Provider (lines 118-126):**
- `patientsEscalated`: distinct patients with escalation in window
- `escalationsRaw`: total escalation events
- `escalationsDeduped`: escalations deduped per patient per 24h (`DEDUPE_WINDOW = 24h`)
- `avgTimeToFollowUpHours`: mean hours from `escalation_requested` → `follow_up_completed`
- `pctReviewed`: escalations with `doctor_reviewed` within window
- `pctActedOn`: escalations with `follow_up_completed` linked via `triggerEventId`

**30-Day Window:** `windowStart = now - 30d`, `windowEnd = now` (configurable). Cohort = patients activated by `windowEnd`. Metric definition version: `v1.0.0` (bumped on any KPI rule change).

### Internal Analytics Access

**Route:** `GET /api/internal/metrics`  
**File:** `artifacts/api-server/src/routes/internal.ts:127`

Authentication: Bearer token (`Authorization: Bearer <INTERNAL_API_KEY>`)

**`SECURITY RISK`** Default operator key: `OPERATOR_CODE = "Viva2026!"` (line 74, hardcoded in source). Overridden by `INTERNAL_API_KEY` env var. If env var is not set in production, the hardcoded key is active. The key is visible in source code — anyone with repo access can call internal endpoints with it.

Additional gating: rate limiting (`mediumApiLimiter`), IP allowlist (`operatorIpAllowlist()`), PHI audit logging. If `INTERNAL_IP_ALLOWLIST` is unset, IP allowlist is logged as warning but **not enforced**.

**Pilot Snapshots:**

- `POST /api/internal/analytics/pilot/snapshot` with `preset: "day15"` or `"day30"` (or explicit date range)
- Snapshot is immutable JSONB row in `pilot_snapshots` table
- `GET /api/internal/analytics/pilot/snapshots` — list metadata (no metrics blob)
- `GET /api/internal/analytics/pilot/snapshots/:id` — full row with metrics
- **No CSV or PDF export endpoint** — snapshots are JSON only

### Demo User Exclusion

**File:** `artifacts/api-server/src/lib/demoFilter.ts`

Excluded email patterns:
- `demo%@itsviva.com` (canonical pattern, matches all seeded doctors/patients)
- `%@vivaai.demo` (legacy QA dataset)

Applied via `notInArray(patientsTable.userId, demoUserIdsSelect())` at the cohort level (line 239 in `pilotMetrics.ts`). All KPIs are demo-clean without per-query filtering.

Demo accounts cannot invite real patients in production: `artifacts/api-server/src/routes/patients.ts:607-611` blocks invite creation if doctor email matches demo pattern.

**Pilot patients must NOT use emails matching `demo%@itsviva.com` or `%@vivaai.demo`.**

### Synthetic Pilot Seed

**File:** `scripts/src/seedSyntheticPilot.ts`

Generates (deterministic RNG, reproducible):
- 10 demo doctors
- 100 demo patients across 5 cohort archetypes: stable (40), side_effect (25), disengaging (15), cost_motivation (15), low_efficacy (5)
- Realistic check-ins, interventions, outcomes, care events, doctor notes per archetype

```bash
pnpm --filter @workspace/scripts run seed:pilot   # wipe + seed
pnpm --filter @workspace/scripts run seed:reset   # wipe only
```

Requires `ALLOW_DEMO_SEED=true` in production (HIPAA guardrail). Cleanup via `wipeSynthetic()` — pattern-matched deletion, never touches real accounts.

---

## 11. Operational Monitoring & Runbook

### Health Check

- `GET /api/healthz` → `{ status: "ok" }` (no DB check, port-level only)
- **`GAP`** No deep health check that verifies DB connectivity or RDS reachability

### Logging

- Pino v9 JSON structured logs (`artifacts/api-server/src/lib/logger.ts`)
- PHI redaction: `Authorization`, `cookie`, `password`, `mfaSecret`, `token`, `message` fields stripped before output
- Level: `LOG_LEVEL` env var (default `"info"`)
- **`GAP`** No Sentry, Datadog, CloudWatch, or any external error tracking integration found. Errors are logged to stdout only — no alerting, no aggregation, no dashboards.

### EC2 Deployment Runbook

**File:** `docs/ec2-cutover-runbook.md` (12 phases, 442 lines)

12 deployment phases: Node 24 bootstrap → DNS A record → SG rules → env file → deploy → TLS cert → smoke tests → dashboard cutover → mobile cutover (7-day TestFlight bake). Manual steps: Squarespace DNS add (Phase 8), AWS SG edits (Phases 5, 7), `/etc/viva-api.env` fill-in (Phase 4).

### Daily Operator Checklist

```bash
# 1. Verify API is healthy
curl https://api.itsviva.com/api/healthz

# 2. Fetch pilot metrics (from allowed IP)
curl -H "Authorization: Bearer $INTERNAL_API_KEY" \
     https://api.itsviva.com/api/internal/metrics

# 3. Check systemd service
sudo systemctl status viva-api

# 4. Tail recent errors
sudo journalctl -u viva-api -n 100 --since "1 hour ago" -o short

# 5. Weekly milestone snapshot (Day 7, 15, 30)
curl -X POST \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"preset":"day15","notes":"Week 2 readout"}' \
  https://api.itsviva.com/api/internal/analytics/pilot/snapshot
```

Watch manually for (no automated alerting today):
- `viva-api` service down or restarting
- RDS connection errors in logs
- Auth / invite failures spiking
- Snapshot creation 500s
- No check-ins in 24h for an enrolled patient

---

## 12. Critical Gaps & Risks Summary

Priority-ordered by pilot impact:

### P0 — Pilot-Blocking Risks

| # | Gap | File | Impact |
|---|-----|------|--------|
| P0-1 | **No out-of-app doctor notification on escalation** | `artifacts/api-server/src/lib/pushSafe.ts:129-138` | Doctor misses time-sensitive patient escalation if dashboard tab is not open |
| P0-2 | **Single platform hardcoding at signup** | `artifacts/api-server/src/routes/auth.ts:76` | All new doctors land on demo platform — second pilot customer cannot be provisioned without code change |
| P0-3 | **Default operator key in source code** | `artifacts/api-server/src/routes/internal.ts:74` | `"Viva2026!"` is hardcoded; anyone with repo access can call internal PHI analytics endpoints if env var not set in production |

### P1 — High Friction / Likely to Surface in Pilot

| # | Gap | File | Impact |
|---|-----|------|--------|
| P1-1 | **No fallback when deep link fails (TestFlight not installed)** | `artifacts/api-server/src/routes/invite.ts:255` | Patient who taps "Continue Setup" before installing TestFlight sees silent browser failure; manual recovery required |
| P1-2 | **HealthKit denial has no in-app recovery path** | `artifacts/pulse-pilot/data/healthProviders.ts` | Patient who denies HealthKit during onboarding sees empty Trends tab; no guidance on how to re-enable in Settings |
| P1-3 | **No pre-prompt explanation before HealthKit permission dialog** | `artifacts/pulse-pilot/app/onboarding/index.tsx` (integrations step) | iOS permission dialog fires without context; denial rate will be higher than if pre-prompted |
| P1-4 | **MFA setup not enforced before patient invite** | `artifacts/api-server/src/routes/patients.ts:558` | Doctor can invite patients before setting up TOTP; friction deferred to first PHI access |
| P1-5 | **No email/SMS delivery of invite link** | `artifacts/viva-dashboard/src/pages/PatientsPage.tsx` (PendingCard) | Doctor must manually copy-paste invite; no automated delivery path reduces reliability of patient receiving link |

### P2 — Operational / Monitoring Gaps

| # | Gap | File | Impact |
|---|-----|------|--------|
| P2-1 | **No Sentry/Datadog/external error tracking** | `artifacts/api-server/src/lib/logger.ts` | Production errors visible only in `journalctl`; no alerting, no aggregation |
| P2-2 | **IP allowlist optional, not enforced** | `artifacts/api-server/src/routes/internal.ts:39` | `INTERNAL_IP_ALLOWLIST` unset → internal endpoints accept any IP (logged as warn, not blocked) |
| P2-3 | **No bulk provider onboarding** | `artifacts/api-server/src/routes/auth.ts` | Multi-doctor practices require individual signups; no admin CSV import |
| P2-4 | **No pilot snapshot export (CSV/PDF)** | `artifacts/api-server/src/routes/internal.ts:2485` | Snapshots are JSON only; sharing with investors/IRB requires manual transformation |
| P2-5 | **Health check is port-only** | `artifacts/api-server/src/routes/health.ts` | `GET /healthz` returns `{status:"ok"}` without checking DB connectivity |
| P2-6 | **No audit log retention policy defined** | `artifacts/api-server/src/routes/internal.ts:47-56` | PHI audit logging is enabled but no retention/cleanup policy documented or enforced |

### What Is Working Well

- Invite token: 24-byte crypto-random, 14-day TTL, atomic CAS redemption, precise error codes, no info leakage
- MFA: TOTP required for all PHI, no grace period, step-up on `follow-up-completed`
- Offline check-in sync: AsyncStorage queue, single-flight, exponential backoff
- Intervention safe mode: AI fully disabled (`INTERVENTION_AI_MODE=fallback`), fallback templates cover all trigger types
- PHI guard: `contextSummary` stripped from wire (PR A), not written in safe mode (PR D)
- Escalation loop: complete — check-in → trigger detection → intervention card → patient feedback → auto-escalate → dashboard badge → doctor review
- Demo exclusion: cohort-level filter via `demoUserIdsSelect()`, blocks demo doctors from inviting real patients
- Pilot snapshots: immutable, versioned (`v1.0.0`), preset `day15`/`day30`, full KPI coverage
- EC2 runbook: 12-phase deployment guide with rollback plan

---

*Generated by static codebase analysis. All file references point to `/home/user/viva/` repo root.*
