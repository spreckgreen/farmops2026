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

## Readiness endpoint: `GET /ready`

`/health` says "the server booted". `/ready` says "it can actually serve a page": it
verifies required env vars are present and that the backend answers over the network.

```
GET /ready  ->  200 when ready, 503 when any check fails
{"ok":true,"service":"bostead","status":"ready","durationMs":489,
 "checks":[{"name":"env","status":"pass","durationMs":0},
           {"name":"database","status":"pass","durationMs":489,"detail":"HTTP 200"}]}
```

Checks:

- `env` - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be set (`fail` if missing).
  Unset optional vars (`SUPABASE_SERVICE_ROLE_KEY`, `VAULT_ENCRYPTION_KEY`,
  `TEMPEST_API_TOKEN`) are reported as a note, not a failure.
- `database` - unauthenticated GET against the backend's `/auth/v1/health` with a 4s
  budget; proves DNS, routing, and that the stack is up. Reads no table and no user data.

Only names, statuses, and short reasons are returned - never secret values.
`GET /api/public/ready` is the same report without the published-site auth gate; both
accept `HEAD`.

### One command: verify readiness end-to-end through Caddy

```bash
cd ~/bostead-a29954a1 && docker compose exec -T caddy sh -lc '
command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
for path in /health /ready; do
  printf "caddy->app %-8s " "$path"
  curl -sS -o /tmp/probe.json -w "status=%{http_code} total=%{time_total}s" "http://app:3000$path" || printf "UNREACHABLE"
  echo
  cat /tmp/probe.json 2>/dev/null; echo
done
' && for path in /health /ready; do printf "https  %-8s " "$path"; curl -sS -o /dev/null -w "status=%{http_code} total=%{time_total}s\n" "https://$(hostname -f)$path"; done
```

Expected output when everything is healthy:

```text
caddy->app /health  status=200 total=0.004s
{"ok":true,"service":"bostead","status":"ready","uptimeSeconds":312,...}
caddy->app /ready    status=200 total=0.541s
{"ok":true,"service":"bostead","status":"ready","durationMs":489,"checks":[...]}
https  /health  status=200 total=0.061s
https  /ready    status=200 total=0.585s
```

Interpretation:

- all four 200 - ready end-to-end; a browser 502 is stale or cached.
- `/health` 200 but `/ready` 503 - app is up, a dependency is not. Read the failing check's `detail`: missing env var, or the backend refusing/timing out.
- caddy hop 200 but HTTPS fails - TLS/vhost/DNS problem, not the app.
- both unreachable from caddy - see "Verify Caddy -> app connectivity" below.

Locally, during development:

```bash
curl -sS -i http://localhost:3000/ready                                  # status line + JSON report
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/ready    # status code only
```

### Compose healthcheck using both probes

```yaml
# docker-compose.yml, under the app service
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:3000/health >/dev/null && wget -qO- http://localhost:3000/ready >/dev/null"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
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

## Collect a full log report (one command)

`scripts/collect-logs.sh` bundles container state, probes, env variable names, and
the recent `caddy` / `app` / `ollama` logs into a single Markdown file you can paste
straight into a chat or an issue. Secrets are scrubbed before anything is written
(`«REDACTED»`, `«REDACTED-JWT»`, `«REDACTED-HEX»` markers).

```bash
cd ~/bostead-a29954a1 && ./scripts/collect-logs.sh
```

Output goes to `logs/reports/bostead-report-<timestamp>.md` (git-ignored) and the
script prints the path plus clipboard hints. To skip the file entirely:

```bash
./scripts/collect-logs.sh --stdout | less
```

Useful flags:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--minutes N` | `15` | Log time window per service |
| `--tail N` | `200` | Max lines per service |
| `--services "app caddy"` | `caddy app ollama` | Restrict to a subset |
| `--host <fqdn>` | `farmops.bostead.life` | Host used for the HTTPS probe |
| `--stdout` | off | Print the report instead of writing a file |
| `--no-sudo` | off | Never retry docker with `sudo` |

Straight to the clipboard, tight window, for a fresh 502:

```bash
cd ~/bostead-a29954a1 && ./scripts/collect-logs.sh --minutes 5 --stdout | tee /tmp/report.md | tail -40
# then: xclip -sel clip < /tmp/report.md   (macOS: pbcopy < /tmp/report.md)
```

The report contains, in order:

1. **Host + stack** — kernel, docker/compose versions, `free -h`, `df -h`, per-container CPU/memory.
2. **Container state** — `docker compose ps` plus `status=` / `exit=` / `oom=` / `restarts=` per service (`exit=137` + `oom=true` means OOM-killed).
3. **Probes** — `/health` and `/ready` from inside caddy and over HTTPS, with status codes and timings.
4. **Env sanity** — variable *names* only, plus the `SUPABASE_URL` values (must be bare origins).
5. **Logs** — one time-stamped section per service, then a cross-service grep of `error|fatal|refused|killed|502|503`.

---

## Caddy DNS and container name resolution

