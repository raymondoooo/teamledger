#!/bin/sh
set -e

# Why this exists at all:
#
# `RUN chown` in the Dockerfile is erased the moment a host bind mount lands on
# top of that path. Docker creates a missing host directory as **root**, so an
# app running as an unprivileged user cannot write to its own data directory —
# and the failure only appears once someone actually uploads something, long
# after "it worked on my machine".
#
# So: start as root, fix ownership of the paths that are actually mounted, then
# drop privileges for the real process.

APP_USER="${APP_USER:-node}"
DATA_DIR="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR/receipts"
  # -R is deliberate but only over the data directory: it is the sole writable
  # path, and it can contain files created by an earlier run as a different uid.
  chown -R "$APP_USER":"$APP_USER" "$DATA_DIR" 2>/dev/null || {
    echo "[entrypoint] warning: could not chown $DATA_DIR — uploads may fail."
    echo "[entrypoint] if this is a bind mount, run: chown -R 1000:1000 <host path>"
  }
  # exec so the app becomes PID 1 and receives SIGTERM directly; without it,
  # `docker stop` waits the full timeout and then kills the container.
  exec su-exec "$APP_USER" "$@"
fi

# Already unprivileged (e.g. `docker run --user`), nothing to fix.
exec "$@"
