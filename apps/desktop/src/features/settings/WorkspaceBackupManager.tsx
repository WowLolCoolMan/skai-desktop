import { useCallback, useEffect, useState } from "react";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import { clearImageHistory, loadImageHistory } from "../catalog/imageHistory";
import "./WorkspaceBackupManager.css";

type BackupCategory = "conversations" | "settings" | "personas" | "projects";
type ExportPreview = { categories: Array<{ id: BackupCategory; label: string; count: number; description: string }>; redaction: string; privacyNote: string; maxArchiveBytes: number };
type RestorePreview = { integrity: string; encrypted: boolean; createdAtUtc: string; archiveDigest: string; stateFingerprint: string; portability: string; excluded: string[]; categories: Array<{ id: BackupCategory; label: string; incoming: number; existing: number; collisions: number; description: string }> };
type StorageOverview = { localRoot: string; totalBytes: number; rows: Array<{ label: string; bytes: number; exists: boolean }>; privacy: Array<{ integration: string; data: string; route: string }>; retention: string; cleanup: string };

const allCategories: BackupCategory[] = ["conversations", "settings", "personas", "projects"];
const formatBytes = (bytes: number) => bytes <= 0 ? "0 B" : bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1_000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function WorkspaceBackupManager() {
  const [selected, setSelected] = useState<BackupCategory[]>(allCategories);
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [fileName, setFileName] = useState("");
  const [archive, setArchive] = useState("");
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreCategories, setRestoreCategories] = useState<BackupCategory[]>([]);
  const [policies, setPolicies] = useState<Partial<Record<BackupCategory, "keep" | "replace">>>({});
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [mediaHistoryBytes, setMediaHistoryBytes] = useState(0);
  const [mediaHistoryCount, setMediaHistoryCount] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);

  const request = useCallback(async (method: string, params: Record<string, unknown> = {}) => {
    const response = await window.skaiAgent?.request(method, params);
    if (!response?.ok) throw new Error(response?.error?.message ?? "The local storage operation failed.");
    return response.result;
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      const [overview, media] = await Promise.all([request("workspace.storage.overview"), loadImageHistory()]);
      setStorage(overview as StorageOverview);
      setMediaHistoryCount(media.length);
      setMediaHistoryBytes(media.reduce((total, item) => total + Math.floor(item.url.length * 0.75), 0));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Storage usage could not be loaded."); }
  }, [request]);

  const clearMediaHistory = async () => {
    if (!mediaHistoryCount || !window.confirm(`Remove ${mediaHistoryCount} saved generated media preview(s) from this device? This does not remove originals from other folders or services.`)) return;
    setBusy("clear-media"); setError(""); setNotice("");
    try { await clearImageHistory(); setMediaHistoryCount(0); setMediaHistoryBytes(0); setNotice("Generated media history was cleared from this device."); await refreshStorage(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Generated media history could not be cleared."); }
    finally { setBusy(""); }
  };

  useEffect(() => { void refreshStorage(); }, [refreshStorage]);

  const toggleCategory = (category: BackupCategory) => {
    setSelected(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category]);
    setExportPreview(null);
  };

  const previewExport = async () => {
    setBusy("preview-export"); setError(""); setNotice("");
    try { setExportPreview(await request("workspace.backup.preview", { categories: selected }) as ExportPreview); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Backup preview failed."); }
    finally { setBusy(""); }
  };

  const exportBackup = async () => {
    if (!exportPreview || exportPassphrase.length > 0 && exportPassphrase.length < 10) return;
    setBusy("export"); setError(""); setNotice("");
    try {
      const result = await request("workspace.backup.export", { categories: selected, passphrase: exportPassphrase || null }) as { fileName: string; content: string; encrypted: boolean; redactions: number };
      const url = URL.createObjectURL(new Blob([result.content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = result.fileName; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(`Backup saved to your Downloads. ${result.encrypted ? "It is encrypted with your passphrase." : "It is unencrypted; store it somewhere private."} ${result.redactions} secret-like value(s) redacted.`);
      setExportPassphrase("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace backup export failed."); }
    finally { setBusy(""); }
  };

  const chooseFile = async (file?: File) => {
    setArchive(""); setFileName(file?.name ?? ""); setRestorePreview(null); setRestoreCategories([]); setError(""); setNotice("");
    if (!file) return;
    try {
      if (file.size > 16_000_000) throw new Error("Choose a backup smaller than 16 MB.");
      const text = await file.text();
      setArchive(text);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The backup file could not be read."); }
  };

  const previewRestore = async () => {
    if (!archive) return;
    setBusy("preview-restore"); setError(""); setNotice("");
    try {
      const preview = await request("workspace.backup.restore.preview", { content: archive, passphrase: restorePassphrase || null, fileName }) as RestorePreview;
      setRestorePreview(preview);
      setRestoreCategories(preview.categories.map(category => category.id));
      setPolicies(Object.fromEntries(preview.categories.map(category => [category.id, "keep"])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Restore preview failed."); }
    finally { setBusy(""); }
  };

  const applyRestore = async () => {
    if (!restorePreview || restoreCategories.length === 0) return;
    setBusy("restore"); setError(""); setNotice("");
    try {
      const result = await request("workspace.backup.restore.apply", {
        content: archive,
        passphrase: restorePassphrase || null,
        categories: restoreCategories,
        policies,
        archiveDigest: restorePreview.archiveDigest,
        stateFingerprint: restorePreview.stateFingerprint,
      }) as { imported: Record<string, number>; skipped: Record<string, number> };
      setNotice(`Restore complete. ${restoreCategories.map(category => `${category}: ${result.imported[category] ?? 0} restored, ${result.skipped[category] ?? 0} kept`).join(" · ")}.`);
      setReloadRequired(restoreCategories.includes("settings") && (result.imported.settings ?? 0) > 0);
      await refreshStorage();
      setArchive(""); setFileName(""); setRestorePreview(null); setRestoreCategories([]);
      setRestorePassphrase("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace restore failed."); }
    finally { setBusy(""); }
  };

  return <section className="workspace-backup-manager" aria-label="Workspace backup and data ownership">
    <div className="workspace-backup-heading"><div><p className="section-kicker">PORTABLE WORKSPACE</p><h3>Backup and restore</h3><p>Choose exactly what to carry to another Skai installation. Credentials and machine-specific folder paths stay on this device.</p></div><StatusBadge tone="neutral">Local-first</StatusBadge></div>
    <div className="workspace-backup-card">
      <div className="workspace-backup-card-heading"><div><h4>Create a backup</h4><p>Preview each category before exporting. Encryption is optional and uses a passphrase you control.</p></div></div>
      <div className="workspace-backup-categories">{allCategories.map(category => <label key={category}><input type="checkbox" checked={selected.includes(category)} onChange={() => toggleCategory(category)} /><span>{category === "conversations" ? "Chats" : category === "projects" ? "Project metadata" : category[0].toUpperCase() + category.slice(1)}</span></label>)}</div>
      {exportPreview && <div className="workspace-backup-preview"><strong>Export includes</strong>{exportPreview.categories.map(category => <div key={category.id}><span>{category.label}</span><span>{category.count.toLocaleString()} {category.id === "settings" ? "preference set" : "items"}</span><small>{category.description}</small></div>)}<p>{exportPreview.redaction}</p><p>{exportPreview.privacyNote}</p></div>}
      <label className="workspace-backup-field">Encrypt with a passphrase <input type="password" autoComplete="new-password" value={exportPassphrase} onChange={event => setExportPassphrase(event.target.value)} placeholder="Leave blank for an unencrypted backup" /></label>
      {exportPassphrase.length > 0 && exportPassphrase.length < 10 && <small className="workspace-backup-help">Use at least 10 characters. Skai cannot recover a lost passphrase.</small>}
      <div className="workspace-backup-actions"><Button variant="secondary" type="button" disabled={selected.length === 0 || busy !== ""} onClick={() => void previewExport()}>{busy === "preview-export" ? "Preparing preview…" : "Preview export"}</Button><Button variant="primary" type="button" disabled={!exportPreview || busy !== "" || exportPassphrase.length > 0 && exportPassphrase.length < 10} onClick={() => void exportBackup()}>{busy === "export" ? "Creating backup…" : "Export backup"}</Button></div>
    </div>
    <div className="workspace-backup-card">
      <div className="workspace-backup-card-heading"><div><h4>Restore a backup</h4><p>Skai checks the archive and previews incoming records and ID conflicts before it writes anything.</p></div></div>
      <label className="workspace-backup-field">Backup file <input type="file" accept=".skai-backup,.json,application/json" onChange={event => void chooseFile(event.target.files?.[0])} /></label>
      {fileName && <p className="workspace-backup-help">Selected: {fileName}</p>}
      <label className="workspace-backup-field">Passphrase <input type="password" autoComplete="current-password" value={restorePassphrase} onChange={event => { setRestorePassphrase(event.target.value); setRestorePreview(null); }} placeholder="Only needed for encrypted backups" /></label>
      {restorePreview && <div className="workspace-backup-preview"><strong>Integrity verified · {restorePreview.encrypted ? "Encrypted" : "Unencrypted"} · {new Date(restorePreview.createdAtUtc).toLocaleString()}</strong>{restorePreview.categories.map(category => <div className="workspace-restore-category" key={category.id}><label><input type="checkbox" checked={restoreCategories.includes(category.id)} onChange={() => setRestoreCategories(current => current.includes(category.id) ? current.filter(item => item !== category.id) : [...current, category.id])} /><span>{category.label}</span></label><span>{category.incoming} incoming · {category.collisions} matching IDs</span>{category.collisions > 0 && <select aria-label={`Conflict handling for ${category.label}`} value={policies[category.id] ?? "keep"} onChange={event => setPolicies(current => ({ ...current, [category.id]: event.target.value as "keep" | "replace" }))}><option value="keep">Keep current items</option><option value="replace">Replace matching items</option></select>}<small>{category.description}</small></div>)}<p>{restorePreview.portability}</p><p>Excluded from this archive: {restorePreview.excluded.join(", ")}.</p></div>}
      <div className="workspace-backup-actions"><Button variant="secondary" type="button" disabled={!archive || busy !== ""} onClick={() => void previewRestore()}>{busy === "preview-restore" ? "Checking backup…" : "Preview restore"}</Button><Button variant="primary" type="button" disabled={!restorePreview || restoreCategories.length === 0 || busy !== ""} onClick={() => void applyRestore()}>{busy === "restore" ? "Restoring…" : "Restore selected"}</Button></div>
      {reloadRequired && <Button variant="ghost" type="button" onClick={() => window.location.reload()}>Reload Skai to apply restored settings</Button>}
    </div>
    {error && <p className="workspace-backup-message workspace-backup-error" role="alert">{error}</p>}{notice && <p className="workspace-backup-message workspace-backup-notice" role="status">{notice}</p>}
    <div className="workspace-backup-card workspace-storage-card">
      <div className="workspace-backup-card-heading"><div><p className="section-kicker">LOCAL STORAGE</p><h4>Where Skai keeps data</h4><p>{storage?.localRoot ?? "Reading local app storage…"}</p></div><Button variant="secondary" type="button" disabled={busy !== ""} onClick={() => void refreshStorage()}>Refresh</Button></div>
      {storage && <><div className="workspace-storage-total"><strong>{formatBytes(storage.totalBytes + mediaHistoryBytes)}</strong><span>reported app-owned data · media estimate included</span></div><div className="workspace-storage-rows">{[...storage.rows, { label: "Generated media history (browser)", bytes: mediaHistoryBytes, exists: mediaHistoryCount > 0 }].map(row => <div key={row.label}><span>{row.label}</span><span>{formatBytes(row.bytes)}</span></div>)}</div><div className="workspace-backup-actions"><Button variant="secondary" type="button" disabled={!mediaHistoryCount || busy !== ""} onClick={() => void clearMediaHistory()}>{busy === "clear-media" ? "Clearing…" : `Clear generated media history (${mediaHistoryCount})`}</Button></div><p className="workspace-backup-help">Media size is estimated from the saved browser-history previews. Clearing this index removes previews stored by Skai, not files you downloaded.</p><p className="workspace-backup-help">{storage.retention}</p><p className="workspace-backup-help">{storage.cleanup}</p><div className="workspace-data-flows"><h5>What leaves this device</h5>{storage.privacy.map(item => <div key={item.integration}><strong>{item.integration}</strong><span>{item.data}. {item.route}</span></div>)}</div></>}
    </div>
  </section>;
}
