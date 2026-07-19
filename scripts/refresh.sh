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
#
# Safe to re-run. Exits non-zero on any failure so it can be wired into cron
# or a systemd timer.
# ============================================================================
set -euo pipefail

FORCE=0
DO_PULL=1
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --no-pull) DO_PULL=0 ;;
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
docker compose version >/dev/null 2>&1 || { err "docker compose plugin not installed"; exit 1; }
command -v git >/dev/null || { err "git not installed"; exit 1; }

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

# --- 2. Build ---------------------------------------------------------------
log "Building app image (BuildKit cache will short-circuit unchanged layers)"
DOCKER_BUILDKIT=1 docker compose build app

# --- 3. Recreate changed containers ----------------------------------------
log "Bringing stack up (recreates only containers with new image/config)"
docker compose up -d --remove-orphans

# --- 4. Reclaim disk --------------------------------------------------------
log "Pruning dangling images from previous build"
docker image prune -f >/dev/null

# --- 5. Wait for health -----------------------------------------------------
log "Waiting up to 90s for app healthcheck…"
for i in $(seq 1 45); do
  status="$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="app"{print $2}')"
  case "$status" in
    healthy)
      log "✅ app is healthy. Refresh complete."
      docker compose ps
      exit 0 ;;
    unhealthy)
      err "app went unhealthy. Recent logs:"
      docker compose logs --tail=80 app
      exit 1 ;;
  esac
  sleep 2
done

err "Timed out waiting for healthcheck. Recent logs:"
docker compose logs --tail=80 app
exit 1
