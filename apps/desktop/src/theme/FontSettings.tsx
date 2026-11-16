import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ThemeFont } from "../../shared/contracts";
import { Button } from "../components/ui/Primitives";
import { FONT_ROLES, familyStack, type FontRole } from "./fontRoles";
import { effectiveFonts, isMonospace, listInstalledFonts, themeEngine, themeStore, type InstalledFont } from "./themeEngine";

// Theme: Appearance → Fonts. One row per role (UI, headings, chat text, code):
// a searchable family picker with every name drawn in its own font, size /
// weight / line height / letter spacing, and a live preview line. Choices are
// saved in appearance.json and win over the active theme's fonts.

const ROLE_LABELS: Record<FontRole, { title: string; detail: string; preview: string }> = {
  ui: { title: "Interface", detail: "Menus, buttons, sidebar. Size scales the whole interface (13 = default).", preview: "Settings · New chat · Projects · 1 2 3" },
  heading: { title: "Headings", detail: "Page and section titles. Size scales every heading (20 = default).", preview: "Build a companion" },
  reading: { title: "Chat text", detail: "Messages you read. Size is the text size in px.", preview: "The quick brown fox jumps over the lazy dog, then reads the rest of the reply." },
  code: { title: "Code", detail: "Code blocks, terminal, diffs, editor. Size scales code text (12 = default).", preview: "const answer = items.filter((x) => x.ok).length; // 0O 1lI" },
};

export function FontSettings() {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  const effective = effectiveFonts(state.active, state);
  return (
    <div className="font-settings">
      <div className="font-settings-heading">
        <div><strong>Fonts</strong><span>Your choices here override the theme's fonts. Empty fields use the theme default.</span></div>
        <Button type="button" onClick={() => void themeEngine.openFontsFolder()}>Open fonts folder</Button>
      </div>
      {state.customFonts.length > 0 && <p className="font-settings-custom">Your fonts: {state.customFonts.map((font) => <span key={font.file} className={`is-${font.status}`} title={font.file}>{font.family}{font.status === "failed" ? " (failed)" : ""}</span>)}</p>}
      {FONT_ROLES.map((role) => <FontRoleRow key={role} role={role} chosen={state.userFonts[role] ?? {}} effective={effective[role] ?? {}} customFamilies={state.customFonts.filter((font) => font.status === "ready").map((font) => font.family)} />)}
    </div>
  );
}

