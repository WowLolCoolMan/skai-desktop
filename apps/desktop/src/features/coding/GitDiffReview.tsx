import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "../../components/ui/Primitives";
import type { DesktopGitChange } from "../../../shared/contracts";
import { gitChangeLabel, parseGitReviewDiff, type ReviewDiffFile } from "./gitReview";

type ReviewNote = { id: string; path: string; line: number; side: "added" | "removed"; snippet: string; hunk: string; text: string; createdAt: string };
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
    return stored.filter((item): item is ReviewNote => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.path === "string" && Number.isInteger(item.line) && ["added", "removed"].includes(item.side) && typeof item.snippet === "string" && typeof item.hunk === "string" && typeof item.text === "string" && typeof item.createdAt === "string"));
  } catch { return []; }
}

export function GitDiffReview({ projectId, diff, changes, selectedPaths, onTogglePath, selectedHunks, onSelectedHunksChange, onSendReview }: {
  projectId: string;
  diff: string;
  changes: DesktopGitChange[];
  selectedPaths: string[];
  onTogglePath: (path: string, included: boolean) => void;
  selectedHunks: Record<string, number[]>;
  onSelectedHunksChange: (value: Record<string, number[]>) => void;
  onSendReview: (prompt: string) => void;
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
    setNotes((current) => [...current, { ...draft, id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }]);
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

  if (files.length === 0) return <pre className="git-diff-preview" tabIndex={0} aria-label="Local Git diff preview">{diff}</pre>;
  return <div className="git-review-workbench" aria-label="Review changes by file and hunk">
    <div className="git-review-workbench-heading"><div><strong>Diff review</strong><span>Include whole files or choose individual hunks. Your review notes stay local to this project across revisions.</span></div><div className="git-review-toolbar-options"><label><input type="checkbox" checked={preferences.showGenerated} onChange={(event) => setPreferences((current) => ({ ...current, showGenerated: event.target.checked }))} /> Show generated files</label><label><input type="checkbox" checked={preferences.expandLarge} onChange={(event) => setPreferences((current) => ({ ...current, expandLarge: event.target.checked }))} /> Expand large diffs</label><label><input type="checkbox" checked={preferences.highlightWhitespace} onChange={(event) => setPreferences((current) => ({ ...current, highlightWhitespace: event.target.checked }))} /> Mark whitespace-only edits</label><Button variant="secondary" type="button" disabled={!notes.length} onClick={() => onSendReview(`Review the selected project changes using these line-anchored findings. Address each finding by file and line, and report which findings are fixed, unresolved, or intentionally deferred.\n\n${notes.map((note) => `- ${note.path}:${note.line} (${note.side}${noteAnchorExists(note) ? " · anchor current" : " · anchor may have moved"}): ${note.text}`).join("\n")}`)}>Send {notes.length} note{notes.length === 1 ? "" : "s"} to chat</Button></div></div>
    {hiddenGeneratedCount > 0 && <p className="git-review-stale-note">{hiddenGeneratedCount} generated file{hiddenGeneratedCount === 1 ? " is" : "s are"} hidden by your review preference.</p>}
    <div className="git-review-file-list">{files.filter((file) => preferences.showGenerated || !isGeneratedReviewFile(file.path)).map((file, fileIndex) => {
      const change = changesByPath.get(file.path) ?? changes.find((item) => item.originalPath === file.oldPath);
      const wholeFileSelected = selectedPaths.includes(file.path);
      const diffCharacters = file.hunks.reduce((total, hunk) => total + hunk.header.length + hunk.lines.reduce((subtotal, line) => subtotal + line.text.length, 0), 0);
      const isLarge = diffCharacters >= 24_000;
      return <Card className="git-review-file" key={`${file.path}-${fileIndex}`}>
        <div className="git-review-file-heading"><label><input type="checkbox" checked={wholeFileSelected} onChange={(event) => onTogglePath(file.path, event.target.checked)} /><span><strong>{gitChangeLabel(change?.status ?? "M", file.kind)}</strong><b>{file.path}</b>{file.kind === "renamed" && <small>from {file.oldPath}</small>}</span></label><small>{file.hunks.length ? `${file.hunks.length} hunk${file.hunks.length === 1 ? "" : "s"}` : file.kind === "binary" ? "Binary change · whole file only" : "No text hunks"}</small></div>
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
      {notes.filter((note) => note.path === file.path && note.hunk === hunk.header).map((note) => <article className={`git-review-note${noteAnchorExists(note) ? "" : " is-stale"}`} key={note.id}><span>{note.path}:{note.line} · {noteAnchorExists(note) ? "anchored" : "anchor may have moved"}</span><p>{note.text}</p><Button variant="ghost" type="button" onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))}>Remove note</Button></article>)}
    </section>;
  }
}
