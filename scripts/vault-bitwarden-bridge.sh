#!/usr/bin/env bash
# FarmOps <-> Bitwarden mirror bridge.
#
# Runs on YOUR machine/network. It uses the Bitwarden CLI (`bw`) locally and
# talks to FarmOps over HTTPS with a bridge access code. Your Bitwarden master
# password and session key never leave this machine.
#
# Required environment:
#   FARMOPS_BASE_URL      e.g. https://farmops.bostead.life
#   VAULT_BRIDGE_TOKEN    access code created on /admin/vault-bitwarden
#   BW_SESSION            from: export BW_SESSION="$(bw unlock --raw)"
# Optional:
#   BW_FOLDER             folder name in Bitwarden (default: FarmOps)
set -euo pipefail

: "${FARMOPS_BASE_URL:?FARMOPS_BASE_URL is required}"
: "${VAULT_BRIDGE_TOKEN:?VAULT_BRIDGE_TOKEN is required}"
: "${BW_SESSION:?BW_SESSION is required (bw unlock --raw)}"
BW_FOLDER="${BW_FOLDER:-FarmOps}"

command -v bw >/dev/null || { echo "bw CLI not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

API="${FARMOPS_BASE_URL%/}/api/public/vault-bridge"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

post() { # post <path> <json-file>
  curl -sS --fail-with-body -X POST "$API/$1" \
    -H "Content-Type: application/json" \
    -H "X-Vault-Bridge-Token: $VAULT_BRIDGE_TOKEN" \
    --data-binary "@$2"
}

# Same fingerprint recipe FarmOps uses: sha256 of value + separator + notes.
fingerprint() { # fingerprint <value> <notes>
  printf '%s\n--farmops--\n%s' "$1" "$2" | shasum -a 256 | cut -d' ' -f1
}

echo "Syncing Bitwarden…"
bw sync --session "$BW_SESSION" >/dev/null

FOLDER_ID="$(bw list folders --session "$BW_SESSION" \
  | jq -r --arg n "$BW_FOLDER" '.[] | select(.name == $n) | .id' | head -n1)"
if [ -z "$FOLDER_ID" ]; then
  echo "Creating Bitwarden folder $BW_FOLDER…"
  FOLDER_ID="$(jq -nc --arg n "$BW_FOLDER" '{name:$n}' | bw encode \
    | bw create folder --session "$BW_SESSION" | jq -r '.id')"
fi

bw list items --folderid "$FOLDER_ID" --session "$BW_SESSION" > "$WORK/items.json"

# Build the digest FarmOps compares against. Values are NOT sent here.
jq -c '[]' > "$WORK/digest.json"
while read -r id; do
  [ -n "$id" ] || continue
  item="$(jq -c --arg id "$id" '.[] | select(.id == $id)' "$WORK/items.json")"
  name="$(printf '%s' "$item" | jq -r '.name')"
  notes="$(printf '%s' "$item" | jq -r '.notes // ""')"
  rev="$(printf '%s' "$item" | jq -r '.revisionDate // ""')"
  value="$(printf '%s' "$item" | jq -r '.login.password // .notes // ""')"
  fp="$(fingerprint "$value" "$notes")"
  jq -c --arg id "$id" --arg name "$name" --arg fp "$fp" --arg rev "$rev" \
    '. + [{id:$id,name:$name,fingerprint:$fp,revisionDate:$rev}]' \
    "$WORK/digest.json" > "$WORK/digest.next" && mv "$WORK/digest.next" "$WORK/digest.json"
done < <(jq -r '.[].id' "$WORK/items.json")

jq -nc --slurpfile items "$WORK/digest.json" --arg folderId "$FOLDER_ID" \
  '{folderId:$folderId, items:$items[0]}' > "$WORK/plan-req.json"

post pull-plan "$WORK/plan-req.json" > "$WORK/plan.json"
RUN_ID="$(jq -r '.runId' "$WORK/plan.json")"
echo "Run $RUN_ID: $(jq -r '(.toPush|length) as $p | (.toPull|length) as $u | (.conflicts|length) as $c | "\($p) to send, \($u) to bring in, \($c) need a decision"' "$WORK/plan.json")"

STATUS="ok"

# ---- FarmOps -> Bitwarden -------------------------------------------------
if [ "$(jq -r '.toPush | length' "$WORK/plan.json")" != "0" ]; then
  jq -c --arg runId "$RUN_ID" '{runId:$runId, linkIds:[.toPush[].linkId]}' "$WORK/plan.json" > "$WORK/push-req.json"
  post push-batch "$WORK/push-req.json" > "$WORK/push.json"

  jq -c '[]' > "$WORK/acks.json"
  while read -r payload; do
    [ -n "$payload" ] || continue
    link_id="$(printf '%s' "$payload" | jq -r '.linkId')"
    bw_item_id="$(printf '%s' "$payload" | jq -r '.bwItemId // ""')"
    name="$(printf '%s' "$payload" | jq -r '.name')"
    value="$(printf '%s' "$payload" | jq -r '.value')"
    notes="$(printf '%s' "$payload" | jq -r '.notes // ""')"
    fp="$(printf '%s' "$payload" | jq -r '.fingerprint')"

    if [ -n "$bw_item_id" ] && bw get item "$bw_item_id" --session "$BW_SESSION" >/dev/null 2>&1; then
      updated="$(bw get item "$bw_item_id" --session "$BW_SESSION" \
        | jq -c --arg name "$name" --arg v "$value" --arg n "$notes" \
            '.name=$name | .notes=$n | (.login //= {username:null}) | .login.password=$v' \
        | bw encode | bw edit item "$bw_item_id" --session "$BW_SESSION")" || { STATUS="partial"; continue; }
    else
      updated="$(jq -nc --arg name "$name" --arg v "$value" --arg n "$notes" --arg f "$FOLDER_ID" \
          '{type:1,name:$name,notes:$n,folderId:$f,login:{username:null,password:$v}}' \
        | bw encode | bw create item --session "$BW_SESSION")" || { STATUS="partial"; continue; }
    fi

    new_id="$(printf '%s' "$updated" | jq -r '.id')"
    new_rev="$(printf '%s' "$updated" | jq -r '.revisionDate // ""')"
    jq -c --arg l "$link_id" --arg i "$new_id" --arg f "$fp" --arg r "$new_rev" \
      '. + [{linkId:$l,bwItemId:$i,fingerprint:$f,revisionDate:$r}]' \
      "$WORK/acks.json" > "$WORK/acks.next" && mv "$WORK/acks.next" "$WORK/acks.json"
  done < <(jq -c '.items[]' "$WORK/push.json")

  jq -nc --arg runId "$RUN_ID" --slurpfile acks "$WORK/acks.json" '{runId:$runId, acks:$acks[0]}' > "$WORK/ack-req.json"
  post push-batch "$WORK/ack-req.json" >/dev/null
fi

# ---- Bitwarden -> FarmOps ------------------------------------------------
if [ "$(jq -r '.toPull | length' "$WORK/plan.json")" != "0" ]; then
  jq -c '[]' > "$WORK/pull-items.json"
  while read -r row; do
    link_id="$(printf '%s' "$row" | jq -r '.linkId')"
    item_id="$(printf '%s' "$row" | jq -r '.bwItemId')"
    item="$(bw get item "$item_id" --session "$BW_SESSION")" || { STATUS="partial"; continue; }
    jq -c --arg l "$link_id" --arg i "$item_id" --argjson item "$item" \
      '. + [{linkId:$l,bwItemId:$i,name:$item.name,value:($item.login.password // $item.notes // ""),notes:($item.notes // null),revisionDate:($item.revisionDate // "")}]' \
      "$WORK/pull-items.json" > "$WORK/pull.next" && mv "$WORK/pull.next" "$WORK/pull-items.json"
  done < <(jq -c '.toPull[]' "$WORK/plan.json")

  jq -nc --arg runId "$RUN_ID" --slurpfile items "$WORK/pull-items.json" '{runId:$runId, items:$items[0]}' > "$WORK/pull-req.json"
  post pull-batch "$WORK/pull-req.json" > "$WORK/pull-res.json"
  if [ "$(jq -r '.rejected | length' "$WORK/pull-res.json")" != "0" ]; then STATUS="partial"; fi
fi

jq -nc --arg runId "$RUN_ID" --arg status "$STATUS" '{runId:$runId,status:$status}' > "$WORK/done.json"
post run-complete "$WORK/done.json" >/dev/null
echo "Run $RUN_ID finished: $STATUS"
