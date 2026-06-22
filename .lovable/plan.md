## Goal

A single backup / restore mechanism that works identically on:

- **Lovable-hosted** (managed Cloud, no `pg_dump`, no DB URL access)
- **Self-hosted Docker** and **Self-hosted Node.js** (same Supabase backend, possibly self-managed)

The same UI, server functions, and file format work in all three cases — no host-specific code paths.

## Scope

In scope (v1):
- Full backup of every `public.*` application table owned by the signed-in user (or all rows for admins).
- Storage bucket file export (manifest only in v1 — file blobs are listed and downloadable, but bucket-to-bucket copy is admin-only).
- Restore from a backup file with merge / replace modes.
- Admin-only access gated by `has_role(auth.uid(), 'admin')`.
- Works through HTTPS — no shell, no direct DB connection — so it's identical on Lovable and self-hosted.

Out of scope (v1):
- Auth users (managed by Supabase Auth — separate API, security-sensitive).
- Schema / migrations (covered by source control + migration files).
- Incremental / scheduled backups (manual on-demand only).
- Bucket file blob restore (manifest restore only; users re-upload).

## Architecture

```text
                       ┌─────────────────────────────┐
                       │   /admin/backup  (UI page)  │
                       │   Download / Restore        │
                       └──────────────┬──────────────┘
                                      │  useServerFn
                ┌─────────────────────┴─────────────────────┐
                ▼                                           ▼
   exportBackup (createServerFn)              importBackup (createServerFn)
   - requireSupabaseAuth                      - requireSupabaseAuth
   - assert admin role                        - assert admin role
   - supabaseAdmin (loaded inside handler)    - supabaseAdmin (loaded inside handler)
   - SELECT * from every whitelisted table    - mode: "merge" (upsert) or "replace" (truncate+insert)
   - return JSON DTO                          - validates schema_version + table_list
```

Backup file format (`bostead-backup-YYYY-MM-DDTHH-MM-SS.json`):

```json
{
  "schema_version": 1,
  "app": "bostead",
  "exported_at": "2026-06-22T14:00:00.000Z",
  "exported_by": "<user-uuid>",
  "host": { "kind": "lovable" | "self-hosted" },
  "tables": {
    "tasks":       [ { ...row }, ... ],
    "projects":    [ ... ],
    "inventory_items": [ ... ],
    "crop_plantings":  [ ... ],
    "...":         [ ... ]
  },
  "storage": {
    "buckets": [ { "name": "...", "objects": [ { "name": "...", "size": 123 } ] } ]
  }
}
```

The whitelist is the 23 known `public.*` data tables (see knowledge), explicitly excluding `user_roles` (managed via admin UI) and `auth.*`.

## Files to add

- `src/lib/backup.functions.ts` — `exportBackup`, `importBackup` server functions (auth + admin-gated, service role loaded inside handler).
- `src/lib/backup.shared.ts` — shared constants: `TABLE_WHITELIST`, `SCHEMA_VERSION`, TS types for the backup envelope.
- `src/routes/admin.backup.tsx` — UI: "Download backup", file-picker + mode-toggle for restore, last-result panel.
- `scripts/backup.sh` and `scripts/backup.ps1` — CLI alternative (self-hosted): hits the same server fn over HTTPS with a bearer token; writes the JSON to disk. Documented in README.
- `README.md` — new "Backup & restore" section covering all three hosting models, with examples.

No DB schema changes. No new tables. No new secrets — uses the existing `SUPABASE_SERVICE_ROLE_KEY`.

## Why this works on Lovable AND self-hosted

| Concern | Lovable-hosted | Self-hosted |
| --- | --- | --- |
| No `pg_dump` available | Avoided — we use Data API via service role | Works either way; we still use Data API for parity |
| No DB URL exposed | N/A — backup runs server-side through HTTPS | N/A — same path |
| Service role key | Already provisioned in `SUPABASE_SERVICE_ROLE_KEY` | Already in `.env` (documented in `.env.example`) |
| Admin auth | `has_role(_, 'admin')` already exists | Same |
| Cross-host portability | Backup JSON has no host-specific IDs except `auth.users` UUIDs | Restore mode `merge` upserts by primary key |

## Restore semantics

Two modes, picked in the UI / CLI flag:

- **`merge`** (default, safe) — upsert each row by primary key; never deletes. Good for migrating between environments.
- **`replace`** — `DELETE FROM <table> WHERE user_id = auth.uid()` (or no filter for admin-wide), then insert. Destructive; confirmation dialog with typed phrase.

Both run inside a single server function call but per-table (Supabase has no cross-table transactions over the Data API). The function returns a `{ table, inserted, updated, skipped, errors[] }[]` report shown in the UI.

## Cross-host equivalence test

After implementation, manually verify:
1. Export from Lovable preview → JSON downloads.
2. Run the Docker quickstart locally against a fresh Supabase project.
3. Restore the JSON via the admin UI in the local container.
4. Row counts match the source for every whitelisted table.

Same JSON file also works via the `scripts/backup.sh restore <file>` CLI on the Node.js self-hosted setup.

## Out-of-the-box guard rails

- Backup endpoint is rate-limited to one call per minute per user (in-memory token bucket inside the server fn) so a leaked admin session cannot dump the DB in a loop.
- Restore requires `admin` role AND a CSRF-style nonce returned by a preceding `prepareRestore` call, expiring after 60 s.
- Backup JSON never contains the service role key, secrets, or raw auth records.
- The UI clearly labels what the backup does and does NOT cover (auth users, schema, storage blobs).

## README additions

A new top-level "Backup & restore" section linked from the Features list, with three subsections — Lovable-hosted, Docker, Node.js — each showing the UI flow and (for self-hosted) the `scripts/backup.sh` / `.ps1` one-liner.
