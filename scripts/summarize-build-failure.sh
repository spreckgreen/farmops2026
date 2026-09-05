#!/usr/bin/env bash
# Summarize the latest install.log and build-with-progress output for a failed Docker build.
# Usage: scripts/summarize-build-failure.sh <logs-dir> [output-file]
#
# Reads:   <logs-dir>/install.log, <logs-dir>/docker-build.log
# Writes:  <output-file> (default: <logs-dir>/build-failure-summary.md)
# Also tees the summary to stdout so it appears in the CI job log.

set -u

LOGS_DIR="${1:-./logs}"
OUT_FILE="${2:-$LOGS_DIR/build-failure-summary.md}"
INSTALL_LOG="$LOGS_DIR/install.log"
BUILD_LOG="$LOGS_DIR/docker-build.log"

mkdir -p "$LOGS_DIR"

emit() { printf '%s\n' "$*" >> "$OUT_FILE"; printf '%s\n' "$*"; }

: > "$OUT_FILE"

emit "# Docker Build Failure Summary"
emit ""
emit "_Generated: $(date -u +'%Y-%m-%dT%H:%M:%SZ')_"
emit ""

# ---- install.log ----
emit "## install.log"
if [ -s "$INSTALL_LOG" ]; then
  lines=$(wc -l < "$INSTALL_LOG" | tr -d ' ')
  emit "- path: \`$INSTALL_LOG\` (${lines} lines)"
  emit ""
  emit "### Last 80 lines"
  emit '```'
  tail -n 80 "$INSTALL_LOG" >> "$OUT_FILE"
  emit '```'
  emit ""
  emit "### Error / OOM matches"
  emit '```'
  grep -nE 'ERROR|error |FATAL|Killed|signal 9|exit (1|137)|oom|out of memory|heap|stall|timed? out|ENOENT|EACCES|Cannot find module' \
    "$INSTALL_LOG" | tail -n 40 >> "$OUT_FILE" || echo "(no matches)" >> "$OUT_FILE"
  emit '```'
else
  emit "- install.log missing or empty"
fi
emit ""

# ---- build-with-progress markers ----
emit "## build-with-progress output"
SRC=""
[ -s "$BUILD_LOG" ] && SRC="$BUILD_LOG"
[ -z "$SRC" ] && [ -s "$INSTALL_LOG" ] && SRC="$INSTALL_LOG"

if [ -n "$SRC" ]; then
  emit "- source: \`$SRC\`"
  emit ""
  emit "### Phase markers"
  emit '```'
  grep -nE '\[build(:ci)?\]|\[phase\]|heartbeat|wrapper-rss|host-avail|likely OOM|stalled' \
    "$SRC" | tail -n 60 >> "$OUT_FILE" || echo "(no markers found)" >> "$OUT_FILE"
  emit '```'
  emit ""
  emit "### Last phase before failure"
  last_phase=$(grep -nE '\[phase\]|\[build(:ci)?\]' "$SRC" | tail -n 1)
  emit "- ${last_phase:-unknown}"
else
  emit "- no build log captured"
fi
emit ""

emit "## Next steps"
emit "- If \`likely OOM\`, \`Killed\`, or \`exit 137\` appears: stop the local AI service during the build or provide swap; lowering the JavaScript heap does not cap native bundler memory."
emit "- If the last phase is Rollup transform and no OOM hint: try \`BUILD_LOW_MEM=1\` (already default in Docker) and re-run."
emit "- Full logs are in the \`docker-install-log\` artifact."

echo ""
echo "Wrote summary: $OUT_FILE"
