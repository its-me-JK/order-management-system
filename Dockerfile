# syntax=docker/dockerfile:1.7

FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS base

RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

FROM base AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/configuration/package.json ./packages/configuration/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
COPY packages/redis/package.json ./packages/redis/package.json

FROM workspace AS dependencies

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --network-concurrency=8

FROM dependencies AS build

COPY . .

RUN pnpm build

FROM dependencies AS production-dependencies

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    rm -rf \
      /app/node_modules \
      /app/apps/api/node_modules \
      /app/apps/web/node_modules \
      /app/apps/worker/node_modules \
      /app/packages/configuration/node_modules \
      /app/packages/database/node_modules \
      /app/packages/messaging/node_modules \
      /app/packages/redis/node_modules && \
    pnpm \
      --filter '@oms/api...' \
      --filter '@oms/worker...' \
      install --prod --offline --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules

COPY --chown=node:node --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --chown=node:node --from=production-dependencies /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --chown=node:node --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --chown=node:node --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --chown=node:node --from=build /app/apps/web/out ./apps/web/out

COPY --chown=node:node --from=build /app/packages/configuration/package.json ./packages/configuration/package.json
COPY --chown=node:node --from=production-dependencies /app/packages/configuration/node_modules ./packages/configuration/node_modules
COPY --chown=node:node --from=build /app/packages/configuration/dist ./packages/configuration/dist
COPY --chown=node:node --from=build /app/packages/database/package.json /app/packages/database/prisma.config.ts ./packages/database/
COPY --chown=node:node --from=production-dependencies /app/packages/database/node_modules ./packages/database/node_modules
COPY --chown=node:node --from=build /app/packages/database/dist ./packages/database/dist
COPY --chown=node:node --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --chown=node:node --from=build /app/packages/messaging/package.json ./packages/messaging/package.json
COPY --chown=node:node --from=production-dependencies /app/packages/messaging/node_modules ./packages/messaging/node_modules
COPY --chown=node:node --from=build /app/packages/messaging/dist ./packages/messaging/dist
COPY --chown=node:node --from=build /app/packages/redis/package.json ./packages/redis/package.json
COPY --chown=node:node --from=production-dependencies /app/packages/redis/node_modules ./packages/redis/node_modules
COPY --chown=node:node --from=build /app/packages/redis/dist ./packages/redis/dist

COPY --chown=node:node --from=build /app/infrastructure/container ./infrastructure/container

USER node

EXPOSE 3000

CMD ["node", "infrastructure/container/supervisor.mjs"]
