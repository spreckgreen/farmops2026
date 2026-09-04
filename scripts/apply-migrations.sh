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
# `docker run --rm postgres:16-alpine psql` container. If localhost:5432 is a
# Supavisor pooler (ENOIDENTIFIER), the script automatically runs psql inside
# the self-hosted Compose `db` container and connects over its local socket.
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
#
#   ./scripts/apply-migrations.sh --fix-sql    # Same audit, but ALSO writes a
#                                              # remediation .sql script that
#                                              # re-creates the missing objects,
#                                              # repairs the ledger, and reloads
#                                              # PostgREST. Nothing is executed —
#                                              # review it, then:
#                                              #   psql "$SUPABASE_DB_URL" \
#                                              #     -f migration-remediation-*.sql
#   ./scripts/apply-migrations.sh --fix-sql=/tmp/fix.sql   # choose the path
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
FIX_SQL=""            # --fix-sql[=path]: write a remediation script for the drift
for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    --baseline) BASELINE=1 ;;
    --adopt)    ADOPT=1 ;;
    --verify)   VERIFY=1 ;;
    --fix-sql)  VERIFY=1; FIX_SQL="AUTO" ;;
    --fix-sql=*) VERIFY=1; FIX_SQL="${arg#--fix-sql=}" ;;
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
# NOTE: every lookup ends in `|| true`. Under `set -e` a failing grep inside a
# command substitution kills the script INSTANTLY and SILENTLY — that was the
# cause of "./scripts/apply-migrations.sh --dry-run printed nothing, exit 1".
DB_URL="${SUPABASE_DB_URL:-}"
for f in .env.local .env ../supabase-project/.env "$HOME/supabase-project/.env"; do
  [ -n "$DB_URL" ] && break
  [ -r "$f" ] || continue
  DB_URL="$(grep -E '^[[:space:]]*SUPABASE_DB_URL=' "$f" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
done

# Do not let a copied documentation example override the real self-hosted
# password below. This commonly happens when the example command containing
# literal <PASSWORD> is pasted unchanged into .env.local.
case "$DB_URL" in
  *'<PASSWORD>'*|*'CHANGE_ME'*)
    warn "Ignoring placeholder SUPABASE_DB_URL; deriving the real local connection instead"
    DB_URL=""
    ;;
esac

# Fallback: assemble the URL from a self-hosted Supabase POSTGRES_PASSWORD,
# e.g. POSTGRES_PASSWORD=s3cret -> postgresql://postgres:s3cret@localhost:5432/postgres
if [ -z "$DB_URL" ]; then
  for f in .env.local .env ../supabase-project/.env "$HOME/supabase-project/.env"; do
    pw="$(grep -E '^[[:space:]]*POSTGRES_PASSWORD=' "$f" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
    if [ -n "${pw:-}" ]; then
      port="$(grep -E '^[[:space:]]*POSTGRES_PORT=' "$f" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
      DB_URL="postgresql://postgres:${pw}@localhost:${port:-5432}/postgres"
      printf '\033[1;33m[migrate]\033[0m %s\n' "SUPABASE_DB_URL not set — derived connection from POSTGRES_PASSWORD in $f"
      break
    fi
  done
fi

if [ -z "$DB_URL" ]; then
  err "SUPABASE_DB_URL not set and not found in .env.local / .env — skipping migrations."
  err "  Add one line to .env.local, then re-run this script, e.g.:"
  err '    SUPABASE_DB_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres"'
  err "  The password is POSTGRES_PASSWORD from your self-hosted Supabase .env"
  err "  (typically ~/supabase-project/.env)."
  err "  Managed Supabase (supabase.com) users: run 'supabase db push' instead."
  exit 3   # distinct code so callers can treat 'no DB URL' as non-fatal
fi


# --- Pick a psql -------------------------------------------------------------
PSQL_TARGET=()
PSQL_MODE="url"
HOST_PSQL=0
if command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
  PSQL_TARGET=("$DB_URL")
  HOST_PSQL=1
  log "Using host psql ($(psql --version | awk '{print $3}'))"
elif command -v docker >/dev/null 2>&1; then
  PSQL=(docker run --rm --network host -i postgres:16-alpine psql)
  PSQL_TARGET=("$DB_URL")
  log "Host psql not found — using postgres:16-alpine container (--network host)"
