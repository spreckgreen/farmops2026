#!/usr/bin/env bash
# check-env.sh — verifies required environment variables are present before
# running the Node.js quickstart (or systemd service).
#
# Usage:
#   ./scripts/check-env.sh              # checks the current shell environment
#   set -a && source .env && set +a && ./scripts/check-env.sh
#
# Exits 0 if everything required is set, 1 otherwise. Never prints values.

set -u

REQUIRED=(
  VITE_SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY
  VITE_SUPABASE_PROJECT_ID
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  LOVABLE_API_KEY
)

OPTIONAL=(
  NODE_ENV
  PORT
)

missing=()
placeholder=()

for var in "${REQUIRED[@]}"; do
  val="${!var-}"
  if [ -z "$val" ]; then
    missing+=("$var")
  elif [[ "$val" == your-* || "$val" == https://your-project.supabase.co ]]; then
    placeholder+=("$var")
  fi
done

echo "Checking required environment variables..."
for var in "${REQUIRED[@]}"; do
  val="${!var-}"
  if [ -z "$val" ]; then
    printf "  [MISSING] %s\n" "$var"
  elif [[ "$val" == your-* || "$val" == https://your-project.supabase.co ]]; then
    printf "  [PLACEHOLDER] %s (still set to .env.example default)\n" "$var"
  else
    printf "  [OK]      %s\n" "$var"
  fi
done

echo
echo "Optional variables:"
for var in "${OPTIONAL[@]}"; do
  val="${!var-}"
  if [ -z "$val" ]; then
    printf "  [unset]   %s\n" "$var"
  else
    printf "  [OK]      %s\n" "$var"
  fi
done

if [ "${#missing[@]}" -gt 0 ] || [ "${#placeholder[@]}" -gt 0 ]; then
  echo
  echo "FAIL: ${#missing[@]} missing, ${#placeholder[@]} still using example placeholders."
  echo "Fix: copy .env.example to .env, edit it, then run:"
  echo "  set -a && source .env && set +a && ./scripts/check-env.sh"
  exit 1
fi

echo
echo "OK: all required environment variables are present."
