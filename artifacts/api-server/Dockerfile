# =====================================================================
# Viva api-server -- production image for AWS App Runner / ECS / Lightsail
# =====================================================================
# Build context: repo root (so the workspace lockfile + libs are in scope).
# Build:  docker build -f artifacts/api-server/Dockerfile -t viva-api:latest .
# Run:    docker run -p 8080:8080 --env-file .env.prod viva-api:latest

# ---- Stage 1: build with full workspace ------------------------------
FROM node:24-slim AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm install --frozen-lockfile --filter @workspace/api-server...
RUN pnpm --filter @workspace/api-server run build

# ---- Stage 2: minimal runtime ----------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# esbuild bundles the server into a single dist/index.mjs with all
# runtime deps inlined. We copy only that artifact -- no node_modules,
# no source, no pnpm. Image ends up ~150MB.
COPY --from=build /repo/artifacts/api-server/dist ./dist

EXPOSE 8080

# Healthcheck mirrors what App Runner / ALB will hit.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
