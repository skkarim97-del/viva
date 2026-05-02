# AI-personalized intervention engine — Phase 1 audit + plan

Scope: design only, no code, no migrations. This document answers the
six questions the user asked and proposes a phased implementation
that does not break the existing pilot.

---

## 1. What already exists

The pilot already has **most of an intervention loop**, just not the
AI-personalized one the spec describes. Concretely:

### 1A. Mobile (pulse-pilot)
- `components/SymptomTipCard.tsx` (625 lines) -- full UI with two
  modes (`ack` -> `followup`), "Better / Same / Worse" trend
  response, "Let my clinician know" link.
- `lib/intervention/logger.ts` -- queues + flushes intervention events
  via `POST /api/interventions/log`.
- `lib/engine/dailyState.ts` -- central client-side rules engine that
  derives `primaryFocus`, `escalationNeed`, `treatmentDailyState`,
  `symptomBurden`, `recentTitration`, etc. **This is the rules
  engine the spec refers to in Part 4 -- it's already implemented,
  just on the client.**
- `app/(tabs)/index.tsx` already renders `SymptomTipCard` with
  priority badging (top tip = primary, others = secondary).

### 1B. Server (api-server)
- `intervention_events` table -- IMMUTABLE analytics rows captured
  whenever the mobile UI rendered a recommendation. Has
  `treatment_state_snapshot`, `claims_policy_summary`,
  `signal_confidence_summary`. **Wrong table for lifecycle**; rows
  cannot transition state.
- `care_events` table -- lifecycle event stream covering
  `recommendation_shown`, `escalation_requested`, `doctor_reviewed`,
  `doctor_note`, `treatment_status_updated`, `follow_up_completed`,
  `intervention_feedback`. Already wired to dashboard and patient app.
- `patient_checkins.guidanceShown` + `patient_checkins.trendResponse`
  (jsonb) -- a partial lifecycle for symptom tips, scoped to ONE
  check-in row.
- `phi_access_logs` -- HIPAA audit trail (T004) that already covers
  any new patient-PHI route.
- `lib/canAccessPatient.ts` -- doctor-owns-patient helper (T005).
- `requireDoctorMfa` + `checkDoctorMfa` (T007) -- step-up gate on
  doctor PHI reads.
- `lib/coachSafeMode.ts` -- mode env (`COACH_PILOT_MODE`) that
  defaults to `safe` in production. **Pattern we should mirror.**
- `lib/coachTemplates.ts` -- 24-cell templated response table
  (8 categories x 3 severities). **Pattern we should mirror.**
- `@workspace/integrations-openai-ai-server` -- shared OpenAI client.

### 1C. Dashboard (viva-dashboard)
- `PatientDetailPage.tsx` (1476 lines) -- already has "Care Team
  Notes", "Symptom flags", "Care loop activity" sections; clear
  insertion point for "Recent Interventions".
- `PatientsPage.tsx` -- worklist already has bucket logic keyed off
  `needsReview` (escalation_requested with no doctor_reviewed).
  Adding "Worse After Intervention" + "Pending Feedback" buckets is
  an additive change.
- `lib/api.ts` -- typed REST client; care-events endpoints already
  wired.

---

## 2. Where interventions should be generated

**Server-side, in a new module `artifacts/api-server/src/lib/
interventionEngine.ts`**, NOT on the mobile client.

Reasons:
- iOS, Android, and the web preview must all see the same
  interventions; only a server-side engine guarantees that.
- The HIPAA-safe OpenAI payload builder MUST run server-side (the
  mobile client already has identifiers in memory and there's no
  way to prove a client never leaked them).
- Audit logging (PHI access, AI-deidentified-payload-used,
  fallback-used) only works inside the request handler's
  `phi_access_logs` audit closure.

The mobile client's existing `lib/engine/dailyState.ts` STAYS where
it is -- it powers the offline/today snapshot rendering and the
"insufficient data" notice. We do NOT replace it. The server engine
is a NEW, independent rules layer that produces a generated
intervention *record*; the client just displays whatever the server
returned via `GET /api/patient/interventions/active`.

**Trigger point:** mobile-driven, not server-hooked.

