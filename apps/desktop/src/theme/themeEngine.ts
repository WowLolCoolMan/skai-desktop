import type { AgentResponse, CustomFont, ThemeDefinition, ThemeFamily, ThemeFont, ThemeGradient, ThemePicks, ThemeProblem, ThemeSnapshot } from "../../shared/contracts";
import { buildFontRoles, FONT_ROLES, type FontRole, type FontRoles } from "./fontRoles";
import { GRADIENT_SURFACES, gradientContrastWarnings, gradientCss, type ContrastWarning, type GradientSurface } from "./gradients";

// Theme engine (renderer). Built-in presets ship in src/theme/presets; user themes
// arrive from the main process already validated (electron/theme-service.cjs).
// The active theme for the resolved scheme is applied as inline --skai-* custom
// properties on <html>. Keys a theme leaves out keep the tokens.css default.

type Request = (method: string, params?: Record<string, unknown>) => Promise<AgentResponse>;
type RawFamily = { name: string; author?: string; license?: string; themes: { name: string; appearance: "light" | "dark"; colors?: Record<string, string>; fonts?: ThemeDefinition["fonts"]; gradients?: Record<string, string | { gradient: "linear" | "radial" | "conic"; angle?: number; stops: { color: string; at: number }[] }> }[] };

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
      // Same normalized shape the main process sends for user themes (validated by test:themes).
      gradients: Object.fromEntries(Object.entries(theme.gradients ?? {}).map(([surface, value]) => [surface, typeof value === "string" ? { gradient: "solid" as const, color: value } : { gradient: value.gradient, angle: value.angle ?? 180, stops: [...value.stops].sort((a, b) => a.at - b.at) }])),
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
  fontsDir: string;
  // Font role overrides chosen in Appearance (appearance.json); they win over the theme's fonts.
  userFonts: FontRoles;
  customFonts: (CustomFont & { status: "loading" | "ready" | "failed" })[];
  scheme: "light" | "dark";
  // Text that fails contrast against a gradient stop of the active theme.
  contrastWarnings: ContrastWarning[];
  // Appearance: slow canvas gradient drift (only while reduced motion is off).
  animateBackground: boolean;
  // Gradient editor: unsaved drafts shown live on top of the active theme (null = no gradient).
  previewGradients: Partial<Record<GradientSurface, ThemeGradient | null>>;
  // Gallery: a theme shown on the app before it is applied (its own light/dark scheme).
  previewThemeId: string | null;
  active: ThemeDefinition | null;
  loaded: boolean;
  notice: { tone: "info" | "error"; text: string } | null;
};

let state: ThemeState = { builtins: builtinFamilies(), user: [], problems: [], picks: { ...DEFAULT_PICKS }, themesDir: "", fontsDir: "", userFonts: {}, customFonts: [], contrastWarnings: [], animateBackground: false, previewGradients: {}, previewThemeId: null, scheme: "dark", active: null, loaded: false, notice: null };
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
  const preview = next.previewThemeId ? allThemes(next).find((entry) => entry.theme.id === next.previewThemeId)?.theme : null;
  if (preview) return preview;
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
  // A gallery preview shows the theme in its own scheme; otherwise the mode's scheme applies.
  root.dataset.scheme = state.previewThemeId && theme ? theme.appearance : state.scheme;
  // Colors: the built-in Skai family is what tokens.css already defines.
  if (theme && !theme.id.startsWith(`builtin:${CSS_DEFAULT_FAMILY}/`)) {
    for (const [property, value] of Object.entries(theme.colors)) {
      if (/^--skai-[a-z0-9-]+$/.test(property) && SAFE_COLOR.test(value)) set(property, value);
    }
  }
  // Fonts: the theme's roles with Appearance overrides on top (per property), as family
  // stacks and size scales (properties) plus a generated stylesheet for the rest.
  const fonts = buildFontRoles(effectiveFonts(theme));
  for (const [property, value] of Object.entries(fonts.properties)) set(property, value);
  let style = document.getElementById("skai-font-roles");
  if (!fonts.css) style?.remove();
  else {
    if (!style) { style = document.createElement("style"); style.id = "skai-font-roles"; document.head.append(style); }
    style.textContent = fonts.css;
  }
  // Gradients: --skai-bg-<surface> plus <html data-skai-gradient-<surface>> (see surfaces.css).
  for (const surface of GRADIENT_SURFACES) delete root.dataset[datasetKey(surface)];
  const gradients: Partial<Record<GradientSurface, NonNullable<ThemeDefinition["gradients"][string]>>> = {};
  for (const surface of GRADIENT_SURFACES) {
    const gradient = surface in state.previewGradients ? state.previewGradients[surface] : theme?.gradients?.[surface];
    const css = gradient ? gradientCss(gradient) : null;
    if (!gradient || !css) continue;
    set(`--skai-bg-${surface}`, css);
    root.dataset[datasetKey(surface)] = "";
    gradients[surface] = gradient;
  }
  const styles = getComputedStyle(root);
  contrastWarnings = gradientContrastWarnings(gradients, (token) => styles.getPropertyValue(token).trim());
}
let contrastWarnings: ContrastWarning[] = [];
const datasetKey = (surface: GradientSurface) => `skaiGradient${surface.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase())}`;

