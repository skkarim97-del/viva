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

Mobile-first AI health, fitness, recovery, and nutrition coaching app built with Expo/React Native. Premium consumer product — feels like a personal trainer with clinical judgment, not a data dashboard.

### Design Philosophy
- **Optimize for**: clarity, confidence, simplicity, action
- **Should feel like**: a smart daily brief, a premium wellness product, an Apple-native health coach
- **Should NOT feel like**: a dashboard, a medical portal, a cluttered fitness tracker

### Design System
- **Colors**: Primary blue (#1A5CFF light / #5B8AFF dark), Sky blue accent (#5AC8FA), Apple-like neutrals
- **Card style**: Background contrast only (no borders), #F7F7FA cards on white, radius 16-20
- **Typography**: Inter font family, negative letter-spacing on large text, 11-12px uppercase labels
- **Spacing**: Generous whitespace, 24px horizontal padding, 28px section gaps
- **Interactions**: Press scale (0.97-0.98) and opacity (0.8) on interactive elements
- **Dividers**: hairlineWidth only, using background color rather than border color

### Features
- **Onboarding**: 4-step flow (Welcome, Goals, Profile, Integrations)
- **Dashboard (Today tab)**: Readiness ring (96px) → Feeling input (5 chips) → Optional Energy/Stress sub-inputs → Adaptive headline + summary → Daily Focus card → Today's Plan card (Recovery & Mind section) → Why bullets → Sleep Intelligence card → Metric tiles → Ask your coach
- **Wellness Inputs**: Feeling (Great/Good/Tired/Exhausted/Stressed), Energy (High/Medium/Low), Stress (Low/Moderate/High). One-tap chips, all optional. Feeling selection reveals energy/stress sub-inputs. All three influence the daily plan adaptively.
- **Daily Focus**: Single-line contextual focus label ("Focus on recovery", "Good day to push performance", "Focus on reducing stress", "Focus on consistency") with color-coded dot. Summarizes the day's intent.
- **Adaptive Logic**: If user-reported feeling/energy/stress conflicts with data, the plan prioritizes user subjective state. Updates headline, summary, plan, why, and focus instantly on input change.
- **Recovery & Mind**: Renamed from "Recovery". Now includes sleep guidance, mental recovery actions, stress reduction suggestions (breathing exercises, meditation, wind-down routines, reduced stimulation).
- **Sleep Intelligence**: Computed from 14-day wearable data. Analyzes avg duration, bedtime consistency, sleep quality trends. Surfaces plain-English insights and actionable recommendations on the Today screen.
- **AI Coach (contextual)**: Integrated into Today screen as expandable "Ask your coach" card. Inline chat with streaming SSE responses, suggested questions, and full health context including energy/stress/sleep intelligence.
- **Weekly Plan**: Summary card at top, day cards with Today badge, adaptive tags (build day/recovery day/steady effort), adjustment notes
- **Trends**: 30-day trend charts with plain-English takeaway per card, press-to-drill-down
- **Metric Drill-Down**: Large value + headline → explanation → 30-day chart → "What this means" → deep analysis (from insights engine) → "What to do" section
- **Settings**: Borderless Apple-native styling, rounded profile card, hairline dividers
- **Subscription**: 3-tier paywall (Free, Premium $9.99/mo, Premium Plus $19.99/mo)

### Architecture
- **Backend**: Express API server with `/api/coach/chat` endpoint for AI coaching (SSE streaming)
- **AI**: OpenAI integration via `@workspace/integrations-openai-ai-server` — no API key needed, billed to Replit credits
- **Frontend**: Expo/React Native with AsyncStorage for persistence
- **Data**: Computed insights engine (`data/insights.ts`) calculates sleep debt, training load, recovery trends, weight projections, TDEE, consistency scores, HRV baselines, and risk flags
- **State**: Context-based state management (AppContext) with computed DailyInsights
- **Components**: ReadinessRing (minimal SVG arc), plan rows with icon squares, metric tiles with drill-down

### Key Files
- `artifacts/pulse-pilot/app/(tabs)/index.tsx` — Today dashboard (feeling input + inline coach chat)
- `artifacts/pulse-pilot/app/(tabs)/coach.tsx` — Legacy coach screen (hidden from tabs, kept for reference)
- `artifacts/pulse-pilot/app/(tabs)/plan.tsx` — Weekly plan with adaptive tags
- `artifacts/pulse-pilot/app/(tabs)/trends.tsx` — Trends with takeaways
- `artifacts/pulse-pilot/app/(tabs)/settings.tsx` — Premium settings
- `artifacts/pulse-pilot/app/metric-detail.tsx` — Metric drill-down with deep analysis
- `artifacts/pulse-pilot/data/insights.ts` — Computed insights engine
- `artifacts/pulse-pilot/data/mockData.ts` — Mock health data and adaptive daily plan generation (feeling-aware)
- `artifacts/pulse-pilot/constants/colors.ts` — Design system colors
- `artifacts/pulse-pilot/context/AppContext.tsx` — Global state with feeling state, auto-regenerates plan on feeling change
- `artifacts/api-server/src/routes/coach/index.ts` — OpenAI coaching endpoint (SSE)

### Navigation
- Tab bar: Today, Plan, Trends, Settings (4 tabs, borderless, blur on iOS)
- Coach: Integrated into Today screen as expandable inline panel (not a tab)
- Modal: Subscription screen
- Stack: Onboarding flow, Metric detail drill-down

### Coaching Tone
- Professional, calm, direct. Short sentences. No hype, slang, jargon, or emojis.
- Every sentence either explains meaning or tells the user what to do.
- Tighter copy: "Train today. Keep it steady." not "Go moderate today. Stay consistent without overdoing it."
- "Why this plan" bullets sound like expert judgment, not generic reporting.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
