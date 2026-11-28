export type SavedPrompt = { id: string; name: string; prompt: string; alias: string };
export type SendBehavior = "enter-sends" | "shift-enter-sends";
export type ToolbarLayout = "descriptive" | "compact";
export type CommandPreferences = {
  shortcuts: Record<string, string>;
  savedPrompts: SavedPrompt[];
  sendBehavior: SendBehavior;
  toolbarLayout: ToolbarLayout;
};

export const commandPreferencesKey = "skai.command-workflows.v1";
export const commandPreferencesEvent = "skai-command-workflows-changed";
export const defaultShortcuts: Record<string, string> = {
  palette: "Ctrl+K", newChat: "Ctrl+N", settings: "Ctrl+,", chat: "Ctrl+1", coding: "Ctrl+2", terminal: "Ctrl+3",
};
export const shortcutActions = [
  { id: "palette", label: "Open command palette", description: "Search commands and destinations" },
  { id: "newChat", label: "New chat", description: "Start a fresh conversation" },
  { id: "settings", label: "Open Settings", description: "Go to workspace preferences" },
  { id: "chat", label: "Open Chat", description: "Return to conversations" },
  { id: "coding", label: "Open Coding", description: "Open coding workspace" },
  { id: "terminal", label: "Open Terminal", description: "Open local terminal" },
] as const;

export function readCommandPreferences(): CommandPreferences {
  const defaults: CommandPreferences = { shortcuts: defaultShortcuts, savedPrompts: [], sendBehavior: "enter-sends", toolbarLayout: "descriptive" };
  try {
    const raw = JSON.parse(localStorage.getItem(commandPreferencesKey) ?? "null") as Partial<CommandPreferences> | null;
    if (!raw || typeof raw !== "object") return defaults;
    const shortcuts = { ...defaultShortcuts };
    for (const action of shortcutActions) {
      const value = raw.shortcuts?.[action.id];
      if (typeof value === "string" && value.length <= 32) shortcuts[action.id] = value;
    }
    const promptAliases = new Set<string>();
    const savedPrompts = Array.isArray(raw.savedPrompts) ? raw.savedPrompts.filter((item): item is SavedPrompt => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && typeof item.prompt === "string" && typeof item.alias === "string"))
      .map((item) => ({ id: item.id.slice(0, 80), name: item.name.slice(0, 60), prompt: item.prompt.slice(0, 8_000), alias: item.alias.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) }))
      .filter((item) => { const alias = item.alias.toLowerCase(); if (!alias || promptAliases.has(alias)) return false; promptAliases.add(alias); return true; }).slice(0, 40) : [];
    return { shortcuts, savedPrompts, sendBehavior: raw.sendBehavior === "shift-enter-sends" ? raw.sendBehavior : "enter-sends", toolbarLayout: raw.toolbarLayout === "compact" ? "compact" : "descriptive" };
  } catch { return defaults; }
}

export function writeCommandPreferences(value: CommandPreferences) {
  try { localStorage.setItem(commandPreferencesKey, JSON.stringify(value)); window.dispatchEvent(new Event(commandPreferencesEvent)); } catch { /* Settings remain usable if local storage is full or unavailable. */ }
}

export function normalizeShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key === "Control" || event.key === "Meta") return "";
  const key = event.key === "," ? "," : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return `Ctrl${event.shiftKey ? "+Shift" : ""}+${key}`;
}

export function formatShortcutLabel(shortcut: string, platform = typeof navigator === "undefined" ? "" : navigator.platform) {
  if (!platform.toLowerCase().includes("mac")) return shortcut;
  return shortcut.replace(/\bCtrl\b/g, "⌘").replace(/\bAlt\b/g, "Option");
}

export function formatShortcutForAssistiveTech(shortcut: string) {
  return formatShortcutLabel(shortcut).replace(/⌘/g, "Meta").replace(/\bCtrl\b/g, "Control").replace(/\bOption\b/g, "Alt");
}

