#!/usr/bin/env bash
# scripts/remediate.sh — minimal-blast-radius restart for the Bostead stack.
#
# When the site is down after a refresh, you usually don't want a full
# `docker compose up -d --build` (slow, rebuilds images, can restart the
# Ollama model download). This script restarts ONLY the services you name
# (default: app + caddy), waits for them to become healthy, then re-runs
# the local health probes via scripts/healthcheck.sh to confirm recovery.
#
# Usage:
#   ./scripts/remediate.sh                    # restart app + caddy
#   ./scripts/remediate.sh --with-ollama      # also restart ollama
#   ./scripts/remediate.sh --only app         # restart just one service
#   ./scripts/remediate.sh --host farmops.bostead.life   # forwarded to healthcheck
#   ./scripts/remediate.sh --no-sudo          # never try `sudo docker`
#   ./scripts/remediate.sh --dry-run          # print the plan, do nothing
#
# Example (typical post-refresh recovery):
#   $ ./scripts/remediate.sh --with-ollama
#   → Restarting: app caddy ollama
#   → Waiting for containers to report healthy (max 60s) ...
#   → Running scripts/healthcheck.sh
#   PASS  containers  env  connectivity
#
# Exit code: 0 if the follow-up healthcheck passes, non-zero otherwise —
# so it's safe to chain: `./scripts/remediate.sh && echo ok`.

set -u
set -o pipefail

DEFAULT_SERVICES=(app caddy)
SERVICES=()
WITH_OLLAMA=0
ONLY=""
HOST_ARG=()
ALLOW_SUDO=1
DRY_RUN=0
WAIT_SECS=60

while [ $# -gt 0 ]; do
  case "$1" in
    --with-ollama) WITH_OLLAMA=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    --only=*) ONLY="${1#*=}" ;;
    --host) shift; HOST_ARG=(--host "${1:-}") ;;
    --host=*) HOST_ARG=(--host "${1#*=}") ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --wait) shift; WAIT_SECS="${1:-60}" ;;
    --wait=*) WAIT_SECS="${1#*=}" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift || true
done

if [ -n "$ONLY" ]; then
  SERVICES=("$ONLY")
else
  SERVICES=("${DEFAULT_SERVICES[@]}")
  [ "$WITH_OLLAMA" = "1" ] && SERVICES+=(ollama)
fi

if [ -t 1 ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; RESET=""
fi

log() { printf '%s\n' "$*"; }
info() { printf '%s→%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '%sPASS%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%sWARN%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '%sFAIL%s %s\n' "$RED"   "$RESET" "$*"; }

# --- Pick a docker invocation that actually works on this host -------------
# Mirrors refresh.sh / healthcheck.sh: try rootless first, only fall back to
# `sudo -n docker` (non-interactive; requires passwordless sudo) when allowed.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if [ "$ALLOW_SUDO" = "1" ] && sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo -n docker)
    warn "using passwordless sudo for docker (user lacks socket access)"
  else
    fail "cannot talk to the docker daemon (add your user to the 'docker' group or re-run with sudo)"
    exit 3
  fi
fi
DC=("${DOCKER[@]}" compose)

# --- Sanity: are the services declared in this compose project? -----------
KNOWN="$("${DC[@]}" config --services 2>/dev/null || true)"
if [ -z "$KNOWN" ]; then
  fail "docker compose config returned no services — run this from the project root (with docker-compose.yml)"
  exit 3
fi

MISSING=()
for svc in "${SERVICES[@]}"; do
  grep -qxF "$svc" <<<"$KNOWN" || MISSING+=("$svc")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  fail "these services are not defined in docker-compose.yml: ${MISSING[*]}"
  log  "known services: $(tr '\n' ' ' <<<"$KNOWN")"
  exit 3
fi

info "Restarting: ${SERVICES[*]}"
if [ "$DRY_RUN" = "1" ]; then
  log "(dry-run) would run: ${DC[*]} restart ${SERVICES[*]}"
  log "(dry-run) would then run: scripts/healthcheck.sh ${HOST_ARG[*]:-}"
  exit 0
fi

# `restart` (not `up`) so we do NOT rebuild images or touch volumes.
if ! "${DC[@]}" restart "${SERVICES[@]}"; then
  fail "docker compose restart failed — check: ${DC[*]} logs --tail=100 ${SERVICES[*]}"
  exit 4
fi

# --- Wait for containers to settle ----------------------------------------
# A restarted container reports status=running almost immediately; the
# meaningful signal is either:
#   - Health.Status == "healthy"   (when a HEALTHCHECK is defined), or
#   - State.Status  == "running" AND RestartCount didn't just tick again
# We poll up to $WAIT_SECS seconds.
info "Waiting for containers to report healthy (max ${WAIT_SECS}s)"
deadline=$(( $(date +%s) + WAIT_SECS ))
while :; do
  all_good=1
  for svc in "${SERVICES[@]}"; do
    cid="$( "${DC[@]}" ps -q "$svc" 2>/dev/null | head -n1 )"
    if [ -z "$cid" ]; then all_good=0; break; fi
    # `{{if .State.Health}}...{{else}}none{{end}}` → "healthy" | "starting" |
    # "unhealthy" | "none" (no HEALTHCHECK in the image).
    state="$( "${DOCKER[@]}" inspect --format \
      '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$cid" 2>/dev/null )"
    case "$state" in
      running/healthy|running/none) : ;;   # good
      *) all_good=0 ;;
    esac
  done
  [ "$all_good" = "1" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    warn "timed out waiting for healthy state — continuing to probes anyway"
    for svc in "${SERVICES[@]}"; do
      cid="$( "${DC[@]}" ps -q "$svc" 2>/dev/null | head -n1 )"
      [ -n "$cid" ] && log "  $svc: $( "${DOCKER[@]}" inspect --format \
        '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$cid" 2>/dev/null )"
    done
    break
  fi
  sleep 2
done

# --- Re-run the local health probes ---------------------------------------
HC="$(cd "$(dirname "$0")" && pwd)/healthcheck.sh"
if [ ! -x "$HC" ]; then
  warn "scripts/healthcheck.sh not found or not executable — skipping probe"
  exit 0
fi

info "Running scripts/healthcheck.sh"
HC_FLAGS=()
[ "$ALLOW_SUDO" = "0" ] && HC_FLAGS+=(--no-sudo)
[ "${#HOST_ARG[@]}" -gt 0 ] && HC_FLAGS+=("${HOST_ARG[@]}")

if "$HC" "${HC_FLAGS[@]}"; then
  ok "site is healthy after restart"
  exit 0
else
  rc=$?
  fail "healthcheck reported failures (exit=$rc) — inspect: ${DC[*]} logs --tail=100 ${SERVICES[*]}"
  exit "$rc"
fi
