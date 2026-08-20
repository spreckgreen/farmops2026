#!/usr/bin/env bash
# scripts/collect-logs.sh — one copy-pasteable diagnostic report for the Bostead stack.
#
# Collects, in a single Markdown document:
#   1. Host + stack facts        (date, kernel, RAM, disk, docker/compose versions)
#   2. Container state           (docker compose ps, exit codes, restart counts)
#   3. Probes                    (/health and /ready from inside caddy and over HTTPS)
#   4. Recent logs               (caddy, app, ollama — time-windowed and tail-capped)
#   5. Env sanity                (variable NAMES only — values are never printed)
#
# Every line passes through a redactor: JWTs, hex keys, and anything that looks
# like KEY=secret / token / password is replaced with «REDACTED» before it hits
# the report, so the output is safe to paste into a chat or an issue.
#
# Usage:
#   ./scripts/collect-logs.sh                       # write ./logs/reports/bostead-report-<ts>.md
#   ./scripts/collect-logs.sh --stdout              # print the report instead of writing a file
#   ./scripts/collect-logs.sh --minutes 5           # only the last 5 minutes of logs (default 15)
#   ./scripts/collect-logs.sh --tail 400            # up to 400 lines per service (default 200)
#   ./scripts/collect-logs.sh --host farmops.bostead.life
#   ./scripts/collect-logs.sh --services "app caddy" # subset of services
#   ./scripts/collect-logs.sh --no-sudo             # never retry with `sudo docker`
#
# Exit code is 0 whenever the report was produced — this is a collector, not a gate.
# Use scripts/healthcheck.sh when you want PASS/FAIL semantics.

set -u
set -o pipefail

MINUTES=15
TAIL_LINES=200
HOST_NAME="farmops.bostead.life"
SERVICES="caddy app ollama"
ALLOW_SUDO=1
TO_STDOUT=0
OUT_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --minutes) MINUTES="${2:-15}"; shift 2 ;;
    --tail) TAIL_LINES="${2:-200}"; shift 2 ;;
    --host) HOST_NAME="${2:-$HOST_NAME}"; shift 2 ;;
    --services) SERVICES="${2:-$SERVICES}"; shift 2 ;;
    --out) OUT_FILE="${2:-}"; shift 2 ;;
    --stdout) TO_STDOUT=1; shift ;;
    --no-sudo) ALLOW_SUDO=0; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.." || exit 1

TS="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -z "$OUT_FILE" ]; then
  OUT_FILE="logs/reports/bostead-report-${TS}.md"
fi

# ---------------------------------------------------------------- docker helper
DC=""
detect_docker() {
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
  elif docker-compose version >/dev/null 2>&1; then
    DC="docker-compose"
  elif [ "$ALLOW_SUDO" = "1" ] && sudo -n docker compose version >/dev/null 2>&1; then
    DC="sudo docker compose"
  fi
}
detect_docker

HAVE_DOCKER=0
command -v docker >/dev/null 2>&1 && HAVE_DOCKER=1
d() {
  if [ "$HAVE_DOCKER" = "0" ]; then
    echo "(docker unavailable on this host)"
    return 0
  fi
  docker "$@" 2>&1
}

dc() {
  if [ -z "$DC" ]; then
    echo "(docker compose unavailable on this host)"
    return 0
  fi
  # shellcheck disable=SC2086
  $DC "$@" 2>&1
}

# ------------------------------------------------------------------- redaction
# Order matters: specific KEY=value forms first, then bare high-entropy blobs.
redact() {
  sed -E \
    -e 's/(eyJ[A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/«REDACTED-JWT»/g' \
    -e 's/(sb_(publishable|secret)_)[A-Za-z0-9_-]{8,}/\1«REDACTED»/g' \
    -e 's/(([A-Z0-9_]*(SERVICE_ROLE|ANON|SECRET|PASSWORD|TOKEN|APIKEY|API_KEY|KEY|DSN)[A-Z0-9_]*)[=:][[:space:]]*)[^[:space:]"'"'"',}]+/\1«REDACTED»/g' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._~+\/-]{10,}=*/\1«REDACTED»/g' \
    -e 's/\b[0-9a-f]{48,}\b/«REDACTED-HEX»/g' \
    -e 's/(postgres(ql)?:\/\/[^:]+:)[^@]+@/\1«REDACTED»@/g'
}

section() { printf '\n## %s\n' "$1"; }
fence() {
  # fence <language> ; reads the block body from stdin
  printf '\n```%s\n' "${1:-text}"
  cat
  printf '```\n'
}

