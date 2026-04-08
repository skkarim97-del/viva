# Replit Workspace

## Overview

This project is a monorepo utilizing pnpm workspaces and TypeScript to develop a mobile-first AI health and wellness coaching application named Viva. The Viva app, built with Expo/React Native, provides personalized coaching across physical health, mental well-being, energy, stress, sleep, and daily habits. It aims to be a premium, calm, and intelligent daily guide for users, focusing on clarity, confidence, simplicity, and actionable insights. The application integrates AI (OpenAI) for coaching, leverages health data from various providers, and offers a personalized, adaptive experience.

## User Preferences

The user prefers an understated, confident, premium, and modern feel for the application. The tone should be calm confidence, simplicity, clarity, and human, avoiding hype, slang, jargon, or emojis. Every sentence should either explain meaning or tell the user what to do.

## System Architecture

The system is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9. The backend is an Express 5 API server with PostgreSQL and Drizzle ORM for data management, and Zod for validation. API codegen is handled by Orval from an OpenAPI spec, and the build process uses esbuild.

### UI/UX Decisions (Viva App)

- **Design Philosophy**: Optimize for clarity, confidence, simplicity, and action. The app should feel like a smart daily brief, a premium wellness product, and an Apple-native health coach, not a cluttered dashboard or medical portal.
- **Design System**:
    - **Colors**: Primary blue (#1A5CFF light / #5B8AFF dark), Sky blue accent (#5AC8FA), Apple-like neutrals. Green (#34C759) is used only for positive states, readiness, and progress.
    - **Card Style**: Background contrast only (no borders), #F7F7FA cards on white, radius 16-20.
    - **Typography**: Inter font family, negative letter-spacing on large text, 11-12px uppercase labels. Page titles are 28px Inter_700Bold, section headers 18px Inter_600SemiBold, body text 14px Inter_400Regular.
    - **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps.
    - **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements. Subtle scale (1.02x selected, 0.96x pressed) for selection animations.
    - **Dividers**: HairlineWidth only, using background color rather than border color.
- **Brand**: "VIVA" wordmark (all caps, Inter_500Medium, letter-spacing 3) with a stylized V pulse line symbol. App icon is a white V-pulse mark on a black background.

### Technical Implementations & Features

- **Onboarding**: A 9-step premium flow covering goals, profile, activity, energy, sleep, and device integration.
- **Dashboard (Today tab)**: Card-based layout with a status card (streak, progress), feeling card, coach insight, refine card, Your Day card, habit tracker, and metric tiles. Emphasizes progressive disclosure.
- **Adaptive Coaching**: Uses completion history, wearable data, and subjective inputs to generate personalized plans. Lower completion rates lead to simplified recommendations.
- **Daily Status & State**: Displays a status pill (e.g., "Strong Day") and drivers. Daily state (Recover, Maintain, Build, Push) drives the plan.
- **Coach Insight**: A multi-signal coaching paragraph generated from HRV, sleep trends, recovery, activity, and user inputs, updated reactively.
- **Your Day (State-Based Single Selection)**: 5 checkable actions per day (Move/Fuel/Hydrate/Recover/Mind), with 4 options per category mapped to state tags. Recommendations are provided, and users can override.
- **Completion Tracking**: Tracks daily completion rate and weekly consistency, displayed in the Habit Tracker card and progress bar. Persisted in AsyncStorage.
- **Trends Tab**: Summaries, key insights, correlations, and pattern detection. Key Metrics section shows 4-week averages with mini SVG sparkline charts for Recovery/Body, Activity, and Habits categories.
- **AI Coach**: Integrated as an expandable card on the Today screen, offering a full-screen chat modal with streaming SSE responses. Contextual health data is sent to the coach for enriched interactions.
- **Weekly Plan**: AI-powered weekly coaching layer with 5 categories per day, editable via a bottom sheet. Synchronizes with the Today screen and persists in AsyncStorage.
- **Metric Drill-Down**: Provides detailed analysis, 30-day charts, and actionable advice for individual metrics.
- **Health Data Providers**: `data/healthProviders.ts` handles integration with Apple HealthKit, Health Connect (Android), Garmin, and Samsung Health, with a 28-day data window.
- **State Management**: Context-based state management (`AppContext`) with computed DailyInsights.
- **Navigation**: Tab bar for Today, Plan, Trends, Settings. Modals for subscription. Stack for onboarding and metric drill-down.

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