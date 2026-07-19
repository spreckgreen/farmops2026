#!/usr/bin/env bash
# scripts/diagnose.sh — one-shot VPS diagnostics bundle for Bostead / FarmOps
#
# Collects everything needed to triage "site is down after refresh":
#   - host + docker versions
#   - `docker compose ps` (health status per service)
#   - recent logs for app / caddy / ollama / ollama-pull
#   - local HTTP probes (app :3000, caddy :80/:443, ollama :11434)
#   - env sanity: which keys are set in .env vs .env.example (values redacted)
#   - git HEAD + last 5 commits so we know what version is deployed
#
# Output goes to stdout AND to /tmp/bostead-diag-<timestamp>.txt so you can
# paste the file contents into chat without re-running.
#
# Usage:
#   ./scripts/diagnose.sh                # 100 log lines per service (default)
#   ./scripts/diagnose.sh --lines 300    # more log context
#   ./scripts/diagnose.sh --no-sudo      # never try sudo docker fallback
#
# Safe to run any time — read-only, never restarts containers, never prints
# secret values (only key names + whether they're set).

set -u
set -o pipefail

LINES=100
ALLOW_SUDO=1
for arg in "$@"; do
  case "$arg" in
    --lines) shift; LINES="${1:-100}" ;;
    --lines=*) LINES="${arg#*=}" ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
  esac
  shift || true
done

OUT="/tmp/bostead-diag-$(date +%Y%m%d-%H%M%S).txt"
: > "$OUT"

# Print to both stdout and the bundle file.
say() { printf '%s\n' "$*" | tee -a "$OUT"; }
run() {
  say ""
  say "===== \$ $* ====="
  # shellcheck disable=SC2068
  ( $@ 2>&1 ) | tee -a "$OUT" || true
}

# --- Pick a docker invocation that works ------------------------------------
DOCKER=(docker)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  :
elif [ "$ALLOW_SUDO" -eq 1 ] && command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
  say "[diag] Docker socket denied for $(id -un); using: sudo docker"
else
  say "[diag] WARNING: cannot talk to docker (need group membership or sudo)."
  say "        Some sections below will be empty."
fi

DC=("${DOCKER[@]}" compose)

say "===================================================================="
say " Bostead / FarmOps diagnostics — $(date -Iseconds)"
say " Host: $(hostname)   User: $(id -un)   PWD: $(pwd)"
say " Bundle file: $OUT"
say "===================================================================="

# --- 1. Versions -----------------------------------------------------------
run uname -a
run "${DOCKER[@]}" version --format '{{.Server.Version}} (client {{.Client.Version}})'
run "${DC[@]}" version

# --- 2. Compose state ------------------------------------------------------
run "${DC[@]}" ps
run "${DC[@]}" ps --format 'table {{.Service}}\t{{.Status}}\t{{.Health}}\t{{.Ports}}'

# --- 3. Service logs -------------------------------------------------------
for svc in app caddy ollama ollama-pull; do
  say ""
  say "===== logs: $svc (last $LINES lines) ====="
  "${DC[@]}" logs --tail="$LINES" --no-color "$svc" 2>&1 | tee -a "$OUT" || true
done

# --- 4. Local HTTP probes --------------------------------------------------
probe() {
  local label="$1" url="$2" flags="${3:-}"
  say ""
  say "===== probe: $label -> $url ====="
  # shellcheck disable=SC2086
  curl -sS -o /dev/null -w "HTTP %{http_code}  time=%{time_total}s  size=%{size_download}B\n" \
       --max-time 8 $flags "$url" 2>&1 | tee -a "$OUT" || true
}
probe "app direct"        "http://localhost:3000/"        ""
probe "app healthcheck"   "http://localhost:3000/api/health" ""
probe "caddy http"        "http://localhost/"             "-H Host:farmops.bostead.life"
probe "caddy https"       "https://localhost/"            "-k -H Host:farmops.bostead.life"
probe "ollama tags"       "http://localhost:11434/api/tags" ""

