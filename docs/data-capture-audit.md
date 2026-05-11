# Viva Data Capture Audit

**Date:** 2026-05-11  
**Branch:** `claude/data-capture-audit`  
**Scope:** Viva Care (mobile), Viva Clinic (dashboard), API server, database schema, analytics, auth, audit logs  
**Status:** Audit only — no code changes

---

## Executive Summary

Viva collects a moderately sized set of clinical and operational data across 21 database tables (~224 columns, ~97 flagged PHI/PII). The system is architecturally well-considered for a HIPAA pilot: PHI access is logged, coach message bodies are not stored by default, raw Apple Health data never leaves the device, and de-identification is used before any AI call.

**Key strengths:**
- PHI access logging covers all doctor-facing routes (action, route, hashed IP/UA, status code)
- Apple Health raw metrics never reach the backend — only aggregated daily summaries are sent
- Coach message bodies are omitted from storage by default; only structured metadata persisted
- AI calls are fully disabled in the pilot (`COACH_PILOT_MODE=safe`); `deidentifiedAiPayload` is stored but never acted on
- MFA required for all doctor PHI access
- All tokens stored as SHA-256 hashes

**Key risks / gaps:**
- `patient_interventions.context_summary` and `intervention_events.treatment_state_snapshot` store rich PHI in JSONB with no field-level access controls
- Several wellness inputs captured in the mobile app (feeling, energy, stress, training intent) are stored locally but never sent to the server — undocumented client-only data
- `patient_checkins.hydration` and `.bowel_movement` are persisted but not displayed in the dashboard
- `outcome_snapshots` table is written by the patient app but not surfaced anywhere in the clinic dashboard
- `analytics_events` are collected but there is no analytics dashboard within the repo — unclear where the data goes
- `pilot_snapshots.clinic_name` is marked deprecated in schema but still present
- `vo2Max`, `strain`, `recoveryScore`, `distance`, `pace` are tracked in the mobile type system but not in any DB table

---

## Section 1: Data Flow Map

### 1A. Patient → Viva Care → API → Database

```
Patient action          Mobile layer              API endpoint              DB table(s)
─────────────────────── ───────────────────────── ───────────────────────── ──────────────────────────
Onboarding profile      AppContext → /me/profile   POST /me/profile          patient_profiles
Daily GLP-1 check-in    checkinSync queue          POST /me/checkins         patient_checkins
Mark guidance seen      checkinSync               PATCH /me/checkins/guidance patient_checkins
Submit trend response   checkinSync               PATCH /me/checkins/trend   patient_checkins
Request clinician       checkinSync               PATCH /me/checkins/escalate patient_checkins + care_events
Log weight              AppContext                 POST /me/weights          patient_weights
Log medication dose     AppContext                 POST /me/treatment-log    patient_treatment_logs
Apple Health daily sync AppContext (push)          POST /me/health/daily-summary patient_health_daily_summaries
Update integration      AppContext                 PUT /me/integrations/:p   patient_integrations
Complete plan item      AppContext                 PATCH /me/plan-items/:id  patient_plan_items
Submit outcome snapshot AppContext                 POST /outcomes/snapshot   outcome_snapshots
Accept intervention     interventionsClient       POST /patient-interventions/:id/accept patient_interventions
Give intervention fbk   interventionsClient       POST /patient-interventions/:id/feedback patient_interventions + care_events
Analytics event         analytics/client.ts       POST /analytics/events    analytics_events
Care event (coach msg)  care-events/client.ts     POST /care-events         care_events
```

**Local-only (never leaves device):**
- Rolling averages, trend detection, post-dose correlation patterns (patternEngine.ts)
- Wellness inputs: feeling, energy (wellness), stress, hydration (wellness), training intent (AsyncStorage WELLNESS_KEY)
- Apple Health raw metrics: VO2 Max, distance, pace, strain, recovery score
- Offline queue state, dismissed card state, session IDs
- Adaptive overrides, confidence-gate computations

### 1B. Provider → Viva Clinic → API → Database

```
Doctor action           Dashboard UI              API endpoint              DB table(s)
─────────────────────── ───────────────────────── ───────────────────────── ──────────────────────────
Sign up / login         Auth forms                POST /auth/signup|login   users + sessions
Enroll MFA              MFA setup screen          POST /me/mfa/enroll/*     users (mfaSecret, mfaRecoveryCodesHashed)
Invite patient          Invite modal              POST /patients/invite     patients + users (pending)
Resend invite           Patient list              POST /patients/:id/resend patients (token rotated)
Set clinic name         Onboarding                PUT /patients/clinic      users (clinicName)
View patient list       Dashboard                 GET /patients             — (read)
View patient detail     Patient page              GET /patients/:id         — (read) → phi_access_logs
Update treatment status Patient page              PATCH /patients/:id/treatment-status patients
Write clinical note     Patient page              POST /patients/:id/notes  doctor_notes
Delete clinical note    Patient page              DELETE /patients/:id/notes/:noteId doctor_notes
Mark reviewed           Patient page / worklist   POST /care-events/:id/reviewed care_events
Mark follow-up done     Patient page / worklist   POST /care-events/:id/follow-up-completed care_events
View intervention list  Clinic interventions      GET /clinic/interventions  — (read)
```

### 1C. System-Generated Events → Database

