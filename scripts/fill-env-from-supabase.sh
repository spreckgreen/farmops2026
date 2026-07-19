#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fill-env-from-supabase.sh
#
# Read a self-hosted Supabase stack's .env (Option C) and produce a Bostead
# .env with the four required values filled in:
#
#   ANON_KEY          → SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PUBLISHABLE_KEY
#   SERVICE_ROLE_KEY  → SUPABASE_SERVICE_ROLE_KEY
#   API_EXTERNAL_URL  → SUPABASE_URL, VITE_SUPABASE_URL
#   (derived slug)    → VITE_SUPABASE_PROJECT_ID
#
# Usage:
#   scripts/fill-env-from-supabase.sh [--supabase-dir DIR] [--out FILE] [--force]
#
# Defaults:
#   --supabase-dir  /home/rpremo/supabase-project
#   --out           .env  (project root)
#
# Examples:
#   # Default: writes ./.env from /home/rpremo/supabase-project
#   sudo scripts/fill-env-from-supabase.sh
#
#   # Preview into a temp file, don't touch .env
#   scripts/fill-env-from-supabase.sh --out /tmp/bostead.env
#
#   # Refresh the checked-in template (values will be committed — think twice!)
#   scripts/fill-env-from-supabase.sh --out docs/env.self-hosted-supabase.example.tmpl --force
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SUPABASE_DIR="/home/rpremo/supabase-project"
OUT_FILE=".env"
FORCE=0
VALIDATE_ONLY=0
TEMPLATE="docs/env.self-hosted-supabase.example.tmpl"

die()  { echo "❌ $*" >&2; exit 1; }
warn() { echo "⚠️  $*" >&2; }
info() { echo "ℹ️  $*"; }
ok()   { echo "✅ $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --supabase-dir) SUPABASE_DIR="$2"; shift 2 ;;
    --out)          OUT_FILE="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --validate)     VALIDATE_ONLY=1; shift ;;
    -h|--help)      sed -n '2,30p' "$0"; exit 0 ;;
    *) die "Unknown flag: $1" ;;
  esac
done

# ── Locate the Supabase stack .env ──────────────────────────────────────────
# The official stack keeps its live .env at <repo>/docker/.env
CANDIDATES=(
  "$SUPABASE_DIR/docker/.env"
  "$SUPABASE_DIR/.env"
)
SRC_ENV=""
for c in "${CANDIDATES[@]}"; do
  if [[ -r "$c" ]]; then SRC_ENV="$c"; break; fi
done
[[ -n "$SRC_ENV" ]] || die "No readable .env under: ${CANDIDATES[*]}"
info "Reading Supabase config from: $SRC_ENV"

# ── Parse required keys (tolerates quotes and inline comments) ──────────────
get() {
  local key="$1"
  # last matching assignment wins; strip surrounding quotes; strip trailing comment
  local v
  v=$(grep -E "^[[:space:]]*${key}=" "$SRC_ENV" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//; s/[[:space:]]+#.*$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/")
  printf '%s' "$v"
}

ANON_KEY="$(get ANON_KEY)"
SERVICE_ROLE_KEY="$(get SERVICE_ROLE_KEY)"
API_EXTERNAL_URL="$(get API_EXTERNAL_URL)"
SITE_URL="$(get SITE_URL)"

MISSING=()
[[ -n "$ANON_KEY"          ]] || MISSING+=("ANON_KEY")
[[ -n "$SERVICE_ROLE_KEY"  ]] || MISSING+=("SERVICE_ROLE_KEY")
[[ -n "$API_EXTERNAL_URL"  ]] || MISSING+=("API_EXTERNAL_URL")
if (( ${#MISSING[@]} > 0 )); then
  die "Missing required key(s) in $SRC_ENV: ${MISSING[*]}"
fi

# ── Derive VITE_SUPABASE_PROJECT_ID slug from the hostname ─────────────────
# e.g. https://supabase.farm.example.com → "farm-example-com"
HOST=$(printf '%s' "$API_EXTERNAL_URL" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##')
SLUG=$(printf '%s' "$HOST" | tr '[:upper:]' '[:lower:]' | tr './' '--' | sed -E 's/-+/-/g; s/^-|-$//g')
[[ -n "$SLUG" ]] || SLUG="farm-prod"

# ── Load template ───────────────────────────────────────────────────────────
[[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"
mkdir -p "$(dirname "$OUT_FILE")"

if [[ -e "$OUT_FILE" && $FORCE -ne 1 ]]; then
  BACKUP="${OUT_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp -a "$OUT_FILE" "$BACKUP"
  info "Backed up existing $OUT_FILE → $BACKUP  (use --force to skip backups)"
fi

# ── Emit filled file (idempotent: always regenerated from template) ────────
tmp=$(mktemp)
# Use awk for safe literal substitution (no shell-metachar surprises in JWTs).
awk \
  -v anon="$ANON_KEY" \
  -v svc="$SERVICE_ROLE_KEY" \
  -v url="$API_EXTERNAL_URL" \
  -v site="${SITE_URL:-}" \
  -v slug="$SLUG" \
  '
  {
    line = $0
    # Only rewrite the concrete assignment lines; leave comments/docs alone.
    if (line ~ /^VITE_SUPABASE_URL=/)            line = "VITE_SUPABASE_URL=" url
    else if (line ~ /^SUPABASE_URL=/)            line = "SUPABASE_URL=" url
    else if (line ~ /^VITE_SUPABASE_PUBLISHABLE_KEY=/) line = "VITE_SUPABASE_PUBLISHABLE_KEY=" anon
    else if (line ~ /^SUPABASE_PUBLISHABLE_KEY=/)      line = "SUPABASE_PUBLISHABLE_KEY=" anon
    else if (line ~ /^SUPABASE_SERVICE_ROLE_KEY=/)     line = "SUPABASE_SERVICE_ROLE_KEY=" svc
    else if (line ~ /^VITE_SUPABASE_PROJECT_ID=/)      line = "VITE_SUPABASE_PROJECT_ID=" slug
    else if (line ~ /^PUBLIC_APP_URL=/ && site != "")  line = "PUBLIC_APP_URL=" site
    print line
  }
  ' "$TEMPLATE" > "$tmp"

mv "$tmp" "$OUT_FILE"
chmod 600 "$OUT_FILE" 2>/dev/null || true

ok "Wrote $OUT_FILE"
echo
echo "  SUPABASE_URL                = $API_EXTERNAL_URL"
echo "  VITE_SUPABASE_PROJECT_ID    = $SLUG   (derived from hostname)"
echo "  SUPABASE_PUBLISHABLE_KEY    = ${ANON_KEY:0:12}…${ANON_KEY: -6}   (${#ANON_KEY} chars)"
echo "  SUPABASE_SERVICE_ROLE_KEY   = ${SERVICE_ROLE_KEY:0:12}…${SERVICE_ROLE_KEY: -6}   (${#SERVICE_ROLE_KEY} chars)"
[[ -n "$SITE_URL" ]] && echo "  PUBLIC_APP_URL              = $SITE_URL"
echo
echo "Still CHANGE_ME in $OUT_FILE (edit before refresh):"
grep -nE 'CHANGE_ME|example\.com' "$OUT_FILE" || echo "  (none — you're good)"
echo
echo "Next:  ./scripts/refresh.sh --no-pull"
