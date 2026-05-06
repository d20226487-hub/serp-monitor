#!/bin/sh
# Entrypoint for the SERP Monitor API container.
#
# We start as root just long enough to ensure /data is writable by the app
# user, then drop to UID 10001 via gosu before exec'ing the real command.
#
# Why: /data is bind-mounted from the host. Its ownership comes from the
# host filesystem and may not match the container's `app` user — common on
# fresh clones, after rebuilds, or after switching the Dockerfile's USER
# directive. Without this fixup, the api container hits "attempt to write
# a readonly database" the moment APScheduler tries to persist a job.
#
# Idempotent: chown is a no-op when ownership is already correct, so this
# adds no measurable startup overhead on warm reboots.

set -e

# Fix /data ownership if mounted. `|| true` guards against read-only or
# unusual host volumes (Docker Desktop on macOS, some Kubernetes setups)
# where chown isn't permitted; the container can still try and may succeed
# in normal operation thereafter.
if [ -d /data ]; then
    chown -R app:app /data 2>/dev/null || true
fi

# Drop privileges and replace this shell with the actual server process.
# `exec` matters: signals from `docker stop` reach uvicorn directly,
# graceful shutdown works, no extra PID 1 wrapper.
exec gosu app "$@"