```
Trigger                 Source                    DB table(s)
─────────────────────── ───────────────────────── ──────────────────────────
Patient escalation      PATCH /me/checkins/escalate  care_events (escalation_requested)
Doctor review           POST /care-events/:id/reviewed care_events (doctor_reviewed)
Follow-up complete      POST /care-events/:id/follow-up-completed care_events (follow_up_completed)
Intervention generated  POST /patient-interventions/generate patient_interventions
Intervention shown      Mobile app → POST /interventions/log intervention_events
Intervention feedback   POST /patient-interventions/:id/feedback care_events (intervention_feedback)
Coach session           POST /coach/chat (disabled) coach_messages (metadata only, no body)
PHI route access        phiAudit middleware        phi_access_logs
Pilot snapshot          POST /internal/... (implied) pilot_snapshots
Outcome snapshot        POST /outcomes/snapshot    outcome_snapshots
```

### 1D. Internal Analytics

```
Metric group            Source                    API endpoint
─────────────────────── ───────────────────────── ──────────────────────────
Platform-wide KPIs      patients, care_events,    GET /internal/metrics
                        interventions, outcomes,
                        pilot_snapshots
Patient analytics       analytics_events          GET (no read endpoint found in repo)
Check-in session        analytics/client.ts       POST /analytics/events
```

---

## Section 2: Full Data Inventory

### Users & Auth

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Email address | Viva Clinic | Provider | Signup / login form | POST /auth/signup, /login | users.email | PII | Authentication, contact | Auth, dashboard display |
| Password (hash) | Viva Clinic | Provider | Signup / login form | POST /auth/signup | users.password_hash | PII (credential) | Authentication | Auth only |
| Full name | Viva Clinic | Provider | Signup form | POST /auth/signup | users.name | PII | Display, audit attribution | Dashboard, PHI audit logs |
| Phone number | Viva Care invite | Patient | Invite modal (doctor enters) | POST /patients/invite | users.phone | PII | Patient identification, dedup | Invite flow |
| Role (doctor/patient) | System | Both | N/A | POST /auth/signup, /activate | users.role | No | Access control | Auth, all routes |
| Clinic name | Viva Clinic | Provider | Onboarding screen | PUT /patients/clinic | users.clinic_name | No | Display context | Dashboard, invite landing page |
| Platform ID | System | Both | N/A | N/A | users.platform_id | No | Multi-tenant scoping | Internal metrics, analytics |
| MFA secret (TOTP) | Viva Clinic | Provider | MFA enrollment | POST /me/mfa/enroll/verify | users.mfa_secret | Credential | Doctor MFA | Auth gate for PHI routes |
| MFA recovery codes (hashed) | Viva Clinic | Provider | MFA enrollment | POST /me/mfa/enroll/verify | users.mfa_recovery_codes_hashed | Credential | MFA recovery | Auth only |
| MFA enrolled timestamp | System | Provider | N/A | POST /me/mfa/enroll/verify | users.mfa_enrolled_at | No | Audit trail | Dashboard MFA status |
| Bearer API token (hash) | System | Patient | N/A (issued on activate) | POST /auth/activate | api_tokens.token | Credential | Patient auth | All patient API routes |
| Token last-used timestamp | System | Patient | N/A | All authed patient calls | api_tokens.last_used_at | No | Security monitoring | Auth diagnostics |
| Session cookie | System | Provider | N/A (browser managed) | POST /auth/login | sessions (connect-pg-simple) | No | Doctor session | Auth gate |

### Patient Demographics & Treatment

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| GLP-1 drug name | Viva Clinic | Provider (at invite) | Invite modal | POST /patients/invite | patients.glp1_drug | PHI | Treatment context | Dashboard, risk engine, AI coach context |
| Dose | Viva Clinic | Provider (at invite) | Invite modal | POST /patients/invite | patients.dose | PHI | Treatment context | Dashboard, risk engine |
| Treatment start date | Viva Clinic / patient | Both | Invite modal / patient onboarding | POST /patients/invite, me/profile | patients.started_on | PHI | Duration calculation | Dashboard, stop-timing bucket, pilot metrics |
| Treatment status | Viva Clinic | Provider | Patient detail page | PATCH /patients/:id/treatment-status | patients.treatment_status | PHI | Active/stopped/unknown | Dashboard queue, risk engine, pilot metrics |
| Treatment status source | System | System | N/A (derived) | PATCH /patients/:id/treatment-status | patients.treatment_status_source | No | Attribution | Audit trail |
| Stop reason | Viva Clinic | Provider | Treatment status modal | PATCH /patients/:id/treatment-status | patients.stop_reason | PHI | Clinical context | Dashboard, analytics |
| Stop note | Viva Clinic | Provider | Treatment status modal (free text) | PATCH /patients/:id/treatment-status | patients.stop_note | PHI | Clinical context | Dashboard only |
| Stop timing bucket | System | System | N/A (computed from dates) | GET /patients/:id | Derived (not stored) | No | Pilot metrics | Dashboard, pilot snapshots |
| Activation token | System | System | N/A (in invite URL) | POST /patients/invite | patients.activation_token | No (bearer-grade until used) | One-time account claim | Invite flow |
| Activation timestamp | System | System | N/A | POST /auth/activate | patients.activated_at | No | Retention metric | Pilot metrics |

