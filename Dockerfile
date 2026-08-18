# OpenClaw on Railway — thin wrapper over the upstream image.
#
# Why this repo exists (things Railway's UI/variables cannot express):
#   1. Railway mounts volumes root-owned, but the upstream image runs as the
#      non-root `node` user, so `node` cannot write /data. The entrypoint chowns
#      the volume as root and then drops back to `node` before launching — which
#      keeps the gateway non-root (the image's own security posture) instead of
#      running everything as root via RAILWAY_RUN_UID=0.
#   2. A non-loopback Control UI bind rejects unknown browser origins, so the
#      entrypoint seeds gateway.controlUi.allowedOrigins from the Railway public
#      domain at boot.
#
# No secrets are baked in: the gateway token is supplied as a Railway variable
# (OPENCLAW_GATEWAY_TOKEN) at runtime.
FROM openclaw/openclaw:latest

# Root is needed ONLY so the entrypoint can chown the mounted volume. The
# entrypoint drops back to the image's own `node` user (via setpriv) before it
# exec's the gateway, so the long-running process is never root.
USER root

COPY entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint.sh
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint.sh

# Keep the base image's tini as PID 1 (reaps tool/plugin child processes).
ENTRYPOINT ["tini", "-s", "--"]
CMD ["/usr/local/bin/openclaw-railway-entrypoint.sh"]
