# Patient PHI Authorization Audit

Last reviewed: 2026-04-30 (T005 of HIPAA-readiness pass)

## Goal

Every API route that reads or writes patient PHI must enforce that the
calling actor has legitimate access to the specific patient referenced
by the route. This document enumerates each route, who can call it, and
how the access decision is made.

## The two access patterns

There are exactly two legitimate access patterns in the pilot:

1. **Patient-as-self**: The caller is the patient and the resource is
   their own data. The patient id is derived from `req.auth.userId`
   (set by `requirePatient`); routes only ever filter on `userId =
   req.auth.userId`. Cross-patient access is structurally impossible
   because no patient id from the URL is trusted.
2. **Doctor-on-assigned-patient**: The caller is a doctor and the
   resource belongs to a patient assigned to them. Access is gated by
   `lib/canAccessPatient.canAccessPatient(doctorId, patientId)` (or
   the equivalent `loadOwnedPatient` in `patients.ts`, which returns
   the row in addition to the boolean). Both helpers reduce to
   `WHERE patient_user_id = X AND doctor_user_id = Y`. False maps to a
   404 (never 403) so doctors cannot enumerate other clinics' patient
   ids.

A third pattern, **operator analytics**, exists for `/api/internal/*`
but is gated by the operator bearer key + IP allowlist + the per-row
audit log; operator endpoints intentionally surface platform-scoped
aggregates rather than per-patient PHI.

## Route x check matrix

### `artifacts/api-server/src/routes/patients.ts` (doctor → patient)

Router-level gates: `mediumApiLimiter`, `requireDoctor`, `phiAudit({getPatientId})`.

| Route | Who | Access check |
|---|---|---|
| `GET    /` | doctor | scoped by `WHERE patientsTable.doctorId = doctorId` (list of own patients) |
| `GET    /stats` | doctor | scoped by `WHERE patientsTable.doctorId = doctorId` (aggregate over own patients) |
| `PUT    /clinic` | doctor | mutates the doctor's own clinic profile; no patient id |
| `POST   /invite` | doctor | creates a NEW patient assigned to `doctorId`; ownership established at creation |
| `POST   /:id/resend` | doctor | inline ownership check (`row.doctorId !== doctorId` -> 404) |
| `PATCH  /:id/treatment-status` | doctor | `loadOwnedPatient` AND inline `eq(patientsTable.doctorId, doctorId)` in the UPDATE WHERE (defense in depth) |
| `GET    /:id` | doctor | `loadOwnedPatient` |
| `GET    /:id/checkins` | doctor | `loadOwnedPatient` |
| `GET    /:id/risk` | doctor | `loadOwnedPatient` |
| `GET    /:id/weight` | doctor | `loadOwnedPatient` |
| `GET    /:id/notes` | doctor | `loadOwnedPatient` |
| `POST   /:id/notes` | doctor | `loadOwnedPatient` |
| `DELETE /:patientId/notes/:noteId` | doctor | `loadOwnedPatient` AND inline `eq(doctorNotesTable.doctorUserId, doctorId)` in the DELETE WHERE |
| `GET    /:id/health/daily-summary` | doctor | `loadOwnedPatient` |
| `GET    /:id/treatment-log` | doctor | `loadOwnedPatient` |

### `artifacts/api-server/src/routes/careEvents.ts` (mixed)

Router-level gates: `phiAudit({getPatientId})`. Per-route auth gate listed.

| Route | Who | Access check |
|---|---|---|
| `POST   /` | patient (`requirePatient`) | events are forced to `patientUserId = req.auth.userId`; client-supplied id is not trusted; `source` is forced based on event type so a patient cannot impersonate a doctor event |
| `POST   /:patientId/reviewed` | doctor (`requireDoctor`) | `ownsPatient` (delegates to `canAccessPatient`) |
| `POST   /:patientId/follow-up` | doctor (`requireDoctor`) | `ownsPatient` (delegates to `canAccessPatient`) |
| `GET    /:patientId` | doctor (`requireAuth` then ownership) | `ownsPatient` (delegates to `canAccessPatient`) |
| `GET    /_ids/needs-review` | doctor (`requireDoctor`) | scoped by `WHERE patientsTable.doctorId = doctorId` (list of own patients with open escalations) |

