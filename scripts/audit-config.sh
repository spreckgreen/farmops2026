#!/usr/bin/env bash
# ============================================================================
# scripts/audit-config.sh — configuration & security audit (NOT a deploy gate)
#
# Deployment readiness (containers, /health, caddy→app) is gated by
# scripts/refresh.sh via scripts/healthcheck.sh. This script covers the other
# half: environment-template completeness and self-hosted Supabase gateway
# hardening. It is intentionally separate so that an advisory posture issue
# never fails a working deployment.
#
# Usage:
#   ./scripts/audit-config.sh                 # audit only, blocking (exit 1 on findings)
#   ./scripts/audit-config.sh --advisory      # report findings, always exit 0
#   ./scripts/audit-config.sh --with-readiness # also run the readiness probes
#   ./scripts/audit-config.sh --host example.com --no-sudo --quiet
#
# Any extra flags are passed straight through to scripts/healthcheck.sh.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/.."

HC="./scripts/healthcheck.sh"
[ -x "$HC" ] || { echo "scripts/healthcheck.sh not found or not executable" >&2; exit 2; }

ADVISORY=0
WITH_READINESS=0
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --advisory) ADVISORY=1 ;;
    --with-readiness) WITH_READINESS=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

FLAGS=()
[ "$WITH_READINESS" -eq 1 ] || FLAGS+=(--audit-only)
[ "$ADVISORY" -eq 1 ] && FLAGS+=(--advisory) || FLAGS+=(--strict)
FLAGS+=(--no-logs)

printf '\033[1;36m[audit]\033[0m %s %s\n' "$HC" "${FLAGS[*]} ${PASSTHROUGH[*]:-}"
"$HC" "${FLAGS[@]}" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
rc=$?

if [ "$ADVISORY" -eq 1 ]; then
  exit 0
fi
exit "$rc"