After a successful check-in (`POST /api/me/checkins` returns 201),
the mobile client calls `POST /api/patient/interventions/generate`
with `{source:"checkin"}`. We do NOT bolt generation INTO the
checkins handler because (a) it doubles the latency of the most-used
endpoint, (b) it tangles two concerns inside one transaction, (c)
the patient may want to ask for an intervention without checking in
("Patient requested review" trigger).

---

## 3. Is a new `patient_interventions` table needed?

**Yes -- new table, NEW serial PK, no changes to existing PKs or
columns.**

Justification by elimination:

| Existing table | Why it doesn't fit |
|---|---|
| `intervention_events` | Append-only analytics rows. The schema bakes in `treatment_state_snapshot`/`claims_policy_summary` as NOT NULL, neither of which a server-generated intervention has. Rows cannot transition state. |
| `care_events` | A flat event LOG, not an entity. The spec needs an entity with mutable status (`shown -> pending_feedback -> ...`) and timestamps for each transition. Forcing a state machine into an event log loses single-source-of-truth and breaks the existing analytics queries. |
| `patient_checkins.guidanceShown` | Per-day jsonb. Cannot represent multiple concurrent interventions, can't span days, can't reference an OpenAI payload. |
| `coach_messages` | Wrong actor (coach is patient-driven Q&A); wrong privacy model (body=null in pilot, but interventions need to STORE the rendered text so the patient sees the same copy on rerender). |

**Proposed shape (NOT YET CREATED):**

```
patient_interventions
  id                          serial PRIMARY KEY        -- new PK, never changes
  patient_user_id             integer NOT NULL FK users(id) ON DELETE CASCADE
  doctor_id                   integer NULL FK users(id) ON DELETE SET NULL
  trigger_type                text NOT NULL             -- enum
  symptom_type                text NULL
  severity                    integer NULL
  status                      text NOT NULL DEFAULT 'shown'  -- enum
  risk_level                  text NOT NULL DEFAULT 'low'    -- enum
  context_summary             jsonb NOT NULL DEFAULT '{}'
    -- INTERNAL ONLY. Full patient context. NEVER sent to OpenAI.
  deidentified_ai_payload     jsonb NULL
    -- The exact payload that WAS sent to OpenAI, after PHI strip.
    -- Null if generated_by != 'rules_ai_deidentified'.
  what_we_noticed             text NOT NULL
  recommendation              text NOT NULL
  follow_up_question          text NOT NULL
  recommendation_category     text NULL
  feedback_result             text NULL
  patient_note                text NULL
    -- INTERNAL ONLY. Patient free text. NEVER sent to OpenAI.
  escalation_reason           text NULL
  generated_by                text NOT NULL DEFAULT 'rules_fallback'
  accepted_at                 timestamp NULL
  feedback_requested_at       timestamp NULL
  feedback_collected_at       timestamp NULL
  escalated_at                timestamp NULL
  resolved_at                 timestamp NULL
  created_at                  timestamp NOT NULL DEFAULT now()
  updated_at                  timestamp NOT NULL DEFAULT now()

indexes:
  (patient_user_id, status, created_at DESC)  -- "active for this patient"
  (doctor_id, status, created_at DESC)        -- worklist bucketing
  (status, created_at)                        -- expire/cleanup jobs
  (trigger_type, created_at)                  -- analytics
  (risk_level, created_at)                    -- elevated-priority queue
```

Notes:
- `patient_user_id` matches the existing schema convention (every
  other patient-scoped table is named that way; `patient_id` would
  be inconsistent).
- All enums kept as `text` not Postgres enums, matching every other
  table in the schema -- avoids migration friction when an enum
  value is added.
- `context_summary` is full PHI in a controlled column -- it stays
  in our DB, never goes to OpenAI.
- `deidentified_ai_payload` stores ONLY what was sent upstream; this
  is what auditors will inspect to verify the de-id boundary held.

---

## 4. Files that need to change (Phase 2+)

### 4A. New files (server)
- `lib/db/src/schema/patientInterventions.ts` -- new table.
- `artifacts/api-server/src/lib/interventionEngine/index.ts` --
  orchestrator: `generatePersonalizedIntervention()`.
- `artifacts/api-server/src/lib/interventionEngine/context.ts` --
  `buildPatientInterventionContext(patientId)` (Part 3).
