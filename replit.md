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
- **Dashboard**: Daily readiness ring, sleep/HRV/steps/HR metrics, workout/nutrition/fasting cards
- **AI Coach**: Chat interface with quick actions and mock coaching responses
- **Weekly Plan**: 7-day training plan with nutrition priorities and fasting schedule
- **Trends**: 30-day charts for weight, HRV, resting HR, sleep, steps, recovery
- **Settings**: Profile, connected devices, preferences, subscription management
- **Subscription**: 3-tier paywall (Free, Premium $9.99/mo, Premium Plus $19.99/mo)

### Architecture
- Frontend-only (AsyncStorage for persistence)
- Mock data layer for health metrics, coaching responses, and plans
- Context-based state management (AppContext)
- Custom components: ReadinessRing (SVG), MetricCard, PlanCard, MiniChart, SubscriptionCard

### Navigation
- Tab bar: Today, Coach, Plan, Trends, Settings
- Modal: Subscription screen
- Stack: Onboarding flow (redirects from tabs if not complete)

### Colors
- Primary: Teal (#00B4A0)
- Accent: Orange (#FF6B35)
- Dark mode supported

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
