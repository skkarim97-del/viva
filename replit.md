# Replit Workspace

## Overview

This project is a monorepo for VIVA, a mobile-first AI health and wellness coaching application. It is specifically designed as a premium GLP-1 patient support platform (iOS/Android/web) built with Expo/React Native. VIVA aims to assist GLP-1 medication users with appetite management, side effect mitigation, protein/hydration coaching, recovery support, muscle preservation, and treatment consistency.

## User Preferences

The user prefers an understated, confident, premium, and modern feel for the application. The tone should be calm confidence, simplicity, clarity, and human, avoiding hype, slang, jargon, or emojis. Every sentence should either explain meaning or tell the user what to do.

**Critical rules:**
- No em dashes. Use periods instead.
- Hydration always in cups (8-10 cups). Never liters.
- ActionCategory includes "consistent" but medication is handled separately in "Your Treatment" section. Plan categories: move, fuel, hydrate, recover.
- DailyStatusLabel strings: "You're in a good place today" | "A few small adjustments will help today" | "Let's make today a bit easier" | "Your body may need more support today"
- Forbidden patient-facing words: dropout risk, churn, adherence risk, compliance risk, failing treatment.
- Risk engine scoring: Recovery Breakdown (+25), Activity Decline (+20), Fueling Breakdown (+25), Symptom Load (+20), Consistency Breakdown (+10). Scores: 0-20=low, 21-40=mild, 41-70=elevated, 71+=high.
- Coach responses: 1 framing sentence + 2-3 practical actions + optional reason. 3-5 sentences max. No lists, no bullets. Decisive and direct.
- Bundle ID: com.sullyk97.vivaai, owner: sullyk97.
- pnpm-workspace.yaml overrides REMOVED (do not re-add).

## System Architecture

The system is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9. The backend is an Express 5 API server with PostgreSQL and Drizzle ORM, using Zod for validation. API codegen is handled by Orval from an OpenAPI spec, and the build process uses esbuild.

### UI/UX Decisions (Viva App)

