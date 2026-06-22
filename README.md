# Bostead

A personal homestead & productivity application built with TanStack Start, React, and Supabase.

---

## Features

A summary of everything shipped to date. Want to run it yourself? Jump to the one-command quickstarts: [Docker](#quickstart-docker) · [Node.js](#quickstart-nodejs).


### Productivity & planning
- **Dashboard** (`/dashboard`) — at-a-glance overview of today's tasks, upcoming work, and recent activity.
- **Tasks** — `/tasks`, `/tasks/scheduled`, `/tasks/backlog`, and per-task detail pages (`/tasks/$slug`) for scheduled, backlog and ad-hoc work.
- **Projects** (`/projects`) — group related tasks and track progress against larger initiatives.
- **Daily notes** (`/notes/$date`) — date-stamped journal/notes entries.
- **Reports** (`/reports`) — cross-cutting summary reporting.

### Homestead / food production
- **Food hub** (`/food`) with dedicated modules:
  - Garden (`/food/garden`), Crops (`/food/crops`), Orchard (`/food/orchard`), Livestock (`/food/livestock`)
  - Seasons (`/food/seasons`) and Plan (`/food/plan`) for seasonal planning
  - Processing (`/food/processing`) and Storage (`/food/storage`) for preserved/stored produce
  - Prices (`/food/prices`) and Reports (`/food/reports`) for value tracking and yield analytics
- **Inventory** (`/inventory`) — track supplies, consumables and equipment stock.
- **Maintenance** (`/maintenance`) and **Service scheduling** (`/service-scheduling`) — recurring upkeep and service jobs.

### Platform
- **Auth** (`/auth`) — email + Google sign-in via Lovable Cloud (Supabase) with row-level security.
- **Admin** — user management (`/admin/users`), data export (`/admin/export`), restore from backup (`/admin/restore`), and reset tools (`/admin/reset`); gated by a `user_roles` table.
- **Sync** (`/sync`) — manual sync controls for offline/edge scenarios.
- **TanStack Start SSR** — server-rendered routes with typed `createServerFn` RPC for backend logic.
- **Self-hostable** — ships with a multi-stage Dockerfile, Compose file, and entrypoint that handles UID/GID remapping for bind mounts (see below).
- **Backup & restore** — one snapshot format that works identically on Lovable-hosted, Docker, and Node.js deployments. See [Backup & restore](#backup--restore).

---

## Self-hosting

Bostead can be self-hosted two ways. Pick the one that matches your environment:

| Architecture | Best for | Jump to |
| --- | --- | --- |
| **A. Docker / Docker Compose** (recommended) | Servers, NAS, homelab, anything with Docker available. Isolated, reproducible, handles permissions automatically. | [Docker](#a-docker--docker-compose) |
| **B. Node.js runtime (no Docker)** | VPS / bare-metal / systemd setups where you'd rather run the built Nitro server directly under Node or behind a reverse proxy. | [Node.js runtime](#b-nodejs-runtime-no-docker) |

Both architectures build the same TanStack Start app with `NITRO_PRESET=node-server` and serve it on port `3000`. Pick one — you do not need both.

Common prerequisites for either path:

- A Supabase project (URL, anon/publishable key, project ID)
- A `.env` file in the project root. The fastest way to create one is to copy the bundled example:
  ```bash
  cp .env.example .env
  ```
  Then edit `.env` and replace the `your-*` placeholders with your Supabase project values. See [`.env.example`](./.env.example) for the full list of supported variables (Supabase keys, `PUID`/`PGID`, `PORT`).


---

### Quickstart (Docker)
<a id="quickstart-docker"></a>

One command — writes an example `.env` (only if missing) and starts the container in the background:

```bash
[ -f .env ] || cat > .env <<'EOF'
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
PUID=1000
PGID=1000
PORT=3000
EOF
docker compose up --build -d
```

Replace the `your-*` placeholders with your actual Supabase project values, then re-run the command. Open <http://localhost:3000>. Full options in [A. Docker / Docker Compose](#a-docker--docker-compose).


### Quickstart (Node.js)
<a id="quickstart-nodejs"></a>

One command — seeds `.env` from [`.env.example`](./.env.example) (only if missing), installs, builds, then starts the Node server with the env loaded:

```bash
[ -f .env ] || cp .env.example .env && \
  bun install --frozen-lockfile && \
  ./scripts/check-env.sh --env-file .env && \
  set -a && source .env && set +a && \
  NITRO_PRESET=node-server bun run build && \
  node dist/server/index.mjs
```


Before the first run, edit `.env` and replace the `your-*` placeholders (`VITE_SUPABASE_*`, `SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`) with real values, then re-run the command. The chain stops with a clear error if any required variable is missing or still set to its example default. Open <http://localhost:3000>. Full options in [B. Node.js runtime (no Docker)](#b-nodejs-runtime-no-docker).



---

## A. Docker / Docker Compose



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
2. **Stage 2 (`builder`)** — copies source, sets `NITRO_PRESET=node-server` to output a Node.js server instead of a Cloudflare Worker, and builds the app into `dist/`
3. **Stage 3 (`runner`)** — creates a minimal production image with only the built output and production dependencies, runs as a non-root user, and exposes port 3000

### User permissions (UID / GID)

The container runs as a non-root user (`appuser`) with **UID 1001** and group (`nodejs`) with **GID 1001** by default.

`useradd` and `groupadd` are used instead of `adduser`/`addgroup` to avoid the `SYS_UID_MAX 999` restriction some Debian-based images enforce for system accounts.

> **No `.env` needed for permissions** — `docker-compose.yml` hardcodes sensible defaults for `PUID`, `PGID`, and `CHOWN_PATHS`. The permission system works out of the box. You only need a `.env` for Supabase credentials (see below).

#### Override UID/GID to match your host user

If you mount host volumes into the container and need file ownership to match your local user, override at build time.

> **Quick one-liner** (uses your current shell user's UID/GID automatically):
>
> ```bash
> export UID=$(id -u) GID=$(id -g) && docker compose up --build
> ```

---

**Via Docker Compose (recommended):**

Create a `.env` file in the project root **only** for Supabase credentials. The permission variables have working defaults in `docker-compose.yml`:

```bash
# Required Supabase build args
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
```

> Optional: add `UID=1000` and `GID=1000` to the `.env` only if you want the container user to match your host user.

Then build and run:

```bash
# Works even without a .env — permissions default to 1001:1001
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
2. **Only chowns paths that need it.** It checks the current owner of each path before running `chown`, and skips any path already owned by the target UID/GID. This makes repeated container restarts fast.
3. Drops privileges via `gosu` and execs the app as `appuser`. The app process itself never runs as root.

#### How `PUID` / `PGID` map to ownership changes

`PUID` and `PGID` are **runtime overrides** for the container user's UID and GID. They control exactly which numeric owner the entrypoint assigns to your mounted directories.

**What happens on startup:**

1. The entrypoint reads `PUID` (default `1001`) and `PGID` (default `1001`).
2. It updates the container's `appuser` and `nodejs` group to match those numbers:
   ```bash
   usermod -o -u "$PUID" appuser
   groupmod -o -g "$PGID" nodejs
   ```
3. For every path in `CHOWN_PATHS`, it runs:
   ```bash
   chown "$PUID:$PGID" <path>
   ```
   …but only if the path exists and is **not already** owned by `$PUID:$PGID`.
4. Finally it drops to `appuser` and starts the app.

**What this means for your host filesystem:**

When you bind-mount a host directory (e.g. `./data:/app/data`), the `chown` changes the numeric UID/GID of the files **on the host** as well, because bind mounts share the same underlying inode. So if you set:

```yaml
environment:
  PUID: 1000
  PGID: 1000
```

…then after the first start, `ls -n ./data` on your host will show owner `1000:1000`, matching your local user. The app inside the container also sees them as owned by its own `appuser`, so read/write access works perfectly in both directions.

> **Tip:** If you already ran the container with the wrong UID/GID and now host files are owned by `1001`, simply stop the container, set `PUID`/`PGID` to your host user's UID/GID, and start again. The entrypoint will fix the ownership on the next launch.

**Default `CHOWN_PATHS`**

The entrypoint chowns exactly these paths on startup:

```
/app/data
/app/uploads
```

These are the most common bind-mount targets. Each path is only touched if it exists, so if you don't mount them nothing happens.

**Overriding `CHOWN_PATHS` safely**

Setting `CHOWN_PATHS` **replaces** the default list entirely — it does not append to it. To keep the defaults and add more paths, you must repeat them:

| What you want | Value to set | Example |
| --- | --- | --- |
| Keep defaults (do nothing) | _(omit the variable)_ | `CHOWN_PATHS` is not set |
| Replace defaults entirely | New space-separated list | `CHOWN_PATHS: "/app/.cache /app/logs"` |
| Add to defaults | Defaults + new paths | `CHOWN_PATHS: "/app/data /app/uploads /app/.cache"` |
| Disable all chowning | Empty string | `CHOWN_PATHS: ""` |
| Skip chown loop entirely | `SKIP_CHOWN=1` | `SKIP_CHOWN: "1"` |

> **Important:** `CHOWN_PATHS=""` (empty string) disables the default paths but still enters the chown loop. `SKIP_CHOWN=1` bypasses the loop completely for the fastest startup.

#### Common `CHOWN_PATHS` override examples

**1. Only `/app/data` mounted**

Use this when you only persist a local database or state directory:

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      CHOWN_PATHS: "/app/data"
    volumes:
      - ./data:/app/data
```

**2. Only `/app/uploads` mounted**

Use this when you only need user-uploaded files to survive restarts:

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      CHOWN_PATHS: "/app/uploads"
    volumes:
      - ./uploads:/app/uploads
```

**3. Both `/app/data` and `/app/uploads` mounted (most common)**

This is the default — no `CHOWN_PATHS` override is needed, but shown here explicitly for clarity:

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

**4. Defaults plus an extra path (e.g. `/app/.cache`)**

When you add a custom bind mount and still want the defaults handled:

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      CHOWN_PATHS: "/app/data /app/uploads /app/.cache"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./cache:/app/.cache
```

**5. Disable all chowning**

If the mounted directories are already owned correctly and you want to guarantee zero filesystem changes:

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      CHOWN_PATHS: ""
```

**Runtime env vars:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | build-time `UID` (1001) | Numeric UID to run the app as |
| `PGID` | build-time `GID` (1001) | Numeric GID to run the app as |
| `CHOWN_PATHS` | `/app/data /app/uploads` | Space-separated paths to chown. **Replaces** defaults entirely. Set to `""` to disable defaults. |
| `SKIP_CHOWN` | _(unset)_ | Set to `"1"` to skip the chown step entirely. |

**`SKIP_CHOWN` behavior**

`SKIP_CHOWN` is **unset by default** in `docker-compose.yml`, meaning the entrypoint will run the chown step on every container start. However, it is still fast because individual paths are skipped when their ownership is already correct.

Set `SKIP_CHOWN=1` when you are sure permissions are correct and want to avoid even the ownership-check overhead (e.g. in CI or after the first successful start):

```yaml
services:
  app:
    environment:
      SKIP_CHOWN: "1"
```

**Two levels of skipping:**

1. **Per-path skip (default behavior, always active):** Even when `SKIP_CHOWN` is unset, the entrypoint calls `stat` on each path and skips `chown` if the path is already owned by the target UID/GID. This means repeated restarts are fast because no actual filesystem changes occur.
2. **Global skip (`SKIP_CHOWN=1`):** The entire chown loop is bypassed. Use this when you know permissions are correct and want the absolute fastest startup.

**Example — docker compose with bind mounts:**

```yaml
services:
  app:
    environment:
      PUID: 1000
      PGID: 1000
      # Defaults already include /app/data and /app/uploads,
      # so CHOWN_PATHS can be omitted in most cases.
      # CHOWN_PATHS: "/app/data /app/uploads /app/.cache"
      # Uncomment to disable chown entirely after first successful run:
      # SKIP_CHOWN: "1"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
```

**Example — plain `docker run`:**

```bash
docker run -d --name bostead -p 3000:3000 \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  bostead:latest
```

> The entrypoint is a no-op when the container is already started as a non-root user (e.g. `docker run --user 1000:1000 ...`); in that case it just execs the command directly.

#### Troubleshooting ownership issues

If files on the host still show the wrong owner after the container starts, check the following in order:

**1. Verify `PUID` / `PGID` values actually reached the container**

```bash
docker compose exec app id appuser
# Expected: uid=1000(appuser) gid=1000(nodejs) ...
```

If the UID/GID do not match what you set, make sure the values are passed through correctly:

- **In `docker-compose.yml`:** they must be under `services.app.environment`, not `build.args`.
- **In a `.env` file:** variables used by Compose must be referenced in `docker-compose.yml` (e.g. `PUID: ${UID:-1001}`) — setting them only in `.env` is not enough unless the file explicitly imports them.

**2. Check that the bind mount is actually active**

```bash
docker compose exec app ls -ld /app/data
```

If the directory is empty or does not exist inside the container, the host path may not be mounted. Confirm the volume line is present and the host path exists before starting the container.

**3. Confirm the entrypoint ran the chown step**

Look at the container logs for the startup sequence:

```bash
docker compose logs app | head -n 20
```

You should see lines like:

```
Setting user to 1000:1000
chown -R 1000:1000 /app/data
chown -R 1000:1000 /app/uploads
```

If these are missing, check whether `SKIP_CHOWN=1` is set or the entrypoint was overridden (e.g. `command:` in `docker-compose.yml`).

**4. Check if `CHOWN_PATHS` was overridden to exclude your mount**

If you set `CHOWN_PATHS` manually, it replaces the defaults entirely. For example, `CHOWN_PATHS: "/app/data"` will **not** chown `/app/uploads`, even if you mount it. Include every mounted path in the list, or remove `CHOWN_PATHS` to rely on the defaults.

**5. Files were created before the first chown run**

If the app already wrote files while the container was running as the wrong UID (e.g. 1001), those files remain owned by 1001. The entrypoint only chowns the mount point itself, not every nested file that was created later. Fix this by:

- Stopping the container
- Running `sudo chown -R $(id -u):$(id -g) ./data ./uploads` on the host
- Setting `PUID` and `PGID` to your host UID/GID
- Restarting the container

**6. Host filesystem does not support `chown`**

Some filesystems (e.g. FAT32/exFAT, or remote mounts via SSHFS/SMB) do not store Linux ownership metadata. In that case `chown` appears to succeed inside the container but `ls -n` on the host still shows the same owner. Move the data directory to an ext4/xfs/APFS (macOS) volume that supports POSIX ownership.


### Troubleshooting

| Issue | Fix |
| --- | --- |
| Port 3000 already in use | Change the host port: `docker compose up --build` then edit `docker-compose.yml` to use `"3001:3000"` |
| `.env` variables not loading | Ensure the `.env` file exists in the project root and values are not quoted |
| Build fails with lockfile error | Run `bun install` locally first to ensure `bun.lock` is in sync with `package.json` |
| Permission denied on mounted volumes | Set `UID` and `GID` in `.env` to match your host user (see [User permissions](#user-permissions-uid--gid)) |

---

---

## B. Node.js runtime (no Docker)

Run the production build directly on a host that has Node.js or Bun installed — no container required. Useful for a simple VPS, a systemd service, or running behind nginx/Caddy.

### Prerequisites

- **Bun** ≥ 1.1 (for install + build) — https://bun.sh
- **Node.js** ≥ 20 (to run the built server at runtime; Bun also works)
- A reverse proxy (nginx, Caddy, Traefik) if you want HTTPS / a public hostname
- A `.env` file in the project root (see [common prerequisites](#self-hosting))

### Install and build

```bash
# 1. Clone and enter the project
git clone <your-fork-url> bostead && cd bostead

# 2. Seed your env file from the example and edit it with real values
cp .env.example .env
$EDITOR .env   # fill in VITE_SUPABASE_*, SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY

# 3. Install dependencies (uses bun.lock)
bun install --frozen-lockfile

# 4. Build the Nitro Node server output
NITRO_PRESET=node-server bun run build
```

The build emits a self-contained Node server to `./dist/` with the entrypoint at `dist/server/index.mjs`.

### Required environment variables

These must be set in `.env` (or exported in the shell) for the Node.js runtime — see [`.env.example`](./.env.example) for the canonical list:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes (build) | Supabase URL, inlined into the client bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes (build) | Supabase anon/publishable key, client bundle |
| `VITE_SUPABASE_PROJECT_ID` | yes (build) | Supabase project ref, client bundle |
| `SUPABASE_URL` | yes (runtime) | Server-side Supabase URL used by server functions |
| `SUPABASE_PUBLISHABLE_KEY` | yes (runtime) | Server-side anon key for auth-aware server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (runtime) | Service-role key for admin/maintenance server code |
| `LOVABLE_API_KEY` | yes (AI features) | Lovable AI gateway key for `/food` and summary endpoints |
| `NODE_ENV` | recommended | Set to `production` for the built server |
| `PORT` | optional | Listen port (defaults to `3000`) |

### Validate your env before running

Two bundled scripts check that every required variable is set and not still using an example placeholder. Neither script prints values. Pick the one matching your shell:

**macOS / Linux / WSL (Bash):**

```bash
set -a && source .env && set +a
./scripts/check-env.sh
```

**Windows (PowerShell 5.1+ or PowerShell 7+ on any OS):**

```powershell
# Loads the .env file itself — no `source` equivalent needed
./scripts/check-env.ps1 -EnvFile .env
```

Both produce identical output and exit codes. Sample output when something is wrong:

```
  [MISSING]     SUPABASE_SERVICE_ROLE_KEY
  [PLACEHOLDER] VITE_SUPABASE_URL (still set to .env.example default)
FAIL: 1 missing, 1 still using example placeholders.
```

Each script exits non-zero on failure, so you can chain it before `bun run build`, use it as a systemd `ExecStartPre=` guard, or run it as a CI gate.


### Run the server

```bash
# Load env vars from .env into the current shell, then start the server
set -a && source .env && set +a
./scripts/check-env.sh && node dist/server/index.mjs
```

The app listens on `http://localhost:3000`. Override with `PORT=8080 node dist/server/index.mjs`. Bun works as the runtime too: `bun dist/server/index.mjs`.



### Run as a systemd service

Create `/etc/systemd/system/bostead.service`:

```ini
[Unit]
Description=Bostead
After=network.target

[Service]
Type=simple
User=bostead
WorkingDirectory=/opt/bostead
EnvironmentFile=/opt/bostead/.env
Environment=PORT=3000
ExecStart=/usr/bin/node dist/server/index.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bostead
sudo journalctl -u bostead -f   # follow logs
```

### Reverse proxy (nginx example)

```nginx
server {
    server_name bostead.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Pair with Certbot or use Caddy for automatic TLS.

### Updating

```bash
git pull
bun install --frozen-lockfile
NITRO_PRESET=node-server bun run build
sudo systemctl restart bostead
```

### Troubleshooting (Node.js runtime)

| Issue | Fix |
| --- | --- |
| `dist/server/index.mjs` not found after build | Ensure you set `NITRO_PRESET=node-server` before `bun run build`. The default Cloudflare preset emits a different layout. |
| `Cannot find module` errors at runtime | Re-run `bun install --frozen-lockfile`, then rebuild. Do **not** copy `dist/` to a host that hasn't run `bun install`. |
| `EADDRINUSE: address already in use :::3000` | Another process owns the port. Set `PORT=3001` (or whatever is free) in `.env` / the systemd unit. |
| 500s on every page, logs mention `VITE_SUPABASE_URL` | The Supabase env vars were not present **at build time**. They are inlined into the client bundle — rebuild with them exported. |
| `Permission denied` writing to `./data` or `./uploads` | The Linux user running the service (e.g. `bostead`) must own those directories: `sudo chown -R bostead:bostead /opt/bostead/data /opt/bostead/uploads`. |
| Service runs but reverse proxy returns 502 | Confirm `curl http://127.0.0.1:3000` works on the host first; if yes, the issue is the proxy config (host header, upstream port). |
| Want to use Bun as the runtime instead of Node | Replace `ExecStart=/usr/bin/node dist/server/index.mjs` with `ExecStart=/usr/bin/bun dist/server/index.mjs`. Behaviour is identical. |

> See also the Docker [troubleshooting table](#troubleshooting) above — items about Supabase env vars and lockfile sync apply to both architectures.

---

## Local development (without Docker)

```bash
# Install dependencies
bun install

# Start the dev server
bun run dev
```

The dev server runs at http://localhost:8080.