Caddy proxies to the hostname `app`, not to an IP. That name is resolved by
Docker's embedded DNS server at `127.0.0.11`, and it only resolves for
containers that share a user-defined network. When resolution breaks, Caddy
returns **502** and its log shows `dial tcp: lookup app ... no such host`
(name never resolved) rather than `connection refused` (name resolved, port
dead).

### Tell the two apart first

```bash
cd ~/bostead-a29954a1 && docker compose logs --tail=40 caddy | grep -Ei 'lookup|no such host|refused|dial'
```

| Log fragment | Meaning | Go to |
| --- | --- | --- |
| `lookup app on 127.0.0.11:53: no such host` | DNS failure — Caddy cannot see the app container at all | this section |
| `dial tcp 172.x.x.x:3000: connect: connection refused` | DNS worked; the app isn't listening | [Common 502 causes](#common-502-causes) |
| `context deadline exceeded` | App accepted but never answered — usually slow boot or OOM | [Common 502 causes](#common-502-causes) |

### Verification commands

Run all of these from the compose directory; each line is safe and read-only.

```bash
cd ~/bostead-a29954a1

# 1. Does the embedded DNS resolve the service name from inside caddy?
docker compose exec caddy nslookup app 127.0.0.11 || docker compose exec caddy getent hosts app

# 2. Same question, but from the app side (proves the network, not just one container)
docker compose exec app getent hosts caddy

# 3. Are both containers actually on the same network?
docker compose ps --format '{{.Service}}\t{{.Name}}'
docker network inspect "$(basename "$PWD")_default" \
  --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'

# 4. Resolve + connect in one shot (status code proves the whole hop)
docker compose exec caddy sh -c 'getent hosts app; wget -S -qO- http://app:3000/health 2>&1 | head -5'
```

Expected healthy output for (1) is a line like `172.18.0.3  app` (any
`172.x` address is fine), and (4) ends with `{"ok":true,...}`.

### Quick fixes

**1. Containers are on different networks (most common)**

Both services must be in the same compose project and network. Recreate the
network rather than editing it:

```bash
cd ~/bostead-a29954a1 && docker compose down && docker compose up -d
```

Starting containers with `docker run` or from a second compose file puts them
on separate networks — service names never resolve across those. Keep `app`,
`caddy`, and `ollama` in one `docker-compose.yml`.

**2. The upstream name doesn't match the service name**

`Caddyfile` must use the compose **service** name and internal port:

```caddyfile
reverse_proxy app:3000
```

Not `localhost:3000` (that's Caddy's own container), not `127.0.0.1:3000`, and
not the published host port. Verify and reload without downtime:

```bash
cd ~/bostead-a29954a1
grep -n reverse_proxy Caddyfile
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

**3. Stale DNS after the app container was recreated**

Docker's DNS is dynamic, but a long-lived Caddy process can hold a dead
upstream IP. Restart Caddy after any `app` recreate:

```bash
cd ~/bostead-a29954a1 && docker compose restart caddy
```

**4. Host DNS is broken inside containers**

If `nslookup app` works but outbound lookups fail (Ghost, Tempest, Supabase
calls time out), the daemon's resolver is the problem, not compose:

```bash
docker compose exec app cat /etc/resolv.conf
docker compose exec app getent hosts registry.npmjs.org
```

Fix by setting explicit resolvers in `/etc/docker/daemon.json`, then
`sudo systemctl restart docker`:

```json
{ "dns": ["1.1.1.1", "8.8.8.8"] }
```

**5. A custom `container_name` shadowed the service name**

Compose resolves both the service name and `container_name`. If you set
`container_name: bostead-app` and Caddy proxies to `app`, keep the service key
named `app` — or point `reverse_proxy` at the exact `container_name`. Confirm
which names exist:

```bash
cd ~/bostead-a29954a1 && docker compose config --services && docker compose ps --format '{{.Name}}'
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

### 2b. `refresh.sh` build killed with `signal=SIGKILL` (no swap)

**Symptom:** `./scripts/refresh.sh --force` fails in the Docker `builder` stage
with `vite build exited code=null signal=SIGKILL`, heartbeats showing
`vite-rss` climbing past ~6.5 GB and `host-avail` falling under 100 MB, plus
`Warning: no build swap`. Nothing is wrong with the application code — the final
native bundler pass (Nitro/Rolldown) simply needs more memory than an 8 GB host
has free, and its Rust allocations are not bounded by `--max-old-space-size`.

Fix it once, permanently:

```bash
sudo ./scripts/ensure-build-swap.sh        # 6 GB swapfile, or: ... 3G
./scripts/refresh.sh --force
```

`ensure-build-swap.sh` is idempotent, adds the swapfile to `/etc/fstab`, and
sets `vm.swappiness=10` so swap is only touched under real pressure. If the disk
is tight, pass a smaller size — even 2–3 GB usually absorbs the peak.

`refresh.sh` also creates a temporary build-only swap file itself when it can:
it sizes the file to free disk (6 GB down to 2 GB), prompts for `sudo` once on
an interactive terminal, stops the local AI container for the build, and removes
the temporary swap afterwards. It cannot do this non-interactively without
passwordless sudo — that's when the permanent swapfile above is the answer.

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
