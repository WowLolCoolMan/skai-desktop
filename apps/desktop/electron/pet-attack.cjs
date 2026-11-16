const ACTIONS = ["approach-cursor", "pounce", "fire-breath"];

function normalizePetBehaviorSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  const actions = Array.isArray(settings.actions)
    ? [...new Set(settings.actions.filter((action) => ACTIONS.includes(action)))]
    : [];
  const minimumIntervalSeconds = boundedInterval(settings.minimumIntervalSeconds, 60);
  const maximumIntervalSeconds = Math.max(minimumIntervalSeconds, boundedInterval(settings.maximumIntervalSeconds, 180));
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
  return Number.isFinite(parsed) ? Math.round(Math.max(20, Math.min(480, parsed))) : fallback;
}

function randomAttackSequence(settings, random = Math.random) {
  const available = settings.actions.filter((action) => ACTIONS.includes(action));
  if (available.length === 0) return [];
  const selected = available.filter(() => random() < 0.66);
  if (selected.length === 0) selected.push(available[Math.floor(random() * available.length)]);
  if (selected.some((action) => action === "pounce" || action === "fire-breath") && !selected.includes("approach-cursor")) {
    selected.unshift("approach-cursor");
  }
  return selected;
}

module.exports = { normalizePetBehaviorSettings, randomAttackSequence };
