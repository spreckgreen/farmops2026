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

# Create non-root user for security (useradd/groupadd avoid SYS_UID_MAX limits)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --no-create-home appuser && \
    chown -R appuser:nodejs /app
USER appuser

# Copy built Nitro output and install only production dependencies
COPY --from=builder --chown=appuser:nodejs /app/.output ./.output
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/bun.lock ./bun.lock
RUN bun install --production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", ".output/server/index.mjs"]
