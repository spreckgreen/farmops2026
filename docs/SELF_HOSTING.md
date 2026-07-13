# Self-Hosting Deployment Guide

This guide covers running Bostead outside the Lovable platform on your own
infrastructure. If you just want to try the app, use the hosted deployment
at <https://bostead.lovable.app> instead.

---

## 1. Prerequisites

You need three things before you deploy:

1. **A Supabase project.** Either a self-hosted Supabase stack or a project
   on <https://supabase.com>. Bostead never talks to the Lovable-managed
   database — bring your own.
2. **A host to run the app.** Docker 24+ / Docker Compose v2, or Node.js
   20+ with Bun 1.x. 1 vCPU / 512 MB RAM is enough for a household.
3. **A domain (recommended).** Rachio and any other webhook provider need
   a stable HTTPS URL to call back into.

---

## 2. Prepare the Supabase project

1. Create the project (or start your self-hosted stack).
2. Apply the migrations from `supabase/migrations/` in order. Either:
   - `supabase db push` with the Supabase CLI linked to your project, or
   - execute each `.sql` file against the database in filename order.
3. From **Project Settings → API**, copy:
   - Project URL → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `anon` / publishable key → `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never bundle)
   - Project ref (the subdomain of the URL) → `VITE_SUPABASE_PROJECT_ID`
4. In **Authentication → Providers**, enable Email and (optionally) Google.
   For Google, set the OAuth `redirect_uri` allowlist to
   `https://<your-domain>` and `https://<your-domain>/auth/callback`.

---

## 3. Environment variables

Copy `.env.example` → `.env` and fill it in. Grouped by concern:

### 3.1 Supabase (required)

| Variable | Where used | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client build | Baked into JS bundle; must match `SUPABASE_URL`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client build | Anon/publishable key. |
| `VITE_SUPABASE_PROJECT_ID` | client build | Project ref (e.g. `abcd1234`). |
| `SUPABASE_URL` | server runtime | Same URL as above. |
| `SUPABASE_PUBLISHABLE_KEY` | server runtime | Anon key for user-scoped server calls. |
| `SUPABASE_SERVICE_ROLE_KEY` | server runtime | Admin/webhook writes only. **Never** expose to browser. |

The `VITE_*` values are inlined into the client bundle at **build time** —
change them and you must rebuild the image, not just restart it.

### 3.2 AI (choose one)

Bostead uses AI for report drafts, task summaries, and the Southern-Ohio
price refresh.

**Option A — Bundled Ollama (default, fully offline):**

The docker-compose stack ships an `ollama` service and an `ollama-pull`
init container that downloads `llama3.2:3b` (~2 GB) on first boot. The app
auto-wires to it — no environment variables required. Weights persist in
the `ollama` named volume, so the download only happens once.

Pick a different Ollama model by setting `CUSTOM_AI_MODEL` in `.env`
(e.g. `qwen2.5:3b`, `llama3.1:8b`); the init container will pull it on
the next `docker compose up`.

Minimum host RAM for `llama3.2:3b`: ~4 GB free.

**Option B — Your own OpenAI-compatible endpoint** (OpenAI, OpenRouter,
Groq, Together, a remote Ollama, vLLM, LM Studio…). Override the defaults
in `.env`:

| Variable | Notes |
| --- | --- |
| `CUSTOM_AI_BASE_URL` | Endpoint base URL, e.g. `https://api.openai.com/v1`. |
| `CUSTOM_AI_API_KEY` | Sent as `Authorization: Bearer <key>`. |
| `CUSTOM_AI_MODEL` | Model id, e.g. `gpt-4o-mini`. |

**Option C — Lovable AI Gateway.** Set `LOVABLE_API_KEY` and unset the
`CUSTOM_AI_*` overrides. Requires an active Lovable workspace.

**Option D — No AI.** Comment out the `ollama` / `ollama-pull` services and
leave all AI env vars unset. Report/summary buttons show an explanatory
banner at *Admin → Self-host settings*.


### 3.3 Webhooks & self-host UX

| Variable | Required? | Notes |
| --- | --- | --- |
| `PUBLIC_APP_URL` | recommended | Externally reachable origin of this deployment (e.g. `https://farm.example.com`). Used to build the Rachio callback URL. Defaults to `https://bostead.lovable.app`, which will never reach your instance. |
| `SELF_HOST_MODE` | optional | Set to `true` to hide Lovable-only UI (publish-status panel on `/sync`). |
| `RACHIO_WEBHOOK_SECRET` | only if using Rachio | Shared secret Rachio HMAC-signs callbacks with. |

### 3.4 Vault & other secrets

