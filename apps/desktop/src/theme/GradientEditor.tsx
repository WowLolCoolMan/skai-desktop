import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { ThemeGradient } from "../../shared/contracts";
import { Button } from "../components/ui/Primitives";
import { GRADIENT_SURFACES, gradientContrastWarnings, gradientCss, parseCssColor, type GradientSurface } from "./gradients";
import { themeEngine, themeStore } from "./themeEngine";

// Theme: Appearance → Gradients. Pick a surface, choose solid / linear / radial / conic,
// set the angle with a dial, add / drag / remove color stops, and see it live on the app.
// Saving writes into the user's copy of the theme (a built-in theme is duplicated first).

type Kind = ThemeGradient["gradient"];
type Stop = { color: string; at: number };
type Draft = { kind: Kind; angle: number; stops: Stop[] };

const SURFACE_LABELS: Record<GradientSurface, string> = { canvas: "App background", sidebar: "Sidebar", toolbar: "Toolbar", rail: "Icon rail", composer: "Message box", "user-bubble": "Your messages", "primary-button": "Primary buttons", "brand-mark": "App mark", "empty-state": "Empty screens", backdrop: "Effects layer (with a backdrop)" };
const BASE_TOKEN: Record<GradientSurface, string> = { canvas: "--skai-color-canvas", sidebar: "--skai-color-sidebar", toolbar: "--skai-color-canvas", rail: "--skai-color-sidebar", composer: "--skai-color-surface", "user-bubble": "--skai-color-surface-raised", "primary-button": "--skai-color-accent", "brand-mark": "--skai-color-brand-mark", "empty-state": "--skai-color-surface", backdrop: "--skai-color-canvas" };

