# Safe VAULT_ENCRYPTION_KEY rotation

Rotate the vault encryption key without losing data by re-encrypting every entry, using a temporary secondary key so decrypts keep working while the roll is in progress.

## How it works

The vault gains a second, optional env var — `VAULT_ENCRYPTION_KEY_OLD` — used only as a fallback when decrypting. `seal()` always uses the primary `VAULT_ENCRYPTION_KEY`; `open()` tries the primary first, then falls back to the old. This lets you roll the primary key at any time without a maintenance window: entries encrypted with the old key remain readable until they're rewritten.

Concrete rollover, admin-driven:

```text
1. Generate new key          openssl rand -hex 32   → NEW
2. .env.local:
     VAULT_ENCRYPTION_KEY=<NEW>
     VAULT_ENCRYPTION_KEY_OLD=<CURRENT>
   Restart the stack.
3. In /admin, click "Rotate vault key → Re-encrypt now".
   Server decrypts every row (trying NEW then OLD), re-seals with NEW,
   writes ciphertext/iv/tag back. Progress + errors reported.
4. When the run reports 0 rows remaining on OLD, remove
   VAULT_ENCRYPTION_KEY_OLD from .env.local and restart.
```

Rows carry a `key_version` column so the rotation function can target
"anything not on the current version" and resume safely if interrupted.
Rotation is idempotent — re-running does nothing when everything is on
the current version.

## Files touched

- `src/lib/vault-crypto.server.ts` — resolve *primary* and *fallback* keys; `open()` retries with fallback on `OperationError`; export new `sealWithKey`/`openWithKey` helpers and a `getKeyFingerprint()` used by the UI/status.
- `supabase/migrations/…_vault_key_version.sql` — add `key_version smallint not null default 1` to `vault_secrets` (+ index on `key_version`). Backfill = 1.
- `src/lib/vault-rotation.functions.ts` (new) — admin-only server functions:
  - `getRotationStatus()` → `{ primaryFingerprint, oldFingerprint | null, currentVersion, rowsTotal, rowsOnCurrent, rowsOnOther }`
  - `rotateVaultKey({ batchSize })` → streams progress: reads a batch where `key_version <> currentVersion`, decrypts (primary then fallback), re-seals with primary, updates row + bumps `key_version`. Returns `{ processed, failed, remaining, errors: [{id, message}] }`. Advisory-locked (`pg_try_advisory_lock`) so two admins can't run it concurrently.
- `src/lib/vault-status.functions.ts` — extend to include `oldKeyPresent: boolean` + fingerprints so the banner can nudge "remove OLD now".
- `src/routes/admin.vault-rotation.tsx` (new) — admin page with:
  - Current state (primary fingerprint, OLD present y/n, rows-per-version bar).
  - "Re-encrypt now" button that calls `rotateVaultKey` in a loop until `remaining === 0`, showing progress + per-row error list.
  - Explicit step-by-step instructions with the exact `.env.local` edits and `refresh.sh` command for before/after.
- `src/components/vault.tsx` — extend the existing banner: when `oldKeyPresent && rowsOnOther > 0`, show an amber "rotation in progress — finish it" notice linking to the admin page; when `oldKeyPresent && rowsOnOther === 0`, show "safe to remove VAULT_ENCRYPTION_KEY_OLD".
- `README.md` + `docs/SELF_HOSTING.md` + `.env.example` — document `VAULT_ENCRYPTION_KEY_OLD` and the four-step rollover.

## Safety properties

- No data loss window: decrypt path always accepts old *and* new keys during rollover.
- Interruptible: rotation writes row-by-row and tracks `key_version`; a crash/reload resumes exactly where it stopped.
- Idempotent: rerunning after completion is a no-op.
- Concurrency-safe: Postgres advisory lock prevents overlapping runs.
- Admin-only: `rotateVaultKey`/status funcs check `has_role(auth.uid(),'admin')`.
- Never logs plaintext or key material; only 8-char SHA-256 fingerprints appear in the UI.
- Missing OLD key with un-rotated rows fails loudly with a clear message ("row <id> encrypted with a key not currently loaded — set VAULT_ENCRYPTION_KEY_OLD to the previous key and retry") instead of corrupting rows.

## Out of scope

- Automatic env-var editing. The server can't safely rewrite `.env.local` on the host; the admin does that manually between steps.
- Key escrow / per-user keys. Rotation targets the single server-wide key.