function FontRoleRow({ role, chosen, effective, customFamilies }: { role: FontRole; chosen: ThemeFont; effective: ThemeFont; customFamilies: string[] }) {
  const [picking, setPicking] = useState(false);
  const label = ROLE_LABELS[role];
  const family = effective.family?.[0];
  const notMonospace = role === "code" && family ? !isMonospace(family) : false;
  const save = (patch: Partial<ThemeFont>) => {
    const next: ThemeFont = { ...chosen, ...patch };
    for (const key of Object.keys(next) as (keyof ThemeFont)[]) if (next[key] === undefined) delete next[key];
    void themeEngine.setFont(role, Object.keys(next).length ? next : null);
  };
  const number = (key: "size" | "weight" | "lineHeight" | "letterSpacing", text: string, min: number, max: number) => {
    if (text.trim() === "") { save({ [key]: undefined }); return; }
    const value = Number(text);
    if (Number.isFinite(value) && value >= min && value <= max) save({ [key]: value });
  };
  const previewStyle = { fontFamily: familyStack(role, effective.family) ?? `var(--skai-font-${role})`, fontWeight: effective.weight, lineHeight: effective.lineHeight, letterSpacing: effective.letterSpacing !== undefined ? `${effective.letterSpacing}em` : undefined, fontSize: role === "reading" && effective.size ? `${effective.size}px` : undefined };
  return (
    <section className="font-role" aria-label={`${label.title} font`}>
      <div className="font-role-copy"><strong>{label.title}</strong><span>{label.detail}</span></div>
      <div className="font-role-controls">
        <button type="button" className="font-role-family" onClick={() => setPicking((open) => !open)} aria-expanded={picking} style={{ fontFamily: familyStack(role, effective.family) }}>{chosen.family?.[0] ?? (family ? `${family} (theme)` : "Theme default")}</button>
        <NumberField label="Size" value={chosen.size} placeholder={effective.size} min={8} max={32} step={1} onCommit={(text) => number("size", text, 8, 32)} />
        <label>Weight<select value={chosen.weight ?? ""} onChange={(event) => number("weight", event.target.value, 100, 900)}><option value="">Theme</option>{[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label>
        <NumberField label="Line height" value={chosen.lineHeight} placeholder={effective.lineHeight} min={1} max={2.5} step={0.05} onCommit={(text) => number("lineHeight", text, 1, 2.5)} />
        <NumberField label="Spacing (em)" value={chosen.letterSpacing} placeholder={effective.letterSpacing} min={-0.1} max={0.3} step={0.01} onCommit={(text) => number("letterSpacing", text, -0.1, 0.3)} />
        <Button type="button" variant="ghost" onClick={() => void themeEngine.setFont(role, null)} disabled={!Object.keys(chosen).length}>Reset</Button>
      </div>
      {notMonospace && <p className="font-role-warning" role="status">{family} isn't monospace, so code columns won't line up.</p>}
      {picking && <FontPicker role={role} customFamilies={customFamilies} onPick={(name) => { save({ family: name ? [name] : undefined }); setPicking(false); }} />}
      <p className="font-role-preview" style={previewStyle}>{label.preview}</p>
    </section>
  );
}

// A number input with a local draft: it commits on blur or Enter, so partial input
// ("1" on the way to "15") is never rejected mid-typing.
function NumberField({ label, value, placeholder, min, max, step, onCommit }: { label: string; value: number | undefined; placeholder: number | undefined; min: number; max: number; step: number; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => { setDraft(value === undefined ? "" : String(value)); }, [value]);
  const invalid = draft.trim() !== "" && !(Number(draft) >= min && Number(draft) <= max);
  return <label>{label}<input type="number" min={min} max={max} step={step} value={draft} placeholder={placeholder === undefined ? "–" : String(placeholder)} aria-invalid={invalid} onChange={(event) => setDraft(event.target.value)} onBlur={() => onCommit(draft)} onKeyDown={(event) => { if (event.key === "Enter") onCommit(draft); }} /></label>;
}

function FontPicker({ role, customFamilies, onPick }: { role: FontRole; customFamilies: string[]; onPick: (family: string | null) => void }) {
  const [installed, setInstalled] = useState<InstalledFont[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => { let live = true; void listInstalledFonts().then((fonts) => { if (live) setInstalled(fonts); }); return () => { live = false; }; }, []);
  const entries = useMemo(() => {
    const all = [...customFamilies.map((family) => ({ family, monospace: null as boolean | null, custom: true })), ...(installed ?? []).map((font) => ({ ...font, custom: false }))];
    const needle = query.trim().toLowerCase();
    const matches = all.filter((font) => font.family.toLowerCase().includes(needle));
    // The code role lists monospace fonts first.
    if (role === "code") for (const font of matches) if (font.monospace === null) font.monospace = isMonospace(font.family);
    return (role === "code" ? [...matches].sort((a, b) => Number(Boolean(b.monospace)) - Number(Boolean(a.monospace))) : matches).slice(0, 200);
  }, [installed, customFamilies, query, role]);
  return (
    <div className="font-picker">
      <input type="search" placeholder="Search installed fonts…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search fonts" autoFocus />
      <div className="font-picker-list" role="listbox" aria-label="Fonts">
        <button type="button" role="option" aria-selected={false} onClick={() => onPick(null)}>Theme default</button>
        {installed === null && <span className="font-picker-status">Loading installed fonts…</span>}
        {installed !== null && !entries.length && <span className="font-picker-status">No fonts match.</span>}
        {entries.map((font) => <button key={`${font.custom ? "custom" : "installed"}:${font.family}`} type="button" role="option" aria-selected={false} style={{ fontFamily: `"${font.family}", var(--skai-font-ui)` }} onClick={() => onPick(font.family)}>{font.family}{font.custom && <small>yours</small>}{role === "code" && font.monospace && <small>mono</small>}</button>)}
      </div>
    </div>
  );
}
