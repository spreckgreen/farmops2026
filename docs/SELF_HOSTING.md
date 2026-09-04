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

Pick whichever backend you already run. All three produce the same six env
vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`).

### Option A — Managed project at supabase.com

1. Create the project at <https://supabase.com>.
2. Apply migrations from `supabase/migrations/`:
   - `supabase db push` with the CLI linked to your project, or
   - paste each `.sql` file (filename order) into the SQL editor.
3. **Project Settings → API**, copy:
   - Project URL → `SUPABASE_URL` / `VITE_SUPABASE_URL`
     (e.g. `https://abcd1234.supabase.co`)
   - `anon` / publishable key → `SUPABASE_PUBLISHABLE_KEY` /
     `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - Project ref (the `abcd1234` subdomain) → `VITE_SUPABASE_PROJECT_ID`
4. **Authentication → Providers**: enable Email and (optionally) Google.
   Allowlist `https://<your-domain>` and `https://<your-domain>/auth/callback`.

### Option C — Self-hosted Supabase on your VPS (recommended if you already run one)

Use this when Supabase runs in Docker on the same box (or a peer VPS) as
Bostead. The Supabase self-host stack from
<https://github.com/supabase/supabase/tree/master/docker> exposes Kong on
`:8000` (HTTP) and Studio on `:3000` by default.

1. **Deploy Supabase.** From the `supabase/docker` folder:

   ```bash
   cp .env.example .env
   # set POSTGRES_PASSWORD, JWT_SECRET (>=32 chars), ANON_KEY, SERVICE_ROLE_KEY,
   # DASHBOARD_USERNAME/PASSWORD, SITE_URL=https://farm.example.com,
   # API_EXTERNAL_URL=https://supabase.example.com
   docker compose up -d
   ```

   Generate `ANON_KEY` and `SERVICE_ROLE_KEY` from your `JWT_SECRET` using
   the helper at <https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>
   (they are JWTs signed with `JWT_SECRET`, not random strings).

2. **Expose the API behind TLS.** Supabase Studio should stay private
   (bind `127.0.0.1:3000` or firewall it); only Kong needs public HTTPS.
   Example Caddy block on the same host as Bostead's `caddy` service:

   ```caddy
   supabase.example.com {
     reverse_proxy supabase-kong:8000   # or 127.0.0.1:8000 if not on the same docker network
   }
   ```

   If Bostead's `caddy` and Supabase's `kong` share a docker network, add
   `kong` to that network (`docker network connect bostead_default
   supabase-kong`) so the `reverse_proxy` hostname resolves.

   > Bostead's `app` container reaches Supabase over the internal docker
   > network — you can also point `SUPABASE_URL` at `http://supabase-kong:8000`
   > for server-side calls. But `VITE_SUPABASE_URL` is baked into the browser
   > bundle, so it **must** be the public HTTPS URL.

