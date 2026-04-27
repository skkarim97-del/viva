# Replit Workspace

## Overview

This project is a monorepo for VIVA, a mobile-first AI health and wellness coaching application. VIVA is a premium GLP-1 patient support platform (iOS/Android/web) built with Expo/React Native. It assists GLP-1 medication users with appetite management, side effect mitigation, protein/hydration coaching, recovery support, muscle preservation, and treatment consistency.

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
    -   **Typography**: Montserrat font family (400Regular, 500Medium, 600SemiBold, 700Bold). Page titles 28px 700Bold, section headers 18px 600SemiBold, body 14px 400Regular.
    -   **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps.
    -   **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements. Subtle scale (1.02x selected, 0.96x pressed) for selection animations.
    -   **Dividers**: HairlineWidth only, using background color.
-   **Brand**: "Viva" wordmark (`assets/viva-logo-cropped.png`). "Viva" is the master brand; product surfaces are labelled separately as Care (mobile), Clinic (doctors), and Analytics (internal).

### GLP-1 Data Model

-   **User Profile**: Captures GLP-1 medication details, baseline side effects, protein/hydration confidence, meals per day, and strength training.
-   **Medication Profile**: Stores normalized medication data, doses, frequency, and titration history.
-   **Medication Log Entry**: Records medication intake.
-   **GLP-1 Daily Inputs**: Tracks energy, appetite, nausea, and digestion.
-   **Mental State Check-in**: Records mental state for plan generation.

### Technical Implementations & Features

-   **Onboarding**: A 13-step GLP-1 specific flow covering personal details, medication, lifestyle, and integrations.
-   **Dashboard (Today tab)**: Displays greeting, status, "Your Treatment" section, daily inputs, "Your Plan" actions, coach insights, and metrics.
-   **Your Treatment Section**: Manages medication brand, dose, and frequency logging, with a structured dose increase flow.
-   **Adaptive Coaching**: Employs a rules-based risk engine and a GLP-1 focused coach system prioritizing recovery, side effect management, protein, muscle preservation, and hydration.
-   **Daily Actions ("Your Plan")**: Four checkable actions per day (Move/Fuel/Hydrate/Recover) with flexible ranges and medication-aware `planTier` selection.
-   **Plan Engine**: Adjusts plan tiers based on dose level, titration, days since last dose, and daily inputs. `TitrationContext` provides intensity levels for graduated adjustments within a 14-day window.
-   **Weekly Plan**: AI-powered weekly coaching with GLP-1 specific rules, including anti-snowballing logic.
-   **Trends Tab**: Features Recovery/Body, Movement, Consistency, and Medication sections, including GLP-1 specific intelligence insights.
-   **AI Coach**: Full-screen chat modal with streaming SSE responses, offering GLP-1 focused quick actions.
-   **Input Intelligence Layer**: Numeric scoring for input categories, 7-day rolling analytics, and Pearson correlations for natural language insights.
-   **Adaptive Intelligence Layer**: Detects user data patterns (rolling averages, post-dose effects, behavioral patterns) and adjusts plan outputs.
-   **Risk Engine**: Provides medication-aware risk scores translated into empathetic user messages.
-   **Insights Engine**: Provides GLP-1 specific week summaries, coach insights, sleep intelligence, and daily analytics.
-   **Health Data Providers**: Integrates with Apple Health (HealthKit) on iOS for read-only access. Displays clean empty states if no data is connected; no mock data.
-   **Settings Screen**: Mirrors onboarding profile fields (Medication, Dosage, Weight, Goal Weight, Goals).
-   **Weekly Weight Log**: Server-backed weight history, with mobile auto-prompts and manual logging.
-   **Weekly Completion**: Tracks completed days within the current calendar week.
-   **State Management**: Context-based state management (AppContext) for GLP-1 specific fields and logging.
-   **Navigation**: Tab bar for Today, Plan, Trends, Settings, with modals for subscription and stack navigation for onboarding.
-   **Doctor Dashboard**: A standalone React + Vite web app served at the production root (`/`) for care teams, featuring patient lists, patient details, and care team notes. The legacy `/viva-dashboard/...` path 301-redirects to the equivalent location at the root for backward compatibility with old links.
-   **Check-in Sync Queue**: Persistent queue (`checkinSync.ts`) for mirroring patient daily state, handling pending snapshots, guidance acks, and escalation requests with retries.
-   **Daily Check-in Reminders**: Local-only push reminders for the patient app (`reminders.ts`), scheduled at 12:00 PM and 7:00 PM, with logic to prevent duplicates after check-in.
-   **Invite & Activation**: Invite tokens with a 14-day TTL, atomic activation process, and specific HTTP status codes for various activation states. Patient invites are keyed on phone number.
-   **Symptom-Management Layer**: Surfaces tracked GLP-1 side-effects (nausea, constipation, low appetite) on both patient and doctor interfaces, with symptom flags, suggested follow-ups, and tip cards.
-   **Measurement + Intelligence Layer**: Adds per-signal confidence, communication mode derivation, intervention/outcome telemetry, and internal analytics.
-   **Health KPIs**: Reports raw-signal health KPIs (e.g., % users completing next-day check-in after intervention, % users improving engagement) over a 14-day window for internal analytics.
-   **Treatment Status**: Doctor-owned source of truth for patient GLP-1 therapy status (`active`, `stopped`, `unknown`), including stop reasons and derived stop timing.

## External Dependencies

-   **API Framework**: Express 5
-   **Database**: PostgreSQL
-   **ORM**: Drizzle ORM
-   **Validation**: Zod, `drizzle-zod`
-   **API Codegen**: Orval
-   **Mobile Development**: Expo (React Native)
-   **Health Data**: Apple Health / HealthKit (`react-native-health`)
-   **Persistence**: AsyncStorage
-   **Charting**: `react-native-svg`
-   **Session Management (Doctors)**: `express-session`, `connect-pg-simple`
-   **Routing (Doctor Dashboard)**: Wouter
-   **Data Fetching (Doctor Dashboard)**: Tanstack-query