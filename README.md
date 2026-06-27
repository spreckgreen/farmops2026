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

### Knowledge & secrets
- **Procedures** (`/procedures`) — reusable step-by-step procedures / runbooks written in a lightweight wiki format, with versioning and tagging.
- **Obsidian sync** — one-click button in the Procedures tab pushes every procedure to a chosen Obsidian vault's `50 Procedures/` folder as Markdown. Supports **incremental sync** (only changed procedures are rewritten) so large vaults stay fast.
- **Secrets vault** (`/vault`) — encrypted store for passwords, API keys, and notes. Supports both **personal** (owner-only) and **shared** (workspace-wide) scopes. Values are AES-256-GCM encrypted server-side with `VAULT_ENCRYPTION_KEY`; plaintext never touches the database and is only decrypted on-demand via the "Reveal" action.

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

> **Seeding a fresh instance from an existing backup?** After either quickstart completes and you've signed up + granted yourself the `admin` role, jump to [Bootstrapping a clean environment from a snapshot](#bootstrapping-a-clean-environment-from-a-snapshot) to import a `bostead-snapshot-*.json` into the empty database.



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

Every stage routes through `scripts/install-log.sh`, which writes a single timestamped, stage-tagged log to `/install-log/install.log` inside the build and ships a copy at `/app/install.log` in the final image.

### Where to find install logs

When `docker compose build` fails, the failing stage prints its captured tail (last 80 lines + any lines matching `error|failed|cannot|denied|oom|killed|timeout`) directly into the Docker build output, prefixed with the stage name (`preflight`, `deps`, `build`, `nitro-detect`, `runner-install`). The same lines are in the unified log.

- **Inside a running container**: `/app/install.log`
- **On the host** (via the bind mount in `docker-compose.yml`): `./logs/install.log` — `tail -f ./logs/install.log` to watch, `grep -E 'FAIL|ERROR' ./logs/install.log` to find failures
- **Inside the build context locally**: `INSTALL_LOG=./install.log bash scripts/docker-preflight.sh`
- **From a failed build layer**: rerun `docker compose build --progress=plain` to scroll the full per-stage output, or `docker build --target builder -o type=local,dest=./out .` to extract `/install-log/install.log`

Each line is formatted as `[<UTC timestamp>] [<stage>] <message>`, so a stage failure looks like:

```
[2026-06-27T00:57:41Z] [build]         FAIL   exit=1 (279s)
```

#### Build hangs or times out at `builder 8/10` (Vite + Nitro)

Symptom: build stays on the `bun run build:ci` step for many minutes and eventually exits with code 124 (hard cap) or 137 (SIGKILL from the OOM killer). The host has ≤ 4 GB RAM and the process is being swap-thrashed or killed.

Defaults are tuned for a 4 GB host:

- `NODE_HEAP_MB=2560` — Node's old-space cap. Lower than host RAM so the kernel keeps room for bun, rollup native code, and the page cache.
- `BUILD_LOW_MEM=1` — disables sourcemaps and the post-bundle gzip-size pass in `vite.config.ts`. Cuts peak RAM by ~30%.
- `BUILD_HEARTBEAT_SECS=5` — every heartbeat in `install.log` now includes `wrapper-rss=…MB host-avail=…MB`, so you can see whether memory is climbing toward the cap.

If you have more RAM, increase the heap (rule of thumb: ~60% of host RAM):

```bash
docker compose build --build-arg NODE_HEAP_MB=6144     # 8 GB host
docker compose build --build-arg NODE_HEAP_MB=10240    # 16 GB host
```

If the build still dies, grep the install log for the targeted hint the wrapper writes on OOM-shaped exits:

```bash
grep -E 'likely OOM|signal 9|exit.*(137|134)' ./logs/install.log
```




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
| `VAULT_ENCRYPTION_KEY` | yes (Vault) | 64-hex-char (32-byte) key used to AES-256-GCM encrypt secrets at rest. Generate with `openssl rand -hex 32`. **Treat as irreplaceable — losing it makes every stored secret unrecoverable.** |
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

