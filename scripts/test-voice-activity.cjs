const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("apps/desktop/src/features/chat/voiceActivity.ts", "utf8")
  .replace("export function audioRms", "function audioRms")
  .replace("export function isSustainedVoiceActivity", "function isSustainedVoiceActivity")
  .replace("export function voiceActivityThreshold", "function voiceActivityThreshold")
  .replace("samples: ArrayLike<number>", "samples")
  .replaceAll(": number", "")
  .replaceAll(": boolean", "")
  .replace(") {", ") {") + "\nthis.audioRms = audioRms; this.isSustainedVoiceActivity = isSustainedVoiceActivity; this.voiceActivityThreshold = voiceActivityThreshold;";
const context = {};
vm.runInNewContext(source, context);
assert.equal(context.audioRms([]), 0);
assert.equal(context.audioRms([0, 0, 0]), 0);
assert.equal(context.audioRms([1, -1]), 1);
assert.equal(context.audioRms([0.5, -0.5, 0.5, -0.5]), 0.5);
assert.ok(context.audioRms([0.01, -0.01]) < context.audioRms([0.2, -0.2]));
assert.equal(context.isSustainedVoiceActivity(0.02, 0.01, 100, 250), false);
assert.equal(context.isSustainedVoiceActivity(0.02, 0.01, 100, 280), true);
assert.equal(context.isSustainedVoiceActivity(0.01, 0.01, 100, 500), false);
assert.equal(context.isSustainedVoiceActivity(0.02, 0.01, 0, 500), false);
assert.equal(context.voiceActivityThreshold(0.001, true), 0.005);
assert.ok(Math.abs(context.voiceActivityThreshold(0.01, true) - 0.028) < 1e-12);
assert.equal(context.voiceActivityThreshold(0.001, false), 0.0016);
console.log("Voice activity RMS checks passed.");
