const SHEET_GET_URL = "https://script.google.com/macros/s/AKfycby2xeJeM81Pk5lky5tscZnXgj0KuP6iN9H6Q7TbZtMXMsJWWFi0k9DPlhF03x2S_T78/exec";
const COUNTS_REFRESH_MS = 30_000;
const FULL_VIEW_MS = 10_000;
const GROUP_VIEW_MS = 5_000;
const GROUP_SIZE = 4;

const COURIERS = [
  "BLITZNDD", "BLUEDART", "BUSYBEESPPD", "BusybeesSDD",
  "DELCARTB2B", "DELHIVERY", "DELHIVERYPDS", "DOT",
  "DTDCVB2B", "FASTBEETLE", "GPSUPPLY", "PURPLEDRONE",
  "SHADOWFAX", "shreerajxpress", "Velocity", "XPRESSBEES"
];

let pickupData = [];
let counts = {
  manifest: {},
  b2c: {},
  b2b: {},
  storePacking: {},
};
let lastUpdated = null;
let monitorUpdated = null;
const cycleStartedAt = Date.now();

function toMin(t) {
  const [tm, ap] = t.split(" ");
  let [h, m] = tm.split(":").map(Number);
  if (h === 12) h = 0;
  if (ap === "PM") h += 12;
  return h * 60 + m;
}

function getIST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function formatClock(t) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(t);
}

function courierKey(name) {
  return name.split(/ RD /i)[0].trim();
}

function getNextSlot(courierName, nowMin) {
  const slots = pickupData
    .filter(p => courierKey(p.name) === courierName)
    .map(p => {
      let s = toMin(p.start);
      let e = toMin(p.end);
      if (e <= s) e += 1440;
      return { start: p.start, end: p.end, startMin: s, endMin: e };
    });

  if (!slots.length) return null;

  for (const sl of slots) {
    const s = sl.startMin;
    const e = sl.endMin;
    const running = (nowMin >= s && nowMin < e) || (e > 1440 && nowMin < e - 1440);
    if (running) return { ...sl, state: "running" };
  }

  const future = slots
    .map(sl => {
      const norm = sl.startMin <= nowMin ? sl.startMin + 1440 : sl.startMin;
      return { ...sl, norm };
    })
    .sort((a, b) => a.norm - b.norm);

  const next = future[0];
  const minsUntil = next.norm - nowMin;
  const state = minsUntil <= 30 ? "soon" : "upcoming";
  return { ...next, state, minsUntil };
}

function buildRows(nowMin) {
  const hasData = hasAnyCounts();
  return COURIERS
    .map(courier => {
      const slot = getNextSlot(courier, nowMin);
      const storePacking = hasData ? (counts.storePacking[courier] ?? 0) : null;
      const b2c = hasData ? (counts.b2c[courier] ?? 0) : null;
      const b2b = hasData ? (counts.b2b[courier] ?? 0) : null;
      const manifest = hasData ? (counts.manifest[courier] ?? 0) : null;
      const subtotal = hasData ? storePacking + b2c + b2b + manifest : null;
      return { courier, slot, storePacking, b2c, b2b, manifest, subtotal };
    })
    .sort((a, b) => {
      const normA = a.slot ? (a.slot.norm ?? (a.slot.startMin <= nowMin ? a.slot.startMin + 1440 : a.slot.startMin)) : 9999;
      const normB = b.slot ? (b.slot.norm ?? (b.slot.startMin <= nowMin ? b.slot.startMin + 1440 : b.slot.startMin)) : 9999;
      return normA - normB;
    });
}

function getBoardCycle() {
  const elapsed = (Date.now() - cycleStartedAt) % (FULL_VIEW_MS + GROUP_VIEW_MS * 4);
  if (elapsed < FULL_VIEW_MS) {
    return {
      mode: "all",
      page: 0,
      label: "ALL COURIERS",
      dot: 0,
    };
  }

  const page = Math.floor((elapsed - FULL_VIEW_MS) / GROUP_VIEW_MS);
  return {
    mode: "group",
    page,
    label: `COURIER GROUP ${page + 1} / 4`,
    dot: page + 1,
  };
}

function visibleRowsForCycle(rows, cycle) {
  if (cycle.mode === "all") return rows;
  const start = cycle.page * GROUP_SIZE;
  return rows.slice(start, start + GROUP_SIZE);
}

function updateBoardStatus(cycle) {
  const modeEl = document.getElementById("boardMode");
  const tableEl = document.getElementById("opsTable");

  modeEl.textContent = cycle.label;
  tableEl.classList.toggle("focus-view", cycle.mode === "group");

  for (let i = 0; i < 5; i++) {
    const dot = document.getElementById(`cycleDot${i + 1}`);
    dot.classList.toggle("active", i === cycle.dot);
  }
}

function hasAnyCounts() {
  return ["manifest", "b2c", "b2b", "storePacking"]
    .some(group => Object.keys(counts[group] || {}).length > 0);
}

function getValueClass(val, group) {
  if (val === null) return "value-unknown";
  if (val === 0) return "value-zero";
  if (group === "storePacking" && val >= 300) return "value-high";
  if (group !== "storePacking" && val >= 100) return "value-high";
  if (val >= 30) return "value-mid";
  return "value-low";
}

