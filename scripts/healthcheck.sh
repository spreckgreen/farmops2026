#!/usr/bin/env bash
# scripts/healthcheck.sh — one-shot PASS/FAIL report for the Bostead stack.
#
# Answers three questions, fast, with a clear verdict at the end:
#   1. Are all expected containers running & healthy?  (app, caddy, ollama)
#   2. Are all required env vars set in .env?          (per .env.example)
#   3. Can the app and caddy route actually respond?   (end-to-end probe)
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
DUMP_LOGS=1
LOG_TAIL=80
while [ $# -gt 0 ]; do
  case "$1" in
    --host) shift; HOST_NAME="${1:-$HOST_NAME}" ;;
    --host=*) HOST_NAME="${1#*=}" ;;
    --no-sudo) ALLOW_SUDO=0 ;;
    --quiet) QUIET=1 ;;
    --no-logs) DUMP_LOGS=0 ;;
    --log-tail) shift; LOG_TAIL="${1:-80}" ;;
    --log-tail=*) LOG_TAIL="${1#*=}" ;;
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

# Match refresh.sh's compose environment layering when real self-hosted values
# live in .env.local. This also prevents misleading interpolation warnings when
# healthcheck.sh is run directly.
if [ -f .env.local ]; then
  export COMPOSE_ENV_FILES=".env,.env.local"
fi

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
# CHECK 2 — required env vars present in the active env file
# ===========================================================================
# Prefer .env.local (gitignored, holds real self-hosted keys) over .env.
if   [ -f .env.local ]; then ENV_FILE=".env.local"
elif [ -f .env ];       then ENV_FILE=".env"
else                         ENV_FILE=""
fi

log "${BOLD}[2/3]${RESET} Checking ${ENV_FILE:-<none>} vs .env.example…"
if [ -z "$ENV_FILE" ]; then
  record FAIL "env file" "neither .env.local nor .env found in $(pwd)"
elif [ ! -f .env.example ]; then
  record WARN "env template" ".env.example not found — cannot verify required keys"
