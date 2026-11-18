import type { Route } from "./types";

const STORAGE_KEY = "skai.navigation.route";
const HISTORY_KEY = "skaiNavigation";
const PERSONA_WORKSHOP_PATH = "persona-workshop";

export type PersonaWorkshopPage = "library" | "threads" | "groups" | "create" | "settings" | "memories" | "knowledge" | "chat";
export type PersonaWorkshopLocation = { page: PersonaWorkshopPage; personaId: string | null; conversationId: string | null };

export type NavigationState = {
  route: Route;
  index: number;
  length: number;
};

export function routeFromLocation(): Route {
  const hashRoute = window.location.protocol === "file:" ? window.location.hash.replace(/^#\/?/, "").split("/")[0] : window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  if (hashRoute === "workbench") return "chat";
  if (hashRoute === "plugins") return "marketplace";
  if (hashRoute === "personas" || hashRoute === "persona-groups") return "persona-workshop";
  if (hashRoute === "persona-workshop") return "persona-workshop";
  if (isRoute(hashRoute)) return hashRoute;
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  const route = decodeURIComponent(pathSegments.find((segment) => isRoute(segment)) ?? pathSegments[pathSegments.length - 1] ?? "") as Route;
  if (route === "workbench") return "chat";
  if (route === "plugins") return "marketplace";
  if (route === "personas" || route === "persona-groups") return "persona-workshop";
  if (isRoute(route)) return route;
  const storedRoute = localStorage.getItem(STORAGE_KEY) ?? "";
  if (storedRoute === "personas" || storedRoute === "persona-groups") return "persona-workshop";
  return storedRoute === "plugins" || storedRoute === "workbench" ? "chat" : (isRoute(storedRoute) ? storedRoute : "chat");
}

export function personaWorkshopLocation(): PersonaWorkshopLocation {
  const parts = window.location.protocol === "file:" ? window.location.hash.replace(/^#\/?/, "").split("/") : window.location.pathname.split("/").filter(Boolean);
  const baseIndex = parts.indexOf(PERSONA_WORKSHOP_PATH);
  const scopedParts = baseIndex >= 0 ? parts.slice(baseIndex) : [PERSONA_WORKSHOP_PATH];
  const page = scopedParts[1] as PersonaWorkshopPage;
  const validPages: PersonaWorkshopPage[] = ["library", "threads", "groups", "create", "settings", "memories", "knowledge", "chat"];
  let personaPart = scopedParts[2] ?? "";
  let conversationPart = scopedParts[3] ?? "";
  // Older group-thread URLs dropped the empty persona slot, so their
  // conversation ID landed in personaId. Recover that unambiguous /chat/:id
  // shape while new URLs use an explicit placeholder for stable positions.
  if (page === "chat" && personaPart && !conversationPart) {
    conversationPart = personaPart;
    personaPart = "";
  }
  return {
    page: validPages.includes(page) ? page : "library",
    personaId: personaPart && personaPart !== "-" ? decodeURIComponent(personaPart) : null,
    conversationId: conversationPart && conversationPart !== "-" ? decodeURIComponent(conversationPart) : null,
  };
}

export function navigatePersonaWorkshop(page: PersonaWorkshopPage, personaId?: string | null, conversationId?: string | null, replace = false) {
  const currentRoute = routeFromLocation();
  const current = readNavigationState(currentRoute);
  const nextLength = Math.max(current.length, current.index + (replace ? 1 : 2));
  const state = replace
    ? { route: "persona-workshop" as Route, index: current.index, length: current.length }
    : { route: "persona-workshop" as Route, index: current.index + 1, length: nextLength };
  if (!replace) window.history.replaceState({ ...(window.history.state ?? {}), [HISTORY_KEY]: { ...current, length: nextLength } }, "", window.location.href);
  const segments = [PERSONA_WORKSHOP_PATH, page, personaId ? encodeURIComponent(personaId) : "-", conversationId ? encodeURIComponent(conversationId) : "-"];
  const url = window.location.protocol === "file:" ? `#/${segments.join("/")}` : `/${segments.join("/")}`;
  localStorage.setItem(STORAGE_KEY, "persona-workshop");
  window.history[replace ? "replaceState" : "pushState"]({ ...(window.history.state ?? {}), [HISTORY_KEY]: state }, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return state;
}

export function isRoute(value: string): value is Route {
  return ["chat", "projects", "coding", "settings", "models", "images", "marketplace", "terminal", "memory", "usage", "pet-workshop", "voice-workbench", "persona-workshop", "personas", "persona-groups"].includes(value);
}

function readHistoryState(): NavigationState | null {
  const state = window.history.state?.[HISTORY_KEY];
  if (!state || typeof state !== "object" || !isRoute(String(state.route))) return null;
  const index = Number(state.index);
  const length = Number(state.length);
  if (!Number.isInteger(index) || !Number.isInteger(length) || index < 0 || length < 1 || index >= length) return null;
  return { route: state.route, index, length };
}

export function readNavigationState(fallbackRoute: Route): NavigationState {
  return readHistoryState() ?? { route: fallbackRoute, index: 0, length: 1 };
}

export function initializeNavigation(route: Route): NavigationState {
  const current = readHistoryState();
  const state = current?.route === route ? current : { route, index: current?.index ?? 0, length: Math.max(current?.length ?? 1, (current?.index ?? 0) + 1) };
  const personaPath = route === "persona-workshop" && (window.location.hash.startsWith("#/persona-workshop/") || window.location.pathname.includes("/persona-workshop/")) ? (window.location.protocol === "file:" ? window.location.hash.slice(1) : window.location.pathname) : null;
  window.history.replaceState({ ...(window.history.state ?? {}), [HISTORY_KEY]: state }, "", personaPath ?? (window.location.protocol === "file:" ? `#/${route}` : `/${route}`));
  localStorage.setItem(STORAGE_KEY, route);
  return state;
}

export function navigate(route: Route, replace = false) {
  const currentRoute = routeFromLocation();
  const current = readNavigationState(currentRoute);
  if (!replace && current.route === route) return current;
  const nextLength = Math.max(current.length, current.index + 2);
  const state = replace
    ? { route, index: current.index, length: current.length }
    : { route, index: current.index + 1, length: nextLength };
  localStorage.setItem(STORAGE_KEY, route);
  if (!replace) {
    window.history.replaceState({ ...(window.history.state ?? {}), [HISTORY_KEY]: { ...current, length: nextLength } }, "", window.location.href);
  }
  window.history[replace ? "replaceState" : "pushState"]({ ...(window.history.state ?? {}), [HISTORY_KEY]: state }, "", window.location.protocol === "file:" ? `#/${route}` : `/${route}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return state;
}
