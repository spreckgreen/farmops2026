## Goal

Add an admin-only **Export encryption key** feature that wraps the server's `VAULT_ENCRYPTION_KEY` with a secret derived from a YubiKey via WebAuthn's FIDO2 `hmac-secret` extension. The downloaded file can be unwrapped on an external Docker host by touching the same YubiKey, producing the byte-identical key needed to decrypt restored data.

## How it works (plain English)

1. Admin enrolls a YubiKey once (WebAuthn credential created with `hmac-secret` enabled; we also store a random per-credential salt).
2. To export: admin clicks **Export**, touches the YubiKey. The browser receives an `hmac-secret` output (deterministic for that key+salt) and uses it as an AES-GCM wrapping key. The server hands the raw `VAULT_ENCRYPTION_KEY` to the browser **only after** verifying the WebAuthn assertion; the browser encrypts it locally and triggers a download.
3. On the Docker host: admin opens a static `unwrap.html` page locally, drops in the exported file, touches the same YubiKey, and gets the plaintext key to paste into `VAULT_ENCRYPTION_KEY`.

The raw key transits the network (TLS) during export but is never persisted client-side in plaintext, and the downloaded file is useless without the physical YubiKey.

## Scope

### Database (one migration)

- `public.vault_key_wrap_credentials` — per-admin enrolled YubiKeys: `user_id`, `credential_id` (bytea unique), `public_key` (bytea), `sign_count` (int), `salt` (bytea, 32 bytes, random per credential), `transports` (text[]), `label` (text), `created_at`, `last_used_at`.
- `public.vault_key_export_audit` — `user_id`, `credential_id`, `action` (`enroll` | `export_started` | `export_completed` | `export_failed`), `user_agent`, `ip`, `detail` (text), `created_at`.
- `public.webauthn_challenges` — short-lived challenges keyed by `user_id` + `purpose` (`enroll` | `export`), `challenge` (bytea), `expires_at`. (Alternative: encrypted cookie via TanStack session — we'll use the table for auditability and simpler cross-tab behavior.)
- All three: GRANT to `authenticated` + `service_role`; RLS scoped to `auth.uid()` and `has_role('admin')`; service_role full.

### Server functions (`src/lib/vault-key-export.functions.ts`)

All gated by `requireSupabaseAuth` + `has_role('admin')`. Every call writes an audit row (success and failure).

- `listEnrolledYubiKeys` — returns `{ id, label, last_used_at, created_at }[]` for the current admin.
- `startEnrollYubiKey({ label })` — generates challenge, returns `PublicKeyCredentialCreationOptions` with `extensions.hmacCreateSecret: true`, `authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }`.
- `finishEnrollYubiKey({ attestation })` — verifies with `@simplewebauthn/server`, stores credential + new random salt, audit `enroll`.
- `deleteEnrolledYubiKey({ id })` — admin can remove a credential.
- `startExportVaultKey({ credentialId })` — generates challenge, returns assertion options with `extensions.hmacGetSecret: { salt1: <stored salt> }`, audit `export_started`.
- `finishExportVaultKey({ assertion })` — verifies assertion. On success, returns `{ vaultKey: <base64 of VAULT_ENCRYPTION_KEY>, keyFingerprint: <sha256 base64> }` over HTTPS. The browser immediately AES-GCM-encrypts `vaultKey` with the hmac-derived wrapping key, builds the export JSON, and discards the plaintext. Audit `export_completed` (or `export_failed`).

Export JSON shape (downloaded as `vault-key-export-<fingerprint8>-<timestamp>.json`):
```
{
  "version": 1,
  "kdf": "webauthn-hmac-secret",
  "credentialId": "<base64url>",
  "salt": "<base64url>",          // same salt used at export time
  "rpId": "<host>",
  "iv": "<base64url>",            // AES-GCM 12 bytes
  "ciphertext": "<base64url>",    // AES-GCM(vaultKey)
  "keyFingerprint": "<base64>",   // SHA-256(vaultKey), so unwrap can verify
  "exportedAt": "<iso>",
  "exportedBy": "<admin email>"
}
```

### Admin UI

New route `src/routes/_authenticated/admin.export-key.tsx` with two cards:
- **Enrolled YubiKeys** — list with labels + last used; "Enroll new YubiKey" (prompts for label, runs WebAuthn create); per-row delete.
- **Export encryption key** — credential picker, "Export" button, shows progress + clear warnings:
  - "Anyone with this file AND your YubiKey can recover the key."
  - "Lose every enrolled YubiKey and this file is unrecoverable — enroll at least two YubiKeys."
  - "Store the file in offline/secure storage; do not commit to git."
- Link to the page from `/admin/restore` and `/admin/export`.

### Unwrap helper (`scripts/unwrap-vault-key/`)

- `unwrap.html` — single static page (no server needed; runs from `file://` or `python3 -m http.server` on the Docker host). Loads the JSON, calls `navigator.credentials.get()` with the stored `credentialId` + `salt` and `hmacGetSecret`, derives the AES-GCM key, decrypts, verifies the fingerprint, and shows the resulting `VAULT_ENCRYPTION_KEY` value with a "Copy" button.
- `README.md` — exact steps for the Docker host operator, including `docker compose` env example.

### Dependencies

- `@simplewebauthn/server` (server functions)
- `@simplewebauthn/browser` (admin UI + unwrap.html via ESM CDN import for the static page)

Both are Worker-compatible (pure JS, no native modules).

### Out of scope

- Rotating `VAULT_ENCRYPTION_KEY` itself.
- Non-FIDO2 YubiKeys (older U2F-only keys lack `hmac-secret` — surfaced as a friendly browser-side error).
- Pushing the key from Lovable Cloud directly to a Docker host over the network (hosted runtime can't reach USB; out by design).

## Verification

- Playwright: sign in as admin → mock authenticator with hmac-secret → enroll → export → assert JSON downloads with all required fields → assert two audit rows (`enroll`, `export_completed`).
- Manual: real YubiKey end-to-end (enroll → export → open `unwrap.html` locally → touch key → output matches the server's `VAULT_ENCRYPTION_KEY`).

## Risks

- Browser/OS support: needs Chrome/Edge/Safari recent + a FIDO2 key with `hmac-secret`. We detect and show a clear unsupported-browser/unsupported-key error.
- Operational: if the admin loses all enrolled YubiKeys, the export file is unrecoverable. UI strongly recommends enrolling two.
