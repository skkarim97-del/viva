# Pre-Production Technical Debt

This file tracks pre-production technical debt that is known, scoped, and
deferred. Items here are NOT considered runtime bugs; they are hygiene work
that should be cleaned up before broader production hardening but does not
block the AWS database cutover.

---

## 1. Monorepo canonical typecheck is not green

The canonical full-monorepo typecheck (`pnpm run typecheck`) does not pass.
The failures are pre-existing and unrelated to recent feature work.

Known issues:

- `lib/db` has drizzle-zod / Zod version-skew errors. Generated
  `ZodObject<...>` types no longer satisfy the `ZodType<any, any, any>`
  constraint expected by drizzle-zod's helper signatures. Affects multiple
  schema files including `users`, `patients`, `patientCheckins`,
  `patientProfiles`, `patientHealthDailySummaries`, `patientTreatmentLogs`,
  `interventionEvents`, and `outcomeSnapshots`.
- `lib/db/dist` appears stale (last emitted before recent schema additions),
  causing phantom "missing export" errors in downstream packages whose leaf
  typecheck reads the stale `.d.ts` instead of the current source.
- `lib/integrations-openai-ai-server` has unrelated pre-existing type errors
  (missing `@types/node`, `p-retry` `AbortError` removal in newer versions,
  and possibly-undefined access on `response.data` in the image client).
- `artifacts/api-server/src/routes/patients.ts` has 3 pre-existing
  `AuthedRequest` cast warnings (lines around the doctor-facing
  `/:patientId/notes/:noteId`, `/:id/health/daily-summary`, and
  `/:id/treatment-log` handlers). These are unrelated to the import fix
  recorded below and were already present in the source. Same cast pattern
  works correctly in many earlier handlers in the same file; the most
  likely trigger is a `db.insert(...).values({...}).catch(...)` chain
  earlier in the file that disrupts downstream type inference.

---

## 2. Current scoped result (recently merged)

- Added missing imports for `patientHealthDailySummariesTable` and
  `patientTreatmentLogsTable` in `artifacts/api-server/src/routes/patients.ts`.
- Original missing-name errors are resolved.
- `GET /api/patients/:id/health/daily-summary` works for owned patients.
- `GET /api/patients/:id/treatment-log` works for owned patients.
- Non-owned patient access still returns `404`.
- Bad ID still returns `400`.
- No runtime behavior changed.

---

## 3. AWS cutover implication

This does not block AWS database cutover because:

- Runtime endpoints were verified.
- Schema exports are present in source.
- Drizzle schema push was previously verified as portable.
- The remaining typecheck issues are broader monorepo hygiene, not
  evidence that these patient endpoints are broken.