else
  OPTIONAL_KEYS_RE='^(VAULT_ENCRYPTION_KEY_OLD|RACHIO_.*|GHOST_.*|TEMPEST_.*|CUSTOM_AI_.*|SELF_HOST_MODE|OLLAMA_MODEL|PUBLIC_APP_URL)$'

  missing=()
  empty=()
  while IFS='=' read -r k _; do
    [[ "$k" =~ ^[A-Z] ]] || continue
    val="$(awk -F= -v k="$k" '$1==k{sub(/^[^=]*=/,""); print; exit}' "$ENV_FILE" || true)"
    if ! grep -qE "^$k=" "$ENV_FILE"; then
      if [[ ! "$k" =~ $OPTIONAL_KEYS_RE ]]; then missing+=("$k"); fi
    elif [ -z "${val//[[:space:]]/}" ]; then
      if [[ ! "$k" =~ $OPTIONAL_KEYS_RE ]]; then empty+=("$k"); fi
    fi
  done < <(awk -F= '/^[A-Z]/{print}' .env.example)

  placeholders=()
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    [[ "$k" =~ ^[A-Z] ]] || continue
    case "$v" in
      *CHANGE_ME*|*supabase.example.com*|*your-project-ref*) placeholders+=("$k") ;;
    esac
  done < "$ENV_FILE"

  if [ ${#missing[@]} -eq 0 ] && [ ${#empty[@]} -eq 0 ] && [ ${#placeholders[@]} -eq 0 ]; then
    record PASS "env vars" "all required keys from .env.example are set in $ENV_FILE"
  else
    detail=""
    [ ${#missing[@]}      -gt 0 ] && detail+="missing: $(IFS=,; echo "${missing[*]}") "
    [ ${#empty[@]}        -gt 0 ] && detail+="empty: $(IFS=,; echo "${empty[*]}") "
    [ ${#placeholders[@]} -gt 0 ] && detail+="placeholders (edit $ENV_FILE or run scripts/fill-env-from-supabase.sh): $(IFS=,; echo "${placeholders[*]}")"
    record FAIL "env vars" "$detail"
  fi
fi

# ===========================================================================
# CHECK 3 — caddy → app connectivity (end-to-end)
# ===========================================================================
log "${BOLD}[3/3]${RESET} Probing caddy → app path…"

probe_code() {
  # curl already prints 000 for connection/TLS failures. Do not append another
  # 000 on a non-zero exit or the caller receives the invalid value 000000.
  local output
  output="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 "$@" 2>/dev/null || true)"
  if [[ "$output" =~ ([0-9]{3})$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    printf '000'
  fi
}

# 3a. Probe from inside the app container. Port 3000 is intentionally exposed
# only to the compose network, so probing host localhost:3000 is always wrong.
CODE_APP="$("${DC[@]}" exec -T app bun -e \
  "fetch('http://127.0.0.1:3000/').then(r=>process.stdout.write(String(r.status))).catch(()=>process.stdout.write('000'))" \
  2>/dev/null || true)"
[[ "$CODE_APP" =~ ^[0-9]{3}$ ]] || CODE_APP="000"
if [[ "$CODE_APP" =~ ^(200|301|302|307|308)$ ]]; then
  record PASS "app internal :3000" "HTTP $CODE_APP"
elif [ "$CODE_APP" = "000" ]; then
  record FAIL "app internal :3000" "no response (check \`docker compose logs app\`)"
else
  record FAIL "app internal :3000" "HTTP $CODE_APP (expected 2xx/3xx)"
fi

# 3b. Caddy HTTP (:80) with the real Host header. Should 200 or 308→https.
CODE_CADDY_HTTP="$(probe_code -H "Host: $HOST_NAME" 'http://127.0.0.1/')"
if [[ "$CODE_CADDY_HTTP" =~ ^(200|301|308)$ ]]; then
  record PASS "caddy :80" "HTTP $CODE_CADDY_HTTP (Host: $HOST_NAME)"
elif [ "$CODE_CADDY_HTTP" = "000" ]; then
  record FAIL "caddy :80" "no response — caddy container not listening on 80"
else
  record WARN "caddy :80" "HTTP $CODE_CADDY_HTTP"
fi

# 3c. Caddy HTTPS (:443) → upstream app. --resolve sets both the HTTP Host and
# TLS SNI to the configured domain while still connecting locally. A Host
# header alone leaves SNI as "localhost" and can fail before HTTP is reached.
CODE_CADDY_HTTPS="$(probe_code -k --resolve "$HOST_NAME:443:127.0.0.1" "https://$HOST_NAME/")"
if [[ "$CODE_CADDY_HTTPS" =~ ^(200|301|302|307|308)$ ]]; then
  record PASS "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS end-to-end OK"
elif [ "$CODE_CADDY_HTTPS" = "502" ] || [ "$CODE_CADDY_HTTPS" = "503" ] || [ "$CODE_CADDY_HTTPS" = "504" ]; then
  record FAIL "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS — caddy is up but can't reach app upstream"
elif [ "$CODE_CADDY_HTTPS" = "000" ]; then
  record FAIL "caddy → app (:443)" "no response on 443 (cert not issued yet? check \`compose logs caddy\`)"
else
  record FAIL "caddy → app (:443)" "HTTP $CODE_CADDY_HTTPS (expected 2xx/3xx)"
fi

# ===========================================================================
# CHECK 4 — network / gateway hardening (self-hosted Supabase only)
# ===========================================================================
# Skipped entirely when no self-hosted Supabase stack is present, so this file
# stays usable on a managed backend.
if "${DOCKER[@]}" network inspect supabase_default >/dev/null 2>&1; then
  log "${BOLD}[4/4]${RESET} Checking gateway hardening…"

  # 4a. The hardening override must be part of the active compose layering,
  #     otherwise `docker compose up` republishes the gateway/pooler ports.
  ACTIVE_COMPOSE="${COMPOSE_FILE:-}"
  if [ -z "$ACTIVE_COMPOSE" ] && [ -f .env ]; then
    ACTIVE_COMPOSE="$(sed -n 's/^COMPOSE_FILE=//p' .env | tail -1)"
  fi
  if [ ! -f docker-compose.hardening.yml ]; then
    record WARN "hardening override" "docker-compose.hardening.yml not found in this directory"
  elif printf '%s' "$ACTIVE_COMPOSE" | grep -q 'docker-compose.hardening.yml'; then
    record PASS "hardening override" "COMPOSE_FILE includes docker-compose.hardening.yml"
  else
    record FAIL "hardening override" "COMPOSE_FILE does not include docker-compose.hardening.yml — gateway/pooler ports may be republished"
  fi

  # 4b. No database, pooler or gateway port may be published on the host.
  PUBLISHED="$("${DOCKER[@]}" ps --format '{{.Ports}}' 2>/dev/null || true)"
  BAD_PORTS=""
  for port in 5432 6543 8000 8443; do
    if printf '%s\n' "$PUBLISHED" | grep -Eq "(^|[^0-9])0\.0\.0\.0:${port}->|\[::\]:${port}->"; then
      BAD_PORTS="$BAD_PORTS $port"
    fi
  done
  if [ -n "$BAD_PORTS" ]; then
    record FAIL "published host ports" "publicly reachable:${BAD_PORTS} (expected none)"
  else
    record PASS "published host ports" "5432/6543/8000/8443 not published on the host"
  fi

  # 4c. Only caddy — never app — is attached to the external supabase network.
  ATTACHED="$("${DOCKER[@]}" network inspect supabase_default \
    --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null || true)"
  if printf '%s' "$ATTACHED" | grep -q 'caddy'; then
    record PASS "caddy on supabase_default" "attached (reverse_proxy kong:8000 resolves)"
  else
    record FAIL "caddy on supabase_default" "not attached — the HTTPS route to the gateway will 502"
  fi
  if printf '%s' "$ATTACHED" | grep -Eq '(^| )[^ ]*[-_]app( |$)'; then
    record FAIL "app off supabase_default" "the app container is attached directly — remove it"
  else
    record PASS "app off supabase_default" "not attached directly"
  fi

  # 4d. host.docker.internal must stay removed.
  if grep -q 'host\.docker\.internal' docker-compose.yml Caddyfile 2>/dev/null; then
    record FAIL "host.docker.internal" "still referenced in docker-compose.yml/Caddyfile — remove it"
  else
    record PASS "host.docker.internal" "not referenced"
  fi

  # 4e. Unauthenticated gateway requests must fail closed. Probed through the
  #     public HTTPS route; a 200 here would mean an open API surface.
  SUPA_HOST="$(sed -n 's/^SUPABASE_DOMAIN=//p' .env 2>/dev/null | tail -1)"
  SUPA_HOST="${SUPA_HOST:-supabase.$HOST_NAME}"
  CODE_SUPA="$(probe_code -k --resolve "$SUPA_HOST:443:127.0.0.1" "https://$SUPA_HOST/rest/v1/profiles?select=id")"
  if [[ "$CODE_SUPA" =~ ^(401|403)$ ]]; then
    record PASS "gateway fails closed" "unauthenticated REST → HTTP $CODE_SUPA"
  elif [ "$CODE_SUPA" = "000" ]; then
    record WARN "gateway fails closed" "no response on https://$SUPA_HOST (cert or DNS not ready?)"
  else
    record FAIL "gateway fails closed" "unauthenticated REST → HTTP $CODE_SUPA (expected 401/403)"
  fi

  # 4f. The Supabase secret file must not be group/world readable.
  for envpath in ../supabase/docker/.env /opt/supabase/docker/.env "$HOME/supabase/docker/.env"; do
    [ -f "$envpath" ] || continue
    MODE="$(stat -c '%a' "$envpath" 2>/dev/null || echo '?')"
    if [ "$MODE" = "600" ]; then
      record PASS "supabase .env mode" "$envpath is 600"
    else
      record FAIL "supabase .env mode" "$envpath is $MODE (expected 600) — run: chmod 600 $envpath"
    fi
    break
  done
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
  # -----------------------------------------------------------------------
  # Auto-collect recent container logs on FAIL. This lands in the same
  # terminal (and refresh.sh's tee'd log) so operators don't need a second
  # round-trip to `docker compose logs`. Disable with --no-logs.
  # -----------------------------------------------------------------------
  if [ "$DUMP_LOGS" -eq 1 ] && [ ${#DC[@]} -gt 0 ]; then
    printf '\n%s\n' "${BOLD}──── Recent container logs (last ${LOG_TAIL} lines each) ────${RESET}" >&2
    for svc in app caddy; do
      printf '\n%s\n' "${BOLD}▸ ${svc} (docker compose logs --tail=${LOG_TAIL} ${svc})${RESET}" >&2
      "${DC[@]}" logs --tail="$LOG_TAIL" --timestamps "$svc" 2>&1 | sed 's/^/    /' >&2 \
        || printf '    (failed to read %s logs)\n' "$svc" >&2
    done
    # Caddy writes access logs to a JSON file inside the container; surface a
    # short tail if it exists so TLS/upstream errors are visible even when the
    # container's stdout is quiet.
    printf '\n%s\n' "${BOLD}▸ caddy access log (tail -n ${LOG_TAIL} /var/log/caddy/access.log)${RESET}" >&2
    "${DC[@]}" exec -T caddy sh -c "test -f /var/log/caddy/access.log && tail -n ${LOG_TAIL} /var/log/caddy/access.log || echo '(no access.log — file logging not enabled in Caddyfile)'" 2>&1 \
      | sed 's/^/    /' >&2 || true
    printf '%s\n\n' "${BOLD}──── end container logs ────${RESET}" >&2
  fi

  printf '%sVERDICT: FAIL%s — %d failure(s), %d warning(s). Run: ./scripts/diagnose.sh\n' \
    "$RED$BOLD" "$RESET" "$FAIL_COUNT" "$WARN_COUNT"
  exit 1
fi
