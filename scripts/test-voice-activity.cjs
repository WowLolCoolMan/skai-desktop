const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("apps/desktop/src/features/chat/voiceActivity.ts", "utf8")
  .replace("export function audioRms", "function audioRms")
  .replace("samples: ArrayLike<number>", "samples")
  .replace(") {", ") {") + "\nthis.audioRms = audioRms;";
const context = {};
vm.runInNewContext(source, context);
assert.equal(context.audioRms([]), 0);
assert.equal(context.audioRms([0, 0, 0]), 0);
assert.equal(context.audioRms([1, -1]), 1);
assert.equal(context.audioRms([0.5, -0.5, 0.5, -0.5]), 0.5);
assert.ok(context.audioRms([0.01, -0.01]) < context.audioRms([0.2, -0.2]));
console.log("Voice activity RMS checks passed.");
