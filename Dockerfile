# syntax=docker/dockerfile:1

# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM oven/bun:1-slim AS deps
WORKDIR /app
# Use bash so install-log.sh's PIPESTATUS / set -o pipefail behaves correctly.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
COPY package.json bun.lock ./
# install-log.sh is copied early so every stage can route through the same
# unified log file (/tmp/bostead-install.log). The script itself does not
# require node_modules or any source files.
COPY scripts/install-log.sh /usr/local/bin/install-log.sh
RUN chmod +x /usr/local/bin/install-log.sh
ENV INSTALL_LOG=/install-log/install.log
RUN mkdir -p /install-log

# Stream install output with a heartbeat so long silent steps don't look hung.
# A background loop prints elapsed seconds every 10s while `bun install` runs.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    echo "=============================================" && \
    echo "=== [deps] STAGE 1/3: Dependency install ===" && \
    echo "=== [deps] Command: bun install --frozen-lockfile" && \
    echo "=== [deps] Installs ALL deps (dev + prod) for the builder stage" && \
    echo "=== [deps] BuildKit cache mount: /root/.bun/install/cache" && \
    echo "=== [deps] INSTALL_LOG=$INSTALL_LOG" && \
    echo "=============================================" && \
    ( while :; do sleep 10; echo "  [deps] still installing... ($(date +%H:%M:%S))"; done ) & \
    HEARTBEAT_PID=$!; \
    install-log.sh deps bun install --frozen-lockfile; \
    STATUS=$?; \
    kill $HEARTBEAT_PID 2>/dev/null || true; \
    exit $STATUS



# ==========================================
# Stage 2: Build
# ==========================================
FROM oven/bun:1-slim AS builder
WORKDIR /app
# Use bash so PIPESTATUS works for the grep-filtered build pipeline below.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]


# Public env vars baked into the client bundle at build time.
# Pass these as --build-arg when building the image.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG APP_REVISION=unknown
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID}
LABEL org.opencontainers.image.revision=${APP_REVISION}

COPY --from=deps /app/node_modules ./node_modules
# Bring the unified install log forward from the deps stage so the runner
# image carries one consolidated log file covering every build phase.
COPY --from=deps /install-log /install-log
COPY . .

# Make install-log.sh available on PATH and pin INSTALL_LOG for the builder.
RUN cp /app/scripts/install-log.sh /usr/local/bin/install-log.sh && \
    chmod +x /usr/local/bin/install-log.sh
ENV INSTALL_LOG=/install-log/install.log

# ------------------------------------------------------------------
# Up-front preflight: delegate to scripts/docker-preflight.sh so the
# same validation runs locally and inside the builder. Fails fast with
# ERROR: missing file: <path> / ERROR: not executable: <path> before
# any privileged or long-running build command. Routed through
# install-log.sh so the failure shows up in /install-log/install.log
# with a [preflight] tag.
# ------------------------------------------------------------------
RUN chmod +x /app/scripts/docker-preflight.sh 2>/dev/null || true && \
    APP_ROOT=/app CHECK_NODE_MODULES=1 \
      install-log.sh preflight bash /app/scripts/docker-preflight.sh


# Build a Node-compatible server bundle instead of the default Cloudflare Worker.
# vite.config.ts forwards NITRO_PRESET into the nitro plugin's `preset` option.
ENV NITRO_PRESET=node-server
# Nitro otherwise auto-selects the native Rolldown builder when driven through
# its Vite plugin. That builder's off-heap graph reached 7.2 GB on an 8 GB host
# even with one worker. Rollup stays within the Node heap cap configured below.
ENV NITRO_BUILDER=rollup
# Node heap cap. This controls V8 old-space only; Rollup/esbuild and Docker use
# additional native memory. refresh.sh chooses a conservative host-aware value
# (about 4 GB on an 8 GB host) after selecting Rollup for the server package.
# The default remains safe for a 4 GB host.
ARG NODE_HEAP_MB=1536
ENV NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_MB}
ARG ROLLDOWN_WORKER_THREADS=1
ARG ROLLDOWN_MAX_BLOCKING_THREADS=1
ARG RAYON_NUM_THREADS=1
ENV ROLLDOWN_WORKER_THREADS=${ROLLDOWN_WORKER_THREADS}
ENV ROLLDOWN_MAX_BLOCKING_THREADS=${ROLLDOWN_MAX_BLOCKING_THREADS}
ENV RAYON_NUM_THREADS=${RAYON_NUM_THREADS}
# Limit glibc allocator arenas so native bundler buffers are returned/reused
# instead of being retained across Nitro's sequential build environments.
ENV MALLOC_ARENA_MAX=1