### Patient Profile (Onboarding)

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Age | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.age | PII | Coach context, risk calibration | AI coach context, risk engine |
| Sex | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.sex | PII | Coach context | AI coach context |
| Height (inches) | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.height_inches | PHI | BMI calc context | Coach context |
| Starting weight (lbs) | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.weight_lbs | PHI | Baseline | Coach context |
| Goal weight (lbs) | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.goal_weight_lbs | PHI | Target tracking | Coach context, dashboard |
| Units preference | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.units | No | Display formatting | Not prominently used |
| Health goals | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.goals (jsonb array) | PHI | Personalization | AI coach context |
| GLP-1 medication (patient view) | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.glp1_medication | PHI | Coach context | AI coach context |
| GLP-1 reason | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.glp1_reason | PHI | Coach context | AI coach context |
| GLP-1 duration | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.glp1_duration | PHI | Coach context | AI coach context |
| Protein confidence | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.protein_confidence | PHI | Coach personalization | AI coach context (if re-enabled) |
| Strength training baseline | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.strength_training_baseline | PHI | Coach personalization | AI coach context (if re-enabled) |
| Available workout time | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.available_workout_time | PHI | Plan personalization | AI coach context, plan engine |
| Days available to train | Viva Care | Patient | Onboarding screens | POST /me/profile | patient_profiles.days_available_to_train | PHI | Plan personalization | AI coach context, plan engine |

### Daily Check-In Symptoms

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Check-in date | System | Patient | Today tab (auto) | POST /me/checkins | patient_checkins.date | No | Time-series key | All patient analytics |
| Energy level | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.energy | PHI | Symptom tracking | Risk engine, dashboard, intervention triggers, pattern engine, AI coach context |
| Nausea level | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.nausea | PHI | Symptom tracking | Risk engine, dashboard, intervention triggers, pattern engine, AI coach context |
| Mood (1-5) | Viva Care | Patient | Today tab (mental state slider) | POST /me/checkins | patient_checkins.mood | PHI | Wellbeing tracking | Risk engine, dashboard, AI coach context |
| Appetite | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.appetite | PHI | Symptom tracking | Risk engine, dashboard, intervention triggers, pattern engine |
| Digestion | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.digestion | PHI | Symptom tracking | Risk engine, dashboard, intervention triggers, pattern engine |
| Hydration level | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.hydration | PHI | Symptom tracking | Risk engine, intervention triggers — **not displayed in dashboard** |
| Bowel movement | Viva Care | Patient | Today tab GLP-1 check-in | POST /me/checkins | patient_checkins.bowel_movement | PHI | Digestive tracking | Risk engine (symptom chip: "No BM") — **not displayed in dashboard** |
| Check-in notes | Viva Care | Patient | Today tab (optional text) | POST /me/checkins | patient_checkins.notes | PHI | Free-text context | Persisted, **not surfaced in dashboard or analytics** |
| Guidance shown flags | System | System | N/A (auto on render) | PATCH /me/checkins/guidance | patient_checkins.guidance_shown (jsonb) | No | De-duplication | Risk engine (clinician_requested logic) |
| Trend response | Viva Care | Patient | Follow-up prompt in app | PATCH /me/checkins/trend | patient_checkins.trend_response (jsonb) | PHI | Symptom trajectory | Risk engine (worsening detection), dashboard symptom flags |
| Clinician requested | System | Patient | Escalation button | PATCH /me/checkins/escalate | patient_checkins.clinician_requested (jsonb) | No | Escalation tracking | Risk engine, care events |

### Wellness Inputs (Local Only — Not Persisted to Backend)

| Data Point | Source | User Type | Where Captured | Stored Where | PHI/PII | Purpose |
|---|---|---|---|---|---|---|
| Feeling (focused/good/low/burnt_out) | Viva Care | Patient | Today tab wellness prompt | AsyncStorage (WELLNESS_KEY) | PHI | Daily plan generation |
| Energy (wellness, separate from GLP-1 energy) | Viva Care | Patient | Today tab | AsyncStorage | PHI | Daily plan generation |
| Stress level | Viva Care | Patient | Today tab | AsyncStorage | PHI | Daily plan personalization |
| Hydration intent (separate from GLP-1 hydration symptom) | Viva Care | Patient | Today tab | AsyncStorage | PHI | Daily plan personalization |
| Training intent | Viva Care | Patient | Today tab | AsyncStorage | PHI | Daily plan personalization |

> **Note:** These five fields drive the daily plan engine but are never sent to the API. They exist only in the patient's device storage and are cleared/overwritten daily.

### Weight Tracking

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Weight (lbs) — patient-logged | Viva Care | Patient | Weight modal (Today tab) | POST /me/weights | patient_weights.weight_lbs | PHI | Progress tracking | Dashboard weight card, trend calc |
| Weight recorded timestamp | System | System | N/A | POST /me/weights | patient_weights.recorded_at | No | Time-series | Dashboard weight trend |
| Weight (lbs) — Apple Health daily | Apple Health | Patient | Passive (Apple Health sync) | POST /me/health/daily-summary | patient_health_daily_summaries.weight_lbs | PHI | Alternative source | Dashboard (if available) |

### Apple Health / Wearable Data

