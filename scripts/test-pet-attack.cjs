const assert = require("node:assert/strict");
const { normalizePetBehaviorSettings, randomAttackSequence } = require("../apps/desktop/electron/pet-attack.cjs");

const blaze = normalizePetBehaviorSettings({
  enabled: true,
  triggerDuringIdle: true,
  triggerDuringWalk: true,
  minimumIntervalSeconds: 60,
  maximumIntervalSeconds: 180,
  actions: ["approach-cursor", "pounce", "fire-breath"],
});
assert.deepEqual(blaze.actions, ["approach-cursor", "pounce", "fire-breath"]);
assert.equal(blaze.enabled, true);

const allSelected = randomAttackSequence(blaze, () => 0.1);
assert.deepEqual(allSelected, ["approach-cursor", "pounce", "fire-breath"]);

const attackOnly = normalizePetBehaviorSettings({ enabled: true, actions: ["pounce", "fire-breath"] });
assert.deepEqual(randomAttackSequence(attackOnly, () => 0.1), ["approach-cursor", "pounce", "fire-breath"]);

const invalid = normalizePetBehaviorSettings({ enabled: true, actions: ["unknown"] });
assert.deepEqual(invalid.actions, []);
assert.equal(invalid.enabled, false);

console.log("Pet attack behavior checks passed.");
