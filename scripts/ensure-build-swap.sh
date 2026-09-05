#!/usr/bin/env bash
# Give this machine permanent swap so the container build's final native
# bundler pass cannot be killed by the kernel.
#
# Run once, as root:   sudo ./scripts/ensure-build-swap.sh
# Optional size:       sudo ./scripts/ensure-build-swap.sh 8G
#
# Idempotent: if enough swap is already active it changes nothing.
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile-farmops}"
SIZE="${1:-6G}"
MIN_ACTIVE_MB="${MIN_ACTIVE_MB:-4096}"

log() { printf '[swap] %s\n' "$*"; }
die() { printf '[swap] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root: sudo $0 $*"

active_mb=$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo)
if [ "$active_mb" -ge "$MIN_ACTIVE_MB" ]; then
  log "already ${active_mb}MB of swap active — nothing to do"
  exit 0
fi

case "$SIZE" in
  *[Gg]) size_mb=$(( ${SIZE%[GgMm]} * 1024 )) ;;
  *[Mm]) size_mb=${SIZE%[GgMm]} ;;
  *)     size_mb="$SIZE" ;;
esac
free_mb=$(df -Pm "$(dirname "$SWAP_FILE")" | awk 'NR==2{print $4}')
[ "$free_mb" -ge $(( size_mb + 1024 )) ] || \
  die "only ${free_mb}MB free at $(dirname "$SWAP_FILE"); need $(( size_mb + 1024 ))MB for a ${SIZE} swap file (pass a smaller size, e.g. $0 3G)"

if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAP_FILE"; then
  log "$SWAP_FILE is already active; growing it requires swapoff first"
  swapoff "$SWAP_FILE"
fi

log "creating ${SIZE} swap file at $SWAP_FILE"
rm -f "$SWAP_FILE"
fallocate -l "$SIZE" "$SWAP_FILE" 2>/dev/null || \
  dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$size_mb" status=none
chmod 600 "$SWAP_FILE"
mkswap "$SWAP_FILE" >/dev/null
swapon "$SWAP_FILE"

# Survive reboots.
if ! grep -qs "^${SWAP_FILE}[[:space:]]" /etc/fstab; then
  printf '%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab
  log "added $SWAP_FILE to /etc/fstab so it survives reboots"
fi

# Only reach for swap under real pressure; keeps normal app latency unchanged.
sysctl -q -w vm.swappiness=10 || true
if [ -d /etc/sysctl.d ] && [ ! -f /etc/sysctl.d/99-farmops-swap.conf ]; then
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-farmops-swap.conf
fi

log "done — swap now: $(awk '/SwapTotal/{printf "%dMB", $2/1024}' /proc/meminfo)"
log "re-run the rebuild:  ./scripts/refresh.sh --force"