- `artifacts/api-server/src/lib/interventionEngine/triggers.ts` --
  `detectInterventionTriggers(context)` (Part 4).
- `artifacts/api-server/src/lib/interventionEngine/deidentify.ts` --
  `buildDeidentifiedOpenAIInterventionPayload()` + a runtime PHI
  scanner that fails closed.
- `artifacts/api-server/src/lib/interventionEngine/templates.ts` --
  the 9 fallback templates from spec lines 426-471.
- `artifacts/api-server/src/lib/interventionEngine/openai.ts` --
  the constrained OpenAI call (JSON-mode, system prompt from spec
  Part 5).
- `artifacts/api-server/src/lib/interventionEngine/safeMode.ts` --
  mirrors `coachSafeMode.ts`. New env var `INTERVENTION_AI_MODE`
  with values `fallback` (no OpenAI) | `ai_deidentified`. Defaults
  to `fallback` in production until we explicitly flip it.
- `artifacts/api-server/src/routes/patientInterventions.ts` --
  patient endpoints (Part 6: generate, active, accept, dismiss,
  feedback, escalate).
- `artifacts/api-server/src/routes/clinicInterventions.ts` --
  doctor endpoints (Part 6: list-by-clinic, list-by-patient).

### 4B. Modified files (server)
- `lib/db/src/schema/index.ts` -- export new table.
- `artifacts/api-server/src/routes/index.ts` -- mount routers under
  `/api/patient/interventions` and `/api/clinic/interventions`.
- `artifacts/api-server/src/routes/internal.ts` -- add
  intervention metrics roll-up (spec Part 9 pilot metrics).
- `scripts/ec2/viva-api.env.example` -- document `INTERVENTION_AI_MODE`.

### 4C. New + modified files (mobile)
- `artifacts/pulse-pilot/lib/api/interventionsClient.ts` (NEW) --
  generate / active / accept / dismiss / feedback / escalate.
- `artifacts/pulse-pilot/components/InterventionCard.tsx` (NEW) --
  the "Personalized check-in" card (spec Part 7). Reuses styling
  from `SymptomTipCard.tsx` so visual continuity holds.
- `artifacts/pulse-pilot/app/(tabs)/index.tsx` (MODIFIED) --
  render `InterventionCard` from server-returned data when
  available; FALL BACK to existing `SymptomTipCard` flow when
  server is unreachable or returns no active intervention. The
  fallback is essential for offline tolerance.
- `artifacts/pulse-pilot/types/index.ts` (MODIFIED) -- add
  `Intervention`, `InterventionStatus`, etc. types.

### 4D. New + modified files (dashboard)
- `artifacts/viva-dashboard/src/lib/api.ts` (MODIFIED) --
  intervention client methods.
- `artifacts/viva-dashboard/src/pages/PatientDetailPage.tsx`
  (MODIFIED) -- add "Recent Interventions" section near the
  existing "Care loop activity" section.
- `artifacts/viva-dashboard/src/pages/PatientsPage.tsx`
  (MODIFIED) -- add bucket sourcing for "Worse After Intervention"
  and "Pending Feedback" using a new GET /api/clinic/interventions
  summary call. Worklist priority order from spec Part 8.

