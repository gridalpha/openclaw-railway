#!/bin/bash
# OpenClaw gateway launcher for Railway.
# Runs first as root (see Dockerfile) to fix the volume ownership, then re-execs
# itself as the non-root `node` user and supervises three processes:
#   caddy (public $PORT)  ·  approver (/setup)  ·  openclaw gateway
set -eu

export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
export OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
export OPENCLAW_AUTH_PROFILE_SECRET_DIR="${OPENCLAW_AUTH_PROFILE_SECRET_DIR:-/data/.openclaw-auth-secrets}"
export HOME=/home/node OPENCLAW_HOME=/home/node
export OPENCLAW_GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-8081}"
export APPROVER_PORT="${APPROVER_PORT:-9090}"

# ---- root phase: hand the volume to node, then drop privileges ----
if [ "$(id -u)" = "0" ]; then
	mkdir -p "$OPENCLAW_STATE_DIR" "$OPENCLAW_WORKSPACE_DIR" "$OPENCLAW_AUTH_PROFILE_SECRET_DIR" /tmp/caddy
	chown -R node:node /data /tmp/caddy
	echo "openclaw-railway: boot uid=0; chowned /data; dropping to node (uid $(id -u node))"
	exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

# ---- node phase ----
echo "openclaw-railway: running as uid=$(id -u)"

# A non-loopback Control UI bind rejects unknown browser origins, so allow the
# Railway public domain. Merges one config key, preserving other operator config.
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
	if node /app/openclaw.mjs config set gateway.controlUi.allowedOrigins \
		"[\"https://${RAILWAY_PUBLIC_DOMAIN}\"]" --strict-json; then
		echo "openclaw-railway: allowedOrigins -> https://${RAILWAY_PUBLIC_DOMAIN}"
	else
		echo "openclaw-railway: origin seed skipped (config set failed)"
	fi
fi

# If any supervised process exits, tear the rest down so Railway restarts the
# container (restart policy ALWAYS) rather than leaving it half-running.
term() { trap - TERM INT; echo "openclaw-railway: shutting down"; kill -TERM 0 2>/dev/null || true; wait 2>/dev/null || true; exit 0; }
trap term TERM INT

echo "openclaw-railway: caddy(:${PORT:-8080}) + approver(:${APPROVER_PORT}) + gateway(:${OPENCLAW_GATEWAY_PORT})"
caddy run --config /srv/Caddyfile --adapter caddyfile &
node /srv/approver.mjs &
node /app/openclaw.mjs gateway --bind lan --allow-unconfigured --port "${OPENCLAW_GATEWAY_PORT}" &

wait -n || true
echo "openclaw-railway: a component exited; stopping container for restart"
kill -TERM 0 2>/dev/null || true
wait 2>/dev/null || true
exit 1