else
  err "Neither psql nor docker available — cannot apply migrations."
  exit 1
fi

run_sql() { "${PSQL[@]}" "${PSQL_TARGET[@]}" -v ON_ERROR_STOP=1 -q "$@"; }

# Run a host SQL file. Whenever psql runs inside a container the host path is
# invisible to it (psql reports "No such file or directory"), so stream the file
# on stdin instead of passing -f. Only a real host psql can read the path.
run_sql_file() {
  local file="$1"; shift
  if [ "$HOST_PSQL" = "1" ]; then
    "${PSQL[@]}" "${PSQL_TARGET[@]}" -v ON_ERROR_STOP=1 -q "$@" -f "$file"
  else
    "${PSQL[@]}" "${PSQL_TARGET[@]}" -v ON_ERROR_STOP=1 -q "$@" <"$file"
  fi
}

run_migration_file() {
  run_sql_file "$1" -1
}

# A standard self-hosted stack often publishes Supavisor—not raw Postgres—on
# localhost:5432. A direct postgres URL then fails with:
#   (ENOIDENTIFIER) no tenant identifier provided
#
# A HARDENED stack (docker-compose.hardening.yml) publishes NOTHING on the host:
# ports 5432/6543/8000/8443 are internal-only, so the same URL fails with:
#   connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused
#
# Both cases are normal, not misconfiguration: use psql INSIDE the Compose `db`
# service. Its local Unix socket bypasses the pooler, works with no published
# port, and keeps the database password out of argv.
CONNECTION_LOG="$(mktemp -t bostead-db-connect.XXXXXX.log)"

# True when the failure is "the host cannot reach a published port", which is the
# expected state on a hardened stack.
db_unreachable_on_host() {
  grep -qiE 'connection refused|could not connect to server|no route to host|connection timed out|could not translate host name|network is unreachable|server closed the connection unexpectedly' "$CONNECTION_LOG"
}
db_is_pooler() {
  grep -q 'ENOIDENTIFIER\|no tenant identifier provided' "$CONNECTION_LOG"
}

find_db_container() {
  local c="${SUPABASE_DB_CONTAINER:-}"
  [ -n "$c" ] || c="$(docker ps --filter 'label=com.docker.compose.service=db' --format '{{.ID}}' 2>/dev/null | head -1 || true)"
  [ -n "$c" ] || c="$(docker ps --filter 'name=supabase-db' --format '{{.ID}}' 2>/dev/null | head -1 || true)"
  printf '%s' "$c"
}

if ! run_sql -At -c "SELECT 1;" >"$CONNECTION_LOG" 2>&1; then
  if { db_is_pooler || db_unreachable_on_host; } && command -v docker >/dev/null 2>&1; then
    if db_is_pooler; then
      REASON="localhost:5432 is the pooler"
    else
      REASON="the database port is not published on the host (hardened stack)"
    fi
    DB_CONTAINER="$(find_db_container)"
    if [ -n "$DB_CONTAINER" ]; then
      PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres)
      PSQL_TARGET=()
      PSQL_MODE="container"
      HOST_PSQL=0
      log "$REASON — using psql inside the self-hosted db container"
      if ! run_sql -At -c "SELECT 1;" >"$CONNECTION_LOG" 2>&1; then
        err "Found the self-hosted db container, but its local PostgreSQL connection failed:"
        sed 's/^/    /' "$CONNECTION_LOG" >&2 || true
        rm -f "$CONNECTION_LOG"
        exit 1
      fi
    else
      err "$REASON, and no running Compose 'db' container was found."
      err "  Start the self-hosted backend (docker compose up -d in ../supabase-project),"
      err "  or name its container explicitly:"
      err "    SUPABASE_DB_CONTAINER=supabase-db ./scripts/apply-migrations.sh"
      rm -f "$CONNECTION_LOG"
      exit 1
    fi
  else
    err "Cannot connect to the database with SUPABASE_DB_URL:"
    sed 's/^/    /' "$CONNECTION_LOG" >&2 || true
    rm -f "$CONNECTION_LOG"
    exit 1
  fi
fi
rm -f "$CONNECTION_LOG"