# --- 5. Env sanity (names only, values redacted) ---------------------------
say ""
say "===== env sanity (.env vs .env.example — values REDACTED) ====="
if [ -f .env.example ] && [ -f .env ]; then
  awk -F= '/^[A-Z]/{print $1}' .env.example | sort -u > /tmp/.diag_example_keys
  awk -F= '/^[A-Z]/{print $1}' .env         | sort -u > /tmp/.diag_env_keys
  say "-- keys required by .env.example but MISSING from .env:"
  comm -23 /tmp/.diag_example_keys /tmp/.diag_env_keys | sed 's/^/  MISSING  /' | tee -a "$OUT" || true
  say "-- keys present in .env (value hidden, only shows set/empty):"
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z] ]] || continue
    if [ -n "${v//[[:space:]]/}" ]; then
      printf '  SET      %s\n' "$k" | tee -a "$OUT"
    else
      printf '  EMPTY    %s\n' "$k" | tee -a "$OUT"
    fi
  done < .env
  rm -f /tmp/.diag_example_keys /tmp/.diag_env_keys
else
  say "  (.env or .env.example not found in $(pwd))"
fi

# --- 5b. Per-container effective env + port mappings ----------------------
# Values are REDACTED. We only print:
#   - variable name
#   - SET (non-empty) / EMPTY
#   - length (chars) so you can spot truncation without leaking the value
#   - a fingerprint (first 3 chars + "…" + last 2 chars) ONLY for keys that
#     are safe to preview (URLs, hosts, ports, model names, feature flags).
#     Anything matching the sensitive-name allowlist below is NEVER previewed.
#
# The goal is to spot the classic "app booted with stale/blank env after
# refresh" without ever writing a secret to the diagnostics bundle.
SENSITIVE_RE='(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|DSN|CREDENTIAL|SESSION|COOKIE|SIGNING|WEBHOOK|SALT|PRIVATE|JWT|BEARER|AUTH)'

redact_env_line() {
  # stdin: one KEY=VALUE line from `docker inspect` container.Config.Env
  local line="$1"
  local key="${line%%=*}"
  local val="${line#*=}"
  local len="${#val}"
  local status="SET"
  [ -z "${val//[[:space:]]/}" ] && status="EMPTY"

  if [[ "$key" =~ $SENSITIVE_RE ]]; then
    printf '  %-6s %-32s len=%-4d value=<redacted>\n' "$status" "$key" "$len"
  elif [ "$status" = "EMPTY" ]; then
    printf '  %-6s %-32s len=0    value=(empty)\n'   "$status" "$key"
  else
    # Safe-ish preview: first 3 + last 2 chars, only if length >= 6.
    local preview
    if [ "$len" -ge 6 ]; then
      preview="${val:0:3}…${val: -2}"
    else
      preview="(too short to preview)"
    fi
    printf '  %-6s %-32s len=%-4d value=%s\n' "$status" "$key" "$len" "$preview"
  fi
}

say ""
say "===== per-container env + ports (values REDACTED) ====="
# Only run this section if we actually have docker access.
if "${DC[@]}" ps -q >/dev/null 2>&1; then
  # Iterate every running compose service (not just app/caddy/ollama — catches
  # anything the operator has added locally, e.g. a custom sidecar).
  SERVICES="$( "${DC[@]}" ps --services 2>/dev/null | sort -u )"
  if [ -z "$SERVICES" ]; then
    say "  (no compose services are running)"
  fi
  for svc in $SERVICES; do
    cid="$( "${DC[@]}" ps -q "$svc" 2>/dev/null | head -n1 )"
    if [ -z "$cid" ]; then
      say ""
      say "-- $svc: no running container --"
      continue
    fi

    say ""
    say "-- $svc  (container $cid) --"

    # Image + state summary (short, one line).
    "${DOCKER[@]}" inspect --format \
      'image={{.Config.Image}}  status={{.State.Status}}  health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}  restarts={{.RestartCount}}  started={{.State.StartedAt}}' \
      "$cid" 2>&1 | sed 's/^/  /' | tee -a "$OUT" || true

    # Port bindings: "container_port/proto -> host_ip:host_port" per line.
    say "  ports:"
    "${DOCKER[@]}" inspect --format \
      '{{range $p, $bs := .NetworkSettings.Ports}}{{range $bs}}    {{$p}} -> {{.HostIp}}:{{.HostPort}}
{{end}}{{end}}' \
      "$cid" 2>/dev/null | sed '/^\s*$/d' | tee -a "$OUT"
    # If nothing printed, note it explicitly so an empty ports block isn't ambiguous.
    if [ -z "$( "${DOCKER[@]}" inspect --format '{{range $p, $bs := .NetworkSettings.Ports}}{{if $bs}}x{{end}}{{end}}' "$cid" 2>/dev/null )" ]; then
      say "    (no host port bindings — service is internal only)"
    fi

    # Effective env: everything the container actually sees at PID 1.
    # This includes Dockerfile ENV, compose `environment:`, and injected values.
    say "  env:"
    # Pull one KEY=VALUE per line; sort for stable diffs across runs.
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      redact_env_line "$line" | tee -a "$OUT"
    done < <( "${DOCKER[@]}" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | sort )
  done