export function effectiveFonts(theme: ThemeDefinition | null, current: ThemeState = state): FontRoles {
  const merged: FontRoles = {};
  for (const role of FONT_ROLES) {
    const font = { ...(theme?.fonts?.[role] ?? {}), ...(current.userFonts[role] ?? {}) };
    if (Object.keys(font).length) merged[role] = font;
  }
  return merged;
}

function update(patch: Partial<ThemeState>) {
  const next = { ...state, ...patch };
  next.active = resolveActive(next);
  const changed = next.active?.id !== state.active?.id || next.active !== state.active || next.userFonts !== state.userFonts || next.previewGradients !== state.previewGradients || next.previewThemeId !== state.previewThemeId || !state.loaded;
  state = next;
  if (changed) { applyTheme(state.active); state = { ...state, contrastWarnings }; }
  document.documentElement.dataset.skaiAnimateBackground = String(state.animateBackground);
  listeners.forEach((listener) => listener());
}

function receive(snapshot: ThemeSnapshot) {
  update({ user: snapshot.families, problems: snapshot.problems, picks: snapshot.picks, themesDir: snapshot.themesDir, fontsDir: snapshot.fontsDir ?? "", userFonts: (snapshot.fonts ?? {}) as FontRoles, animateBackground: Boolean(snapshot.animateBackground), loaded: true });
  void loadCustomFonts(snapshot.customFonts ?? []);
}

