# Production image: the api serves the built web app (one container, one origin).
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/scale/package.json packages/scale/
RUN pnpm install --frozen-lockfile
COPY . .
# M7-8: the web build sends it with every usage event (deploy.sh passes the git commit).
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION
RUN pnpm build

FROM node:24-slim
ENV NODE_ENV=production \
    API_PORT=3000 \
    WEB_DIST=/app/public \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
# server.mjs, plus migrate.mjs and seed.mjs for the explicit deploy steps (see README).
COPY --from=build /repo/apps/api/dist/ ./
COPY --from=build /repo/apps/api/drizzle/ ./drizzle/
COPY --from=build /repo/apps/web/dist/ ./public/
USER node
EXPOSE 3000
# M4-8: healthy only while the api can reach the database.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "server.mjs"]
