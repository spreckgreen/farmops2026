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

say ""
say "===================================================================="
say " Done. Full bundle written to: $OUT"
say " Share it with:   cat $OUT | head -c 100000"
say "===================================================================="
