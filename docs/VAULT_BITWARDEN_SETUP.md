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

## 7. Configuration checklist

Work through this in order; each step depends on the one before it.

| # | Where | Action | Done when |
|---|---|---|---|
| 1 | bridge machine | `npm install -g @bitwarden/cli`, `jq`, `curl` present | `bw --version` and `jq --version` both print |
| 2 | bridge machine | `bw login` (and `bw config server https://…` first if self-hosted Bitwarden) | `bw status` shows `locked`, not `unauthenticated` |
| 3 | bridge machine | `export BW_SESSION="$(bw unlock --raw)"` | `bw list folders --session "$BW_SESSION"` returns JSON |
| 4 | FarmOps | `/admin/vault-bitwarden`: pick personal/shared scope, set folder name | settings saved |
| 5 | FarmOps | **Create a new access code**, copy it once | fingerprint shown on the page |
| 6 | bridge machine | store the code at `/etc/farmops/bridge-token`, mode `600`, owned by the service user | `stat -c '%a %U' /etc/farmops/bridge-token` → `600` |
| 7 | bridge machine | run the bridge once by hand | run appears in **Recent runs** with a status |
| 8 | bridge machine | install the cron entry or systemd timer from section 3 | second run appears on schedule |

Required environment for every run — the script exits immediately if any is missing:

| Variable | Example | Notes |
|---|---|---|
| `FARMOPS_BASE_URL` | `https://farmops.bostead.life` | no trailing slash needed; must be HTTPS in production |
| `VAULT_BRIDGE_TOKEN` | `fops_…` | the access code from step 5 |
| `BW_SESSION` | output of `bw unlock --raw` | expires on reboot or vault lock |
| `BW_FOLDER` | `FarmOps` | optional, defaults to `FarmOps`; created if absent |

## 8. Rotating and revoking the access code

1. Open `/admin/vault-bitwarden` and press **Create a new access code**.
2. The previous code stops working the moment the new one is created — there is no
   overlap window, so update the bridge machine in the same sitting.
3. Replace the file and re-run:

   ```bash
   printf '%s' '<new code>' | sudo tee /etc/farmops/bridge-token >/dev/null
   sudo chmod 600 /etc/farmops/bridge-token
   ```

To stop mirroring entirely, press **Pause mirroring**: every bridge request then
fails closed with HTTP 423 and nothing moves in either direction.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `BW_SESSION is required` | the shell variable was lost, usually after a reboot | `export BW_SESSION="$(bw unlock --raw)"` and refresh the file cron reads |
| `bw` reports `You are not logged in` | credentials cleared or CLI reinstalled | `bw login`, then unlock again |
| HTTP 401 from a bridge endpoint | wrong or rotated access code | create a new code and update the token file |
| HTTP 423 from every endpoint | mirroring is paused in FarmOps | resume it on the admin page |
| Run status `partial` | one or more Bitwarden CLI calls failed mid-run | check the log; the next run retries only what did not move |
| Entries listed as *Needs your decision* | changed on both sides since the last run | choose a winner on the admin page; nothing moves until you do |
| Entries listed as *Cannot read* | FarmOps cannot decrypt them with the current key | recover them at `/admin/vault-rotation` first |
| A deleted item reappears | deletions are never propagated by design | use **Forget pairing** to break the link |
| Nothing at all moves, no errors | scope excludes those entries, or the folder name does not match | recheck scope and `BW_FOLDER` against the folder in Bitwarden |

Logs from a scheduled run land wherever the cron entry redirects them
(`/var/log/farmops-bridge.log` in the example). Keep them readable only by the
service user: they contain entry **names**, never values.
