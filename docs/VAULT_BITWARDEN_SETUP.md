# Mirroring the FarmOps vault with Bitwarden

FarmOps keeps its vault entries encrypted server-side. Bitwarden's Password Manager
plan has no server API a hosted app can call, so the mirror runs through a small
bridge script on your own network. The bridge uses the Bitwarden `bw` CLI locally
and calls FarmOps over HTTPS.

```text
Bitwarden cloud  <-- bw CLI -->  bridge on your LAN  <-- HTTPS + access code -->  FarmOps
```

Your Bitwarden master password and unlock session never reach FarmOps.

## 1. Prepare the bridge machine

Any always-on Linux/macOS box works.

```bash
npm install -g @bitwarden/cli   # provides `bw`
sudo apt install -y jq curl     # or: brew install jq
bw login                        # once, interactively
export BW_SESSION="$(bw unlock --raw)"
```

## 2. Configure the mirror in FarmOps

Open **/admin/vault-bitwarden** (admin only) and:

1. choose whether personal and/or shared entries are mirrored,
2. set the Bitwarden folder name (default `FarmOps`),
3. press **Create a new access code** and copy it — it is shown once.

## 3. Run the bridge

```bash
export FARMOPS_BASE_URL="https://farmops.bostead.life"
export VAULT_BRIDGE_TOKEN="<access code from step 2>"
export BW_FOLDER="FarmOps"
./scripts/vault-bitwarden-bridge.sh
```

Schedule it with a systemd timer or cron, e.g. every 15 minutes:

```cron
*/15 * * * * BW_SESSION="$(cat /run/farmops/bw-session)" \
  FARMOPS_BASE_URL="https://farmops.bostead.life" \
  VAULT_BRIDGE_TOKEN="$(cat /etc/farmops/bridge-token)" \
  /opt/farmops/scripts/vault-bitwarden-bridge.sh >> /var/log/farmops-bridge.log 2>&1
```

`BW_SESSION` expires when the machine reboots or the vault locks; re-run
`bw unlock --raw` to refresh it. Keep the token and session files at mode `600`.

## 4. What a run does

| Step | Endpoint | What moves |
|---|---|---|
| 1 | `POST /api/public/vault-bridge/pull-plan` | Bitwarden item ids, names, revisions and **fingerprints only** — no values |
| 2 | `POST /api/public/vault-bridge/push-batch` | FarmOps returns decrypted values for entries to write into Bitwarden, then records the resulting item ids |
| 3 | `POST /api/public/vault-bridge/pull-batch` | The bridge sends Bitwarden plaintext; FarmOps re-encrypts and stores it |
| 4 | `POST /api/public/vault-bridge/run-complete` | Closes the run record |

Every endpoint authenticates the access code itself (`X-Vault-Bridge-Token`);
placement under `/api/public/` only means the site login page does not intercept
it. Batches are capped at 25 entries per direction per run.

## 5. Conflict and deletion behaviour

- **Changed on one side** — copied to the other side.
- **Changed on both sides since the last run** — marked *Needs your decision*.
  Nothing moves until you choose a winner on the admin page.
- **Removed on one side** — never propagated. The pairing is flagged and you can
  *Forget pairing*, which deletes neither the vault entry nor the Bitwarden item.
- **Entry FarmOps cannot decrypt** — reported as *Cannot read* and never
  mirrored or overwritten. Recover it first via `/admin/vault-rotation`.

## 6. Security notes

- Only a SHA-256 hash and an 8-character fingerprint of the access code are
  stored; create a new code any time and the old one stops working immediately.
- Change fingerprints are SHA-256 of `value + "\n--farmops--\n" + notes`. The
  bridge computes the same string, so no plaintext is needed to detect changes.
- Pause mirroring on the admin page to make every bridge request fail closed
  with HTTP 423.
