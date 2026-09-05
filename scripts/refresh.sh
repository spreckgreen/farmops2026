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
#   5. Applies pending supabase/migrations/*.sql and reloads the PostgREST
#      schema cache (scripts/apply-migrations.sh) BEFORE the new code serves.
#   6. `docker compose up -d` — recreates only containers whose image/config
#      changed. Ollama model volume and Caddy certs survive.
#   7. Prunes dangling images from the previous build to reclaim disk.
#   8. Tails app logs until the healthcheck passes (or 90s timeout).
#
# Usage:
#   ./scripts/refresh.sh              # pull + rebuild only if new commits
#   ./scripts/refresh.sh --force      # rebuild even if git is already up to date
#   ./scripts/refresh.sh --no-pull    # skip git pull (rebuild from local tree)
#   ./scripts/refresh.sh --no-sudo    # never fall back to `sudo docker`
#   ./scripts/refresh.sh --skip-migrations   # deploy without touching the schema

#
# Safe to re-run. Exits non-zero on any failure so it can be wired into cron
# or a systemd timer.
# ============================================================================
set -euo pipefail

FORCE=0
DO_PULL=1
ALLOW_SUDO=1
SKIP_HEALTHCHECK=0
SKIP_MIGRATIONS=0
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --no-pull) DO_PULL=0 ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    --skip-healthcheck) SKIP_HEALTHCHECK=1 ;;
    --skip-migrations) SKIP_MIGRATIONS=1 ;;
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

# A user may run `git pull` before this script. Comparing BEFORE/AFTER alone
# incorrectly treated that case as already deployed and left the old container
# running. New images carry their source revision; compare HEAD to the running
# app instead. Images built before revision labels intentionally report blank
# and therefore get rebuilt once.
APP_REVISION="$AFTER"
export APP_REVISION
APP_CONTAINER="$(${DOCKER[@]} compose ps -q app 2>/dev/null || true)"
DEPLOYED_REVISION=""
if [ -n "$APP_CONTAINER" ]; then
  DEPLOYED_REVISION="$(${DOCKER[@]} inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$APP_CONTAINER" 2>/dev/null || true)"
fi

if [ "$DEPLOYED_REVISION" = "$AFTER" ] && [ "$FORCE" -eq 0 ]; then
  log "Source and running app are already at ${AFTER:0:10}. Nothing to do. Use --force to rebuild anyway."
  exit 0
fi

if [ -z "$DEPLOYED_REVISION" ]; then
  log "Running app has no source revision label — rebuilding from ${AFTER:0:10}"
elif [ "$DEPLOYED_REVISION" != "$AFTER" ]; then
  log "Running app is ${DEPLOYED_REVISION:0:10}; rebuilding from ${AFTER:0:10}"
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
# docker compose's COMPOSE_ENV_FILES (comma-separated, later files override).
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