---

## Backup & restore

Bostead ships with a complete, portable backup format that works on **every**
hosting model — Lovable-hosted, Docker, and Node.js self-hosted — using the
same UI, the same file format, and the same code path. There is no
`pg_dump`, no direct database connection, and no host-specific tooling. Every
operation flows through an authenticated, admin-only server function.

### What's included

A backup is a JSON file (`bostead-snapshot-<timestamp>.json`) containing
every row of every operational table:

`tasks` · `projects` · `daily_notes` · `summaries` · `activity_log` ·
`maintenance_records` · `consumables` · `inventory_items` ·
`crop_plantings` · `crop_harvests` · `garden_plots` · `orchard_trees` ·
`livestock_animals` · `plant_seasons` · `food_plan_people` ·
`food_plan_foods` · `food_plan_entries` · `food_storage_plan` ·
`food_storage_items` · `food_price_history` · `procedures`

Not included (intentionally):

- **User accounts and roles** — managed via Supabase Auth + `/admin/users`.
  This keeps backups portable between environments without leaking
  credentials.
- **Database schema / migrations** — versioned in `supabase/migrations/`.
- **Vault secrets (`vault_secrets`)** — excluded by design. Rows are AES-256-GCM
  ciphertext tied to `VAULT_ENCRYPTION_KEY`; shipping them inside a portable
  JSON snapshot would either be useless on a target with a different key, or
  smuggle ciphertext + IV + auth tag into backups that are routinely shared
  between environments. See [Vault backup & recovery](#vault-backup--recovery)
  for the supported flow.
- **Storage bucket file blobs** — none are configured yet; re-upload after
  restore if a future feature adds them.

### Creating a backup (all hosting models)

1. Sign in as an **admin** user.
2. Open **Admin → Export snapshot** (`/admin/export`).
3. Click **Generate snapshot** — the file is validated against the import
   schema (required fields, duplicate ids, cross-table references) before
   download.
4. Click **Download JSON** to save `bostead-snapshot-<timestamp>.json` locally.

Store the file somewhere safe — it contains all your farm data.

### Restoring a backup (all hosting models)

1. Sign in as an **admin** on the target deployment (Lovable, Docker, or Node).
2. Open **Admin → Restore backup** (`/admin/restore`).
3. Pick the `.json` file you exported earlier.
4. Choose a restore mode:
   - **Merge (safe)** — upserts every row by primary key. Existing rows not
     in the backup are kept. Use this for migrating data between
     environments, or for periodic syncs.
   - **Replace (destructive)** — deletes every operational row first, then
     re-imports from the backup. Requires typing `REPLACE` to confirm. Use
     this only when restoring into an empty or wrong-state instance.
5. Click **Restore**. A per-table report shows attempted / restored /
   deleted-first / errors for each table.

The restore goes through the same `importApplicationData` server function on
every host, so a snapshot taken from Lovable can be restored into a Docker
deployment, and vice versa.

### Restoring from the command line (self-hosted only)

Self-hosted operators who can't (or don't want to) use the admin UI — CI
seeds, disaster recovery from a shell, scripted migrations — can run the
same restore from a terminal with **`scripts/restore-snapshot.mjs`**. It
loads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env`, verifies
the snapshot's SHA-256 digest, then performs the identical insert order
and chunking used by `importApplicationData`.

The CLI is not available on Lovable-hosted deployments (no shell access
and `SUPABASE_SERVICE_ROLE_KEY` is managed for you); use `/admin/restore`
there.

**Flags:**

| Flag | Required | Default | Purpose |
| --- | --- | --- | --- |
| `--file <path>` | yes | — | Snapshot JSON to restore. |
| `--mode <merge\|replace>` | no | `merge` | `merge` upserts by `id`; `replace` deletes every operational row first. |
| `--confirm REPLACE` | when `--mode replace` | — | Safety token, mirrors the UI's typed confirmation. |
| `--allow-missing-integrity` | no | off | Permit pre-integrity (legacy) snapshots. |
| `--yes`, `-y` | no | off | Skip the interactive `[y/N]` prompt (use in CI). |
| `--env <path>` | no | `./.env` | Alternate `.env` file to load. |

Exit codes: `0` success · `1` bad flags / missing env · `2` integrity
failure (no rows written) · `3` one or more table writes failed.

**Docker self-hosting** — run the script *inside* the running container so it
inherits the bundled `node_modules` and the `.env` file mounted at
`/app/.env`:

```bash
# Copy the snapshot into the container, then invoke the CLI.
docker cp ./bostead-snapshot-2026-06-22.json bostead:/tmp/snap.json

