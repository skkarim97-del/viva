# =====================================================================
# Viva api-server -- production image (root copy for Elastic Beanstalk)
# =====================================================================
# Elastic Beanstalk's Docker platform builds whatever Dockerfile it
# finds at the root of the source bundle. The canonical Dockerfile
# lives at artifacts/api-server/Dockerfile and uses repo-root-relative
# COPY paths; this file mirrors it byte-for-byte so EB can build the
# same image without any "Dockerfile path" configuration.
#
# If you edit one of the two Dockerfiles, edit the other identically.
# =====================================================================

FROM node:24-slim AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm install --frozen-lockfile --filter @workspace/api-server...
RUN pnpm --filter @workspace/api-server run build

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

COPY --from=build /repo/artifacts/api-server/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
