import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { ThemeDefinition, ThemeFamily } from "../../shared/contracts";
import { Button } from "../components/ui/Primitives";
import { gradientCss } from "./gradients";
import { themeEngine, themeStore } from "./themeEngine";

// Theme: the preset gallery. Cards show swatches and a mini preview of each theme
// (drawn from the theme's own validated colors, with the Skai defaults for keys it
// leaves out), with search, a light/dark filter and "Your themes" first. Clicking a
// card previews it on the whole app; Apply makes it the light or dark pick.

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)\([0-9.%deg /]+\)|transparent)$/i;
type Filter = "all" | "light" | "dark";

function paletteFor(theme: ThemeDefinition, defaults: Record<string, ThemeDefinition | undefined>) {
  const base = defaults[theme.appearance]?.colors ?? {};
  const color = (key: string) => { const value = theme.colors[`--skai-color-${key}`] ?? base[`--skai-color-${key}`]; return value && SAFE_COLOR.test(value) ? value : undefined; };
  const canvasGradient = theme.gradients?.canvas ? gradientCss(theme.gradients.canvas) : null;
  const buttonGradient = theme.gradients?.["primary-button"] ? gradientCss(theme.gradients["primary-button"]) : null;
  return {
    style: {
      "--card-canvas": canvasGradient ?? color("canvas"),
      "--card-sidebar": color("sidebar"),
      "--card-surface": color("surface"),
      "--card-text": color("text"),
      "--card-muted": color("text-muted"),
      "--card-accent": buttonGradient ?? color("accent"),
      "--card-on-accent": color("on-accent"),
      "--card-border": color("border"),
    } as CSSProperties,
    swatches: ["canvas", "surface", "text", "accent", "danger", "success", "warning", "info"].map(color).filter((value): value is string => Boolean(value)),
  };
}

export function ThemeGallery() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => () => themeEngine.previewTheme(null), []);
  const skai = state.builtins.find((family) => family.name === "Skai");
  const defaults = { light: skai?.themes.find((theme) => theme.appearance === "light"), dark: skai?.themes.find((theme) => theme.appearance === "dark") };
  const picked = new Set([state.picks.lightTheme, state.picks.darkTheme]);
  const matches = (family: ThemeFamily, theme: ThemeDefinition) => (filter === "all" || theme.appearance === filter) && `${theme.name} ${family.name} ${family.author}`.toLowerCase().includes(query.trim().toLowerCase());
  const sections = useMemo(() => [
    { title: "Your themes", families: state.user },
    { title: "Built-in", families: state.builtins },
  ].map((section) => ({ ...section, entries: section.families.flatMap((family) => family.themes.filter((theme) => matches(family, theme)).map((theme) => ({ family, theme }))) })), [state.user, state.builtins, query, filter]);
  const previewing = state.previewThemeId ? [...state.builtins, ...state.user].flatMap((family) => family.themes).find((theme) => theme.id === state.previewThemeId) : null;

  return (
    <div className="theme-gallery">
      <div className="theme-gallery-heading">
        <div><strong>Theme gallery</strong><span>Click a theme to preview it on the whole app, then apply it as your light or dark theme.</span></div>
        <div className="theme-gallery-filters">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search themes…" aria-label="Search themes" />
          <div className="gradient-editor-kinds" role="radiogroup" aria-label="Show">{(["all", "light", "dark"] as Filter[]).map((value) => <button key={value} type="button" role="radio" aria-checked={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "light" ? "Light" : "Dark"}</button>)}</div>
        </div>
      </div>
      {previewing && (
        <div className="theme-gallery-preview-bar" role="status">
          <span>Previewing <strong>{previewing.name}</strong> ({previewing.appearance})</span>
          <Button type="button" variant="primary" onClick={() => void themeEngine.applyTheme(previewing.id)}>Apply as {previewing.appearance} theme</Button>
          <Button type="button" onClick={() => themeEngine.previewTheme(null)}>Cancel</Button>
        </div>
      )}
      {sections.map((section) => (
        <section key={section.title} className="theme-gallery-section" aria-label={section.title}>
          <h4>{section.title} <span>{section.entries.length}</span></h4>
          {section.entries.length === 0 && <p className="theme-gallery-empty">{section.title === "Your themes" ? "No themes of your own yet. Duplicate one, import a Base16 scheme, or drop a JSON file in the themes folder." : "No themes match."}</p>}
          <div className="theme-gallery-grid">
            {section.entries.map(({ family, theme }) => {
              const { style, swatches } = paletteFor(theme, defaults);
              const selected = state.previewThemeId === theme.id;
              return (
                <button key={theme.id} type="button" className={`theme-card${selected ? " is-previewing" : ""}${picked.has(theme.id) ? " is-picked" : ""}`} style={style} aria-pressed={selected} title={family.license ? `${family.name} · ${family.license}` : family.name} onClick={() => themeEngine.previewTheme(selected ? null : theme.id)}>
                  <span className="theme-card-mini" aria-hidden="true">
                    <span className="theme-card-mini-sidebar"><i /><i /><i /></span>
                    <span className="theme-card-mini-main"><b /><i /><i className="is-short" /><em /></span>
                  </span>
                  <span className="theme-card-swatches" aria-hidden="true">{swatches.map((color, index) => <i key={index} style={{ background: color }} />)}</span>
                  <span className="theme-card-name">{theme.name}</span>
                  <span className="theme-card-meta">{theme.appearance === "light" ? "Light" : "Dark"}{picked.has(theme.id) ? " · in use" : ""}{family.file ? ` · ${family.file}` : ""}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
