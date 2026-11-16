import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import type { DesktopGitDiff, DesktopGitStatus, DesktopProject, DesktopProjectFile, DesktopProjectPreview } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { NavIcon } from "../../components/ui/NavIcon";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ProjectFileTree } from "./ProjectFileTree";

function terminalStorageKey(projectId: string) {
  return `skai.coding.terminalOpen.${projectId}`;
}

function openTabsStorageKey(projectId: string) {
  return `skai.coding.openTabs.${projectId}`;
}

function activeFileStorageKey(projectId: string) {
  return `skai.coding.activeFile.${projectId}`;
}

function languageForPath(path: string | null) {
  const extension = path?.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    cjs: "javascript", css: "css", cs: "csharp", h: "cpp", hpp: "cpp", html: "html", java: "java", js: "javascript", json: "json", jsx: "javascript", md: "markdown", mjs: "javascript", py: "python", sh: "shell", sql: "sql", ts: "typescript", tsx: "typescript", txt: "plaintext", yml: "yaml", yaml: "yaml"
  };
  return languages[extension ?? ""] ?? "plaintext";
}

type CodingSessionViewProps = {
  conversation?: ReactNode;
  projects: DesktopProject[];
  selectedProject: DesktopProject;
  projectFiles: DesktopProjectFile[];
  selectedFile: string | null;
  filePreview: DesktopProjectPreview | null;
  filePreviewError: string | null;
  fileDraft: string;
  fileOriginal: string;
  fileSummary: string | null;
  fileBusy: boolean;
  fileUndoAvailable: boolean;
  terminalBusy: boolean;
  terminalOutput: string | null;
  terminalExitCode: number | null;
  gitStatus: DesktopGitStatus | null;
  gitBusy: boolean;
  gitDiff: DesktopGitDiff | null;
  gitDiffBusy: boolean;
  gitCommitBusy: boolean;
  gitPushBusy: boolean;
  gitPullRequestBusy: boolean;
  onOpenProject: (project: DesktopProject) => void;
  onOpenFile: (relativePath: string) => void;
  onCloseFile: () => void;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onUndoFile: () => void;
  onRunTerminal: (projectId: string, command: string, cwd: string) => void;
  onRefreshGitStatus: () => void;
  onLoadGitDiff: (paths?: string[]) => void;
  onCommitGitChanges: (message: string, paths?: string[]) => Promise<boolean>;
  onPushGitChanges: () => Promise<boolean>;
  onCreateGitPullRequest: (title: string, body: string) => Promise<boolean>;
};

