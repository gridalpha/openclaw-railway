// OpenClaw pairing approver — a tiny, token-gated helper served at /setup.
//
// It lets the operator approve the one-time Control UI device pairing from the
// browser instead of the Railway shell. Every data/action endpoint requires the
// gateway token (constant-time checked against OPENCLAW_GATEWAY_TOKEN), so it is
// exactly as privileged as pairing itself — never expose it without the token.
//
// It runs INSIDE the gateway container and talks to the gateway over loopback,
// which is the only place `openclaw devices approve` carries operator.pairing.
//
// The page markup lives in ./setup.html; this file is only server logic.
import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";

const PORT = Number(process.env.APPROVER_PORT || 9090);
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const GATEWAY_URL = `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 8081}`;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HTML = fs.readFileSync(new URL("./setup.html", import.meta.url), "utf8");

function tokenOk(provided) {
  if (!TOKEN || typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Run the bundled OpenClaw CLI against the local gateway. --url disables env
// credential fallback, so --token is passed explicitly.
function devices(args) {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["/app/openclaw.mjs", "devices", ...args, "--url", GATEWAY_URL, "--token", TOKEN],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "" }),
    );
  });
}

// Whether the gateway already has at least one paired device. Used only to decide
// where the bare "/" sends a first-time visitor. Sticky once true, and short-TTL
// cached so a page load does not spawn the CLI on every request.
let pairedCache = { paired: false, sticky: false, ts: 0 };
async function hasPairedDevices() {
  if (pairedCache.sticky) return true;
  if (Date.now() - pairedCache.ts < 5000) return pairedCache.paired;
  const r = await devices(["list", "--json"]);
  if (r.code !== 0) return true; // on error, don't trap the user — treat as set up
  let paired = false;
  try {
    const d = JSON.parse(r.stdout);
    paired = Array.isArray(d?.paired) && d.paired.length > 0;
  } catch { /* fall through as not-paired */ }
  pairedCache = { paired, sticky: paired, ts: Date.now() };
  return paired;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "").split("?")[0];

  // Bare "/" — send first-time (unpaired) visitors to /setup, otherwise to the UI.
  if (req.method === "GET" && url === "/") {
    return redirect(res, (await hasPairedDevices()) ? "/openclaw" : "/setup");
  }

  if (req.method === "GET" && (url === "/setup" || url === "/setup/" || url === "/setup/index.html")) {
    return send(res, 200, HTML, "text/html; charset=utf-8");
  }

  // Everything below is token-gated.
  if (url.startsWith("/setup/api/")) {
    if (!tokenOk(req.headers["x-openclaw-token"])) return send(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && url === "/setup/api/pending") {
      const r = await devices(["list", "--json"]);
      if (r.code !== 0) return send(res, 502, { error: "devices list failed", detail: r.stderr.slice(0, 500) });
      let pending = [];
      try {
        const data = JSON.parse(r.stdout);
        pending = Array.isArray(data?.pending) ? data.pending : [];
      } catch {
        return send(res, 502, { error: "could not parse devices list" });
      }
      return send(res, 200, { pending });
    }

    if (req.method === "POST" && url === "/setup/api/approve") {
      const body = await readBody(req);
      let requestId = "";
      try { requestId = JSON.parse(body).requestId; } catch { /* ignore */ }
      if (!UUID_RE.test(requestId || "")) return send(res, 400, { error: "invalid requestId" });
      const r = await devices(["approve", requestId]);
      const out = (r.stdout + r.stderr).trim();
      if (r.code === 0 && /approv/i.test(out)) {
        pairedCache.sticky = true; // a device is now paired
        return send(res, 200, { ok: true, output: out.slice(0, 500) });
      }
      return send(res, 502, { ok: false, error: "approve failed", output: out.slice(0, 500) });
    }

    return send(res, 404, { error: "not found" });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`openclaw-railway: approver listening on 127.0.0.1:${PORT}`));