| Data Point | Source | User Type | Where Captured | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Steps | Apple Health | Patient | Passive sync | POST /me/health/daily-summary | patient_health_daily_summaries.steps | PHI | Activity tracking | Trends tab, risk engine, intervention triggers |
| Sleep duration (minutes) | Apple Health | Patient | Passive sync | POST /me/health/daily-summary | patient_health_daily_summaries.sleep_minutes | PHI | Recovery tracking | Trends tab, AI coach context |
| Resting heart rate | Apple Health | Patient | Passive sync | POST /me/health/daily-summary | patient_health_daily_summaries.resting_heart_rate | PHI | Recovery tracking | Trends tab, AI coach context |
| HRV (ms) | Apple Health | Patient | Passive sync | POST /me/health/daily-summary | patient_health_daily_summaries.hrv | PHI | Recovery quality | Trends tab, AI coach context, data tier |
| Active calories | Apple Health | Patient | Passive sync | POST /me/health/daily-summary | patient_health_daily_summaries.active_calories | PHI | Activity tracking | Trends tab |
| Active day flag | System | System | Derived from steps/calories | POST /me/health/daily-summary | patient_health_daily_summaries.active_day | No | Engagement tracking | Trends tab, pilot metrics |
| Data source label | System | System | Auto-set by app | POST /me/health/daily-summary | patient_health_daily_summaries.source | No | Provenance | Not surfaced |
| Integration status | Viva Care | Patient | Settings screen / first connect | PUT /me/integrations/:provider | patient_integrations.status | No | Consent tracking | Settings, plan engine feature gates |
| Integration permissions | System | System | N/A (derived from HealthKit) | PUT /me/integrations/:provider | patient_integrations.permissions (jsonb) | No | Permission audit | Not surfaced |
| Integration connected/disconnected timestamps | System | System | N/A | PUT /me/integrations/:provider | patient_integrations.connected_at, disconnected_at, last_sync_at | No | Audit trail | Not surfaced |

**Apple Health metrics tracked client-side only (NOT sent to backend):**
- VO2 Max, distance, pace, strain, recovery score — exist in the `HealthMetrics` TypeScript type but have no corresponding column in `patient_health_daily_summaries`

### Medication Logs

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Medication name | Viva Care | Patient | Medication log modal | POST /me/treatment-log | patient_treatment_logs.medication_name | PHI | Treatment history | Trends tab (medication card) |
| Dose value | Viva Care | Patient | Medication log modal | POST /me/treatment-log | patient_treatment_logs.dose | PHI | Treatment history | Trends tab |
| Dose unit | Viva Care | Patient | Medication log modal | POST /me/treatment-log | patient_treatment_logs.dose_unit | PHI | Treatment history | Trends tab |
| Frequency | Viva Care | Patient | Medication log modal | POST /me/treatment-log | patient_treatment_logs.frequency | PHI | Treatment history | Plan engine (dose-day detection) |
| Started on date | Viva Care | Patient | Medication log modal | POST /me/treatment-log | patient_treatment_logs.started_on | PHI | Duration calculation | Trends tab |
| Log source (patient/doctor) | System | System | N/A (auto) | POST /me/treatment-log | patient_treatment_logs.source | No | Attribution | Not surfaced |

### Daily Plan

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Plan category | System | System | N/A (generated) | POST /me/plan-items | patient_plan_items.category | No | Plan structure | Today tab plan, trends habits |
| Recommended action text | System | System | N/A (generated) | POST /me/plan-items | patient_plan_items.recommended | PHI | Displayed recommendation | Today tab |
| Chosen action text (patient override) | Viva Care | Patient | Plan item swap | PATCH /me/plan-items/:id | patient_plan_items.chosen | PHI | Personalization | Today tab |
| Completion timestamp | Viva Care | Patient | Today tab action check | PATCH /me/plan-items/:id | patient_plan_items.completed_at | No | Habit tracking | Trends tab (streak, weekly rate) |
| Source (auto / patient_override) | System | System | N/A | POST/PATCH /me/plan-items | patient_plan_items.source | No | Attribution | Not surfaced |
| Item metadata | System | System | N/A | POST /me/plan-items | patient_plan_items.metadata (jsonb) | No | Engine parameters | Not surfaced |

### Clinical Interventions

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Trigger type | System | System | N/A (engine-generated) | POST /patient-interventions/generate | patient_interventions.trigger_type | No | Classification | Pilot metrics, clinic worklist |
| Symptom type | System | System | N/A | POST /patient-interventions/generate | patient_interventions.symptom_type | PHI | Intervention specificity | Clinic worklist |
| Severity (1-5) | System | System | N/A (derived) | POST /patient-interventions/generate | patient_interventions.severity | PHI | Triage | Clinic worklist |
| Risk level (low/moderate/elevated) | System | System | N/A | POST /patient-interventions/generate | patient_interventions.risk_level | No | Triage | Pilot metrics |
| What we noticed (patient-facing text) | System | System | N/A (generated) | POST /patient-interventions/generate | patient_interventions.what_we_noticed | PHI | Patient display | Today tab, clinic worklist |
| Recommendation text | System | System | N/A | POST /patient-interventions/generate | patient_interventions.recommendation | No | Patient display | Today tab |
| Follow-up question | System | System | N/A | POST /patient-interventions/generate | patient_interventions.follow_up_question | No | Feedback collection | Today tab |
| Recommendation category | System | System | N/A | POST /patient-interventions/generate | patient_interventions.recommendation_category | No | Analytics grouping | Pilot metrics |
| Context summary (PHI JSONB — internal) | System | System | N/A | POST /patient-interventions/generate | patient_interventions.context_summary | **PHI** | AI input (disabled) | **Not currently used — AI disabled** |
| De-identified AI payload | System | System | N/A | POST /patient-interventions/generate | patient_interventions.deidentified_ai_payload | No (de-id) | AI call input (stored for audit) | **Not used — AI disabled in pilot** |
| Patient feedback | Viva Care | Patient | Today tab feedback prompt | POST /patient-interventions/:id/feedback | patient_interventions.feedback_result | No | Outcome signal | Pilot metrics, intervention performance |
| Patient note on feedback | Viva Care | Patient | Today tab feedback (optional text) | POST /patient-interventions/:id/feedback | patient_interventions.patient_note | **PHI** | Clinical context | **Not surfaced anywhere** |
| Generated by (rules_ai/fallback/rules) | System | System | N/A | POST /patient-interventions/generate | patient_interventions.generated_by | No | Transparency audit | Not surfaced |
| Status lifecycle timestamps | System | System | N/A | Multiple PATCH routes | patient_interventions.accepted_at, feedback_collected_at, escalated_at, resolved_at | No | Performance measurement | Pilot metrics |
| Intervention surface | System | System | N/A (set by app) | POST /interventions/log | intervention_events.surface | No | UX analytics | Pilot metrics |
| Intervention title | System | System | N/A | POST /interventions/log | intervention_events.title | PHI | Display | Not surfaced |
| Treatment state snapshot | System | System | N/A | POST /interventions/log | intervention_events.treatment_state_snapshot (jsonb) | **PHI** | Audit trail | **Not surfaced — internal only** |
| Claims policy summary | System | System | N/A | POST /interventions/log | intervention_events.claims_policy_summary (jsonb) | No | Regulatory compliance | Internal audit |
| Signal confidence summary | System | System | N/A | POST /interventions/log | intervention_events.signal_confidence_summary (jsonb) | No | Engine quality | Not surfaced |

