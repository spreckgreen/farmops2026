# Bostead Disaster Recovery Plan

Complete backup and restore runbook. Covers both deployment targets:

- **Lovable Cloud** — managed backend (database, auth, storage, secrets)
- **Self-hosted VPS** — Docker Compose stack with self-hosted Supabase + Ollama

Keep a printed or offline copy of Part 1 (the master key section). Everything
else can be rebuilt; the master key cannot.

---

## Part 0 — Recovery objectives

| Item | Target |
| --- | --- |
| RPO (max acceptable data loss) | 24 h (nightly DB dump) |
| RTO (time to restore service) | 2 h self-hosted, 30 min Lovable Cloud |
| Backup retention | 30 daily, 12 monthly, 1 yearly |
| Offsite copy | Yes — encrypted archive off the VPS (e.g. Backblaze B2, S3, external disk) |

---

## Part 1 — What must be backed up

Seven areas. A backup is only complete when all seven are covered.

| # | Area | What it holds | Where it lives | How to back up |
| --- | --- | --- | --- | --- |
| 1 | **Master encryption key** | `VAULT_ENCRYPTION_KEY` — 64 hex chars, seals every row in `public.vault_secrets` | Server env / secret store only (never in the DB) | Reveal + copy to password manager (see 1.1) |
| 2 | **Database** | All farm data: tasks, notes, inventory, BOM, maintenance, weather, vault rows, `auth.users` | Postgres | `pg_dump` (see 2.1 / 2.2) |
| 3 | **Environment config** | `.env`, `.env.local`, `docker-compose.override.yml`, `CUSTOM_AI_*`, Supabase URLs/keys | VPS filesystem / Lovable secret store | Encrypted copy of env files (see 3) |
| 4 | **Source code** | The app itself, migrations in `supabase/migrations/` | Git remote | `git push` — verify remote is current |
| 5 | **App-level snapshot** | Portable JSON export of user data (`/admin/export`) | Downloaded file | Monthly, plus before risky changes |
| 6 | **Integration credentials** | Rachio, Tempest, Ghost, AI engine API keys | Encrypted in `public.vault_secrets` (covered by #2 **only if** #1 survives) | Also record originals in password manager |
| 7 | **Storage objects** | Uploaded reference docs / images, if any buckets exist | Supabase storage | `supabase storage` sync or volume copy (see 7) |

### 1.1 Backing up the master key

1. Sign in as an admin.
2. Go to **Admin → Encrypted secret metadata** (`/admin/vault-secrets`).
3. In the **Master key reveal** card, enter a reason (written to `activity_log`).
4. Click **Reveal master key**, type `REVEAL`, then **Show key**.
5. Copy the 64-hex value into:
   - your password manager, entry name `BOSTEAD VAULT_ENCRYPTION_KEY`, and
   - an offline copy (paper in a safe, or a second hardware-backed store).
6. Click **Hide**.

Example shape (not a real key):

```
VAULT_ENCRYPTION_KEY=8f2b47c9a1d0e35648bb9f7c2a4d1e0f3c5b8a7691d2e4f6a0b3c5d7e9f1a2b34
```

Verify the copy: paste it into `/admin/vault-rotation` → the fingerprint shown
next to the current key must match what the page reports as active.

### 2.1 Database backup — self-hosted VPS

```bash
cd /opt/bostead                      # your compose directory
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

docker compose exec -T db pg_dump \
  -U postgres -d postgres \
  --clean --if-exists --no-owner --no-privileges \
  > "backups/bostead-db-$STAMP.sql"

gzip "backups/bostead-db-$STAMP.sql"
sha256sum "backups/bostead-db-$STAMP.sql.gz" > "backups/bostead-db-$STAMP.sql.gz.sha256"
```

Encrypt before shipping offsite:

```bash
gpg --symmetric --cipher-algo AES256 "backups/bostead-db-$STAMP.sql.gz"
# then upload the .gpg file to your offsite target
```

Automate nightly with cron (`crontab -e`):

```cron
15 3 * * * cd /opt/bostead && ./scripts/vault-backup.sh >> /var/log/bostead-backup.log 2>&1
```

### 2.2 Database backup — Lovable Cloud

Managed backups run automatically; you still want your own copy:

1. Go to **Admin → Export data** (`/admin/export`).
2. Choose **Full export** (all tables) and download the JSON snapshot.
3. Optionally use the YubiKey-protected export for an encrypted archive.
4. Store the file with the same retention as #2.1.

The snapshot includes `vault_secrets` rows in ciphertext — useless without the
master key, which is why Part 1.1 comes first.

### 3 Environment config backup

```bash
cd /opt/bostead
tar czf - .env .env.local docker-compose.override.yml 2>/dev/null \
  | gpg --symmetric --cipher-algo AES256 -o "backups/bostead-env-$(date -u +%Y%m%d).tar.gz.gpg"
```

Never commit these; confirm with:

```bash
./scripts/verify-env-gitignore.sh
```

Record the following values in your password manager as plain notes, because
they are needed before the app can boot at all:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` (self-hosted Supabase)
- `VAULT_ENCRYPTION_KEY`
- `SUPABASE_URL` / `VITE_SUPABASE_URL` and publishable key
- `RACHIO_WEBHOOK_SECRET`

### 4 Code backup

```bash
git status --short          # expect clean
git push origin main        # verify remote has the latest migrations
git log --oneline -1
```

Confirm `supabase/migrations/` is committed — recovery replays these.

### 7 Storage objects

If buckets exist:

```bash
# self-hosted: copy the storage volume
docker compose stop storage
tar czf "backups/bostead-storage-$(date -u +%Y%m%d).tar.gz" -C /var/lib/docker/volumes/bostead_storage/_data .
docker compose start storage
```

On Lovable Cloud, download bucket contents from the app pages that reference
them, or via the storage API.

### Weekly backup verification

A backup you have not restored is a hypothesis. Once a month:

1. Restore the newest dump into a scratch database (see 12).
2. Run `./scripts/apply-migrations.sh --verify` against it.
3. Confirm row counts for `tasks`, `daily_notes`, `inventory_items`, `vault_secrets`.

---

## Part 2 — Recovery

### Recovery decision tree

```text
Is the master key available?
├── No  → vault secrets are lost. Recover everything else, then
│         re-enter integration keys from your password manager
│         and purge unrecoverable rows in /admin/vault-rotation.
└── Yes → full recovery possible.

Which environment?
├── Lovable Cloud   → steps 8-11
└── Self-hosted VPS → steps 12-18
```

### Lovable Cloud recovery

**8. Restore the code.** Reconnect the Git repo (or re-fork the project) and
confirm `supabase/migrations/` matches your last known-good commit.

**9. Restore schema.** Apply any migrations the fresh backend is missing, then
open `/admin/schema` and `/health/schema` — both must report no missing objects.

**10. Restore data.** Go to `/admin/restore`, upload the JSON snapshot from
step 2.2. Enable **Debug mode** if parsing fails; the restore rewrites row
ownership to the signed-in user where applicable.

**11. Restore secrets.** Re-add runtime secrets (`VAULT_ENCRYPTION_KEY`,
`TEMPEST_API_TOKEN`, `RACHIO_WEBHOOK_SECRET`, `GHOST_*`, `LOVABLE_API_KEY`).
Then open `/admin/vault-secrets` — every row should show **Current key**. Any
row showing a stale fingerprint gets fixed at `/admin/vault-rotation` →
**Re-encrypt with current key**.

### Self-hosted VPS recovery

**12. Prepare the host.**

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git gnupg
sudo usermod -aG docker "$USER"   # re-login after this
git clone <your-remote> /opt/bostead
cd /opt/bostead
./scripts/host-preflight.sh
```

**13. Restore env files.**

```bash
gpg --decrypt backups/bostead-env-YYYYMMDD.tar.gz.gpg | tar xzf - -C /opt/bostead
./scripts/check-env.sh        # must pass with no placeholder values
```

**14. Bring up the database only.**

```bash
docker compose up -d db
docker compose exec db pg_isready -U postgres    # wait for "accepting connections"
```

**15. Load the dump.**

```bash
gunzip -c backups/bostead-db-20260823T031500Z.sql.gz \
  | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

**16. Reconcile the schema.**

```bash
./scripts/apply-migrations.sh            # applies anything the dump predates
./scripts/apply-migrations.sh --verify   # must report no drift
```

If `--verify` reports drift, use `--fix-sql` to generate remediation SQL and
review it before applying. Use `--adopt` only when you have confirmed the
object already exists in the restored database.

**17. Start the full stack.**

```bash
docker compose up -d
docker compose ps                 # all services healthy
./scripts/healthcheck.sh
docker compose logs -f app        # watch for the startup banner
```

**18. Restore AI + integrations.**

```bash
docker compose exec ollama ollama pull qwen2.5:14b-instruct   # or your chosen model
```

Then in the app: `/admin/ai-engines` → **Test connection** for each configured
engine slot (local, ollama_cloud, lovable, other_cloud).

### 19. Post-recovery verification checklist

| Check | How |
| --- | --- |
| App renders | Load `/` and sign in at `/auth` |
| Schema complete | `/health/schema` and `./scripts/apply-migrations.sh --verify` |
| Vault decrypts | `/vault` and `/admin/ai-engines` load values without decrypt errors |
| Key fingerprints current | `/admin/vault-secrets` shows **Current key** on every row |
| Day window correct | Today view shows `America/New_York` and the expected day window |
| Tasks intact | `/tasks` open/done counts match pre-incident expectations |
| Weather | Today's note contains a Weather block with humidity and feels-like |
| Irrigation | `/irrigation` lists Rachio controllers and zones |
| Maintenance | `/service-scheduling` renders both dated and usage-based entries |
| AI works | Run a weekly report and a manual generation test |
| Webhooks | Re-register the Rachio webhook against the new public URL |
| Backups resume | Confirm the nightly cron entry exists on the new host |

### 20. Known recovery gotchas

- **Restored dump but the app shows "column does not exist"** — the dump
  predates a migration. Run `./scripts/apply-migrations.sh`, then reload the
  API schema cache (`docker compose restart rest`).
- **Vault decrypt errors naming a fingerprint** — the env key differs from the
  key that sealed those rows. Put the old key in `VAULT_ENCRYPTION_KEY_OLD`
  and run the re-encrypt workflow.
- **Signed-out visitors see "permission denied"** — `anon` lost `USAGE` on the
  `private` schema; re-apply the grants migration.
- **500 on `/_serverFn/...` right after deploy** — stale server-function IDs in
  a cached browser tab; hard reload.
- **Rachio stops posting** — the webhook URL changed; re-register it and
  confirm `RACHIO_WEBHOOK_SECRET` matches.

---

## Part 3 — Quick reference

```bash
# Nightly backup (VPS)
./scripts/vault-backup.sh

# Verify env hygiene
./scripts/verify-env-gitignore.sh && ./scripts/check-env.sh

# Full restore (VPS)
docker compose up -d db
gunzip -c backups/<dump>.sql.gz | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1
./scripts/apply-migrations.sh && ./scripts/apply-migrations.sh --verify
docker compose up -d && ./scripts/healthcheck.sh
```

Review this document every quarter and after any schema or infrastructure
change.
