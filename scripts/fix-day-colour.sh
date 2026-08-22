#!/usr/bin/env bash
# Adds daily_notes.energy_level / productivity_level (the "Day colour" scales)
# to a self-hosted Supabase DB and reloads the PostgREST schema cache.
#
# Usage:
#   SUPABASE_DB_URL="postgresql://postgres:PASS@localhost:5432/postgres" ./scripts/fix-day-colour.sh
#
# Symptom this fixes:
#   "Could not find the 'energy_level' column of 'daily_notes' in the schema cache"
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"
if [[ -z "$DB_URL" && -f .env.local ]]; then
  # `|| true`: under `set -e` a no-match grep in a command substitution would
  # abort this script silently with no output at all.
  DB_URL="$(grep -E '^[[:space:]]*SUPABASE_DB_URL=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"

fi
if [[ -z "$DB_URL" ]]; then
  echo "SUPABASE_DB_URL is not set (and not found in .env.local)." >&2
  exit 1
fi

MIGRATION="supabase/migrations/20260820211737_7d33c0b4-f451-436c-a635-5cc2e361c5cc.sql"
[[ -f "$MIGRATION" ]] || { echo "Missing $MIGRATION — git pull first." >&2; exit 1; }

echo "==> Applying $MIGRATION"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "==> Reloading PostgREST schema cache"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema';"

echo "==> Verifying"
psql "$DB_URL" -At -c "
  select column_name
  from information_schema.columns
  where table_schema='public' and table_name='daily_notes'
    and column_name in ('energy_level','productivity_level')
  order by column_name;"

echo "Done. Reload the Today page and set Energy / Productivity again."