### Care Events & Escalations

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Event type | System/User | Both | Various | POST /care-events | care_events.type | No | Event classification | Pilot metrics, dashboard timeline |
| Event source (viva/doctor/patient) | System | System | N/A | POST /care-events | care_events.source | No | Attribution | Dashboard timeline |
| Actor user ID | System | System | N/A | POST /care-events | care_events.actor_user_id | No | Attribution | Dashboard timeline |
| Event timestamp | System | System | N/A | POST /care-events | care_events.occurred_at | No | Time-series | Pilot metrics (time-to-review) |
| Event metadata | System | System | N/A | POST /care-events | care_events.metadata (jsonb) | Conditional | Event-specific context | Dashboard timeline, pilot metrics |
| Trigger event linkage | System | System | N/A | POST /care-events/:id/follow-up-completed | care_events.trigger_event_id | No | Linkage for metrics | Pilot metrics (acted-on rate) |
| Escalation open flag | System | System | N/A (computed at read) | GET /care-events/:id | Derived | No | Dashboard alert | Clinic dashboard, worklist |
| Follow-up pending flag | System | System | N/A (computed at read) | GET /care-events/:id | Derived | No | Dashboard alert | Clinic dashboard |

### Doctor Notes & Actions

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Note body | Viva Clinic | Provider | Patient detail → Notes tab | POST /patients/:id/notes | doctor_notes.body | **PHI** | Clinical documentation | Dashboard note timeline |
| Note resolved status | Viva Clinic | Provider | Patient detail → Notes tab | POST/PATCH /patients/:id/notes | doctor_notes.resolved | No | Workflow tracking | Dashboard |
| Note author | System | System | N/A (from auth session) | POST /patients/:id/notes | doctor_notes.doctor_user_id | No | Attribution | Dashboard (shows doctor name) |
| Note timestamp | System | System | N/A | POST /patients/:id/notes | doctor_notes.created_at | No | Time-series | Dashboard |

### Outcome Snapshots

| Data Point | Source | User Type | Where Captured in UI | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Daily check-in completed | System | System | N/A (auto) | POST /outcomes/snapshot | outcome_snapshots.daily_checkin_completed | No | Adherence | Pilot metrics |
| Next-day check-in completed | System | System | N/A (auto) | POST /outcomes/snapshot | outcome_snapshots.next_day_checkin_completed | No | Adherence continuity | Pilot metrics |
| Weekly consistency (0-100) | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.weekly_consistency | No | Engagement | Pilot metrics |
| Medication log completion | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.medication_log_completion | No | Adherence | Pilot metrics |
| Symptom trend (3d) | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.symptom_trend_3d | No | Clinical signal | **Not surfaced in dashboard** |
| App engaged 72h | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.app_engaged_72h | No | Retention | Pilot metrics |
| Clinician outreach triggered | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.clinician_outreach_triggered | No | Escalation rate | Pilot metrics |
| Treatment active 30/60/90d | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.treatment_active_30d/60d/90d | No | Retention milestones | Pilot metrics |
| Adherence improved 3d | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.adherence_improved_3d | No | Behavior change | **Not surfaced** |
| Symptom improved/worsened 3d | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.symptom_improved_3d/worsened_3d | No | Clinical signal | **Not surfaced** |
| Re-engaged after low adherence | System | System | N/A | POST /outcomes/snapshot | outcome_snapshots.reengaged_after_low_adherence | No | Recovery metric | **Not surfaced** |

### Analytics Events

| Data Point | Source | User Type | Where Captured | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| User ID | System | Both | N/A (from auth) | POST /analytics/events | analytics_events.user_id | No (reference only) | Attribution | Analytics (no read endpoint found) |
| User type | System | Both | N/A | POST /analytics/events | analytics_events.user_type | No | Segmentation | Analytics |
| Event name | System | Both | N/A | POST /analytics/events | analytics_events.event_name | No | Usage tracking | Analytics |
| Session ID | Viva Care | Patient | N/A (auto-generated) | POST /analytics/events | analytics_events.session_id | No | Session grouping | Analytics |
| Platform (iOS/Android/web) | System | Both | N/A | POST /analytics/events | analytics_events.platform | No | Platform breakdown | Analytics |
| Timezone | Viva Care | Patient | N/A (device timezone) | POST /analytics/events | analytics_events.timezone | No | Regional analysis | Analytics |
| Payload | System | Both | N/A (allowlisted keys) | POST /analytics/events | analytics_events.payload (jsonb) | Conditional | Event parameters | Analytics |
| Event date (YYYY-MM-DD) | System | System | N/A | POST /analytics/events | analytics_events.event_date | No | Date bucketing | Analytics |

