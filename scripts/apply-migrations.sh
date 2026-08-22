#!/usr/bin/env bash
# ============================================================================
# apply-migrations.sh — apply pending supabase/migrations/*.sql to a
# self-hosted Postgres, then reload the PostgREST schema cache.
#
# Why this exists:
#   Lovable Cloud runs migrations for you. A self-hosted VPS does not, so a
#   deploy could ship UI that writes columns the DB doesn't have yet. Symptom:
#     Could not find the 'energy_level' column of 'daily_notes'
#     in the schema cache
#
# How it stays safe to re-run:
#   Applied filenames are recorded in private.applied_migrations, so each file
#   runs at most once. Files already applied by hand before this script existed
#   are handled because every migration in this repo is written idempotently
#   (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE),
#   and each file runs in its own transaction — one failure doesn't corrupt the
#   ledger for the others.
#
# Connection (first match wins):
#   $SUPABASE_DB_URL
#   SUPABASE_DB_URL= line in .env.local, then .env
#   e.g. postgresql://postgres:secret@localhost:5432/postgres
#
# psql resolution: host psql if installed, else a throwaway
# `docker run --rm postgres:16-alpine psql` container (uses host networking so
# localhost:5432 resolves the same way).
#
# Usage:
#   ./scripts/apply-migrations.sh            # apply pending, reload PostgREST
#   ./scripts/apply-migrations.sh --dry-run  # list pending, change nothing
#   ./scripts/apply-migrations.sh --force    # re-run every file, ignore ledger
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;35m[migrate]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[migrate]\033[0m %s\n' "$*" >&2; }

# --- Resolve the DB URL -----------------------------------------------------
DB_URL="${SUPABASE_DB_URL:-}"
for f in .env.local .env; do
  [ -n "$DB_URL" ] && break
  [ -r "$f" ] || continue
  DB_URL="$(grep -E '^[[:space:]]*SUPABASE_DB_URL=' "$f" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
done

if [ -z "$DB_URL" ]; then
  err "SUPABASE_DB_URL not set and not found in .env.local / .env — skipping migrations."
  err "  Managed Supabase (supabase.com) users: run 'supabase db push' instead."
  exit 3   # distinct code so callers can treat 'no DB URL' as non-fatal
fi

# --- Pick a psql -------------------------------------------------------------
if command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
  log "Using host psql ($(psql --version | awk '{print $3}'))"
elif command -v docker >/dev/null 2>&1; then
  PSQL=(docker run --rm --network host -i postgres:16-alpine psql)
  log "Host psql not found — using postgres:16-alpine container (--network host)"
else
  err "Neither psql nor docker available — cannot apply migrations."
  exit 1
fi

run_sql() { "${PSQL[@]}" "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

# --- Ledger ------------------------------------------------------------------
# Needs an owner-level role (the self-hosted `postgres` superuser). A pooled or
# restricted role fails here with "permission denied for database" — that means
# the URL is wrong, not that the migration is bad.
log "Ensuring private.applied_migrations ledger exists"
if ! run_sql -c "
  CREATE SCHEMA IF NOT EXISTS private;
  CREATE TABLE IF NOT EXISTS private.applied_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  REVOKE ALL ON private.applied_migrations FROM PUBLIC;
"; then
  err "Could not create the migration ledger with this SUPABASE_DB_URL."
  err "  Use the owner/superuser connection, e.g.:"
  err "    postgresql://postgres:<password>@localhost:5432/postgres"
  exit 1
fi

APPLIED_LIST=""
if [ "$FORCE" -eq 0 ]; then
  APPLIED_LIST="$(run_sql -At -c "SELECT filename FROM private.applied_migrations;")"
fi


is_applied() {
  printf '%s\n' "$APPLIED_LIST" | grep -Fxq "$1"
}

# --- Apply in filename order -------------------------------------------------
PENDING=0
FAILED=0
for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
  name="$(basename "$path")"
  if is_applied "$name"; then
    continue
  fi
  PENDING=$((PENDING + 1))

  if [ "$DRY_RUN" -eq 1 ]; then
    log "pending: $name"
    continue
  fi

  log "applying: $name"
  # -1 wraps the file in a single transaction: it either fully applies or not
  # at all, so the ledger never claims a half-applied migration.
  if "${PSQL[@]}" "$DB_URL" -v ON_ERROR_STOP=1 -q -1 -f "$path"; then
    run_sql -c "INSERT INTO private.applied_migrations (filename) VALUES ('$name')
                ON CONFLICT (filename) DO NOTHING;"
  else
    err "FAILED: $name (left unrecorded; later files still attempted)"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  log "$PENDING migration(s) pending (dry run — nothing applied)"
  exit 0
fi

if [ "$PENDING" -eq 0 ]; then
  log "Schema already up to date (0 pending)"
else
  log "Applied $((PENDING - FAILED))/$PENDING migration(s)"
fi

# --- Reload PostgREST --------------------------------------------------------
# Without this, PostgREST keeps serving its cached schema and rejects writes to
# brand-new columns with "Could not find the '<col>' column ... in the schema
# cache" until it happens to restart.
log "Reloading PostgREST schema cache (NOTIFY pgrst)"
run_sql -c "NOTIFY pgrst, 'reload schema'; NOTIFY pgrst, 'reload config';" || \
  err "warn: NOTIFY failed — restart the 'rest' container if new columns 404"

# --- Spot-check the columns the Day colour UI writes --------------------------
DAY_COLOUR="$(run_sql -At -c "
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema='public' AND table_name='daily_notes'
    AND column_name IN ('energy_level','productivity_level');")"
if [ "$DAY_COLOUR" = "2" ]; then
  log "✅ daily_notes.energy_level + productivity_level present"
else
  err "⚠️  daily_notes day-colour columns missing (found $DAY_COLOUR/2)"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ] || exit 1
log "Done."
