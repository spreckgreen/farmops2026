#!/usr/bin/env bash
# check-env.sh — verifies required environment variables are present before
# running the Node.js quickstart (or systemd service).
#
# Usage:
#   ./scripts/check-env.sh                    # auto: .env.local (if present) else .env, else current shell env
#   ./scripts/check-env.sh --env-file .env    # parse a specific file
#   set -a && source .env && set +a && ./scripts/check-env.sh
#
# Exits 0 if everything required is set to a real value, 1 otherwise.
# Never prints values. Robust .env parser supports:
#   - blank lines and full-line comments (# ...)
#   - optional leading `export `
#   - single-quoted values (literal — no expansion, no escapes)
#   - double-quoted values (with \n \r \t \\ \" escapes)
#   - unquoted values (inline `#` starts a comment when preceded by whitespace)
#   - CRLF line endings (Windows-edited .env files)

set -u

REQUIRED=(
  VITE_SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY
  VITE_SUPABASE_PROJECT_ID
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  VAULT_ENCRYPTION_KEY
)

OPTIONAL=(
  NODE_ENV
  PORT
  CUSTOM_AI_BASE_URL
)
# LOVABLE_API_KEY is finalized as REQUIRED/OPTIONAL AFTER env file is loaded,
# so SELF_HOST_MODE from the file (not just the ambient shell) is honored.

env_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      env_file="${2-}"
      shift 2
      ;;
    --env-file=*)
      env_file="${1#--env-file=}"
      shift
      ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# Auto-select: prefer .env.local (gitignored, holds real self-hosted keys)
# over the tracked .env (Lovable Cloud publishable-only).
if [ -z "$env_file" ]; then
  if [ -f .env.local ]; then
    env_file=".env.local"
    echo "check-env: auto-selected .env.local"
  elif [ -f .env ]; then
    env_file=".env"
    echo "check-env: auto-selected .env"
  fi
fi

# Parse a single quoted/unquoted value. Echoes the decoded value on stdout.
# Args: $1 = raw RHS (after `KEY=`)
parse_value() {
  local raw="$1"
  # Strip trailing CR (CRLF)
  raw="${raw%$'\r'}"
  # Trim leading whitespace
  raw="${raw#"${raw%%[![:space:]]*}"}"

  if [ -z "$raw" ]; then
    printf '%s' ''
    return
  fi

  local first="${raw:0:1}"
  if [ "$first" = "'" ]; then
    # Single-quoted: literal until next single quote
    local rest="${raw:1}"
    local closing="${rest%%\'*}"
    printf '%s' "$closing"
  elif [ "$first" = '"' ]; then
    # Double-quoted: scan char by char honoring backslash escapes
    local rest="${raw:1}"
    local out=""
    local i=0 len=${#rest} c next
    while [ $i -lt $len ]; do
      c="${rest:$i:1}"
      if [ "$c" = '\' ] && [ $((i + 1)) -lt $len ]; then
        next="${rest:$((i+1)):1}"
        case "$next" in
          n)  out+=$'\n' ;;
          r)  out+=$'\r' ;;
          t)  out+=$'\t' ;;
          \\) out+='\' ;;
          \") out+='"' ;;
          *)  out+="$next" ;;
        esac
        i=$((i + 2))
        continue
      fi
      if [ "$c" = '"' ]; then
        break
      fi
      out+="$c"
      i=$((i + 1))
    done
    printf '%s' "$out"
  else
    # Unquoted: strip inline comment (` #...` — hash preceded by whitespace)
    # then trim trailing whitespace.
    local stripped
    # shellcheck disable=SC2001
    stripped="$(printf '%s' "$raw" | sed -E 's/[[:space:]]+#.*$//')"
    stripped="${stripped%"${stripped##*[![:space:]]}"}"
    printf '%s' "$stripped"
  fi
}

load_env_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Env file not found: $file" >&2
    exit 2
  fi
  if [ ! -r "$file" ]; then
    echo "Env file exists but is NOT readable by uid=$(id -u) ($(id -un)): $file" >&2
    echo "  ls -l: $(ls -l "$file" 2>/dev/null || echo '???')" >&2
    echo "  Fix:  sudo chown $(id -un): \"$file\" && sudo chmod 600 \"$file\"" >&2
    echo "  Or run this script with sudo (e.g. 'sudo ./scripts/refresh.sh …')." >&2
    exit 2
  fi
  local loaded=0
  local lineno=0 line key rhs val
  # Strip UTF-8 BOM on the first line if present (common when .env is edited
  # in a Windows GUI editor — the BOM turns the first key into "\xef\xbb\xbfKEY"
  # which then never matches the REQUIRED list).
  local __bom_stripped=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    # Strip CR (CRLF)
    line="${line%$'\r'}"
    # Trim leading whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    # Skip blank lines and full-line comments
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    # Strip optional `export ` prefix
    case "$line" in
      export\ *|export$'\t'*) line="${line#export}"; line="${line#"${line%%[![:space:]]*}"}" ;;
    esac
    # Must contain `=`
    case "$line" in
      *=*) ;;
      *) echo "Warning: skipping malformed line $lineno in $file" >&2; continue ;;
    esac
    key="${line%%=*}"
    rhs="${line#*=}"
    # Trim trailing whitespace from key
    key="${key%"${key##*[![:space:]]}"}"
    # Validate key shape
    case "$key" in
      [A-Za-z_]*) ;;
      *) echo "Warning: skipping invalid key on line $lineno: $key" >&2; continue ;;
    esac
    val="$(parse_value "$rhs")"
    export "$key=$val"
  done < "$file"
}

if [ -n "$env_file" ]; then
  load_env_file "$env_file"
fi

# Finalize LOVABLE_API_KEY requirement now that SELF_HOST_MODE is loaded.
if [ "${SELF_HOST_MODE:-}" = "true" ]; then
  OPTIONAL+=(LOVABLE_API_KEY)
else
  REQUIRED+=(LOVABLE_API_KEY)
fi

is_placeholder() {
  local v="$1"
  case "$v" in
    your-*|https://your-project.supabase.co) return 0 ;;
    *CHANGE_ME*) return 0 ;;
    *supabase.example.com*) return 0 ;;
    *your-project-ref*) return 0 ;;
    *) return 1 ;;
  esac
}

missing=()
placeholder=()

echo "Checking required environment variables..."
for var in "${REQUIRED[@]}"; do
  val="${!var-}"
  if [ -z "$val" ]; then
    printf "  [MISSING]     %s\n" "$var"
    missing+=("$var")
  elif is_placeholder "$val"; then
    printf "  [PLACEHOLDER] %s (still set to .env.example default)\n" "$var"
    placeholder+=("$var")
  else
    printf "  [OK]          %s\n" "$var"
  fi
done

echo
echo "Optional variables:"
for var in "${OPTIONAL[@]}"; do
  val="${!var-}"
  if [ -z "$val" ]; then
    printf "  [unset]       %s\n" "$var"
  else
    printf "  [OK]          %s\n" "$var"
  fi
done

if [ "${#missing[@]}" -gt 0 ] || [ "${#placeholder[@]}" -gt 0 ]; then
  echo
  echo "FAIL: ${#missing[@]} missing, ${#placeholder[@]} still using example placeholders."
  echo "Fix: populate .env from your self-hosted Supabase project, then re-run:"
  echo "  sudo scripts/fill-env-from-supabase.sh    # auto-fill from docs/env.self-hosted-supabase.example.tmpl"
  echo "  ./scripts/check-env.sh --env-file .env"
  exit 1
fi

echo
echo "OK: all required environment variables are present."