ENV VITE_CJS_IGNORE_WARNING=true
# Low-memory build path: vite.config.ts disables sourcemaps, gzip-size
# reporting, and rollup cache when this is set. Always on inside Docker.
ENV BUILD_LOW_MEM=1
# Heartbeat every 5s in Docker so memory drift is visible in the log.
ENV BUILD_HEARTBEAT_SECS=5
# Persistent Vite/Rollup transform cache survives across `docker build` runs
# via a BuildKit cache mount, cutting bundle time substantially on rebuilds.
RUN --mount=type=cache,target=/app/node_modules/.vite,sharing=locked \
    --mount=type=cache,target=/root/.cache,sharing=locked \
    test -n "$VITE_SUPABASE_URL" || { echo "ERROR: VITE_SUPABASE_URL build arg is empty" >&2; exit 1; }; \
    test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || { echo "ERROR: VITE_SUPABASE_PUBLISHABLE_KEY build arg is empty" >&2; exit 1; }; \
    echo "=== [builder] Client backend: $VITE_SUPABASE_URL" && \
    echo "=============================================" && \
    echo "=== [builder] STAGE 2/3: Vite + Nitro build ===" && \
    echo "=== [builder] Command: install-log.sh build bun run build:ci" && \
    echo "=== [builder] NITRO_PRESET=$NITRO_PRESET" && \
    echo "=== [builder] NITRO_BUILDER=$NITRO_BUILDER" && \
    echo "=== [builder] NODE_OPTIONS=$NODE_OPTIONS (heap=${NODE_HEAP_MB}MB)" && \
    echo "=== [builder] Rolldown workers=$ROLLDOWN_WORKER_THREADS blocking=$ROLLDOWN_MAX_BLOCKING_THREADS rayon=$RAYON_NUM_THREADS" && \
    echo "=== [builder] BUILD_LOW_MEM=$BUILD_LOW_MEM BUILD_HEARTBEAT_SECS=$BUILD_HEARTBEAT_SECS" && \
    echo "=== [builder] Host memory:" && (grep -E '^(MemTotal|MemAvailable)' /proc/meminfo || true) && \
    echo "=== [builder] INSTALL_LOG=$INSTALL_LOG" && \
    echo "=== [builder] Stall guard: BUILD_STALL_SECS=600, hard cap BUILD_MAX_SECS=2700" && \
    echo "=== [builder] Started at $(date +%H:%M:%S)" && \
    echo "=============================================" && \
    install-log.sh build bun run build:ci || exit $?; \
    grep -RFl -- "$VITE_SUPABASE_URL" /app/dist/client >/dev/null || { \
      echo "ERROR: requested VITE_SUPABASE_URL was not embedded in the client bundle" >&2; \
      exit 1; \
    }





# Detect the actual Nitro output directory and normalize it to /app/dist so
# the runner stage can COPY a single, known path. Nitro emits to `dist/` when
# vite.config.ts pins `nitro.output.dir`; if that pin is missing or
# NITRO_PRESET isn't forwarded it falls back to `.output/`. Rather than fail,
# we auto-select whichever exists and rename it — both layouts produce
# `server/index.mjs`, which is all the runner CMD needs.
RUN install-log.sh nitro-detect bash -euc '\
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
    find /app/dist -type f | sort | sed "s|^/app/dist|  ./dist|"; \
    echo "=== End Nitro Build Output Detection ==="'

# Stage the unified install log so it ships in the runner image at /app/install.log.
RUN mkdir -p /app/dist && cp /install-log/install.log /app/dist/install.log || true




# ==========================================
# Stage 3: Production Runner
# ==========================================
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Use bash so install-log.sh's pipeline works in the runner stage too.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Bring install-log.sh and the unified install log forward so the runner
# stage appends to the same /install-log/install.log and so a copy ships
# inside the image at /app/install.log.
COPY --from=builder /usr/local/bin/install-log.sh /usr/local/bin/install-log.sh
COPY --from=builder /install-log /install-log
RUN chmod +x /usr/local/bin/install-log.sh
ENV INSTALL_LOG=/install-log/install.log


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
# BUN_INSTALL_CACHE_DIR pins bun's global cache to a path the appuser owns,
# so the BuildKit cache mount below survives across rebuilds and is writable
# by the dropped-privilege user.
ENV BUN_INSTALL_CACHE_DIR=/bun-cache
RUN install -d -o appuser -g nodejs /bun-cache
RUN --mount=type=cache,target=/bun-cache,uid=${UID},gid=${GID},sharing=locked \
    echo "=== End artifact copy ===" && \
    echo "=============================================" && \
    echo "=== [runner] STAGE 3/3: Production install ===" && \
    echo "=== [runner] Command: install-log.sh runner-install gosu appuser bun install --production --frozen-lockfile" && \
    echo "=== [runner] INSTALL_LOG=$INSTALL_LOG" && \
    echo "=== [runner] BuildKit cache mount: /bun-cache (BUN_INSTALL_CACHE_DIR)" && \
    echo "=============================================" && \
    ( while :; do sleep 10; echo "  [runner] still installing... ($(date +%H:%M:%S))"; done ) & \
    HEARTBEAT_PID=$!; \
    install-log.sh runner-install gosu appuser env BUN_INSTALL_CACHE_DIR=/bun-cache \
      bun install --production --frozen-lockfile; \
    STATUS=$?; \
    kill $HEARTBEAT_PID 2>/dev/null || true; \
    exit $STATUS

# Persist the final unified install log into the image so it can be inspected
# via `docker cp <container>:/app/install.log` or via the bind mount at
# /var/log/bostead/install.log (see docker-compose.yml).
RUN cp /install-log/install.log /app/install.log 2>/dev/null || true && \
    chown appuser:nodejs /app/install.log 2>/dev/null || true



# Entrypoint runs as root to chown mounts, then drops to appuser via gosu.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "dist/server/index.mjs"]

