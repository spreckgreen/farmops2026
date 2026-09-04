#!/usr/bin/env bash
# install-peer-sync-timer.sh — install the outside-the-database trigger for the
# automatic peer sync on a self-hosted FarmOps host.
#
# Self-hosted Postgres normally has no pg_cron, so the in-database schedule is
# skipped and something on the host has to hit the hook endpoint. This installs
# either a systemd timer (preferred) or a crontab line that runs
# scripts/peer-sync-tick.sh every N minutes.
#
# Usage:
#   sudo ./scripts/install-peer-sync-timer.sh                  # systemd, every 15 min
#   sudo ./scripts/install-peer-sync-timer.sh --interval 5
#   ./scripts/install-peer-sync-timer.sh --cron                # crontab for current user
#   ./scripts/install-peer-sync-timer.sh --status
#   sudo ./scripts/install-peer-sync-timer.sh --uninstall
#
# Options:
#   --interval N     minutes between runs (default 15)
#   --env-file PATH  env file with PUBLIC_APP_URL + ELECTRICAL_PEER_SYNC_CRON_SECRET
#                    (default: <repo>/.env.local)
#   --cron           use crontab instead of systemd
#   --status         show current installation + last run, then exit
#   --uninstall      remove the timer/cron entry
#
# Example (systemd): creates farmops-peer-sync.service + .timer, then
#   journalctl -u farmops-peer-sync -n 50

set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
TICK="$REPO/scripts/peer-sync-tick.sh"
ENV_FILE="$REPO/.env.local"
INTERVAL=15
MODE="systemd"
ACTION="install"
UNIT="farmops-peer-sync"
CRON_TAG="# farmops-peer-sync"

while [ $# -gt 0 ]; do
  case "$1" in
    --interval)  INTERVAL="$2"; shift 2 ;;
    --env-file)  ENV_FILE="$2"; shift 2 ;;
    --cron)      MODE="cron"; shift ;;
    --status)    ACTION="status"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)   sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

chmod +x "$TICK" 2>/dev/null || true

case "$INTERVAL" in
  ''|*[!0-9]*) echo "--interval must be whole minutes, e.g. 15" >&2; exit 1 ;;
esac
[ "$INTERVAL" -ge 1 ] || { echo "--interval must be at least 1" >&2; exit 1; }

have_systemd() { command -v systemctl >/dev/null 2>&1; }

status() {
  echo "repo:      $REPO"
  echo "env file:  $ENV_FILE $( [ -f "$ENV_FILE" ] && echo '(present)' || echo '(MISSING)')"
  if have_systemd && systemctl list-unit-files "$UNIT.timer" >/dev/null 2>&1 \
     && systemctl cat "$UNIT.timer" >/dev/null 2>&1; then
    echo "systemd:   installed"
    systemctl list-timers "$UNIT.timer" --no-pager 2>/dev/null | sed -n '1,3p' || true
    echo "last run:"
    journalctl -u "$UNIT" -n 5 --no-pager 2>/dev/null || echo "  (no journal access)"
  else
    echo "systemd:   not installed"
  fi
  if crontab -l 2>/dev/null | grep -Fq "$CRON_TAG"; then
    echo "crontab:   installed"
    crontab -l 2>/dev/null | grep -F "$CRON_TAG"
  else
    echo "crontab:   not installed"
  fi
}

uninstall() {
  if have_systemd; then
    systemctl disable --now "$UNIT.timer" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$UNIT.timer" "/etc/systemd/system/$UNIT.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
    echo "removed systemd timer (if it was installed)"
  fi
  if crontab -l 2>/dev/null | grep -Fq "$CRON_TAG"; then
    crontab -l 2>/dev/null | grep -Fv "$CRON_TAG" | crontab -
    echo "removed crontab entry"
  fi
}

install_systemd() {
  [ "$(id -u)" -eq 0 ] || { echo "systemd install needs root — re-run with sudo, or use --cron" >&2; exit 1; }
  RUN_USER="${SUDO_USER:-root}"
  cat > "/etc/systemd/system/$UNIT.service" <<UNITEOF
[Unit]
Description=FarmOps automatic peer audit-batch pull (preview only)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO
ExecStart=$TICK --env-file $ENV_FILE --quiet
UNITEOF

  cat > "/etc/systemd/system/$UNIT.timer" <<UNITEOF
[Unit]
Description=Run the FarmOps peer audit-batch pull every $INTERVAL minute(s)

[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL}min
AccuracySec=30s
Persistent=true
Unit=$UNIT.service

[Install]
WantedBy=timers.target
UNITEOF

  systemctl daemon-reload
  systemctl enable --now "$UNIT.timer"
  echo "installed $UNIT.timer (every ${INTERVAL}m, running as $RUN_USER)"
  echo "logs: journalctl -u $UNIT -f"
}

install_cron() {
  if [ "$INTERVAL" -lt 60 ]; then
    SPEC="*/$INTERVAL * * * *"
  else
    SPEC="0 */$((INTERVAL / 60)) * * *"
  fi
  LINE="$SPEC cd $REPO && $TICK --env-file $ENV_FILE --quiet >> /tmp/farmops-peer-sync.log 2>&1 $CRON_TAG"
  { crontab -l 2>/dev/null | grep -Fv "$CRON_TAG" || true; echo "$LINE"; } | crontab -
  echo "installed crontab entry ($SPEC)"
  echo "logs: tail -f /tmp/farmops-peer-sync.log"
}

case "$ACTION" in
  status)    status; exit 0 ;;
  uninstall) uninstall; exit 0 ;;
esac

[ -f "$TICK" ] || { echo "missing $TICK" >&2; exit 1; }
if [ ! -f "$ENV_FILE" ]; then
  echo "warning: $ENV_FILE does not exist yet — the trigger will fail until it holds" >&2
  echo "         PUBLIC_APP_URL and ELECTRICAL_PEER_SYNC_CRON_SECRET." >&2
fi

# One dry run first, so a bad key or URL is visible now rather than silently in a timer.
echo "-- test run --"
if "$TICK" --env-file "$ENV_FILE"; then
  echo "-- test run ok --"
else
  echo "-- test run failed (installing anyway; fix the env file and the next tick will succeed) --" >&2
fi

if [ "$MODE" = "systemd" ] && have_systemd; then
  install_systemd
else
  [ "$MODE" = "systemd" ] && echo "systemd not available — falling back to crontab"
  install_cron
fi
