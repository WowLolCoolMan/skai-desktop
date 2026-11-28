import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppearanceOptions as Options } from "../../shared/contracts";
import { Button } from "../components/ui/Primitives";
import { contrastRatio, parseCssColor } from "./gradients";
import { themeEngine, themeStore } from "./themeEngine";

// Theme: Appearance → layout and motion options (appearance.json), the live preview
// card and "Reset appearance". Every change applies at once and is saved.

const read = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();
const toHex = (value: string) => { const rgba = parseCssColor(value); return rgba ? `#${rgba.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}` : null; };

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="appearance-option">
      <span>{label}</span>
      <div className="gradient-editor-kinds" role="radiogroup" aria-label={label}>
        {options.map(([option, text]) => <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? "is-active" : ""} onClick={() => onChange(option)}>{text}</button>)}
      </div>
    </div>
  );
}

// Top of Appearance: a live preview of the current look, and Reset appearance.
export function AppearancePreview() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="appearance-preview">
      <div className="appearance-preview-card" aria-label="Preview of the current appearance">
        <p className="eyebrow appearance-preview-eyebrow">Preview</p>
        <h3>{state.active?.name ?? "Skai"}</h3>
        <p className="appearance-preview-reading message-content">Replies read like this, with <code>inline code</code> and a <a href="#preview" onClick={(event) => event.preventDefault()}>link</a>.</p>
        <div className="appearance-preview-bubble">Your messages look like this.</div>
        <pre className="appearance-preview-code" tabIndex={0}><code>{"const theme = \"" + (state.active?.name ?? "Skai") + "\";"}</code></pre>
        <div className="appearance-preview-actions"><Button type="button" variant="primary" tabIndex={-1}>Primary</Button><Button type="button" tabIndex={-1}>Secondary</Button></div>
      </div>
      <div className="appearance-preview-reset">
        {!confirming && <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Reset appearance…</Button>}
        {confirming && <><span>Reset themes, fonts and layout to the defaults? Your theme and font files are kept.</span><Button type="button" variant="danger" onClick={() => { setConfirming(false); void themeEngine.resetAppearance(); }}>Reset</Button><Button type="button" onClick={() => setConfirming(false)}>Cancel</Button></>}
      </div>
    </div>
  );
}

export function AppearanceOptions() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const options = state.options;
  const set = <K extends keyof Options>(key: K, value: Options[K]) => void themeEngine.setOption(key, value);
  const [textScale, setTextScale] = useState(options.textScale);
  useEffect(() => setTextScale(options.textScale), [options.textScale]);
  // Accent choices come from the active theme's own palette (ANSI colors), plus a picker.
  const [swatches, setSwatches] = useState<string[]>([]);
  useEffect(() => {
    const colors = ["blue", "magenta", "cyan", "green", "yellow", "red"].map((name) => toHex(read(`--skai-ansi-${name}`))).filter((value): value is string => Boolean(value));
    setSwatches([...new Set(colors)]);
  }, [state.active?.id, state.scheme]);
  const accentContrast = (() => { const accent = parseCssColor(read("--skai-color-accent")); const canvas = parseCssColor(read("--skai-color-canvas")); return accent && canvas ? contrastRatio(accent, canvas) : null; })();

  return (
    <div className="appearance-options">
      <strong>Layout and motion</strong>
      <div className="appearance-option">
        <span>Text size</span>
        <div className="appearance-range">
          <input type="range" min={80} max={200} step={5} value={Math.round(textScale * 100)} onChange={(event) => setTextScale(Number(event.target.value) / 100)} onPointerUp={() => set("textScale", textScale)} onKeyUp={() => set("textScale", textScale)} aria-label="Text size" />
          <output>{Math.round(textScale * 100)}%</output>
          {options.textScale !== 1 && <Button type="button" variant="ghost" onClick={() => set("textScale", 1)}>100%</Button>}
        </div>
      </div>
      <Segmented label="Corners" value={options.cornerStyle} options={[["square", "Square"], ["subtle", "Subtle"], ["default", "Default"], ["round", "Round"]]} onChange={(value) => set("cornerStyle", value)} />
      <Segmented label="Chat width" value={options.chatWidth} options={[["narrow", "Narrow"], ["default", "Default"], ["wide", "Wide"], ["full", "Full"]]} onChange={(value) => set("chatWidth", value)} />
      <Segmented label="Messages" value={options.messageStyle} options={[["bubbles", "Bubbles"], ["flat", "Flat"], ["cards", "Cards"]]} onChange={(value) => set("messageStyle", value)} />
      <Segmented label="Motion" value={options.motion} options={[["system", "System"], ["reduce", "Reduce"], ["full", "Full"]]} onChange={(value) => set("motion", value)} />
      <div className="appearance-option">
        <span>Accent</span>
        <div className="appearance-accents">
          <button type="button" className={`appearance-accent-theme${options.accent === null ? " is-active" : ""}`} onClick={() => set("accent", null)}>Theme</button>
          {swatches.map((color) => <button key={color} type="button" className={`appearance-accent${options.accent === color ? " is-active" : ""}`} style={{ background: color }} aria-label={`Accent ${color}`} onClick={() => set("accent", color)} />)}
          <label className="appearance-accent-custom" title="Any color">Custom<input type="color" value={options.accent ?? toHex(read("--skai-color-accent")) ?? undefined} onChange={(event) => set("accent", event.target.value)} /></label>
        </div>
      </div>
      {options.accent && accentContrast !== null && accentContrast < 3 && <p className="gradient-editor-warning" role="status">This accent is {accentContrast.toFixed(2)}:1 on the background. Focus rings and accent text need 3:1, so pick a stronger color.</p>}
      <p className="appearance-options-note">The Reduced motion switch below also stills the app. Motion "Full" keeps animations even when your system asks to reduce them.</p>
    </div>
  );
}
