/** Root mean square amplitude for normalized Float32 microphone samples. */
export function audioRms(samples: ArrayLike<number>) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}

/** Require sustained microphone energy before treating echo or a click as an interruption. */
export function isSustainedVoiceActivity(level: number, threshold: number, startedAt: number, now: number, durationMs = 180) {
  return level > threshold && startedAt > 0 && now - startedAt >= durationMs;
}

export function voiceActivityThreshold(noiseFloor: number, monitorDuringPlayback: boolean, sensitivity = 50) {
  const level = Number.isFinite(sensitivity) ? Math.max(0, Math.min(100, sensitivity)) : 50;
  const sensitivityScale = 1.5 - level / 100;
  return monitorDuringPlayback ? Math.max(0.002, noiseFloor * 2.8 * sensitivityScale) : Math.max(0.0003, noiseFloor * 1.6 * sensitivityScale);
}