### PHI Access Audit Log

| Data Point | Source | User Type | Where Captured | Table.Field | PHI/PII | Purpose |
|---|---|---|---|---|---|---|
| Actor user ID | System | System | All PHI routes (phiAudit middleware) | phi_access_logs.actor_user_id | No | Attribution |
| Actor role | System | System | All PHI routes | phi_access_logs.actor_role | No | Role audit |
| Action type (read/write/delete) | System | System | All PHI routes | phi_access_logs.action | No | Action classification |
| Target patient ID | System | System | Patient-scoped routes | phi_access_logs.target_patient_id | No | Patient audit |
| Route path (no query string) | System | System | All PHI routes | phi_access_logs.route | No | Route audit |
| HTTP method | System | System | All PHI routes | phi_access_logs.method | No | Action detail |
| Response status code | System | System | All PHI routes | phi_access_logs.status_code | No | Outcome audit |
| IP address (SHA-256 hash) | System | System | All PHI routes | phi_access_logs.ip_hash | No | Source audit (no raw IP stored) |
| User-Agent (SHA-256 hash) | System | System | All PHI routes | phi_access_logs.ua_hash | No | Client audit (no raw UA stored) |

### Pilot Snapshots

| Data Point | Source | User Type | Where Captured | API Route | Table.Field | PHI/PII | Purpose | Used In |
|---|---|---|---|---|---|---|---|---|
| Cohort start/end date | Operator | Operator | Internal metrics request | GET /internal/metrics | pilot_snapshots.cohort_start/end_date | No | Reporting window | Pilot reporting |
| Generated by label | Operator | Operator | Internal metrics request | GET /internal/metrics | pilot_snapshots.generated_by_label | No | Attribution | Pilot reporting |
| Metric definition version | System | System | N/A | GET /internal/metrics | pilot_snapshots.metric_definition_version | No | Historical comparability | Pilot reporting |
| Patient count | System | System | N/A | GET /internal/metrics | pilot_snapshots.patient_count | No | Cohort size | Pilot reporting |
| Metrics JSONB blob | System | System | N/A | GET /internal/metrics | pilot_snapshots.metrics | No | All KPIs | Pilot reporting |
| Clinic name (deprecated) | N/A | N/A | N/A | N/A | pilot_snapshots.clinic_name | No | **Deprecated field** | **Unused** |

---

## Section 3: Data Categories Summary

### What Viva Care Collects from Patients

**Persisted to backend:**
- Onboarding profile (demographics, goals, treatment context)
- Daily GLP-1 symptom check-in (energy, nausea, mood, appetite, digestion, hydration, bowel movement)
- Guidance acknowledgment and follow-up trend responses
- Weight entries (manual logging)
- Medication dose logs
- Apple Health daily summaries (steps, sleep, HRV, RHR, active calories, weight)
- Apple Health integration status and permissions
- Weekly plan completions
- Outcome snapshots (adherence, retention flags)
- Analytics events (session_start, checkin_completed)
- Care events (coach messages, recommendations shown, escalations, intervention feedback)

**Local only (device only):**
- Wellness inputs: feeling, energy (wellness), stress, hydration (wellness), training intent
- Raw Apple Health metrics: VO2 Max, distance, pace, strain, recovery score
- Pattern analysis results (rolling averages, trend detection, post-dose correlations)
- Offline check-in queue state
- Dismissed intervention/tip card state
- Session ID and timestamps

### What Viva Clinic Collects from Providers

- Account: email, name, password (hashed), clinic name
- MFA: TOTP secret, recovery codes (hashed), enrollment timestamp
- Per patient: invite data (name, phone, GLP-1 drug, dose), treatment status updates (with reason and free-text note)
- Doctor notes (free-text, per patient)
- Care event actions: reviewed, follow-up completed (timestamps + linkage)

### What Is Passively Collected from Apple Health

Daily aggregates sent to backend (at patient-app sync):
- Steps, sleep minutes, resting heart rate, HRV, active calories, weight, active day flag, source label

On device only (not sent):
- VO2 Max, distance, pace, strain, recovery score, total calories

### What Is Generated by the Backend / System

- Risk score and risk band (computed on-demand, not stored)
- Symptom flags and suggested actions (computed on-demand, not stored)
- Intervention content (what_we_noticed, recommendation, follow_up_question)
- Context summary for AI (PHI JSONB — AI disabled in pilot)
- De-identified AI payload (stored but AI disabled)
- Treatment state snapshot at intervention time (PHI JSONB)
- Stop timing bucket (derived, not stored)
- Outcome snapshot fields (adherence flags, retention booleans)
- PHI access log entries
- Pilot snapshot KPI aggregates
- Care event timeline open/pending flags (computed at read, not stored)

### What Is Stored but Not Currently Used