3. **Apply migrations.** Every deploy does this for you — `scripts/refresh.sh`
   runs `scripts/apply-migrations.sh` after the build and before the new
   containers serve traffic, so the schema is never behind the code. Set
   `SUPABASE_DB_URL` in `.env.local` once (owner/superuser role):

   ```bash
   SUPABASE_DB_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres"
   ```

   Applied files are recorded in `private.applied_migrations` (so each runs
   once), and the PostgREST schema cache is reloaded afterwards — that reload
   is what prevents errors like *"Could not find the 'energy_level' column of
   'daily_notes' in the schema cache"*.

   Run it standalone any time:

   ```bash
   ./scripts/apply-migrations.sh --dry-run   # list pending, change nothing
   ./scripts/apply-migrations.sh             # apply + reload PostgREST
   ```

   **Database built by hand before the ledger existed?** Run the schema-aware
   adoption pass once. It reads each migration, works out which objects it
   creates (tables, columns, types, functions, policies, triggers, indexes),
   asks the live database whether they already exist, and records only the
   fully-present files — then applies whatever is genuinely missing:

   ```bash
   ./scripts/apply-migrations.sh --adopt --dry-run   # report only
   ./scripts/apply-migrations.sh --adopt             # populate ledger + apply the rest
   ```

   Sample output:

   ```text
   [migrate] adopt: 20260608162633_e232558d….sql — 19/19 objects present → recorded as applied
   [migrate] adopt: 20260820211737_7d33c0b4….sql — 0/2 objects present → left pending
                      missing: column public.daily_notes.energy_level
   [migrate] Adopt summary: 68 recorded, 1 incomplete, 1 unprobeable
   ```

   A file is only adopted when **every** detected object exists; partial matches
   and files with nothing probeable (data-only `INSERT`, `GRANT`-only) stay
   pending and run normally. Use `--baseline` instead only if you want all files
   marked applied with no schema inspection at all.

   On an older hand-built database, a pending hardening migration can reference
   a policy or helper function that a later migration intentionally removed or
   moved to the `private` schema. If that later migration is already recorded,
   the runner verifies its matching `DROP`, reports **superseded by a later
   applied migration**, and safely records the older file instead of blocking
   deployment. Unrelated missing-object errors still fail normally.

   **Audit the ledger against the schema** (read-only, applies nothing):

   ```bash
   ./scripts/apply-migrations.sh --verify
   echo $?    # 0 = no drift, 1 = drift / partial / orphan rows
   ```

   If the host's `localhost:5432` is the connection pooler, it may reject a
   plain `postgres` connection with `ENOIDENTIFIER: no tenant identifier
   provided`. The migration runner detects that response and automatically
   executes `psql` inside the running Compose `db` container, connecting over
   PostgreSQL's local socket. You do not need to expose another database port.
   If automatic discovery cannot identify the container, specify it for one
   command:

   ```bash
   SUPABASE_DB_CONTAINER=supabase-db ./scripts/apply-migrations.sh --adopt
   ```

   A literal `SUPABASE_DB_URL` containing `<PASSWORD>` or `CHANGE_ME` is treated
   as a placeholder and ignored; the runner derives the connection from
   `POSTGRES_PASSWORD` instead.

   Every migration is classified:

   | Status | Meaning | Fix |
   | --- | --- | --- |
   | `OK` | in the ledger and all its objects exist | — |
   | `DRIFT` | ledger says applied, objects are **missing** | `--force --only=<file>` |
   | `PARTIAL` | only some objects exist, not recorded | inspect, then `--only=<file>` |
   | `UNRECORDED` | objects exist, ledger doesn't know | `--adopt` |
   | `PENDING` | not applied yet | normal apply run |
   | `SKIPPED` | nothing probeable (data-only / `GRANT` / `DO` block) | — |
   | `ORPHAN` | ledger row with no file on disk | delete the row or restore the file |

   ```text
   [migrate] Probing 379 schema object(s) in one query…
     OK         20260608162633_e232558d….sql (16/16 objects, 3 superseded later)
     UNRECORDED 20260820211737_7d33c0b4….sql (2/2 objects present, not in ledger)
   [migrate] Verify summary:
   [migrate]   OK 26   DRIFT 0   PARTIAL 0   UNRECORDED 25   PENDING 0   SKIPPED 19   ORPHAN 0
   [migrate]   day-colour columns: 2/2
   ```

   *Superseded* objects are excluded on purpose: `20260624163956_….sql` runs
   `DROP FUNCTION public.has_role(...)` when that function moved to the `private`
   schema, so the earlier migration that created `public.has_role` is not
   reported as drift. The rule: if the last migration to drop an object comes
   after the last one to create it, the object is expected to be gone.

   **Generate a repair script for whatever drift it found:**

   ```bash
   ./scripts/apply-migrations.sh --fix-sql                 # ./migration-remediation-<UTC>.sql
   ./scripts/apply-migrations.sh --fix-sql=/tmp/fix.sql    # or choose the path
   ```

   Nothing is executed — it only writes the file. Review it, then run it:

   ```bash
   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f migration-remediation-*.sql
   ./scripts/apply-migrations.sh --verify                  # expect DRIFT 0, PARTIAL 0, ORPHAN 0
   ```

   The script is ordered so it can be run top to bottom, each section in its own
   transaction:

   | Section | Emitted for | What it does |
   | --- | --- | --- |
   | 1 | `DRIFT`, `PARTIAL` | inlines the migration file (the source of truth), rewritten statement-by-statement to be idempotent, and records it in the ledger |
   | 2 | `energy_level` / `productivity_level` missing | `ADD COLUMN IF NOT EXISTS` on `public.daily_notes` |
   | 3 | `UNRECORDED` | one batched `INSERT … ON CONFLICT DO NOTHING` into `private.applied_migrations` |
   | 4 | `ORPHAN` | `DELETE` of the ledger rows whose file no longer exists |
   | final | always | `NOTIFY pgrst, 'reload schema'` so PostgREST stops serving a stale cache |

   **The whole file is re-runnable.** If you already fixed part of the drift by
   hand — or a `PARTIAL` migration is half-applied — the matching statements
   become no-ops instead of aborting with `already exists`. Every statement in
   section 1 goes through `scripts/lib/idempotent-sql.awk`, which is quote- and
   `$$`-body-aware, so a `;` inside a plpgsql function never splits a statement:

   | Original | Rewritten as |
   | --- | --- |
   | `CREATE TABLE` / `INDEX` / `SCHEMA` / `SEQUENCE` / `EXTENSION` | `… IF NOT EXISTS …` |
   | `CREATE FUNCTION` / `VIEW` | `CREATE OR REPLACE …` |
   | `CREATE TRIGGER t ON tbl` | `DROP TRIGGER IF EXISTS t ON tbl;` first |
   | `CREATE POLICY p ON tbl` | `DROP POLICY IF EXISTS p ON tbl;` first |
   | `ALTER TABLE … ADD COLUMN x` | `ADD COLUMN IF NOT EXISTS x` (each one in the statement) |
   | `ALTER TABLE t ADD CONSTRAINT c` | `ALTER TABLE t DROP CONSTRAINT IF EXISTS c;` first |
   | `DROP TABLE/TYPE/TRIGGER/…` | `DROP … IF EXISTS …` |
   | `CREATE TYPE` / `DOMAIN` / `ROLE` | `DO $idem$ … EXCEPTION WHEN duplicate_object THEN RAISE NOTICE …` |
   | `CREATE INDEX CONCURRENTLY` | keyword dropped (illegal inside the section's transaction) |

   The one thing it will not rewrite for you is an `INSERT` with no
   `ON CONFLICT` clause — re-running that would duplicate rows, so it is left
   in place under a `-- REVIEW:` comment for you to decide:

   ```sql
   -- REVIEW: INSERT has no ON CONFLICT clause — re-running this file will
   -- duplicate these rows. Add ON CONFLICT DO NOTHING, or delete the
   -- statement if the rows are already present.
   insert into public.job_locks (name) values ('nightly');
   ```


   Each drift section lists the exact objects that were missing as comments:

   ```sql
   -- ==== 20260616151303_b19f6bb3….sql ==============================================
   -- missing objects detected:
   --   function public.can_write
   BEGIN;
     create or replace function public.can_write(_user_id uuid) …
     INSERT INTO private.applied_migrations (filename) VALUES ('20260616151303_b19f6bb3….sql')
       ON CONFLICT (filename) DO NOTHING;
   COMMIT;
   ```

   On a `PARTIAL` file some statements will hit `already exists` — that is
   expected, since only part of the file ever ran. Comment out that one statement
   and re-run the section. Section 4 is the only destructive one: deleting an
   orphan row makes the ledger forget the migration ever ran, so only run it once
   you are sure the file is gone for good.


   Managed Supabase (supabase.com) instead? Use `supabase db push --db-url
   "$SUPABASE_DB_URL"`; the deploy hook detects the missing `SUPABASE_DB_URL`
   and skips itself.


4. **Fill `.env` for Bostead** (from your Supabase `.env` and Kong URL):

   ```env
   SUPABASE_URL=https://supabase.example.com
   VITE_SUPABASE_URL=https://supabase.example.com
   SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from Supabase .env>
   VITE_SUPABASE_PUBLISHABLE_KEY=<same ANON_KEY>
   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from Supabase .env>
   VITE_SUPABASE_PROJECT_ID=self-hosted     # any short slug; used for the auth storage key
   ```

   Self-hosted Supabase has no "project ref" — pick a stable slug
   (e.g. `farm-prod`). Changing it later signs users out.

5. **Auth providers.** Studio → Authentication → Providers. For Google,
   set the redirect allowlist to your Bostead origin
   (`https://farm.example.com`, `.../auth/callback`) **and** register
   `https://supabase.example.com/auth/v1/callback` in the Google Cloud
   Console.

6. **Backups.** `pg_dump` against the Supabase Postgres container is the
   source of truth — see §8.

Sanity check from the Bostead host:

```bash
curl -sSf "$SUPABASE_URL/auth/v1/health"   # → {"name":"gotrue",...}
curl -sSf -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
     "$SUPABASE_URL/rest/v1/" | head -c 200
```

### Option B — Any other self-hosted Postgres + PostgREST + GoTrue

Same steps as Option C, but replace the Supabase compose stack with your
own PostgREST/GoTrue deployment. You still need to mint JWTs signed with
the same secret GoTrue uses; use those as `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. Only recommended if you already run this
stack — the official Supabase self-host image is easier.
---


## 3. Environment variables

Copy `.env.example` → `.env` and fill it in. Grouped by concern:

> **Never commit `.env` or `docs/env.self-hosted-supabase.example`.** Both
> are already in `.gitignore`. The tracked template is
> `docs/env.self-hosted-supabase.example.tmpl` (placeholders only). The
> end-to-end local flow for generating the filled file is in **§3.6**
> below.



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

Bostead uses AI for report drafts, task summaries, the Southern-Ohio
price refresh, and the consultant/planner features.

> **Sizing & backend selection:** see [`docs/AI-HOSTING.md`](./AI-HOSTING.md)
> for hardware recommendations, cost math, and a comparison of hybrid
> (paid API), self-hosted GPU, and Apple Silicon paths. TL;DR: if your
> budget is under $1,500 and you want ChatGPT-tier quality, use a paid
> API (~$5–15/month) — no single box under $1,500 runs 32B–70B locally.


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

**Option C — No AI.** Comment out the `ollama` / `ollama-pull` services and
leave all AI env vars unset. Report/summary buttons show an explanatory
banner at *Admin → Self-host settings*.


### 3.3 Webhooks & self-host UX

| Variable | Required? | Notes |
| --- | --- | --- |
| `PUBLIC_APP_URL` | recommended | Externally reachable origin of this deployment (e.g. `https://farm.example.com`). Used to build the Rachio callback URL. Defaults to `https://bostead.lovable.app`, which will never reach your instance. |
| `SELF_HOST_MODE` | optional | Set to `true` to hide Lovable-only UI (publish-status panel on `/sync`). |
| `RACHIO_WEBHOOK_SECRET` | only if using Rachio | Shared secret Rachio HMAC-signs callbacks with. |
| `ELECTRICAL_PEER_SYNC_CRON_SECRET` | only if using the automatic peer pull | Active automatic-pull key, copied from *Electrical → Audit batches → automatic pull*. The endpoint validates it against the key table, so rotating on that screen needs only this value updated here. |
| `ELECTRICAL_PEER_SYNC_TOKEN` | only if this instance pulls from a peer | Access token for the peer instance's read-only audit-batch API. |

#### Automatic peer pull on a self-hosted host

Full end-to-end runbook (service accounts, first sync, audit re-run):
[`PEER_SYNC_SETUP.md`](PEER_SYNC_SETUP.md).

Self-hosted Postgres has no `pg_cron`, so the in-database schedule is skipped and
the trigger has to come from the host. Install it once:

```bash
sudo ./scripts/install-peer-sync-timer.sh              # systemd timer, every 15 min
sudo ./scripts/install-peer-sync-timer.sh --interval 5 # different cadence
./scripts/install-peer-sync-timer.sh --cron            # crontab instead of systemd
./scripts/install-peer-sync-timer.sh --status          # what's installed + last runs
sudo ./scripts/install-peer-sync-timer.sh --uninstall
```

It runs `scripts/peer-sync-tick.sh`, which POSTs the active key to
`$PUBLIC_APP_URL/api/public/hooks/electrical-peer-sync`. Installation does one
test run first so a wrong URL or key shows up immediately. Pulled batches always
land as preview only — per-item approval is still required in the app.

Logs: `journalctl -u farmops-peer-sync -f` (systemd) or
`tail -f /tmp/farmops-peer-sync.log` (cron). Every tick is also recorded in the
app's *Recent runs* table on the audit batches page.

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

### 3.6 End-to-end: generate the filled env locally (no commits)

This is the exact sequence for producing a working `.env` on the host
**without ever putting real keys into git — and without ever touching the
tracked `.env`**. Real values live in `.env.local` (gitignored). All other
artifacts stay on your VPS; the tracked repo only sees the `.tmpl`
placeholder file.

Why `.env.local`? The tracked `.env` at the repo root is Lovable-managed
and only holds the publishable (anon) key for the Lovable Cloud project.
Self-hosted deployments need a *different* Supabase URL plus the
service-role key — writing those into `.env` would fight the tracked
copy on every `git pull`. `.env.local` sidesteps that entirely: it's
gitignored, and docker compose merges it over `.env` via
`COMPOSE_ENV_FILES=.env,.env.local` (later files win).

**Gitignore invariants (already in place — verify once):**

```bash
grep -E 'env\.self-hosted-supabase\.example|^\.env\.local$' .gitignore
./scripts/verify-env-gitignore.sh    # PASS = correctly ignored, not tracked
```

Expected output includes:

```
.env.local
docs/env.self-hosted-supabase.example
[PASS] Not tracked in git index
```

**Step 1 — fill `.env.local` from your Supabase stack.** The generator
reads `ANON_KEY`, `SERVICE_ROLE_KEY`, `API_EXTERNAL_URL`, and `SITE_URL`
from your Supabase project's `docker/.env` and writes `./.env.local` by
default:

```bash
# Dry-run first — validates JWT shape + URL format, writes nothing:
./scripts/fill-env-from-supabase.sh --validate \
  --supabase-dir /home/rpremo/supabase-project

# Then write .env.local (default --out):
./scripts/fill-env-from-supabase.sh \
  --supabase-dir /home/rpremo/supabase-project
```

Sample of what lands in `.env.local` (never committed):

```
SUPABASE_URL=https://supabase.farm.example.com
SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...   # anon JWT from docker/.env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...  # service_role JWT from docker/.env
VITE_SUPABASE_PROJECT_ID=supabase        # derived from API_EXTERNAL_URL hostname
```

**Step 2 — top up the non-Supabase blocks** by editing `.env.local` in
place (the tracked `.env` is never modified):

```bash
# open .env.local and fill these in:
#   VAULT_ENCRYPTION_KEY  →  openssl rand -hex 32
#   PUBLIC_APP_URL        →  https://farm.example.com
#   CUSTOM_AI_* / TEMPEST_API_TOKEN / GHOST_* / RACHIO_WEBHOOK_SECRET
```

**Step 3 — validate before build.** These checks fail fast on any
remaining `CHANGE_ME` or `supabase.example.com` placeholder <!-- scan-secrets: allow --> :

```bash
./scripts/check-env.sh          # auto-selects .env.local when present
./scripts/scan-secrets.sh --all # confirms no keys leaked into tracked files
```

`scripts/refresh.sh` auto-detects `.env.local`, exports
`COMPOSE_ENV_FILES=.env,.env.local` so docker compose merges both files
(local wins), and runs `check-env.sh` on the chosen file before rebuilding
— a placeholder-laced `.env.local` aborts the build instead of producing a
broken container.

**Step 4 — install the pre-commit hook** (one-time, per clone) so an
accidental `git add .env.local` or a paste of a real JWT into a doc is
blocked locally, not just in CI:

```bash
./scripts/install-git-hooks.sh
# hook now runs scripts/scan-secrets.sh on every commit
```

CI runs the same scanner on every push/PR via
`.github/workflows/secret-scan.yml`, so a bypassed local hook is still
caught before merge.

**Manual docker compose invocations.** When running compose directly
(outside `refresh.sh`), point it at both files so `.env.local` overrides
`.env`:

```bash
# One-shot. Rebuild `app`: VITE_* auth values are compiled into browser JS.
docker compose --env-file .env --env-file .env.local build --no-cache app
docker compose --env-file .env --env-file .env.local up -d --force-recreate app caddy

# Or export once per shell (equivalent to what refresh.sh does):
export COMPOSE_ENV_FILES=.env,.env.local
docker compose build --no-cache app
docker compose up -d --force-recreate app caddy
```

**Rotation.** If a real key ever slips into a commit: rotate it in the
Supabase stack (regenerate `ANON_KEY` / `SERVICE_ROLE_KEY` in
`docker/.env`, restart the Supabase containers), re-run
`fill-env-from-supabase.sh` (rewrites `.env.local`), then
`./scripts/refresh.sh`.

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
or source code change. Backend-only env changes (`CUSTOM_AI_*`,
`PUBLIC_APP_URL`, `SELF_HOST_MODE`, `RACHIO_WEBHOOK_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`) only require `docker compose up -d` to pick up.

---

## 4a. TLS certificate via ACME (Caddy)

`docker-compose.yml` includes a `caddy` service that terminates TLS on
`:443` and proxies to `app:3000`. Caddy solves the Let's Encrypt HTTP-01
challenge automatically and renews certs ~30 days before expiry.

**One-time setup for `farmops.bostead.life`:**

1. DNS — add an A record (and AAAA if you have IPv6):

   ```text
   farmops.bostead.life.  A     <your-public-ip>
   ```

   Verify: `dig +short farmops.bostead.life` returns your IP.

2. Firewall — open inbound TCP `80` and `443` (and UDP `443` for HTTP/3)
   from the public internet to this host. Port `80` is mandatory for the
   HTTP-01 challenge; blocking it will cause `no valid A/AAAA records` or
   `connection refused` errors from Let's Encrypt.

3. `.env` — set:

   ```env
   ACME_DOMAIN=farmops.bostead.life
   ACME_EMAIL=admin@bostead.life      # real address — LE expiry notices
   PUBLIC_APP_URL=https://farmops.bostead.life
   ```

4. Bring the stack up:

   ```bash
   docker compose up -d
   docker compose logs -f caddy
   ```

   On first boot you should see `certificate obtained successfully` for
   `farmops.bostead.life`. Certs and the ACME account key persist in the
   `caddy_data` named volume, so restarts do not re-issue.

**Testing without burning the LE rate limit** (5 certs/domain/week):
uncomment the `acme_ca` staging line in `Caddyfile`, run `docker compose
up -d caddy`, confirm issuance succeeds, then re-comment it and run
`docker compose restart caddy` to get the real cert.

**Troubleshooting:**

| Symptom | Fix |
| --- | --- |
| `challenge failed ... connection refused` | Port 80 not reachable from the internet. Check your firewall/NAT. |
| `no such host` | DNS hasn't propagated yet. Wait or re-check the A record. |
| `too many certificates already issued` | You hit LE rate limit. Switch to staging for testing (see above). |
| Browser shows `ERR_CERT_AUTHORITY_INVALID` | You're still on the staging CA — comment out `acme_ca` and restart caddy. |
| Renewal fails silently | `docker compose logs caddy \| grep -i renew` — usually port 80 got blocked after the initial issue. |

**Using an existing reverse proxy instead:** if you already run nginx /
Traefik / Cloudflare Tunnel in front, remove the `caddy` service from
`docker-compose.yml`, restore the `ports: - "3000:3000"` mapping on the
`app` service, and proxy your external hostname to `127.0.0.1:3000`.

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
    - AI provider shows the configured local/cloud engine or `Disabled`
     as expected.
   - Rachio callback URL points at your domain (not `bostead.lovable.app`).
4. If using Rachio: paste the callback URL and `RACHIO_WEBHOOK_SECRET` into
   the Rachio webhook configuration, then run an event to confirm arrival
   (check `docker compose logs -f app`).

---

## 8. Backups

Bostead stores everything in Supabase. Back up:

- **Managed Supabase (Option A)**: enable daily PITR backups in the dashboard,
  or run `pg_dump` against the pooled connection string.
- **Self-hosted Supabase (Option C)**: dump from inside the Postgres container:

  ```bash
  docker exec -t supabase-db \
    pg_dump -U postgres -Fc postgres > "bostead-$(date +%F).dump"
  # restore: docker exec -i supabase-db pg_restore -U postgres -d postgres -c < file.dump
  ```

  Automate with a cron entry and copy the dump off-box (rsync/borg/restic).
  Also snapshot the Supabase `docker/volumes/` directory (Kong config,
  storage assets) and your Supabase `.env` — losing `JWT_SECRET` invalidates
  every issued token.
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
| AI buttons disabled with amber banner | No AI provider configured — configure an engine in **Admin → AI engines** or set `CUSTOM_AI_*`. |
| Rachio callbacks never arrive | `PUBLIC_APP_URL` unset (defaults to `bostead.lovable.app`) or DNS/proxy not routing `/api/public/webhooks/rachio` to the container. |
| `docker compose logs` shows `[unenv] X is not implemented` | A newly added npm package is Node-only and won't run in the Worker SSR runtime. Replace it. |
| Self-hosted Supabase: `Invalid JWT` on every request | `SUPABASE_PUBLISHABLE_KEY` / `SERVICE_ROLE_KEY` were not regenerated after you changed `JWT_SECRET`. Re-mint both JWTs and restart Bostead + Supabase. |
| Self-hosted Supabase: browser can reach the site but API calls CORS-fail | `SITE_URL` / `API_EXTERNAL_URL` in Supabase `.env` don't match your public Bostead origin. Fix and `docker compose up -d` the Supabase stack. |
| Self-hosted Supabase: Google login loops | The Google provider `redirect_uri` in Supabase Studio isn't `https://supabase.example.com/auth/v1/callback`, or that URL isn't in the Google Cloud Console allowlist. |

For anything else, open an issue with the output of
`docker compose logs app` and the Self-host settings page (screenshot is
fine — it shows no secrets).
