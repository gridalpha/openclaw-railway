#!/bin/sh
# OpenClaw gateway launcher for Railway.
# Runs as root (see Dockerfile), fixes the volume ownership, seeds the Control UI
# origin, then drops to the non-root `node` user to run the gateway.
set -eu

: "${OPENCLAW_STATE_DIR:=/data/.openclaw}"
: "${OPENCLAW_WORKSPACE_DIR:=/data/workspace}"
: "${OPENCLAW_AUTH_PROFILE_SECRET_DIR:=/data/.openclaw-auth-secrets}"
export OPENCLAW_STATE_DIR OPENCLAW_WORKSPACE_DIR OPENCLAW_AUTH_PROFILE_SECRET_DIR
export HOME=/home/node OPENCLAW_HOME=/home/node

# Railway mounts the volume root-owned; hand the persisted tree to `node` so the
# non-root gateway can read and write it (config, auth profiles, sessions).
mkdir -p "$OPENCLAW_STATE_DIR" "$OPENCLAW_WORKSPACE_DIR" "$OPENCLAW_AUTH_PROFILE_SECRET_DIR"
chown -R node:node /data
echo "openclaw-railway: boot uid=$(id -u); dropping to node (uid $(id -u node))"

# A non-loopback bind rejects unknown browser origins, so allow the Railway
# public domain. Run as `node` so the config file stays node-owned; merges a
# single key, so an operator's other config is preserved. Non-fatal.
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  if setpriv --reuid=node --regid=node --init-groups \
      node /app/openclaw.mjs config set gateway.controlUi.allowedOrigins \
      "[\"https://${RAILWAY_PUBLIC_DOMAIN}\"]" --strict-json; then
    echo "openclaw-railway: allowedOrigins -> https://${RAILWAY_PUBLIC_DOMAIN}"
  else
    echo "openclaw-railway: origin seed skipped (config set failed)"
  fi
fi

echo "openclaw-railway: launching gateway (bind=lan, port=${OPENCLAW_GATEWAY_PORT:-8080})"
echo "openclaw-railway: first-run — pair this browser once from the Railway shell:"
echo "                  railway shell -> 'openclaw dashboard --no-open' (opens a one-time pairing URL)"
exec setpriv --reuid=node --regid=node --init-groups \
  node /app/openclaw.mjs gateway --bind lan --allow-unconfigured
