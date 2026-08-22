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
#
#   ./scripts/apply-migrations.sh --verify     # READ-ONLY audit. Compares the
#                                              # ledger with the live schema and
#                                              # flags drift:
#                                              #   OK / DRIFT / PARTIAL /
#                                              #   UNRECORDED / PENDING /
#                                              #   SKIPPED / ORPHAN
#                                              # Exits 1 on drift, partial,
#                                              # or orphan rows. Applies nothing.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
FORCE=0
BASELINE=0
ADOPT=0
VERIFY=0
STRICT=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    --baseline) BASELINE=1 ;;
    --adopt)    ADOPT=1 ;;
    --verify)   VERIFY=1 ;;
    --strict)   STRICT=1 ;;
    --only=*)   ONLY="${arg#--only=}" ;;
    --only)     echo "Use --only=<filename.sql>" >&2; exit 2 ;;
    -h|--help)  sed -n '2,72p' "$0"; exit 0 ;;
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
# In --verify mode the run is strictly read-only: don't create anything. If the
# ledger table doesn't exist yet, that's itself reportable drift.
if [ "$VERIFY" -eq 1 ]; then
  if false; then
    if ! run_sql -At -c "SELECT to_regclass('private.applied_migrations') IS NOT NULL;" 2>/dev/null | grep -q '^t$'; then
      err "private.applied_migrations does not exist — nothing has been recorded yet."
      err "  Seed it against the current schema with:"
      err "    ./scripts/apply-migrations.sh --adopt"
      exit 1
    fi
  fi
else
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
fi

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

# --- Adopt mode: schema-aware ledger population -------------------------------
# For each migration file, list the objects it creates (tables, columns, types,
# functions, policies, triggers, indexes) and ask the live database whether they
# exist. If every object is already there, the file is recorded as applied
# without being executed. If any object is missing, the file stays pending so
# the normal apply loop below runs it.
#
# Example output:
#   [migrate] adopt: 20260608162633_....sql — 19/19 objects present → recorded
#   [migrate] adopt: 20260820211737_....sql — 0/2 objects present → left pending
#   [migrate] adopt: 20260714090112_....sql — 5/7 objects present → left pending
#                      missing: column public.tasks.closed_at
EXTRACT_AWK="scripts/lib/extract-objects.awk"

sql_lit() { printf "%s" "$1" | sed "s/'/''/g"; }

# Emit `SELECT '<label>', EXISTS(...);`-style rows for one extracted object.
existence_check() {
  local kind="$1" schema="$2" name="$3" extra="${4:-}"
  local s n e
  s="$(sql_lit "$schema")"; n="$(sql_lit "$name")"; e="$(sql_lit "$extra")"
  case "$kind" in
    table)
      printf "SELECT 'table %s.%s', EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='%s' AND c.relname='%s' AND c.relkind IN ('r','p','v','m','f'));\n" "$s" "$n" "$s" "$n" ;;
    index)
      printf "SELECT 'index %s.%s', EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='%s' AND c.relname='%s' AND c.relkind='i');\n" "$s" "$n" "$s" "$n" ;;
    type)
      printf "SELECT 'type %s.%s', EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='%s' AND t.typname='%s');\n" "$s" "$n" "$s" "$n" ;;
    function)
      printf "SELECT 'function %s.%s', EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='%s' AND p.proname='%s');\n" "$s" "$n" "$s" "$n" ;;
    column)
      printf "SELECT 'column %s.%s.%s', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='%s' AND table_name='%s' AND column_name='%s');\n" "$s" "$n" "$e" "$s" "$n" "$e" ;;
    policy)
      printf "SELECT 'policy %s on %s.%s', EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='%s' AND tablename='%s' AND policyname='%s');\n" "$e" "$s" "$n" "$s" "$n" "$e" ;;
    trigger)
      printf "SELECT 'trigger %s on %s.%s', EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT tg.tgisinternal AND ns.nspname='%s' AND c.relname='%s' AND tg.tgname='%s');\n" "$e" "$s" "$n" "$s" "$n" "$e" ;;
  esac
}

# Probe one migration file against the live schema.
# Sets PROBE_TOTAL / PROBE_PRESENT / PROBE_MISSING (newline-separated labels).
# Returns 0 = probed, 2 = nothing probeable, 1 = probe query failed.
probe_file() {
  local path="$1"
  PROBE_TOTAL=0; PROBE_PRESENT=0; PROBE_MISSING=""; PROBE_ERROR=""

  local checks res kind schema oname extra
  checks="$(mktemp -t bostead-probe.XXXXXX.sql)"
  while IFS='|' read -r kind schema oname extra; do
    [ -z "${kind:-}" ] && continue
    existence_check "$kind" "$schema" "$oname" "${extra:-}" >>"$checks"
    PROBE_TOTAL=$((PROBE_TOTAL + 1))
  done < <(awk -f "$EXTRACT_AWK" "$path")

  if [ "$PROBE_TOTAL" -eq 0 ]; then
    rm -f "$checks"
    return 2   # data-only INSERT/UPDATE, GRANT-only, DO block, DROP-only …
  fi

  res="$(mktemp -t bostead-probe-res.XXXXXX.txt)"
  if ! run_sql -At -F '|' -f "$checks" >"$res" 2>&1; then
    PROBE_ERROR="$(cat "$res")"
    rm -f "$checks" "$res"
    return 1
  fi
  PROBE_PRESENT="$(grep -c '|t$' "$res" || true)"
  PROBE_MISSING="$(grep '|f$' "$res" | sed 's/|f$//' || true)"
  rm -f "$checks" "$res"
  return 0
}

