const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readWindowState, restoreWindowBounds, writeWindowState } = require("../apps/desktop/electron/window-state.cjs");

const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 1600, height: 900 } },
  { id: 2, workArea: { x: -1280, y: 120, width: 1280, height: 800 } },
];

assert.deepEqual(restoreWindowBounds({ x: -2000, y: -2000, width: 1500, height: 950 }, displays, 1), {
  x: 0, y: 0, width: 1500, height: 900,
});
assert.deepEqual(restoreWindowBounds({ x: -1100, y: 250, width: 1200, height: 760 }, displays, 1), {
  x: -1200, y: 160, width: 1200, height: 760,
});
assert.deepEqual(restoreWindowBounds(null, displays, 1), {
  x: 80, y: 0, width: 1440, height: 900,
});

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skai-window-state-"));
const file = path.join(directory, "nested", "state.json");
const state = { bounds: { x: 32, y: 44, width: 1200, height: 800 }, maximized: true };
writeWindowState(fs, file, state);
assert.deepEqual(readWindowState(fs, file), state);
fs.rmSync(directory, { recursive: true, force: true });
console.log("Window geometry restore tests passed.");
