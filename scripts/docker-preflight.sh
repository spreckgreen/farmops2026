#!/usr/bin/env bash
# Validate that the build context contains every file, directory, and
# executable bit the Docker builder stage needs BEFORE any long-running or
# privileged command runs. Safe to run locally (from repo root) or inside
# the Docker builder stage (with APP_ROOT=/app).
#
# Usage:
#   scripts/docker-preflight.sh                 # local run, APP_ROOT=.
#   APP_ROOT=/app scripts/docker-preflight.sh   # inside Docker builder
#
# Exits 1 on the first batch of failures with
#   ERROR: missing file: <path>
#   ERROR: missing directory: <path>
#   ERROR: not executable: <path>
# lines so logs pinpoint the exact problem.
set -eu

APP_ROOT="${APP_ROOT:-.}"
# Normalize trailing slash.
APP_ROOT="${APP_ROOT%/}"

# Append a stage marker to the unified install log when one is configured,
# so a preflight failure shows up in the same rollup as deps/build/runner.
INSTALL_LOG="${INSTALL_LOG:-/tmp/bostead-install.log}"
mkdir -p "$(dirname "$INSTALL_LOG")" 2>/dev/null || true
touch "$INSTALL_LOG" 2>/dev/null || true
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
echo "[$(ts)] [preflight]    START  scripts/docker-preflight.sh APP_ROOT=$APP_ROOT" | tee -a "$INSTALL_LOG"
PREFLIGHT_START=$(date +%s)
trap '
  STATUS=$?
  ELAPSED=$(( $(date +%s) - PREFLIGHT_START ))
  if [ "$STATUS" -eq 0 ]; then
    echo "[$(ts)] [preflight]    OK     (${ELAPSED}s)" | tee -a "$INSTALL_LOG"
  else
    echo "[$(ts)] [preflight]    FAIL   exit=${STATUS} (${ELAPSED}s)" | tee -a "$INSTALL_LOG" >&2
  fi
' EXIT

echo "============================================="
echo "=== [preflight] Validating build context at $(date +%H:%M:%S) ==="
echo "=== [preflight] APP_ROOT=$APP_ROOT"
echo "=== [preflight] INSTALL_LOG=$INSTALL_LOG"
echo "============================================="


REQUIRED_FILES="\
  $APP_ROOT/package.json \
  $APP_ROOT/bun.lock \
  $APP_ROOT/vite.config.ts \
  $APP_ROOT/tsconfig.json \
  $APP_ROOT/src/router.tsx \
  $APP_ROOT/src/server.ts \
  $APP_ROOT/src/start.ts \
  $APP_ROOT/src/routes/__root.tsx \
  $APP_ROOT/src/routes/index.tsx \
"

REQUIRED_DIRS="\
  $APP_ROOT/src \
  $APP_ROOT/src/routes \
  $APP_ROOT/src/lib \
  $APP_ROOT/src/components \
  $APP_ROOT/scripts \
"

REQUIRED_EXEC="\
  $APP_ROOT/scripts/build-with-progress.mjs \
"

# node_modules and node_modules/vite are only required inside the builder
# (after the deps stage copy). Skip locally unless explicitly requested.
CHECK_NODE_MODULES="${CHECK_NODE_MODULES:-auto}"
if [ "$CHECK_NODE_MODULES" = "auto" ]; then
  if [ "$APP_ROOT" = "/app" ]; then
    CHECK_NODE_MODULES=1
  else
    CHECK_NODE_MODULES=0
  fi
fi

fail=0

for d in $REQUIRED_DIRS; do
  if [ ! -d "$d" ]; then
    echo "ERROR: missing directory: $d" >&2
    fail=1
  else
    echo "  ok dir : $d"
  fi
done

for f in $REQUIRED_FILES; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing file: $f" >&2
    fail=1
  else
    echo "  ok file: $f ($(wc -c < "$f") bytes)"
  fi
done

for f in $REQUIRED_EXEC; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing file: $f" >&2
    fail=1
    continue
  fi
  if [ ! -x "$f" ]; then
    echo "WARN: $f is not executable; applying chmod +x" >&2
    chmod +x "$f" || true
  fi
  if [ ! -x "$f" ]; then
    echo "ERROR: not executable: $f" >&2
    fail=1
  else
    echo "  ok exec: $f (mode $(stat -c '%a' "$f" 2>/dev/null || stat -f '%A' "$f"))"
  fi
done

if [ "$CHECK_NODE_MODULES" = "1" ]; then
  if [ ! -d "$APP_ROOT/node_modules" ]; then
    echo "ERROR: missing directory: $APP_ROOT/node_modules" >&2
    fail=1
  else
    echo "  ok dir : $APP_ROOT/node_modules"
  fi
  if [ ! -d "$APP_ROOT/node_modules/vite" ]; then
    echo "ERROR: missing directory: $APP_ROOT/node_modules/vite (deps stage did not copy correctly)" >&2
    fail=1
  else
    echo "  ok dir : $APP_ROOT/node_modules/vite"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "=== [preflight] FAILED — fix the ERROR lines above before retrying ===" >&2
  echo "    Common causes: overly broad .dockerignore, missing source file, broken deps copy" >&2
  exit 1
fi

echo "=== [preflight] PASSED — all required files, dirs, and exec bits present ==="