# --- Ledger ------------------------------------------------------------------
# Needs an owner-level role (the self-hosted `postgres` superuser). A pooled or
# restricted role fails here with "permission denied for database" — that means
# the URL is wrong, not that the migration is bad.
# In --verify mode the run is strictly read-only: don't create anything. If the
# ledger table doesn't exist yet, that's itself reportable drift.
if [ "$VERIFY" -eq 1 ]; then
  if ! run_sql -At -c "SELECT 1 FROM private.applied_migrations LIMIT 1;" >/dev/null 2>&1; then
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

# Emit one `SELECT '<file>','<label>', EXISTS(...);` row for an extracted object.
# All files' checks go into ONE psql invocation — 70 separate round trips to a
# remote Postgres takes minutes; batched it's a single query.
existence_check() {
  local file="$1" kind="$2" schema="$3" name="$4" extra="${5:-}"
  local f s n e
  f="$(sql_lit "$file")"; s="$(sql_lit "$schema")"; n="$(sql_lit "$name")"; e="$(sql_lit "$extra")"
  case "$kind" in
    table)
      printf "SELECT '%s','table %s.%s', EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='%s' AND c.relname='%s' AND c.relkind IN ('r','p','v','m','f'));\n" "$f" "$s" "$n" "$s" "$n" ;;
    index)
      printf "SELECT '%s','index %s.%s', EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='%s' AND c.relname='%s' AND c.relkind='i');\n" "$f" "$s" "$n" "$s" "$n" ;;
    type)
      printf "SELECT '%s','type %s.%s', EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE ns.nspname='%s' AND t.typname='%s');\n" "$f" "$s" "$n" "$s" "$n" ;;
    function)
      printf "SELECT '%s','function %s.%s', EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='%s' AND p.proname='%s');\n" "$f" "$s" "$n" "$s" "$n" ;;
    column)
      printf "SELECT '%s','column %s.%s.%s', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='%s' AND table_name='%s' AND column_name='%s');\n" "$f" "$s" "$n" "$e" "$s" "$n" "$e" ;;
    policy)
      printf "SELECT '%s','policy %s on %s.%s', EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='%s' AND tablename='%s' AND policyname='%s');\n" "$f" "$e" "$s" "$n" "$s" "$n" "$e" ;;
    trigger)
      printf "SELECT '%s','trigger %s on %s.%s', EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE NOT tg.tgisinternal AND ns.nspname='%s' AND c.relname='%s' AND tg.tgname='%s');\n" "$f" "$e" "$s" "$n" "$s" "$n" "$e" ;;
  esac
}

# Probe every migration file against the live schema in a single query.
# Populates:
#   PROBE_TOTAL[file]   objects the file creates that should still exist
#   PROBE_PRESENT[file] how many of them exist
#   PROBE_MISS[file]    newline-separated labels of the missing ones
#   PROBE_SUPER[file]   objects deliberately dropped/renamed by a LATER migration
# Files with no detectable objects get PROBE_TOTAL=0 (treated as unprobeable).
#
# Supersede handling matters: 20260624163956_….sql runs
# `DROP FUNCTION public.has_role(uuid, public.app_role);` (it moved to the
# private schema), so the earlier file that created public.has_role must NOT be
# reported as drift. The rule is: if the last migration to DROP an object comes
# after the last one to CREATE it, that object is expected to be absent.
declare -A PROBE_TOTAL=() PROBE_PRESENT=() PROBE_MISS=() PROBE_SUPER=()
declare -A CREATE_LAST=() DROP_LAST=()
PROBE_FILES=()

