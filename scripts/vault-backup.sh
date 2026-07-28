#!/usr/bin/env bash
# Backup / restore the encrypted vault_secrets table from a self-hosted
# Postgres (Supabase). Ciphertext-only — safe to store next to snapshots,
# useless without VAULT_ENCRYPTION_KEY on the target instance.
#
# Usage:
#   ./scripts/vault-backup.sh export [OUT_FILE]
#   ./scripts/vault-backup.sh restore IN_FILE [--replace]
#
# Env:
#   DB_CONTAINER   docker container running the Supabase postgres
#                  (default: supabase-db)
#   PGUSER         (default: postgres)
#   PGDATABASE     (default: postgres)
#
# Example:
#   ./scripts/vault-backup.sh export ~/backups/vault-$(date +%F).json
#   ./scripts/vault-backup.sh restore ~/backups/vault-2026-07-28.json
#   ./scripts/vault-backup.sh restore ~/backups/vault-2026-07-28.json --replace

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

CMD="${1:-}"
if [[ -z "$CMD" ]]; then
  sed -n '2,20p' "$0"
  exit 1
fi

psql_exec() {
  docker exec -i "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" "$@"
}

case "$CMD" in
  export)
    OUT="${2:-vault-backup-$(date -u +%Y%m%dT%H%M%SZ).json}"
    echo "→ exporting vault_secrets from container '$DB_CONTAINER' to $OUT"
    psql_exec -At -c "
      SELECT jsonb_build_object(
        'app', 'bostead',
        'kind', 'vault',
        'version', 1,
        'generated_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
        'generated_by', 'cli',
        'count', (SELECT count(*) FROM public.vault_secrets),
        'rows', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM public.vault_secrets v), '[]'::jsonb)
      );
    " > "$OUT"
    COUNT=$(psql_exec -At -c "SELECT count(*) FROM public.vault_secrets;")
    echo "✓ exported $COUNT rows to $OUT"
    ;;

  restore)
    IN="${2:-}"
    MODE="merge"
    if [[ "${3:-}" == "--replace" ]]; then MODE="replace"; fi
    if [[ -z "$IN" || ! -f "$IN" ]]; then
      echo "restore requires an input file"; exit 1
    fi
    echo "→ restoring $IN into container '$DB_CONTAINER' (mode: $MODE)"

    # Sanity-check header before touching the table.
    HEAD=$(head -c 200 "$IN")
    if ! grep -q '"kind":"vault"' <<<"$HEAD" && ! grep -q '"kind": "vault"' <<<"$HEAD"; then
      echo "✗ file does not look like a Bostead vault backup"; exit 1
    fi

    # Copy file into container and stream it into psql via a temp table.
    docker cp "$IN" "$DB_CONTAINER":/tmp/vault-backup.json

    if [[ "$MODE" == "replace" ]]; then
      psql_exec -c "TRUNCATE public.vault_secrets;"
    fi

    psql_exec <<'SQL'
      CREATE TEMP TABLE _vault_import (doc jsonb);
      \copy _vault_import(doc) FROM PROGRAM 'cat /tmp/vault-backup.json'

      INSERT INTO public.vault_secrets (
        id, scope, owner_user_id, created_by, title,
        value_ciphertext, value_iv, value_tag,
        notes_ciphertext, notes_iv, notes_tag,
        key_version, created_at, updated_at
      )
      SELECT
        (r->>'id')::uuid,
        r->>'scope',
        NULLIF(r->>'owner_user_id','')::uuid,
        (r->>'created_by')::uuid,
        r->>'title',
        r->>'value_ciphertext',
        r->>'value_iv',
        r->>'value_tag',
        NULLIF(r->>'notes_ciphertext',''),
        NULLIF(r->>'notes_iv',''),
        NULLIF(r->>'notes_tag',''),
        COALESCE((r->>'key_version')::smallint, 1),
        COALESCE((r->>'created_at')::timestamptz, now()),
        COALESCE((r->>'updated_at')::timestamptz, now())
      FROM _vault_import, jsonb_array_elements(doc->'rows') AS r
      ON CONFLICT (id) DO UPDATE SET
        scope             = EXCLUDED.scope,
        owner_user_id     = EXCLUDED.owner_user_id,
        created_by        = EXCLUDED.created_by,
        title             = EXCLUDED.title,
        value_ciphertext  = EXCLUDED.value_ciphertext,
        value_iv          = EXCLUDED.value_iv,
        value_tag         = EXCLUDED.value_tag,
        notes_ciphertext  = EXCLUDED.notes_ciphertext,
        notes_iv          = EXCLUDED.notes_iv,
        notes_tag         = EXCLUDED.notes_tag,
        key_version       = EXCLUDED.key_version,
        updated_at        = EXCLUDED.updated_at;
SQL

    docker exec "$DB_CONTAINER" rm -f /tmp/vault-backup.json || true
    COUNT=$(psql_exec -At -c "SELECT count(*) FROM public.vault_secrets;")
    echo "✓ vault_secrets now has $COUNT rows"
    ;;

  *)
    echo "unknown command: $CMD"; exit 1;;
esac
