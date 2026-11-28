import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Primitives";
import { listVoicePronunciations, removeVoicePronunciation, saveVoicePronunciation, type VoicePronunciation } from "../../services/nativeTts";
import "./VoicePronunciationDictionary.css";

export function VoicePronunciationDictionary() {
  const [entries, setEntries] = useState<VoicePronunciation[]>(listVoicePronunciations);
  const [phrase, setPhrase] = useState("");
  const [pronunciation, setPronunciation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => setEntries(listVoicePronunciations());
    window.addEventListener("skai:voice-pronunciations-updated", refresh);
    return () => window.removeEventListener("skai:voice-pronunciations-updated", refresh);
  }, []);

  const save = () => {
    setError(""); setMessage("");
    try {
      saveVoicePronunciation(phrase, pronunciation);
      setEntries(listVoicePronunciations()); setPhrase(""); setPronunciation(""); setMessage("Pronunciation saved for local speech.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pronunciation could not be saved."); }
  };

  return <section className="settings-callout voice-pronunciation-dictionary" aria-labelledby="voice-pronunciation-title">
    <div><strong id="voice-pronunciation-title">Pronunciation dictionary</strong><span>Replace names, acronyms, or project terms before local speech synthesis. Entries stay on this device and can be extended to project or persona scope later.</span></div>
    <div className="settings-field voice-pronunciation-form"><label>Phrase<input value={phrase} maxLength={120} onChange={(event) => setPhrase(event.target.value)} placeholder="e.g. Qwen3" /></label><label>Speak as<input value={pronunciation} maxLength={160} onChange={(event) => setPronunciation(event.target.value)} placeholder="e.g. Gwen three" /></label><Button variant="secondary" type="button" disabled={!phrase.trim() || !pronunciation.trim()} onClick={save}>Save pronunciation</Button></div>
    {entries.length > 0 && <div className="voice-pronunciation-list" aria-label="Saved pronunciations">{entries.map((entry) => <div key={entry.id}><span><strong>{entry.phrase}</strong><small>spoken as “{entry.pronunciation}” · {entry.scope}</small></span><Button variant="ghost" type="button" onClick={() => { setEntries(removeVoicePronunciation(entry.id)); setMessage("Pronunciation removed."); }}>Remove</Button></div>)}</div>}
    {message && <span className="settings-help" role="status">{message}</span>}{error && <span className="settings-error" role="alert">{error}</span>}
  </section>;
}