else
  say "  (docker unavailable — see section 2 above)"
fi

# --- 6. Git state ----------------------------------------------------------
run git rev-parse --abbrev-ref HEAD
run git log --oneline -n 5
run git status --short

# --- 7. Disk + memory ------------------------------------------------------
run df -h /
run free -h

# ---------------------------------------------------------------------------
# Checklist: compute AFTER data collection so we can inspect container state,
# then PREPEND it to the bundle so the reader sees the verdict on line 1
# without scrolling. Findings are heuristic — an OK line just means we didn't
# spot the specific failure mode listed, not that the service is bug-free.
# ---------------------------------------------------------------------------
CHECKLIST="$(mktemp)"

# Per-service expectations. Update here when you add a new compose service.
#   REQUIRED[svc]         → space-separated env vars that MUST be non-empty
#   EXPECTED_PORTS[svc]   → space-separated container ports we expect published
declare -A REQUIRED
REQUIRED[app]="LOVABLE_API_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VAULT_ENCRYPTION_KEY PUBLIC_APP_URL"
REQUIRED[caddy]=""
REQUIRED[ollama]=""

declare -A EXPECTED_PORTS
EXPECTED_PORTS[app]="3000"
EXPECTED_PORTS[caddy]="80 443"
EXPECTED_PORTS[ollama]=""   # internal-only in default compose

emit()  { printf '%s\n' "$*" >> "$CHECKLIST"; }
ok_l()  { emit "  [ OK  ] $*"; }
warn_l(){ emit "  [WARN ] $*"; }
fail_l(){ emit "  [FAIL ] $*"; }

emit "===================================================================="
emit " CHECKLIST — likely issues (heuristic; scan first, then read details)"
emit " Generated: $(date -Iseconds)"
emit "===================================================================="

if ! "${DC[@]}" ps -q >/dev/null 2>&1; then
  emit ""
  emit "  [FAIL ] docker unreachable — skipping per-service checklist."
  emit "          See section 2 for the exact daemon error."
