# Bostead

A personal homestead & productivity application built with TanStack Start, React, and Supabase.

---

## Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed
- A `.env` file in the project root (already present)

### Production build and run

Run the app in a container using the multi-stage Dockerfile.

```bash
# Build the image and start the container
docker compose up --build

# The app will be available at http://localhost:3000
```

To stop:

```bash
# Stop and remove containers
docker compose down
```

To run in detached mode (background):

```bash
docker compose up --build -d
```

### Development with Docker

If you want to run the dev server inside a container (with hot-reload):

```bash
# Build and run the dev container
docker run -it --rm \
  -p 8080:8080 \
  -v $(pwd):/app \
  -v /app/node_modules \
  --env-file .env \
  oven/bun:1-slim \
  sh -c "cd /app && bun install && bun run dev"
```

Then open http://localhost:8080.

### Manual Docker commands (without Compose)

If you prefer plain `docker` commands:

```bash
# Build the production image
docker build \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_SUPABASE_PROJECT_ID="$VITE_SUPABASE_PROJECT_ID" \
  -t bostead:latest .

# Run the container
docker run -p 3000:3000 \
  -e SUPABASE_URL="$SUPABASE_URL" \
  -e SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" \
  -e SUPABASE_PROJECT_ID="$SUPABASE_PROJECT_ID" \
  bostead:latest
```

Then open http://localhost:3000.

### What the Dockerfile does

1. **Stage 1 (`deps`)** — installs dependencies using `bun install --frozen-lockfile`
2. **Stage 2 (`builder`)** — copies source, sets `NITRO_PRESET=node-server` to output a Node.js server instead of a Cloudflare Worker, and builds the app
3. **Stage 3 (`runner`)** — creates a minimal production image with only the built output and production dependencies, runs as a non-root user, and exposes port 3000

### User permissions (UID / GID)

The container runs as a non-root user (`appuser`) with **UID 1001** and group (`nodejs`) with **GID 1001** by default.

`useradd` and `groupadd` are used instead of `adduser`/`addgroup` to avoid the `SYS_UID_MAX 999` restriction some Debian-based images enforce for system accounts.

#### Override UID/GID to match your host user

If you mount host volumes into the container and need file ownership to match your local user, override at build time:

**Via Docker Compose (recommended):**

Add to your `.env` file or export in your shell:

```bash
UID=1000
GID=1000
```

Then run:

```bash
docker compose up --build
```

The `docker-compose.yml` already passes `UID` and `GID` as build args with a default of `1001`.

**Via plain `docker build`:**

```bash
docker build \
  --build-arg UID=1000 \
  --build-arg GID=1000 \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_SUPABASE_PROJECT_ID="$VITE_SUPABASE_PROJECT_ID" \
  -t bostead:latest .
```

> **Tip:** Run `id -u` and `id -g` in your terminal to see your current user's UID and GID.

### Troubleshooting

| Issue | Fix |
| --- | --- |
| Port 3000 already in use | Change the host port: `docker compose up --build` then edit `docker-compose.yml` to use `"3001:3000"` |
| `.env` variables not loading | Ensure the `.env` file exists in the project root and values are not quoted |
| Build fails with lockfile error | Run `bun install` locally first to ensure `bun.lock` is in sync with `package.json` |

---

## Local development (without Docker)

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev
```

The dev server runs at http://localhost:8080.
