// Shared 16 ms motion ticker adapted from OpenPets' pet-motion-engine.ts.
// Skai feeds it grid-planned path updates; OpenPets' per-pet registration,
// shared-timer lifecycle, cancellation, and single-writer approach are kept.
// See THIRD_PARTY_NOTICES.md for the OpenPets MIT notice.
function createPetMotionEngine(options = {}) {
  const intervalMs = Math.max(8, Math.min(50, Number(options.intervalMs) || 16));
  const updates = new Map();
  let timer = null;
  let disposed = false;

  function stopTicker() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function tickAll() {
    if (disposed) return stopTicker();
    const timestamp = performance.now();
    for (const [id, update] of [...updates]) {
      if (updates.get(id) !== update) continue;
      try {
        if (update(timestamp) === false) updates.delete(id);
      } catch (error) {
        updates.delete(id);
        options.onError?.(id, error);
      }
    }
    if (updates.size === 0) stopTicker();
  }

  function startTicker() {
    if (timer !== null || disposed || updates.size === 0) return;
    timer = setInterval(tickAll, intervalMs);
    timer.unref?.();
  }

  return {
    register(id, update) {
      if (disposed || typeof id !== "string" || typeof update !== "function") return;
      updates.set(id, update);
      startTicker();
    },
    unregister(id) {
      updates.delete(id);
      if (updates.size === 0) stopTicker();
    },
    unregisterAll() {
      updates.clear();
      stopTicker();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      updates.clear();
      stopTicker();
    },
    isActive(id) { return id === undefined ? updates.size > 0 : updates.has(id); },
  };
}

module.exports = { createPetMotionEngine };
