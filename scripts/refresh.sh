#!/usr/bin/env bash
# ============================================================================
# refresh.sh — one-command upgrade for a self-hosted Bostead deployment
#
# What it does, in order:
#   1. Records the current git HEAD so we can roll back if the pull breaks.
#   2. `git pull --ff-only` on the current branch (fails loudly on divergence
#      instead of silently merging — safer for an unattended prod host).
#   3. If nothing changed and --force wasn't passed, exits early (no rebuild).
#   4. `docker compose build app` — reuses BuildKit layer cache, so unchanged
#      deps skip reinstall. Ollama/Caddy images aren't rebuilt.
#   5. `docker compose up -d` — recreates only containers whose image/config
#      changed. Ollama model volume and Caddy certs survive.
#   6. Prunes dangling images from the previous build to reclaim disk.
#   7. Tails app logs until the healthcheck passes (or 90s timeout).
#
# Usage:
#   ./scripts/refresh.sh              # pull + rebuild only if new commits
#   ./scripts/refresh.sh --force      # rebuild even if git is already up to date
#   ./scripts/refresh.sh --no-pull    # skip git pull (rebuild from local tree)
#   ./scripts/refresh.sh --no-sudo    # never fall back to `sudo docker`
#
# Safe to re-run. Exits non-zero on any failure so it can be wired into cron
# or a systemd timer.
# ============================================================================
set -euo pipefail

FORCE=0
DO_PULL=1
ALLOW_SUDO=1
SKIP_HEALTHCHECK=0
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --no-pull) DO_PULL=0 ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    --skip-healthcheck) SKIP_HEALTHCHECK=1 ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

log() { printf '\033[1;36m[refresh]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[refresh]\033[0m %s\n' "$*" >&2; }

# --- 0. Prerequisites -------------------------------------------------------
command -v docker >/dev/null || { err "docker not installed"; exit 1; }
command -v git >/dev/null || { err "git not installed"; exit 1; }

# --- 0a. Pick a docker invocation that works --------------------------------
# Prefer running as the current user (keeps SSH keys / git creds intact).
# Fall back to `sudo docker` only if the daemon socket rejects us AND sudo
# is available non-interactively. Never prompt for a password mid-build.
DOCKER=(docker)
if docker info >/dev/null 2>&1; then
  log "Docker accessible as $(id -un) — no sudo needed"
elif [ "$ALLOW_SUDO" -eq 1 ] && command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
  log "Docker socket denied for $(id -un); falling back to: sudo docker (passwordless sudo OK)"
  log "  Tip: 'sudo usermod -aG docker $(id -un) && newgrp docker' removes the need for sudo."
else
  err "Cannot talk to docker as $(id -un) and passwordless sudo unavailable."
  err "Fix one of:"
  err "  1) sudo usermod -aG docker $(id -un) && newgrp docker   (recommended)"
  err "  2) run: sudo ./scripts/refresh.sh --no-pull --force"
  err "  3) enable NOPASSWD sudo for docker, then re-run"
  exit 1
fi

"${DOCKER[@]}" compose version >/dev/null 2>&1 || { err "docker compose plugin not installed"; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse HEAD)"
log "Current branch: ${BRANCH} @ ${BEFORE:0:10}"

# --- 1. Pull ----------------------------------------------------------------
if [ "$DO_PULL" -eq 1 ]; then
  log "git fetch + pull --ff-only origin/${BRANCH}"
  git fetch --prune origin
  if ! git pull --ff-only origin "$BRANCH"; then
    err "git pull failed (non fast-forward?). Resolve manually, then re-run."
    exit 1
  fi
else
  log "Skipping git pull (--no-pull)"
fi

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ] && [ "$FORCE" -eq 0 ]; then
  log "Already up to date (${AFTER:0:10}). Nothing to do. Use --force to rebuild anyway."
  exit 0
fi

if [ "$BEFORE" != "$AFTER" ]; then
  log "Updated ${BEFORE:0:10} → ${AFTER:0:10}"
  echo
  git --no-pager log --oneline "${BEFORE}..${AFTER}" | sed 's/^/  • /'
  echo
fi

# --- 1b. Env placeholder gate (fail fast before a 5-min Docker build) -------
# Catches unreplaced values from docs/env.self-hosted-supabase.example.tmpl such as
# `CHANGE_ME_ANON_KEY_JWT` or `https://supabase.example.com`. The server also
# refuses to boot on these (src/lib/env-startup-check.server.ts), but failing
# here saves the whole build+recreate cycle.
#
# Prefer .env.local (gitignored, holds real self-hosted keys) over the tracked
# .env (Lovable Cloud publishable-only). When both exist, .env.local wins via
# docker compose's COMPOSE_ENV_FILES (colon-separated, later files override).
ENV_FILE=""
if [ -f .env.local ]; then
  ENV_FILE=".env.local"
  # COMPOSE_ENV_FILES is COMMA-separated (later files override earlier ones).
  # A colon here makes docker treat the whole string as one filename and fail
  # with: "couldn't find env file: .../.env:.env.local".
  export COMPOSE_ENV_FILES=".env,.env.local"   # .env.local wins
  log "Using .env.local for compose (via COMPOSE_ENV_FILES=.env,.env.local)"
elif [ -f .env ]; then
  ENV_FILE=".env"
fi

