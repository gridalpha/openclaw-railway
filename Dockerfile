# OpenClaw on Railway — thin wrapper over the upstream image.
#
# Adds a Caddy front-proxy and a tiny "setup" approver so the one-time device
# pairing can be done from the browser instead of the Railway shell:
#
#   Caddy (public $PORT)
#     ├── /setup*  → approver (token-gated: lists + approves pending pairings)
#     └── *        → OpenClaw gateway (Control UI, API, WebSocket)
#
# The gateway moves to an internal port; Caddy owns the public port and forwards
# X-Forwarded-* so the gateway still sees the real client (pairing stays required).
#
# Why the wrapper at all: Railway mounts volumes root-owned but the image runs as
# non-root `node`, so the entrypoint chowns /data as root then drops to `node`.
# No secrets are baked in — the gateway token is a Railway variable at runtime.
FROM caddy:2-alpine AS caddy

FROM openclaw/openclaw:latest

# Root only so the entrypoint can chown the mounted volume; it drops to the
# image's own `node` user (setpriv) before starting any long-running process.
USER root

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY Caddyfile /srv/Caddyfile
COPY approver.mjs /srv/approver.mjs
COPY entrypoint.sh /usr/local/bin/openclaw-railway-entrypoint.sh
RUN chmod +x /usr/local/bin/openclaw-railway-entrypoint.sh /usr/local/bin/caddy \
 && caddy validate --config /srv/Caddyfile --adapter caddyfile

# Keep the base image's tini as PID 1 (reaps tool/plugin child processes).
ENTRYPOINT ["tini", "-s", "--"]
CMD ["/usr/local/bin/openclaw-railway-entrypoint.sh"]
