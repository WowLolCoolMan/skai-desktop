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
