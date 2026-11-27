import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "../../components/ui/Primitives";
import type { DesktopGitChange, DesktopProjectCheck } from "../../../shared/contracts";
import { gitChangeLabel, parseGitReviewDiff, type ReviewDiffFile } from "./gitReview";

type ReviewNoteStatus = "open" | "resolved" | "deferred";
type ReviewNoteHistoryEntry = { status: ReviewNoteStatus; at: string };
type ReviewNote = { id: string; path: string; line: number; side: "added" | "removed"; snippet: string; hunk: string; text: string; createdAt: string; status: ReviewNoteStatus; history: ReviewNoteHistoryEntry[] };
type ReviewPreferences = { showGenerated: boolean; expandLarge: boolean; highlightWhitespace: boolean };
const reviewPreferencesKey = "skai.coding.gitReviewPreferences.v1";
const defaultReviewPreferences: ReviewPreferences = { showGenerated: true, expandLarge: false, highlightWhitespace: true };
const reviewNotesKey = (projectId: string) => `skai.coding.reviewComments.v1.${encodeURIComponent(projectId)}`;
function readReviewPreferences(): ReviewPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(reviewPreferencesKey) ?? "null");
    if (!value || typeof value !== "object") return defaultReviewPreferences;
    return { showGenerated: (value as ReviewPreferences).showGenerated !== false, expandLarge: (value as ReviewPreferences).expandLarge === true, highlightWhitespace: (value as ReviewPreferences).highlightWhitespace !== false };
  } catch { return defaultReviewPreferences; }
}
function isGeneratedReviewFile(path: string) { return /(^|\/)(node_modules|dist|build|coverage|generated)(\/|$)/i.test(path) || /\.(min\.(?:js|css)|g\.cs|designer\.cs|lock)$/i.test(path); }
function readNotes(key: string): ReviewNote[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is ReviewNote => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.path === "string" && Number.isInteger(item.line) && ["added", "removed"].includes(item.side) && typeof item.snippet === "string" && typeof item.hunk === "string" && typeof item.text === "string" && typeof item.createdAt === "string")).map((item) => ({ ...item, status: item.status === "resolved" || item.status === "deferred" ? item.status : "open", history: Array.isArray(item.history) ? item.history.filter((entry): entry is ReviewNoteHistoryEntry => Boolean(entry && typeof entry === "object" && ["open", "resolved", "deferred"].includes(entry.status) && typeof entry.at === "string")) : [{ status: "open", at: item.createdAt }] }));
  } catch { return []; }
}

