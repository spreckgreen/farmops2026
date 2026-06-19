#!/bin/sh
# docker-entrypoint.sh
#
# Runs as root, fixes ownership of /app and any declared mount points to
# match the container's configured UID/GID, then drops privileges to
# `appuser` via gosu. This avoids manual `chown` steps on the host when
# bind-mounting directories into the container.
#
# Configuration (all optional, set via -e / environment in compose):
#   PUID         Numeric UID to run the app as. Defaults to baked-in UID.
#   PGID         Numeric GID to run the app as. Defaults to baked-in GID.
#   CHOWN_PATHS  Space-separated list of extra paths to chown on startup
#                (e.g. "/app/data /app/uploads"). /app is always included.
#   SKIP_CHOWN   Set to "1" to skip the chown step entirely (faster startup
#                when you know permissions are already correct).

set -e

APP_USER="appuser"
APP_GROUP="nodejs"

# Resolve target UID/GID: runtime override (PUID/PGID) wins over build-time.
TARGET_UID="${PUID:-$(id -u "${APP_USER}")}"
TARGET_GID="${PGID:-$(id -g "${APP_USER}")}"

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

    if [ "${SKIP_CHOWN}" != "1" ]; then
        # Always normalize /app, plus any caller-supplied mount paths.
        for path in /app ${CHOWN_PATHS}; do
            if [ -e "${path}" ]; then
                chown -R "${TARGET_UID}:${TARGET_GID}" "${path}" 2>/dev/null || \
                    echo "warn: could not chown ${path} (read-only mount?)" >&2
            fi
        done
    fi

    # Drop privileges and exec the real command as appuser.
    exec gosu "${APP_USER}" "$@"
fi

# Already non-root (e.g. `docker run --user 1000:1000 ...`): just exec.
exec "$@"
