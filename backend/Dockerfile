FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# `gosu` lets the entrypoint cleanly drop from root → app. Standard
# Debian-base hardening tool (~2 MB), used by half of Docker Hub.
# Remove apt lists right after install to keep the image lean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

# Non-root runtime user. Fixed UID 10001 keeps it well clear of host UIDs.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /sbin/nologin app

COPY requirements.txt .
# `-v` prints each package fetch so a stalled mirror is visible (instead of
# looking like an indefinite hang). The PIP_* envs above give wide margins
# for slow/flaky networks.
RUN pip install --no-cache-dir -v -r requirements.txt

COPY app ./app

# /data is the host-mounted volume target (sqlite db lives here). Pre-create
# and chown so the path exists at build time. RUNTIME ownership is reasserted
# by entrypoint.sh because bind-mounts inherit host filesystem ownership and
# this build-time chown gets shadowed.
RUN mkdir -p /data \
 && chown -R app:app /app /data

# Entrypoint runs as root so it can chown /data, then drops to app via gosu.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# IMPORTANT: do NOT set USER here. The container starts as root so the
# entrypoint can fix /data ownership; the entrypoint itself drops to UID
# 10001 via `gosu app` before exec'ing uvicorn, so the long-lived process
# is still unprivileged.

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
