import type { AgentResponse, ThemeDefinition, ThemeFamily, ThemePicks, ThemeProblem, ThemeSnapshot } from "../../shared/contracts";
import { buildFontRoles } from "./fontRoles";

// Theme engine (renderer). Built-in presets ship in src/theme/presets; user themes
// arrive from the main process already validated (electron/theme-service.cjs).
// The active theme for the resolved scheme is applied as inline --skai-* custom
// properties on <html>. Keys a theme leaves out keep the tokens.css default.

type Request = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;
type RawFamily = { name: string; author?: string; license?: string; themes: { name: string; appearance: "light" | "dark"; colors?: Record<string, string>; fonts?: ThemeDefinition["fonts"] }[] };

export const DEFAULT_PICKS: ThemePicks = { lightTheme: "builtin:Skai/Skai Light", darkTheme: "builtin:Skai/Skai Dark" };
// The Skai family is what tokens.css already defines, so it applies nothing inline
// (that also keeps per-backdrop accent overrides in tokens.css working).
const CSS_DEFAULT_FAMILY = "Skai";

const tokenForColorKey = (key: string) => (key.startsWith("ansi-") || key.startsWith("syntax-") ? `--skai-${key}` : `--skai-color-${key}`);
// Defense in depth: values were validated in the main process (or by
// test:themes for presets); still refuse anything that isn't a plain color.
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)\([0-9.%deg /]+\)|transparent)$/i;

function builtinFamilies(): ThemeFamily[] {
  const modules = import.meta.glob<RawFamily>("./presets/*.json", { eager: true, import: "default" });
  return Object.values(modules).map((raw) => ({
    name: raw.name,
    author: raw.author ?? "",
    license: raw.license ?? "",
    themes: raw.themes.map((theme) => ({
      id: `builtin:${raw.name}/${theme.name}`,
      name: theme.name,
      appearance: theme.appearance,
      colors: Object.fromEntries(Object.entries(theme.colors ?? {}).map(([key, value]) => [tokenForColorKey(key), value])),
      gradients: {},
      fonts: theme.fonts ?? {},
    })),
  })).sort((a, b) => (a.name === CSS_DEFAULT_FAMILY ? -1 : b.name === CSS_DEFAULT_FAMILY ? 1 : a.name.localeCompare(b.name)));
}

export type ThemeState = {
  builtins: ThemeFamily[];
  user: ThemeFamily[];
  problems: ThemeProblem[];
  picks: ThemePicks;
  themesDir: string;
  scheme: "light" | "dark";
  active: ThemeDefinition | null;
  loaded: boolean;
  notice: { tone: "info" | "error"; text: string } | null;
};

let state: ThemeState = { builtins: builtinFamilies(), user: [], problems: [], picks: { ...DEFAULT_PICKS }, themesDir: "", scheme: "dark", active: null, loaded: false, notice: null };
const listeners = new Set<() => void>();
let applied: string[] = [];
let request: Request | null = null;
let started = false;

export const themeStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: () => state,
};

export function allThemes(current: ThemeState = state) {
  return [...current.builtins, ...current.user].flatMap((family) => family.themes.map((theme) => ({ family, theme })));
}

function resolveActive(next: ThemeState): ThemeDefinition | null {
  const id = next.scheme === "light" ? next.picks.lightTheme : next.picks.darkTheme;
  const fallback = next.scheme === "light" ? DEFAULT_PICKS.lightTheme : DEFAULT_PICKS.darkTheme;
  const themes = allThemes(next);
  return (themes.find((entry) => entry.theme.id === id) ?? themes.find((entry) => entry.theme.id === fallback))?.theme ?? null;
}

function applyTheme(theme: ThemeDefinition | null) {
  const root = document.documentElement;
  for (const property of applied) root.style.removeProperty(property);
  applied = [];
  const set = (property: string, value: string) => { root.style.setProperty(property, value); applied.push(property); };
  root.dataset.themeId = theme?.id ?? "";
  // Colors: the built-in Skai family is what tokens.css already defines.
  if (theme && !theme.id.startsWith(`builtin:${CSS_DEFAULT_FAMILY}/`)) {
    for (const [property, value] of Object.entries(theme.colors)) {
      if (/^--skai-[a-z0-9-]+$/.test(property) && SAFE_COLOR.test(value)) set(property, value);
    }
  }
  // Fonts: family stacks and size scales as properties, the rest as a generated stylesheet.
  const fonts = buildFontRoles(theme?.fonts ?? {});
  for (const [property, value] of Object.entries(fonts.properties)) set(property, value);
  let style = document.getElementById("skai-font-roles");
  if (!fonts.css) { style?.remove(); return; }
  if (!style) { style = document.createElement("style"); style.id = "skai-font-roles"; document.head.append(style); }
  style.textContent = fonts.css;
}