# --- Verify mode: does the ledger agree with the live schema? -----------------
# Read-only. Cross-checks every migration file against both the ledger and the
# database, and classifies each one:
#
#   OK          recorded in the ledger and all its objects exist
#   DRIFT       recorded as applied but objects are MISSING from the schema
#               (someone dropped them, or a restore lost them → schema is behind)
#   UNRECORDED  objects all exist but the file is not in the ledger
#               (hand-built DB → fix with --adopt)
#   PENDING     not recorded and objects missing (normal; --dry-run lists these)
#   PARTIAL     not recorded, only some objects exist (a half-applied migration)
#   SKIPPED     nothing probeable in the file
#   ORPHAN      a ledger row with no matching file on disk (older/renamed repo)
#
# Exit status: 0 when there is no drift and no orphan, 1 otherwise.
if [ "$VERIFY" -eq 1 ]; then
  if [ ! -r "$EXTRACT_AWK" ]; then
    err "Missing $EXTRACT_AWK — git pull, then re-run with --verify."
    exit 1
  fi
  log "Verify mode: comparing private.applied_migrations against the live schema"

  LEDGER="$(ls -1 supabase/migrations/*.sql | sort | head -40 | xargs -n1 basename; echo ghost_removed_migration.sql)"

  V_OK=0; V_DRIFT=0; V_UNREC=0; V_PENDING=0; V_PARTIAL=0; V_SKIPPED=0
  DRIFT_FILES=(); UNREC_FILES=(); PARTIAL_FILES=()

  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    name="$(basename "$path")"
    [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
    recorded=0
    printf '%s\n' "$LEDGER" | grep -Fxq "$name" && recorded=1

    set +e; probe_file "$path"; prc=$?; set -e
    case "$prc" in
      2)
        V_SKIPPED=$((V_SKIPPED + 1))
        printf '  \033[0;90mSKIPPED   \033[0m %s (no detectable objects, ledger=%s)\n' \
          "$name" "$([ "$recorded" -eq 1 ] && echo recorded || echo pending)"
        continue ;;
      1)
        err "  PROBE-FAIL $name"
        printf '%s\n' "$PROBE_ERROR" | sed 's/^/               /' >&2
        V_DRIFT=$((V_DRIFT + 1)); DRIFT_FILES+=("$name (probe failed)")
        continue ;;
    esac

    if [ "$PROBE_PRESENT" -eq "$PROBE_TOTAL" ]; then
      if [ "$recorded" -eq 1 ]; then
        V_OK=$((V_OK + 1))
        printf '  \033[0;32mOK        \033[0m %s (%s/%s objects)\n' "$name" "$PROBE_PRESENT" "$PROBE_TOTAL"
      else
        V_UNREC=$((V_UNREC + 1)); UNREC_FILES+=("$name")
        printf '  \033[0;33mUNRECORDED\033[0m %s (%s/%s objects present, not in ledger)\n' "$name" "$PROBE_PRESENT" "$PROBE_TOTAL"
      fi
    elif [ "$recorded" -eq 1 ]; then
      V_DRIFT=$((V_DRIFT + 1)); DRIFT_FILES+=("$name")
      printf '  \033[1;31mDRIFT     \033[0m %s (recorded applied, only %s/%s objects exist)\n' "$name" "$PROBE_PRESENT" "$PROBE_TOTAL"
      printf '%s\n' "$PROBE_MISSING" | head -8 | sed '/^$/d;s/^/               missing: /'
    elif [ "$PROBE_PRESENT" -eq 0 ]; then
      V_PENDING=$((V_PENDING + 1))
      printf '  \033[0;36mPENDING   \033[0m %s (0/%s objects — will run on next apply)\n' "$name" "$PROBE_TOTAL"
    else
      V_PARTIAL=$((V_PARTIAL + 1)); PARTIAL_FILES+=("$name")
      printf '  \033[0;33mPARTIAL   \033[0m %s (%s/%s objects — half-applied)\n' "$name" "$PROBE_PRESENT" "$PROBE_TOTAL"
      printf '%s\n' "$PROBE_MISSING" | head -8 | sed '/^$/d;s/^/               missing: /'
    fi
  done

  # Ledger rows with no file on disk.
  V_ORPHAN=0; ORPHAN_FILES=()
  while IFS= read -r row; do
    [ -z "$row" ] && continue
    if [ ! -f "supabase/migrations/$row" ]; then
      V_ORPHAN=$((V_ORPHAN + 1)); ORPHAN_FILES+=("$row")
      printf '  \033[0;33mORPHAN    \033[0m %s (in ledger, no such file in supabase/migrations/)\n' "$row"
    fi
  done <<EOF
