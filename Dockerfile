# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
# Stream install output with a heartbeat so long silent steps don't look hung.
# A background loop prints elapsed seconds every 10s while `bun install` runs.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    echo "=============================================" && \
    echo "=== [deps] STAGE 1/3: Dependency install ===" && \
    echo "=== [deps] Command: bun install --frozen-lockfile --verbose" && \
    echo "=== [deps] Installs ALL deps (dev + prod) for the builder stage" && \
    echo "=== [deps] BuildKit cache mount: /root/.bun/install/cache" && \
    echo "=== [deps] Started at $(date +%H:%M:%S)" && \
    echo "=============================================" && \
    ( while :; do sleep 10; echo "  [deps] still installing... ($(date +%H:%M:%S))"; done ) & \
    HEARTBEAT_PID=$!; \
    bun install --frozen-lockfile --verbose; \
    STATUS=$?; \
    kill $HEARTBEAT_PID 2>/dev/null || true; \
    echo "=== [deps] bun install finished with status $STATUS at $(date +%H:%M:%S) ===" && \
    exit $STATUS

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

# Build a Node-compatible server bundle instead of the default Cloudflare Worker.
# vite.config.ts forwards NITRO_PRESET into the nitro plugin's `preset` option.
ENV NITRO_PRESET=node-server
RUN echo "=============================================" && \
    echo "=== [builder] STAGE 2/3: Vite + Nitro build ===" && \
    echo "=== [builder] Command: bun run build" && \
    echo "=== [builder] NITRO_PRESET=$NITRO_PRESET" && \
    echo "=== [builder] Started at $(date +%H:%M:%S)" && \
    echo "=============================================" && \
    ( while :; do sleep 15; echo "  [builder] still building... ($(date +%H:%M:%S))"; done ) & \
    HEARTBEAT_PID=$!; \
    bun run build; \
    STATUS=$?; \
    kill $HEARTBEAT_PID 2>/dev/null || true; \
    echo "=== [builder] bun run build finished with status $STATUS at $(date +%H:%M:%S) ===" && \
    exit $STATUS

# Detect the actual Nitro output directory and normalize it to /app/dist so
# the runner stage can COPY a single, known path. Nitro emits to `dist/` when
# vite.config.ts pins `nitro.output.dir`; if that pin is missing or
# NITRO_PRESET isn't forwarded it falls back to `.output/`. Rather than fail,
# we auto-select whichever exists and rename it — both layouts produce
# `server/index.mjs`, which is all the runner CMD needs.
RUN set -eu; \
    echo "=== Nitro Build Output Detection ===" ; \
    if [ -d /app/dist ] && [ -f /app/dist/server/index.mjs ]; then \
      echo "Detected output directory: /app/dist (pinned via nitro.output.dir)"; \
    elif [ -d /app/.output ] && [ -f /app/.output/server/index.mjs ]; then \
      echo "Detected output directory: /app/.output (default Nitro layout)"; \
      echo "Normalizing to /app/dist for the runner stage..."; \
      rm -rf /app/dist; \
      mv /app/.output /app/dist; \
    else \
      echo "ERROR: No usable Nitro output found." >&2; \
      echo "Expected /app/dist/server/index.mjs or /app/.output/server/index.mjs" >&2; \
      echo "Contents of /app:" >&2; ls -la /app >&2; \
      [ -d /app/dist ]    && { echo "Contents of /app/dist:"    >&2; find /app/dist    -maxdepth 3 >&2; } || true; \
      [ -d /app/.output ] && { echo "Contents of /app/.output:" >&2; find /app/.output -maxdepth 3 >&2; } || true; \
      exit 1; \
    fi; \
    echo "Server entrypoint: /app/dist/server/index.mjs"; \
    echo "Paths that will be copied to runner image:"; \
    find /app/dist -type f | sort | sed 's|^/app/dist|  ./dist|'; \
    echo "=== End Nitro Build Output Detection ==="



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

# Copy the built nitro output (server + client) and production deps.
# Note: the lovable nitro config emits to `dist/` (server in dist/server,
# client assets in dist/client), NOT `.output/`.
RUN echo "=== Copying artifacts from builder stage ==="
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
RUN echo "  Copied: /app/dist -> ./dist"
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
RUN echo "  Copied: /app/package.json -> ./package.json"
COPY --from=builder --chown=appuser:nodejs /app/bun.lock ./bun.lock
RUN echo "  Copied: /app/bun.lock -> ./bun.lock"
RUN echo "=== End artifact copy ===" && \
    echo "=============================================" && \
    echo "=== [runner] STAGE 3/3: Production install ===" && \
    echo "=== [runner] Command: gosu appuser bun install --production --frozen-lockfile --verbose" && \
    echo "=== [runner] Installs prod-only deps for the final runtime image" && \
    echo "=== [runner] Started at $(date +%H:%M:%S)" && \
    echo "=============================================" && \
    ( while :; do sleep 10; echo "  [runner] still installing... ($(date +%H:%M:%S))"; done ) & \
    HEARTBEAT_PID=$!; \
    gosu appuser bun install --production --frozen-lockfile --verbose; \
    STATUS=$?; \
    kill $HEARTBEAT_PID 2>/dev/null || true; \
    echo "=== [runner] bun install --production finished with status $STATUS at $(date +%H:%M:%S) ===" && \
    exit $STATUS

# Entrypoint runs as root to chown mounts, then drops to appuser via gosu.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "dist/server/index.mjs"]

