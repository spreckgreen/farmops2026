#!/usr/bin/env bash
# Verifies docs/env.self-hosted-supabase.example is gitignored and NOT tracked.
# Exits non-zero if the file is tracked or missing from .gitignore.
set -euo pipefail

TARGET="docs/env.self-hosted-supabase.example"
GITIGNORE=".gitignore"
FAIL=0

echo "==> Verifying $TARGET is properly excluded from git"

# 1. Present in .gitignore (exact line match, ignoring comments/whitespace)
if grep -Fxq "$TARGET" "$GITIGNORE"; then
  echo "  [PASS] Listed in $GITIGNORE"
else
  echo "  [FAIL] Missing from $GITIGNORE (expected literal line: $TARGET)"
  FAIL=1
fi

# 2. Not tracked in the repo index
if git ls-files --error-unmatch "$TARGET" >/dev/null 2>&1; then
  echo "  [FAIL] File IS tracked in git. Untrack with:"
  echo "         git rm --cached $TARGET"
  FAIL=1
else
  echo "  [PASS] Not tracked in git index"
fi

# 3. git check-ignore confirms the ignore rule matches (only when file exists on disk)
if [ -e "$TARGET" ]; then
  if git check-ignore -q "$TARGET"; then
    echo "  [PASS] git check-ignore matches the rule"
  else
    echo "  [FAIL] File exists on disk but git check-ignore does not match"
    FAIL=1
  fi
else
  echo "  [INFO] $TARGET not present on disk (skipping check-ignore probe)"
fi

# 4. Template counterpart SHOULD be tracked
TMPL="docs/env.self-hosted-supabase.example.tmpl"
if git ls-files --error-unmatch "$TMPL" >/dev/null 2>&1; then
  echo "  [PASS] Template $TMPL is tracked"
else
  echo "  [WARN] Template $TMPL is not tracked in git"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "==> FAIL: $TARGET is not properly gitignored"
  exit 1
fi

echo "==> OK: $TARGET is gitignored and untracked"
