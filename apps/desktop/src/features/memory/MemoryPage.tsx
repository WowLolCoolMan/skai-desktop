import { useMemo, useState } from "react";
import type { CorpusDocument, MemoryEntry } from "../../app/types";
import type { DesktopProject } from "../../../shared/contracts";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";

type MemoryPageProps = {
  projects: DesktopProject[];
  entries: MemoryEntry[];
  busy: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSearch: (query: string) => void;
  onSave: (content: string, scope: string, tags: string, id?: string) => Promise<boolean>;
  onToggle: (entry: MemoryEntry) => void;
  onRemove: (entry: MemoryEntry) => Promise<boolean>;
  onExport: () => void;
  corpusDocuments: CorpusDocument[];
  corpusLoading: boolean;
  corpusError: string | null;
  onSearchCorpus: (query: string, scope: string) => void;
  onSaveCorpus: (title: string, source: string, content: string, tags: string, scope: string, id?: string) => Promise<boolean>;
  onRemoveCorpus: (document: CorpusDocument) => Promise<boolean>;
  onImportCorpus: (scope: string) => void;
};

function corpusFreshness(updatedAtUtc: string) {
  const updated = Date.parse(updatedAtUtc);
  if (!Number.isFinite(updated)) return "Update time unavailable";
  const ageDays = Math.max(0, Math.floor((Date.now() - updated) / 86_400_000));
  if (ageDays === 0) return "Updated today";
  if (ageDays === 1) return "Updated yesterday";
  if (ageDays < 8) return `Updated ${ageDays} days ago`;
  if (ageDays < 31) return `Aging · updated ${Math.floor(ageDays / 7)} weeks ago`;
  return `Stale · updated ${Math.floor(ageDays / 30)} months ago`;
}