| Field / Table | Why Not Used |
|---|---|
| `patient_interventions.context_summary` | AI disabled in pilot (`COACH_PILOT_MODE=safe`) |
| `patient_interventions.deidentified_ai_payload` | AI disabled in pilot |
| `patient_interventions.patient_note` | PHI, persisted but not surfaced in dashboard or analytics |
| `intervention_events.treatment_state_snapshot` | PHI, stored for audit but no read surface |
| `intervention_events.signal_confidence_summary` | Engine quality metric, not surfaced |
| `patient_health_daily_summaries.source` | Data provenance, not displayed |
| `patient_integrations.permissions` | Stored HealthKit permissions, not displayed |
| `patient_integrations.metadata` | Non-PHI context, not surfaced |
| `patient_plan_items.metadata` | Engine parameters, not surfaced |
| `patient_checkins.notes` | Free text, collected, not shown to doctor |
| `outcome_snapshots.*` (most fields) | Written by app, no dashboard surface |
| `analytics_events.*` | Collected, no read endpoint or analytics dashboard in repo |
| `pilot_snapshots.clinic_name` | Marked deprecated in schema |
| `patient_profiles.units` | Preference, not prominently used |
| `users.platform_id` vs `patients.platform_id` | Both exist; relationship is redundant |

### What Is Shown in Dashboards

Viva Clinic displays:
- Patient queue with risk bands, last check-in, activation status, note timestamps
- Patient detail: demographics, treatment status, stop reason, weight trend
- Check-in history: all symptom fields (energy, nausea, mood, appetite, digestion, bowel movement as chip)
- Risk score, band, symptom flags with trend responses and clinician-request status
- Doctor notes timeline
- Care event timeline (escalations, reviews, follow-ups)
- Intervention worklist (trigger, symptom, severity, risk level, recommendation, feedback)

Viva Care displays:
- Today tab: daily plan, symptom check-in, active interventions, coach
- Trends tab: key metrics (sparklines), medication card, pattern insights, correlations

### What Is Used for Pilot Metrics

- Activation: invites sent, activated count, first check-in, check-in dropoff (3/5/7 days)
- Risk: patients flagged, average signals, band distribution, top categories
- Intervention performance: triggered count, engaged/auto-resolved/escalated rates
- Provider leverage: escalations, time-to-follow-up, review rate, acted-on rate
- Retention: treatment_active_30d/60d/90d from outcome_snapshots

### What Is Used for AI / Intervention Logic

- Risk engine inputs: all check-in symptom fields, weight trend, treatment status, days on treatment, integration status, dose-day detection
- Intervention triggers: nausea, constipation, low energy, low hydration, low food intake, missed check-in, rapid weight change, worsening symptom, repeated symptom, patient requested review
- Context for AI coach (disabled in pilot): age, sex, weight, goals, GLP-1 medication, treatment duration, recent trends (HRV, sleep, steps, weight), recent dose log, 30-day biometric trends
- Pattern engine (client-side only): rolling averages, post-dose correlations, behavioral patterns

---

## Section 4: Risks and Gaps

### HIPAA / Compliance Concerns

| # | Issue | Severity | Location |
|---|---|---|---|
| H1 | `patient_interventions.context_summary` stores rich PHI (symptom history, clinical context) in JSONB with no field-level controls. Labeled "internal only" in code comments but no enforcement. AI is disabled so it is not sent to any AI vendor currently, but it is stored and accessible to any server process with DB access. | **High** | `patient_interventions` |
| H2 | `intervention_events.treatment_state_snapshot` stores a snapshot of a patient's full treatment state (medication, doses, symptoms, treatment status) as PHI JSONB. No access controls beyond DB-level. No read API exists but no deletion policy exists either. | **High** | `intervention_events` |
| H3 | `patient_interventions.patient_note` is patient free-text PHI persisted in the interventions table but never surfaced in the dashboard, never deleted, and not flagged in any audit tooling. | **Medium** | `patient_interventions` |
| H4 | `doctor_notes.body` and `patients.stop_note` are free-text PHI fields — no content scanning, no length limits, no structured format. If a doctor accidentally pastes sensitive information (e.g., a third-party record), there is no detection mechanism. | **Medium** | `doctor_notes`, `patients` |
| H5 | `analytics_events.payload` is described as "allowlisted keys only" but the allowlist enforcement is in the route handler. If a future caller mistakenly expands the payload, PHI could leak into the analytics table which has a much lower access threshold. | **Medium** | `analytics_events` |
| H6 | `care_events.metadata` is conditional PHI (depends on event type). No schema-level enforcement of what goes in metadata per event type — relies entirely on application-level discipline. | **Low** | `care_events` |

### PHI/PII That Needs Extra Care

| Field | Table | Concern |
|---|---|---|
| `email` | `users` | Standard PII, in plaintext. Used as login credential. |
| `phone` | `users` | PII, used for patient identification across invites. |
| `mfa_secret` | `users` | TOTP seed — if exposed, allows generating valid TOTP codes. |
| `context_summary` | `patient_interventions` | PHI JSONB. No TTL, no field-level audit. |
| `treatment_state_snapshot` | `intervention_events` | PHI JSONB. No TTL, no field-level audit. |
| `patient_note` | `patient_interventions` | Free-text PHI, no surface, no deletion lifecycle. |
| `body` | `doctor_notes` | Free-text clinical notes — highest-sensitivity field in the system. |
| `stop_note` | `patients` | Free-text clinical context. |
| `goals` | `patient_profiles` | Personal health goals — sensitive PII. |
| `hrv`, `resting_heart_rate`, `sleep_minutes` | `patient_health_daily_summaries` | Biometric PHI from wearable. |

### Data Captured in Frontend but Not Persisted