docker exec -it bostead \
  node scripts/restore-snapshot.mjs \
    --file /tmp/snap.json \
    --mode merge
```

For a true clean-room restore into an instance you intend to overwrite:

```bash
docker exec -it bostead \
  node scripts/restore-snapshot.mjs \
    --file /tmp/snap.json \
    --mode replace \
    --confirm REPLACE \
    --yes
```

**Node.js self-hosting** — run from the project root on the host (the same
directory `npm start` runs from, so `.env` resolves):

```bash
node scripts/restore-snapshot.mjs \
  --file ./bostead-snapshot-2026-06-22.json \
  --mode merge
```

Destructive variant, non-interactive (suitable for a scheduled refresh
from a known-good snapshot):

```bash
node scripts/restore-snapshot.mjs \
  --file /var/backups/bostead/latest.json \
  --mode replace \
  --confirm REPLACE \
  --yes
```

**Expected output** (merge mode, healthy run — Docker output is
identical, just prefixed by your `docker exec` invocation):

```text
→ Reading snapshot: ./bostead-snapshot-2026-06-22.json
→ Verifying SHA-256 integrity…
  ✓ Verified (3f7a91c40e8b…)
→ Target:  https://your-project.supabase.co
→ Mode:    merge
→ Tables:  20 in snapshot
  ✓ food_price_history       upserted=128/128
  ✓ food_plan_people         upserted=4/4
  ✓ food_plan_foods          upserted=37/37
  ✓ food_plan_entries        upserted=212/212
  ✓ food_storage_plan        upserted=1/1
  ✓ food_storage_items       upserted=86/86
  ✓ plant_seasons            upserted=12/12
  ✓ livestock_animals        upserted=9/9
  ✓ orchard_trees            upserted=22/22
  ✓ garden_plots             upserted=14/14
  ✓ crop_plantings           upserted=58/58
  ✓ crop_harvests            upserted=74/74
  ✓ inventory_items          upserted=140/140
  ✓ consumables              upserted=33/33
  ✓ maintenance_records      upserted=18/18
  ✓ projects                 upserted=7/7
  ✓ tasks                    upserted=64/64
  ✓ daily_notes              upserted=190/190
  ✓ summaries                upserted=28/28
  ✓ activity_log             upserted=512/512

✓ Restore complete in 4821 ms.
```

In `--mode replace`, each row reads `deleted=<N> inserted=<M>/<M>`
instead of `upserted=<M>/<M>`.

**Expected output on integrity failure** (exit 2, no rows touched):

```text
→ Reading snapshot: ./tampered.json
→ Verifying SHA-256 integrity…
  ✗ Checksum mismatch — refusing to restore.
    expected 3f7a91c40e8b4d2e9f1a6c0b7e8d5a4c3b2a1098…
    actual   91ab7724ee0c4e1d8b3f2a4c5d6e7f8091a2b3c4…
