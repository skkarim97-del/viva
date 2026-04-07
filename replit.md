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
- **Mobile**: Expo (React Native) - Viva app
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini for coaching chat)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Viva App

Mobile-first AI health and wellness coaching app built with Expo/React Native. Covers physical health, mental well-being, energy, stress, sleep, and daily habits. Premium, calm, intelligent — feels like a trusted daily guide, not a data dashboard.

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
- **Onboarding**: 9-step premium flow (Welcome, Goals, Profile, Activity Level, Training Time, Energy Baseline, Sleep Habits, Device Integration, Personalization Summary)
- **Dashboard (Today tab)**: Status pill → Bold headline → Inline drivers (dot-separated) → Feeling chips → "Refine your day" toggle → Your Day card → Metric tiles → Ask your coach. Minimal, calm, output-focused.
- **Progressive disclosure**: Only feeling input visible by default. Energy, Stress, Hydration, Life Load, and Training hidden behind "Refine your day" toggle. Reduces visual clutter.
- **Daily Status**: Status pill with label ("Strong Day", "On Track", "Slightly Off Track", "Off Track"). Drivers shown as inline dot-separated text (not stacked bullets).
- **Daily State**: One of Recover, Maintain, Build, or Push. Maps to status labels. Drives the entire plan.
- **Your Day**: Clean card with increased padding, no divider. Four sections: Move, Fuel, Recover, Mind.
- **Wellness Inputs**: Feeling (Great/Good/Tired/Exhausted/Stressed) always visible. Energy/Stress hidden behind "Refine your day".
- **Today's Context**: Hydration (Good/Low), Life Load (Light/Normal/Busy/Overwhelmed), Training Intent (None/Light/Training). Hidden behind "Refine your day". Small rounded pills, subtle foreground/background selected state.
- **Adaptive Logic**: All inputs (wearable data + feeling + energy + stress + hydration + life load + training intent) combine into one unified output. Overwhelmed → recovery-focused. Busy → shorter plan. Low hydration → hydration guidance. None training → rest day emphasis. User subjective state overrides data when in conflict. Updates instantly on change. Missing inputs treated as unknown — plan remains flexible and non-aggressive.
- **No weather**: The product does not use weather data. All inputs are user-relevant and controllable.
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
- **Components**: VivaSymbol (SVG brand mark), VivaWordmark (symbol + text), ScreenHeader (consistent tab header), plan rows with icon squares, metric tiles with drill-down

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

### Brand: Viva
- **Wordmark**: "VIVA" all caps, Inter_500Medium, letter-spacing 3, dark neutral color (foreground). Subtle, not oversized.
- **Brand Symbol**: Stylized V with pulse line (VivaSymbol component, SVG). Modern, minimal, recognizable at small sizes.
- **App Icon**: Black background, white V-pulse mark. Premium, simple, stands out on home screen.
- **Screen Header**: VivaWordmark (symbol + text) consistently positioned at top of all 4 tab screens (Today, Plan, Trends, Settings) via ScreenHeader component.
- **Color Philosophy**: Green (#34C759) is accent only — used for positive states, readiness, "push" days, progress indicators. Never as primary branding. Most UI stays neutral and calm.
- **Tagline**: "Your Health & Wellness Coach"
- **Tone**: Calm confidence, simplicity, clarity, human. No hype, slang, jargon, or emojis.
- **Positioning**: Not just a fitness app — a daily health and wellness coach for body, mind, energy, stress, and habits.
- **Feel**: Understated, confident, premium, modern, calm. Product experience leads; branding supports.
- Every sentence either explains meaning or tells the user what to do.
- Copy examples: "Train today. Keep it steady." / "Focus on recovery today." / "Your body needs a lighter day."

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
