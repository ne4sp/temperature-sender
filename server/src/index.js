const path = require("path");
const fs = require("fs").promises;
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 1000);
const API_KEY = process.env.API_KEY || "";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 120);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

const WEATHER_LAT = process.env.WEATHER_LAT || 47.321119;
const WEATHER_LON = process.env.WEATHER_LON || 40.370117;
const WEATHER_TTL_MS = Number(process.env.WEATHER_TTL_MS || 10 * 60 * 1000);

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** @type {{ ts: number, celsius: number, humidity?: number, deviceId?: string }[]} */
const history = [];

function addPoint(point) {
  history.push(point);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  schedulePersist();
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadPersistedHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.points) ? parsed.points : [];
    history.length = 0;
    for (const p of arr.slice(-HISTORY_LIMIT)) {
      if (p && isFiniteNumber(p.ts) && isFiniteNumber(p.celsius)) {
        history.push({
          ts: Math.trunc(p.ts),
          celsius: p.celsius,
          ...(typeof p.humidity === "number" ? { humidity: p.humidity } : {}),
          ...(typeof p.deviceId === "string" ? { deviceId: p.deviceId } : {}),
        });
      }
    }
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.error("loadPersistedHistory:", e.message || e);
    }
  }
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistHistory().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("persistHistory:", err.message || err);
    });
  }, 500);
}

async function persistHistory() {
  await ensureDataDir();
  const payload = JSON.stringify(history);
  await fs.writeFile(HISTORY_FILE, payload, "utf8");
}

const rate = new Map(); // ip -> { windowStart: number, count: number }
function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimitOk(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = rate.get(ip);
  if (!entry || now - entry.windowStart >= windowMs) {
    rate.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_PER_MIN;
}

/** @param {number} code WMO weather code */
function weatherCodeToRu(code) {
  const c = Number(code);
  if (c === 0) return "Ясно";
  if (c === 1) return "Преимущественно ясно";
  if (c === 2) return "Переменная облачность";
  if (c === 3) return "Пасмурно";
  if (c === 45 || c === 48) return "Туман";
  if (c >= 51 && c <= 55) return "Морось";
  if (c >= 56 && c <= 57) return "Ледяная морось";
  if (c >= 61 && c <= 65) return "Дождь";
  if (c >= 66 && c <= 67) return "Ледяной дождь";
  if (c >= 71 && c <= 77) return "Снег";
  if (c >= 80 && c <= 82) return "Ливень";
  if (c >= 85 && c <= 86) return "Снегопад";
  if (c === 95) return "Гроза";
  if (c === 96 || c === 99) return "Гроза с градом";
  return "Погода";
}

let weatherCache = { at: 0, payload: null };

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));

const hammerFile = require.resolve("hammerjs/hammer.min.js");
const zoomFile = path.join(
  path.dirname(require.resolve("chartjs-plugin-zoom/package.json")),
  "dist",
  "chartjs-plugin-zoom.min.js"
);

app.get("/vendor/hammer.min.js", (req, res) => {
  res.type("application/javascript");
  res.sendFile(hammerFile);
});

app.get("/vendor/chartjs-plugin-zoom.min.js", (req, res) => {
  res.type("application/javascript");
  res.sendFile(zoomFile);
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    now: Date.now(),
    points: history.length,
    dataDir: DATA_DIR,
    weatherConfigured: Boolean(WEATHER_LAT && WEATHER_LON),
  });
});

app.get("/api/history", (req, res) => {
  res.json({ points: history });
});

app.get("/api/weather", async (req, res) => {
  const lat = Number(WEATHER_LAT);
  const lon = Number(WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(503).json({
      ok: false,
      error: "Weather not configured: set WEATHER_LAT and WEATHER_LON on the server",
    });
  }

  const now = Date.now();
  if (weatherCache.payload && now - weatherCache.at < WEATHER_TTL_MS) {
    return res.json({ ok: true, ...weatherCache.payload, cached: true });
  }

  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?" +
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: "temperature_2m,relative_humidity_2m,weather_code",
        timezone: "auto",
      }).toString();

    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: `Open-Meteo HTTP ${r.status}` });
    }
    const j = await r.json();
    const cur = j.current;
    if (!cur) {
      return res.status(502).json({ ok: false, error: "Open-Meteo: no current block" });
    }

    const payload = {
      temperatureC: cur.temperature_2m,
      humidity: cur.relative_humidity_2m,
      weatherCode: cur.weather_code,
      description: weatherCodeToRu(cur.weather_code),
      time: cur.time,
      source: "Open-Meteo",
    };
    weatherCache = { at: now, payload };
    res.json({ ok: true, ...payload, cached: false });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/api/temperature", (req, res) => {
  if (API_KEY) {
    const got = req.headers["x-api-key"];
    if (got !== API_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const ip = getClientIp(req);
  if (!rateLimitOk(ip)) {
    return res.status(429).json({ ok: false, error: "Too Many Requests" });
  }

  const body = req.body || {};
  const celsius = body.celsius;
  const humidity = body.humidity;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;
  const ts = isFiniteNumber(body.ts) ? Math.trunc(body.ts) : Date.now();

  if (!isFiniteNumber(celsius)) {
    return res.status(400).json({ ok: false, error: "`celsius` must be a finite number" });
  }
  if (celsius < -50 || celsius > 100) {
    return res.status(400).json({ ok: false, error: "`celsius` out of expected range" });
  }
  if (humidity !== undefined && !isFiniteNumber(humidity)) {
    return res.status(400).json({ ok: false, error: "`humidity` must be a finite number (or omitted)" });
  }
  if (humidity !== undefined && (humidity < 0 || humidity > 100)) {
    return res.status(400).json({ ok: false, error: "`humidity` out of expected range" });
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

async function start() {
  await loadPersistedHistory();
  server.listen(PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`History file: ${HISTORY_FILE}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
