/* global Chart, ChartZoom */

const els = {
  statusBadge: document.getElementById("statusBadge"),
  currentValue: document.getElementById("currentValue"),
  currentHumidity: document.getElementById("currentHumidity"),
  currentMeta: document.getElementById("currentMeta"),
  exampleCurl: document.getElementById("exampleCurl"),
  weatherTemp: document.getElementById("weatherTemp"),
  weatherDesc: document.getElementById("weatherDesc"),
  weatherMeta: document.getElementById("weatherMeta"),
};

function setBadge(state, text) {
  els.statusBadge.classList.remove("ok", "warn", "bad");
  if (state) els.statusBadge.classList.add(state);
  els.statusBadge.textContent = text;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function fmtTemp(c) {
  const v = Math.round(c * 10) / 10;
  return `${v.toFixed(1)}°C`;
}

function fmtHum(h) {
  const v = Math.round(h * 10) / 10;
  return `${v.toFixed(1)}%`;
}

const zoomPluginOk = typeof Chart !== "undefined" && typeof ChartZoom !== "undefined";

function makeLineChart(canvas, label, color, formatter) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label,
          data: [],
          tension: 0.38,
          cubicInterpolationMode: "monotone",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: "rgba(255,255,255,0.95)",
          borderColor: color,
          backgroundColor: "rgba(255, 255, 255, 0)",
          fill: false,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false, axis: "x" },
      hover: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: {
          intersect: false,
          callbacks: {
            label: (ctx2) => {
              const y = ctx2.parsed.y;
              if (y === null || y === undefined || Number.isNaN(y)) return " —";
              return ` ${formatter(y)}`;
            },
          },
        },
        ...(zoomPluginOk
          ? {
              zoom: {
                pan: { enabled: true, mode: "x" },
                zoom: {
                  wheel: { enabled: true },
                  pinch: { enabled: true },
                  mode: "x",
                },
              },
            }
          : {}),
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, color: "rgba(255,255,255,0.65)" },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
        y: {
          grace: "12%",
          beginAtZero: false,
          ticks: { color: "rgba(255,255,255,0.65)" },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    },
  });
}

const tempChart = makeLineChart(
  document.getElementById("tempChart"),
  "Температура, °C",
  "rgba(96, 165, 250, 1)",
  fmtTemp
);
const humChart = makeLineChart(
  document.getElementById("humChart"),
  "Влажность, %",
  "rgba(147, 197, 253, 1)",
  fmtHum
);

function setSeries(chart, labels, data) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update();
}

function pushPoint(chart, label, value, maxPoints) {
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  while (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update();
}

const MAX_POINTS = 1000;

function applyHistory(points) {
  const labels = points.map((p) => new Date(p.ts).toLocaleTimeString());
  const temp = points.map((p) => p.celsius);
  const hum = points.map((p) => (typeof p.humidity === "number" ? p.humidity : null));
  setSeries(tempChart, labels, temp);
  setSeries(humChart, labels, hum);

  if (points.length) {
    const last = points[points.length - 1];
    els.currentValue.textContent = fmtTemp(last.celsius);
    els.currentMeta.textContent = `${fmtTime(last.ts)}${last.deviceId ? ` • ${last.deviceId}` : ""}`;
    if (typeof last.humidity === "number") {
      els.currentHumidity.textContent = fmtHum(last.humidity);
    } else {
      els.currentHumidity.textContent = "—";
    }
  }
}

function appendPoint(point) {
  const label = new Date(point.ts).toLocaleTimeString();
  pushPoint(tempChart, label, point.celsius, MAX_POINTS);
  pushPoint(humChart, label, typeof point.humidity === "number" ? point.humidity : null, MAX_POINTS);

  els.currentValue.textContent = fmtTemp(point.celsius);
  els.currentMeta.textContent = `${fmtTime(point.ts)}${point.deviceId ? ` • ${point.deviceId}` : ""}`;
  if (typeof point.humidity === "number") {
    els.currentHumidity.textContent = fmtHum(point.humidity);
  }
}

async function loadInitial() {
  const res = await fetch("/api/history");
  const data = await res.json();
  applyHistory(data.points || []);
}

async function loadWeather() {
  try {
    const res = await fetch("/api/weather");
    const data = await res.json();
    if (!data.ok) {
      els.weatherTemp.textContent = "—";
      els.weatherDesc.textContent = data.error || "Недоступно";
      const err = String(data.error || "");
      const needsCoords = /WEATHER_(LAT|LON)|not configured/i.test(err);
      els.weatherMeta.textContent = needsCoords
        ? "Задайте WEATHER_LAT и WEATHER_LON на сервере"
        : "";
      return;
    }
    els.weatherTemp.textContent = fmtTemp(data.temperatureC);
    const hum =
      typeof data.humidity === "number" ? ` • влажность ${fmtHum(data.humidity)}` : "";
    els.weatherDesc.textContent = `${data.description || "Погода"}${hum}`;
    const cache = data.cached ? "кэш" : "свежие данные";
    els.weatherMeta.textContent = `${data.source || "Open-Meteo"} • ${cache}${data.time ? ` • ${data.time}` : ""}`;
  } catch {
    els.weatherTemp.textContent = "—";
    els.weatherDesc.textContent = "Ошибка запроса";
    els.weatherMeta.textContent = "";
  }
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function setCurlExample() {
  const url = `${location.origin}/api/temperature`;
  els.exampleCurl.textContent = `POST ${url}
Content-Type: application/json

{"celsius": 23.5, "humidity": 50.0, "deviceId":"esp32-kitchen", "ts": ${Date.now()}}`;
}

let ws;
let lastMsgAt = 0;

function connectWs() {
  setBadge("warn", "connecting");
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    setBadge("ok", "online");
  };

  ws.onmessage = (ev) => {
    lastMsgAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === "hello" && Array.isArray(msg.history)) {
      applyHistory(msg.history);
      return;
    }
    if (msg.type === "temperature" && msg.point) {
      appendPoint(msg.point);
    }
  };

  ws.onclose = () => {
    setBadge("bad", "offline");
    setTimeout(connectWs, 1500);
  };

  ws.onerror = () => {
    // close will handle reconnect
  };
}

setCurlExample();
loadInitial().catch(() => {});
loadWeather().catch(() => {});
connectWs();

setInterval(() => loadWeather().catch(() => {}), 15 * 60 * 1000);

setInterval(() => {
  if (!lastMsgAt) return;
  const age = Date.now() - lastMsgAt;
  if (age > 15000) setBadge("warn", "stale");
}, 1000);
