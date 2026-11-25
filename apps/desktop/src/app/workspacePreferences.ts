import { localEndpointOrFallback, localProviderOrFallback } from "../services/localOnly";
import type { ThemeMode } from "./types";

export function readPetInteractionDemoPreference(): boolean {
  const preferenceKey = "skai.pet.interactionDemo";
  const defaultOffMigrationKey = "skai.pet.interactionDemoDefaultOff.v1";
  if (localStorage.getItem(defaultOffMigrationKey) !== "true") {
    localStorage.setItem(preferenceKey, "false");
    localStorage.setItem(defaultOffMigrationKey, "true");
    return false;
  }
  return localStorage.getItem(preferenceKey) === "true";
}

function readPreferredChatModel(): { model: string; provider: string; endpoint?: string | null } | null {
  try {
    const stored = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}");
    const chat = stored?.chat;
    return chat && typeof chat.model === "string" && typeof chat.provider === "string" ? chat : null;
  } catch { return null; }
}
const preferredChatModel = readPreferredChatModel();
export const defaultEndpoint = localEndpointOrFallback(preferredChatModel?.endpoint ?? localStorage.getItem("skai.endpoint"), "http://localhost:11434/v1");
export const defaultModel = preferredChatModel?.model ?? localStorage.getItem("skai.model") ?? "llama3.2";
export const defaultProvider = localProviderOrFallback(preferredChatModel?.provider ?? localStorage.getItem("skai.provider"));
const SIDEBAR_WIDTH_KEY = "skai.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 276;
const MIN_SIDEBAR_WIDTH = 248;
const MAX_SIDEBAR_WIDTH = 360;
export function readAgentMode(): "ChatBot" | "Coding Agent" {
  return localStorage.getItem("skai.agentMode") === "Coding Agent" ? "Coding Agent" : "ChatBot";
}

export function readSidebarWidth() {
  const storedValue = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!storedValue) return DEFAULT_SIDEBAR_WIDTH;
  const stored = Number(storedValue);
  return Number.isFinite(stored) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored)) : DEFAULT_SIDEBAR_WIDTH;
}

export function readThemeMode(): ThemeMode {
  const stored = localStorage.getItem("skai.themeMode");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}

export function readStoredBoolean(key: string, fallback: boolean) {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}
