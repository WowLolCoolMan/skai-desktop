import { useSyncExternalStore } from "react";
import type { ThemePicks } from "../../shared/contracts";
import { Button } from "../components/ui/Primitives";
import { themeEngine, themeStore } from "./themeEngine";
import { FontSettings } from "./FontSettings";
import { GradientEditor } from "./GradientEditor";
import "./theme.css";

// Theme: Appearance controls for theme files: a light pick and a dark pick
// (Light / Dark / System chooses between them), the themes folder, reload,
// and a non-blocking list of problems found in theme files.
export function ThemeSettings() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const families = [...state.builtins, ...state.user];
  const picker = (slot: keyof ThemePicks, appearance: "light" | "dark", label: string) => (
    <label>{label}
      <select value={state.picks[slot]} onChange={(event) => void themeEngine.select(slot, event.target.value)}>
        {families.map((family) => {
          const themes = family.themes.filter((theme) => theme.appearance === appearance);
          if (!themes.length) return null;
          return <optgroup key={`${family.file ?? "builtin"}:${family.name}`} label={family.file ? `${family.name} (${family.file})` : family.name}>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </optgroup>;
        })}
      </select>
    </label>
  );
  return (
    <div className="theme-settings">
      <div className="settings-field">{picker("lightTheme", "light", "Light theme")}{picker("darkTheme", "dark", "Dark theme")}</div>
      <div className="theme-settings-actions">
        <Button type="button" onClick={() => void themeEngine.openFolder()}>Open themes folder</Button>
        <Button type="button" onClick={() => void themeEngine.editCurrent()} disabled={!state.active?.id.startsWith("user:")} title={state.active?.id.startsWith("user:") ? "Open this theme's file in your editor" : "Built-in themes are read-only: duplicate first"}>Edit current theme</Button>
        <Button type="button" onClick={() => void themeEngine.duplicateCurrent()}>Duplicate as my theme</Button>
        <Button type="button" onClick={() => void themeEngine.importBase16()}>Import Base16/Base24…</Button>
        <Button type="button" onClick={() => void themeEngine.exportCurrent()}>Export current theme…</Button>
        <Button type="button" variant="ghost" onClick={() => void themeEngine.reload()}>Reload themes</Button>
        <Button type="button" variant="ghost" onClick={() => void themeEngine.resetToDefault()}>Reset to default</Button>
      </div>
      {state.themesDir && <span className="theme-settings-path" title={state.themesDir}>{state.themesDir}</span>}
      {state.notice && <div className={`theme-settings-notice is-${state.notice.tone}`} role="status"><span>{state.notice.text}</span><button type="button" onClick={() => themeEngine.dismissNotice()} aria-label="Dismiss">×</button></div>}
      {state.contrastWarnings.length > 0 && (
        <div className="theme-settings-contrast" role="status">
          <strong>Some text may be hard to read on this theme's gradients.</strong>
          <ul>{state.contrastWarnings.slice(0, 8).map((warning, index) => <li key={index}><code>{warning.surface}</code> stop {warning.stop} (<code>{warning.color}</code>) against <code>{warning.token.replace("--skai-color-", "")}</code>: {warning.ratio}:1, needs {warning.surface === "rail" ? 3 : 4.5}:1</li>)}</ul>
        </div>
      )}
      <label className="theme-settings-toggle">
        <input type="checkbox" checked={state.animateBackground} onChange={(event) => void themeEngine.setAnimateBackground(event.target.checked)} />
        <span><strong>Animate background</strong><small>Slowly moves the theme's canvas gradient. Stays still while reduced motion is on.</small></span>
      </label>
      <GradientEditor />
      <FontSettings />
      {state.problems.length > 0 && (
        <div className="theme-settings-problems" role="status">
          <strong>Some theme files have problems. Everything else still works.</strong>
          <ul>{state.problems.slice(0, 12).map((problem, index) => <li key={index}><code>{problem.file}</code> {problem.key !== "(file)" && problem.key !== "(folder)" && <code>{problem.key}</code>} {problem.problem}</li>)}</ul>
          {state.problems.length > 12 && <span>and {state.problems.length - 12} more.</span>}
        </div>
      )}
    </div>
  );
}
