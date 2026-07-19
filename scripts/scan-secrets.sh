#!/usr/bin/env bash
# Scans tracked files for leaked Supabase keys and placeholder markers.
# Blocks: CHANGE_ME placeholders, service_role JWTs, and raw anon/service JWTs
# embedded in docs or source files. Exits non-zero on any hit.
#
# Usage:
#   scripts/scan-secrets.sh                 # scan staged files (pre-commit)
#   scripts/scan-secrets.sh --all           # scan every tracked file (CI)
#   scripts/scan-secrets.sh path1 path2 ... # scan specific files
set -euo pipefail

MODE="${1:-staged}"

# ---- File selection ---------------------------------------------------------
case "$MODE" in
  --all)
    mapfile -t FILES < <(git ls-files)
    ;;
  staged)
    mapfile -t FILES < <(git diff --cached --name-only --diff-filter=ACMR)
    ;;
  *)
    FILES=("$@")
    ;;
esac

# Only text-y paths worth scanning. Templates (*.tmpl, *.example) legitimately
# contain CHANGE_ME markers, so exclude them. `.env` is Lovable Cloud's
# auto-generated file that only ever holds publishable (anon) keys.
FILTERED=()
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *.tmpl|*.example|*.example.*|.gitignore|bun.lock|package-lock.json|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.pdf|*.woff*|*.ttf)
      continue ;;
    .env|.env.*) continue ;;                # gitignored / publishable-only
    scripts/scan-secrets.sh) continue ;;    # this file has the patterns
    scripts/check-env.sh|scripts/fill-env-from-supabase.sh|scripts/healthcheck.sh|scripts/refresh.sh) continue ;;
    src/lib/env-startup-check.server.ts) continue ;;   # placeholder-detection logic
  esac
  FILTERED+=("$f")
done

if [ "${#FILTERED[@]}" -eq 0 ]; then
  echo "scan-secrets: no candidate files"
  exit 0
fi

FAIL=0
report() { echo "  [BLOCK] $1"; FAIL=1; }

# Drop lines containing an explicit `scan-secrets: allow` marker — lets docs
# and templates reference `CHANGE_ME` / example JWTs as illustrations without
# tripping the blocker. Keep this marker off any line with a *real* secret.
strip_allow() { grep -v 'scan-secrets: allow' || true; }

echo "==> Scanning ${#FILTERED[@]} file(s) for Supabase key leaks"

# ---- Patterns ---------------------------------------------------------------
# 1) CHANGE_ME placeholders leaking outside templates (means someone copied a
#    filled .env into a tracked file).
if HITS=$(grep -nE 'CHANGE_ME[A-Z0-9_]*' "${FILTERED[@]}" 2>/dev/null | strip_allow); [ -n "$HITS" ]; then
  report "CHANGE_ME placeholder found — did a filled .env get committed?"
  echo "$HITS" | sed 's/^/         /'
fi

# 2) service_role literal token (JWT payloads embed "role":"service_role").
if HITS=$(grep -nE '"role"[[:space:]]*:[[:space:]]*"service_role"|role=service_role' "${FILTERED[@]}" 2>/dev/null | strip_allow); [ -n "$HITS" ]; then
  report "service_role reference found in tracked source"
  echo "$HITS" | sed 's/^/         /'
fi

# 3) Raw Supabase JWTs (header eyJhbGciOiJIUzI1NiIs... — anon or service).
if HITS=$(grep -nE 'eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}' "${FILTERED[@]}" 2>/dev/null | strip_allow); [ -n "$HITS" ]; then
  report "Supabase JWT literal found (anon/service key committed)"
  echo "$HITS" | sed 's/^/         /'
fi

# 4) New-format Supabase secret keys (sb_secret_...). Publishable is fine.
if HITS=$(grep -nE 'sb_secret_[A-Za-z0-9_-]{20,}' "${FILTERED[@]}" 2>/dev/null | strip_allow); [ -n "$HITS" ]; then
  report "Supabase secret key (sb_secret_...) committed"
  echo "$HITS" | sed 's/^/         /'
fi

if [ "$FAIL" -ne 0 ]; then
  cat <<EOF

==> FAIL: potential Supabase secrets detected.
    - Move real values to your local .env (already gitignored).
    - Keep placeholders only in *.tmpl / *.example files.
    - Rotate any key that was actually committed.
EOF
  exit 1
fi

echo "==> OK: no Supabase key patterns detected"
