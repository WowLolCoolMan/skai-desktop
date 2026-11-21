const assert = require("node:assert/strict");
const { normalizePetBehaviorSettings, randomAttackSequence } = require("../apps/desktop/electron/pet-attack.cjs");

const blaze = normalizePetBehaviorSettings({
  enabled: true,
  triggerDuringIdle: true,
  triggerDuringWalk: true,
  minimumIntervalSeconds: 30,
  maximumIntervalSeconds: 60,
  actions: ["approach-cursor", "pounce", "fire-breath"],
});
assert.deepEqual(blaze.actions, ["approach-cursor", "pounce", "fire-breath"]);
assert.equal(blaze.enabled, true);
assert.equal(blaze.minimumIntervalSeconds, 30);
assert.equal(blaze.maximumIntervalSeconds, 60);

const allSelected = randomAttackSequence(blaze, () => 0.1);
assert.deepEqual(allSelected, ["approach-cursor", "pounce", "fire-breath"]);

const attackOnly = normalizePetBehaviorSettings({ enabled: true, actions: ["pounce", "fire-breath"] });
assert.deepEqual(randomAttackSequence(attackOnly, () => 0.1), ["approach-cursor", "pounce", "fire-breath"]);
assert.deepEqual(randomAttackSequence(normalizePetBehaviorSettings({ enabled: true, actions: ["approach-cursor"] })), []);

const invalid = normalizePetBehaviorSettings({ enabled: true, actions: ["unknown"] });
assert.deepEqual(invalid.actions, []);
assert.equal(invalid.enabled, false);

// Cursor chase: follow a moving cursor instead of cancelling, strike within reach, give up politely.
const { CHASE_LIMITS, chaseDecision, strikeDecision, facingToward } = require("../apps/desktop/electron/pet-chase.cjs");
const chase = { chaseStartedAt: 0, lastRetargetAt: 0, target: { x: 500, y: 400 }, cursorOnPetDisplay: true };
assert.equal(chaseDecision({ ...chase, now: 1000, cursor: { x: 510, y: 405 } }), "continue", "small pointer jitter does not re-plan the charge");
assert.equal(chaseDecision({ ...chase, now: 1000, cursor: { x: 700, y: 400 } }), "retarget", "a moved cursor is followed, not abandoned");
assert.equal(chaseDecision({ ...chase, now: 100, lastRetargetAt: 0, cursor: { x: 700, y: 400 } }), "continue", "re-plans are throttled");
assert.equal(chaseDecision({ ...chase, now: CHASE_LIMITS.maxChaseMs + 1, cursor: { x: 700, y: 400 } }), "give-up", "the chase is bounded");
assert.equal(chaseDecision({ ...chase, now: 1000, cursor: { x: 700, y: 400 }, cursorOnPetDisplay: false }), "abort", "a cursor on another display ends the attack");

// Simulate a user dragging the pointer away during a charge: the pet keeps retargeting.
let target = { x: 500, y: 400 };
let lastRetargetAt = 0;
let retargets = 0;
for (let now = 0; now <= 3000; now += 50) {
  const cursor = { x: 500 + now / 5, y: 400 + Math.sin(now / 300) * 60 };
  const decision = chaseDecision({ now, chaseStartedAt: 0, lastRetargetAt, cursor, target, cursorOnPetDisplay: true });
  assert.notEqual(decision, "abort");
  if (decision === "retarget") { target = cursor; lastRetargetAt = now; retargets += 1; }
}
assert.ok(retargets >= 3 && retargets <= Math.ceil(3000 / CHASE_LIMITS.retargetIntervalMs), `a moving cursor is tracked with throttled re-plans (${retargets})`);

const strike = { now: 2000, chaseStartedAt: 0, cursorOnPetDisplay: true, petCenter: { x: 500, y: 400 } };
assert.equal(strikeDecision({ ...strike, cursor: { x: 680, y: 410 } }), "strike", "the pet strikes a cursor within reach");
assert.equal(strikeDecision({ ...strike, cursor: { x: 1200, y: 400 } }), "chase", "a cursor out of reach is chased again");
assert.equal(strikeDecision({ ...strike, now: CHASE_LIMITS.maxChaseMs + 1, cursor: { x: 1200, y: 400 } }), "give-up", "an out-of-reach cursor after the budget ends the chase");
assert.equal(facingToward({ x: 500, y: 0 }, { x: 300, y: 0 }), -1, "the pet turns to face a cursor on its left");
assert.equal(facingToward({ x: 500, y: 0 }, { x: 503, y: 0 }, -1), -1, "facing is stable when the cursor is straight ahead");

console.log("Pet attack behavior checks passed.");
