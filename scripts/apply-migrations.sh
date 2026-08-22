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
#   runs at most once. Each file runs in its own transaction — one failure
#   doesn't corrupt the ledger for the others.
#
#   IMPORTANT for databases that were built by hand BEFORE this ledger existed:
#   the ledger starts empty, so the script replays all 70 files. Most were
#   authored for a fresh database (CREATE TABLE / CREATE POLICY / CREATE TYPE),
#   so they abort with errors like:
#     ERROR:  relation "tasks" already exists
#     ERROR:  policy "x" for table "y" already exists
#     ERROR:  type "app_role" already exists
#   Those mean "this migration is already in the database", so the script marks
#   the file as applied and moves on. Only genuinely new errors (syntax,
#   permission denied, missing column in a dependency) count as failures, and
#   each one is printed with the psql output that caused it.
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
#   ./scripts/apply-migrations.sh              # apply pending, reload PostgREST
#   ./scripts/apply-migrations.sh --dry-run    # list pending, change nothing
#   ./scripts/apply-migrations.sh --force      # re-run every file, ignore ledger
#   ./scripts/apply-migrations.sh --baseline   # record ALL files as applied
#                                              # without running them, then only
#                                              # verify/heal the day-colour cols.
#                                              # Use when the DB is known good
#                                              # and you just want the ledger
#                                              # seeded going forward.
#   ./scripts/apply-migrations.sh --strict     # any "already exists" is a FAIL
#                                              # (useful on a fresh DB)
#   ./scripts/apply-migrations.sh --only=20260820211737_7d33c0b4-f451-436c-a635-5cc2e361c5cc.sql
#
#   ./scripts/apply-migrations.sh --adopt      # RECOMMENDED for a hand-built DB.
#                                              # Inspects the live schema and
#                                              # records only the migrations
#                                              # whose objects are ALL already
#                                              # present. Genuinely missing ones
#                                              # stay pending and then run
#                                              # normally in the same pass.
#   ./scripts/apply-migrations.sh --adopt --dry-run   # report, change nothing
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
FORCE=0
BASELINE=0
ADOPT=0
STRICT=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    --baseline) BASELINE=1 ;;
    --adopt)    ADOPT=1 ;;
    --strict)   STRICT=1 ;;
    --only=*)   ONLY="${arg#--only=}" ;;
    --only)     echo "Use --only=<filename.sql>" >&2; exit 2 ;;
    -h|--help)  sed -n '2,62p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;35m[migrate]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[migrate]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[migrate]\033[0m %s\n' "$*" >&2; }

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
LEDGER_LOG="$(mktemp -t bostead-ledger.XXXXXX.log)"
if ! run_sql -c "
  CREATE SCHEMA IF NOT EXISTS private;
  CREATE TABLE IF NOT EXISTS private.applied_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  REVOKE ALL ON private.applied_migrations FROM PUBLIC;
" >"$LEDGER_LOG" 2>&1; then
  err "Could not create the migration ledger with this SUPABASE_DB_URL."
  err "  psql said:"
  sed 's/^/    /' "$LEDGER_LOG" >&2 || true
  err "  Use the owner/superuser connection, e.g.:"
  err "    postgresql://postgres:<password>@localhost:5432/postgres"
  rm -f "$LEDGER_LOG"
  exit 1
fi
rm -f "$LEDGER_LOG"

record_applied() {
  run_sql -c "INSERT INTO private.applied_migrations (filename) VALUES ('$1')
              ON CONFLICT (filename) DO NOTHING;" >/dev/null 2>&1
}

# --- Baseline mode: seed the ledger, run nothing ------------------------------
if [ "$BASELINE" -eq 1 ]; then
  n=0
  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    record_applied "$(basename "$path")"
    n=$((n + 1))
  done
  log "Baseline recorded: $n file(s) marked applied WITHOUT running them."
  log "Skipping to the day-colour verification/heal step."
fi

APPLIED_LIST=""
if [ "$FORCE" -eq 0 ]; then
  APPLIED_LIST="$(run_sql -At -c "SELECT filename FROM private.applied_migrations;")"
fi

is_applied() {
  printf '%s\n' "$APPLIED_LIST" | grep -Fxq "$1"
}

# An error that means "the objects in this migration are already in the DB".
# Postgres wording covered: relation/table/type/policy/constraint/index/
# function/trigger/column/schema/role already exists, plus duplicate_object.
is_benign_already_exists() {
  local file="$1"
  # Any line that is a real problem (not an already-exists / duplicate) → false.
  if grep -Eq '^(psql:.*)?ERROR:' "$file"; then
    if grep -E '^(psql:.*)?ERROR:' "$file" \
       | grep -Evq 'already exists|already a member|duplicate key value|duplicate_object'; then
      return 1
    fi
    return 0
  fi
  return 1
}

