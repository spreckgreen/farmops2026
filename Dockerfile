# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ==========================================
# Stage 2: Build
# ==========================================
FROM oven/bun:1-slim AS builder
WORKDIR /app

# Public env vars baked into the client bundle at build time.
# Pass these as --build-arg when building the image.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Override Nitro preset to output a Node.js server instead of Cloudflare Worker
ENV NITRO_PRESET=node-server
RUN bun run build

# ==========================================
# Stage 3: Production Runner
# ==========================================
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install gosu for safe privilege de-escalation in the entrypoint.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/* && \
    gosu nobody true

# Allow overriding UID/GID at build time to match host user for volume mounts.
# These are *defaults*; runtime PUID/PGID env vars override them in the entrypoint.
ARG UID=1001
ARG GID=1001
ENV UID=${UID}
ENV GID=${GID}

# Create non-root user (useradd/groupadd avoid SYS_UID_MAX limits).
RUN groupadd --system --gid ${GID} nodejs && \
    useradd --system --uid ${UID} --gid nodejs --no-create-home appuser && \
    chown -R appuser:nodejs /app

# Copy built Nitro output and install only production dependencies.
COPY --from=builder --chown=appuser:nodejs /app/.output ./.output
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/bun.lock ./bun.lock
RUN gosu appuser bun install --production

# Entrypoint runs as root to chown mounts, then drops to appuser via gosu.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", ".output/server/index.mjs"]

