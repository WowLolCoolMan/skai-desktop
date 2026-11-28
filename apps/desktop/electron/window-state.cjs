function intersectArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function restoreWindowBounds(saved, displays, primaryDisplayId, fallback = { width: 1440, height: 900 }, minimum = { width: 960, height: 640 }) {
  const available = (displays ?? []).filter((display) => display?.workArea && [display.workArea.x, display.workArea.y, display.workArea.width, display.workArea.height].every(Number.isFinite));
  if (!available.length) return { x: 0, y: 0, width: fallback.width, height: fallback.height };

  const primary = available.find((display) => display.id === primaryDisplayId) ?? available[0];
  const validSaved = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite);
  const requested = validSaved ? saved : {
    x: primary.workArea.x + Math.round((primary.workArea.width - fallback.width) / 2),
    y: primary.workArea.y + Math.round((primary.workArea.height - fallback.height) / 2),
    width: fallback.width,
    height: fallback.height,
  };
  const target = available.reduce((best, display) => {
    const area = intersectArea(requested, display.workArea);
    return area > best.area ? { display, area } : best;
  }, { display: primary, area: 0 }).display;
  const area = target.workArea;
  const width = Math.min(area.width, Math.max(Math.min(minimum.width, area.width), requested.width));
  const height = Math.min(area.height, Math.max(Math.min(minimum.height, area.height), requested.height));
  return {
    x: Math.min(Math.max(requested.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(requested.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

function readWindowState(fs, filePath) {
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return state && typeof state === "object" ? state : null;
  } catch { return null; }
}

function writeWindowState(fs, filePath, state) {
  try {
    fs.mkdirSync(require("node:path").dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state)}\n`, "utf8");
  } catch { /* Window placement is a convenience and must never block startup or close. */ }
}

module.exports = { restoreWindowBounds, readWindowState, writeWindowState };