export function GitDiffReview({ projectId, diff, changes, selectedPaths, onTogglePath, selectedHunks, onSelectedHunksChange, onSendReview, projectChecks, onOpenFile }: {
  projectId: string;
  diff: string;
  changes: DesktopGitChange[];
  selectedPaths: string[];
  onTogglePath: (path: string, included: boolean) => void;
  selectedHunks: Record<string, number[]>;
  onSelectedHunksChange: (value: Record<string, number[]>) => void;
  onSendReview: (prompt: string) => void;
  projectChecks?: DesktopProjectCheck[];
  onOpenFile?: (path: string) => void;
}) {
  const noteKey = useMemo(() => reviewNotesKey(projectId), [projectId]);
  const [notes, setNotes] = useState<ReviewNote[]>(() => readNotes(noteKey));
  const [loadedKey, setLoadedKey] = useState(noteKey);
  const [draft, setDraft] = useState<{ path: string; line: number; side: "added" | "removed"; snippet: string; hunk: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [preferences, setPreferences] = useState<ReviewPreferences>(readReviewPreferences);
  const files = useMemo(() => parseGitReviewDiff(diff), [diff]);
  const changesByPath = useMemo(() => new Map(changes.map((change) => [change.path, change])), [changes]);

  useEffect(() => { setNotes(readNotes(noteKey)); setLoadedKey(noteKey); setDraft(null); }, [noteKey]);
  useEffect(() => {
    if (loadedKey !== noteKey) return;
    try { localStorage.setItem(noteKey, JSON.stringify(notes.slice(-200))); } catch { /* Keep review usable when local storage is unavailable. */ }
  }, [loadedKey, noteKey, notes]);
  useEffect(() => { try { localStorage.setItem(reviewPreferencesKey, JSON.stringify(preferences)); } catch { /* Review settings remain available for this session. */ } }, [preferences]);

  const saveNote = () => {
    const text = commentText.trim();
    if (!draft || !text || text.length > 2_000) return;
    const createdAt = new Date().toISOString();
    setNotes((current) => [...current, { ...draft, id: crypto.randomUUID(), text, createdAt, status: "open", history: [{ status: "open", at: createdAt }] }]);
    setDraft(null);
    setCommentText("");
  };
  const isHunkSelected = (file: ReviewDiffFile, hunkId: number) => selectedHunks[file.path] ? selectedHunks[file.path].includes(hunkId) : true;
  const toggleHunk = (file: ReviewDiffFile, hunkId: number, included: boolean) => {
    const current = selectedHunks[file.path] ?? file.hunks.map((hunk) => hunk.id);
    const next = included ? [...new Set([...current, hunkId])] : current.filter((id) => id !== hunkId);
    onSelectedHunksChange({ ...selectedHunks, [file.path]: next });
    onTogglePath(file.path, next.length > 0);
  };
  const noteAnchorExists = (note: ReviewNote) => files.some((file) => file.path === note.path && file.hunks.some((hunk) => hunk.header === note.hunk && hunk.lines.some((line) => line.kind === note.side && (line.newLine ?? line.oldLine) === note.line && line.text === note.snippet)));
  const hiddenGeneratedCount = files.filter((file) => isGeneratedReviewFile(file.path) && !preferences.showGenerated).length;
  const activeNotes = notes.filter((note) => note.status === "open");
  const coverageFor = (path: string) => {
    if (!projectChecks?.length) return [];
    const extension = path.toLowerCase().split(".").pop() ?? "";
    const keywords = extension === "ts" || extension === "tsx" || extension === "js" || extension === "jsx" ? ["test", "lint", "type", "check"] : extension === "cs" ? ["dotnet", "test", "build", "format"] : extension === "py" ? ["pytest", "ruff", "python", "test"] : [];
    const matches = projectChecks.filter((check) => keywords.some((keyword) => `${check.label} ${check.command}`.toLowerCase().includes(keyword)));
    return matches.length ? matches : projectChecks.slice(0, 3);
  };
  const reviewerPrompt = () => {
    const selected = files.filter((file) => selectedPaths.includes(file.path));
    const fileSummary = selected.map((file) => `- ${file.path} (${file.kind}, ${file.hunks.length} hunk${file.hunks.length === 1 ? "" : "s"})`).join("\n");
    const findings = activeNotes.length ? `\nExisting findings:\n${activeNotes.map((note) => `- ${note.path}:${note.line} (${note.side}): ${note.text}`).join("\n")}` : "";
    return `Act as the project reviewer. Review only these selected local changes:\n${fileSummary || "(selected diff files)"}\n\nReturn actionable findings anchored to file paths and changed lines. Classify each as blocking, suggestion, or informational. Include the check or evidence that supports it, and do not claim to have run checks that are not recorded.${findings}`;
  };

  if (files.length === 0) return <pre className="git-diff-preview" tabIndex={0} aria-label="Local Git diff preview">{diff}</pre>;
  return <div className="git-review-workbench" aria-label="Review changes by file and hunk">
    <div className="git-review-workbench-heading"><div><strong>Diff review</strong><span>Include whole files or choose individual hunks. Notes stay local to this project and retain their status across revisions.</span></div><div className="git-review-toolbar-options"><label><input type="checkbox" checked={preferences.showGenerated} onChange={(event) => setPreferences((current) => ({ ...current, showGenerated: event.target.checked }))} /> Show generated files</label><label><input type="checkbox" checked={preferences.expandLarge} onChange={(event) => setPreferences((current) => ({ ...current, expandLarge: event.target.checked }))} /> Expand large diffs</label><label><input type="checkbox" checked={preferences.highlightWhitespace} onChange={(event) => setPreferences((current) => ({ ...current, highlightWhitespace: event.target.checked }))} /> Mark whitespace-only edits</label><Button variant="secondary" type="button" onClick={() => onSendReview(reviewerPrompt())}>Ask reviewer agent</Button><Button variant="ghost" type="button" disabled={!activeNotes.length} onClick={() => onSendReview(`Review the selected project changes using these open line-anchored findings. Address each finding by file and line, and report which findings are fixed, unresolved, or intentionally deferred.\n\n${activeNotes.map((note) => `- ${note.path}:${note.line} (${note.side}${noteAnchorExists(note) ? " · anchor current" : " · anchor may have moved"}): ${note.text}`).join("\n")}`)}>Send {activeNotes.length} open note{activeNotes.length === 1 ? "" : "s"} to chat</Button></div></div>
    {projectChecks && projectChecks.length > 0 && <section className="git-review-check-coverage" aria-label="Review check coverage"><strong>Checks that can cover this review</strong><span>{projectChecks.length} detected project check{projectChecks.length === 1 ? "" : "s"}; mappings are advisory until a check is run.</span><div>{files.filter((file) => selectedPaths.includes(file.path)).slice(0, 12).map((file) => <article key={file.path}><code>{file.path}</code><small>{coverageFor(file.path).map((check) => check.label).join(" · ") || "No matching check detected"}</small></article>)}</div></section>}
    {hiddenGeneratedCount > 0 && <p className="git-review-stale-note">{hiddenGeneratedCount} generated file{hiddenGeneratedCount === 1 ? " is" : "s are"} hidden by your review preference.</p>}
    <div className="git-review-file-list">{files.filter((file) => preferences.showGenerated || !isGeneratedReviewFile(file.path)).map((file, fileIndex) => {
      const change = changesByPath.get(file.path) ?? changes.find((item) => item.originalPath === file.oldPath);
      const wholeFileSelected = selectedPaths.includes(file.path);
      const diffCharacters = file.hunks.reduce((total, hunk) => total + hunk.header.length + hunk.lines.reduce((subtotal, line) => subtotal + line.text.length, 0), 0);
      const isLarge = diffCharacters >= 24_000;
      const mediaOrDocument = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|pptx?|html?|md|markdown)$/i.test(file.path);
      return <Card className="git-review-file" key={`${file.path}-${fileIndex}`}>
        <div className="git-review-file-heading"><label><input type="checkbox" checked={wholeFileSelected} onChange={(event) => onTogglePath(file.path, event.target.checked)} /><span><strong>{gitChangeLabel(change?.status ?? "M", file.kind)}</strong><b>{file.path}</b>{file.kind === "renamed" && <small>from {file.oldPath}</small>}</span></label><small>{file.hunks.length ? `${file.hunks.length} hunk${file.hunks.length === 1 ? "" : "s"}` : file.kind === "binary" ? "Binary change · whole file only" : "No text hunks"}</small></div>
        {(mediaOrDocument || file.kind === "binary" || file.kind === "renamed") && <div className="git-review-before-after" aria-label={`Before and working copy review for ${file.path}`}><div><span>Before</span><strong>{file.kind === "added" ? "No repository version" : "Git baseline"}</strong><small>{file.kind === "binary" ? "Binary content is kept out of the text diff." : file.kind === "renamed" ? `Renamed from ${file.oldPath}` : "Open the file to compare the baseline."}</small></div><div><span>Working copy</span><strong>{file.kind === "deleted" ? "Removed" : "Current file"}</strong><small>{onOpenFile ? "Open the file editor or preview for a side-by-side check." : "Select the file in the project explorer."}</small>{onOpenFile && file.kind !== "deleted" && <Button variant="ghost" type="button" onClick={() => onOpenFile(file.path)}>Open working copy</Button>}</div></div>}
        {isLarge && !preferences.expandLarge ? <details className="git-review-large-diff"><summary>Large diff · expand to inspect {Math.ceil(diffCharacters / 1_000)} KB of text</summary><div>{file.hunks.map((hunk) => renderHunk(file, hunk, fileIndex))}</div></details> : file.hunks.map((hunk) => renderHunk(file, hunk, fileIndex))}
      </Card>;
    })}</div>
    {notes.some((note) => !noteAnchorExists(note)) && <p className="git-review-stale-note" role="status">Some saved notes no longer match the current hunk text. They are preserved and marked as moved.</p>}
    {diff.includes("diff preview truncated") && <p className="git-review-stale-note">This diff is truncated. Refresh and review a smaller file selection to see all changes.</p>}
  </div>;

  function renderHunk(file: ReviewDiffFile, hunk: ReviewDiffFile["hunks"][number], fileIndex: number) {
    const removed = hunk.lines.filter((line) => line.kind === "removed").map((line) => line.text.replace(/\s+/g, " ").trim());
    const added = hunk.lines.filter((line) => line.kind === "added").map((line) => line.text.replace(/\s+/g, " ").trim());
    const whitespaceOnly = removed.length === added.length && removed.every((line, index) => line === added[index]) && hunk.lines.some((line) => line.kind === "added" || line.kind === "removed");
    return <section className={`git-review-hunk${preferences.highlightWhitespace && whitespaceOnly ? " is-whitespace-only" : ""}`} key={`${fileIndex}-${hunk.id}`}>
      <label className="git-review-hunk-toggle"><input type="checkbox" checked={isHunkSelected(file, hunk.id)} onChange={(event) => toggleHunk(file, hunk.id, event.target.checked)} /><code>{hunk.header}</code><span>Include hunk in commit</span></label>
      <div className="git-review-hunk-lines">{hunk.lines.map((line, lineIndex) => {
        const lineNumber = line.kind === "removed" ? line.oldLine : line.newLine;
        const anchored = notes.filter((note) => note.path === file.path && note.hunk === hunk.header && note.line === lineNumber && note.side === line.kind && note.snippet === line.text);
        return <div key={`${hunk.id}-${lineIndex}`} className={`git-review-line is-${line.kind}`}><span>{line.oldLine ?? ""}</span><span>{line.newLine ?? ""}</span><code>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "} {line.text}</code>{line.kind !== "context" && <Button type="button" variant="ghost" onClick={() => { setDraft({ path: file.path, line: lineNumber ?? 0, side: line.kind as "added" | "removed", snippet: line.text, hunk: hunk.header }); setCommentText(""); }}>Comment</Button>}{anchored.length > 0 && <span className="git-review-line-note-count">{anchored.length} note{anchored.length === 1 ? "" : "s"}</span>}</div>;
      })}</div>
      {draft?.path === file.path && draft.hunk === hunk.header && <form className="git-review-comment-form" onSubmit={(event) => { event.preventDefault(); saveNote(); }}><label>Comment on {draft.path}:{draft.line}<textarea autoFocus value={commentText} maxLength={2_000} onChange={(event) => setCommentText(event.target.value)} placeholder="Describe the issue or requested change…" rows={3} /></label><div><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!commentText.trim()}>Save review note</Button></div></form>}
      {notes.filter((note) => note.path === file.path && note.hunk === hunk.header).map((note) => <article className={`git-review-note${noteAnchorExists(note) ? "" : " is-stale"}${note.status !== "open" ? " is-closed" : ""}`} key={note.id}><span>{note.path}:{note.line} · {noteAnchorExists(note) ? "anchored" : "anchor may have moved"} · {note.status}</span><p>{note.text}</p><div className="git-review-note-actions"><Button variant="ghost" type="button" onClick={() => setNotes((current) => current.map((item) => item.id === note.id ? { ...item, status: item.status === "resolved" ? "open" : "resolved", history: [...item.history, { status: item.status === "resolved" ? "open" : "resolved", at: new Date().toISOString() }] } : item))}>{note.status === "resolved" ? "Reopen" : "Resolve"}</Button><Button variant="ghost" type="button" onClick={() => setNotes((current) => current.map((item) => item.id === note.id ? { ...item, status: item.status === "deferred" ? "open" : "deferred", history: [...item.history, { status: item.status === "deferred" ? "open" : "deferred", at: new Date().toISOString() }] } : item))}>{note.status === "deferred" ? "Reopen" : "Defer"}</Button><details><summary>History</summary><ul>{note.history.map((entry, index) => <li key={`${note.id}-${index}`}>{entry.status} · {new Date(entry.at).toLocaleString()}</li>)}</ul></details><Button variant="ghost" type="button" onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))}>Remove note</Button></div></article>)}
    </section>;
  }
}
