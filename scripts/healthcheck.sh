#!/usr/bin/env bash
# scripts/healthcheck.sh — one-shot PASS/FAIL report for the Bostead stack.
#
# Answers three questions, fast, with a clear verdict at the end:
#   1. Are all expected containers running & healthy?  (app, caddy, ollama)
#   2. Are all required env vars set in .env?          (per .env.example)
#   3. Can caddy actually reach the app upstream?      (end-to-end probe)
#
# Exit code is 0 only if every check PASSES — safe to wire into cron, systemd
# OnFailure=, or a post-deploy gate in refresh.sh.
#
# Usage:
#   ./scripts/healthcheck.sh                  # human-readable PASS/FAIL table
#   ./scripts/healthcheck.sh --host farmops.bostead.life   # override probe host
#   ./scripts/healthcheck.sh --no-sudo        # never try `sudo docker` fallback
#   ./scripts/healthcheck.sh --quiet          # only print the final verdict line

set -u
set -o pipefail

HOST_NAME="farmops.bostead.life"
ALLOW_SUDO=1
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host) shift; HOST_NAME="${1:-$HOST_NAME}" ;;
    --host=*) HOST_NAME="${1#*=}" ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    --quiet) QUIET=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift || true
done

# Colors (skip if not a TTY, e.g. piped to a file)
if [ -t 1 ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; RESET=""
fi

FAIL_COUNT=0
WARN_COUNT=0
REPORT=()   # each line: "STATUS|check|detail"

record() {
  local status="$1" check="$2" detail="$3"
  case "$status" in
    FAIL) FAIL_COUNT=$((FAIL_COUNT+1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT+1)) ;;
  esac
  REPORT+=("$status|$check|$detail")
}

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

# --- 0. Pick a docker invocation that works --------------------------------
DOCKER=(docker)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  :
elif [ "$ALLOW_SUDO" -eq 1 ] && command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  record FAIL "docker access" "cannot reach docker daemon (add user to docker group or run with sudo)"
fi
DC=("${DOCKER[@]}" compose)

# ===========================================================================
# CHECK 1 — containers running & healthy
# ===========================================================================
log "${BOLD}[1/3]${RESET} Checking containers…"
EXPECTED_SERVICES=(app caddy ollama)