probe_all() {
  if [ ! -r "$EXTRACT_AWK" ]; then
    err "Missing $EXTRACT_AWK — git pull, then re-run."
    exit 1
  fi

  local objdir checks res path name idx kind schema oname extra key ck file label exists
  objdir="$(mktemp -d -t bostead-objs.XXXXXX)"
  checks="$(mktemp -t bostead-probe.XXXXXX.sql)"

  # ---- pass 1: extract objects, remember create/drop ordering ----------------
  idx=0
  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    idx=$((idx + 1))
    name="$(basename "$path")"
    awk -f "$EXTRACT_AWK" "$path" >"$objdir/$name.objs"
    while IFS='|' read -r kind schema oname extra; do
      [ -z "${kind:-}" ] && continue
      case "$kind" in
        drop-*) key="${kind#drop-}|$schema|$oname|${extra:-}"; DROP_LAST["$key"]=$idx ;;
        *)      key="$kind|$schema|$oname|${extra:-}";          CREATE_LAST["$key"]=$idx ;;
      esac
    done <"$objdir/$name.objs"
  done

  # ---- pass 2: build the batched existence query -----------------------------
  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    name="$(basename "$path")"
    [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
    PROBE_FILES+=("$name")
    PROBE_TOTAL["$name"]=0
    PROBE_PRESENT["$name"]=0
    PROBE_MISS["$name"]=""
    PROBE_SUPER["$name"]=0
    while IFS='|' read -r kind schema oname extra; do
      [ -z "${kind:-}" ] && continue
      case "$kind" in drop-*) continue ;; esac
      key="$kind|$schema|$oname|${extra:-}"
      if [ -n "${DROP_LAST[$key]:-}" ] && \
         [ "${DROP_LAST[$key]}" -gt "${CREATE_LAST[$key]:-0}" ]; then
        # A later migration removed it on purpose — don't expect it in the schema.
        PROBE_SUPER["$name"]=$(( ${PROBE_SUPER["$name"]} + 1 ))
        continue
      fi
      existence_check "$name" "$kind" "$schema" "$oname" "${extra:-}" >>"$checks"
      PROBE_TOTAL["$name"]=$(( ${PROBE_TOTAL["$name"]} + 1 ))
    done <"$objdir/$name.objs"
  done
  rm -rf "$objdir"

  if [ ! -s "$checks" ]; then
    rm -f "$checks"
    return 0
  fi

  log "Probing $(wc -l <"$checks" | tr -d ' ') schema object(s) in one query…"
  res="$(mktemp -t bostead-probe-res.XXXXXX.txt)"
  if ! run_sql_file "$checks" -At -F '|' >"$res" 2>&1; then
    err "Schema probe query failed:"
    sed 's/^/    /' "$res" >&2 || true
    rm -f "$checks" "$res"
    exit 1
  fi

  while IFS='|' read -r file label exists; do
    [ -z "${file:-}" ] && continue
    if [ "$exists" = "t" ]; then
      PROBE_PRESENT["$file"]=$(( ${PROBE_PRESENT["$file"]:-0} + 1 ))
    else
      PROBE_MISS["$file"]="${PROBE_MISS["$file"]:-}${label}"$'\n'
    fi
  done <"$res"

  rm -f "$checks" "$res"
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
#   SKIPPED     nothing probeable in the file (data-only INSERT, GRANT, DO block)
#   ORPHAN      a ledger row with no matching file on disk (older/renamed repo)
#
# Exit status: 0 when there is no drift, partial, or orphan; 1 otherwise.
if [ "$VERIFY" -eq 1 ]; then
  log "Verify mode: comparing private.applied_migrations against the live schema"
  LEDGER="$(run_sql -At -c "SELECT filename FROM private.applied_migrations ORDER BY filename;" 2>/dev/null || true)"

  probe_all

  V_OK=0; V_DRIFT=0; V_UNREC=0; V_PENDING=0; V_PARTIAL=0; V_SKIPPED=0
  DRIFT_FILES=(); UNREC_FILES=(); PARTIAL_FILES=()

  for name in "${PROBE_FILES[@]}"; do
    total=${PROBE_TOTAL["$name"]:-0}
    present=${PROBE_PRESENT["$name"]:-0}
    missing="${PROBE_MISS["$name"]:-}"
    recorded=0
    printf '%s\n' "$LEDGER" | grep -Fxq "$name" && recorded=1

    super=${PROBE_SUPER["$name"]:-0}
    sup_note=""
    [ "$super" -gt 0 ] && sup_note=", $super superseded later"

    if [ "$total" -eq 0 ]; then
      V_SKIPPED=$((V_SKIPPED + 1))
      printf '  \033[0;90mSKIPPED   \033[0m %s (no objects left to check%s, ledger=%s)\n' \
        "$name" "$sup_note" "$([ "$recorded" -eq 1 ] && echo recorded || echo pending)"
    elif [ "$present" -eq "$total" ]; then
      if [ "$recorded" -eq 1 ]; then
        V_OK=$((V_OK + 1))
        printf '  \033[0;32mOK        \033[0m %s (%s/%s objects%s)\n' "$name" "$present" "$total" "$sup_note"
      else
        V_UNREC=$((V_UNREC + 1)); UNREC_FILES+=("$name")
        printf '  \033[0;33mUNRECORDED\033[0m %s (%s/%s objects present, not in ledger)\n' "$name" "$present" "$total"
      fi
    elif [ "$recorded" -eq 1 ]; then
      V_DRIFT=$((V_DRIFT + 1)); DRIFT_FILES+=("$name")
      printf '  \033[1;31mDRIFT     \033[0m %s (recorded applied, only %s/%s objects exist)\n' "$name" "$present" "$total"
      printf '%s' "$missing" | head -8 | sed '/^$/d;s/^/               missing: /'
    elif [ "$present" -eq 0 ]; then
      V_PENDING=$((V_PENDING + 1))
      printf '  \033[0;36mPENDING   \033[0m %s (0/%s objects — will run on next apply)\n' "$name" "$total"
    else
      V_PARTIAL=$((V_PARTIAL + 1)); PARTIAL_FILES+=("$name")
      printf '  \033[0;33mPARTIAL   \033[0m %s (%s/%s objects — half-applied)\n' "$name" "$present" "$total"
      printf '%s' "$missing" | head -8 | sed '/^$/d;s/^/               missing: /'
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
  log "  OK         $V_OK   (ledger + schema agree)"
  log "  DRIFT      $V_DRIFT   (recorded applied, objects missing)"
  log "  PARTIAL    $V_PARTIAL   (half-applied, not recorded)"
  log "  UNRECORDED $V_UNREC   (present in schema, missing from ledger)"
  log "  PENDING    $V_PENDING   (not applied yet — expected)"
  log "  SKIPPED    $V_SKIPPED   (nothing probeable)"
  log "  ORPHAN     $V_ORPHAN   (ledger rows with no file)"
  log "  day-colour columns: ${DC:-0}/2"

  rc=0
  if [ "$V_DRIFT" -ne 0 ]; then
    err ""
    err "❌ DRIFT: the ledger claims these ran, but their objects are gone:"
    for f in "${DRIFT_FILES[@]}"; do err "     • $f"; done
    err "   Re-apply one explicitly (each file is transactional):"
    err "     ./scripts/apply-migrations.sh --force --only=${DRIFT_FILES[0]}"
    rc=1
  fi
  if [ "$V_PARTIAL" -ne 0 ]; then
    warn ""
    warn "⚠️  PARTIAL: half-applied migrations — inspect before re-running:"
    for f in "${PARTIAL_FILES[@]}"; do warn "     • $f"; done
    warn "   Re-run one with: ./scripts/apply-migrations.sh --only=<file>"
    rc=1
  fi
  if [ "$V_UNREC" -ne 0 ]; then
    warn ""
    warn "⚠️  UNRECORDED: schema has them, ledger doesn't. Seed the ledger with:"
    warn "     ./scripts/apply-migrations.sh --adopt"
  fi
  if [ "$V_ORPHAN" -ne 0 ]; then
    warn ""
    warn "⚠️  ORPHAN ledger rows (usually a renamed/removed migration):"
    for f in "${ORPHAN_FILES[@]}"; do warn "     • $f"; done
    rc=1
  fi
  if [ "$rc" -eq 0 ] && [ "$V_UNREC" -eq 0 ]; then
    log "✅ No drift: private.applied_migrations matches the live schema."
  fi

  # --- Remediation script generation (--fix-sql) -------------------------------
  # Still read-only against the DB: we only WRITE a .sql file the operator can
  # review and run. One section per drift class, in dependency-safe order.
  if [ -n "$FIX_SQL" ]; then
    if [ "$FIX_SQL" = "AUTO" ]; then
      FIX_SQL="migration-remediation-$(date -u +%Y%m%dT%H%M%SZ).sql"
    fi

    if [ "$V_DRIFT" -eq 0 ] && [ "$V_PARTIAL" -eq 0 ] && \
       [ "$V_UNREC" -eq 0 ] && [ "$V_ORPHAN" -eq 0 ] && [ "${DC:-0}" = "2" ]; then
      log ""
      log "Nothing to remediate — no script written."
    else
      : >"$FIX_SQL"
      {
        echo "-- ============================================================================"
        echo "-- Remediation script generated by scripts/apply-migrations.sh --fix-sql"
        echo "-- Generated (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "-- Database:        ${PGDATABASE:-postgres} @ ${PGHOST:-<from SUPABASE_DB_URL>}"
        echo "--"
        echo "-- Audit at generation time:"
        echo "--   OK $V_OK | DRIFT $V_DRIFT | PARTIAL $V_PARTIAL | UNRECORDED $V_UNREC"
        echo "--   PENDING $V_PENDING | SKIPPED $V_SKIPPED | ORPHAN $V_ORPHAN"
        echo "--   day-colour columns: ${DC:-0}/2"
        echo "--"
        echo "-- HOW TO RUN (review first — this file changes your schema):"
        echo "--   psql \"\$SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f $(basename "$FIX_SQL")"
        echo "-- Then re-audit:"
        echo "--   ./scripts/apply-migrations.sh --verify"
        echo "--"
        echo "-- Each section is its own transaction, so a failure in one section leaves"
        echo "-- the earlier ones committed and tells you exactly where to look."
        echo "--"
        echo "-- IDEMPOTENT: every statement below is safe to run more than once. If some"
        echo "-- drift was already fixed by hand, the matching statements simply do nothing"
        echo "-- instead of failing with \"already exists\". You can re-run the whole file."
        echo "-- ============================================================================"

        echo
        echo "-- Ensure the ledger itself exists before we touch it."
        echo "CREATE SCHEMA IF NOT EXISTS private;"
        echo "CREATE TABLE IF NOT EXISTS private.applied_migrations ("
        echo "  filename   text PRIMARY KEY,"
        echo "  applied_at timestamptz NOT NULL DEFAULT now()"
        echo ");"
        echo

        if [ "$V_DRIFT" -ne 0 ] || [ "$V_PARTIAL" -ne 0 ]; then
          echo "-- ----------------------------------------------------------------------------"
          echo "-- SECTION 1 — DRIFT / PARTIAL: re-create objects that are missing."
          echo "-- The migration file is the source of truth, so its SQL is inlined — but"
          echo "-- every statement is first rewritten to be idempotent by"
          echo "-- scripts/lib/idempotent-sql.awk:"
          echo "--   CREATE TABLE/INDEX/SCHEMA/SEQUENCE/EXTENSION -> ... IF NOT EXISTS"
          echo "--   CREATE FUNCTION/VIEW                         -> CREATE OR REPLACE"
          echo "--   CREATE TRIGGER/POLICY                        -> DROP IF EXISTS first"
          echo "--   ALTER TABLE ... ADD COLUMN                   -> ADD COLUMN IF NOT EXISTS"
          echo "--   ALTER TABLE ... ADD CONSTRAINT               -> DROP CONSTRAINT IF EXISTS first"
          echo "--   CREATE TYPE/DOMAIN/ROLE                      -> DO block ignoring duplicate_*"
          echo "-- So a PARTIAL file is safe: statements for objects that already exist are"
          echo "-- no-ops, and the whole script can be run twice with the same result."
          echo "-- Anything that CANNOT be made idempotent automatically (an INSERT with no"
          echo "-- ON CONFLICT) is left in place with a '-- REVIEW:' comment above it."
          echo "-- ----------------------------------------------------------------------------"
          for f in "${DRIFT_FILES[@]:-}" "${PARTIAL_FILES[@]:-}"; do
            [ -z "${f:-}" ] && continue
            echo
            echo "-- ==== $f =============================================="
            echo "-- missing objects detected:"
            printf '%s' "${PROBE_MISS["$f"]:-}" | sed '/^$/d;s/^/--   /'
            echo "BEGIN;"
            awk -v indent="  " -f scripts/lib/idempotent-sql.awk "supabase/migrations/$f"
            echo "  INSERT INTO private.applied_migrations (filename) VALUES ('$f')"
            echo "    ON CONFLICT (filename) DO NOTHING;"
            echo "COMMIT;"
          done
          echo
        fi


        if [ "${DC:-0}" != "2" ]; then
          echo "-- ----------------------------------------------------------------------------"
          echo "-- SECTION 2 — day-colour canary: the columns the Daily view writes."
          echo "-- Missing these is what produces:"
          echo "--   Could not find the 'energy_level' column of 'daily_notes'"
          echo "-- ----------------------------------------------------------------------------"
          echo "BEGIN;"
          echo "  ALTER TABLE public.daily_notes"
          echo "    ADD COLUMN IF NOT EXISTS energy_level       smallint,"
          echo "    ADD COLUMN IF NOT EXISTS productivity_level smallint;"
          echo "COMMIT;"
          echo
        fi

        if [ "$V_UNREC" -ne 0 ]; then
          echo "-- ----------------------------------------------------------------------------"
          echo "-- SECTION 3 — UNRECORDED: objects already exist, the ledger just doesn't"
          echo "-- know. Recording them stops these files from being replayed on deploy."
          echo "-- Equivalent to: ./scripts/apply-migrations.sh --adopt"
          echo "-- ----------------------------------------------------------------------------"
          echo "BEGIN;"
          echo "  INSERT INTO private.applied_migrations (filename) VALUES"
          n=${#UNREC_FILES[@]}; i=0
          for f in "${UNREC_FILES[@]}"; do
            i=$((i + 1))
            if [ "$i" -lt "$n" ]; then echo "    ('$f'),"; else echo "    ('$f')"; fi
          done
          echo "  ON CONFLICT (filename) DO NOTHING;"
          echo "COMMIT;"
          echo
        fi

        if [ "$V_ORPHAN" -ne 0 ]; then
          echo "-- ----------------------------------------------------------------------------"
          echo "-- SECTION 4 — ORPHAN ledger rows: recorded, but no such file in"
          echo "-- supabase/migrations/. Usually a renamed or deleted migration."
          echo "-- Only run this if you are sure the file is gone for good — deleting the"
          echo "-- row makes the ledger forget it was ever applied."
          echo "-- ----------------------------------------------------------------------------"
          echo "BEGIN;"
          echo "  DELETE FROM private.applied_migrations WHERE filename IN ("
          n=${#ORPHAN_FILES[@]}; i=0
          for f in "${ORPHAN_FILES[@]}"; do
            i=$((i + 1))
            if [ "$i" -lt "$n" ]; then echo "    '$f',"; else echo "    '$f'"; fi
          done
          echo "  );"
          echo "COMMIT;"
          echo
        fi

        echo "-- ----------------------------------------------------------------------------"
        echo "-- FINAL — make PostgREST pick up the new schema, otherwise the app keeps"
        echo "-- returning \"column not found in the schema cache\" until it restarts."
        echo "-- ----------------------------------------------------------------------------"
        echo "NOTIFY pgrst, 'reload schema';"
        echo
        echo "-- Post-run check:"
        echo "--   ./scripts/apply-migrations.sh --verify   # expect DRIFT 0, PARTIAL 0, ORPHAN 0"
      } >>"$FIX_SQL"

      echo
      log "📝 Remediation script written: $FIX_SQL ($(wc -l <"$FIX_SQL" | tr -d ' ') lines)"
      log "   Review it, then apply with:"
      log "     psql \"\$SUPABASE_DB_URL\" -v ON_ERROR_STOP=1 -f $FIX_SQL"
      log "   Re-audit with:"
      log "     ./scripts/apply-migrations.sh --verify"
    fi
  elif [ "$rc" -ne 0 ] || [ "$V_UNREC" -ne 0 ]; then
    log ""
    log "Generate a ready-to-run repair script with:"
    log "  ./scripts/apply-migrations.sh --fix-sql"
  fi

  # Read-only mode: never apply, never NOTIFY, never heal.
  exit "$rc"
fi

ADOPTED=0
ADOPT_PENDING=0
ADOPT_UNKNOWN=0

if [ "$ADOPT" -eq 1 ]; then
  log "Adopt mode: matching ${ONLY:-all} migration(s) against the live schema"
  ADOPT_APPLIED="$(run_sql -At -c "SELECT filename FROM private.applied_migrations;" 2>/dev/null || true)"

  probe_all

  for name in "${PROBE_FILES[@]}"; do
    if printf '%s\n' "$ADOPT_APPLIED" | grep -Fxq "$name"; then
      continue   # already in the ledger
    fi
    total=${PROBE_TOTAL["$name"]:-0}
    present=${PROBE_PRESENT["$name"]:-0}

    if [ "$total" -eq 0 ]; then
      # Nothing recognisable to probe (data-only INSERT/UPDATE, GRANT-only, a DO
      # block, or a DROP ... IF EXISTS). Never guess — leave pending; these are
      # written idempotently so re-running them is safe.
      warn "adopt: $name — no detectable objects → left pending (will run)"
      ADOPT_UNKNOWN=$((ADOPT_UNKNOWN + 1))
    elif [ "$present" -eq "$total" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        log "adopt: $name — $present/$total objects present → would record (dry run)"
      else
        record_applied "$name"
        log "adopt: $name — $present/$total objects present → recorded as applied"
      fi
      ADOPTED=$((ADOPTED + 1))
    else
      log "adopt: $name — $present/$total objects present → left pending"
      printf '%s' "${PROBE_MISS["$name"]:-}" | head -5 | sed '/^$/d;s/^/                   missing: /'
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

# A hand-built database can already contain a LATER migration while an earlier,
# ledger-less hardening migration remains pending. Replaying the earlier file can
# then fail because the later migration deliberately dropped the policy/function
# it tries to ALTER or GRANT. Treat that as satisfied only when:
#   1. every ERROR is a supported "does not exist" policy/function error;
#   2. a later migration explicitly drops that exact object; and
#   3. that later migration is already recorded in the ledger.
# This is intentionally narrower than accepting arbitrary missing objects.
is_later_drop_applied() {
  local failed_name="$1" wanted="$2" path later
  for path in $(ls -1 supabase/migrations/*.sql 2>/dev/null | sort); do
    later="$(basename "$path")"
    [[ "$later" > "$failed_name" ]] || continue
    is_applied "$later" || continue
    if awk -f "$EXTRACT_AWK" "$path" | grep -Fxq "$wanted"; then
      return 0
    fi
  done
  return 1
}

is_benign_superseded_missing() {
  local out="$1" failed_name="$2" line parsed policy table schema fn saw_error=0
  while IFS= read -r line; do
    [[ "$line" =~ ERROR: ]] || continue
    saw_error=1

    parsed="$(printf '%s\n' "$line" | sed -n 's/.*policy "\([^"]*\)" for table "\([^"]*\)" does not exist.*/\1|\2/p')"
    if [ -n "$parsed" ]; then
      policy="${parsed%%|*}"
      table="${parsed#*|}"
      is_later_drop_applied "$failed_name" "drop-policy|public|$table|$policy" || return 1
      continue
    fi

    parsed="$(printf '%s\n' "$line" | sed -n 's/.*function \([A-Za-z_][A-Za-z0-9_]*\)\.\([A-Za-z_][A-Za-z0-9_]*\)(.*) does not exist.*/\1|\2/p')"
    if [ -n "$parsed" ]; then
      schema="${parsed%%|*}"
      fn="${parsed#*|}"
      is_later_drop_applied "$failed_name" "drop-function|$schema|$fn" || return 1
      continue
    fi

    return 1
  done <"$out"
  [ "$saw_error" -eq 1 ]
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
  if run_migration_file "$path" >"$OUT" 2>&1; then
    record_applied "$name"
    APPLIED=$((APPLIED + 1))
  elif [ "$STRICT" -eq 0 ] && is_benign_already_exists "$OUT"; then
    # Objects are already present — this migration is effectively in the DB.
    warn "  already present in DB (marking applied): $(grep -m1 -E '^(psql:.*)?ERROR:' "$OUT" | sed 's/^psql:[^ ]* //')"
    record_applied "$name"
    SATISFIED=$((SATISFIED + 1))
  elif [ "$STRICT" -eq 0 ] && is_benign_superseded_missing "$OUT" "$name"; then
    # A later, already-applied migration intentionally removed the missing
    # target. Replaying this historical hardening step is unnecessary.
    warn "  superseded by a later applied migration (marking applied): $(grep -m1 -E '^(psql:.*)?ERROR:' "$OUT" | sed 's/^psql:[^ ]* //')"
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
