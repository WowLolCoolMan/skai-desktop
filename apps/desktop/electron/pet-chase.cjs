// Cursor chase for attacking companions (Blaze). The pet charges at the cursor and keeps following
// it while it moves, strikes once it is within reach, and gives up gracefully — walking home rather
// than snapping back — after a bounded chase or when the cursor leaves the pet's display.
//
// The previous behavior snapshotted the cursor once and cancelled the whole attack if the pointer
// moved more than 22 px, so in normal use attacks almost never landed.
//
// Kept free of Electron imports so scripts/test-pet-attack.cjs can drive it with simulated cursors.

const CHASE_LIMITS = Object.freeze({
  /** Re-plan the approach when the cursor has moved this far from the current target. */
  retargetDistancePx: 48,
  /** Minimum time between re-plans, so a jittery pointer does not make the pet stutter. */
  retargetIntervalMs: 220,
  /** Give up after chasing this long; the pet is a companion, not a hunter. */
  maxChaseMs: 7_000,
  /** Distance from the pet's center within which it strikes instead of chasing further. */
  strikeRangePx: 260,
  /** Charge speed in px/s (the ordinary wander walk is much slower). */
  chargeSpeed: 620,
});

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Decides what to do on each frame of the approach walk.
 * @returns {"abort"|"give-up"|"retarget"|"continue"}
 */
function chaseDecision({ now, chaseStartedAt, lastRetargetAt, cursor, target, cursorOnPetDisplay }, limits = CHASE_LIMITS) {
  if (!cursorOnPetDisplay) return "abort";
  if (now - chaseStartedAt > limits.maxChaseMs) return "give-up";
  if (distance(cursor, target) > limits.retargetDistancePx && now - lastRetargetAt >= limits.retargetIntervalMs) return "retarget";
  return "continue";
}

/**
 * Decides, at the moment of an attack, whether the cursor is close enough to hit.
 * @returns {"strike"|"chase"|"give-up"|"abort"}
 */
function strikeDecision({ now, chaseStartedAt, cursor, petCenter, cursorOnPetDisplay }, limits = CHASE_LIMITS) {
  if (!cursorOnPetDisplay) return "abort";
  if (distance(cursor, petCenter) <= limits.strikeRangePx) return "strike";
  return now - chaseStartedAt > limits.maxChaseMs ? "give-up" : "chase";
}

/** Facing (1 = right, -1 = left) for a pet centered at petCenter looking at cursor. */
function facingToward(petCenter, cursor, current = 1) {
  if (Math.abs(cursor.x - petCenter.x) < 6) return current;
  return cursor.x >= petCenter.x ? 1 : -1;
}

module.exports = { CHASE_LIMITS, chaseDecision, strikeDecision, facingToward };