function update(patch: Partial<ThemeState>) {
  const next = { ...state, ...patch };
  next.active = resolveActive(next);
  const changed = next.active?.id !== state.active?.id || next.active !== state.active || !state.loaded;
  state = next;
  if (changed) applyTheme(state.active);
  listeners.forEach((listener) => listener());
}

function receive(snapshot: ThemeSnapshot) {
  update({ user: snapshot.families, problems: snapshot.problems, picks: snapshot.picks, themesDir: snapshot.themesDir, loaded: true });
}

export const themeEngine = {
  // Called once from useThemeEngine with the agent request function.
  start(nextRequest: Request) {
    request = nextRequest;
    if (started) return;
    started = true;
    window.skaiAgent?.appearance?.onChanged(receive);
    void themeEngine.reload();
  },
  async reload() {
    if (!request || !window.skaiAgent) { update({ loaded: true }); return; }
    const response = await request("appearance.getThemes").catch(() => null);
    if (response?.ok && response.result) receive(response.result as ThemeSnapshot);
    else update({ loaded: true, problems: [{ file: "themes", key: "(folder)", problem: response?.error?.message ?? "could not be loaded" }] });
  },
  setScheme(scheme: "light" | "dark") {
    if (scheme !== state.scheme || !state.loaded) update({ scheme });
  },
  async select(slot: keyof ThemePicks, id: string) {
    update({ picks: { ...state.picks, [slot]: id } });
    if (request && window.skaiAgent) await request("appearance.saveThemeSelection", { [slot]: id }).catch(() => undefined);
  },
  async openFolder() {
    if (request && window.skaiAgent) await request("appearance.openThemesFolder").catch(() => undefined);
  },
  // Open the active theme's file in the default editor (user themes only).
  async editCurrent() {
    const response = await call("appearance.editTheme", { id: state.active?.id });
    if (response && !response.ok) notify("error", response.error?.message ?? "The theme could not be opened.");
  },
  // Copy the active theme into the themes folder, switch to the copy, and open it for editing.
  async duplicateCurrent() {
    if (!state.active) return;
    const response = await call("appearance.duplicateTheme", { theme: state.active });
    if (!response?.ok) { notify("error", response?.error?.message ?? "The theme could not be duplicated."); return; }
    const { id, file } = response.result as { id: string; file: string };
    await themeEngine.select(state.scheme === "light" ? "lightTheme" : "darkTheme", id);
    notify("info", `Saved as ${file} in your themes folder.`);
    await call("appearance.editTheme", { id });
  },
  async importBase16() {
    const response = await call("appearance.importBase16");
    if (!response?.ok) { notify("error", response?.error?.message ?? "The scheme could not be imported."); return; }
    if (!response.result) return;
    const { id, file } = response.result as { id: string; file: string };
    await themeEngine.reload();
    const imported = allThemes().find((entry) => entry.theme.id === id)?.theme;
    if (imported) await themeEngine.select(imported.appearance === "light" ? "lightTheme" : "darkTheme", id);
    notify("info", `Imported as ${file}.`);
  },
  async exportCurrent() {
    if (!state.active) return;
    const family = allThemes().find((entry) => entry.theme.id === state.active?.id)?.family;
    const response = await call("appearance.exportTheme", { theme: state.active, familyName: family?.name, license: family?.license });
    if (!response?.ok) notify("error", response?.error?.message ?? "The theme could not be exported.");
    else if (response.result) notify("info", `Exported to ${(response.result as { path: string }).path}.`);
  },
  async resetToDefault() {
    await themeEngine.select("lightTheme", DEFAULT_PICKS.lightTheme);
    await themeEngine.select("darkTheme", DEFAULT_PICKS.darkTheme);
    notify("info", "Back to the default Skai themes.");
  },
  dismissNotice() { update({ notice: null }); },
};

async function call(method: string, params?: Record<string, unknown>): Promise<AgentResponse | null> {
  if (!request || !window.skaiAgent) return null;
  return request(method, params).catch((error: unknown): AgentResponse => ({ v: 1, id: method, ok: false, error: { code: "FAILED", message: error instanceof Error ? error.message : String(error) } }));
}

function notify(tone: "info" | "error", text: string) { update({ notice: { tone, text } }); }
