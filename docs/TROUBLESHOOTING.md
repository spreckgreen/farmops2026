# Bostead Self-Host Troubleshooting

Companion to the in-app page at **/settings/troubleshooting** (account menu →
Troubleshooting). Everything here assumes the app directory on the VPS, e.g.:

```bash
cd ~/bostead-a29954a1
```

Related docs: [`SELF_HOSTING.md`](SELF_HOSTING.md) · [`AI-HOSTING.md`](AI-HOSTING.md)

---

## Start here — two commands

A `502 Bad Gateway` from `https://farmops.bostead.life/` means **Caddy is up but
nothing answered on `app:3000`**. These two commands identify the cause in almost
every case.

```bash
# 1. Container state + why it stopped
docker compose ps && docker compose logs --tail=80 app

# 2. Prove the proxy hop, bypassing TLS/DNS/browser entirely
docker compose exec caddy wget -qO- http://app:3000/ | head -c 200
```

How to read them:

| Observation | Meaning |
| --- | --- |
| `app` missing from `ps`, or `Exited`/`Restarting` | App never stayed up → see cause 1 |
| `Exited (137)` | Out of memory (usually Ollama) → cause 2 |
| No `[server]` startup banner in logs | Build output missing or entrypoint died → cause 1 / clean rebuild |
| Banner present, then a stack trace | Crash after boot, usually env → cause 4 |
| Command 2 returns HTML | App is healthy; problem is the proxy hop or your browser → causes 5, 6 |
| Command 2 returns nothing | App is down → causes 1–4 |

---

## Health endpoint: `GET /health`

The app exposes a lightweight probe with no auth, no database access, and no external
calls, so it answers in milliseconds:

```
GET /health  ->  200
{"ok":true,"service":"bostead","status":"ready","uptimeSeconds":312,"checkedAt":"2026-08-20T18:26:04.118Z"}
```

`GET /api/public/health` returns the same payload and bypasses published-site auth, so
external uptime monitors can poll it even when the site is password-gated. Both accept
`HEAD` as well.

A 200 means the Node server booted and is routing requests. It does *not* assert that
the database or vault key are healthy - use `/admin/schema` for that.

### Check it at all three layers

```bash
cd ~/bostead-a29954a1 && docker compose exec -T app sh -lc '
echo "--- inside app container (is the server up at all?) ---"
wget -qO- http://localhost:3000/health || echo "app: no response on localhost:3000"
' && docker compose exec -T caddy sh -lc '
echo
echo "--- caddy -> app (the hop that 502s) ---"
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
curl -sS -o /tmp/h.json -w "status=%{http_code} total=%{time_total}s\n" http://app:3000/health && cat /tmp/h.json && echo
' && echo && echo "--- through Caddy over HTTPS (what the browser sees) ---" && curl -sS -o /dev/null -w "status=%{http_code} total=%{time_total}s\n" https://$(hostname -f)/health
```

Locally, during development:

```bash
curl -sS -i http://localhost:3000/health          # status line + JSON body
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/health   # status code only
```

Whichever layer first stops returning `status=200` is the broken one:

- all three 200 - app is ready; a browser 502 is stale or cached.
- app container 200, caddy hop fails - networking (not the same compose network, or the app bound 127.0.0.1 instead of 0.0.0.0).
- app container returns nothing - the server never booted; read the app log tail for the crash line.

### Use it as a container healthcheck

```yaml
# docker-compose.yml, under the app service
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 40s
```

## Verify Caddy -> app connectivity (wget + curl + status code)

One copyable snippet, run inside the Caddy container so it exercises the exact hop that
returns the 502. Busybox `wget` is always present; `curl` is installed on demand and prints
the HTTP status code plus connect timings.