| Variable | Required? | Notes |
| --- | --- | --- |
| `VAULT_ENCRYPTION_KEY` | yes (for `/vault`) | 64 hex chars (32 bytes). Generate with `openssl rand -hex 32`. **Losing this permanently destroys every stored secret** — back it up out-of-band. |
| `GHOST_API_URL`, `GHOST_ADMIN_API_KEY` | optional | Ghost blog sync. May be stored in the app Vault instead of env. |
| `TEMPEST_API_TOKEN` | optional | Tempest weather integration. |

### 3.5 Runtime

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Always production for real deployments. |
| `PORT` | `3000` | Server listen port. |
| `PUID` / `PGID` | `1001` | Container user; match your host UID/GID for bind-mount ownership. |

---

## 4. Deploy with Docker Compose (recommended)

```bash
# 1. Clone
git clone https://github.com/<your-fork>/bostead.git
cd bostead

# 2. Configure
cp .env.example .env
$EDITOR .env   # fill in the tables above

# 3. Build & run
docker compose up -d --build

# 4. Follow logs
docker compose logs -f app
```

The app listens on `http://localhost:3000`. Put an HTTPS reverse proxy
(Caddy, nginx, Traefik) in front of it and point your DNS at that proxy.

**Minimal Caddyfile:**

```caddy
farm.example.com {
  reverse_proxy localhost:3000
}
```

**Update to a new version:**

```bash
git pull
docker compose up -d --build
```

The image rebuild is required whenever `VITE_*` env vars, dependencies,
or source code change. Backend-only env changes (`LOVABLE_API_KEY`,
`CUSTOM_AI_*`, `PUBLIC_APP_URL`, `SELF_HOST_MODE`, `RACHIO_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`) only require `docker compose up -d` to pick up.

---

## 5. Deploy with Docker (single container, no compose)

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_SUPABASE_PROJECT_ID="$VITE_SUPABASE_PROJECT_ID" \
  -t bostead:latest .

docker run -d \
  --name bostead \
  --env-file .env \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/uploads:/app/uploads" \
  --restart unless-stopped \
  bostead:latest
```

---

## 6. Deploy without Docker (Node.js runtime)

Requires Node 20+ and Bun 1.x.

```bash
# 1. Clone & install
git clone https://github.com/<your-fork>/bostead.git
cd bostead
bun install --frozen-lockfile

# 2. Configure
cp .env.example .env
$EDITOR .env

# 3. Build (VITE_* must be set in the shell for the build step)
set -a && source .env && set +a
bun run build

# 4. Validate env, then start
./scripts/check-env.sh
node .output/server/index.mjs
```

Run behind a process manager (systemd, pm2) and an HTTPS proxy.

---

## 7. Verify the deployment

1. Open `https://<your-domain>/` — you should see the Bostead landing page.
2. Sign up / sign in.
3. Visit **Admin → Self-host settings**. Confirm:
   - Self-host mode indicator is what you configured.
   - AI provider shows `Custom endpoint`, `Lovable AI Gateway`, or `Disabled`
     as expected.
   - Rachio callback URL points at your domain (not `bostead.lovable.app`).
4. If using Rachio: paste the callback URL and `RACHIO_WEBHOOK_SECRET` into
   the Rachio webhook configuration, then run an event to confirm arrival
   (check `docker compose logs -f app`).

---

## 8. Backups

Bostead stores everything in Supabase. Back up:

- **Postgres**: `pg_dump` on a schedule, or Supabase's built-in daily
  backups on paid plans.
- **`VAULT_ENCRYPTION_KEY`**: irreplaceable. Store in a password manager or
  hardware token, **not** alongside your DB dumps.
- **Bind mounts** (`./data`, `./uploads`): rsync/borg/restic.

The in-app *Admin → Export snapshot* / *Admin → Restore backup* flows
produce an application-level JSON snapshot that complements (not replaces)
Postgres backups.

---

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Blank page, browser console `Expected 3 parts in JWT` | `VITE_SUPABASE_PUBLISHABLE_KEY` wasn't set at **build** time — rebuild the image. |
| Sign-in works but every server call 401s | Missing/wrong `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` in the runtime env. |
| AI buttons disabled with amber banner | No AI provider configured — set `LOVABLE_API_KEY` or `CUSTOM_AI_*`. |
| Rachio callbacks never arrive | `PUBLIC_APP_URL` unset (defaults to `bostead.lovable.app`) or DNS/proxy not routing `/api/public/webhooks/rachio` to the container. |
| `docker compose logs` shows `[unenv] X is not implemented` | A newly added npm package is Node-only and won't run in the Worker SSR runtime. Replace it. |

For anything else, open an issue with the output of
`docker compose logs app` and the Self-host settings page (screenshot is
fine — it shows no secrets).
