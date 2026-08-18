# OpenClaw on Railway

A thin wrapper image for deploying [OpenClaw](https://github.com/openclaw/openclaw)
— a personal AI assistant gateway — on [Railway](https://railway.com).

It builds `FROM openclaw/openclaw:latest` and adds a small entrypoint that adapts
the image to Railway's runtime, without baking in any secrets.

## What the entrypoint does

1. **Volume ownership.** Railway mounts volumes root-owned, while the upstream
   image runs as the non-root `node` user. The entrypoint (running as root only
   for this step) `chown`s the `/data` volume to `node`, then **drops back to
   `node`** with `setpriv` before launching the gateway — so the long-running
   process is never root.
2. **Control UI origin.** A non-loopback gateway bind rejects unknown browser
   origins. The entrypoint seeds `gateway.controlUi.allowedOrigins` from
   `RAILWAY_PUBLIC_DOMAIN` so the hosted Control UI is accepted.
3. **Launch.** Starts the gateway bound to `lan` on `OPENCLAW_GATEWAY_PORT`.

## Required variables

| Variable | Purpose |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Admin secret that protects the gateway. Generate with `openssl rand -hex 32`. |
| `OPENCLAW_GATEWAY_PORT` | HTTP port the gateway listens on (e.g. `8080`); also set Railway `PORT` to match and target the public domain at it. |
| `OPENCLAW_STATE_DIR` | Persisted config/auth/sessions. Set to `/data/.openclaw`. |
| `OPENCLAW_WORKSPACE_DIR` | Persisted workspace. Set to `/data/workspace`. |
| `OPENCLAW_AUTH_PROFILE_SECRET_DIR` | Persisted auth-profile encryption keys. Set to `/data/.openclaw-auth-secrets`. |

Attach a volume at `/data` and enable public networking on the gateway port.

## First-run pairing

For security, OpenClaw's Control UI requires a **one-time device pairing** for
each browser, even with a valid token. After deploying, open the Railway shell for
the service and run:

```
openclaw dashboard --no-open
```

Open the printed one-time URL in your browser to pair it as the owner. See the
[OpenClaw device pairing docs](https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection).

## License

The wrapper (this repo) is provided as-is. OpenClaw itself is MIT-licensed by the
OpenClaw Foundation.