```bash
cd ~/bostead-a29954a1 && docker compose exec -T caddy sh -lc '
set -u
URL=http://app:3000/

echo "--- wget (busybox, always present in caddy:alpine) ---"
wget -S -qO /tmp/probe.html "$URL" 2>&1 | grep -E "HTTP/|Location|Connecting|failed" || echo "wget: no response"
echo "bytes: $(wc -c < /tmp/probe.html 2>/dev/null || echo 0)"
echo "first 120 chars: $(head -c 120 /tmp/probe.html 2>/dev/null)"

echo
echo "--- curl (installed on demand, shows status + timing) ---"
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
if command -v curl >/dev/null 2>&1; then
  curl -sS -o /dev/null -w "status=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s size=%{size_download}\n" "$URL" \
    || echo "curl: connection failed (app down or not on this network)"
else
  echo "curl unavailable and apk add failed (no egress?) - rely on the wget result above"
fi
'
```

How to read it:

- `HTTP/1.1 200` + `status=200` - the app is healthy; the 502 is stale/cached or from another vhost.
- `bad address 'app'` - service name won't resolve: caddy and app are not on the same compose network.
- `Connection refused` - DNS fine, nothing listening: app down, or bound to 127.0.0.1 instead of 0.0.0.0.
- `status=502` here - the app itself returned 502 (its own upstream), not Caddy.
- `status=000` with a long `total` - socket accepted but no response; check the app log tail for a hung request.

Same probe from inside the app container (works here but fails from caddy = networking):

```bash
cd ~/bostead-a29954a1 && docker compose exec -T app sh -lc 'wget -S -qO- http://localhost:3000/ 2>&1 | head -5'
```

## One-click log tail in the browser

The in-app page (**/settings/troubleshooting**) has **Last 2 min / 10 min / 30 min**
buttons that show two tails side by side, no shell needed (admin role required,
obvious secrets redacted):

- **app** — the last ~500 console lines kept in memory by the server process.
  In-memory, so it resets on restart; an empty tail right after a 502 usually
  means the process just restarted.
- **caddy** — parsed JSON access log, one line per request:
  `14:21:03.412 502 3ms     GET farmops.bostead.life/`. A 502 here with no
  matching app line is the proxy hop failing before the app saw the request.

Requirements (already in the shipped config):

- `Caddyfile` writes `format json` access logs to `/var/log/caddy/access.log`.
- `docker-compose.yml` mounts `./logs/caddy` into caddy (rw) and into app
  (`:ro`), and sets `CADDY_ACCESS_LOG=/var/log/caddy/access.log`.

After pulling these changes, recreate both containers so the mounts apply:

```bash
mkdir -p logs/caddy && docker compose up -d --force-recreate app caddy
```

If the caddy panel says *unavailable*, the mount or the log directive is missing —
verify with:

```bash
docker compose exec app ls -l /var/log/caddy/ && tail -2 logs/caddy/access.log
```

---

## Common 502 causes

### 1. App container isn't running

**Symptom:** `docker compose ps` lists only `caddy` and `ollama`, or `app` shows
`Exited` / `Restarting`. Caddy answers, but has nothing behind `app:3000`.

```bash
docker compose up -d app && docker compose ps && docker compose logs --tail=60 app
```

### 2. App was OOM-killed (usually by Ollama)

**Symptom:** `app` shows `Exited (137)` with no stack trace; free RAM near zero
while a local model is loaded.

```bash
free -h && docker stats --no-stream

# if RAM is tight, free it and restart the app:
docker compose stop ollama && docker compose up -d app
```

Longer-term: add a swapfile, set `CUSTOM_AI_MODEL=llama3.2:1b`, or point
`CUSTOM_AI_BASE_URL` at a remote provider (see `AI-HOSTING.md`).

### 3. App listening on the wrong address

**Symptom:** startup banner missing `HOST: 0.0.0.0` / `PORT: 3000`. Binding to
`127.0.0.1` inside the container is unreachable from Caddy.

```bash
docker compose logs app | grep -A6 "\[server\]" | head -20
```

Fix: `docker-compose.yml` must set `HOST: 0.0.0.0` and `PORT: 3000` for `app`.

