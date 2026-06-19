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

If you mount host volumes into the container and need file ownership to match your local user, override at build time.

> **Quick one-liner** (uses your current shell user's UID/GID automatically):
>
> ```bash
> export UID=$(id -u) GID=$(id -g) && docker compose up --build
> ```

---

**Via Docker Compose (recommended):**

Add to your `.env` file (create one in the project root if it doesn't exist):

```bash
# Your local user's UID/GID — run `id` in your terminal to find these
UID=1000
GID=1000

# Required Supabase build args
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
```

Then build and run:

```bash
# Build with your UID/GID baked in and start the container
docker compose up --build

# Or detached (background)
docker compose up --build -d
```

The `docker-compose.yml` passes `UID` and `GID` as build args with a default of `1001`. If your `.env` sets `UID=1000` and `GID=1000`, the container will run as that user instead.

---

**Via plain `docker build` + `docker run`:**

Build the image with your preferred UID/GID:

```bash
docker build \
  --build-arg UID=$(id -u) \
  --build-arg GID=$(id -g) \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_SUPABASE_PROJECT_ID="$VITE_SUPABASE_PROJECT_ID" \
  -t bostead:latest .
```

Run it:

```bash
docker run -p 3000:3000 \
  -e SUPABASE_URL="$SUPABASE_URL" \
  -e SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" \
  -e SUPABASE_PROJECT_ID="$SUPABASE_PROJECT_ID" \
  bostead:latest
```

> **Why override?** If you later mount a host directory (e.g. `-v $(pwd)/data:/app/data`), files written by the container will be owned by UID/GID 1001 by default. Setting them to match your host user (commonly 1000) prevents permission mismatches.
>
> **Tip:** Run `id -u` and `id -g` in your terminal to see your current user's UID and GID.

#### Automatic permission fixing at runtime (entrypoint)

The image ships with `docker-entrypoint.sh`, which runs as root on container start and:

1. Re-maps `appuser` / `nodejs` to the UID/GID you supply via `PUID` / `PGID` env vars (overrides the build-time defaults — no rebuild needed).
2. Recursively `chown`s `/app` plus any extra paths listed in `CHOWN_PATHS` so bind-mounted host directories are writable.
3. Drops privileges via `gosu` and execs the app as `appuser`. The app process itself never runs as root.

**Runtime env vars:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | build-time `UID` (1001) | Numeric UID to run the app as |
| `PGID` | build-time `GID` (1001) | Numeric GID to run the app as |
| `CHOWN_PATHS` | _(empty)_ | Space-separated extra paths to chown (e.g. `"/app/data /app/uploads"`) |
| `SKIP_CHOWN` | _(unset)_ | Set to `1` to skip the chown step (faster startup once permissions are correct) |

**Example — docker compose with bind mounts:**

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      CHOWN_PATHS: "/app/data /app/uploads"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
```

**Example — plain `docker run`:**

```bash
docker run -d --name bostead -p 3000:3000 \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  -e CHOWN_PATHS="/app/data" \
  -v $(pwd)/data:/app/data \
  bostead:latest
```

> The entrypoint is a no-op when the container is already started as a non-root user (e.g. `docker run --user 1000:1000 ...`); in that case it just execs the command directly.


### Troubleshooting

| Issue | Fix |
| --- | --- |
| Port 3000 already in use | Change the host port: `docker compose up --build` then edit `docker-compose.yml` to use `"3001:3000"` |
| `.env` variables not loading | Ensure the `.env` file exists in the project root and values are not quoted |
| Build fails with lockfile error | Run `bun install` locally first to ensure `bun.lock` is in sync with `package.json` |
| Permission denied on mounted volumes | Set `UID` and `GID` in `.env` to match your host user (see [User permissions](#user-permissions-uid--gid)) |

---

## Local development (without Docker)

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev
```

The dev server runs at http://localhost:8080.
