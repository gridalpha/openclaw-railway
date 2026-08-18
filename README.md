# OpenClaw on Railway

A wrapper image for deploying [OpenClaw](https://github.com/openclaw/openclaw) —
a personal AI assistant gateway — on [Railway](https://railway.com).

It builds `FROM openclaw/openclaw:latest`, adapts the image to Railway's runtime,
and adds a small browser-based helper for the one-time device pairing. No secrets
are baked in.

## Architecture

A single container runs three processes behind Caddy:

```
Caddy (public $PORT)
  ├── /setup*  → approver   (token-gated: approve Control UI pairing from the browser)
  └── *        → OpenClaw gateway (Control UI, API, WebSocket) on an internal port
```

- **Volume ownership.** Railway mounts volumes root-owned; the upstream image runs
  as non-root `node`. The entrypoint chowns `/data` as root, then drops to `node`
  (`setpriv`) before starting anything — so nothing long-running is root.
- **Control UI origin.** A non-loopback bind rejects unknown browser origins, so the
  entrypoint seeds `gateway.controlUi.allowedOrigins` from `RAILWAY_PUBLIC_DOMAIN`.
- **Caddy** owns the public port, forwards `X-Forwarded-*` (so the gateway still sees
  the real client and keeps requiring pairing), and proxies the Control UI WebSocket.

## Pairing from the browser (`/setup`)

OpenClaw requires a one-time device pairing for each browser, even with a valid
token. Instead of the Railway shell, use the built-in helper:

1. Open the **Control UI** (`/openclaw`), paste your `OPENCLAW_GATEWAY_TOKEN`, click
   **Connect** → it shows "Device pairing required".
2. Open **`/setup`**, paste the same token, and **Approve** the pending request.
3. Back in the Control UI, click **Connect** again.

On a fresh instance the site root (`/`) redirects to `/setup` automatically until
the first device is paired; after that, `/` goes to the Control UI.

The `/setup` endpoint is token-gated — approving a device grants full operator
access, so it demands the same gateway token before listing or approving anything.
Only the device pairing happens here; channels and the model provider are set up
inside the OpenClaw Control UI after pairing.

## Files

- `Dockerfile` — builds `FROM openclaw/openclaw:latest`, adds Caddy + the helper.
- `entrypoint.sh` — chowns the volume, drops to `node`, supervises the 3 processes.
- `Caddyfile` — routes `/`, `/setup*`, and everything else.
- `approver.mjs` — the token-gated pairing server (logic only).
- `setup.html` — the `/setup` page markup, served by `approver.mjs`.

## Required variables

| Variable | Purpose |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` | Admin secret protecting the gateway. `openssl rand -hex 32`. |
| `PORT` | Public port Caddy listens on (e.g. `8080`); target the domain here. |
| `OPENCLAW_GATEWAY_PORT` | Internal port the gateway listens on (e.g. `8081`). |
| `OPENCLAW_STATE_DIR` | Persisted config/auth/sessions. `/data/.openclaw`. |
| `OPENCLAW_WORKSPACE_DIR` | Persisted workspace. `/data/workspace`. |
| `OPENCLAW_AUTH_PROFILE_SECRET_DIR` | Persisted auth-profile keys. `/data/.openclaw-auth-secrets`. |

Attach a volume at `/data` and enable public networking on `PORT`. After pairing,
add a model-provider key in the Control UI's Settings so the assistant can reply.

## License

The wrapper (this repo) is provided as-is. OpenClaw itself is MIT-licensed by the
OpenClaw Foundation.
