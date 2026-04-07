const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 1000);

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** @type {{ ts: number, celsius: number, humidity?: number, deviceId?: string }[]} */
const history = [];

function addPoint(point) {
  history.push(point);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, now: Date.now(), points: history.length });
});

app.get("/api/history", (req, res) => {
  res.json({ points: history });
});

app.post("/api/temperature", (req, res) => {
  const body = req.body || {};
  const celsius = body.celsius;
  const humidity = body.humidity;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;
  const ts = isFiniteNumber(body.ts) ? Math.trunc(body.ts) : Date.now();

  if (!isFiniteNumber(celsius)) {
    return res.status(400).json({ ok: false, error: "`celsius` must be a finite number" });
  }
  if (humidity !== undefined && !isFiniteNumber(humidity)) {
    return res.status(400).json({ ok: false, error: "`humidity` must be a finite number (or omitted)" });
  }

  const point = {
    ts,
    celsius,
    ...(humidity !== undefined ? { humidity } : {}),
    ...(deviceId ? { deviceId } : {}),
  };
  addPoint(point);
  broadcast({ type: "temperature", point });

  res.json({ ok: true });
});

const publicDir = path.join(__dirname, "..", "public");
app.use("/", express.static(publicDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/** @param {unknown} data */
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", now: Date.now(), history }));
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

