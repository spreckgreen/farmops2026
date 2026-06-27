#!/usr/bin/env bash
# install-log.sh — unified installation logger.
#
# Wraps a single install/build stage, captures its output into a shared
# log file with timestamps and a stage tag, and on failure prints the
# captured tail plus any error-looking lines so the failure point is
# immediately visible in `docker build` or local install output.
#
# Usage:
#   scripts/install-log.sh <stage> <cmd> [args...]
#
# Env vars:
#   INSTALL_LOG   Path to the shared log file. Defaults to
#                 /tmp/bostead-install.log. Created if missing.
#   TAIL_LINES    Number of trailing lines to print on failure (default 80).
#   ERROR_GREP    Extended regex of "interesting" lines printed on failure.
#
# Exits with the wrapped command's status.
set -u

STAGE="${1:-unknown}"
shift || true

if [ "$#" -eq 0 ]; then
  echo "install-log.sh: missing command to run" >&2
  exit 2
fi

LOG="${INSTALL_LOG:-/tmp/bostead-install.log}"
TAIL_LINES="${TAIL_LINES:-80}"
ERROR_GREP="${ERROR_GREP:-error|failed|exception|cannot|not found|permission denied|sudo|authenticate|timeout|killed|oom|out of memory|heap|signal 9|exit(ed)? (with )?(code )?(137|134)|enospc|eacces}"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG" 2>/dev/null || {
  # Fall back to a writable location if INSTALL_LOG isn't writable.
  LOG="/tmp/bostead-install.log"
  touch "$LOG" 2>/dev/null || true
}

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
pad() { printf "%-14s" "[$1]"; }

START_TS=$(date +%s)
HEADER="[$(ts)] $(pad "$STAGE") START  $*"
echo "$HEADER" | tee -a "$LOG"

# Per-stage capture file so we can tail just this stage's output on failure
# without pulling in noise from earlier stages.
STAGE_LOG="$(mktemp -t "install-${STAGE}.XXXXXX.log" 2>/dev/null || echo "/tmp/install-${STAGE}.$$.log")"

# Run the command; tee to both stdout and the per-stage log. Also append
# every line to the shared log with the stage tag so the rollup file is
# greppable.
set -o pipefail
"$@" 2>&1 | tee "$STAGE_LOG" | while IFS= read -r line; do
  printf '[%s] %s %s\n' "$(ts)" "$(pad "$STAGE")" "$line" >> "$LOG"
done
# PIPESTATUS[0] reflects the wrapped command; bash-only but install-log.sh
# is invoked under bash from the Dockerfile and scripts/docker-preflight.sh.
STATUS=${PIPESTATUS[0]:-0}
set +o pipefail

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

if [ "$STATUS" -eq 0 ]; then
  FOOTER="[$(ts)] $(pad "$STAGE") OK     (${ELAPSED}s)"
  echo "$FOOTER" | tee -a "$LOG"
  rm -f "$STAGE_LOG" 2>/dev/null || true
  exit 0
fi

FOOTER="[$(ts)] $(pad "$STAGE") FAIL   exit=${STATUS} (${ELAPSED}s)"
echo "$FOOTER" | tee -a "$LOG" >&2

{
  echo ""
  echo "=== [install-log] stage '${STAGE}' failed — last ${TAIL_LINES} lines ==="
  tail -n "$TAIL_LINES" "$STAGE_LOG" 2>/dev/null || true
  echo ""
  echo "=== [install-log] error-looking lines from stage '${STAGE}' ==="
  grep -Ein "$ERROR_GREP" "$STAGE_LOG" 2>/dev/null | tail -n 40 || true
  echo ""
  echo "=== [install-log] full log: ${LOG}"
  echo "=== [install-log] stage log: ${STAGE_LOG} (preserved for inspection)"
} >&2

exit "$STATUS"
