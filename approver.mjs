// OpenClaw pairing approver — a tiny, token-gated helper served at /setup.
//
// It lets the operator approve the one-time Control UI device pairing from the
// browser instead of the Railway shell. Every data/action endpoint requires the
// gateway token (constant-time checked against OPENCLAW_GATEWAY_TOKEN), so it is
// exactly as privileged as pairing itself — never expose it without the token.
//
// It runs INSIDE the gateway container and talks to the gateway over loopback,
// which is the only place `openclaw devices approve` carries operator.pairing.
import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

const PORT = Number(process.env.APPROVER_PORT || 9090);
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const GATEWAY_URL = `ws://127.0.0.1:${process.env.OPENCLAW_GATEWAY_PORT || 8081}`;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
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

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>OpenClaw · Pair a device</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0b0b0d;color:#e7e7ea;font:15px/1.5 system-ui,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:32px 20px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#9a9aa2;margin:0 0 24px}
  .card{background:#141419;border:1px solid #26262e;border-radius:12px;padding:18px;margin-bottom:16px}
  label{display:block;font-size:13px;color:#b9b9c2;margin-bottom:6px}
  input{width:100%;box-sizing:border-box;background:#0b0b0d;border:1px solid #33333d;border-radius:8px;color:#e7e7ea;padding:10px 12px;font:inherit}
  button{background:#ff5a5f;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer}
  button.secondary{background:#26262e;color:#e7e7ea}
  button:disabled{opacity:.5;cursor:default}
  ol{margin:0 0 8px;padding-left:20px;color:#c7c7d0} ol a{color:#ff8a8d}
  .req{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #26262e;border-radius:8px;padding:12px;margin-top:10px}
  .req .meta{font-size:13px;color:#b9b9c2;word-break:break-all}
  .mono{font-family:ui-monospace,monospace}
  .msg{margin-top:12px;font-size:14px} .ok{color:#57d38c} .err{color:#ff6b6b}
  .muted{color:#8a8a92;font-size:13px}
</style></head>
<body><div class="wrap">
  <h1>🦞 OpenClaw · Pair a device</h1>
  <p class="sub">Approve a browser's one-time Control UI pairing — no terminal needed.</p>
  <div class="card">
    <ol>
      <li>Open the <a href="/openclaw" target="_blank" rel="noreferrer">Control UI</a>, paste your gateway token, click <b>Connect</b>. It will say "Device pairing required".</li>
      <li>Paste the same token below and load the pending request.</li>
      <li>Approve it here, then go back to the Control UI and click <b>Connect</b> again.</li>
    </ol>
  </div>
  <div class="card">
    <label for="tok">Gateway token</label>
    <input id="tok" type="password" placeholder="OPENCLAW_GATEWAY_TOKEN" autocomplete="off"/>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button id="load">Load pending requests</button>
      <button id="auto" class="secondary" type="button">Auto-refresh: off</button>
    </div>
    <div id="msg" class="msg"></div>
    <div id="list"></div>
  </div>
  <p class="muted">This page and the gateway share one origin. Nothing is stored on the server; the token stays in this tab.</p>
</div>
<script>
const $=s=>document.querySelector(s); let timer=null;
function tok(){return $('#tok').value.trim();}
async function api(path,opts={}){opts.headers=Object.assign({'x-openclaw-token':tok()},opts.headers||{});return fetch('/setup/api/'+path,opts);}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
async function load(){
  const m=$('#msg'), list=$('#list'); m.textContent=''; m.className='msg';
  if(!tok()){m.textContent='Enter your gateway token first.';m.className='msg err';return;}
  let r; try{r=await api('pending');}catch(e){m.textContent='Network error.';m.className='msg err';return;}
  if(r.status===401){m.textContent='Wrong token.';m.className='msg err';list.innerHTML='';return;}
  if(!r.ok){m.textContent='Error loading requests ('+r.status+').';m.className='msg err';return;}
  const d=await r.json(); const p=d.pending||[];
  if(!p.length){list.innerHTML='<p class="muted" style="margin-top:12px">No pending requests. Click Connect in the Control UI first.</p>';return;}
  list.innerHTML=p.map(x=>{
    const who=esc(x.displayName||x.clientId||x.deviceId||'unknown device');
    const role=esc((x.roles&&x.roles.join(', '))||x.role||'operator');
    return '<div class="req"><div class="meta"><b>'+who+'</b><br><span class="mono">'+esc(x.requestId)+'</span><br>role: '+role+(x.remoteIp?' · '+esc(x.remoteIp):'')+'</div>'+
      '<button data-id="'+esc(x.requestId)+'">Approve</button></div>';
  }).join('');
  list.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>approve(b.dataset.id,b));
}
async function approve(id,btn){
  btn.disabled=true;btn.textContent='Approving…';const m=$('#msg');
  let r; try{r=await api('approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id})});}
  catch(e){m.textContent='Network error.';m.className='msg err';btn.disabled=false;btn.textContent='Approve';return;}
  const d=await r.json().catch(()=>({}));
  if(r.ok&&d.ok){m.textContent='Approved. Go back to the Control UI and click Connect again.';m.className='msg ok';load();}
  else{m.textContent='Approve failed: '+esc(d.error||d.output||('HTTP '+r.status));m.className='msg err';btn.disabled=false;btn.textContent='Approve';}
}
$('#load').onclick=load;
$('#auto').onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent='Auto-refresh: off';}else{timer=setInterval(load,4000);this.textContent='Auto-refresh: on';load();}};
$('#tok').addEventListener('keydown',e=>{if(e.key==='Enter')load();});
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = (req.url || "").split("?")[0];

  if (req.method === "GET" && (url === "/setup" || url === "/setup/" || url === "/setup/index.html")) {
    return send(res, 200, PAGE, "text/html; charset=utf-8");
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
      if (r.code === 0 && /approv/i.test(out)) return send(res, 200, { ok: true, output: out.slice(0, 500) });
      return send(res, 502, { ok: false, error: "approve failed", output: out.slice(0, 500) });
    }

    return send(res, 404, { error: "not found" });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`openclaw-railway: approver listening on 127.0.0.1:${PORT}`));