export function MemoryPage({ projects, entries, busy, loading, error, onRetry, onSearch, onSave, onToggle, onRemove, onExport, corpusDocuments, corpusLoading, corpusError, onSearchCorpus, onSaveCorpus, onRemoveCorpus, onImportCorpus }: MemoryPageProps) {
  const [view, setView] = useState<"memory" | "documents">("memory");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState("global");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [corpusQuery, setCorpusQuery] = useState("");
  const [corpusTitle, setCorpusTitle] = useState("");
  const [corpusSource, setCorpusSource] = useState("");
  const [corpusContent, setCorpusContent] = useState("");
  const [corpusTags, setCorpusTags] = useState("");
  const [corpusScope, setCorpusScope] = useState("all");
  const scopes = useMemo(() => ["all", ...Array.from(new Set(entries.map((entry) => entry.scope))).sort()], [entries]);
  const visibleEntries = useMemo(() => scopeFilter === "all" ? entries : entries.filter((entry) => entry.scope === scopeFilter), [entries, scopeFilter]);
  const resetEditor = () => { setContent(""); setScope("global"); setTags(""); setEditingId(null); setSaveState("idle"); };
  const editEntry = (entry: MemoryEntry) => { setEditingId(entry.id); setContent(entry.content); setScope(entry.scope); setTags(entry.tags.join(", ")); setSaveState("idle"); };
  const save = async () => { if (!content.trim() || busy || loading) return; setSaveState("saving"); const saved = await onSave(content.trim(), scope.trim() || "global", tags, editingId ?? undefined); if (saved) { resetEditor(); setSaveState("saved"); } else setSaveState("idle"); };
  const removeEntry = async (entry: MemoryEntry) => { if (busy) return; if (await onRemove(entry)) setPendingRemoveId(null); };
  const saveDocument = async () => { if (!corpusTitle.trim() || !corpusSource.trim() || !corpusContent.trim() || corpusLoading) return; const scope = corpusScope === "all" ? "workspace" : corpusScope; if (await onSaveCorpus(corpusTitle.trim(), corpusSource.trim(), corpusContent.trim(), corpusTags, scope)) { setCorpusTitle(""); setCorpusSource(""); setCorpusContent(""); setCorpusTags(""); } };
  const documentScopeLabel = (scope: string) => scope === "workspace" ? "Workspace" : projects.find((project) => scope === `project:${project.id}`)?.name ?? "Archived project";

  return <div className="feature-page memory-page">
    <PageHeader eyebrow="LOCAL MEMORY" title="Review what Skai remembers" description="Only explicitly saved notes are stored. Search, edit, disable, remove, or export them at any time." actions={<><Button variant="ghost" onClick={onExport}>Export backup</Button>{view === "documents" && <Button variant="secondary" disabled={corpusLoading} onClick={() => onImportCorpus(corpusScope === "all" ? "workspace" : corpusScope)}>Import local files</Button>}</>} />
    <nav className="memory-view-tabs" aria-label="Memory views"><button type="button" className={view === "memory" ? "is-active" : ""} aria-current={view === "memory" ? "page" : undefined} onClick={() => setView("memory")}>Saved memory <span>{entries.length}</span></button><button type="button" className={view === "documents" ? "is-active" : ""} aria-current={view === "documents" ? "page" : undefined} onClick={() => setView("documents")}>Document corpus <span>{corpusDocuments.length}</span></button></nav>
    {view === "documents" ? <Card className="corpus-panel"><div className="memory-editor-heading"><div><p className="section-kicker">LOCAL DOCUMENT CORPUS</p><strong>Ground responses in documents you explicitly add</strong></div><span className="inline-status">{corpusLoading ? "Working locally…" : `${corpusDocuments.length} document${corpusDocuments.length === 1 ? "" : "s"}`}</span></div><p className="settings-help">Text search and bounded snippets are available now. No implicit file crawling or OCR is performed.</p><div className="memory-inputs"><input value={corpusTitle} onChange={(event) => setCorpusTitle(event.target.value)} placeholder="Document title" aria-label="Document title" /><input value={corpusSource} onChange={(event) => setCorpusSource(event.target.value)} placeholder="Source path or label" aria-label="Document source" /></div><textarea value={corpusContent} onChange={(event) => setCorpusContent(event.target.value)} placeholder="Paste document text or extracted content…" rows={5} aria-label="Document content" /><div className="memory-inputs"><input value={corpusTags} onChange={(event) => setCorpusTags(event.target.value)} placeholder="Tags, comma separated" aria-label="Document tags" /><Button variant="primary" disabled={corpusLoading || !corpusTitle.trim() || !corpusSource.trim() || !corpusContent.trim()} onClick={() => void saveDocument()}>Add document</Button></div><div className="memory-toolbar"><label className="memory-scope-picker"><span>Scope</span><select value={corpusScope} onChange={(event) => { setCorpusScope(event.target.value); onSearchCorpus(corpusQuery, event.target.value); }} aria-label="Filter documents by scope"><option value="all">All scopes</option><option value="workspace">Workspace</option>{projects.map((project) => <option value={`project:${project.id}`} key={project.id}>{project.name}</option>)}</select></label><input value={corpusQuery} onChange={(event) => { setCorpusQuery(event.target.value); onSearchCorpus(event.target.value, corpusScope); }} placeholder="Search document corpus…" aria-label="Search document corpus" /></div>{corpusError ? <div className="surface-error" role="alert"><strong>Document corpus unavailable</strong><p>{corpusError}</p></div> : corpusDocuments.length === 0 ? <EmptyState title="No local documents" description="Add a document above to make it available for bounded local retrieval." /> : <div className="corpus-list">{corpusDocuments.map((document) => <article className="memory-entry" key={document.id}><div><strong>{document.title}</strong><span>{documentScopeLabel(document.scope ?? "workspace")} · {document.source} · {document.tags.join(", ") || "untagged"} · {corpusFreshness(document.updatedAtUtc)}</span><small className="memory-provenance">{document.content.slice(0, 180)}{document.content.length > 180 ? "…" : ""}</small></div><Button variant="danger" disabled={corpusLoading} onClick={() => void onRemoveCorpus(document)}>Remove</Button></article>)}</div>}</Card> : <div className="memory-layout"><Card className="memory-editor"><div className="memory-editor-heading"><p className="section-kicker">{editingId ? "EDIT NOTE" : "SAVE A NOTE"}</p>{editingId && <Button variant="ghost" disabled={busy} onClick={resetEditor}>Cancel edit</Button>}</div><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="A preference or fact you explicitly want saved…" rows={4} aria-label="Memory content" /><div className="memory-inputs"><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Scope (global or project:name)" aria-label="Memory scope" /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" aria-label="Memory tags" /></div><div className="memory-editor-footer"><span className={`memory-save-status memory-save-${saveState}`} role="status">{saveState === "saving" ? "Saving locally…" : saveState === "saved" ? "Saved locally" : "Explicit notes only · local storage"}</span><Button variant="primary" disabled={busy || loading || saveState === "saving" || !content.trim()} onClick={() => void save()}>{saveState === "saving" ? "Saving…" : editingId ? "Update memory" : "Save memory"}</Button></div></Card><Card className="memory-results"><div className="memory-toolbar"><div className="memory-search"><input value={query} onChange={(event) => { setQuery(event.target.value); onSearch(event.target.value); }} placeholder="Search approved memory…" aria-label="Search approved memory" />{loading && <span className="inline-status">Loading memory…</span>}</div><div className="memory-scope-filter" role="toolbar" aria-label="Filter memory by scope">{scopes.map((scopeName) => <Button key={scopeName} variant={scopeFilter === scopeName ? "secondary" : "ghost"} aria-pressed={scopeFilter === scopeName} onClick={() => setScopeFilter(scopeName)}>{scopeName === "all" ? "All scopes" : scopeName}</Button>)}</div></div>{error ? <div className="surface-error" role="alert"><strong>Memory is unavailable</strong><p>{error}</p><Button variant="secondary" onClick={onRetry}>Retry</Button></div> : loading ? <div className="memory-skeleton" role="status" aria-label="Loading memory"><span /><span /><span /></div> : entries.length === 0 ? <EmptyState title="No approved memory" description="Saved notes will appear here with their scope and privacy controls." /> : visibleEntries.length === 0 ? <EmptyState title="No notes in this scope" description="Choose another scope or return to All scopes." action={<Button variant="secondary" onClick={() => setScopeFilter("all")}>Show all scopes</Button>} /> : visibleEntries.map((entry) => <article className={`memory-entry ${editingId === entry.id ? "is-editing" : ""}`} key={entry.id}><div><strong>{entry.content}</strong><span>{entry.scope} · {entry.tags.join(", ") || "untagged"} · updated {new Date(entry.updatedAtUtc).toLocaleDateString()}</span><small className="memory-provenance">{entry.source || "local"} · {entry.enabled ? "Enabled for context" : "Disabled"}</small></div>{pendingRemoveId === entry.id ? <div className="memory-remove-confirm"><span>Remove this note?</span><Button variant="danger" disabled={busy} onClick={() => void removeEntry(entry)}>Confirm</Button><Button variant="ghost" disabled={busy} onClick={() => setPendingRemoveId(null)}>Keep</Button></div> : <div className="memory-entry-actions"><StatusBadge tone={entry.enabled ? "success" : "neutral"}>{entry.enabled ? "Enabled" : "Disabled"}</StatusBadge><Button variant="ghost" disabled={busy} onClick={() => editEntry(entry)}>Edit</Button><Button variant="ghost" disabled={busy} onClick={() => onToggle(entry)}>{entry.enabled ? "Disable" : "Enable"}</Button><Button variant="danger" disabled={busy} onClick={() => setPendingRemoveId(entry.id)}>Remove</Button></div>}</article>)}</Card></div>}
  </div>;
}