if [ ${#DOCKER[@]} -gt 0 ] && docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1; then
  # Grab one line per service: "<service> <state> <health>"
  PS_OUT="$("${DC[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
  for svc in "${EXPECTED_SERVICES[@]}"; do
    line="$(printf '%s\n' "$PS_OUT" | awk -v s="$svc" '$1==s{print; exit}')"
    if [ -z "$line" ]; then
      record FAIL "container: $svc" "not found in \`docker compose ps\`"
      continue
    fi
    state="$(printf '%s' "$line" | awk '{print $2}')"
    health="$(printf '%s' "$line" | awk '{print $3}')"

    if [ "$state" != "running" ]; then
      record FAIL "container: $svc" "state=$state (expected running)"
    elif [ "$health" = "healthy" ]; then
      record PASS "container: $svc" "running & healthy"
    elif [ "$health" = "unhealthy" ]; then
      record FAIL "container: $svc" "running but healthcheck=unhealthy"
    elif [ "$health" = "starting" ]; then
      record WARN "container: $svc" "still starting (healthcheck pending)"
    else
      # No healthcheck defined for this service — running is enough.
      record PASS "container: $svc" "running (no healthcheck defined)"
    fi
  done
fi

# ===========================================================================
# CHECK 2 — required env vars present in .env
# ===========================================================================
log "${BOLD}[2/3]${RESET} Checking .env vs .env.example…"
if [ ! -f .env ]; then
  record FAIL "env file" ".env not found in $(pwd)"
elif [ ! -f .env.example ]; then
  record WARN "env template" ".env.example not found — cannot verify required keys"
else
  # Required keys the app truly can't boot without. Anything listed in
  # .env.example is treated as required unless explicitly marked optional here.
  OPTIONAL_KEYS_RE='^(VAULT_ENCRYPTION_KEY_OLD|RACHIO_.*|GHOST_.*|TEMPEST_.*|CUSTOM_AI_.*|SELF_HOST_MODE|OLLAMA_MODEL|PUBLIC_APP_URL)$'

  missing=()
  empty=()
  while IFS='=' read -r k _; do
    [[ "$k" =~ ^[A-Z] ]] || continue
    # Present in .env?
    val="$(awk -F= -v k="$k" '$1==k{sub(/^[^=]*=/,""); print; exit}' .env || true)"
    if ! grep -qE "^$k=" .env; then
      if [[ ! "$k" =~ $OPTIONAL_KEYS_RE ]]; then missing+=("$k"); fi
    elif [ -z "${val//[[:space:]]/}" ]; then
      if [[ ! "$k" =~ $OPTIONAL_KEYS_RE ]]; then empty+=("$k"); fi
    fi
  done < <(awk -F= '/^[A-Z]/{print}' .env.example)

  if [ ${#missing[@]} -eq 0 ] && [ ${#empty[@]} -eq 0 ]; then
    record PASS "env vars" "all required keys from .env.example are set"
  else
    detail=""
    [ ${#missing[@]} -gt 0 ] && detail+="missing: $(IFS=,; echo "${missing[*]}") "
    [ ${#empty[@]}   -gt 0 ] && detail+="empty: $(IFS=,; echo "${empty[*]}")"
    record FAIL "env vars" "$detail"
  fi
fi

# ===========================================================================
# CHECK 3 — caddy → app connectivity (end-to-end)
# ===========================================================================
log "${BOLD}[3/3]${RESET} Probing caddy → app path…"

probe_code() {
  # $1=url, $2=extra curl args
  curl -sS -o /dev/null -w '%{http_code}' --max-time 6 $2 "$1" 2>/dev/null || echo "000"
}

# 3a. App direct (localhost:3000). Confirms the app is up on its own.
CODE_APP="$(probe_code 'http://localhost:3000/' '')"
if [[ "$CODE_APP" =~ ^(200|301|302|307|308)$ ]]; then
  record PASS "app on :3000" "HTTP $CODE_APP"
elif [ "$CODE_APP" = "000" ]; then
  record FAIL "app on :3000" "no response (app not listening — check \`compose logs app\`)"
else
  record WARN "app on :3000" "HTTP $CODE_APP (reachable but non-2xx/3xx)"
fi

# 3b. Caddy HTTP (:80) with the real Host header. Should 200 or 308→https.
CODE_CADDY_HTTP="$(probe_code 'http://localhost/' "-H Host:$HOST_NAME")"
if [[ "$CODE_CADDY_HTTP" =~ ^(200|301|308)$ ]]; then
  record PASS "caddy :80" "HTTP $CODE_CADDY_HTTP (Host: $HOST_NAME)"
elif [ "$CODE_CADDY_HTTP" = "000" ]; then
  record FAIL "caddy :80" "no response — caddy container not listening on 80"
else
  record WARN "caddy :80" "HTTP $CODE_CADDY_HTTP"
fi

# 3c. Caddy HTTPS (:443) → upstream app. -k tolerates self-signed during ACME.
CODE_CADDY_HTTPS="$(probe_code 'https://localhost/' "-k -H Host:$HOST_NAME")"
if [[ "$CODE_CADDY_HTTPS" =~ ^(200|301|302|307|308)$ ]]; then
  record PASS "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS end-to-end OK"
elif [ "$CODE_CADDY_HTTPS" = "502" ] || [ "$CODE_CADDY_HTTPS" = "503" ] || [ "$CODE_CADDY_HTTPS" = "504" ]; then
  record FAIL "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS — caddy is up but can't reach app upstream"
elif [ "$CODE_CADDY_HTTPS" = "000" ]; then
  record FAIL "caddy → app (:443)" "no response on 443 (cert not issued yet? check \`compose logs caddy\`)"
else
  record WARN "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS"
fi

# ===========================================================================
# Report
# ===========================================================================
[ "$QUIET" -eq 1 ] || {
  echo ""
  printf '%s\n' "${BOLD}Check                          Status  Detail${RESET}"
  printf '%s\n' "----------------------------------------------------------------------"
  for row in "${REPORT[@]}"; do
    IFS='|' read -r status check detail <<<"$row"
    case "$status" in
      PASS) c="$GREEN" ;;
      WARN) c="$YELLOW" ;;
      FAIL) c="$RED" ;;
      *) c="" ;;
    esac
    printf '%-30s %s%-6s%s  %s\n' "$check" "$c" "$status" "$RESET" "$detail"
  done
  echo ""
}

if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
  printf '%sVERDICT: PASS%s — stack is healthy.\n' "$GREEN$BOLD" "$RESET"
  exit 0
elif [ "$FAIL_COUNT" -eq 0 ]; then
  printf '%sVERDICT: PASS with warnings%s — %d warning(s), 0 failures.\n' "$YELLOW$BOLD" "$RESET" "$WARN_COUNT"
  exit 0
else
  printf '%sVERDICT: FAIL%s — %d failure(s), %d warning(s). Run: ./scripts/diagnose.sh\n' \
    "$RED$BOLD" "$RESET" "$FAIL_COUNT" "$WARN_COUNT"
  exit 1
fi
