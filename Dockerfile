# Production image for the CalebX Telegram form bot.
#
# Two stages so that `bun install` is cached against the *manifests* only. The
# previous version listed every workspace package.json by hand, which meant
# adding a package silently broke the build: bun could not resolve the new
# workspace member, fell through to the npm registry, and 404'd. Nothing here
# needs editing when a package is added.

FROM oven/bun:1.3-slim AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
# Keep the manifests, drop everything else. The install layer must not be
# invalidated by a source edit, and `COPY --from` is content-hashed — so as long
# as no package.json changed, the install below stays cached.
RUN find packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

FROM oven/bun:1.3-slim AS base
WORKDIR /app
ENV NODE_ENV=production

COPY --from=manifests /app/ ./
RUN bun install --production --ignore-scripts

# Source last: this is the layer that actually changes between deploys.
COPY tsconfig.json ./
COPY packages/ ./packages/

USER bun

CMD ["bun", "run", "bot:form"]