// Custom fonts: bytes come from the main process (already checked), loaded with the
// FontFace API under the family name derived from the file name. A font the browser
// can't parse is reported and skipped; it never breaks the UI.
const loadedFaces = new Map<string, FontFace>();
async function loadCustomFonts(fonts: CustomFont[]) {
  const wanted = new Set(fonts.map((font) => `${font.file}:${font.bytes}`));
  for (const [key, face] of loadedFaces) if (!wanted.has(key)) { document.fonts.delete(face); loadedFaces.delete(key); }
  update({ customFonts: fonts.map((font) => ({ ...font, status: loadedFaces.has(`${font.file}:${font.bytes}`) ? "ready" as const : "loading" as const })) });
  for (const font of fonts) {
    const key = `${font.file}:${font.bytes}`;
    if (loadedFaces.has(key)) continue;
    let status: "ready" | "failed" = "failed";
    let message = "";
    const response = await call("appearance.readCustomFont", { file: font.file });
    if (response?.ok) {
      try {
        const binary = atob((response.result as { data: string }).data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const face = await new FontFace(font.family, bytes.buffer).load();
        document.fonts.add(face);
        loadedFaces.set(key, face);
        status = "ready";
      } catch { message = "could not be loaded as a font; it was skipped"; }
    } else message = response?.error?.message ?? "could not be read";
    update({ customFonts: state.customFonts.map((entry) => (entry.file === font.file ? { ...entry, status } : entry)), problems: message ? [...state.problems, { file: font.file, key: "(file)", problem: message }] : state.problems });
  }
}

export type InstalledFont = { family: string; monospace: boolean | null };
let installedCache: Promise<InstalledFont[]> | null = null;
// Installed fonts: Chromium's Local Font Access API first; fontconfig in the main process as fallback.
export function listInstalledFonts(): Promise<InstalledFont[]> {
  installedCache ??= (async () => {
    const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (query) {
      try {
        const faces = await query.call(window);
        const families = [...new Set(faces.map((face) => face.family).filter((family) => /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$/.test(family)))].sort((a, b) => a.localeCompare(b));
        if (families.length) return families.map((family) => ({ family, monospace: null }));
      } catch { /* permission or platform: fall back below */ }
    }
    const response = await call("appearance.listFonts");
    return response?.ok ? ((response.result as { fonts: { family: string; monospace: boolean }[] }).fonts) : [];
  })();
  const pending = installedCache;
  pending.then((fonts) => { if (!fonts.length && installedCache === pending) installedCache = null; }).catch(() => { installedCache = null; });
  return pending;
}

// Is a family monospace? Compare glyph widths with a canvas (narrow vs wide letters).
export function isMonospace(family: string): boolean {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  context.font = `16px "${family}", serif`;
  const narrow = context.measureText("iiiiiiiiii").width;
  const wide = context.measureText("WWWWWWWWWW").width;
  return Math.abs(narrow - wide) < 0.5;
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
  // Appearance font overrides: patch one role (null clears it), saved to appearance.json.
  async setFont(role: FontRole, font: ThemeFont | null) {
    const userFonts: FontRoles = { ...state.userFonts };
    if (font && Object.keys(font).length) userFonts[role] = font; else delete userFonts[role];
    update({ userFonts });
    const response = await call("appearance.saveFonts", { fonts: { [role]: font && Object.keys(font).length ? font : null } });
    if (response && !response.ok) notify("error", response.error?.message ?? "The font settings could not be saved.");
  },
  // Gradient editor: show a draft live (undefined drops the draft for that surface).
  previewGradient(surface: GradientSurface, gradient: ThemeGradient | null | undefined) {
    const previewGradients = { ...state.previewGradients };
    if (gradient === undefined) delete previewGradients[surface]; else previewGradients[surface] = gradient;
    update({ previewGradients });
  },
  clearPreviews() { update({ previewGradients: {} }); },
  // Gallery: preview a theme on the whole app without saving anything (null ends it).
  previewTheme(id: string | null) { if (id !== state.previewThemeId) update({ previewThemeId: id, previewGradients: {} }); },
  // Gallery: make the previewed theme the light or dark pick (by its appearance).
  async applyTheme(id: string) {
    const theme = allThemes().find((entry) => entry.theme.id === id)?.theme;
    if (!theme) return;
    update({ previewThemeId: null });
    await themeEngine.select(theme.appearance === "light" ? "lightTheme" : "darkTheme", id);
    if (theme.appearance !== state.scheme) notify("info", `${theme.name} is now your ${theme.appearance} theme. Set Color theme to ${theme.appearance === "light" ? "Light" : "Dark"} or System to see it.`);
  },
  // Save a gradient into the user's own copy of the active theme. A built-in theme is
  // duplicated first ("Duplicate as my theme"), then the copy is edited.
  async saveGradient(surface: GradientSurface, gradient: ThemeGradient | null) {
    let id = state.active?.id;
    if (!id) return false;
    if (!id.startsWith("user:")) {
      const duplicated = await call("appearance.duplicateTheme", { theme: state.active });
      if (!duplicated?.ok) { notify("error", duplicated?.error?.message ?? "The theme could not be duplicated."); return false; }
      id = (duplicated.result as { id: string }).id;
      await themeEngine.select(state.scheme === "light" ? "lightTheme" : "darkTheme", id);
      notify("info", `Built-in themes are read-only, so it was copied to ${(duplicated.result as { file: string }).file} first.`);
    }
    const response = await call("appearance.saveThemeGradient", { id, surface, gradient });
    if (!response?.ok) { notify("error", response?.error?.message ?? "The gradient could not be saved."); return false; }
    await themeEngine.reload();
    themeEngine.previewGradient(surface, undefined);
    return true;
  },
  async setAnimateBackground(enabled: boolean) {
    update({ animateBackground: enabled });
    const response = await call("appearance.saveAppearanceOptions", { animateBackground: enabled });
    if (response && !response.ok) notify("error", response.error?.message ?? "The setting could not be saved.");
  },
  async openFontsFolder() {
    const response = await call("appearance.openFontsFolder");
    if (response && !response.ok) notify("error", response.error?.message ?? "The fonts folder could not be opened.");
  },
};

async function call(method: string, params?: Record<string, unknown>): Promise<AgentResponse | null> {
  if (!request || !window.skaiAgent) return null;
  return request(method, params).catch((error: unknown): AgentResponse => ({ v: 1, id: method, ok: false, error: { code: "FAILED", message: error instanceof Error ? error.message : String(error) } }));
}

function notify(tone: "info" | "error", text: string) { update({ notice: { tone, text } }); }