### 4. Crash after boot (missing env / malformed Supabase URL)

**Symptom:** banner prints, then the process dies — often
`Missing Supabase environment variable(s): ...`, or a URL that wrongly includes a
port or an `/auth/v1` path.

```bash
grep -c . .env.local && grep -E '^(VITE_)?SUPABASE_URL=' .env.local
```

`SUPABASE_URL` / `VITE_SUPABASE_URL` must be a bare origin — e.g.
`https://supabase.bostead.life`, **not** `https://supabase.bostead.life:8000/auth/v1`.
Values are baked in at build time, so change `.env.local` **then rebuild**.

### 5. Caddy and app not on the same network

**Symptom:** app is healthy and answers locally, but Caddy logs
`dial tcp: lookup app` — the service name can't resolve.

```bash
docker compose exec caddy wget -qO- http://app:3000/ | head -c 200
```

Fix: both services must share a compose network, and the `Caddyfile`
`reverse_proxy` target must be `app:3000` (the service name, not `localhost`).

### 6. Wrong port requested in the browser

**Symptom:** `https://host:3000` fails while the plain domain works. Only 80/443
are published; 3000 is internal to the compose network.

```bash
curl -sSI https://farmops.bostead.life/ | head -5
```

Use the domain with no port. If the browser pinned HSTS to the `:3000` attempt,
clear it at `chrome://net-internals/#hsts` (Delete domain security policies), or
verify in an incognito window.

---

## Still down — clean rebuild

Use this when routes 404 after a deploy or the bundle looks stale. Build args are
interpolated from `.env.local`, so run it from the app directory.

```bash
docker compose build --no-cache app && docker compose up -d app && ./scripts/healthcheck.sh
```

Other helper scripts in `scripts/`:

| Script | Purpose |
| --- | --- |
| `healthcheck.sh` | HTTP/TLS reachability of app + Supabase vhosts |
| `diagnose.sh` | Environment capture and checklist flags |
| `remediate.sh` | Guided fixes for the most common flagged issues |
| `refresh.sh` | Pull, rebuild, restart in one step |
| `docker-preflight.sh` | Verify Docker/BuildKit/disk before a build |

---

## Adjacent failures that are not 502s

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Could not find the table 'public.<name>' in the schema cache` | Migrations not applied, or PostgREST cache stale | Apply `supabase/migrations/*.sql` into `supabase-db`, then `NOTIFY pgrst, 'reload schema';`. Verify at **/admin/schema** |
| `Failed to fetch` on sign-in | `VITE_SUPABASE_URL` baked from a wrong value, or Supabase stack down | Fix `.env.local`, rebuild; check the Supabase stack in `~/supabase-project` with `docker compose ps` |
| `VAULT_ENCRYPTION_KEY not set` | Key missing from `.env.local` or masked by a blank `environment:` entry | Generate with `openssl rand -hex 32`, set in `.env.local`, restart app |
| Sign-in blocked as unconfirmed | Email confirmation on with no SMTP | Set `ENABLE_EMAIL_AUTOCONFIRM=true` in `~/supabase-project/.env`, restart auth; or use **/admin/users → confirm unconfirmed users** |
| AI job fails: `llama-server process has terminated: signal: killed` | Model larger than available RAM | Smaller model (`llama3.2:1b`), add swap, or use a remote provider |
| `Model did not return a usable schedule` | Small local model ignoring JSON schema mode | Retry, or route the heavy task to a remote model via `CUSTOM_AI_BASE_URL` |

---

## Reading the logs

Server-side failures log one compact line — no stacks, no minified module dumps.
Example weather failure:

```text
[weather] tempest fetch failed for 2026-08-20: TypeError: fetch failed (cause: Error: ENOTFOUND)
```

Grep by subsystem prefix to narrow quickly:

```bash
docker compose logs app | grep -E '^\[(weather|ai|vault|rachio)\]' | tail -40
```
