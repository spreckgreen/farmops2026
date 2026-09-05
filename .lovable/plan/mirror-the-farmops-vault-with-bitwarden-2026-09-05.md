# Mirror the FarmOps vault with Bitwarden

Goal: every secret in the FarmOps vault also lives in your Bitwarden vault, and a change made in either place shows up in the other.

## The one constraint that shapes everything

Bitwarden's Password Manager (personal/Families) has no server API that a hosted app can call — only the local `bw` command-line tool that runs on a machine you control and unlocks your vault there. Secrets Manager has a real API, but that is a Business add-on you don't have.

So the mirror runs as a small **bridge** on your own network — the same shape as the existing peer-sync tick script. Nothing about your Bitwarden master password or your unlocked vault ever reaches FarmOps' servers; the bridge reaches out to FarmOps, not the other way round.

```text
Bitwarden cloud  <--bw CLI-->  bridge on your LAN  <--HTTPS + bridge token-->  FarmOps
```

## What you will end up with

- A "Bitwarden mirror" page under Admin, showing: connected or not, last run time, how many entries are in sync, and anything waiting on your decision.
- A `FarmOps` folder in Bitwarden holding one item per vault entry (secure note, value in the hidden field, FarmOps title and notes carried over).
- Entries you add or edit in Bitwarden appear in the FarmOps vault on the next run, and vice versa.
- A per-entry history line so you can see which side last changed a value.

## Conflict handling

Both sides can change, so the mirror never guesses:

- Changed on one side only: copied to the other side.
- Changed on both sides since the last run: **nothing is overwritten**. The entry is flagged on the Bitwarden mirror page with both timestamps, and you pick which one wins.
- Deleted on one side: never auto-deleted on the other. It is flagged as "removed in Bitwarden / removed in FarmOps" for you to confirm.

## Things worth knowing up front

- To push a secret into Bitwarden, FarmOps has to decrypt it first. The six entries that are currently unreadable (`VAULT_ENCRYPTION_KEY`, the four AI-engine ones, `CUSTOM_AI_API_KEY`) cannot be mirrored until the original key turns up or you re-enter their values. They will be listed as "cannot read — not mirrored" rather than silently skipped.
- The bridge has to run somewhere that stays on — the same box that runs your Home Assistant bridge is a natural home. If it's off, the mirror simply pauses and resumes.
- Bitwarden becoming a second copy of these secrets is the point, but it does mean the values exist in two places; the mirror is opt-in per scope (your personal entries, shared entries, or both).

## Technical detail

**Schema (new migration)**
- `vault_bitwarden_links`: `vault_secret_id` (nullable, FK), `bw_item_id`, `bw_folder_id`, `scope`, `owner_user_id`, `last_pushed_fingerprint`, `last_pulled_fingerprint`, `last_synced_at`, `status` (`in_sync` | `conflict` | `push_pending` | `pull_pending` | `unreadable` | `orphan`), `conflict_detail jsonb`. Owner-scoped RLS + explicit GRANTs, admin-only writes.
- `vault_bitwarden_runs`: run log — started/finished, counts pushed/pulled/conflicted/skipped, error text. Insert via service role from the bridge endpoint.
- `vault_bitwarden_config`: enabled scopes, folder name, bridge token fingerprint, rotation columns, mirroring paused flag.

Fingerprints are SHA-256 of the plaintext value+notes, never the value itself — that is how "changed since last run" is decided without storing plaintext twice.

**Bridge endpoints** — server routes under `src/routes/api/public/vault-bridge/` (public prefix, auth enforced inside the handler against a bridge token, same pattern and rotation helpers as `verify_peer_sync_cron_secret`):
- `POST /pull-plan` — bridge sends the digest of every Bitwarden item in the folder (`bw_item_id`, revision date, value fingerprint). FarmOps answers with what to push, what it wants pulled, and what is conflicted.
- `POST /push-batch` — FarmOps hands over decrypted values for items the bridge should write into Bitwarden. Response-only, bounded batch size.
- `POST /pull-batch` — bridge submits plaintext for items FarmOps asked for; sealed with the current `VAULT_ENCRYPTION_KEY` via the existing `seal()` and written to `vault_secrets`.
- `POST /run-complete` — closes the run log entry.

**Server functions** (`src/lib/vault-bitwarden.functions.ts`, admin-gated by `requireVaultAdmin`): status, link list, resolve-conflict (`keep_farmops` | `keep_bitwarden`), confirm-delete, pause/resume, rotate bridge token.

**Bridge script** (`scripts/vault-bitwarden-bridge.sh` + `docs/VAULT_BITWARDEN_SETUP.md`): `bw login`/`bw unlock` with `BW_SESSION` held in memory, `bw list items --folderid`, `bw create`/`bw edit`, `bw sync`. Talks to FarmOps with the bridge token. Runs on a timer (default 10 minutes).

**UI**: `/admin/vault-bitwarden`, linked from the vault page banner and the key-change console. Shows config, run log, link table with status chips, conflict resolution controls, and token rotation.

**Tests**: fingerprint/conflict decision matrix, endpoint auth (missing/expired token → 401), scope filtering, unreadable-row handling, delete never cascading automatically.

## Not in scope

- No Bitwarden master password or session token is ever stored in FarmOps.
- No automatic deletion on either side.
- Bitwarden's own key rotation and account recovery stay entirely in Bitwarden.
