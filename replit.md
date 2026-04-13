# Replit Workspace

## Overview

This project is a monorepo utilizing pnpm workspaces and TypeScript to develop a mobile-first AI health and wellness coaching application named VIVA. The app has been pivoted to serve as a premium GLP-1 patient support platform (iOS/Android/web) built with Expo/React Native. VIVA is purpose-built for GLP-1 medication users (semaglutide, tirzepatide, liraglutide), covering appetite management, side effects, protein/hydration coaching, recovery support, muscle preservation, and treatment consistency.

## User Preferences

The user prefers an understated, confident, premium, and modern feel for the application. The tone should be calm confidence, simplicity, clarity, and human, avoiding hype, slang, jargon, or emojis. Every sentence should either explain meaning or tell the user what to do.

**Critical rules:**
- No em dashes. Use periods instead.
- Hydration always in cups (8-10 cups). Never liters.
- ActionCategory: "consistent" (NOT "mind"). Categories: move, fuel, hydrate, recover, consistent.
- DailyStatusLabel strings: "You're in a good place today" | "A few small adjustments will help today" | "Let's make today a bit easier" | "Your body may need more support today"
- Forbidden patient-facing words: dropout risk, churn, adherence risk, compliance risk, failing treatment.
- Risk engine scoring: Recovery Breakdown (+25), Activity Decline (+20), Fueling Breakdown (+25), Symptom Load (+20), Consistency Breakdown (+10). Scores: 0-20=low, 21-40=mild, 41-70=elevated, 71+=high.
- Coach responses: 3-5 sentences, no lists, no bullets, conversational.
- Bundle ID: com.sullyk97.vivahealth.app, owner: sullyk97.
- pnpm-workspace.yaml overrides REMOVED (do not re-add).

## System Architecture

The system is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9. The backend is an Express 5 API server with PostgreSQL and Drizzle ORM for data management, and Zod for validation. API codegen is handled by Orval from an OpenAPI spec, and the build process uses esbuild.

### UI/UX Decisions (Viva App)

- **Design Philosophy**: Optimize for clarity, confidence, simplicity, and action. The app should feel like a supportive daily companion for GLP-1 patients, not a cluttered dashboard or medical portal.
- **Design System**:
    - **Colors**: Primary blue (#1A5CFF light / #5B8AFF dark), Sky blue accent (#5AC8FA), Apple-like neutrals. Green (#34C759) is used only for positive states, readiness, and progress.
    - **Card Style**: Background contrast only (no borders), #F7F7FA cards on white, radius 16-20.
    - **Typography**: Inter font family, negative letter-spacing on large text, 11-12px uppercase labels. Page titles are 28px Inter_700Bold, section headers 18px Inter_600SemiBold, body text 14px Inter_400Regular.
    - **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps.
    - **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements. Subtle scale (1.02x selected, 0.96x pressed) for selection animations.
    - **Dividers**: HairlineWidth only, using background color rather than border color.
- **Brand**: "VIVA" wordmark (all caps, Inter_500Medium, letter-spacing 3) with a stylized V pulse line symbol. App icon is a white V-pulse mark on a black background.

### GLP-1 Data Model

- **UserProfile fields**: glp1Medication, glp1Reason, glp1Duration, glp1DoseOptional, glp1InjectionDayOptional, baselineSideEffects, proteinConfidence, hydrationConfidence, mealsPerDay, underEatingConcern, strengthTrainingBaseline
- **GLP-1 Daily Inputs**: appetite (normal/low/very_low), sideEffects (none/mild/moderate/rough), proteinConfidence (good/okay/poor), movementIntent (walk/strength/light_recovery/rest), energy (great/good/tired/depleted), hydration (good/okay/poor)
- **AsyncStorage keys**: @viva_glp1_inputs, @viva_glp1_history, @viva_profile, @viva_chat, @viva_wellness, @viva_completions, @viva_integrations, @viva_weekly_plan, @viva_checkins

### Technical Implementations & Features

- **Onboarding**: 8-step GLP-1 flow: welcome, goals, glp1_context (medication/reason/duration/dose/injection day), side_effects, nutrition (protein/hydration confidence, meals, under-eating, strength training), activity, integrations, summary.
- **Dashboard (Today tab)**: Status card with GLP-1-aware daily status, feeling card, coach insight, GLP-1 daily inputs (appetite, side effects, protein confidence, movement intent) in the "Refine your day" section, Your Day actions, habit tracker, end-of-day check-in, and metric tiles. Simplified from 6 refine inputs to 4 (removed redundant Energy/Hydration rows).
- **Adaptive Coaching**: Risk engine (calculateDropoutRisk) with rules-based scoring. GLP-1 coach system prompt covers side effect management, protein coaching, muscle preservation, hydration, and treatment consistency. Recovery > performance. Side effect management > training goals. Protein > calories. Consistency > intensity.
- **Daily Actions**: 5 checkable actions per day (Move/Fuel/Hydrate/Recover/Stay Consistent), with GLP-1-informed recommendations.
- **Weekly Plan**: AI-powered weekly coaching with Move/Fuel/Hydrate/Recover/Consistent categories. GLP-1 specific rules (strength training for muscle preservation, gentler plans on symptom days, protein-forward fueling).
- **Trends Tab**: Recovery/Body, Movement, and Consistency sections. "What We're Noticing" insights, correlations during treatment, and pattern detection.
- **AI Coach**: Full-screen chat modal with streaming SSE responses. GLP-1 focused quick actions: side effects, protein intake, exercise, hydration, weekly focus. System prompt fully rewritten for GLP-1 context.
- **Risk Engine**: calculateDropoutRisk() with rolling baselines for recovery, activity, fueling, symptoms, and consistency. translateRiskToUserMessage() maps scores to empathetic, treatment-aware support headlines and messages.
- **Insights Engine**: `data/insights.ts` provides week summaries, coach insights, sleep intelligence, and daily analytics. All language rewritten for GLP-1 context (no generic fitness/wellness language). Uses "active days" not "workouts", "treatment" not "training", protein/muscle preservation framing throughout.
- **Health Data Providers**: `data/healthProviders.ts` handles integration with Apple HealthKit, Health Connect (Android), Garmin, and Samsung Health.
- **State Management**: Context-based state management (AppContext) with GLP-1 state fields (glp1Energy, appetite, glp1Hydration, proteinConfidence, sideEffects, movementIntent, riskResult, glp1InputHistory).
- **Navigation**: Tab bar for Today, Plan, Trends, Settings. Modals for subscription. Stack for onboarding and metric drill-down.

## Important Files

- `artifacts/pulse-pilot/types/index.ts` - All type definitions including GLP-1 types
- `artifacts/pulse-pilot/context/AppContext.tsx` - State management with GLP-1 fields
- `artifacts/pulse-pilot/data/riskEngine.ts` - Dropout risk calculation engine
- `artifacts/pulse-pilot/data/riskTranslation.ts` - Risk score to user message translation
- `artifacts/pulse-pilot/data/mockData.ts` - Mock data generation and daily plan logic
- `artifacts/pulse-pilot/app/onboarding/index.tsx` - 8-step GLP-1 onboarding flow
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
    - Apple HealthKit (iOS native)
    - Health Connect (Android native via `react-native-health-connect`)
    - Garmin (via backend API)
    - Samsung Health (delegates to Health Connect on Android)
- **Persistence**: AsyncStorage (for Expo/React Native)
- **Charting**: `react-native-svg` (for sparkline charts)

## API Base URL

- Web: `/api`
- Native: `https://${EXPO_PUBLIC_DOMAIN}/api`