| Data Point | Where Captured | Why Not Persisted |
|---|---|---|
| Feeling (wellness) | Today tab AppContext | Design decision — drives local plan only |
| Energy (wellness) | Today tab AppContext | Design decision — drives local plan only |
| Stress level | Today tab AppContext | Design decision — drives local plan only |
| Hydration intent (wellness) | Today tab AppContext | Design decision — drives local plan only |
| Training intent | Today tab AppContext | Design decision — drives local plan only |
| VO2 Max | Apple Health / dataTier.ts | No column in `patient_health_daily_summaries` |
| Strain | Apple Health / dataTier.ts | No column in `patient_health_daily_summaries` |
| Recovery score | Apple Health / dataTier.ts | No column in `patient_health_daily_summaries` |
| Distance | Apple Health / dataTier.ts | No column in `patient_health_daily_summaries` |
| Pace | Apple Health / dataTier.ts | No column in `patient_health_daily_summaries` |
| Pattern analysis results | patternEngine.ts (client) | Intentional — privacy-preserving design |

### Data Persisted but Not Surfaced

| Data / Table | Collected | Not Surfaced In |
|---|---|---|
| `patient_checkins.notes` | Yes | Dashboard, analytics, intervention engine |
| `patient_checkins.hydration` | Yes | Dashboard (used in risk engine but no column shown to doctor) |
| `patient_checkins.bowel_movement` | Yes | Dashboard (only shown as "No BM" chip in symptom flags, not in check-in history table) |
| `outcome_snapshots.*` (most columns) | Yes | Clinic dashboard — no read surface for doctors |
| `analytics_events.*` | Yes | No read endpoint or analytics UI in repo |
| `patient_integrations.permissions` | Yes | Dashboard — no display |
| `patient_integrations.metadata` | Yes | Dashboard — no display |
| `intervention_events.signal_confidence_summary` | Yes | Nowhere |
| `patient_plan_items.metadata` | Yes | Nowhere |
| `patient_interventions.patient_note` | Yes | Nowhere |
| `pilot_snapshots.notes` | Yes | No read UI found in repo |

### Missing Fields for Pilot Reporting

| Missing Metric | Why Needed | Recommendation |
|---|---|---|
| Time to first check-in after activation | Key engagement metric | Derive from `patients.activated_at` vs `MIN(patient_checkins.created_at)` |
| Apple Health connection rate | Wearable adoption metric | Queryable from `patient_integrations` — add to `GET /internal/metrics` |
| Weight logging rate (% patients) | Engagement metric | Queryable from `patient_weights` — add to `GET /internal/metrics` |
| Intervention dismissal rate by trigger type | Intervention quality | Queryable from `patient_interventions.status` grouped by `trigger_type` |
| Doctor note frequency per patient | Provider engagement | Queryable from `doctor_notes` |
| Medication log completion rate | Adherence signal | Partially in `outcome_snapshots.medication_log_completion` — verify write path |

### Unnecessary Data Collection (Consider Minimizing)

| Data Point | Table | Concern |
|---|---|---|
| `patient_interventions.context_summary` | PHI JSONB | AI is disabled. This PHI blob serves no purpose in the pilot. Consider not writing it while AI is off. |
| `patient_interventions.deidentified_ai_payload` | JSONB | AI is disabled. Storing de-identified payloads that are never used adds schema complexity with no pilot benefit. |
| `intervention_events.treatment_state_snapshot` | PHI JSONB | Full treatment snapshot stored on every intervention event. A reference to the intervention or a smaller set of derived signals may suffice. |
| Timezone in `analytics_events` | IANA string | Optional field. On privacy-restricted devices it returns null. Marginal value for a small pilot cohort. |

---

## Section 5: Recommendations

### Most Important Data Points for the Pilot

These fields directly drive the pilot's three KPI groups and should be verified as clean and complete:

1. **Activation funnel:** `patients.activated_at`, `patients.activation_token_issued_at`, first entry in `patient_checkins`
2. **Check-in adherence:** `patient_checkins.date` and `patient_checkins.patient_user_id` — count and cadence
3. **Symptom severity:** `patient_checkins.energy`, `.nausea`, `.mood` — primary risk inputs
4. **Escalations:** `care_events` where `type = 'escalation_requested'`, linked `doctor_reviewed` and `follow_up_completed` events
5. **Intervention outcomes:** `patient_interventions.status`, `.feedback_result`, timestamps for lifecycle stages
6. **Treatment retention:** `patients.treatment_status`, `outcome_snapshots.treatment_active_30d/60d/90d`
7. **Provider activity:** `doctor_notes.created_at`, care event timestamps for reviews and follow-ups

### Data Points to Minimize or Avoid for HIPAA/Privacy

1. **Stop writing `context_summary` while AI is disabled.** It stores PHI with no current consumer. Gate the write on `INTERVENTION_AI_MODE !== 'fallback'`.
2. **Stop writing `deidentified_ai_payload` while AI is disabled.** Same gating recommendation.
3. **Add a retention policy for `intervention_events.treatment_state_snapshot`.** This PHI JSONB grows unboundedly. Consider a 90-day hard delete or replace with a smaller derived summary.
4. **Add a retention policy for `patient_interventions.patient_note`.** PHI free-text with no read surface and no lifecycle. Either surface it in the clinic dashboard or stop collecting it.
5. **Never expand `analytics_events.payload` to include symptom-level data.** Keep the allowlist tight. The analytics table has a lower protection tier than PHI tables.
6. **Confirm `care_events.metadata` schema per event type.** Add a validation layer in the route handler or in the Zod schema to prevent PHI from accidentally entering metadata.
7. **The five wellness inputs** (feeling, energy, stress, hydration intent, training intent) are PHI stored only on-device. This is the right design — do not add a server-side sync for these unless there is a strong clinical need.

---

*This document was generated by code audit only. No production database was queried, no data was modified, and no code was changed.*