-   **Design Philosophy**: Optimize for clarity, confidence, simplicity, and action, acting as a supportive daily companion for GLP-1 patients.
-   **Design System**:
    -   **Colors**: Primary dark navy (#142240 light / #38B6FF dark), Accent blue (#38B6FF), White (#FFFFFF). Green (#34C759) for positive states. Category colors: Move (#FF6B6B), Fuel (#F0A500), Hydrate (#5AC8FA), Recover (#8B5CF6), Consistent (#142240).
    -   **Card Style**: Background contrast only (no borders), #F5F6FA cards on white, radius 20 on all cards.
    -   **Typography**: Montserrat font family (400Regular, 500Medium, 600SemiBold, 700Bold) loaded via @expo-google-fonts/montserrat. Page titles 28px 700Bold, section headers 18px 600SemiBold, body 14px 400Regular.
    -   **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps.
    -   **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements. Subtle scale (1.02x selected, 0.96x pressed) for selection animations.
    -   **Dividers**: HairlineWidth only, using background color.
-   **Brand**: "VIVA AI" logo (dark navy pill with white "VIVA" + blue "AI" text) from `assets/viva-logo-cropped.png`.

### GLP-1 Data Model

-   **UserProfile**: Includes `glp1Medication`, `glp1Reason`, `glp1Duration`, optional dose/injection day, `baselineSideEffects`, `proteinConfidence`, `hydrationConfidence`, `mealsPerDay`, `underEatingConcern`, `strengthTrainingBaseline`.
-   **MedicationProfile**: Normalized data for medication brands, doses, frequency, titration history.
-   **MedicationLogEntry**: Records medication intake status, notes, and timestamp.
-   **GLP-1 Daily Inputs**: Tracks `energy`, `appetite`, `nausea`, `digestion`.
-   **Mental State Check-in**: Records `mentalState` (focused/good/low/burnt_out) influencing plan generation.

### Technical Implementations & Features

-   **Onboarding**: A 13-step GLP-1 specific flow covering personal details, medication, lifestyle, and integrations.
-   **Dashboard (Today tab)**: Displays greeting, status, "Your Treatment" section, daily inputs, "Your Plan" actions, coach insights, and metrics. Medication profile and dose log inform the coach API.
-   **Your Treatment Section**: Manages medication brand, dose, and frequency logging, separate from daily actions. Includes structured dose increase flow with Previous Dose + New Dose + Date Changed. Standard medications show brand-specific pill options from `medicationData.ts`. New dose updates the active `doseValue` in the profile. "Other" medications use manual text inputs with validation (new > previous). Dose increase flows into all engines via `titrationHelper.ts`.
-   **Adaptive Coaching**: Employs a rules-based risk engine (`calculateDropoutRisk`) and a GLP-1 focused coach system prompt prioritizing recovery, side effect management, protein, muscle preservation, and hydration over performance.
-   **Daily Actions ("Your Plan")**: Four checkable actions per day (Move/Fuel/Hydrate/Recover) with flexible ranges and medication-aware `planTier` selection.
-   **Plan Engine**: `pickMedAwarePlanTier()` adjusts plan tiers based on dose level, titration, days since last dose, and daily inputs. `titrationHelper.ts` provides `TitrationContext` with intensity levels (none/mild/moderate/peak) based on days since dose change, used by all engines for graduated adjustments within a 14-day window.
-   **Weekly Plan**: AI-powered weekly coaching with GLP-1 specific rules. An adaptive engine (`lib/engine/weeklyAdaptiveEngine.ts`) computes internal severity to adjust daily plans and provide patient-facing adaptive notes, including anti-snowballing logic.
-   **Trends Tab**: Features Recovery/Body, Movement, Consistency, and Medication sections. Includes "Treatment Patterns" with GLP-1 specific intelligence insights and "What We're Noticing" for detected patterns.
-   **AI Coach**: Full-screen chat modal with streaming SSE responses, offering GLP-1 focused quick actions and a rewritten system prompt.
-   **Input Intelligence Layer**: Numeric scoring for input categories (energy, appetite, hydration, protein, sideEffects, movement), 7-day rolling analytics, and Pearson correlations to generate natural language insights.
-   **Adaptive Intelligence Layer** (`data/patternEngine.ts`): Observes user data, detects patterns (rolling averages, post-dose effects, behavioral patterns), and adjusts plan outputs with confidence scoring.
-   **Risk Engine**: `calculateDropoutRisk()` provides medication-aware risk scores translated into empathetic user messages (`translateRiskToUserMessage()`).
-   **Insights Engine**: `data/insights.ts` provides GLP-1 specific week summaries, coach insights, sleep intelligence, and daily analytics, using treatment-focused language.
-   **Health Data Providers**: Handles integration with Apple Health (HealthKit) on iOS. No mock data fallback. When no health data is connected, the app shows clean empty states instead of fake metrics. A `hasHealthData` flag and `availableMetricTypes: AvailableMetricType[]` in AppContext drive conditional rendering across all screens. Only metrics with real HealthKit data are displayed (per-metric availability tracking via `detectAvailableTypes`). `fillDefaults()` uses zero for all missing physiological values instead of fabricated defaults. Write permissions are not requested (read-only HealthKit access). Settings shows a "Retry sync" button when sync fails.
-   **Settings Screen**: Mirrors onboarding profile fields (Medication, Dosage, Weight, Goal Weight, Goals). Removed training days, fasting preference, and coaching tone. Weight fields are editable via modal.
-   **Weekly Weight Log**: Server-backed weight history in its own `patient_weights` table (append-only). Mobile auto-prompts via `WeightLogModal` once per cold-start when the latest entry is ≥7 days old (server computes `weeklyPromptDue`); patient can also log manually anytime from the Settings "Weekly weight" row. Doctor dashboard shows latest weight + days-since + up/down trend chip in the patient detail header. Endpoints: `GET/POST /me/weights`, `GET /patients/:id/weight`.
-   **Weekly Completion**: Tracks completed days within the current calendar week (Mon-Sun). Shows X of 7 days completed, resets each week.
-   **State Management**: Context-based state management (AppContext) for GLP-1 specific fields and logging.
-   **Navigation**: Tab bar for Today, Plan, Trends, Settings, with modals for subscription and stack navigation for onboarding.

## Doctor Dashboard (artifacts/viva-dashboard)

A standalone React + Vite web app at `/viva-dashboard/` for the care team. Built lean (no design subagent), wouter for routing, tanstack-query for data, same-origin fetch with `credentials: "include"`. Pages: Login (demo creds prefilled), Patients list (table with risk badge), Patient detail (risk explanation, recent check-ins, care team notes CRUD). VIVA navy/accent palette, Montserrat + Inter.

## Backend MVP (artifacts/api-server)

Express 5 + Drizzle + Postgres. Session auth via `connect-pg-simple` with manually-provisioned `session` table (createTableIfMissing breaks under esbuild bundling). Login regenerates session ID and waits on `req.session.save()` before responding. CORS with credentials, sameSite=lax, `trust proxy: 1`. Schema: users (doctor|patient), patients, patient_checkins, doctor_notes. Rules-based risk engine in `src/lib/risk.ts` (silence +30, low energy +20, severe nausea +15, mood decline +10; bands low/medium/high). Endpoints: `/api/auth/{login,logout,me}`, `/api/patients`, `/api/patients/:id/{checkins,risk,notes}`, `/api/me/{checkins,risk}`. Demo creds: `doctor@vivaai.demo` / `viva-demo-2026`. Seed script in `scripts/seed.ts` creates 1 doctor + 4 varied patients with 25-29 days of check-ins; idempotent.

## Check-in Sync Queue

`artifacts/pulse-pilot/lib/sync/checkinSync.ts` is the persistent
queue that mirrors patient daily state to the backend. It owns:

- pending check-in snapshots (keyed by date — a later save for the
  same date overwrites the prior snapshot, matching the server's
  `(patient_user_id, date)` upsert)
- pending guidance acks, trend responses, and clinician escalation
  requests (keyed by `(date, symptom)` — re-enqueueing replaces)
- single-flight `flush()` so concurrent triggers (cold-start hook,
  `AppState` foreground transition, user save) never race
- retriable vs. fatal classification (`status === 0` timeout/network,
  `5xx`, `408/429` retry; everything else dropped after one attempt)
- `subscribe()` for `checkinSyncStatus` / `checkinLastSyncAt` exposed
  via `AppContext`. The Today tab swaps "Reflection saved" for
  "Saved on this device — we'll sync when you're back online" when
  the queue is in `failed` state.

The `sessionApi` `request()` helper now wraps `fetch` in an
`AbortController` with `DEFAULT_TIMEOUT_MS = 15_000` and surfaces
timeouts as `HttpError(0, "request_timeout")` so the queue can
retry them.

`AppState.addEventListener("change", ...)` in `app/_layout.tsx`
calls `flushCheckinSync()` on every "active" transition, and
`AppContext` calls `checkinSync.flush()` once on mount.

## Daily Check-in Reminders

Local-only push reminders for the patient app, owned by `artifacts/pulse-pilot/lib/reminders.ts`.

-   **Slots**: 12:00 PM and 7:00 PM local time, defined in `REMINDER_TIMES`.
-   **Default**: ON for new installs (`getRemindersEnabled` only treats explicit `"false"` in AsyncStorage as opt-out).
-   **No duplicate after check-in**: `rescheduleReminders({ hasCheckedInToday: true })` skips today's slots entirely. `AppContext.saveDailyCheckIn` calls this immediately after a successful save (lazy-imported so the web build still loads). The `useReminderScheduler` hook in `app/_layout.tsx` also re-fires on `[user, hasCheckedInToday]` changes and on every `AppState === "active"` transition.
-   **Forward window**: 7 days. Cancel-and-replace on every reschedule keeps the window fresh; a missed launch only affects future days, not today.
-   **Tag scoping**: every scheduled notification carries `data.tag === "viva-reminder"`. `cancelOurScheduled` filters on this so unrelated future notifications are never touched.
-   **Single-flight runId**: every reschedule call grabs `nextRunId()` and bails on `isStale(myRun)` after each await. Prevents the four overlapping callers (foreground, signed-in user effect, post-check-in, settings toggle, sign-out) from racing each other into a stale schedule.
-   **Sign-out wipe**: `AuthContext.logout` calls `clearAllReminders()` so the next sign-in (possibly a different patient on the same device) doesn't inherit the previous user's queue.
-   **Settings UI**: `RemindersSection` in `app/(tabs)/settings.tsx`. Single toggle, inline OS permission request on first enable, "Open Settings" affordance on denial. AppState foreground listener re-reads permission so the row reflects newly-granted permission immediately on return from OS Settings.
-   **Verification**: `.local/scripts/verify-reminders.mjs` — 23 invariants covering default-on, toggle-off, permission denial, forward-window math at six clock times, no-duplicate-after-check-in, idempotent re-check-in, tag-scoped cancellation, and single-flight runId.

## Known Follow-ups (post-pilot cleanup)

-   **`artifacts/api-server/src/routes/patients.ts` — pre-existing TypeScript errors**: several handlers cast `req as AuthedRequest` but `AuthedRequest` doesn't include `auth` in its type, so `req.auth.userId` reports as missing. Build still succeeds (esbuild strips types) and the runtime is correct because the auth middleware does populate `req.auth`. Tighten by augmenting Express's `Request` type with an optional `auth` field via module augmentation, then have the auth middleware narrow it for downstream handlers. Unrelated to current pilot-critical reliability work.

## Invite & Activation

-   **TTL**: 14 days, defined in `artifacts/api-server/src/lib/inviteTokens.ts` as `INVITE_TOKEN_TTL_DAYS`. Both the activate route and the invite-preview surfaces (HTML and JSON) enforce it via the shared `isInviteTokenExpired()` helper. Legacy rows (issuedAt = null) are grandfathered to never expire so existing pilot invites aren't stranded. `/patients/invite` and `/patients/:id/resend` always stamp `activationTokenIssuedAt`.
-   **Atomic activation**: the activate flow performs the token claim inside a single `db.transaction()` — UPDATE on `patientsTable` filters on `activationToken=$token AND activatedAt IS NULL` and uses `.returning()` to detect race losers. The password hash is computed BEFORE the transaction (so a hash failure can't strand the token); the password write happens INSIDE the transaction (so a partial activation can't lock out the patient). Two concurrent activates resolve as 200/409 — verified with parallel curl test 2026-04-19.
-   **Status codes**: 400 invalid_input, 404 invalid_token (not found OR rotated by /resend after we read), 409 already_activated, 410 token_expired (TTL exceeded). The mobile client already maps 404→"not valid" and 409→"sign in instead"; 410 surfaces the same "no longer valid" copy the invite landing uses.

## External Dependencies

-   **API Framework**: Express 5
-   **Database**: PostgreSQL
-   **ORM**: Drizzle ORM
-   **Validation**: Zod (`zod/v4`), `drizzle-zod`
-   **API Codegen**: Orval
-   **Mobile Development**: Expo (React Native)
-   **Health Data**: Apple Health / HealthKit (`react-native-health`)
-   **Persistence**: AsyncStorage (local state + bearer token)
-   **Charting**: `react-native-svg`

## Mobile <-> Backend Auth (April 2026)

The patient mobile app and the doctor dashboard share the same API server.
- Doctors use cookie sessions (express-session).
- Patients use long-lived bearer tokens stored in `api_tokens` (issued by `/auth/activate` and `/auth/login`).
- `requireAuth` middleware checks the `Authorization: Bearer <token>` header FIRST and only falls back to the session cookie if no header is present. A header that doesn't match a token fails closed with 401.
- Mobile gate: no token -> `/connect` (paste invite link OR sign in); token + no local profile -> `/onboarding`; token + profile -> `(tabs)`.
- `saveDailyCheckIn` mirrors to `POST /me/checkins` fire-and-forget; failures stay local and re-sync on the next save (the endpoint upserts by patient+date).
- `mentalState` enum -> mood int mapping: focused=5, good=4, low=2, burnt_out=1, null=3.
- Sign Out lives at the bottom of the mobile Settings screen ("Account" section).
- Deep-link handling: `_layout.tsx` registers a `Linking.addEventListener("url", ...)` listener that uses `extractInviteToken` to pull the token out of any `viva://invite/<t>` or `https://viva-ai.replit.app/invite/<t>` URL and `router.replace`s into `/connect?token=<t>`. The Connect screen reads the `token` query param via `useLocalSearchParams` and prefills the invite link field.
- Patient invites are keyed on **phone number**, not email. `users.phone` is a nullable+unique text column; the invite endpoint normalizes input to digits and synthesizes a placeholder `invite-<digits>-<rand>@invite.viva.local` email so the legacy notNull/unique email column stays satisfied. The doctor onboarding form auto-appends a fresh blank patient row whenever the last one is filled, validates name+phone only, and shows a green "Invite sent" badge with copy/resend after submission.

## Symptom-Management Layer (April 2026)

Surfaces tracked GLP-1 side-effects (nausea, constipation, low appetite) on both the patient app and the doctor dashboard.
- Schema: `patient_checkins` has 6 nullable columns (`appetite`, `digestion`, `hydration`, `bowel_movement_today`, `dose_taken_today`, `guidance_shown`). `guidance_shown` is `jsonb` storing `{ "nausea": true, ... }`.
- Server: `lib/symptoms.ts` exports `computeSymptomFlags` with windows nausea=3d / constipation=5d / low_appetite=5d. A flag's `suggestFollowup=true` triggers `deriveAction`'s "Schedule follow-up" escalation.
- Endpoints: `POST /me/checkins` accepts the new optional fields; `PATCH /me/checkins/guidance` records a per-symptom ack (404 if today's row doesn't exist yet); `/me/risk`, `/patients/:id/risk` return `symptomFlags`; `/patients` list returns `symptomFlagCount`/`symptomEscalating`/`symptomSummary`.
- Mobile (Today tab): live tip cards driven by `lib/symptomTips.deriveSymptomTips` appear immediately under the "How are things today?" inputs based on the patient's current selections (nausea/appetite/digestion/hydration). Tapping "Got it" calls `AppContext.acknowledgeSymptomTip`, which fires `markGuidanceShown` and queues a retry in `pendingGuidanceAcksRef` to be replayed inside `saveDailyCheckIn` after the next successful POST (handles the "ack before today's check-in row exists" race).
- Dashboard: `PatientDetailPage` renders a "Symptom flags" section above the risk explanation with severity chips (mild/moderate/severe colored), persistence label, days-observed/window, contributors, follow-up badge, and guidance-ack status.
## Measurement + Intelligence Layer (April 2026)

Adds per-signal confidence, behavior strategy, intervention/outcome telemetry, and an internal analytics view, all derived from the central `DailyTreatmentState`.
- `DailyTreatmentState.claimsPolicy.signalConfidence`: per-signal map (`hrv`, `rhr`, `sleepDuration`, `sleepQuality`, `recovery`, `activity`) with `{ isAvailable, canCite, confidenceLevel: none|low|medium|high, confidenceReason }`. Boolean `canCite*` flags preserved for prompt gating.
- `DailyTreatmentState.communicationMode`: `reassure|simplify|encourage_consistency|caution_and_monitor|escalate|reengage`. Derived centrally from treatmentDailyState + adherenceSignal + insufficientForPlan + escalationNeed. Forwarded through `buildCoachContext` and consumed by the server prompt as the primary tone selector. Server deny-all fallback unchanged.
- DB: `intervention_events` (patient_user_id, occurred_on, surface, intervention_type, title, rationale, treatment_state_snapshot jsonb, claims_policy_summary jsonb, signal_confidence_summary jsonb) and `outcome_snapshots` (per-day proxy outcomes: next_day_checkin_completed, weekly_consistency, symptom_trend_3d/7d, adherence_improved_3d, app_engaged_72h, reengaged_after_low_adherence, treatment_active_days, etc.). Tables created via direct SQL because drizzle-kit push hits an interactive rename prompt that --force does not bypass.
- Endpoints: `POST /interventions/log` (patient-only, batched, max 50/req, body cannot impersonate other patients); `GET /interventions/recent` (patient sees own; doctor must own the requested patientId via `patients.doctorId` join, else 403); `POST /outcomes/snapshot` (patient-only); `GET /outcomes/recent` (patient-only). `linkInterventionsToOutcomes(patientId, windowDays)` joins via lateral subquery; `recomputeRecentOutcomesForAllPatients()` derives outcomes from check-ins for legacy clients.
- Client logger: `lib/intervention/logger.ts` with debounced batching (3s) and AsyncStorage dedupe per `(date|surface|type|title)`. Hooked into Today (primaryFocus + escalation + symptom tips), Plan (primaryFocus per render), Coach (`adherence_checkin` on successful send). Drops events on auth absence and on 4xx/5xx by design (no retry queue) to prevent storms.
- Internal analytics: `GET /internal/analytics/summary` (operator-key gated) aggregates by interventionType / communicationMode / primaryFocus / confidenceBand + escalation pathways + coach re-engagement. `viva-dashboard` `/internal/analytics` route renders the summary; bypasses the auth gate the same way `/internal` does.
- Forbidden user-facing words remain banned: dropout, churn, adherence/compliance risk. Hydration in cups. No em dashes.
