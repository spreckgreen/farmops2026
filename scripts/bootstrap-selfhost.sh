#!/usr/bin/env bash
# bootstrap-selfhost.sh — one-command, zero-manual-step self-hosted setup.
#
# Runs, in order:
#   1. verify-env-gitignore.sh              — .env.local + docs example are ignored
#   2. fill-env-from-supabase.sh --validate — dry-run structural check
#   3. fill-env-from-supabase.sh            — writes ./.env.local
#   4. check-env.sh                         — required-vars sanity on .env.local
#   5. scan-secrets.sh --all                — no leaked keys in tracked files
#   6. install-git-hooks.sh                 — pre-commit scanner hook
#   7. refresh.sh                           — build + start containers, gated by healthcheck
#
# Any failing step aborts with a non-zero exit; nothing is silently skipped.
#
# Usage:
#   ./scripts/bootstrap-selfhost.sh
#   ./scripts/bootstrap-selfhost.sh --supabase-dir /home/rpremo/supabase-project
#   ./scripts/bootstrap-selfhost.sh --force        # overwrite existing .env.local
#   ./scripts/bootstrap-selfhost.sh --no-refresh   # stop before step 7 (env setup only)
#
# Example:
#   $ ./scripts/bootstrap-selfhost.sh
#   [1/7] verify-env-gitignore ... PASS
#   ...
#   [7/7] refresh              ... site healthy at https://farm.example.com

set -euo pipefail

SUPABASE_DIR="/home/rpremo/supabase-project"
FORCE=0
DO_REFRESH=1

while [ $# -gt 0 ]; do
  case "$1" in
    --supabase-dir) SUPABASE_DIR="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --no-refresh)   DO_REFRESH=0; shift ;;
    -h|--help)      sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
SCRIPTS=./scripts

step() { printf "\n[%s/7] %-28s ... " "$1" "$2"; }
ok()   { printf "%s\n" "${1:-PASS}"; }
die()  { printf "FAIL\n\n%s\n" "$1" >&2; exit 1; }

step 1 "verify-env-gitignore"
"$SCRIPTS/verify-env-gitignore.sh" >/tmp/bootstrap-1.log 2>&1 || die "$(cat /tmp/bootstrap-1.log)"
ok

step 2 "fill-env --validate"
"$SCRIPTS/fill-env-from-supabase.sh" --validate --supabase-dir "$SUPABASE_DIR" \
  >/tmp/bootstrap-2.log 2>&1 || die "$(cat /tmp/bootstrap-2.log)"
ok

step 3 "fill-env"
if [ -f .env.local ] && [ "$FORCE" -ne 1 ]; then
  ok "skipped (.env.local exists — use --force to overwrite)"
else
  "$SCRIPTS/fill-env-from-supabase.sh" --supabase-dir "$SUPABASE_DIR" \
    >/tmp/bootstrap-3.log 2>&1 || die "$(cat /tmp/bootstrap-3.log)"
  ok "wrote .env.local"
fi

step 4 "check-env"
"$SCRIPTS/check-env.sh" .env.local >/tmp/bootstrap-4.log 2>&1 \
  || die "$(cat /tmp/bootstrap-4.log)

Non-Supabase blocks (VAULT_ENCRYPTION_KEY, PUBLIC_APP_URL, etc.) still need
values. Edit .env.local, then re-run:  $0"
ok

step 5 "scan-secrets --all"
"$SCRIPTS/scan-secrets.sh" --all >/tmp/bootstrap-5.log 2>&1 || die "$(cat /tmp/bootstrap-5.log)"
ok

step 6 "install-git-hooks"
"$SCRIPTS/install-git-hooks.sh" >/tmp/bootstrap-6.log 2>&1 || die "$(cat /tmp/bootstrap-6.log)"
ok "hook installed"

if [ "$DO_REFRESH" -eq 0 ]; then
  printf "\n[7/7] refresh                  ... skipped (--no-refresh)\n"
  echo "✔ env setup complete — run ./scripts/refresh.sh when ready"
  exit 0
fi

printf "\n[7/7] refresh                  ... starting (streams below)\n"
echo "-----------------------------------------------------------------------"
# refresh.sh already runs check-env + healthcheck gates; stream its output
# live so a long build shows progress instead of hanging silently.
"$SCRIPTS/refresh.sh" || die "refresh.sh failed — see its diagnose output above"
echo "-----------------------------------------------------------------------"

echo
echo "✔ bootstrap complete — site is up and healthy"
