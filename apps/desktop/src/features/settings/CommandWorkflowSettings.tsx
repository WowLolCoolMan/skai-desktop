import { useRef, useState } from "react";
import { Button } from "../../components/ui/Primitives";
import { commandPreferencesEvent, defaultShortcuts, normalizeShortcut, readCommandPreferences, shortcutActions, writeCommandPreferences, type CommandPreferences, type SavedPrompt } from "../commands/preferences";

const makeId = () => `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function CommandWorkflowSettings() {
  const [preferences, setPreferences] = useState(readCommandPreferences);
  const [recording, setRecording] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const save = (next: CommandPreferences) => { setPreferences(next); writeCommandPreferences(next); window.dispatchEvent(new Event(commandPreferencesEvent)); };
  const recordShortcut = (actionId: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { setRecording(null); setNotice("Shortcut recording canceled."); return; }
    const nextShortcut = normalizeShortcut(event.nativeEvent);
    if (!nextShortcut) { setNotice("Use Ctrl or ⌘ plus a key. Escape cancels."); return; }
    const conflict = shortcutActions.find((action) => action.id !== actionId && preferences.shortcuts[action.id] === nextShortcut);
    if (conflict) { setNotice(`${nextShortcut} is already assigned to ${conflict.label}. Choose another shortcut.`); return; }
    save({ ...preferences, shortcuts: { ...preferences.shortcuts, [actionId]: nextShortcut } });
    setRecording(null); setNotice(`Saved ${nextShortcut}.`);
  };
  const updatePrompt = (id: string, patch: Partial<SavedPrompt>) => {
    const alias = patch.alias?.trim().toLowerCase();
    if (alias && preferences.savedPrompts.some((prompt) => prompt.id !== id && prompt.alias.toLowerCase() === alias)) { setNotice(`/${patch.alias} is already assigned to another saved prompt.`); return; }
    save({ ...preferences, savedPrompts: preferences.savedPrompts.map((prompt) => prompt.id === id ? { ...prompt, ...patch } : prompt) });
  };
  const addPrompt = () => { if (preferences.savedPrompts.length >= 40) { setNotice("You can save up to 40 prompt templates."); return; } const prompt = { id: makeId(), name: "New prompt", alias: "prompt", prompt: "" }; save({ ...preferences, savedPrompts: [...preferences.savedPrompts, prompt] }); };
  const exportCommands = () => {
    const blob = new Blob([JSON.stringify({ schema: "skai-command-workflows/v1", shortcuts: preferences.shortcuts, savedPrompts: preferences.savedPrompts }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "skai-command-workflows.json"; anchor.click(); URL.revokeObjectURL(url); setNotice("Shortcuts and prompt aliases exported. No credentials are included.");
  };
  const importCommands = async (file?: File) => {
    if (!file || file.size > 256_000) { setNotice("Choose a JSON file smaller than 256 KB."); return; }
    try {
      const data = JSON.parse(await file.text()) as { schema?: string; shortcuts?: Record<string, unknown>; savedPrompts?: unknown };
      if (data.schema !== "skai-command-workflows/v1") throw new Error("Unsupported command-workflows file.");
      const prompts = Array.isArray(data.savedPrompts) ? data.savedPrompts.filter((item): item is SavedPrompt => Boolean(item && typeof item === "object" && typeof (item as SavedPrompt).id === "string" && typeof (item as SavedPrompt).name === "string" && typeof (item as SavedPrompt).alias === "string" && typeof (item as SavedPrompt).prompt === "string")).slice(0, 40) : [];
      const aliases = new Set<string>();
      for (const prompt of prompts) { const alias = prompt.alias.trim().toLowerCase(); if (!alias || aliases.has(alias)) throw new Error(`The imported slash alias /${prompt.alias} is blank or duplicated.`); aliases.add(alias); }
      const shortcuts = { ...defaultShortcuts };
      for (const item of shortcutActions) if (typeof data.shortcuts?.[item.id] === "string" && (data.shortcuts[item.id] as string).length <= 32) shortcuts[item.id] = data.shortcuts[item.id] as string;
      const duplicate = shortcutActions.find((item) => shortcutActions.some((other) => other.id !== item.id && shortcuts[item.id] === shortcuts[other.id]));
      if (duplicate) throw new Error(`The imported shortcuts conflict at ${shortcuts[duplicate.id]}.`);
      save({ ...preferences, shortcuts, savedPrompts: prompts }); setNotice(`Imported ${prompts.length} prompt templates and shortcut assignments.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import this file."); }
    finally { if (importRef.current) importRef.current.value = ""; }
  };

  return <section className="settings-command-workflows" aria-labelledby="command-workflows-title">
    <div className="settings-section-heading"><div><p className="section-kicker">PERSONAL WORKFLOW</p><h2 id="command-workflows-title">Shortcuts and commands</h2><p>Keep frequent actions close, and make the composer fit the way you work.</p></div></div>
    <div className="settings-command-shortcuts"><div className="settings-command-subheading"><span><strong>Keyboard shortcuts</strong><small>Shortcuts use Ctrl on Windows/Linux and ⌘ on macOS. Conflicts are rejected.</small></span><Button variant="ghost" type="button" onClick={() => save({ ...preferences, shortcuts: defaultShortcuts })}>Reset</Button></div>{shortcutActions.map((action) => <div className="settings-command-shortcut" key={action.id}><span><strong>{action.label}</strong><small>{action.description}</small></span><button type="button" className={recording === action.id ? "is-recording" : ""} onClick={() => { setRecording(action.id); setNotice("Press a modifier shortcut. Escape cancels."); }} onKeyDown={(event) => recordShortcut(action.id, event)} aria-label={`Change shortcut for ${action.label}`}><kbd>{recording === action.id ? "Press shortcut…" : preferences.shortcuts[action.id]}</kbd></button></div>)}</div>
    <div className="settings-command-composer"><strong>Composer behavior</strong><div className="settings-command-fields"><label>Enter key<select value={preferences.sendBehavior} onChange={(event) => save({ ...preferences, sendBehavior: event.target.value as CommandPreferences["sendBehavior"] })}><option value="enter-sends">Enter sends · Shift+Enter adds a line</option><option value="shift-enter-sends">Enter adds a line · Shift+Enter sends</option></select></label><label>Toolbar details<select value={preferences.toolbarLayout} onChange={(event) => save({ ...preferences, toolbarLayout: event.target.value as CommandPreferences["toolbarLayout"] })}><option value="descriptive">Descriptive labels</option><option value="compact">Compact icons · labels in tooltips</option></select></label></div></div>
    <div className="settings-saved-prompts"><div className="settings-command-subheading"><span><strong>Saved prompts and slash aliases</strong><small>Type <code>/alias</code> in Chat to find and insert a reusable prompt.</small></span><Button variant="secondary" type="button" onClick={addPrompt}>Add prompt</Button></div>{preferences.savedPrompts.length === 0 ? <p className="settings-help">No saved prompts yet. Create one to use it from any chat composer.</p> : preferences.savedPrompts.map((prompt) => <article className="settings-saved-prompt" key={prompt.id}><div className="settings-command-fields"><label>Name<input value={prompt.name} maxLength={60} onChange={(event) => updatePrompt(prompt.id, { name: event.target.value })} /></label><label>Slash alias<input value={prompt.alias} maxLength={32} pattern="[A-Za-z0-9_-]+" onChange={(event) => updatePrompt(prompt.id, { alias: event.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} aria-label={`Slash alias for ${prompt.name}`} /></label></div><label>Prompt<textarea value={prompt.prompt} maxLength={8000} rows={3} onChange={(event) => updatePrompt(prompt.id, { prompt: event.target.value })} /></label><Button variant="ghost" type="button" onClick={() => save({ ...preferences, savedPrompts: preferences.savedPrompts.filter((entry) => entry.id !== prompt.id) })}>Delete prompt</Button></article>)}</div>
    <div className="settings-command-export"><Button variant="secondary" type="button" onClick={exportCommands}>Export shortcuts and aliases</Button><Button variant="secondary" type="button" onClick={() => importRef.current?.click()}>Import</Button><input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importCommands(event.target.files?.[0])} /></div>
    <p className="settings-help" role="status" aria-live="polite">{notice}</p>
  </section>;
}