function valueCell(val, group) {
  if (val === null) return `<td class="value-unknown">-</td>`;
  return `<td class="${getValueClass(val, group)}">${val}</td>`;
}

function manifestCell(val) {
  if (val === null) return `<td class="manifest-unknown">-</td>`;
  if (val === 0) return `<td class="manifest-zero">0</td>`;
  if (val >= 100) return `<td class="manifest-high">${val}</td>`;
  if (val >= 30) return `<td class="manifest-mid">${val}</td>`;
  return `<td class="manifest-low">${val}</td>`;
}

function subtotalCell(val) {
  if (val === null || val === 0) {
    return `<td class="cell-subtotal-zero">${val === null ? "-" : "0"}</td>`;
  }
  return `<td class="cell-subtotal">${val}</td>`;
}

function pickupCell(slot) {
  if (!slot) return `<td class="cell-na">-</td>`;
  const window = `${slot.start} - ${slot.end}`;
  if (slot.state === "running") {
    return `<td class="cell-pickup"><span class="pickup-running">LIVE ${window}</span></td>`;
  }
  if (slot.state === "soon") {
    return `<td class="cell-pickup"><span class="pickup-soon">${slot.minsUntil}m ${window}</span></td>`;
  }
  return `<td class="cell-pickup"><span class="pickup-normal">${window}</span></td>`;
}

function rowClass(slot) {
  if (!slot) return "";
  if (slot.state === "running") return "row-running";
  if (slot.state === "soon") return "row-soon";
  return "";
}

function renderTable() {
  const ist = getIST();
  const nowMin = ist.getHours() * 60 + ist.getMinutes();

  document.getElementById("clock").textContent = formatClock(ist);

  const rows = buildRows(nowMin);
  const cycle = getBoardCycle();
  const visibleRows = visibleRowsForCycle(rows, cycle);
  const tbody = document.getElementById("tableBody");

  updateBoardStatus(cycle);

  tbody.innerHTML = visibleRows.map((r, i) => `
    <tr class="${rowClass(r.slot)}">
      <td class="cell-rank">${cycle.mode === "all" ? i + 1 : cycle.page * GROUP_SIZE + i + 1}</td>
      <td class="cell-courier"><span class="courier-badge">${r.courier}</span></td>
      ${pickupCell(r.slot)}
      ${valueCell(r.storePacking, "storePacking")}
      ${valueCell(r.b2c, "b2c")}
      ${valueCell(r.b2b, "b2b")}
      ${manifestCell(r.manifest)}
      ${subtotalCell(r.subtotal)}
    </tr>
  `).join("");

  const hasData = hasAnyCounts();
  const totalStore = hasData ? COURIERS.reduce((sum, c) => sum + (counts.storePacking[c] ?? 0), 0) : null;
  const totalB2C = hasData ? COURIERS.reduce((sum, c) => sum + (counts.b2c[c] ?? 0), 0) : null;
  const totalB2B = hasData ? COURIERS.reduce((sum, c) => sum + (counts.b2b[c] ?? 0), 0) : null;
  const totalManifest = hasData ? COURIERS.reduce((sum, c) => sum + (counts.manifest[c] ?? 0), 0) : null;
  const grandTotal = hasData ? totalStore + totalB2C + totalB2B + totalManifest : null;

  document.getElementById("gt-store").textContent = totalStore !== null ? totalStore : "-";
  document.getElementById("gt-b2c").textContent = totalB2C !== null ? totalB2C : "-";
  document.getElementById("gt-b2b").textContent = totalB2B !== null ? totalB2B : "-";
  document.getElementById("gt-manifest").textContent = totalManifest !== null ? totalManifest : "-";
  document.getElementById("gt-subtotal").textContent = grandTotal !== null ? grandTotal : "-";
}

function numberValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractGroup(data, prefix) {
  const group = {};
  COURIERS.forEach(c => {
    const key = `${prefix}_${c}`;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      group[c] = numberValue(data[key]);
    }
  });
  return group;
}

async function fetchCounts() {
  try {
    const res = await fetch(SHEET_GET_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    lastUpdated = data.timestamp || null;
    monitorUpdated = data.monitorTimestamp || null;
    counts = {
      manifest: extractGroup(data, "manifest"),
      b2c: extractGroup(data, "b2c"),
      b2b: extractGroup(data, "b2b"),
      storePacking: extractGroup(data, "storePacking"),
    };

    const el = document.getElementById("lastUpdated");
    if (lastUpdated) {
      el.textContent = `Last push: ${lastUpdated}${monitorUpdated ? " | Monitor: " + monitorUpdated : ""}`;
      el.className = "last-updated fresh";
    }
  } catch (err) {
    const el = document.getElementById("lastUpdated");
    el.textContent = "Data refresh failed";
    el.className = "last-updated stale";
    console.warn("Counts fetch failed:", err.message);
  }
}

async function init() {
  try {
    const res = await fetch("data/pickups.json");
    pickupData = await res.json();
  } catch (e) {
    console.warn("pickups.json failed:", e);
    pickupData = [];
  }

  await fetchCounts();
  setInterval(fetchCounts, COUNTS_REFRESH_MS);

  renderTable();
  setInterval(renderTable, 1000);
}

document.addEventListener("DOMContentLoaded", init);