# ---------------------------------------------------------------------- probes
probe_report() {
  if [ -z "$DC" ]; then
    echo "docker compose unavailable — skipped"
    return 0
  fi
  # shellcheck disable=SC2086
  $DC exec -T caddy sh -lc '
    command -v curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1
    for path in /health /ready; do
      printf "caddy->app %-8s " "$path"
      curl -sS -o /tmp/probe.json -w "status=%{http_code} total=%{time_total}s" "http://app:3000$path" 2>/dev/null || printf "UNREACHABLE"
      echo
      head -c 400 /tmp/probe.json 2>/dev/null; echo
    done
  ' 2>&1
  for path in /health /ready; do
    printf 'https      %-8s ' "$path"
    curl -sS -o /dev/null -m 15 -w 'status=%{http_code} total=%{time_total}s\n' \
      "https://${HOST_NAME}${path}" 2>&1 || echo 'UNREACHABLE'
  done
}

# ------------------------------------------------------------------ env sanity
env_report() {
  if [ ! -f .env.local ] && [ ! -f .env ]; then
    echo "no .env.local or .env in $(pwd)"
    return 0
  fi
  for f in .env.local .env; do
    [ -f "$f" ] || continue
    echo "--- $f: $(grep -cE '^[A-Z]' "$f" 2>/dev/null || echo 0) variables set (values hidden) ---"
    grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$f" 2>/dev/null | tr -d '=' | sort | tr '\n' ' '
    echo
    # The two values that are safe to show and are the usual culprits: they must
    # be bare origins with no port and no /auth/v1 path.
    grep -E '^(VITE_)?SUPABASE_URL=' "$f" 2>/dev/null | sed -E 's/^/url: /'
    echo
  done
}

# ------------------------------------------------------------ build the report
build_report() {
  cat <<EOF
# Bostead diagnostic report

- generated: \`${TS}\` (UTC)
- host: \`$(hostname -f 2>/dev/null || hostname)\`
- app dir: \`$(pwd)\`
- window: last **${MINUTES} min**, max **${TAIL_LINES} lines** per service
- services: \`${SERVICES}\`
- probe host: \`${HOST_NAME}\`
- secrets: scrubbed by the collector (\`«REDACTED»\` markers below)
EOF

  section "Host + stack"
  {
    echo "uname: $(uname -srm 2>/dev/null)"
    echo "docker: $(d --version | head -1)"
    echo "compose: ${DC:-unavailable} $(dc version --short | head -1)"
    echo
    echo "--- memory ---"
    free -h 2>/dev/null || echo "(free unavailable)"
    echo
    echo "--- disk ---"
    df -h / 2>/dev/null | tail -2
    echo
    echo "--- per-container usage ---"
    d stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' | head -15
  } | fence text

  section "Container state"
  {
    dc ps
    echo
    echo "--- exit codes / restarts (137 = OOM-killed) ---"
    for s in $SERVICES; do
      cid=""
      [ -n "$DC" ] && cid="$(dc ps -q "$s" | head -1)"
      if [ -n "$cid" ] && [ "$HAVE_DOCKER" = "1" ]; then
        d inspect -f "$s: status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} started={{.State.StartedAt}}" "$cid"
      else
        echo "$s: no container"
      fi
    done
  } | fence text

  section "Probes (/health, /ready)"
  probe_report | fence text

  section "Env sanity (names only)"
  env_report | fence text

  for s in $SERVICES; do
    section "Logs — ${s} (last ${MINUTES}m, tail ${TAIL_LINES})"
    dc logs --no-color --timestamps --since "${MINUTES}m" --tail "$TAIL_LINES" "$s" \
      | tail -n "$TAIL_LINES" | fence text
  done

  section "Errors across all services (grepped)"
  dc logs --no-color --timestamps --since "${MINUTES}m" --tail 2000 \
    | grep -iE 'error|fatal|panic|refused|ENOTFOUND|EADDRINUSE|exited|killed|unhandled|502|503' \
    | tail -60 | fence text

  cat <<'EOF'

## How to read this

- `exit=137` / `oom=true` on **app** — out of memory, usually Ollama took the RAM.
- No `[server]` banner in the app log — the process never booted; read the first error above.
- `/health` 200 but `/ready` 503 — app is up, a dependency is not (see the failing check's `detail`).
- caddy hop fails while app-container probe works — compose networking or a 127.0.0.1 bind.
- `dial tcp: lookup app` in caddy — caddy and app are not on the same compose network.

Full guide: `docs/TROUBLESHOOTING.md`
EOF
}

if [ "$TO_STDOUT" = "1" ]; then
  build_report | redact
  exit 0
fi

mkdir -p "$(dirname "$OUT_FILE")"
build_report | redact > "$OUT_FILE"

echo "report written: $OUT_FILE ($(wc -l < "$OUT_FILE") lines, $(wc -c < "$OUT_FILE") bytes)"
echo
echo "copy it to your clipboard with one of:"
echo "  cat $OUT_FILE                 # then select + copy"
echo "  xclip -sel clip < $OUT_FILE   # Linux desktop"
echo "  pbcopy < $OUT_FILE            # macOS"