# --- 1b-i. Auto-heal an unreadable env file --------------------------------
# fill-env-from-supabase.sh run via sudo used to leave .env.local as
# root:root 0600, which the non-sudo refresh path can't read → check-env.sh
# reports every var MISSING. Detect that case and repair it in place using
# passwordless sudo, without ever changing the file's contents.
autoheal_env_file() {
  local f="$1"
  [ -n "$f" ] && [ -e "$f" ] || return 0
  [ -r "$f" ] && return 0   # already readable — nothing to do

  local me; me="$(id -un)"
  local owner; owner="$(stat -c '%U' "$f" 2>/dev/null || echo '?')"
  local mode;  mode="$(stat -c '%a' "$f" 2>/dev/null || echo '?')"
  log "Auto-heal: $f is unreadable (owner=$owner mode=$mode, running as $me)"

  # Only try sudo if it's available AND passwordless (never prompt inside a script).
  if ! command -v sudo >/dev/null 2>&1; then
    err "  sudo not installed — run manually: chown $me: \"$f\" && chmod 600 \"$f\""
    return 1
  fi
  if ! sudo -n true 2>/dev/null; then
    err "  Passwordless sudo unavailable. Run manually:"
    err "    sudo chown $me: \"$f\" && sudo chmod 600 \"$f\""
    return 1
  fi

  # Safe repair: only chown (never touch content), keep 0600, restrict to
  # the exact file inside the project root — never a symlink to elsewhere.
  if [ -L "$f" ]; then
    err "  Refusing to auto-heal a symlink: $f → $(readlink "$f")"
    return 1
  fi
  local abs; abs="$(readlink -f "$f")"
  case "$abs" in
    "$PWD"/*) ;;
    *) err "  Refusing to auto-heal file outside project root: $abs"; return 1 ;;
  esac

  if sudo chown "$me:" "$f" && sudo chmod 600 "$f"; then
    log "Auto-heal: repaired $f (now $me:$(id -gn) 0600)"
    return 0
  else
    err "  chown/chmod failed — run manually: sudo chown $me: \"$f\" && sudo chmod 600 \"$f\""
    return 1
  fi
}
autoheal_env_file "$ENV_FILE" || exit 1

# Compose's service-level `env_file` is runtime-only and does not populate
# Docker build args. Export the selected file explicitly so shell values win
# over a stale project .env during interpolation of services.app.build.args.
if [ -n "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "./$ENV_FILE"
  set +a
  # The deployed revision always comes from the checked-out source, never from
  # an optional value that may happen to exist in the environment file.
  APP_REVISION="$AFTER"
  export APP_REVISION
  log "Exported $ENV_FILE for Docker build-time VITE_* arguments"
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
# Size the builder's Node heap from real host memory. V8 old-space is only part
# of peak usage: Rolldown's Rust graph, generated chunks, and Docker overhead
# live outside that cap. On an 8 GB host the Nitro server pass can use roughly
# 4 GB outside V8, so keep automatic old-space at 25% of RAM and no more than
# 2048 MB. Override explicitly only on a host with measured extra headroom.
if [ -z "${NODE_HEAP_MB:-}" ]; then
  total_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  avail_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  by_total=$(( total_mb * 25 / 100 ))
  by_available=$(( avail_mb - 4096 ))
  heap="$by_total"
  [ "$by_available" -lt "$heap" ] && heap="$by_available"
  [ "$heap" -lt 1536 ] && heap=1536
  [ "$heap" -gt 2048 ] && heap=2048
  NODE_HEAP_MB="$heap"
  log "Host memory total=${total_mb}MB available=${avail_mb}MB -> NODE_HEAP_MB=${NODE_HEAP_MB} (native reserve preserved)"
fi
export NODE_HEAP_MB

# Nitro 3 uses Rolldown for its final server bundle. Its Rust worker pools are
# outside max-old-space-size and previously pushed this 8 GB host to 7.1 GB RSS.
# Two workers trade a little build speed for a stable peak. Operators can still
# override these values after measuring a larger machine.
# Two workers still peaked near 7.1 GB during the Nitro server pass on this
# 8 GB host and was SIGKILLed. Single-threaded native work is the only setting
# that keeps that phase inside the host budget; hosts with 12 GB or more get
# two workers back automatically.
_native_workers=1
[ "${total_mb:-0}" -ge 12288 ] && _native_workers=2
export ROLLDOWN_WORKER_THREADS="${ROLLDOWN_WORKER_THREADS:-$_native_workers}"
export ROLLDOWN_MAX_BLOCKING_THREADS="${ROLLDOWN_MAX_BLOCKING_THREADS:-$_native_workers}"
export RAYON_NUM_THREADS="${RAYON_NUM_THREADS:-$_native_workers}"

# A heap cap cannot constrain native allocations. For hosts below 12 GB with no
# swap, create a private build-only swap file as an OOM safety net, then remove
# it immediately after `docker compose build`. This does not interrupt the
# currently running app. Failure to create swap is non-fatal because the worker
# limits and conservative heap remain active.
BUILD_SWAP_FILE="${BUILD_SWAP_FILE:-/var/tmp/farmops-build.swap}"
BUILD_SWAP_CREATED=0
ROOT_CMD=()
if [ "$(id -u)" -eq 0 ]; then
  ROOT_CMD=()
elif [ "$ALLOW_SUDO" -eq 1 ] && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  ROOT_CMD=(sudo -n)
fi
cleanup_build_swap() {
  if [ "$BUILD_SWAP_CREATED" -eq 1 ]; then
    log "Removing temporary build swap"
    "${ROOT_CMD[@]}" swapoff "$BUILD_SWAP_FILE" 2>/dev/null || true
    "${ROOT_CMD[@]}" rm -f "$BUILD_SWAP_FILE" 2>/dev/null || true
    BUILD_SWAP_CREATED=0
  fi
}
trap cleanup_build_swap EXIT
trap 'cleanup_build_swap; exit 130' INT TERM

swap_total_mb=$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
swap_dir_available_mb=$(df -Pm "$(dirname "$BUILD_SWAP_FILE")" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)
if [ "${total_mb:-0}" -lt 12288 ] && [ "$swap_total_mb" -lt 4096 ] && [ "$swap_dir_available_mb" -ge 7168 ] && command -v mkswap >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ "${#ROOT_CMD[@]}" -gt 0 ]; }; then
  log "Low-memory host has ${swap_total_mb}MB swap; preparing a 6144MB build-only safety net"
  if "${ROOT_CMD[@]}" rm -f "$BUILD_SWAP_FILE" 2>/dev/null \
    && { "${ROOT_CMD[@]}" fallocate -l 6G "$BUILD_SWAP_FILE" 2>/dev/null \
      || "${ROOT_CMD[@]}" dd if=/dev/zero of="$BUILD_SWAP_FILE" bs=1M count=6144 status=none; } \
    && "${ROOT_CMD[@]}" chmod 600 "$BUILD_SWAP_FILE" \
    && "${ROOT_CMD[@]}" mkswap "$BUILD_SWAP_FILE" >/dev/null \
    && "${ROOT_CMD[@]}" swapon "$BUILD_SWAP_FILE"; then
    BUILD_SWAP_CREATED=1
    log "Temporary build swap enabled at $BUILD_SWAP_FILE"
  else
    err "Warning: could not enable temporary build swap; continuing with constrained Rolldown workers"
    "${ROOT_CMD[@]}" rm -f "$BUILD_SWAP_FILE" 2>/dev/null || true
  fi
elif [ "${total_mb:-0}" -lt 12288 ] && [ "$swap_total_mb" -lt 4096 ]; then
  err "Warning: temporary swap unavailable (needs passwordless root and 7168MB free); continuing with constrained Rolldown workers"
fi

log "Build limits: heap=${NODE_HEAP_MB}MB rolldown-workers=${ROLLDOWN_WORKER_THREADS} blocking-workers=${ROLLDOWN_MAX_BLOCKING_THREADS} rayon=${RAYON_NUM_THREADS}"
log "Building app image (BuildKit cache will short-circuit unchanged layers)"
set +e
DOCKER_BUILDKIT=1 "${DOCKER[@]}" compose build app
build_rc=$?
set -e
if [ "$build_rc" -ne 0 ]; then
  cleanup_build_swap
  exit "$build_rc"
fi
cleanup_build_swap

# --- 2b. Apply pending DB migrations ---------------------------------------
# Runs BEFORE the new app image starts serving, so the UI never goes live
# against a schema that lacks its columns (e.g. daily_notes.energy_level →
# "Could not find the 'energy_level' column of 'daily_notes' in the schema
# cache"). Idempotent: already-applied files are skipped via the ledger.
# Exit 3 means "no SUPABASE_DB_URL" (managed Supabase) — not a failure.
MIG="$(dirname "$0")/apply-migrations.sh"
if [ "$SKIP_MIGRATIONS" -eq 1 ]; then
  log "⚠️  --skip-migrations set: schema left untouched"
elif [ -x "$MIG" ]; then
  set +e
  "$MIG"
  mig_rc=$?
  set -e
  case "$mig_rc" in
    0) ;;
    3) log "No SUPABASE_DB_URL — skipping migrations (managed Supabase? use 'supabase db push')" ;;
    *) err "❌ Migrations failed (exit=$mig_rc) — refusing to deploy code against a stale schema."
       err "  The failing file(s) and the exact psql error are printed above."
       err "  Inspect pending files:      $MIG --dry-run"
       err "  Retry one file:             $MIG --only=<filename.sql>"
       err "  Audit ledger vs live schema:  $MIG --verify"
       err "  DB already correct? seed the ledger and move on:"
       err "                              $MIG --baseline"
       err "  Bypass (not recommended):   $0 --no-pull --force --skip-migrations"
       exit 1 ;;
  esac
else
  err "warn: $MIG missing or not executable — schema not verified"
fi

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
