import { useEffect, useState } from "react";
import { pruneImageHistoryBefore } from "../catalog/imageHistory";

type RetentionSettings = { chatRetentionDays: number; taskRetentionDays: number; taskLogRetentionDays: number };
type RetentionKey = "chatRetentionDays" | "taskRetentionDays" | "taskLogRetentionDays";
const choices = [0, 7, 30, 90, 365];
const labelFor = (days: number) => days === 0 ? "Never automatically delete" : `${days} days`;

export function WorkspaceRetentionControls({ onMediaChange }: { onMediaChange: () => void }) {
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [mediaDays, setMediaDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.skaiAgent?.request("settings.get").then((response) => {
      if (!active || !response?.ok) return;
      const result = response.result as Partial<RetentionSettings>;
      setSettings({ chatRetentionDays: choices.includes(result.chatRetentionDays ?? 0) ? result.chatRetentionDays ?? 0 : 0, taskRetentionDays: choices.includes(result.taskRetentionDays ?? 0) ? result.taskRetentionDays ?? 0 : 0, taskLogRetentionDays: choices.includes(result.taskLogRetentionDays ?? 0) ? result.taskLogRetentionDays ?? 0 : 0 });
    }).catch(() => undefined);
    const stored = Number(window.localStorage.getItem("skai.mediaRetentionDays") ?? 0);
    setMediaDays(choices.includes(stored) ? stored : 0);
    return () => { active = false; };
  }, []);

  const saveRetention = async (key: RetentionKey, days: number) => {
    if (!settings || busy) return;
    const previous = settings[key];
    const next = { ...settings, [key]: days };
    setSettings(next); setBusy(true); setError(""); setMessage("");
    try {
      const response = await window.skaiAgent?.request("settings.save", { chatRetentionDays: next.chatRetentionDays, taskRetentionDays: next.taskRetentionDays, taskLogRetentionDays: next.taskLogRetentionDays });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The retention setting could not be saved.");
      setMessage("Retention rule saved. Cleanup runs locally in the background.");
    } catch (cause) {
      setSettings((current) => current ? { ...current, [key]: previous } : current);
      setError(cause instanceof Error ? cause.message : "The retention setting could not be saved.");
    } finally { setBusy(false); }
  };

  const saveMediaRetention = async (days: number) => {
    if (busy) return;
    const previous = mediaDays;
    setMediaDays(days); setBusy(true); setError(""); setMessage("");
    try {
      window.localStorage.setItem("skai.mediaRetentionDays", String(days));
      if (days > 0) await pruneImageHistoryBefore(new Date(Date.now() - days * 24 * 60 * 60 * 1_000));
      await onMediaChange();
      setMessage("Media retention rule saved and applied to Skai’s local preview history.");
    } catch (cause) {
      setMediaDays(previous);
      setError(cause instanceof Error ? cause.message : "The media retention setting could not be saved.");
    } finally { setBusy(false); }
  };

  const rows: Array<{ key: RetentionKey; label: string; detail: string }> = [
    { key: "chatRetentionDays", label: "Unpinned chats", detail: "Persona conversations and pinned chats are always excluded." },
    { key: "taskRetentionDays", label: "Finished task records", detail: "Only terminal tasks without retained worktrees or live dependents are removed." },
    { key: "taskLogRetentionDays", label: "Finished task logs", detail: "Only completed, failed, and cancelled operation records are removed." },
  ];

  return <section className="workspace-backup-card workspace-retention-card" aria-labelledby="workspace-retention-title">
    <div className="workspace-backup-card-heading"><div><h4 id="workspace-retention-title">Automatic retention</h4><p>Choose how long Skai keeps inactive local history. Changes are local and can be turned off at any time.</p></div></div>
    {!settings ? <p className="workspace-backup-help">Loading retention settings…</p> : <div className="workspace-retention-rows">{rows.map((row) => <label key={row.key}><span><strong>{row.label}</strong><small>{row.detail}</small></span><select aria-label={`${row.label} retention`} disabled={busy} value={settings[row.key]} onChange={(event) => void saveRetention(row.key, Number(event.target.value))}>{choices.map((days) => <option key={days} value={days}>{labelFor(days)}</option>)}</select></label>)}</div>}
    <div className="workspace-retention-rows"><label><span><strong>Generated media previews</strong><small>Deletes expired previews from Skai’s local history index. Downloaded files stay where you saved them.</small></span><select aria-label="Generated media preview retention" disabled={busy} value={mediaDays} onChange={(event) => void saveMediaRetention(Number(event.target.value))}>{choices.map((days) => <option key={days} value={days}>{labelFor(days)}</option>)}</select></label></div>
    <p className="workspace-backup-help">Runtime and browser caches are owned by their providers and are not cleared by Skai. Use each runtime’s own cache controls.</p>
    {message && <p className="workspace-backup-message workspace-backup-notice" role="status">{message}</p>}{error && <p className="workspace-backup-message workspace-backup-error" role="alert">{error}</p>}
  </section>;
}