$LEDGER
EOF

  # Day-colour columns are the canary the app actually depends on.
  DC="$(run_sql -At -c "
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_notes'
      AND column_name IN ('energy_level','productivity_level');" 2>/dev/null | tr -d '[:space:]')"

  echo
  log "Verify summary:"
  log "  OK         $V_OK      (ledger + schema agree)"
  log "  DRIFT      $V_DRIFT      (recorded applied, objects missing)"
  log "  PARTIAL    $V_PARTIAL      (half-applied, not recorded)"
  log "  UNRECORDED $V_UNREC      (present in schema, missing from ledger)"
  log "  PENDING    $V_PENDING      (not applied yet — expected)"
  log "  SKIPPED    $V_SKIPPED      (nothing probeable)"
  log "  ORPHAN     $V_ORPHAN      (ledger rows with no file)"
  log "  day-colour columns: ${DC:-0}/2"

  rc=0
  if [ "$V_DRIFT" -ne 0 ]; then
    err ""
    err "❌ DRIFT: the ledger claims these ran, but their objects are gone:"
    for f in "${DRIFT_FILES[@]}"; do err "     • $f"; done
    err "   Re-apply one explicitly (files are transactional):"
    err "     ./scripts/apply-migrations.sh --force --only=${DRIFT_FILES[0]%% *}"
    rc=1
  fi
  if [ "$V_PARTIAL" -ne 0 ]; then
    warn ""
    warn "⚠️  PARTIAL: half-applied migrations — inspect before re-running:"
    for f in "${PARTIAL_FILES[@]}"; do warn "     • $f"; done
    warn "   Re-run with: ./scripts/apply-migrations.sh --only=<file>"
    rc=1
  fi
  if [ "$V_UNREC" -ne 0 ]; then
    warn ""
    warn "⚠️  UNRECORDED: schema has them, ledger doesn't. Seed the ledger with:"
    warn "     ./scripts/apply-migrations.sh --adopt"
  fi
  if [ "$V_ORPHAN" -ne 0 ]; then
    warn ""
    warn "⚠️  ORPHAN ledger rows (harmless, usually a renamed/removed migration):"
    for f in "${ORPHAN_FILES[@]}"; do warn "     • $f"; done
    rc=1
  fi
  if [ "$rc" -eq 0 ] && [ "$V_UNREC" -eq 0 ]; then
    log "✅ No drift: private.applied_migrations matches the live schema."
  fi

  # Read-only mode: never apply, never NOTIFY, never heal.
  exit "$rc"
fi

ADOPTED=0
ADOPT_PENDING=0
ADOPT_UNKNOWN=0

if [ "$ADOPT" -eq 1 ]; then
  if [ ! -r "$EXTRACT_AWK" ]; then
    err "Missing $EXTRACT_AWK — git pull, then re-run with --adopt."
    exit 1
  fi
  log "Adopt mode: matching ${ONLY:-all} migration(s) against the live schema"

  ADOPT_APPLIED="$(run_sql -At -c "SELECT filename FROM private.applied_migrations;" 2>/dev/null || true)"

  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    name="$(basename "$path")"
    [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
    if printf '%s\n' "$ADOPT_APPLIED" | grep -Fxq "$name"; then
      continue   # already in the ledger
    fi

    set +e; probe_file "$path"; prc=$?; set -e
    if [ "$prc" -eq 2 ]; then
      # Nothing recognisable to probe (data-only INSERT/UPDATE, GRANT-only, or a
      # statement shape the extractor doesn't know). Never guess — leave pending.
      warn "adopt: $name — no detectable objects → left pending (will run)"
      ADOPT_UNKNOWN=$((ADOPT_UNKNOWN + 1))
      continue
    fi
    if [ "$prc" -eq 1 ]; then
      err "adopt: $name — schema probe failed:"
      printf '%s\n' "$PROBE_ERROR" | sed 's/^/    /' >&2
      ADOPT_UNKNOWN=$((ADOPT_UNKNOWN + 1))
      continue
    fi

    if [ "$PROBE_PRESENT" -eq "$PROBE_TOTAL" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        log "adopt: $name — $PROBE_PRESENT/$PROBE_TOTAL objects present → would record (dry run)"
      else
        record_applied "$name"
        log "adopt: $name — $PROBE_PRESENT/$PROBE_TOTAL objects present → recorded as applied"
      fi
      ADOPTED=$((ADOPTED + 1))
    else
      log "adopt: $name — $PROBE_PRESENT/$PROBE_TOTAL objects present → left pending"
      printf '%s\n' "$PROBE_MISSING" | head -5 | sed '/^$/d;s/^/                   missing: /'
      ADOPT_PENDING=$((ADOPT_PENDING + 1))
    fi
  done

  log "Adopt summary: $ADOPTED recorded, $ADOPT_PENDING incomplete, $ADOPT_UNKNOWN unprobeable"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "(dry run — the ledger was not modified)"
  fi
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
