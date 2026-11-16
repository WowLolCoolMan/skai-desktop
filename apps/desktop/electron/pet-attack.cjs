const CURSOR_ACTIONS = ["approach-cursor", "pounce", "fire-breath"];
const ACTIONS = [...CURSOR_ACTIONS, "celebrate", "curious-scan", "ember-curl", "star-orbit", "rock-roll", "sprout-stretch"];

function normalizePetBehaviorSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const actions = Array.isArray(settings.actions)
    ? [...new Set(settings.actions.filter((action) => ACTIONS.includes(action)))]
    : [];
  const minimumIntervalSeconds = boundedInterval(settings.minimumIntervalSeconds, 30);
  const maximumIntervalSeconds = Math.max(minimumIntervalSeconds, boundedInterval(settings.maximumIntervalSeconds, 60));
  return {
    enabled: settings.enabled === true && actions.length > 0,
    triggerDuringIdle: settings.triggerDuringIdle !== false,
    triggerDuringWalk: settings.triggerDuringWalk !== false,
    minimumIntervalSeconds,
    maximumIntervalSeconds,
    actions,
  };
}

function boundedInterval(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(10, Math.min(480, parsed))) : fallback;
}

function randomAttackSequence(settings, random = Math.random) {
  const available = settings.actions.filter((action) => ACTIONS.includes(action));
  if (available.length === 0) return [];
  const attacks = available.filter((action) => action === "pounce" || action === "fire-breath");
  if (attacks.length === 0) {
    const visualActions = available.filter((action) => !CURSOR_ACTIONS.includes(action));
    return visualActions.length ? [visualActions[Math.floor(random() * visualActions.length)]] : [];
  }
  const selectedAttacks = attacks.filter(() => random() < 0.66);
  if (selectedAttacks.length === 0 && attacks.length > 0) selectedAttacks.push(attacks[Math.floor(random() * attacks.length)]);
  return ["approach-cursor", ...selectedAttacks];
}

module.exports = { normalizePetBehaviorSettings, randomAttackSequence };
