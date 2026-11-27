import { useState } from "react";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import "./SupportBundleManager.css";

type SupportSection = "runtime" | "storage" | "security" | "activity";
type SupportPreview = {
  generatedAtUtc: string;
  sections: Array<{ id: SupportSection; label: string; description: string; summary: string }>;
  redactions: Array<{ id: string; label: string; detail: string }>;
  privacyNote: string;
  maxCharacters: number;
};

const allSections: Array<{ id: SupportSection; label: string; detail: string }> = [
  { id: "runtime", label: "Runtime health", detail: "Version, local provider, model label, and protocol status." },
  { id: "storage", label: "Local storage", detail: "Counts and byte totals without revealing the storage path." },
  { id: "security", label: "Safety boundaries", detail: "Sandbox status, limits, and permission-event counts." },
  { id: "activity", label: "Workspace activity", detail: "Local counts for chats, tasks, projects, schedules, and memory." },
];

export function SupportBundleManager() {
  const [selected, setSelected] = useState<SupportSection[]>(allSections.map(section => section.id));
  const [preview, setPreview] = useState<SupportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "export" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = async (method: string, params: Record<string, unknown>) => {
    const response = await window.skaiAgent?.request(method, params);
    if (!response?.ok) throw new Error(response?.error?.message ?? "The local support bundle operation failed.");
    return response.result;
  };

  const toggle = (section: SupportSection) => {
    setSelected(current => current.includes(section) ? current.filter(item => item !== section) : [...current, section]);
    setPreview(null);
    setNotice("");
  };

  const previewBundle = async () => {
    if (selected.length === 0) return;
    setBusy("preview"); setError(""); setNotice("");
    try { setPreview(await request("support.bundle.preview", { sections: selected }) as SupportPreview); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Support bundle preview failed."); }
    finally { setBusy(""); }
  };

  const exportBundle = async () => {
    if (!preview || selected.length === 0) return;
    setBusy("export"); setError(""); setNotice("");
    try {
      const result = await request("support.bundle.export", { sections: selected }) as { fileName: string; content: string; bytes: number; redactions: number };
      const url = URL.createObjectURL(new Blob([result.content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = result.fileName; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(`Support bundle saved to Downloads. ${result.redactions} categories were excluded by default.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Support bundle export failed."); }
    finally { setBusy(""); }
  };

  return <section className="support-bundle-manager" aria-labelledby="support-bundle-title">
    <div className="support-bundle-heading">
      <div><p className="section-kicker">LOCAL DIAGNOSTICS</p><h3 id="support-bundle-title">Support bundle</h3><p>Prepare a small, inspectable report when something is not working. Skai summarizes local health and never includes chat text, project files, credentials, exact paths, or provider endpoints.</p></div>
      <StatusBadge tone="success">Local-only</StatusBadge>
    </div>
    <div className="support-bundle-card">
      <div className="support-bundle-card-heading"><div><h4>Choose what to include</h4><p>Preview the exact sections before anything is downloaded.</p></div></div>
      <div className="support-bundle-sections">{allSections.map(section => <label key={section.id}><input type="checkbox" checked={selected.includes(section.id)} onChange={() => toggle(section.id)} /><span><strong>{section.label}</strong><small>{section.detail}</small></span></label>)}</div>
      {preview && <div className="support-bundle-preview" aria-live="polite"><div className="support-bundle-preview-heading"><strong>Ready to review</strong><span>{new Date(preview.generatedAtUtc).toLocaleString()}</span></div>{preview.sections.map(section => <div className="support-bundle-preview-row" key={section.id}><span><strong>{section.label}</strong><small>{section.description}</small></span><em>{section.summary}</em></div>)}<p className="support-bundle-privacy">{preview.privacyNote}</p><div className="support-bundle-redactions"><strong>Always excluded</strong>{preview.redactions.map(item => <span key={item.id} title={item.detail}>{item.label}</span>)}</div></div>}
      <div className="support-bundle-actions"><Button variant="secondary" type="button" disabled={selected.length === 0 || busy !== ""} onClick={() => void previewBundle()}>{busy === "preview" ? "Preparing preview…" : "Preview bundle"}</Button><Button variant="primary" type="button" disabled={!preview || busy !== ""} onClick={() => void exportBundle()}>{busy === "export" ? "Creating bundle…" : "Download bundle"}</Button></div>
      <p className="support-bundle-help">The downloaded JSON is intended for you to inspect before sharing. Skai does not upload it, open a ticket, or contact support automatically.</p>
    </div>
    {error && <p className="support-bundle-message support-bundle-error" role="alert">{error}</p>}
    {notice && <p className="support-bundle-message support-bundle-notice" role="status">{notice}</p>}
  </section>;
}
