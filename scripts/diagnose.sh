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
