import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Primitives";
import { applyVoicePreset, listSavedVoicePresets, removeSavedVoicePreset, saveCurrentVoicePreset, type SavedVoicePreset } from "../../services/nativeTts";

export function VoicePresetManager({ onApplied }: { onApplied: () => void }) {
  const [presets, setPresets] = useState<SavedVoicePreset[]>(listSavedVoicePresets);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = () => setPresets(listSavedVoicePresets());
    window.addEventListener("skai:voice-presets-updated", refresh);
    return () => window.removeEventListener("skai:voice-presets-updated", refresh);
  }, []);

  const selected = presets.find((preset) => preset.id === selectedId) ?? presets[0];
  const save = () => {
    try {
      const preset = saveCurrentVoicePreset(name);
      setPresets(listSavedVoicePresets());
      setSelectedId(preset.id);
      setName("");
      setMessage(`Saved “${preset.name}”. A preset stores the selected runtime, voice, pacing, and expressiveness on this device.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this voice preset.");
    }
  };
  const apply = () => {
    if (!selected) return;
    applyVoicePreset(selected);
    onApplied();
    setMessage(`Applied “${selected.name}”.`);
  };
  const remove = () => {
    if (!selected) return;
    const next = removeSavedVoicePreset(selected.id);
    setPresets(next);
    setSelectedId(next[0]?.id ?? "");
    setMessage(`Removed “${selected.name}” from this device.`);
  };

  return <section className="voice-preset-manager" aria-labelledby="voice-preset-title">
    <div><p className="section-kicker">QUICK SETUPS</p><h3 id="voice-preset-title">Voice presets</h3><p className="settings-help">Save a reusable combination of runtime, speaker, pacing, and expressiveness. Presets stay on this device.</p></div>
    <div className="voice-preset-actions">
      <label>Saved presets<select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} aria-label="Saved voice presets"><option value="">Choose a preset</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <Button variant="secondary" type="button" disabled={!selected} onClick={apply}>Apply</Button>
      <Button variant="ghost" type="button" disabled={!selected} onClick={remove}>Remove</Button>
      <label>Save current setup<input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} placeholder="e.g. Calm English voice" onKeyDown={(event) => { if (event.key === "Enter") save(); }} /></label>
      <Button variant="primary" type="button" disabled={!name.trim()} onClick={save}>Save preset</Button>
    </div>
    {message && <p role="status" className="settings-help">{message}</p>}
  </section>;
}
