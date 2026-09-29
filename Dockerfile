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
RUN pnpm build

FROM node:24-slim
ENV NODE_ENV=production \
    API_PORT=3000 \
    WEB_DIST=/app/public
WORKDIR /app
COPY --from=build /repo/apps/api/dist/ ./
COPY --from=build /repo/apps/web/dist/ ./public/
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "server.mjs"]
