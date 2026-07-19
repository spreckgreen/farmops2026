#!/usr/bin/env bash
# Installs a pre-commit hook that runs scripts/scan-secrets.sh against staged files.
set -euo pipefail

HOOK_DIR="$(git rev-parse --git-path hooks)"
HOOK_FILE="$HOOK_DIR/pre-commit"

mkdir -p "$HOOK_DIR"
cat > "$HOOK_FILE" <<'HOOK'
#!/usr/bin/env bash
# Auto-installed by scripts/install-git-hooks.sh
exec ./scripts/scan-secrets.sh
HOOK
chmod +x "$HOOK_FILE"
echo "Installed pre-commit hook at $HOOK_FILE"
