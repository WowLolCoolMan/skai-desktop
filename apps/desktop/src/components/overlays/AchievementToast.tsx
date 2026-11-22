import { useEffect, useState } from "react";
import type { SkaiAchievement } from "../../features/settings/easterEggs";

export function AchievementToast() {
  const [achievement, setAchievement] = useState<SkaiAchievement | null>(null);
  useEffect(() => {
    const onUnlock = (event: Event) => {
      setAchievement((event as CustomEvent<SkaiAchievement>).detail);
    };
    window.addEventListener("skai:achievement-unlocked", onUnlock);
    return () => window.removeEventListener("skai:achievement-unlocked", onUnlock);
  }, []);
  useEffect(() => {
    if (!achievement) return;
    const timeout = window.setTimeout(() => setAchievement(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [achievement]);
  if (!achievement) return null;
  return <div className="achievement-toast" role="status" aria-live="polite">
    <span className="achievement-toast-icon" aria-hidden="true">{achievement.icon}</span>
    <span><small>ACHIEVEMENT UNLOCKED</small><strong>{achievement.title}</strong><p>{achievement.description}</p></span>
    <button type="button" aria-label="Dismiss achievement" onClick={() => setAchievement(null)}>x</button>
  </div>;
}
