## Goal

Add a vault-backed env layer so app-level secrets (Ghost, Rachio webhook, future third-party keys) can live in `vault_secrets` instead of `.env` / docker-compose, while bootstrap secrets stay in the environment.

## Scope

**In the vault layer:** `GHOST_API_URL`, `GHOST_ADMIN_API_KEY`, `RACHIO_WEBHOOK_SECRET`, any future third-party API key.

**Stays in process.env (bootstrap tier):** `VAULT_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `SUPABASE_DB_URL`. These are required to *reach* and *decrypt* the vault — they cannot live inside it.

## Changes

### 1. Schema — add `env_key` to `vault_secrets`
Migration adds a nullable `env_key text` column with a partial unique index (`env_key IS NOT NULL`), so each env var maps to at most one shared vault row. Only Shared-scope rows participate; personal rows ignore the column.

### 2. Server helper — `src/lib/server-env.server.ts`
Exports `getServerEnv(name)`:
1. Check in-memory cache (60s TTL).
2. If miss, query `vault_secrets` (admin client) where `scope='shared'` and `env_key=name`.
3. Decrypt with existing `open()` from `vault-crypto.server`.
4. Fall back to `process.env[name]` if no row found.
5. Cache the result.

Also exports `invalidateServerEnv(name?)` so the UI can bust the cache after a vault edit.

### 3. Wire existing call sites
Replace `process.env.GHOST_API_URL`, `process.env.GHOST_ADMIN_API_KEY`, `process.env.RACHIO_WEBHOOK_SECRET` reads inside `src/lib/ghost.functions.ts` and `src/routes/api/public/webhooks/rachio.ts` with `await getServerEnv(...)`. No other files change — `vault-crypto.server.ts` still reads `VAULT_ENCRYPTION_KEY` directly from `process.env` (bootstrap).

### 4. UI — Vault editor
Add an optional **"Expose as environment variable"** field to the Shared-scope vault editor in `src/components/vault.tsx`. Empty = normal secret. Filled (e.g. `GHOST_ADMIN_API_KEY`) = readable via `getServerEnv`. List view shows an `ENV` badge on rows with `env_key` set. Saving/updating/deleting any `env_key` row calls a server fn that invalidates the cache.

### 5. Docs
Update `README.md` and `.env.example`:
- Document the three-tier model (bootstrap env / vault-backed app secrets / per-user secrets).
- List which vars **must** remain in env and which can migrate to the vault.
- Note the 60-second cache and how to force refresh.

## Technical notes (skip if not interested)

- Cache is per-process; on multi-instance deploys each instance refreshes independently within 60s — acceptable for config-style secrets.
- `getServerEnv` is async; existing sync `process.env.X` reads at module scope are left alone (they're bootstrap or build-time). Only handler-body reads migrate.
- RLS: shared vault rows are already readable by all signed-in users; `env_key` doesn't change that. The admin client bypasses RLS for the env lookup path, which is fine because it runs only in server handlers.
- No change to encryption format, key wrap/export flow, or YubiKey unwrap.

## Out of scope

- Migrating `SUPABASE_*` or `VAULT_ENCRYPTION_KEY` into the vault (impossible — bootstrap paradox).
- Migrating `VITE_*` client-visible vars (inlined at build time).
- Multi-region cache invalidation / pub-sub (60s TTL is the contract).
