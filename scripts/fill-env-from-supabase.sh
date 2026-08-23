#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fill-env-from-supabase.sh
#
# Read a self-hosted Supabase stack's .env (Option C) and produce a Bostead
# .env.local (gitignored) with the four required values filled in:
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
#   --out           .env.local  (project root — gitignored; never touches
#                   the tracked .env)
#
# Examples:
#   # Default: writes ./.env.local from /home/rpremo/supabase-project
#   sudo scripts/fill-env-from-supabase.sh
#
#   # Preview into a temp file, don't touch .env.local
#   scripts/fill-env-from-supabase.sh --out /tmp/bostead.env
#
#   # Refresh the checked-in template (values will be committed — think twice!)
#   scripts/fill-env-from-supabase.sh --out docs/env.self-hosted-supabase.example.tmpl --force
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SUPABASE_DIR="/home/rpremo/supabase-project"
OUT_FILE=".env.local"
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

# ─── Validation ─────────────────────────────────────────────────────────────
# Fail fast BEFORE touching $OUT_FILE / the checked-in template if any
# Supabase or Bostead var is malformed. Catches the common footguns:
#   - JWT keys pasted with surrounding quotes or whitespace
#   - API_EXTERNAL_URL still set to http://localhost or supabase.example.com
#   - Slug that ended up empty (would clobber VITE_SUPABASE_PROJECT_ID)
#   - Template missing an assignment line the awk pass expects to rewrite
# `--validate` runs these checks and exits without writing.
VALIDATION_ERRORS=()

# JWT shape: three dot-separated base64url segments, header must decode to
# {"alg":"HS256"...}. We do a shallow structural check — no crypto — because
# the Supabase server will reject an invalid signature at runtime anyway.
is_jwt() {
  local v="$1"
  [[ "$v" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || return 1
  [[ ${#v} -ge 100 ]] || return 1
  # header segment starts with "eyJ" (base64url of `{"`)
  [[ "$v" == eyJ* ]] || return 1
  return 0
}

is_https_url() {
  local v="$1"
  [[ "$v" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$ ]] || return 1
  # reject leftover placeholder hosts
  case "$v" in
    *supabase.example.com*|*your-project.supabase.co*|*CHANGE_ME*) return 1 ;;
  esac
  return 0
}

is_https_public_url() {
  # like is_https_url, but must be https:// (used for API_EXTERNAL_URL)
  local v="$1"
  is_https_url "$v" || return 1
  [[ "$v" == https://* ]] || return 1
  return 0
}

is_slug() {
  [[ "$1" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]
}

check() {
  local name="$1" value="$2" test="$3" hint="$4"
  if "$test" "$value"; then
    ok "$name looks valid"
  else
    local suffix=""; [[ ${#value} -gt 24 ]] && suffix="…"
    VALIDATION_ERRORS+=("$name: $hint  (got: '${value:0:24}${suffix}')")
  fi
}

echo
info "Validating parsed Supabase values…"
check "ANON_KEY"         "$ANON_KEY"         is_jwt              "expected JWT (3 base64url segments starting with eyJ, ≥100 chars)"
check "SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY" is_jwt              "expected JWT (3 base64url segments starting with eyJ, ≥100 chars)"
check "API_EXTERNAL_URL" "$API_EXTERNAL_URL" is_https_public_url "expected https://<your-supabase-host>  (no placeholders, no localhost)"
check "derived SLUG"     "$SLUG"             is_slug             "expected lowercase alnum + hyphens; hostname produced an unusable value"
if [[ -n "$SITE_URL" ]]; then
  check "SITE_URL"       "$SITE_URL"         is_https_url        "expected http(s)://<your-app-host>"
fi

# Anon and service-role must be different keys.
if [[ "$ANON_KEY" == "$SERVICE_ROLE_KEY" ]]; then
  VALIDATION_ERRORS+=("ANON_KEY == SERVICE_ROLE_KEY — they should be different tokens")
fi

# Template must define every assignment line the awk pass rewrites, otherwise
# the "fill" silently does nothing for that key.
info "Validating template completeness: $TEMPLATE"
[[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"
REQUIRED_TEMPLATE_KEYS=(
  VITE_SUPABASE_URL
  SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  VITE_SUPABASE_PROJECT_ID
)
for k in "${REQUIRED_TEMPLATE_KEYS[@]}"; do
  if grep -qE "^${k}=" "$TEMPLATE"; then
    ok "template defines $k"
  else
    VALIDATION_ERRORS+=("template $TEMPLATE is missing assignment line: ${k}=")
  fi
done

# Bostead-side keys the app needs beyond Supabase. Warn (don't fail) when the
# template still has CHANGE_ME — the operator fills these by hand.
BOSTEAD_REQUIRED=(VAULT_ENCRYPTION_KEY)
BOSTEAD_OPTIONAL=(CUSTOM_AI_BASE_URL)
for k in "${BOSTEAD_OPTIONAL[@]}"; do
  grep -qE "^${k}=" "$TEMPLATE" || warn "template has no ${k}= line (fine if unused)"
done
for k in "${BOSTEAD_REQUIRED[@]}"; do
  line=$(grep -E "^${k}=" "$TEMPLATE" || true)
  if [[ -z "$line" ]]; then
    VALIDATION_ERRORS+=("template $TEMPLATE is missing Bostead key: ${k}=")
  elif [[ "$line" == *CHANGE_ME* ]]; then
    warn "$k is still CHANGE_ME in template — edit $OUT_FILE by hand after fill"
  fi
done

if (( ${#VALIDATION_ERRORS[@]} > 0 )); then
  echo
  echo "❌ Validation failed (${#VALIDATION_ERRORS[@]} error(s)) — refusing to write $OUT_FILE:" >&2
  for e in "${VALIDATION_ERRORS[@]}"; do echo "   • $e" >&2; done
  exit 1
fi

if (( VALIDATE_ONLY == 1 )); then
  echo
  ok "Validation passed — --validate set, not writing $OUT_FILE"
  exit 0
fi

# ── Load template ───────────────────────────────────────────────────────────
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
# When invoked via sudo, hand ownership back to the invoking user so the
# non-sudo refresh.sh / healthcheck.sh can still read it (0600 + root:root
# would otherwise make check-env.sh report every var as MISSING).
if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  chown "$SUDO_USER":"$(id -gn "$SUDO_USER")" "$OUT_FILE" 2>/dev/null || true
  info "Restored ownership of $OUT_FILE to $SUDO_USER (was root due to sudo)"
fi

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
