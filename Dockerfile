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

# Build a Node-compatible server bundle instead of the default Cloudflare Worker.
# vite.config.ts forwards NITRO_PRESET into the nitro plugin's `preset` option.
ENV NITRO_PRESET=node-server
RUN bun run build

# Verify the expected Nitro output layout exists before the runner stage tries
# to COPY it. Without this, a missing/renamed output dir surfaces as an opaque
# BuildKit error like:
#   failed to compute cache key: "/app/dist": not found
# This step fails fast with a clear message and a directory listing so it's
# obvious whether Nitro emitted to `dist/`, `.output/`, or somewhere else.
RUN set -eu; \
    echo "=== Nitro Build Output Detection ===" ; \
    if [ -d /app/dist ]; then \
      echo "Detected output directory: /app/dist"; \
      echo "Server entrypoint: /app/dist/server/index.mjs"; \
      echo "Paths that will be copied to runner image:"; \
      find /app/dist -type f | sort | sed 's|^/app/dist|  ./dist|'; \
      if [ ! -f /app/dist/server/index.mjs ]; then \
        echo "WARNING: /app/dist exists but dist/server/index.mjs is missing" >&2; \
      fi; \
    elif [ -d /app/.output ]; then \
      echo "Detected output directory: /app/.output (fallback/default Nitro output)"; \
      echo "Paths that would be copied:"; \
      find /app/.output -type f | sort | sed 's|^/app/.output|  ./.output|'; \
      echo "ERROR: Expected /app/dist but found /app/.output" >&2; \
      echo "Check vite.config.ts: NITRO_PRESET must be forwarded and nitro.output.dir pinned to 'dist'." >&2; \
      exit 1; \
    else \
      echo "ERROR: No Nitro output directory found. Expected /app/dist or /app/.output" >&2; \
      echo "Contents of /app:" >&2; ls -la /app >&2; \
      exit 1; \
    fi; \
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
RUN echo "=== End artifact copy ===" && gosu appuser bun install --production

# Entrypoint runs as root to chown mounts, then drops to appuser via gosu.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "dist/server/index.mjs"]