export function CodingSessionView({ conversation, projects, selectedProject, projectFiles, selectedFile, filePreview, filePreviewError, fileDraft, fileOriginal, fileSummary, fileBusy, fileUndoAvailable, terminalBusy, terminalOutput, terminalExitCode, gitStatus, gitBusy, gitDiff, gitDiffBusy, gitCommitBusy, gitPushBusy, gitPullRequestBusy, onRefreshGitStatus, onLoadGitDiff, onCommitGitChanges, onPushGitChanges, onCreateGitPullRequest, onOpenProject, onOpenFile, onCloseFile, onDraftChange, onSaveFile, onUndoFile, onRunTerminal }: CodingSessionViewProps) {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [openTabsLoadedProject, setOpenTabsLoadedProject] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"editor" | "diff" | "preview">("editor");
  const [gitMessage, setGitMessage] = useState("Update local project");
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  const [pullRequestTitle, setPullRequestTitle] = useState("Review local project changes");
  const [pullRequestBody, setPullRequestBody] = useState("Please review the local changes and validation evidence.");
  const [selectedGitPaths, setSelectedGitPaths] = useState<string[]>([]);
  const loadedTabsProjectRef = useRef<string | null>(null);
  const activeFileRestoreRef = useRef<string | null>(null);
  const skipTabPersistenceRef = useRef(false);
  const hasChanges = Boolean(selectedFile && fileDraft !== fileOriginal);
  const selectedKind = projectFiles.find((file) => file.relativePath === selectedFile)?.kind ?? "text";
  const filteredFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    return query ? projectFiles.filter((file) => file.relativePath.toLowerCase().includes(query)) : projectFiles;
  }, [fileQuery, projectFiles]);
  const fileSearchRef = useRef<HTMLInputElement>(null);
  const gitPathKey = gitStatus?.changes.map((change) => change.path).join("\u0000") ?? "";
  useEffect(() => { setSelectedGitPaths(gitStatus?.changes.map((change) => change.path) ?? []); }, [gitPathKey]);

  useEffect(() => { setPanelMode("editor"); }, [selectedFile, fileOriginal]);
  useEffect(() => {
    let restoredTabs: string[] = [];
    try {
      const storedTabs = JSON.parse(localStorage.getItem(openTabsStorageKey(selectedProject.id)) ?? "[]");
      if (Array.isArray(storedTabs)) restoredTabs = storedTabs.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 12);
    } catch {
      restoredTabs = [];
    }
    loadedTabsProjectRef.current = selectedProject.id;
    activeFileRestoreRef.current = null;
    skipTabPersistenceRef.current = true;
    setOpenTabs(restoredTabs);
    setOpenTabsLoadedProject(selectedProject.id);
    setFileQuery("");
    setTerminalOpen(localStorage.getItem(terminalStorageKey(selectedProject.id)) === "true");
  }, [selectedProject.id]);
  useEffect(() => {
    if (loadedTabsProjectRef.current !== selectedProject.id) return;
    if (skipTabPersistenceRef.current) {
      skipTabPersistenceRef.current = false;
      return;
    }
    localStorage.setItem(openTabsStorageKey(selectedProject.id), JSON.stringify(openTabs));
  }, [openTabs, selectedProject.id]);
  useEffect(() => { localStorage.setItem(terminalStorageKey(selectedProject.id), String(terminalOpen)); }, [selectedProject.id, terminalOpen]);
  useEffect(() => { if (selectedFile) setOpenTabs((current) => current.includes(selectedFile) ? current : [...current, selectedFile]); }, [selectedFile]);
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        fileSearchRef.current?.focus();
        fileSearchRef.current?.select();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && selectedFile && hasChanges && !fileBusy) {
        event.preventDefault();
        onSaveFile();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [fileBusy, hasChanges, onSaveFile, selectedFile]);

  const openFile = (path: string) => {
    setOpenTabs((current) => current.includes(path) ? current : [...current, path]);
    localStorage.setItem(activeFileStorageKey(selectedProject.id), path);
    activeFileRestoreRef.current = `${selectedProject.id}:${path}`;
    onOpenFile(path);
  };

  useEffect(() => {
    if (openTabsLoadedProject !== selectedProject.id) return;
    const path = localStorage.getItem(activeFileStorageKey(selectedProject.id));
    if (!path || activeFileRestoreRef.current === `${selectedProject.id}:${path}` || !projectFiles.some((file) => file.relativePath === path)) return;
    activeFileRestoreRef.current = `${selectedProject.id}:${path}`;
    setOpenTabs((current) => current.includes(path) ? current : [...current, path]);
    onOpenFile(path);
  }, [onOpenFile, openTabsLoadedProject, projectFiles, selectedProject.id]);

  const focusTab = (index: number) => {
    const path = openTabs[index];
    if (!path) return;
    openFile(path);
    window.requestAnimationFrame(() => document.getElementById(`coding-file-tab-${index}`)?.focus());
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % openTabs.length
      : event.key === "ArrowLeft" ? (index - 1 + openTabs.length) % openTabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? openTabs.length - 1
      : -1;
    if (nextIndex < 0 || !openTabs.length) return;
    event.preventDefault();
    focusTab(nextIndex);
  };

  const closeTab = (path: string) => {
    const index = openTabs.indexOf(path);
    const next = openTabs.filter((item) => item !== path);
    setOpenTabs(next);
    if (path === selectedFile) {
      const nextActive = next[index] ?? next[index - 1];
      if (nextActive) openFile(nextActive);
      else { localStorage.removeItem(activeFileStorageKey(selectedProject.id)); activeFileRestoreRef.current = null; onCloseFile(); }
    }
  };

  return <>
    <div className="coding-project-context" aria-label="Project and Git status"><div className={`git-summary${gitStatus?.hasConflicts ? " has-conflicts" : ""}`} aria-live="polite"><strong>{gitStatus ? gitStatus.branch : "Git status unavailable"}</strong><span>{gitStatus ? `${gitStatus.changes.length} change${gitStatus.changes.length === 1 ? "" : "s"}${gitStatus.hasConflicts ? " · conflicts" : ""}` : "Select a Git repository to inspect changes"}</span></div><div className="coding-project-context-actions"><Button variant="ghost" disabled={gitBusy} onClick={onRefreshGitStatus}>{gitBusy ? "Checking…" : "Refresh Git"}</Button><label><span className="sr-only">Switch coding project</span><select value={selectedProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) onOpenProject(project); }} aria-label="Switch coding project">{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label></div></div>
    <div className="coding-session-grid">{conversation && <div className="project-thread-panel">{conversation}</div>}<Card className="project-browser-card coding-project-browser">
      <div className="panel-heading"><div><p className="section-kicker">PROJECT FILES</p><h3>Files &amp; changes</h3></div><div className="project-browser-actions"><span className="panel-count">{projectFiles.length}</span><Button variant={terminalOpen ? "secondary" : "ghost"} aria-pressed={terminalOpen} onClick={() => setTerminalOpen((open) => !open)}>{terminalOpen ? "Hide terminal" : "Show terminal"}</Button></div></div>
      {fileSummary && <p className="file-summary">{fileSummary}</p>}
      {gitStatus && <div className={`git-change-summary${gitStatus.hasConflicts ? " has-conflicts" : ""}`} aria-label="Local Git changes"><div><p className="section-kicker">LOCAL GIT REVIEW</p><strong>{gitStatus.changes.length ? `${gitStatus.changes.length} changed file${gitStatus.changes.length === 1 ? "" : "s"}` : "Working tree clean"}</strong><span>{gitStatus.commitsAhead} ahead · {gitStatus.commitsBehind} behind · {gitStatus.repository}</span></div>{gitStatus.changes.length > 0 && <ul className="git-change-list">{gitStatus.changes.map((change) => <li key={`${change.status}-${change.path}`}><label><input type="checkbox" checked={selectedGitPaths.includes(change.path)} onChange={(event) => setSelectedGitPaths((current) => event.target.checked ? [...current, change.path] : current.filter((path) => path !== change.path))} /><b>{change.status}</b><span>{change.path}</span></label></li>)}</ul>}{gitStatus.changes.length > 8 && <small>Showing all {gitStatus.changes.length} changes. Review and commit are bounded to 24 files per operation.</small>}{gitStatus.hasConflicts && <small role="alert">Conflicts need review before any commit workflow can proceed.</small>}{gitStatus.changes.length > 0 && <div className="git-review-actions"><Button variant="ghost" onClick={() => setSelectedGitPaths(gitStatus.changes.map((change) => change.path))}>Select all</Button><Button variant="ghost" onClick={() => setSelectedGitPaths([])}>Clear selection</Button><Button variant="secondary" disabled={gitDiffBusy || gitStatus.hasConflicts || !selectedGitPaths.length} onClick={() => onLoadGitDiff(selectedGitPaths)}>{gitDiffBusy ? "Loading diff…" : gitDiff ? "Refresh diff" : "Review diff"}</Button><input value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} aria-label="Local Git commit message" maxLength={256} placeholder="Commit message" /><Button variant="primary" disabled={gitCommitBusy || gitStatus.hasConflicts || !gitMessage.trim() || !selectedGitPaths.length} onClick={() => void onCommitGitChanges(gitMessage, selectedGitPaths)}>{gitCommitBusy ? "Committing…" : `Commit ${selectedGitPaths.length} selected`}</Button></div>}{gitDiff && <pre className="git-diff-preview" aria-label="Local Git diff preview">{gitDiff.text}</pre>}</div>}
       {gitStatus && gitStatus.changes.length === 0 && gitStatus.commitsAhead > 0 && <div className="git-review-actions"><span className="settings-help">Clean working tree · push uses the configured local Git credential helper.</span><Button variant="primary" disabled={gitPushBusy || gitStatus.commitsBehind > 0} onClick={() => void onPushGitChanges()}>{gitPushBusy ? "Pushing…" : "Push local commits"}</Button><Button variant="secondary" disabled={gitPullRequestBusy || gitStatus.commitsBehind > 0} onClick={() => setPullRequestOpen(true)}>{gitPullRequestBusy ? "Opening PR…" : "Create pull request"}</Button></div>}
      <div className="project-file-layout">
        <div className="project-file-explorer"><div className="file-list-toolbar"><input ref={fileSearchRef} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Filter files…" aria-label="Filter project files" /><kbd>Ctrl P</kbd></div>{projectFiles.length === 0 ? <EmptyState title="No readable files" description="Protected names and unsupported files are hidden." /> : filteredFiles.length === 0 ? <EmptyState title="No matching files" description="Try a shorter path or filename." /> : <ProjectFileTree key={selectedProject.id} files={filteredFiles} query={fileQuery} selectedFile={selectedFile} onOpenFile={openFile} />}</div>
        <div className="file-editor-panel">
          {openTabs.length > 0 && <div className="file-tabs" role="tablist" aria-orientation="horizontal" aria-label="Open project files">{openTabs.map((path, index) => <div className={`file-tab ${selectedFile === path ? "is-active" : ""}`} key={path}><button id={`coding-file-tab-${index}`} type="button" role="tab" tabIndex={selectedFile === path || (!selectedFile && index === 0) ? 0 : -1} aria-selected={selectedFile === path} aria-controls="coding-file-editor" onClick={() => openFile(path)} onKeyDown={(event) => onTabKeyDown(event, index)}><span>{path}</span>{selectedFile === path && hasChanges ? <i aria-label="Unsaved changes">•</i> : null}</button><button className="file-tab-close" type="button" onClick={() => closeTab(path)} aria-label={`Close ${path}`}>×</button></div>)}</div>}
          {selectedFile ? <>{selectedKind === "text" ? <><div id="coding-file-editor" className="file-editor-heading"><span>{selectedFile} · {languageForPath(selectedFile)}</span><div><Button variant={panelMode === "editor" ? "secondary" : "ghost"} onClick={() => setPanelMode("editor")}>Editor</Button>{selectedFile.toLowerCase().endsWith(".html") && <Button variant={panelMode === "preview" ? "secondary" : "ghost"} onClick={() => setPanelMode("preview")}>Preview</Button>}<Button variant={panelMode === "diff" ? "secondary" : "ghost"} disabled={!hasChanges} onClick={() => setPanelMode("diff")}>Review diff</Button><Button variant="ghost" disabled={fileBusy || !fileUndoAvailable} title={fileUndoAvailable ? "Undo the last saved edit" : "No saved edit to undo"} onClick={onUndoFile}>Undo</Button><Button variant="primary" disabled={fileBusy || !hasChanges} onClick={onSaveFile}>{fileBusy ? "Saving…" : "Save edit"}</Button></div></div>{panelMode === "preview" ? <iframe className="project-html-preview-frame" title={`Preview ${selectedFile}`} sandbox="" srcDoc={fileDraft} /> : panelMode === "diff" ? <div className="monaco-diff-shell" aria-label="Local diff preview"><DiffEditor original={fileOriginal} modified={fileDraft} language={languageForPath(selectedFile)} theme="vs-dark" options={{ automaticLayout: true, minimap: { enabled: false }, readOnly: true, renderSideBySide: true, scrollBeyondLastLine: false, wordWrap: "on" }} /></div> : <div className="monaco-editor-shell" aria-label={`Edit ${selectedFile}`}><Editor value={fileDraft} language={languageForPath(selectedFile)} theme="vs-dark" onChange={(value) => onDraftChange(value ?? "")} options={{ automaticLayout: true, fontSize: 13, folding: true, lineNumbers: "on", minimap: { enabled: true }, padding: { top: 12, bottom: 12 }, scrollBeyondLastLine: false, tabSize: 2, wordWrap: "off" }} /></div>}</> : <div className="project-file-preview">{filePreview ? filePreview.kind === "image" ? <img src={`data:${filePreview.mediaType};base64,${filePreview.content}`} alt={selectedFile} /> : filePreview.mediaType === "application/pdf" ? <><div className="project-pdf-preview-label">PDF rendered locally · original file stays in the project</div><iframe className="project-pdf-preview-frame" title={`Preview ${selectedFile}`} sandbox="" src={`data:application/pdf;base64,${filePreview.content}`} /></> : <><div className="project-pdf-preview-label">Selectable text extracted locally · original PDF stays in the project</div><pre>{filePreview.content || "No selectable text was found in this PDF."}</pre></> : <p aria-live="polite">{filePreviewError ? `Preview unavailable: ${filePreviewError}` : "Loading safe preview…"}</p>}</div>}</> : <EmptyState title="Select a file" description="Choose a readable file to preview or edit it with guarded write-back." />}
        </div>
      </div>
      {terminalOpen && <div className="project-dock"><TerminalPanel projects={projects} initialProjectId={selectedProject.id} busy={terminalBusy} output={terminalOutput} exitCode={terminalExitCode} compact onRun={onRunTerminal} /></div>}
    </Card></div>
    <ModalDialog open={pullRequestOpen} onClose={() => setPullRequestOpen(false)} titleId="create-pull-request-title"><form onSubmit={(event) => { event.preventDefault(); void onCreateGitPullRequest(pullRequestTitle, pullRequestBody).then((created) => { if (created) setPullRequestOpen(false); }); }}><div className="dialog-heading"><div><p className="section-kicker">GITHUB WORKFLOW</p><h3 id="create-pull-request-title">Create pull request</h3><p>Uses the local GitHub CLI session. No token is entered into Skai Desktop.</p></div><button type="button" onClick={() => setPullRequestOpen(false)} aria-label="Close dialog">×</button></div><label>Title<input value={pullRequestTitle} onChange={(event) => setPullRequestTitle(event.target.value)} maxLength={256} /></label><label>Description<textarea value={pullRequestBody} onChange={(event) => setPullRequestBody(event.target.value)} maxLength={16000} rows={6} /></label><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setPullRequestOpen(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={gitPullRequestBusy || !pullRequestTitle.trim()}>{gitPullRequestBusy ? "Creating…" : "Create pull request"}</Button></div></form></ModalDialog>
  </>;
}