CE="$(dirname "$0")/check-env.sh"
if [ -x "$CE" ] && [ -n "$ENV_FILE" ]; then
  log "Validating $ENV_FILE against docs/env.self-hosted-supabase.example.tmpl placeholders…"
  if ! "$CE" --env-file "$ENV_FILE"; then
    err "Refusing to rebuild: $ENV_FILE still contains placeholder values."
    err "  Fix: sudo scripts/fill-env-from-supabase.sh   # writes .env.local"
    err "  Or:  edit $ENV_FILE by hand using docs/env.self-hosted-supabase.example.tmpl as reference."
    exit 1
  fi
elif [ -z "$ENV_FILE" ]; then
  err "No .env.local or .env file found. Bootstrap with:"
  err "  sudo scripts/fill-env-from-supabase.sh   # writes .env.local from /home/<user>/supabase-project"
  err "  # or: cp docs/env.self-hosted-supabase.example.tmpl .env.local  &&  edit by hand"
  exit 1
fi

# --- 2. Build ---------------------------------------------------------------
log "Building app image (BuildKit cache will short-circuit unchanged layers)"
DOCKER_BUILDKIT=1 "${DOCKER[@]}" compose build app

# --- 3. Recreate changed containers ----------------------------------------
log "Bringing stack up (recreates only containers with new image/config)"
"${DOCKER[@]}" compose up -d --remove-orphans

# --- 4. Reclaim disk --------------------------------------------------------
log "Pruning dangling images from previous build"
"${DOCKER[@]}" image prune -f >/dev/null

# --- 5. Wait for the app container's own HEALTHCHECK to flip to healthy ----
# This is the fast, cheap gate — it only asks "is the container up?" and does
# NOT verify env/connectivity. The full PASS/FAIL gate runs in step 6 below.
log "Waiting up to 90s for app healthcheck…"
for i in $(seq 1 45); do
  status="$("${DOCKER[@]}" compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="app"{print $2}')"
  case "$status" in
    healthy)   log "container reports healthy — proceeding to full probe"; break ;;
    unhealthy)
      err "app went unhealthy. Recent logs:"
      "${DOCKER[@]}" compose logs --tail=80 app
      exit 1 ;;
  esac
  if [ "$i" -eq 45 ]; then
    err "Timed out waiting for container healthcheck. Recent logs:"
    "${DOCKER[@]}" compose logs --tail=80 app
    exit 1
  fi
  sleep 2
done

# --- 6. Full PASS/FAIL gate (containers + env + caddy→app connectivity) ----
# scripts/healthcheck.sh exits 0 only when EVERY probe passes. On any FAIL we
# abort the refresh with a non-zero status so cron / systemd / CI notice —
# instead of silently declaring success on a broken site.
if [ "$SKIP_HEALTHCHECK" -eq 1 ]; then
  log "⚠️  --skip-healthcheck set: skipping full PASS/FAIL gate (not recommended)"
  "${DOCKER[@]}" compose ps
  exit 0
fi

HC="$(dirname "$0")/healthcheck.sh"
if [ ! -x "$HC" ]; then
  err "scripts/healthcheck.sh not found or not executable — cannot verify refresh."
  err "  Re-run with --skip-healthcheck to bypass (leaves stack unverified)."
  exit 1
fi

HC_FLAGS=()
[ "$ALLOW_SUDO" -eq 0 ] && HC_FLAGS+=(--no-sudo)

log "Running full healthcheck gate: $HC ${HC_FLAGS[*]:-}"
# Capture the probe output so we can echo it back after diagnose.sh runs —
# by the time the operator scrolls up, the reason for the FAIL has usually
# scrolled past the compose ps / diagnose output.
HC_LOG="$(mktemp -t refresh-healthcheck.XXXXXX.log)"
if "$HC" "${HC_FLAGS[@]}" 2>&1 | tee "$HC_LOG"; then
  log "✅ all probes PASS. Refresh complete."
  rm -f "$HC_LOG"
  "${DOCKER[@]}" compose ps
  exit 0
else
  # `set -o pipefail` propagates healthcheck.sh's non-zero status through tee.
  rc=${PIPESTATUS[0]}
  err "❌ healthcheck reported FAIL (exit=$rc) — refresh aborted."

  # Auto-run diagnose.sh so the operator has a full bundle ready to share
  # without a second round-trip. Never let diagnose.sh's own failure mask
  # the underlying healthcheck exit code.
  DIAG="$(dirname "$0")/diagnose.sh"
  if [ -x "$DIAG" ]; then
    err "   Running $DIAG to collect a diagnostics bundle…"
    DIAG_FLAGS=()
    [ "$ALLOW_SUDO" -eq 0 ] && DIAG_FLAGS+=(--no-sudo)
    # diagnose.sh already tees to /tmp/bostead-diag-*.txt; we just let it
    # print to the terminal so the operator sees the CHECKLIST inline.
    "$DIAG" "${DIAG_FLAGS[@]}" || err "   (diagnose.sh itself exited non-zero — see output above)"
  else
    err "   scripts/diagnose.sh not found or not executable — skipping bundle."
  fi

  # Replay the healthcheck output last so the exact PASS/FAIL rows that
  # aborted the refresh are the final thing on screen.
  err ""
  err "──── healthcheck.sh output (the reason refresh aborted) ────"
  cat "$HC_LOG" >&2 || true
  err "──── end healthcheck.sh output ────"
  rm -f "$HC_LOG"

  err ""
  err "   Fast recovery attempt:  ./scripts/remediate.sh"
  exit "$rc"
fi
