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
- Bundle ID: com.sullyk97.vivahealth.app, owner: sullyk97.
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
-   **Your Treatment Section**: Manages medication brand, dose, and frequency logging, separate from daily actions.
-   **Adaptive Coaching**: Employs a rules-based risk engine (`calculateDropoutRisk`) and a GLP-1 focused coach system prompt prioritizing recovery, side effect management, protein, muscle preservation, and hydration over performance.
-   **Daily Actions ("Your Plan")**: Four checkable actions per day (Move/Fuel/Hydrate/Recover) with flexible ranges and medication-aware `planTier` selection.
-   **Plan Engine**: `pickMedAwarePlanTier()` adjusts plan tiers based on dose level, titration, days since last dose, and daily inputs.
-   **Weekly Plan**: AI-powered weekly coaching with GLP-1 specific rules. An adaptive engine (`lib/engine/weeklyAdaptiveEngine.ts`) computes internal severity to adjust daily plans and provide patient-facing adaptive notes, including anti-snowballing logic.
-   **Trends Tab**: Features Recovery/Body, Movement, Consistency, and Medication sections. Includes "Treatment Patterns" with GLP-1 specific intelligence insights and "What We're Noticing" for detected patterns.
-   **AI Coach**: Full-screen chat modal with streaming SSE responses, offering GLP-1 focused quick actions and a rewritten system prompt.
-   **Input Intelligence Layer**: Numeric scoring for input categories (energy, appetite, hydration, protein, sideEffects, movement), 7-day rolling analytics, and Pearson correlations to generate natural language insights.
-   **Adaptive Intelligence Layer** (`data/patternEngine.ts`): Observes user data, detects patterns (rolling averages, post-dose effects, behavioral patterns), and adjusts plan outputs with confidence scoring.
-   **Risk Engine**: `calculateDropoutRisk()` provides medication-aware risk scores translated into empathetic user messages (`translateRiskToUserMessage()`).
-   **Insights Engine**: `data/insights.ts` provides GLP-1 specific week summaries, coach insights, sleep intelligence, and daily analytics, using treatment-focused language.
-   **Health Data Providers**: Handles integration with Apple Health (HealthKit) on iOS.
-   **State Management**: Context-based state management (AppContext) for GLP-1 specific fields and logging.
-   **Navigation**: Tab bar for Today, Plan, Trends, Settings, with modals for subscription and stack navigation for onboarding.

## External Dependencies

-   **API Framework**: Express 5
-   **Database**: PostgreSQL
-   **ORM**: Drizzle ORM
-   **Validation**: Zod (`zod/v4`), `drizzle-zod`
-   **API Codegen**: Orval
-   **Mobile Development**: Expo (React Native)
-   **AI Integration**: OpenAI (`gpt-4o-mini` for coaching chat)
-   **Health Data**: Apple Health / HealthKit (`react-native-health`)
-   **Persistence**: AsyncStorage
-   **Charting**: `react-native-svg`