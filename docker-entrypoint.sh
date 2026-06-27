#!/bin/sh
# docker-entrypoint.sh
#
# Runs as root, fixes ownership of declared mount points to match the
# container's configured UID/GID, then drops privileges to `appuser`
# via gosu. This avoids manual `chown` steps on the host when
# bind-mounting directories into the container.
#
# Configuration (all optional, set via -e / environment in compose):
#   PUID         Numeric UID to run the app as. Defaults to baked-in UID.
#   PGID         Numeric GID to run the app as. Defaults to baked-in GID.
#   CHOWN_PATHS  Space-separated list of paths to chown on startup.
#                Defaults to "/app/data /app/uploads".
#   SKIP_CHOWN   Set to "1" to skip the chown step entirely (faster startup
#                when you know permissions are already correct).

set -e

APP_USER="appuser"
APP_GROUP="nodejs"

# Resolve target UID/GID: runtime override (PUID/PGID) wins over build-time.
TARGET_UID="${PUID:-$(id -u "${APP_USER}")}"
TARGET_GID="${PGID:-$(id -g "${APP_USER}")}"

# Default mount points to fix. Override via CHOWN_PATHS if you bind-mount
# different paths. Set CHOWN_PATHS="" to disable defaults and only chown
# explicitly listed paths.
DEFAULT_CHOWN_PATHS="/app/data /app/uploads"

# Combine defaults with caller-supplied paths.
if [ -n "${CHOWN_PATHS+x}" ]; then
    # CHOWN_PATHS is explicitly set (even if empty) — use it as-is.
    CHOWN_LIST="${CHOWN_PATHS}"
else
    CHOWN_LIST="${DEFAULT_CHOWN_PATHS}"
fi

if [ "$(id -u)" = "0" ]; then
    CURRENT_UID="$(id -u "${APP_USER}")"
    CURRENT_GID="$(id -g "${APP_USER}")"

    # Re-map appuser/nodejs to the requested UID/GID if they differ.
    if [ "${CURRENT_GID}" != "${TARGET_GID}" ]; then
        groupmod -o -g "${TARGET_GID}" "${APP_GROUP}"
    fi
    if [ "${CURRENT_UID}" != "${TARGET_UID}" ]; then
        usermod -o -u "${TARGET_UID}" -g "${TARGET_GID}" "${APP_USER}"
    fi

    # Surface the build-time install log on the host bind mount, if present,
    # so failures and successes from `docker build` are visible from the host
    # via `tail -f ./logs/install.log` even after the image is shipped.
    if [ -d /var/log/bostead ]; then
        if [ -f /app/install.log ]; then
            cp /app/install.log /var/log/bostead/install.log 2>/dev/null || \
                echo "warn: could not copy /app/install.log to /var/log/bostead/" >&2
            chown "${TARGET_UID}:${TARGET_GID}" /var/log/bostead/install.log 2>/dev/null || true
            echo "=== [entrypoint] Install log copied to /var/log/bostead/install.log ==="
        fi
        chown "${TARGET_UID}:${TARGET_GID}" /var/log/bostead 2>/dev/null || true
    fi


    if [ "${SKIP_CHOWN}" != "1" ]; then
        for path in ${CHOWN_LIST}; do
            # Only chown paths that actually exist.
            if [ -e "${path}" ]; then
                # Skip if ownership is already correct (saves I/O on restarts).
                CUR_OWN="$(stat -c '%u:%g' "${path}" 2>/dev/null || true)"
                if [ "${CUR_OWN}" = "${TARGET_UID}:${TARGET_GID}" ]; then
                    continue
                fi
                chown -R "${TARGET_UID}:${TARGET_GID}" "${path}" 2>/dev/null || \
                    echo "warn: could not chown ${path} (read-only mount?)" >&2
            fi
        done
    fi

    # Drop privileges and exec the real command as appuser.
    echo "=== [entrypoint] Starting app as ${APP_USER} (uid=${TARGET_UID} gid=${TARGET_GID}) ==="
    echo "=== [entrypoint] HOST=${HOST:-<unset>} PORT=${PORT:-<unset>} NODE_ENV=${NODE_ENV:-<unset>} ==="
    echo "=== [entrypoint] CMD: $* ==="
    exec gosu "${APP_USER}" "$@"
fi

# Already non-root (e.g. `docker run --user 1000:1000 ...`): just exec.
echo "=== [entrypoint] Starting app as $(id -un) (uid=$(id -u) gid=$(id -g)) ==="
echo "=== [entrypoint] HOST=${HOST:-<unset>} PORT=${PORT:-<unset>} NODE_ENV=${NODE_ENV:-<unset>} ==="
echo "=== [entrypoint] CMD: $* ==="
exec "$@"