### `artifacts/api-server/src/routes/me.ts` (patient-as-self)

Router-level gates: `mediumApiLimiter`, `requirePatient`,
`phiAudit({getPatientId: req.auth.userId})`.

Every query is `WHERE patientUserId = userId` where `userId =
req.auth.userId`. There are no `:id`-style patient parameters, so it
is structurally impossible for a patient to address another patient's
data through this router. Audited tables: `patientCheckinsTable`,
`patientWeightsTable`, `patientHealthDailySummariesTable`,
`patientTreatmentLogsTable`, `patientProfilesTable`.

### `artifacts/api-server/src/routes/interventions.ts` (patient + cron-style reads)

Router-level gate: `phiAudit({getPatientId: req.auth.userId})`.
Per-route auth: `requirePatient` on `POST /log`, `requireAuth` on
`GET /recent`. Patient ids in the body are forced to
`req.auth.userId`; the body cannot impersonate another patient.

### `artifacts/api-server/src/routes/outcomes.ts` (patient-as-self)

Router-level gate: `phiAudit({getPatientId: req.auth.userId})`.
Both routes use `requirePatient`. `POST /snapshot` upserts the
calling patient's outcome row; `GET /recent` reads only the calling
patient's history.

### `artifacts/api-server/src/routes/coach/index.ts` (patient-as-self via bearer)

Router-level gates: `mediumApiLimiter`,
`phiAudit({getActor, getPatientId})` with both resolvers backed by
`resolvePatientUserId` (which now hashes the bearer before lookup --
see T002 fix in commit history).

`/chat` does not use `requireAuth` (legacy public-by-default
behavior). Bearer-less requests still complete (anonymous chat) but
are not audit-logged because there is no actor to attribute. Bearer-
authed requests resolve to the bearer's patient and write a row with
`actor_role = 'patient'`. There is no way to write a coach message
"on behalf of" another patient because `resolvePatientUserId` is the
single attribution path. `resolvePatientScope` reads the patient's
own denormalized `(platformId, doctorUserId)` so doctor reads of
`coach_messages` go through `patients.ts`-style guards.

### `artifacts/api-server/src/routes/internal.ts` (operator)

Router-level gates: `mediumApiLimiter`, `operatorIpAllowlist`,
`phiAudit({actor: 'operator'})`, then `requireInternalKey` per route.

Operator endpoints surface platform-scoped or fully de-identified
aggregates only (pilot snapshots, funnel counts, intervention link
jobs). Endpoints that DO surface per-patient data (e.g. needs-review
lists) are routed through the `patients.ts` doctor surface and are
not duplicated here. The operator audit row uses
`actor_user_id = NULL`, `actor_role = 'operator'`.

### Other routes (non-PHI surface)

`auth.ts`, `invite.ts`, `analytics.ts` (de-identified product
analytics), `health.ts`, `wellknown.ts`, `vivaLogo.ts`,
`healthData.ts` (HealthKit ingest from the patient device --
patient-as-self by design): all either non-PHI or naturally scoped to
the calling patient's own `userId`.

`healthData.ts` is reviewed and confirmed naturally scoped (every
write is keyed on `req.auth.userId`); a `phiAudit` mount is a
reasonable defense-in-depth follow-up but not required by the T004
acceptance.

## Findings

* **No missing guards.** Every PHI-bearing route in the matrix above
  enforces the appropriate access pattern.
* **Helper consolidated.** The previously duplicated ownership check
  (one in `patients.ts.loadOwnedPatient`, one in
  `careEvents.ts.ownsPatient`) now routes through the shared
  `lib/canAccessPatient.ts` helper. `loadOwnedPatient` continues to
  exist because most patient routes also need the row data; refactoring
  away from it would be churn for no security benefit.
* **404 vs 403.** Both helpers map a missing-or-not-owned patient to
  the same outcome at the call site (404). This is enforced by
  convention; reviewers should reject any new route that returns 403
  for "patient exists but isn't yours".

## Out-of-scope (tracked separately)

* Doctor MFA (T007 of this pass) and operator user model (deferred).
* Time-based access revocation for transferred patients (no current
  customer requests this).
* Field-level redaction for patient notes shown to other clinicians
  in the same clinic (no cross-clinician sharing today).
