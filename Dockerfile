# One image: the API (TypeScript run with tsx) serving the built React UI on the same origin.
FROM node:22-slim

RUN corepack enable
WORKDIR /app

# Dependencies first, so editing source doesn't re-run the install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @relay/web build

ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/apps/web/dist
EXPOSE 8080
WORKDIR /app/apps/api

# Migrate, seed if empty, pull models, ingest articles, then serve
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/bootstrap.ts && exec node_modules/.bin/tsx src/index.ts"]
