export type SkaiAchievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: string;
};

type AchievementDefinition = Omit<SkaiAchievement, "unlockedAt">;

const STORAGE_KEY = "skai.achievements.v1";
const definitions: AchievementDefinition[] = [
  { id: "hello-skai", title: "First Contact", description: "Skai says hello back. You know where to find us.", icon: "👋" },
  { id: "coffee-command", title: "Coffee Dependency", description: "Coffee service unavailable. Please connect a mug.", icon: "☕" },
  { id: "mascot-fan", title: "Mascot Fan", description: "Tap the Skai wolf logo seven times.", icon: "🐺" },
  { id: "retro-search", title: "Retro Signal", description: "Find the hidden theme in Settings search.", icon: "🕹️" },
];

export function readAchievements(): SkaiAchievement[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is SkaiAchievement => Boolean(item && typeof item === "object" && definitions.some((entry) => entry.id === (item as SkaiAchievement).id) && typeof (item as SkaiAchievement).unlockedAt === "string"));
  } catch {
    return [];
  }
}

export function unlockAchievement(id: string) {
  const definition = definitions.find((item) => item.id === id);
  if (!definition) return;
  const current = readAchievements();
  if (current.some((item) => item.id === id)) return;
  const achievement = { ...definition, unlockedAt: new Date().toISOString() };
  const next = [...current, achievement];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<SkaiAchievement>("skai:achievement-unlocked", { detail: achievement }));
}

export function enableRetroTheme() {
  localStorage.setItem("skai.easterEgg.retro", "true");
  document.documentElement.dataset.skaiRetro = "true";
}