```


### Why this works the same everywhere

| Concern | Lovable-hosted | Docker self-hosted | Node.js self-hosted |
| --- | --- | --- | --- |
| Mechanism | Admin server function over HTTPS | Same | Same |
| Auth | Supabase JWT + `has_role(_, 'admin')` | Same | Same |
| Requires DB shell access | No | No | No |
| Requires `pg_dump` | No (not available on Lovable) | No | No |
| Service-role key location | Managed by Lovable Cloud | `.env` → container env | `.env` loaded by the Node process |
| File format | `bostead-snapshot-*.json` (v1) | Same | Same |

### Bootstrapping a clean environment from a snapshot
<a id="bootstrapping-a-clean-environment-from-a-snapshot"></a>

A "clean environment" here means a freshly provisioned Bostead instance
(Lovable preview, Docker container, or Node.js host) where the database
schema exists — i.e. `supabase/migrations/` has been applied — but the
operational tables are empty. Use this flow whenever you stand up a new
deployment and want it to start with data from an existing instance.

1. **Provision the target.** Run the relevant quickstart end-to-end:
   - Lovable-hosted — the schema is applied automatically.
   - Docker — [Quickstart (Docker)](#quickstart-docker), then ensure
     migrations have run against the configured Supabase project.
   - Node.js — [Quickstart (Node.js)](#quickstart-nodejs); `check-env.sh`
     must pass before you continue.
2. **Create the first admin.** Sign up through the app's normal `/auth`
   flow, then grant that user the `admin` role — either via `/admin/users`
   from a second already-admin instance, or with a one-off SQL insert into
   `public.user_roles` (`role = 'admin'`) on a brand-new self-hosted DB.
3. **Verify the instance is empty.** Visit `/admin/restore`. If the target
   already has data and you want a clean overwrite, you must use **Replace**
   mode in the next step; otherwise **Merge** is safe.
4. **Import the snapshot.** Pick your `bostead-snapshot-*.json`. The UI
   verifies the SHA-256 digest before the **Restore** button enables — do
   not proceed if the badge says *Integrity check failed*. Choose
   **Replace** for a true clean-room restore, **Merge** to top up.
5. **Confirm.** The per-table report should show `errors: 0` for every
   table. Sign out, sign back in, and spot-check a few records.

This is the only supported way to pre-populate a clean environment —
there is no `pg_dump` / `psql` path, and SQL seeding is reserved for
schema migrations, not user data.

### Cross-host migration recipes


**Migrate from Lovable to self-hosted Docker:**

1. On Lovable: `/admin/export` → download JSON.
2. Stand up Docker per [Quickstart (Docker)](#quickstart-docker), sign up the
   first user, grant them the `admin` role via `/admin/users` or a migration.
3. On the Docker instance: `/admin/restore`, choose **Replace** mode if the
   instance is empty.

**Periodic backup of a self-hosted instance:**

1. Bookmark `/admin/export` on your deployment.
2. Generate + download a snapshot weekly (or however often suits you).
3. Store the JSON files in your existing file backup system (rsync,
   restic, Time Machine, Backblaze, …).

**Promote a Docker test environment into Lovable production:**

1. On the Docker test instance: `/admin/export` → download JSON.
2. On the Lovable production instance: `/admin/restore`, choose **Merge** to
   add the new data alongside whatever is already there.

### Integrity verification

Every snapshot generated by `/admin/export` embeds a **SHA-256 integrity
digest** in an `integrity` field:

```json
{
  "app": "bostead",
  "version": 1,
  "tables": [ /* ... */ ],
  "integrity": {
    "algo": "sha-256",
    "value": "469509fb64f4633cfdade6eb0a9b76417dcb16c8fd200856adad12098c502fc5",
    "covered": ["app", "tables", "version"]
  }
}
```

The digest is computed over a **canonicalized** form of the listed fields —
object keys are sorted at every depth, whitespace is removed, and array
order is preserved (because row order matters for restore). The same code
runs in the browser, the Node server, and the Workerd SSR runtime, so the
digest matches end-to-end.

**On restore, integrity is verified twice — fail-fast:**

1. **Client-side, as soon as you pick the file.** If the digest does not
   match, the UI shows the expected vs. actual hash and refuses to enable
   the **Restore** button — no server call is made, no rows are touched.
2. **Server-side, before any database writes.** Even if a tampered client
   skipped step 1, the `importApplicationData` server function recomputes
   the digest at the start of its handler and throws before opening the
   admin Supabase client. A partial restore is impossible.

Snapshots produced before this feature shipped have no `integrity` field.
The restore endpoint **rejects them by default**; pick the override
checkbox on `/admin/restore` (or pass `allowMissingIntegrity: true` to the
server fn) to import a legacy file — at which point you accept that
tampering or truncation cannot be detected.

### Vault backup & recovery
<a id="vault-backup--recovery"></a>

The Secrets Vault (`/vault`) is deliberately **outside** the standard snapshot
because every row is ciphertext bound to `VAULT_ENCRYPTION_KEY`. A backup
strategy for the vault therefore has two distinct artefacts that must be
treated differently:

| Artefact | Where it lives | How to back it up | Sensitivity |
| --- | --- | --- | --- |
| `VAULT_ENCRYPTION_KEY` | `.env` (self-hosted) or Lovable Cloud secrets | Copy out-of-band into a password manager / hardware token / sealed envelope. Never commit to git. | **Highest** — losing the key permanently destroys every secret. |
| `vault_secrets` rows | `public.vault_secrets` table | Either re-enter each item by hand on the new instance, or `pg_dump --data-only --table=public.vault_secrets` and `psql` it into the target. | High — ciphertext only, but a stolen DB dump + stolen key = full disclosure. |

**Recovery rules:**

1. **Key first, data second.** Restore (or re-set) `VAULT_ENCRYPTION_KEY` on
   the target instance **before** importing any `vault_secrets` rows. Rows
   inserted under a different key will fail decryption with an
   "auth tag verification failed" error and cannot be recovered.
2. **Never rotate the key in place.** There is no built-in re-encryption
   migration. If you must rotate, decrypt every secret with the old key
   (script that calls `revealVaultItem`), update the env var, then re-insert
   the values via the Vault UI under the new key.
3. **Storage separation.** Store the key and the ciphertext dump in
   **different** backup locations (e.g. key in 1Password, dump alongside
   `bostead-snapshot-*.json` in restic). Co-locating them defeats the point of
   server-side encryption.
4. **Lovable-hosted instances.** `VAULT_ENCRYPTION_KEY` is managed for you
   and not exportable. To migrate vault entries off a Lovable instance, reveal
   each item in `/vault`, copy the plaintext, and re-enter on the target.

Standard `/admin/export` snapshots remain safe to share — they contain no
vault data, no service-role key, and no encryption key.



### Troubleshooting

| Issue | Fix |
| --- | --- |
| "Admins only" message on `/admin/export` or `/admin/restore` | Grant your user the `admin` role via `/admin/users` (or insert into `user_roles` via a migration on a fresh self-hosted instance). |
| "Not a Bostead snapshot" when picking a file | The file must have `"app": "bostead"` and `"version": 1`. Snapshots from other apps or future schema versions will not load. |
| "Integrity check FAILED — refusing to restore" | The file was edited, truncated, or corrupted after export. Re-download from the source; do not hand-edit snapshot JSON. |
| "Snapshot has no integrity digest" | The file was generated by a pre-integrity build of Bostead. Tick the override checkbox on `/admin/restore` to proceed, or re-export from a current instance. |
| Restore reports `write failed at chunk N` for a table | The target schema is missing a column the snapshot contains, or a CHECK / RLS rule rejects a row. Apply any pending migrations on the target instance and retry. |
| Replace button stays disabled | Type `REPLACE` exactly (uppercase, no quotes) into the confirmation field. |
| Want to restore only some tables | Edit the JSON before uploading — but you must then either re-sign with `computeIntegrity` or use the legacy-import override; the digest will no longer match. |

