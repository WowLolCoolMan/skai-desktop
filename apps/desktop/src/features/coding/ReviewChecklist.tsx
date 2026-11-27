import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "../../components/ui/Primitives";

type ReviewState = "unresolved" | "accepted" | "deferred";
type ReviewFinding = { id: string; title: string; detail: string; state: ReviewState };

function storageKey(projectId: string, branch: string) {
  return `skai.coding.reviewChecklist.v1.${encodeURIComponent(projectId)}.${encodeURIComponent(branch || "unknown")}`;
}

function loadFindings(key: string): ReviewFinding[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ReviewFinding => Boolean(item && typeof item === "object"
      && typeof item.id === "string" && typeof item.title === "string" && typeof item.detail === "string"
      && ["unresolved", "accepted", "deferred"].includes(item.state)));
  } catch { return []; }
}

export function ReviewChecklist({ projectId, branch }: { projectId: string; branch: string }) {
  const key = useMemo(() => storageKey(projectId, branch), [projectId, branch]);
  const [findings, setFindings] = useState<ReviewFinding[]>(() => loadFindings(key));
  const [loadedKey, setLoadedKey] = useState(key);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => { setFindings(loadFindings(key)); setLoadedKey(key); }, [key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(findings)); } catch { /* Keep checklist usable if storage is unavailable. */ }
  }, [findings, key, loadedKey]);

  const addFinding = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setFindings((current) => [...current, { id: crypto.randomUUID(), title: trimmedTitle, detail: detail.trim(), state: "unresolved" }]);
    setTitle("");
    setDetail("");
  };
  const counts = findings.reduce((summary, item) => ({ ...summary, [item.state]: summary[item.state] + 1 }), { unresolved: 0, accepted: 0, deferred: 0 });

  const scopeLabel = branch && branch !== "unknown" ? branch : "No branch";

  return <Card className="coding-review-checklist" aria-label="Review checklist">
    <div className="coding-review-checklist-heading"><div><p className="section-kicker">REVIEW NOTES</p><h3>Review checklist</h3><span>{counts.accepted} accepted · {counts.unresolved} unresolved · {counts.deferred} deferred</span></div><small title={`${projectId} · ${branch && branch !== "unknown" ? branch : "branch unavailable; notes are scoped to the workspace"}`}>{scopeLabel}</small></div>
    {findings.length > 0 ? <ul className="coding-review-findings">{findings.map((finding) => <li key={finding.id}>
      <div><strong>{finding.title}</strong>{finding.detail && <p>{finding.detail}</p>}</div>
      <label><span className="sr-only">Status for {finding.title}</span><select value={finding.state} onChange={(event) => setFindings((current) => current.map((item) => item.id === finding.id ? { ...item, state: event.target.value as ReviewState } : item))}><option value="unresolved">Unresolved</option><option value="accepted">Accepted</option><option value="deferred">Deferred</option></select></label>
      <Button variant="ghost" onClick={() => setFindings((current) => current.filter((item) => item.id !== finding.id))} aria-label={`Remove review note: ${finding.title}`}>Remove</Button>
    </li>)}</ul> : <p className="coding-change-empty">No review notes yet. Add an issue or decision to keep it visible while reviewing this branch.</p>}
    <form className="coding-review-finding-form" onSubmit={(event) => { event.preventDefault(); addFinding(); }}>
      <label>Finding<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="What needs attention?" /></label>
      <label>Notes<textarea value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={2000} rows={2} placeholder="Optional context or follow-up" /></label>
      <Button variant="secondary" type="submit" disabled={!title.trim()}>Add review note</Button>
    </form>
  </Card>;
}
