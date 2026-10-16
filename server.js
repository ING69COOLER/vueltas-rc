// Tablero de vueltas RC — servidor mínimo sin dependencias.
// Estado compartido en memoria + push en vivo por Server-Sent Events.
// shortcut: el estado vive solo en memoria; si el servicio free de Render
// se duerme (15 min inactivo) o se redespliega, las vueltas se reinician.
// Suficiente para una carrera (uso activo no duerme). Upgrade: persistir en
// Render Key Value / Postgres si se necesita conservar entre reinicios.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, "public", "index.html"));

let state = { participants: [], timer: { running: false, startMs: 0, accumMs: 0 } };
let nextId = 1;
const clients = new Set();

function payload() {
  return JSON.stringify({ ...state, now: Date.now() });
}
function broadcast() {
  const data = "data: " + payload() + "\n\n";
  for (const res of clients) res.write(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}
function json(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(INDEX);
  }

  if (req.method === "GET" && p === "/api/state") return json(res, JSON.parse(payload()));

  if (req.method === "GET" && p === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: " + payload() + "\n\n");
    clients.add(res);
    const hb = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(hb); clients.delete(res); });
    return;
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    if (p === "/api/participants") {
      const name = String(body.name || "").trim().slice(0, 40);
      if (!name) { res.writeHead(400); return res.end(); }
      state.participants.push({
        id: nextId++, name, car: String(body.car || "").trim().slice(0, 30),
        laps: 0, createdAt: Date.now(),
      });
      broadcast(); return json(res, { ok: true });
    }
    if (p === "/api/lap") {
      const pt = state.participants.find((x) => x.id === body.id);
      if (pt) pt.laps = Math.max(0, pt.laps + (body.delta === -1 ? -1 : 1));
      broadcast(); return json(res, { ok: true });
    }
    if (p === "/api/delete") {
      state.participants = state.participants.filter((x) => x.id !== body.id);
      broadcast(); return json(res, { ok: true });
    }
    if (p === "/api/timer") {
      const t = state.timer, now = Date.now();
      if (body.action === "start") state.timer = { running: true, startMs: now, accumMs: t.accumMs };
      else if (body.action === "pause")
        state.timer = { running: false, startMs: 0, accumMs: t.accumMs + (t.running ? now - t.startMs : 0) };
      else if (body.action === "reset") state.timer = { running: false, startMs: 0, accumMs: 0 };
      broadcast(); return json(res, { ok: true });
    }
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => console.log("Vueltas RC en :" + PORT));
