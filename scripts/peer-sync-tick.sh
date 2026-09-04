#!/usr/bin/env bash
# peer-sync-tick.sh — drive one automatic peer-sync run from outside the database.
#
# Self-hosted installs usually have no pg_cron, so the schedule rewrite in the
# migrations is skipped there. This script is the replacement trigger: it POSTs
# the active automatic-pull key to the app's hook endpoint. The endpoint checks
# the key against the key table (not a value baked into a schedule), so rotating
# from the admin screen keeps working — this script only needs the current key.
#
# It never writes farm data itself: pulled batches land as preview-only.
#
# Usage:
#   ./scripts/peer-sync-tick.sh
#   ./scripts/peer-sync-tick.sh --env-file /opt/farmops/.env.local
#   ./scripts/peer-sync-tick.sh --url https://farm.example.com --quiet
#
# Environment (read from --env-file, default ./.env.local, then the shell):
#   PUBLIC_APP_URL                     e.g. https://farm.example.com
#   ELECTRICAL_PEER_SYNC_CRON_SECRET   the active automatic-pull key
#
# Exit codes: 0 = run accepted (including "skipped"), 1 = config problem,
#             2 = HTTP/transport failure (the timer will retry next tick).

set -euo pipefail

ENV_FILE="./.env.local"
BASE_URL=""
QUIET=0
TIMEOUT=120

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --url)      BASE_URL="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --quiet|-q) QUIET=1; shift ;;
    -h|--help)  sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

log() { [ "$QUIET" -eq 1 ] || printf '[peer-sync] %s\n' "$*"; }

if [ -f "$ENV_FILE" ]; then
  # Only pull the two variables we need; never echo their values.
  while IFS='=' read -r key value; do
    case "$key" in
      PUBLIC_APP_URL|ELECTRICAL_PEER_SYNC_CRON_SECRET)
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        export "$key=$value"
        ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$ENV_FILE" || true)
fi

[ -n "$BASE_URL" ] || BASE_URL="${PUBLIC_APP_URL:-}"
BASE_URL="${BASE_URL%/}"
SECRET="${ELECTRICAL_PEER_SYNC_CRON_SECRET:-}"

if [ -z "$BASE_URL" ]; then
  echo "[peer-sync] PUBLIC_APP_URL is not set (env file: $ENV_FILE) — pass --url" >&2
  exit 1
fi
if [ -z "$SECRET" ]; then
  echo "[peer-sync] ELECTRICAL_PEER_SYNC_CRON_SECRET is not set (env file: $ENV_FILE)." >&2
  echo "            Generate/rotate it on the admin automatic-pull screen, then store it here." >&2
  exit 1
fi

URL="$BASE_URL/api/public/hooks/electrical-peer-sync"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

log "POST $URL"
CODE="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' \
  --max-time "$TIMEOUT" \
  -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "x-electrical-peer-sync-secret: $SECRET" \
  --data '{}' || echo 000)"

BODY="$(head -c 2000 "$BODY_FILE")"

case "$CODE" in
  200) log "ok: $BODY"; exit 0 ;;
  401) echo "[peer-sync] rejected (401) — the key is not active. Rotate/copy it again from the admin screen." >&2; exit 2 ;;
  000) echo "[peer-sync] could not reach $URL (network or TLS failure)" >&2; exit 2 ;;
  *)   echo "[peer-sync] HTTP $CODE: $BODY" >&2; exit 2 ;;
esac