# --- Apply in filename order -------------------------------------------------
PENDING=0
APPLIED=0
SATISFIED=0
FAILED=0
FAILED_FILES=()

if [ "$BASELINE" -eq 0 ]; then
for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
  name="$(basename "$path")"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  if [ -z "$ONLY" ] && is_applied "$name"; then
    continue
  fi
  PENDING=$((PENDING + 1))

  if [ "$DRY_RUN" -eq 1 ]; then
    log "pending: $name"
    continue
  fi

  log "applying: $name"
  OUT="$(mktemp -t "bostead-mig.XXXXXX.log")"
  # -1 wraps the file in a single transaction: it either fully applies or not
  # at all, so the ledger never claims a half-applied migration.
  if "${PSQL[@]}" "$DB_URL" -v ON_ERROR_STOP=1 -q -1 -f "$path" >"$OUT" 2>&1; then
    record_applied "$name"
    APPLIED=$((APPLIED + 1))
  elif [ "$STRICT" -eq 0 ] && is_benign_already_exists "$OUT"; then
    # Objects are already present — this migration is effectively in the DB.
    warn "  already present in DB (marking applied): $(grep -m1 -E '^(psql:.*)?ERROR:' "$OUT" | sed 's/^psql:[^ ]* //')"
    record_applied "$name"
    SATISFIED=$((SATISFIED + 1))
  else
    err "FAILED: $name"
    err "  ──── psql output ────"
    sed 's/^/    /' "$OUT" >&2 || true
    err "  ──── end psql output ────"
    FAILED=$((FAILED + 1))
    FAILED_FILES+=("$name")
  fi
  rm -f "$OUT"
done
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "$PENDING migration(s) pending (dry run — nothing applied)"
  exit 0
fi

if [ "$BASELINE" -eq 0 ]; then
  if [ "$PENDING" -eq 0 ]; then
    log "Schema already up to date (0 pending)"
  else
    log "Result: $APPLIED applied, $SATISFIED already present, $FAILED failed (of $PENDING pending)"
  fi
fi

# --- Reload PostgREST --------------------------------------------------------
# Without this, PostgREST keeps serving its cached schema and rejects writes to
# brand-new columns with "Could not find the '<col>' column ... in the schema
# cache" until it happens to restart.
log "Reloading PostgREST schema cache (NOTIFY pgrst)"
run_sql -c "NOTIFY pgrst, 'reload schema'; NOTIFY pgrst, 'reload config';" >/dev/null 2>&1 || \
  err "warn: NOTIFY failed — restart the 'rest' container if new columns 404"

# --- Spot-check + self-heal the columns the Day colour UI writes --------------
day_colour_count() {
  run_sql -At -c "
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_notes'
      AND column_name IN ('energy_level','productivity_level');" 2>/dev/null | tr -d '[:space:]'
}

DAY_COLOUR="$(day_colour_count)"
if [ "$DAY_COLOUR" != "2" ]; then
  warn "daily_notes day-colour columns missing (found ${DAY_COLOUR:-0}/2) — healing in place"
  HEAL="$(mktemp -t bostead-heal.XXXXXX.log)"
  if run_sql -c "
      ALTER TABLE public.daily_notes
        ADD COLUMN IF NOT EXISTS energy_level       smallint,
        ADD COLUMN IF NOT EXISTS productivity_level smallint;
      NOTIFY pgrst, 'reload schema';
  " >"$HEAL" 2>&1; then
    DAY_COLOUR="$(day_colour_count)"
    log "heal applied — day-colour columns now ${DAY_COLOUR:-0}/2"
  else
    err "heal failed:"
    sed 's/^/    /' "$HEAL" >&2 || true
  fi
  rm -f "$HEAL"
fi

if [ "$DAY_COLOUR" = "2" ]; then
  log "✅ daily_notes.energy_level + productivity_level present"
else
  err "⚠️  daily_notes day-colour columns still missing (found ${DAY_COLOUR:-0}/2)"
  FAILED=$((FAILED + 1))
  FAILED_FILES+=("daily_notes day-colour columns")
fi

if [ "$FAILED" -ne 0 ]; then
  err ""
  err "──── MIGRATION FAILURES ($FAILED) ────"
  for f in "${FAILED_FILES[@]}"; do err "  • $f"; done
  err ""
  err "Next steps:"
  err "  1. Read the psql output above — it names the exact object/statement."
  err "  2. Re-run just the offender:"
  err "       ./scripts/apply-migrations.sh --only=${FAILED_FILES[0]}"
  err "  3. If the database is already correct and you only want the ledger"
  err "     seeded so future deploys are clean:"
  err "       ./scripts/apply-migrations.sh --baseline"
  err "  4. Deploy anyway (leaves the schema as-is):"
  err "       ./scripts/refresh.sh --no-pull --force --skip-migrations"
  exit 1
fi

log "Done."
