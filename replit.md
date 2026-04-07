# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo (React Native) - PulsePilot app
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini for coaching chat)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## PulsePilot App

Mobile-first AI health, fitness, recovery, and nutrition coaching app built with Expo/React Native.

### Features
- **Onboarding**: 4-step flow (Welcome, Goals, Profile, Integrations)
- **Dashboard (Today tab)**: Coaching-first layout with readiness ring, headline, Today's Plan (Workout/Movement/Nutrition/Recovery), Why This Plan, Deep Insights (expandable cards for sleep debt, training load, recovery trend, weight projection, TDEE, consistency score, HRV baseline), risk flags, week summary, and tappable metric tiles
- **AI Coach**: Real-time chat powered by OpenAI (gpt-4o-mini) via SSE streaming. Sends full user health context (metrics, profile, trends, readiness) with every message. Quick action prompts for common questions.
- **Weekly Plan**: 7-day training plan with nutrition priorities and fasting schedule
- **Trends**: 30-day trend charts for weight, HRV, resting HR, sleep, steps, recovery — each tappable for drill-down
- **Metric Drill-Down**: Tapping any metric opens a detail screen with headline, status, 30-day chart, "What It Means" section, and recommendation
- **Settings**: Profile, connected devices, preferences, subscription management
- **Subscription**: 3-tier paywall (Free, Premium $9.99/mo, Premium Plus $19.99/mo)

### Architecture
- **Backend**: Express API server with `/api/coach/chat` endpoint for AI coaching (SSE streaming)
- **AI**: OpenAI integration via `@workspace/integrations-openai-ai-server` — no API key needed, billed to Replit credits
- **Frontend**: Expo/React Native with AsyncStorage for persistence
- **Data**: Computed insights engine (`data/insights.ts`) calculates sleep debt, training load, recovery trends, weight projections, TDEE, consistency scores, HRV baselines, and risk flags from raw metrics
- **State**: Context-based state management (AppContext) with computed DailyInsights
- **Components**: ReadinessRing (SVG), expandable insight cards, metric tiles with drill-down

### Key Files
- `artifacts/pulse-pilot/app/(tabs)/index.tsx` — Today dashboard with deep insights
- `artifacts/pulse-pilot/app/(tabs)/coach.tsx` — AI coach chat (OpenAI streaming)
- `artifacts/pulse-pilot/data/insights.ts` — Computed insights engine (sleep debt, training load, etc.)
- `artifacts/pulse-pilot/data/mockData.ts` — Mock health data and daily plan generation
- `artifacts/pulse-pilot/context/AppContext.tsx` — Global state with insights computation
- `artifacts/api-server/src/routes/coach/index.ts` — OpenAI coaching endpoint (SSE)

### Navigation
- Tab bar: Today, Coach, Plan, Trends, Settings
- Modal: Subscription screen
- Stack: Onboarding flow, Metric detail drill-down

### Colors
- Primary: Teal (#00B4A0)
- Accent: Orange (#FF6B35)
- Dark mode supported

### Coaching Tone
- Professional, calm, direct. Short sentences. No hype, slang, jargon, or emojis.
- Every message tells the user what to do. Action-oriented.
- Structured output: HEADLINE, SUMMARY, TODAY'S PLAN, WHY THIS PLAN format on dashboard.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
