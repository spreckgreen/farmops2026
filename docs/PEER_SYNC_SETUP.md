# Peer audit-batch sync — exact setup runbook

One-way, preview only: the **self-hosted** instance is the source of applied
field-audit batches, the **cloud** instance pulls them in as previews. Nothing
is ever applied automatically and no peer approval is carried across — the local
owner still approves every item.

Terminology used below:

| Term | Meaning | Example |
| --- | --- | --- |
| SOURCE | self-hosted FarmOps (authoritative for field audits) | `https://farmops.bostead.life` |
| PULLER | the instance that pulls (usually cloud) | `https://bostead.lovable.app` |
| peer key | read-only API token registered on SOURCE | `farmops_sk_…` (48 hex) |
| pull key | private key that lets a scheduler trigger the pull job on PULLER | any strong random string |

---

## 1. Get the self-hosted (SOURCE) side running

On the self-hosted host, in the repo checkout (`~/bostead-a29954a1`):

```bash
./scripts/bootstrap-selfhost.sh                 # env + hooks + build + start, gated by healthcheck
# already bootstrapped previously? just refresh:
./scripts/apply-migrations.sh                   # schema first — refresh refuses a stale schema
./scripts/refresh.sh --force
./scripts/healthcheck.sh                        # expect: healthy
```

Requirements for the pull to be able to reach it later (enforced in code):

- reachable over **HTTPS** at a public DNS name — the pull rejects `http://`,
  loopback, private, link-local and reserved addresses, including after DNS
  resolution, and refuses redirects;
- `PUBLIC_APP_URL=https://<your-domain>` in `.env.local`;
- ports 80/443 open so the bundled Caddy can issue the certificate
  (`ACME_DOMAIN` / `ACME_EMAIL` in `.env.local`).

Verify from outside the host:

```bash
curl -sS https://<your-domain>/health
```

---

## 2. Service accounts

### 2a. Peer read key — issued for PULLER, registered on SOURCE

1. On PULLER, sign in as an admin and open **Electrical → Data & migration →
   Audit batches**.
2. In the *Pull from peer instance* panel, press **Generate key**. You get:
   - the plaintext key (shown once — copy it),
   - the exact `insert into public.electrical_api_principals …` statement,
     which contains only the SHA-256, prefix and the single scope
     `electrical:audit-batches:read`.
3. On SOURCE, find the owner account id and run the statement:

```bash
# owner user id (the self-hosted account that should own the principal)
psql "$DATABASE_URL" -c "select id, email from auth.users order by created_at limit 5;"
# then paste the generated statement, replacing <peer owner user id>
psql "$DATABASE_URL" -f /tmp/register-peer-key.sql
```

4. Smoke-test the credential from anywhere:

```bash
curl -sS https://<source-domain>/api/v1/electrical/audit-batches \
  -H "authorization: Bearer farmops_sk_…" | head -c 400
```

Expect a JSON list of batches with `batch_id` / `status`. A `401` means the
hash was not registered; a `403` means the scope is missing.

5. Store the key on PULLER as the runtime secret `ELECTRICAL_PEER_SYNC_TOKEN`
   (cloud: project secrets; self-hosted puller: `.env.local`). The scheduled job
   reads only that variable — the value you pasted into the UI is for manual
   pulls and is cleared when you leave the page.

### 2b. Pull (cron) key — lives on PULLER only

On PULLER, same page, *Automatic pull key* panel:

1. **Rotate key** → copy the new key (shown once). Optionally set a grace
   period (0–1440 minutes) so the previous key keeps working while you update
   schedulers; **Revoke retiring keys** ends the window immediately.
2. The endpoint validates against the key table, not a value baked into a
   schedule, so rotation never requires touching the schedule itself.

Where the key goes:

- Cloud PULLER: nothing to do — pg_cron already posts it every 15 minutes.
- Self-hosted PULLER (no pg_cron): put it in `.env.local` as
  `ELECTRICAL_PEER_SYNC_CRON_SECRET` and install the host trigger:

```bash
sudo ./scripts/install-peer-sync-timer.sh --interval 15   # systemd timer
./scripts/install-peer-sync-timer.sh --status             # verify + last runs
```

### 2c. Peer address

On PULLER, *Pull from peer instance*: set **Peer address** to
`https://<source-domain>`, tick **Automatic pull enabled**, set
**Batches per run** (default 5, hard cap 10), and Save. Saving re-applies the
same HTTPS/public-address guard the pull uses.

---

## 3. First sync

Manual first, so any misconfiguration surfaces immediately:

1. On PULLER, *Pull from peer instance* → paste the peer key → **Pull now**.
   Expect a per-batch result list: `staged`, `skipped_present`,
   `skipped_status` (peer batch not applied yet) or `failed` with a reason.
2. Or drive the scheduled path directly on a self-hosted PULLER:

```bash
./scripts/peer-sync-tick.sh --env-file ./.env.local
# 200 + {"ok":true,...}  → accepted; 401 → wrong/rotated pull key
```

3. Confirm on the same page: **Recent runs** shows the tick (trigger, outcome,
   counts, duration) and the batch list shows the pulled manifests as
   `validated` — never `applied`.

What is checked on the way in: manifest checksum against the peer's, batch id
already present locally (skipped), same id with a different checksum (refused),
peer status must be `applied` or `partially_applied`, oldest applied first, and
the run is bounded plus single-flight via `job_locks`.

---

## 4. Re-run the audit to test the sync

On SOURCE:

1. Open **Electrical → Data & migration → Audit batches**, load/prepare the
   batch (e.g. `FA-FS-2026-09-03-PM-R1`), validate and **apply** it there —
   SOURCE is where field audits are applied.

On PULLER:

2. Wait one tick (or press **Pull now** / run `./scripts/peer-sync-tick.sh`).
3. The newly applied batch appears as a `validated` preview. Open it and
   confirm:
   - item count and per-item values match SOURCE,
   - approvals are **not** carried over,
   - the source note names the peer origin and the pull time.
4. Approve the items you want locally and apply. Each write re-checks
   `expected_updated_at`, so a row changed since staging is refused rather than
   overwritten.
5. Run the pull again: every batch should now report `skipped_present` — the
   pull is idempotent.

Then verify the audit landed: **Electrical → Field work → Change log** and the
QA screens, plus **Grid map** for field-verified positions.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `401` from `peer-sync-tick.sh` | Pull key rotated or grace window ended — copy the active key again into `.env.local`. |
| Run logged as `skipped: no peer instance configured` | Peer address not saved on PULLER. |
| `skipped: peer access key not configured` | `ELECTRICAL_PEER_SYNC_TOKEN` missing on PULLER. |
| `refused: peer address must be https` / private address | SOURCE is not publicly reachable over HTTPS; fix DNS/TLS rather than relaxing the guard. |
| Job stops running, page shows paused | Three consecutive failed runs tripped the breaker — fix the cause, then **Resume** on the panel. |
| Peer batch never appears | Its status on SOURCE is not `applied`/`partially_applied`. |
