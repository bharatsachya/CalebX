# Production Dockerfile for CalebX Telegram Form Bot on Bun
FROM oven/bun:1.3-slim AS base

WORKDIR /app

# Production environment
ENV NODE_ENV=production

# Copy workspace package definitions and lockfile for caching layer
COPY package.json bun.lock ./
COPY packages/agent/package.json ./packages/agent/
COPY packages/channel/package.json ./packages/channel/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/directory-import/package.json ./packages/directory-import/
COPY packages/errors/package.json ./packages/errors/
COPY packages/form/package.json ./packages/form/
COPY packages/logger/package.json ./packages/logger/
COPY packages/sheets/package.json ./packages/sheets/
COPY packages/telegram-bot/package.json ./packages/telegram-bot/
COPY packages/types/package.json ./packages/types/
COPY packages/whatsapp-bot/package.json ./packages/whatsapp-bot/

RUN bun install --production --ignore-scripts


# Copy source code and configurations
COPY tsconfig.json ./
COPY packages/ ./packages/

USER bun

# Default entry point for the form bot
CMD ["bun", "run", "bot:form"]