else
  SERVICES="$( "${DC[@]}" ps --services 2>/dev/null | sort -u )"
  if [ -z "$SERVICES" ]; then
    emit ""
    emit "  [FAIL ] no compose services are running (compose up not executed?)"
  fi

  for svc in $SERVICES; do
    emit ""
    emit "-- $svc --"
    cid="$( "${DC[@]}" ps -q "$svc" 2>/dev/null | head -n1 )"
    if [ -z "$cid" ]; then
      fail_l "no running container for '$svc' (crashed or never started)"
      continue
    fi

    # State + health
    state="$( "${DOCKER[@]}" inspect --format '{{.State.Status}}' "$cid" 2>/dev/null )"
    health="$( "${DOCKER[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null )"
    restarts="$( "${DOCKER[@]}" inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null )"

    if [ "$state" != "running" ]; then
      fail_l "state=$state (expected 'running')"
    elif [ "$health" = "unhealthy" ]; then
      fail_l "container reports HEALTHCHECK=unhealthy"
    elif [ "$health" = "starting" ]; then
      warn_l "HEALTHCHECK still 'starting' — may just need a few more seconds"
    else
      ok_l "state=$state health=$health"
    fi

    if [ "${restarts:-0}" -gt 3 ] 2>/dev/null; then
      warn_l "high restart count ($restarts) — check logs for a crash loop"
    fi

    # Port bindings
    bound_ports="$( "${DOCKER[@]}" inspect --format \
      '{{range $p, $bs := .NetworkSettings.Ports}}{{range $bs}}{{$p}} {{end}}{{end}}' \
      "$cid" 2>/dev/null | tr ' ' '\n' | awk -F/ 'NF{print $1}' | sort -u )"
    for want in ${EXPECTED_PORTS[$svc]:-}; do
      if ! grep -qxF "$want" <<<"$bound_ports"; then
        fail_l "expected host-published port $want is NOT bound (check 'ports:' in docker-compose.yml)"
      else
        ok_l "port $want is published"
      fi
    done

    # Effective env: pull KEY=VALUE lines once, then check each requirement.
    env_dump="$( "${DOCKER[@]}" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null )"
    for key in ${REQUIRED[$svc]:-}; do
      line="$( grep -m1 "^${key}=" <<<"$env_dump" || true )"
      if [ -z "$line" ]; then
        fail_l "required env '$key' is NOT SET inside the container (missing from docker-compose 'environment:' or .env passthrough)"
      else
        val="${line#*=}"
        if [ -z "${val//[[:space:]]/}" ]; then
          fail_l "required env '$key' is EMPTY (set in compose but resolved to '' — likely unset in host .env)"
        else
          ok_l "env '$key' is set (len=${#val})"
        fi
      fi
    done

    # Conflict heuristic: both LOVABLE_API_KEY and CUSTOM_AI_BASE_URL set on
    # the app can mask which provider actually serves a call — surface it.
    if [ "$svc" = "app" ]; then
      has_lov="$( grep -c '^LOVABLE_API_KEY=..' <<<"$env_dump" || true )"
      has_cust="$( grep -c '^CUSTOM_AI_BASE_URL=..' <<<"$env_dump" || true )"
      if [ "${has_lov:-0}" -gt 0 ] && [ "${has_cust:-0}" -gt 0 ]; then
        warn_l "both LOVABLE_API_KEY and CUSTOM_AI_BASE_URL are set — self-host mode may still route to Lovable if CUSTOM_AI_BASE_URL is blanked at runtime"
      fi
      # PUBLIC_APP_URL vs Caddy host mismatch (webhook callbacks break silently).
      pub="$( grep -m1 '^PUBLIC_APP_URL=' <<<"$env_dump" | cut -d= -f2- )"
      if [ -n "${pub:-}" ] && ! grep -q "$(sed 's,https\?://,,' <<<"$pub" | cut -d/ -f1)" Caddyfile 2>/dev/null; then
        warn_l "PUBLIC_APP_URL host does not appear in Caddyfile — webhook callbacks may 404"
      fi
    fi
  done
fi

# .env vs .env.example drift (host side, before compose interpolation).
if [ -f .env.example ] && [ -f .env ]; then
  emit ""
  emit "-- host .env vs .env.example --"
  missing_host=0
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    grep -q "^${k}=" .env || { fail_l "host .env is missing '$k' (present in .env.example)"; missing_host=$((missing_host+1)); }
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1)
  [ "$missing_host" -eq 0 ] && ok_l "host .env defines every key present in .env.example"
fi

emit "===================================================================="
emit ""

# Prepend checklist to the bundle: header first, then the rest.
TMP_BUNDLE="$(mktemp)"
cat "$CHECKLIST" "$OUT" > "$TMP_BUNDLE"
mv "$TMP_BUNDLE" "$OUT"
rm -f "$CHECKLIST"

# Echo the checklist to stdout too, so an operator running interactively sees
# the verdict without having to open the bundle file.
sed -n '1,/^====*$/p; /^====*$/,/^====*$/p' "$OUT" | head -n 200

say ""
say "===================================================================="
say " Done. Full bundle written to: $OUT"
say " Checklist is at the TOP of the bundle — scan it first."
say " Share it with:   cat $OUT | head -c 100000"
say "===================================================================="
