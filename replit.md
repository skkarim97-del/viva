# Replit Workspace

## Overview

This project is a monorepo utilizing pnpm workspaces and TypeScript to develop a mobile-first AI health and wellness coaching application named VIVA. The app has been pivoted to serve as a premium GLP-1 patient support platform (iOS/Android/web) built with Expo/React Native. VIVA is purpose-built for GLP-1 medication users (semaglutide, tirzepatide, liraglutide), covering appetite management, side effects, protein/hydration coaching, recovery support, muscle preservation, and treatment consistency.

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
- Bundle ID: com.sullyk97.vivahealth.app, owner: sullyk97.
- pnpm-workspace.yaml overrides REMOVED (do not re-add).

## System Architecture

The system is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9. The backend is an Express 5 API server with PostgreSQL and Drizzle ORM for data management, and Zod for validation. API codegen is handled by Orval from an OpenAPI spec, and the build process uses esbuild.

### UI/UX Decisions (Viva App)

- **Design Philosophy**: Optimize for clarity, confidence, simplicity, and action. The app should feel like a supportive daily companion for GLP-1 patients, not a cluttered dashboard or medical portal.
- **Design System**:
    - **Colors**: Primary dark navy (#142240 light / #38B6FF dark), Accent blue (#38B6FF), White (#FFFFFF). Green (#34C759) for positive states only. Category colors: Move (#FF6B6B), Fuel (#F0A500), Hydrate (#5AC8FA), Recover (#8B5CF6), Consistent (#142240).
    - **Card Style**: Background contrast only (no borders), #F5F6FA cards on white, radius 20 on all cards (16 on inner elements like bubbles/pills).
    - **Typography**: Montserrat font family (400Regular, 500Medium, 600SemiBold, 700Bold). Loaded via @expo-google-fonts/montserrat. Page titles 28px Montserrat_700Bold, section headers 18px Montserrat_600SemiBold, body 14px Montserrat_400Regular.
    - **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps.
    - **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements. Subtle scale (1.02x selected, 0.96x pressed) for selection animations.
    - **Dividers**: HairlineWidth only, using background color rather than border color.
- **Brand**: "VIVA AI" logo image asset (dark navy pill with white "VIVA" + blue "AI" text). Logo file: assets/viva-logo-cropped.png. Displayed via Logo component (components/Logo.tsx) and VivaWordmark component.

### GLP-1 Data Model

- **UserProfile fields**: glp1Medication, glp1Reason, glp1Duration, glp1DoseOptional, glp1InjectionDayOptional, baselineSideEffects, proteinConfidence, hydrationConfidence, mealsPerDay, underEatingConcern, strengthTrainingBaseline
- **MedicationProfile** (normalized): medicationBrand, genericName, doseValue, doseUnit, frequency (weekly/daily), recentTitration, previousDoseValue, timeOnMedicationBucket, telehealthPlatform, plannedDoseDay
- **MedicationLogEntry**: id, date, medicationBrand, doseValue, doseUnit, status (taken/skipped/delayed), notes, timestamp
- **Medication Data** (`data/medicationData.ts`): Brand DB (Wegovy/Ozempic/Zepbound/Mounjaro/Saxenda), dynamic dose options per brand, telehealth platforms list, helpers (getDoseTier, getBrandGeneric, formatDoseDisplay, etc.)
- **GLP-1 Daily Inputs (4 fields)**: energy (great/good/tired/depleted), appetite (strong/normal/low/very_low), nausea (none/mild/moderate/severe), digestion (fine/bloated/constipated/diarrhea). Old fields (hydration, proteinConfidence, sideEffects, movementIntent) removed from daily check-in. Plan recommendations (Move/Fuel/Hydrate/Recover) remain in "Your Plan".
- **AsyncStorage keys**: @viva_glp1_inputs, @viva_glp1_history, @viva_profile, @viva_chat, @viva_wellness, @viva_completions, @viva_integrations, @viva_weekly_plan, @viva_checkins, @viva_med_log

### Technical Implementations & Features

- **Onboarding**: 13-step GLP-1 flow: welcome, name, goals, medication (brand picker), dose (dynamic per brand), titration (yes/no + previous dose), time_on_med, telehealth (searchable grid), side_effects, nutrition, activity, integrations, summary.
- **Dashboard (Today tab)**: Layout order: greeting -> status card -> "Your Treatment" section -> "How are things today?" inputs -> "Your Plan" actions -> coach -> why plan -> check-in -> metrics. Medication profile + dose log sent to coach API. Headlines are medication-aware (titration, dose level, time on med context).
- **Your Treatment Section**: Standalone section above daily inputs. Shows medication brand, dose, and frequency. Weekly meds: day-of-week selector (Mon-Sun) to log which day the dose was taken. Shows "Dose logged this week" / "Not logged yet this week" with selected day name. Daily meds: simple one-tap "Log today's dose" / "Taken today" toggle. Treatment section is fully separate from Your Plan.
- **Adaptive Coaching**: Risk engine (calculateDropoutRisk) with rules-based scoring. GLP-1 coach system prompt covers side effect management, protein coaching, muscle preservation, hydration, and treatment consistency. Recovery > performance. Side effect management > training goals. Protein > calories. Consistency > intensity.
- **Daily Actions ("Your Plan")**: 4 checkable actions per day (Move/Fuel/Hydrate/Recover). Medication is NOT in Your Plan. Actions use flexible ranges ("20-40 min walk", "8-10 cups + electrolytes", "7-8 hours sleep") instead of fixed values. Each action has a planTier (high/moderate/low/minimal) selected by medication-aware engine. Completion count shows X/4.
- **Plan Engine**: `pickMedAwarePlanTier()` adjusts plan tiers based on dose level (high dose = more hydration, more recovery, less movement), titration (lighter plans post-dose-change), days since last dose (0-2 days = lighter, 5+ = more flexibility), daily inputs (appetite, side effects, energy). Recover/hydrate tiers are inverted (stressed = high need). Plan visibly adapts as inputs change. Modal shows "Best match today" based on recommended option match.
- **Weekly Plan**: AI-powered weekly coaching with Move/Fuel/Hydrate/Recover/Consistent categories. GLP-1 specific rules (strength training for muscle preservation, gentler plans on symptom days, protein-forward fueling).
- **Trends Tab**: Recovery/Body, Movement, and Consistency sections. Medication section (brand/dose display, dose tier, titration badge, recent dose log). "Treatment Patterns" section with GLP-1-specific intelligence insights (dose-day recovery dips, activity patterns around dose day, titration recovery impact, sleep-recovery correlation on treatment, consistency-recovery link). "What We're Noticing" insights, correlations during treatment, and pattern detection.
- **AI Coach**: Full-screen chat modal with streaming SSE responses. GLP-1 focused quick actions: side effects, protein intake, exercise, hydration, weekly focus. System prompt fully rewritten for GLP-1 context.
- **Input Intelligence Layer**: Behind-the-scenes numeric scoring for all 6 input categories (energy/appetite/hydration/protein/sideEffects/movement mapped to 1-4). 7-day rolling analytics with averages and trend direction (up/flat/down). Pearson correlations between input pairs (appetite-protein, hydration-energy, sideEffects-movement, etc.). Insights generated in natural language, never exposing numbers. Patient summary object (PatientSummary) tracks status, flags, adherence, trends, and detected patterns for coach context. No UI changes for scoring.
- **Adaptive Intelligence Layer** (`data/patternEngine.ts`): Observes user data over time, detects patterns, adjusts plan outputs, and surfaces insights. Rolling 7d/14d averages for all categories. Post-dose effect detection (appetite/energy/side effects 0-3 days after injection). Behavioral pattern detection (hydration-energy correlation, appetite-protein struggle, rest vs movement on low-energy days). Adaptive overrides with confidence scoring (low/medium/high). Patterns are computed before plan generation so freshly detected patterns always drive the current plan. Insights card ("Based on Your Data") appears on Today tab when patterns have sufficient confidence. Override precedence: side-effect overrides take priority over general correlation overrides.
- **Risk Engine**: calculateDropoutRisk() with rolling baselines for recovery, activity, fueling, symptoms, and consistency. Medication-aware weight multiplier (dose tier, recent titration, time on med). translateRiskToUserMessage() maps scores to empathetic, treatment-aware support headlines and messages.
- **Insights Engine**: `data/insights.ts` provides week summaries, coach insights, sleep intelligence, and daily analytics. All language rewritten for GLP-1 context (no generic fitness/wellness language). Uses "active days" not "workouts", "treatment" not "training", protein/muscle preservation framing throughout.
- **Health Data Providers**: `data/healthProviders.ts` handles integration with Apple Health (HealthKit) on iOS. The MVP is focused exclusively on Apple Health and Apple Watch data.
- **State Management**: Context-based state management (AppContext) with GLP-1 state fields (glp1Energy, appetite, glp1Hydration, proteinConfidence, sideEffects, movementIntent, riskResult, glp1InputHistory, medicationLog, logMedicationDose, removeMedicationDose). Completion rates and counts exclude "consistent" category.
- **Navigation**: Tab bar for Today, Plan, Trends, Settings. Modals for subscription. Stack for onboarding and metric drill-down.

## Important Files

- `artifacts/pulse-pilot/types/index.ts` - All type definitions including GLP-1 types
- `artifacts/pulse-pilot/context/AppContext.tsx` - State management with GLP-1 fields
- `artifacts/pulse-pilot/data/riskEngine.ts` - Dropout risk calculation engine
- `artifacts/pulse-pilot/data/riskTranslation.ts` - Risk score to user message translation
- `artifacts/pulse-pilot/data/inputScoring.ts` - Numeric input scoring, 7-day analytics, correlations, patient summary
- `artifacts/pulse-pilot/data/patternEngine.ts` - Adaptive pattern detection engine (rolling averages, post-dose effects, behavioral patterns, overrides)
- `artifacts/pulse-pilot/lib/engine/todayEngine.ts` - Greeting, input summary, daily status, today view generation
- `artifacts/pulse-pilot/lib/engine/trendsEngine.ts` - Correlations, patterns, GLP-1 insights, key insights, weekly averages
- `artifacts/pulse-pilot/lib/engine/coachEngine.ts` - Coach context builder (HRV baseline, sleep debt, recovery trend)
- `artifacts/pulse-pilot/lib/engine/planEngine.ts` - Daily plan generation, weekly plan generation, readiness scoring, medication-aware plan tiers
- `artifacts/pulse-pilot/lib/engine/feedbackEngine.ts` - Completion feedback
- `artifacts/pulse-pilot/lib/engine/index.ts` - Engine barrel exports (also re-exports riskEngine, inputScoring, patternEngine, and viewModels)
- `artifacts/pulse-pilot/lib/selectors/viewModels.ts` - View model builders (buildTodayViewModel, buildPlanViewModel, buildTrendsViewModel, buildCoachViewModel)
- `artifacts/pulse-pilot/lib/debug/debugGenerateOutput.ts` - Debug utility for engine outputs
- `artifacts/pulse-pilot/data/mockData.ts` - Mock data generation, trend data, metric details (plan logic moved to planEngine)
- `artifacts/pulse-pilot/data/medicationData.ts` - Brand DB, dose options, telehealth platforms, helpers
- `artifacts/pulse-pilot/app/onboarding/index.tsx` - 13-step GLP-1 onboarding flow
- `artifacts/pulse-pilot/app/(tabs)/index.tsx` - Today tab with GLP-1 daily inputs
- `artifacts/pulse-pilot/app/(tabs)/plan.tsx` - Weekly plan with GLP-1 categories
- `artifacts/pulse-pilot/app/(tabs)/trends.tsx` - Trends with treatment-aware insights
- `artifacts/pulse-pilot/app/(tabs)/coach.tsx` - Coach tab with GLP-1 quick actions
- `artifacts/api-server/src/routes/coach/index.ts` - API with GLP-1 system prompts

## External Dependencies

- **API Framework**: Express 5
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Mobile Development**: Expo (React Native)
- **AI Integration**: OpenAI (via Replit AI Integrations using `gpt-4o-mini` for coaching chat)
- **Health Data**:
    - Apple Health / HealthKit (iOS native via `react-native-health`)
- **Persistence**: AsyncStorage (for Expo/React Native)
- **Charting**: `react-native-svg` (for sparkline charts)

## API Base URL

- Web: `/api`
- Native: `https://${EXPO_PUBLIC_DOMAIN}/api`
