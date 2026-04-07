/* global Chart */

const els = {
  statusBadge: document.getElementById("statusBadge"),
  currentValue: document.getElementById("currentValue"),
  currentHumidity: document.getElementById("currentHumidity"),
  currentMeta: document.getElementById("currentMeta"),
  pointsCount: document.getElementById("pointsCount"),
  limitHint: document.getElementById("limitHint"),
  exampleCurl: document.getElementById("exampleCurl"),
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

const ctx = document.getElementById("chart");
const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Температура, °C",
        data: [],
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
        borderColor: "rgba(124, 58, 237, 1)",
        backgroundColor: "rgba(124, 58, 237, 0.18)",
        fill: true,
      },
      {
        label: "Влажность, %",
        data: [],
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
        borderColor: "rgba(34, 197, 94, 1)",
        backgroundColor: "rgba(34, 197, 94, 0.10)",
        fill: false,
        yAxisID: "y1",
      },
    ],
  },
  options: {
    responsive: true,
    animation: false,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: true },
      tooltip: {
        callbacks: {
          label: (ctx2) => {
            if (ctx2.datasetIndex === 0) return ` ${fmtTemp(ctx2.parsed.y)}`;
            return ` ${fmtHum(ctx2.parsed.y)}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxTicksLimit: 6, color: "rgba(255,255,255,0.65)" },
        grid: { color: "rgba(255,255,255,0.08)" },
      },
      y: {
        ticks: { color: "rgba(255,255,255,0.65)" },
        grid: { color: "rgba(255,255,255,0.08)" },
      },
      y1: {
        position: "right",
        ticks: { color: "rgba(255,255,255,0.65)" },
        grid: { drawOnChartArea: false },
      },
    },
  },
});

function applyHistory(points) {
  const labels = points.map((p) => new Date(p.ts).toLocaleTimeString());
  const temp = points.map((p) => p.celsius);
  const hum = points.map((p) => (typeof p.humidity === "number" ? p.humidity : null));
  chart.data.labels = labels;
  chart.data.datasets[0].data = temp;
  chart.data.datasets[1].data = hum;
  chart.update();

  els.pointsCount.textContent = String(points.length);
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
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(point.celsius);
  chart.data.datasets[1].data.push(typeof point.humidity === "number" ? point.humidity : null);

  const MAX = 1000;
  while (chart.data.labels.length > MAX) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update();
  els.pointsCount.textContent = String(chart.data.labels.length);
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
connectWs();

setInterval(() => {
  if (!lastMsgAt) return;
  const age = Date.now() - lastMsgAt;
  if (age > 15000) setBadge("warn", "stale");
}, 1000);

