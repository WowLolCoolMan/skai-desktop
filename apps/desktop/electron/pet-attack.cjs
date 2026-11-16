const ACTIONS = ["approach-cursor", "pounce", "fire-breath"];

function normalizePetBehaviorSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const actions = Array.isArray(settings.actions)
    ? [...new Set(settings.actions.filter((action) => ACTIONS.includes(action)))]
    : [];
  const minimumIntervalSeconds = boundedInterval(settings.minimumIntervalSeconds, 12);
  const maximumIntervalSeconds = Math.max(minimumIntervalSeconds, boundedInterval(settings.maximumIntervalSeconds, 24));
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
  const selectedAttacks = attacks.filter(() => random() < 0.66);
  if (selectedAttacks.length === 0 && attacks.length > 0) selectedAttacks.push(attacks[Math.floor(random() * attacks.length)]);
  const approach = available.includes("approach-cursor") || selectedAttacks.length > 0;
  return [...(approach ? ["approach-cursor"] : []), ...selectedAttacks];
}

module.exports = { normalizePetBehaviorSettings, randomAttackSequence };