### 4E. Tests
- `artifacts/api-server/src/lib/interventionEngine/__tests__/
  deidentify.test.ts` -- PHI stripping unit tests (spec Part 12 #9,
  #10, #11): name, email, phone, DOB, raw note, user IDs, exact
  timestamps must NOT appear in the de-id payload.
- `artifacts/api-server/src/lib/interventionEngine/__tests__/
  triggers.test.ts` -- each of the 11 trigger conditions hits the
  expected branch.
- `artifacts/api-server/src/lib/interventionEngine/__tests__/
  fallback.test.ts` -- spec Part 12 #6: OpenAI unavailable -> a
  valid intervention is still returned with `generated_by =
  rules_fallback`.

### 4F. Docs
- `docs/intervention-engine.md` -- runbook (env vars, fallback
  behavior, kill switch, audit trail location).
- `docs/authz-audit.md` -- extend with intervention routes.

---

## 5. Risk areas

### R1. PHI leakage to OpenAI (highest risk)
The de-identification function is the entire HIPAA story. A single
field copied through (`patient.name`, `notes` substring, doctor name
joined accidentally) defeats the pilot's central guarantee.

**Mitigation:**
- Whitelist-only payload builder. The function takes `(triggerType,
  severityBucket, riskLevel, /* enum buckets only */)` and returns
  a struct of literal types. Free-text fields are **not** parameters.
- Runtime PHI scanner: serializes the proposed OpenAI payload to JSON
  and rejects it if any value matches `\d{10}` (phone), basic email
  regex, ISO date string, or a list of known sensitive substrings
  (patient.name, doctor.name, clinic name) loaded at request time.
  On rejection, fall back to template + log
  `intervention_phi_guardrail_blocked_ai`.
- Pilot starts with `INTERVENTION_AI_MODE=fallback` (no OpenAI dial
  at all). We flip to `ai_deidentified` only after a code-review +
  manual audit of the de-id boundary.

### R2. Two-table source-of-truth drift
`care_events.intervention_feedback` already records "better/same/
worse". `patient_interventions.feedback_result` will also record
the same value. If they ever diverge, the dashboard tells one story
and analytics tells another.

**Mitigation:** the `/feedback` endpoint writes to BOTH in the same
transaction, with the `care_events` row pointing at the
intervention via `metadata.intervention_id = <patient_interventions.id>`.
Document this in the schema comment.

### R3. Existing mobile SymptomTipCard regression
The existing card is wired to `lib/intervention/logger.ts` ->
`/api/interventions/log`. Replacing it without keeping a fallback
breaks offline rendering and any patient who's mid-flight when the
release ships.

**Mitigation:** keep both paths. `InterventionCard` for
server-generated; `SymptomTipCard` for the offline / no-active-
intervention case. Don't delete `SymptomTipCard` in this work.

### R4. AWS RDS migration timing
T007 already pushed `mfa_secret`/`mfa_enrolled_at`/
`mfa_recovery_codes_hashed` to RDS via
`NODE_TLS_REJECT_UNAUTHORIZED=0 DATABASE_URL=$AWS_DATABASE_URL pnpm push-force`.
Adding `patient_interventions` requires the same dance. Both
local heliumdb and AWS RDS must end up with the new table BEFORE
the EC2 service restarts on a build that imports it.

**Mitigation:** Phase 2 runs `pnpm push` against local first,
verifies, then pushes to RDS, then redeploys EC2. Schema-first,
deploy-second. **`users.id` stays serial; no other PK changes.**

### R5. Coach pilot mode confusion
Operators reading the EC2 env file will see `COACH_PILOT_MODE=safe`
and might assume that gates ALL OpenAI calls. The new
`INTERVENTION_AI_MODE` env var is a SEPARATE gate.

**Mitigation:** explicit comment block in
`scripts/ec2/viva-api.env.example` calling out the two independent
modes; runbook entry; default to `fallback` in production so the
two cannot accidentally diverge.

### R6. Dashboard worklist re-ranking
Adding "Worse After Intervention" / "Pending Feedback" buckets
ahead of existing buckets changes which patient the doctor sees
first when they open the worklist. That's the intended behavior of
the spec, but it's a UX change worth flagging in the release notes.

**Mitigation:** mention in `docs/intervention-engine.md` runbook;
keep the old `needsReview` bucket so existing escalations don't
disappear.

### R7. Spec-vs-current naming drift
Spec uses `patient_id`; existing schema uses `patient_user_id`.
Spec uses `severity 1..5`; existing schema uses
`severity: "mild"|"moderate"|"severe"`. We pick existing-schema
naming everywhere and do the translation at the route boundary.

---

## 6. Safest Phase 2 implementation plan

Sequenced for safe, reviewable rollout. **No phase touches an
existing PK; no phase modifies an existing column type.**

### Phase 2.1 -- Schema + de-id boundary (no UI, no AI)
1. Add `patient_interventions` schema file. No FK to anything except
   `users(id)`; pattern is identical to T004's `phi_access_logs`.
2. Push to local heliumdb, verify, push to AWS RDS (T007 procedure).
3. Implement `deidentify.ts` + runtime PHI scanner + unit tests.
   These tests can run with no DB, no OpenAI, no routes.
4. **Gate:** PHI strip tests pass; manual review of allowlist.

### Phase 2.2 -- Engine in fallback-only mode
1. Implement `templates.ts` (9 spec fallbacks).
2. Implement `triggers.ts` (11 spec triggers).
3. Implement `context.ts` (Part 3 context builder).
4. Implement `index.ts` orchestrator that ALWAYS uses fallback
   (`INTERVENTION_AI_MODE=fallback`). OpenAI client not imported
   yet. Unit tests for each trigger -> template selection.
5. **Gate:** every spec Part 12 test #1, #2, #3, #4, #5, #6 passes
   with fallback templates only.

### Phase 2.3 -- Patient API + mobile UI
1. Mount `/api/patient/interventions` router with all six endpoints.
2. Add audit (`phiAudit`), patient-scope check
   (`requirePatient` + `id-belongs-to-me` filter).
3. Build `InterventionCard.tsx` + `interventionsClient.ts`.
4. Render in Today tab BELOW existing `SymptomTipCard` (server card
   wins when present; symptom card fills the gap when absent).
5. **Gate:** spec acceptance criteria 1-7 verified end-to-end on
   real mobile.

### Phase 2.4 -- Doctor API + dashboard UI
1. Mount `/api/clinic/interventions` router.
2. Add `requireDoctorMfa` + `canAccessPatient` on every read.
3. Add "Recent Interventions" section to `PatientDetailPage`.
4. Add "Worse After Intervention" / "Pending Feedback" buckets to
   `PatientsPage`. Existing buckets keep their current ordering at
   second priority.
5. **Gate:** spec acceptance criteria 8-9, 11-12 verified.

### Phase 2.5 -- Analytics + escalation propagation
1. `/feedback` writes to BOTH `patient_interventions` and
   `care_events.intervention_feedback` (same txn).
2. `/escalate` writes a `care_events.escalation_requested` row, so
   the existing worklist `needsReview` logic surfaces it without
   any new code on the dashboard side.
3. Add intervention rollups to `/api/internal/metrics`
   (spec Part 9 pilot metrics).
4. **Gate:** spec Part 9 events fire; metrics endpoint returns
   non-zero values after smoke flow.

### Phase 2.6 -- AI on (gated)
1. Add `openai.ts` call -- JSON-mode, max 200 tokens, system
   prompt verbatim from spec Part 5.
2. Wire into orchestrator only when `INTERVENTION_AI_MODE=ai_deidentified`.
3. Add the runtime PHI scanner BEFORE the OpenAI call; fall back
   on any rejection.
4. Add `intervention_ai_deidentified_payload_used`,
   `intervention_fallback_used`,
   `intervention_phi_guardrail_blocked_ai` analytics events.
5. **Gate:** flip env var on staging, verify pilot tests still
   pass, audit one week of `deidentified_ai_payload` rows in RDS to
   confirm no PHI leaked, only then flip prod.

Total LOC estimate (rough): ~1500 server, ~600 mobile, ~400 dashboard,
~300 tests. Each phase is independently reviewable and shippable.

---

## Open questions for the user before Phase 2 starts

1. **Pilot starts in fallback mode -- correct?** Recommendation: yes,
   `INTERVENTION_AI_MODE=fallback` until at least 1 week of real
   traffic + audit of `deidentified_ai_payload` rows.

2. **Is the existing mobile `SymptomTipCard` (and its
   acknowledgment storage in `patient_checkins.guidanceShown`) staying
   long-term, or being deprecated once the new card is stable?**
   Recommendation: keep both for the pilot; revisit at end of pilot.

3. **Can server-side intervention generation read
   `patient_health_daily_summaries` (Apple Health steps/sleep/HRV)?**
   These are PHI. Today they only feed the dashboard. Reading them on
   the patient app's behalf to power the intervention engine is fine
   under HIPAA "treatment" purpose, but worth flagging.

4. **`patient_treatment_logs` includes `dose` text. The spec wants
   `doseTiming: "within post-dose window"` only. Confirm: never read
   the dose VALUE itself into the intervention engine?**
   Recommendation: yes, only timing buckets, never the mg value.

5. **Mobile-driven generation (mobile calls /generate after checkin)
   vs. server-hooked (checkin handler fires generation in the
   background) -- confirm mobile-driven?** Recommendation: yes.