const read = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();
// #rrggbb for <input type="color">; anything unparseable falls back to the muted text color.
const toHex = (value: string) => {
  const rgba = parseCssColor(value) ?? parseCssColor(read("--skai-color-text-muted")) ?? [128, 128, 128, 1];
  return `#${rgba.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
};

function draftFrom(gradient: ThemeGradient | null | undefined, surface: GradientSurface): Draft {
  if (gradient && gradient.gradient !== "solid") return { kind: gradient.gradient, angle: gradient.angle, stops: gradient.stops.map((stop) => ({ ...stop })) };
  const base = toHex(gradient?.gradient === "solid" ? gradient.color : read(BASE_TOKEN[surface]));
  const second = toHex(read(surface === "primary-button" ? "--skai-color-accent-strong" : "--skai-color-surface-raised"));
  return { kind: gradient?.gradient === "solid" ? "solid" : "linear", angle: 135, stops: [{ color: base, at: 0 }, { color: second, at: 1 }] };
}
function toGradient(draft: Draft): ThemeGradient {
  if (draft.kind === "solid") return { gradient: "solid", color: draft.stops[0].color };
  return { gradient: draft.kind, angle: Math.round(draft.angle), stops: [...draft.stops].sort((a, b) => a.at - b.at).map((stop) => ({ color: stop.color, at: Math.round(stop.at * 1000) / 1000 })) };
}

export function GradientEditor() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const [surface, setSurface] = useState<GradientSurface>("canvas");
  const saved = state.active?.gradients?.[surface];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved, surface));
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // Reset the draft when the surface or the active theme changes (not while editing).
  useEffect(() => { if (!dirty) { setDraft(draftFrom(saved, surface)); setSelected(0); } }, [surface, state.active?.id, saved, dirty]);
  // Drafts preview live on the app; leaving the editor drops them.
  useEffect(() => { if (dirty) themeEngine.previewGradient(surface, toGradient(draft)); }, [draft, dirty, surface]);
  useEffect(() => () => themeEngine.clearPreviews(), []);

  const change = (next: Partial<Draft>) => { setDraft((current) => ({ ...current, ...next })); setDirty(true); };
  const setStop = (index: number, patch: Partial<Stop>) => change({ stops: draft.stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)) });
  const warnings = useMemo(() => gradientContrastWarnings({ [surface]: toGradient(draft) }, read), [draft, surface, state.active?.id]);
  const css = gradientCss(toGradient(draft)) ?? "transparent";
  const barCss = gradientCss({ gradient: "linear", angle: 90, stops: [...draft.stops].sort((a, b) => a.at - b.at) }) ?? "transparent";

  const dragStop = (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setSelected(index);
    const bar = barRef.current;
    if (!bar) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => { const rect = bar.getBoundingClientRect(); setStop(index, { at: Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width)) }); };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  const addStop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || draft.stops.length >= 8) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    change({ stops: [...draft.stops, { color: draft.stops[selected]?.color ?? toHex(""), at }] });
    setSelected(draft.stops.length);
  };
  const dialDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    svg.setPointerCapture(event.pointerId);
    const apply = (clientX: number, clientY: number) => { const rect = svg.getBoundingClientRect(); const degrees = (Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2)) * 180) / Math.PI + 90; change({ angle: Math.round((degrees + 360) % 360) }); };
    apply(event.clientX, event.clientY);
    const move = (moveEvent: PointerEvent) => apply(moveEvent.clientX, moveEvent.clientY);
    const up = () => { svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
  };
  const save = async (gradient: ThemeGradient | null) => { setSaving(true); const ok = await themeEngine.saveGradient(surface, gradient); setSaving(false); if (ok) setDirty(false); };
  const cancel = () => { themeEngine.previewGradient(surface, undefined); setDirty(false); };
  const stop = draft.stops[selected] ?? draft.stops[0];
  const builtIn = !state.active?.id.startsWith("user:");

  return (
    <div className="gradient-editor">
      <div className="gradient-editor-heading"><div><strong>Gradients</strong><span>Changes show on the app as you edit. Saving writes to your copy of the theme{builtIn ? " (this built-in theme is duplicated first)" : ""}.</span></div></div>
      <div className="gradient-editor-row">
        <label>Surface<select value={surface} onChange={(event) => { if (dirty) cancel(); setSurface(event.target.value as GradientSurface); }}>{GRADIENT_SURFACES.map((name) => <option key={name} value={name}>{SURFACE_LABELS[name]}{state.active?.gradients?.[name] ? " ●" : ""}</option>)}</select></label>
        <div className="gradient-editor-kinds" role="radiogroup" aria-label="Gradient type">{(["solid", "linear", "radial", "conic"] as Kind[]).map((kind) => <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className={draft.kind === kind ? "is-active" : ""} onClick={() => change({ kind })}>{kind[0].toUpperCase() + kind.slice(1)}</button>)}</div>
        {(draft.kind === "linear" || draft.kind === "conic") && (
          <div className="gradient-editor-angle">
            <svg viewBox="0 0 40 40" width="40" height="40" role="slider" aria-label="Angle" aria-valuemin={0} aria-valuemax={360} aria-valuenow={draft.angle} tabIndex={0} onPointerDown={dialDrag} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowUp") change({ angle: (draft.angle + 5) % 360 }); if (event.key === "ArrowLeft" || event.key === "ArrowDown") change({ angle: (draft.angle + 355) % 360 }); }}>
              <circle cx="20" cy="20" r="17" /><line x1="20" y1="20" x2={20 + 15 * Math.sin((draft.angle * Math.PI) / 180)} y2={20 - 15 * Math.cos((draft.angle * Math.PI) / 180)} />
            </svg>
            <input type="range" min={0} max={360} value={draft.angle} onChange={(event) => change({ angle: Number(event.target.value) })} aria-label="Angle in degrees" /><span>{draft.angle}°</span>
          </div>
        )}
      </div>
      <div className="gradient-editor-preview" style={{ background: css }} aria-label="Gradient preview" />
      {draft.kind !== "solid" && (
        <div className="gradient-editor-bar" ref={barRef} style={{ background: barCss }} onPointerDown={addStop} title="Click the bar to add a stop; drag a stop to move it">
          {draft.stops.map((item, index) => <button key={index} type="button" className={`gradient-editor-stop${index === selected ? " is-selected" : ""}`} style={{ left: `${item.at * 100}%`, background: item.color }} aria-label={`Stop ${index + 1} at ${Math.round(item.at * 100)}%`} onPointerDown={dragStop(index)} onClick={() => setSelected(index)} />)}
        </div>
      )}
      <div className="gradient-editor-row">
        <label>{draft.kind === "solid" ? "Color" : `Stop ${selected + 1} color`}<input type="color" value={toHex(stop.color)} onChange={(event) => setStop(draft.kind === "solid" ? 0 : selected, { color: event.target.value })} /></label>
        {draft.kind !== "solid" && <label>Position (%)<input type="number" min={0} max={100} value={Math.round(stop.at * 100)} onChange={(event) => { const value = Number(event.target.value); if (value >= 0 && value <= 100) setStop(selected, { at: value / 100 }); }} /></label>}
        {draft.kind !== "solid" && <Button type="button" variant="ghost" disabled={draft.stops.length <= 2} onClick={() => { change({ stops: draft.stops.filter((_, i) => i !== selected) }); setSelected(0); }}>Remove stop</Button>}
        {draft.kind !== "solid" && <Button type="button" variant="ghost" disabled={draft.stops.length >= 8} onClick={() => { change({ stops: [...draft.stops, { color: stop.color, at: 0.5 }] }); setSelected(draft.stops.length); }}>Add stop</Button>}
      </div>
      {warnings.length > 0 && <p className="gradient-editor-warning" role="status">Text may be hard to read: {warnings.map((warning) => `stop ${warning.stop} is ${warning.ratio}:1 against ${warning.token.replace("--skai-color-", "")}`).join("; ")}. Aim for 4.5:1 or more.</p>}
      <div className="gradient-editor-actions">
        <Button type="button" variant="primary" disabled={!dirty || saving} onClick={() => void save(toGradient(draft))}>{saving ? "Saving…" : builtIn ? "Save to my copy" : "Save"}</Button>
        <Button type="button" disabled={!dirty} onClick={cancel}>Cancel</Button>
        <Button type="button" variant="ghost" disabled={!saved || saving} onClick={() => void save(null)}>Remove gradient</Button>
      </div>
    </div>
  );
}
