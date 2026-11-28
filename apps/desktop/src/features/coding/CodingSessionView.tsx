import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Editor } from "./monacoLazy";
import { useMonacoTheme } from "../../theme/useMonacoTheme";
import type { Model } from "../../app/types";
import type { DesktopGitChange, DesktopGitDiff, DesktopGitStatus, DesktopProject, DesktopProjectCheck, DesktopProjectFile, DesktopProjectPreflight, DesktopProjectPreview, DesktopTask, DesktopTaskWorkerDraft } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { OverflowMenu } from "../../components/ui/OverflowMenu";
import { NavIcon } from "../../components/ui/NavIcon";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ProjectFileTree } from "./ProjectFileTree";
import { CodingTaskInspector } from "./CodingTaskInspector";
import { BrowserPreview } from "./BrowserPreview";
import { CodingSideChat } from "./CodingSideChat";
import { ProjectScratchpad } from "./ProjectScratchpad";
import { CodingPaneTabs } from "./CodingPaneTabs";
import { useCodingPaneWorkspace, type CodingPanePanel, type CodingPanePreset } from "./useCodingPaneWorkspace";
import { useCodingFileTabs } from "./useCodingFileTabs";
import { MarkdownPreview } from "./MarkdownPreview";
import { ReviewChecklist } from "./ReviewChecklist";
import { GitDiffReview } from "./GitDiffReview";
import { parseGitReviewDiff } from "./gitReview";
import type { Message } from "../../app/types";

function terminalStorageKey(projectId: string) {
  return `skai.coding.terminalOpen.${projectId}`;
}

function fileExplorerStorageKey(projectId: string) {
  return `skai.coding.fileExplorerVisible.${projectId}`;
}

function splitPaneRatioStorageKey(projectId: string) {
  return `skai.coding.threadPanePercent.${projectId}`;
}

function readSplitPanePercent(projectId: string) {
  const stored = Number(localStorage.getItem(splitPaneRatioStorageKey(projectId)));
  // Start balanced so the first Coding viewport keeps the latest chat turn
  // readable while leaving enough width for a real file or diff preview.
  return Number.isFinite(stored) && stored >= 30 && stored <= 70 ? stored : 50;
}

function languageForPath(path: string | null) {
  const extension = path?.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    cjs: "javascript", css: "css", cs: "csharp", h: "cpp", hpp: "cpp", html: "html", java: "java", js: "javascript", json: "json", jsx: "javascript", md: "markdown", mjs: "javascript", py: "python", sh: "shell", sql: "sql", svg: "xml", ts: "typescript", tsx: "typescript", txt: "plaintext", yml: "yaml", yaml: "yaml"
  };
  return languages[extension ?? ""] ?? "plaintext";
}

function monacoFileModelPath(projectId: string, filePath: string) {
  const encodedFilePath = filePath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `inmemory://skai-desktop/${encodeURIComponent(projectId)}/${encodedFilePath}`;
}

type InlineDiffRow = { kind: "context" | "removed" | "added"; oldLine: number | null; newLine: number | null; text: string };
type SplitDiffRow = { original: InlineDiffRow | null; working: InlineDiffRow | null };

function inlineDiffRows(original: string, working: string): InlineDiffRow[] {
  // Monaco normalizes edited text to LF while Windows files often use CRLF.
  // Ignore that representation difference so a one-line edit stays one-line.
  const before = original.replace(/\r\n/g, "\n").split("\n");
  const after = working.replace(/\r\n/g, "\n").split("\n");
  if (before.length * after.length > 250_000) return [
    ...before.map((text, index) => ({ kind: "removed" as const, oldLine: index + 1, newLine: null, text })),
    ...after.map((text, index) => ({ kind: "added" as const, oldLine: null, newLine: index + 1, text })),
  ];
  const lengths = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) for (let j = after.length - 1; j >= 0; j--) {
    lengths[i][j] = before[i] === after[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  }
  const rows: InlineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ kind: "context", oldLine: i + 1, newLine: j + 1, text: before[i] }); i++; j++;
    } else if (i < before.length && (j === after.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      rows.push({ kind: "removed", oldLine: i + 1, newLine: null, text: before[i] }); i++;
    } else {
      rows.push({ kind: "added", oldLine: null, newLine: j + 1, text: after[j] }); j++;
    }
  }
  return rows;
}

function splitDiffRows(rows: InlineDiffRow[]): SplitDiffRow[] {
  const paired: SplitDiffRow[] = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index].kind === "context") {
      paired.push({ original: rows[index], working: rows[index] });
      index++;
      continue;
    }
    const removed: InlineDiffRow[] = [];
    const added: InlineDiffRow[] = [];
    while (index < rows.length && rows[index].kind !== "context") {
      if (rows[index].kind === "removed") removed.push(rows[index]);
      else added.push(rows[index]);
      index++;
    }
    for (let line = 0; line < Math.max(removed.length, added.length); line++) {
      paired.push({ original: removed[line] ?? null, working: added[line] ?? null });
    }
  }
  return paired;
}

type CodingSessionViewProps = {
  workspaceTabId?: string;
  conversationId?: string | null;
  conversation?: ReactNode;
  messages: Message[];
  sideChatRequest: number;
  onNewWorkspaceTab: () => void;
  projects: DesktopProject[];
  selectedProject: DesktopProject;
  tasks: DesktopTask[];
  models: Model[];
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
  projectChecks: DesktopProjectCheck[];
  projectChecksBusy: boolean;
  projectCheckBusy: boolean;
  onOpenProject: (project: DesktopProject) => void;
  onOpenFile: (relativePath: string) => void;
  onCloseFile: () => void;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onUndoFile: () => void;
  onRunTerminal: (projectId: string, command: string, cwd: string) => void;
  onRunProjectPreflight: (projectId: string) => Promise<DesktopProjectPreflight | null>;
  onRefreshGitStatus: () => void;
  onLoadGitDiff: (paths?: string[]) => void;
  onCommitGitChanges: (message: string, paths?: string[], hunks?: Record<string, number[]>) => Promise<boolean>;
  onSendReview: (prompt: string) => void;
  onPushGitChanges: () => Promise<boolean>;
  onCreateGitPullRequest: (title: string, body: string, draft?: boolean) => Promise<boolean>;
  onLoadProjectChecks: (projectId?: string) => void;
  onRunProjectCheck: (projectId: string, taskId: string, checkId: string) => Promise<unknown>;
  onCancelTask: (taskId: string) => void;
  onTransitionTask: (taskId: string, operation: "queue" | "approve" | "deny" | "retry" | "release") => void;
  onSteerTask: (taskId: string, instruction: string) => Promise<boolean>;
  onDelegateTask: (parentId: string, workers: DesktopTaskWorkerDraft[]) => Promise<boolean>;
  onOpenTaskWorktree: (taskId: string) => Promise<boolean>;
  onPlanTask: (title: string, instruction: string, environment: "local" | "worktree", conversationId?: string | null, requiresApproval?: boolean, projectId?: string | null) => Promise<boolean>;
  onExecuteTask: (taskId: string) => void;
  onStartSubagent: (projectId: string, instruction: string, conversationId?: string | null) => Promise<string | null>;
};

export function CodingSessionView({ workspaceTabId = "workspace-home", conversationId = null, conversation, messages, sideChatRequest, onNewWorkspaceTab, onStartSubagent, projects, models, selectedProject, tasks, projectFiles, selectedFile, filePreview, filePreviewError, fileDraft, fileOriginal, fileSummary, fileBusy, fileUndoAvailable, terminalBusy, terminalOutput, terminalExitCode, gitStatus, gitBusy, gitDiff, gitDiffBusy, gitCommitBusy, gitPushBusy, gitPullRequestBusy, projectChecks, projectChecksBusy, projectCheckBusy, onLoadProjectChecks, onRunProjectCheck, onCancelTask, onTransitionTask, onSteerTask, onDelegateTask, onOpenTaskWorktree, onPlanTask, onExecuteTask, onRefreshGitStatus, onLoadGitDiff, onCommitGitChanges, onSendReview, onPushGitChanges, onCreateGitPullRequest, onOpenProject, onOpenFile, onCloseFile, onDraftChange, onSaveFile, onUndoFile, onRunTerminal, onRunProjectPreflight }: CodingSessionViewProps) {
  // Theme: Monaco colors, syntax and font follow the active theme (src/theme/useMonacoTheme.ts).
  const monacoTheme = useMonacoTheme();
  const [fileQuery, setFileQuery] = useState("");
  const [fileExplorerVisible, setFileExplorerVisible] = useState(() => localStorage.getItem(fileExplorerStorageKey(selectedProject.id)) !== "false");
  const [fileExplorerProjectLoaded, setFileExplorerProjectLoaded] = useState(selectedProject.id);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [snapshotMode, setSnapshotMode] = useState(() => localStorage.getItem(`skai.coding.snapshot.${selectedProject.id}`) === "true");
  const [focusLayout, setFocusLayout] = useState(false);
  const [scratchpadText, setScratchpadText] = useState(() => localStorage.getItem(`skai.project.scratchpad.${selectedProject.id}`) ?? "");
  const [taskInspectorOpen, setTaskInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"sources" | "changes" | "activity" | "terminal" | "browser">("sources");
  const [workspaceView, setWorkspaceView] = useState<"chat" | "files">("chat");
  const [filesChangesView, setFilesChangesView] = useState<"files" | "changes">(() => localStorage.getItem(`skai.coding.filesChangesView.${selectedProject.id}`) === "changes" ? "changes" : "files");
  const [codingLayout, setCodingLayout] = useState(() => ({ projectId: selectedProject.id, threadFirst: localStorage.getItem(`skai.coding.threadFirst.${selectedProject.id}`) !== "false" }));
  const threadFirst = codingLayout.projectId === selectedProject.id && codingLayout.threadFirst;
  const [codingSplitRatio, setCodingSplitRatio] = useState(() => ({ projectId: selectedProject.id, threadPercent: readSplitPanePercent(selectedProject.id) }));
  const threadPanePercent = codingSplitRatio.projectId === selectedProject.id ? codingSplitRatio.threadPercent : readSplitPanePercent(selectedProject.id);
  const [splitResizeActive, setSplitResizeActive] = useState(false);
  useEffect(() => { setCodingLayout({ projectId: selectedProject.id, threadFirst: localStorage.getItem(`skai.coding.threadFirst.${selectedProject.id}`) !== "false" }); }, [selectedProject.id]);
  useEffect(() => { if (codingLayout.projectId === selectedProject.id) localStorage.setItem(`skai.coding.threadFirst.${selectedProject.id}`, String(codingLayout.threadFirst)); }, [codingLayout, selectedProject.id]);
  useEffect(() => { setCodingSplitRatio({ projectId: selectedProject.id, threadPercent: readSplitPanePercent(selectedProject.id) }); }, [selectedProject.id]);
  useEffect(() => { if (codingSplitRatio.projectId === selectedProject.id) localStorage.setItem(splitPaneRatioStorageKey(selectedProject.id), String(codingSplitRatio.threadPercent)); }, [codingSplitRatio, selectedProject.id]);
  const codingPane = useCodingPaneWorkspace(`${selectedProject.id}::${workspaceTabId}`, selectedProject.id);
  const { pages: codingPanePages, activePageId: activeCodingPanePageId, panel: workspacePanel, isSplitOpen: codingSplitOpen } = codingPane;
  const lastSideChatRequest = useRef(sideChatRequest);
  const [panelMode, setPanelMode] = useState<"editor" | "diff" | "preview">("editor");
  const [gitMessage, setGitMessage] = useState("Update local project");
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  const [pendingCloseFile, setPendingCloseFile] = useState<string | null>(null);
  const [pullRequestTitle, setPullRequestTitle] = useState("Review local project changes");
  const [pullRequestBody, setPullRequestBody] = useState("Please review the local changes and validation evidence.");
  const [pullRequestDraft, setPullRequestDraft] = useState(true);
  const [selectedGitPaths, setSelectedGitPaths] = useState<string[]>([]);
  const [selectedGitHunks, setSelectedGitHunks] = useState<Record<string, number[]>>({});
  const reviewDiffFiles = useMemo(() => parseGitReviewDiff(gitDiff?.text ?? ""), [gitDiff?.text]);
  const commitSelection = useMemo(() => {
    const paths: string[] = [];
    const hunks: Record<string, number[]> = {};
    for (const path of selectedGitPaths) {
      const file = reviewDiffFiles.find((entry) => entry.path === path);
      if (!file || file.hunks.length === 0) { paths.push(path); continue; }
      const chosen = selectedGitHunks[path] ?? file.hunks.map((hunk) => hunk.id);
      if (chosen.length === 0) continue;
      paths.push(path);
      if (chosen.length < file.hunks.length) hunks[path] = chosen;
    }
    return { paths, hunks };
  }, [reviewDiffFiles, selectedGitHunks, selectedGitPaths]);
  useEffect(() => setSelectedGitHunks({}), [gitDiff?.text]);
  const [preflight, setPreflight] = useState<DesktopProjectPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightMessage, setPreflightMessage] = useState("");
  const fileTabs = useCodingFileTabs({ projectId: selectedProject.id, projectFiles, selectedFile, onOpenFile, onCloseFile });
  const hasChanges = Boolean(selectedFile && fileDraft !== fileOriginal);
  const reviewRows = useMemo(() => inlineDiffRows(fileOriginal, fileDraft), [fileOriginal, fileDraft]);
  const splitReviewRows = useMemo(() => splitDiffRows(reviewRows), [reviewRows]);
  const selectedKind = projectFiles.find((file) => file.relativePath === selectedFile)?.kind ?? "text";
  const filteredFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    return query ? projectFiles.filter((file) => file.relativePath.toLowerCase().includes(query)) : projectFiles;
  }, [fileQuery, projectFiles]);
  const filteredChanges = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    return (gitStatus?.changes ?? []).filter((change) => !query || change.path.toLowerCase().includes(query));
  }, [fileQuery, gitStatus]);
  const fileSearchRef = useRef<HTMLInputElement>(null);
  const gitPathKey = gitStatus?.changes.map((change) => change.path).join("\u0000") ?? "";
  useEffect(() => { setSelectedGitPaths(gitStatus?.changes.map((change) => change.path) ?? []); }, [gitPathKey]);
  useEffect(() => { setPreflight(null); setPreflightMessage(""); }, [selectedProject.id]);
  useEffect(() => { setFilesChangesView(localStorage.getItem(`skai.coding.filesChangesView.${selectedProject.id}`) === "changes" ? "changes" : "files"); }, [selectedProject.id]);
  useEffect(() => { localStorage.setItem(`skai.coding.filesChangesView.${selectedProject.id}`, filesChangesView); }, [filesChangesView, selectedProject.id]);
  useEffect(() => { setScratchpadText(localStorage.getItem(`skai.project.scratchpad.${selectedProject.id}`) ?? ""); }, [selectedProject.id]);
  useEffect(() => { const enabled = localStorage.getItem(`skai.coding.snapshot.${selectedProject.id}`) === "true"; setSnapshotMode(enabled); if (enabled) setTerminalOpen(false); }, [selectedProject.id]);
  useEffect(() => { localStorage.setItem(`skai.coding.snapshot.${selectedProject.id}`, String(snapshotMode)); if (snapshotMode) setTerminalOpen(false); }, [selectedProject.id, snapshotMode]);
  useEffect(() => { localStorage.setItem(`skai.project.scratchpad.${selectedProject.id}`, scratchpadText); }, [scratchpadText, selectedProject.id]);
  useEffect(() => {
    setFileExplorerVisible(localStorage.getItem(fileExplorerStorageKey(selectedProject.id)) !== "false");
    setFileExplorerProjectLoaded(selectedProject.id);
  }, [selectedProject.id]);
  useEffect(() => {
    if (fileExplorerProjectLoaded !== selectedProject.id) return;
    localStorage.setItem(fileExplorerStorageKey(selectedProject.id), String(fileExplorerVisible));
  }, [fileExplorerProjectLoaded, fileExplorerVisible, selectedProject.id]);
  const openCodingPanePanel = (panel: CodingPanePanel, filePath?: string) => {
    codingPane.openPanel(panel, filePath ?? (panel === "editor" ? selectedFile ?? undefined : undefined));
    setTaskInspectorOpen(false);
  };
  const applyCodingPanePreset = (preset: CodingPanePreset) => {
    codingPane.applyPreset(preset);
    setTerminalOpen(preset === "chat-terminal");
    setWorkspaceView("chat");
    setTaskInspectorOpen(false);
  };

  const runPreflight = async () => {
    if (preflightBusy) return;
    setPreflightBusy(true);
    setPreflightMessage("");
    try {
      const result = await onRunProjectPreflight(selectedProject.id);
      if (result) setPreflight(result);
      else setPreflightMessage("Preflight could not inspect this project. Check the app status message.");
    } catch {
      setPreflightMessage("Preflight could not inspect this project.");
    } finally {
      setPreflightBusy(false);
    }
  };

  useEffect(() => { setPanelMode("editor"); }, [selectedFile, fileOriginal]);
  useEffect(() => {
    if (!sideChatRequest || sideChatRequest === lastSideChatRequest.current) return;
    lastSideChatRequest.current = sideChatRequest;
    codingPane.openPanel("side-chat");
  }, [codingPane, sideChatRequest]);
  useEffect(() => {
    setFileQuery("");
    setTerminalOpen(localStorage.getItem(terminalStorageKey(selectedProject.id)) === "true");
  }, [selectedProject.id]);
  useEffect(() => { localStorage.setItem(terminalStorageKey(selectedProject.id), String(terminalOpen)); }, [selectedProject.id, terminalOpen]);
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setFileExplorerVisible(true);
        window.requestAnimationFrame(() => { fileSearchRef.current?.focus(); fileSearchRef.current?.select(); });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setWorkspaceView("chat");
        setInspectorTab((current) => current === "terminal" && taskInspectorOpen ? "changes" : "terminal");
        setTaskInspectorOpen((open) => !(open && inspectorTab === "terminal"));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && selectedFile && hasChanges && !fileBusy) {
        event.preventDefault();
        onSaveFile();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [fileBusy, hasChanges, inspectorTab, onSaveFile, selectedFile, taskInspectorOpen]);

  const openFile = (path: string) => {
    codingPane.ensureSplitOpen();
    fileTabs.openFile(path);
  };

  const openFilePage = (path: string) => {
    openFile(path);
    openCodingPanePanel("editor", path);
  };

  const addFileToComposerContext = (path: string) => {
    window.dispatchEvent(new CustomEvent("skai:composer-file-context", { detail: { projectId: selectedProject.id, path, mode: "context" } }));
  };

  const compareFileWithChat = (path: string) => {
    window.dispatchEvent(new CustomEvent("skai:composer-file-context", { detail: { projectId: selectedProject.id, path, mode: "compare" } }));
  };

  const startFileReview = (path: string) => {
    onSendReview(`Review project file ${path}. Summarize its role, identify risks or regressions, and propose focused next steps. Keep the review read-only until I approve changes.`);
  };

  const attentionTasks = tasks.filter((task) => ["failed", "blocked", "awaiting_approval"].includes(task.status));
  const health = !selectedProject.folderPaths.length
    ? { tone: "warning", title: "Project folder is not connected", detail: "Add a trusted folder in Project settings before asking the agent to inspect files." }
    : gitStatus?.hasConflicts
      ? { tone: "danger", title: "Merge conflicts need review", detail: "Resolve conflicts before committing or pushing this project." }
      : attentionTasks.some((task) => ["failed", "blocked"].includes(task.status))
        ? { tone: "danger", title: `${attentionTasks.filter((task) => ["failed", "blocked"].includes(task.status)).length} task${attentionTasks.filter((task) => ["failed", "blocked"].includes(task.status)).length === 1 ? " needs" : "s need"} attention`, detail: "Review the task timeline for the failure, blocker, or next recovery action." }
        : attentionTasks.length > 0
          ? { tone: "warning", title: "A task is waiting for your approval", detail: "No mutating step runs until you review and approve the proposed task." }
          : !gitStatus
            ? { tone: "warning", title: "Git status is unavailable", detail: "Connect a repository to review changes, commits, and push state for this project." }
            : gitStatus.commitsBehind > 0
              ? { tone: "warning", title: "Branch is behind its upstream", detail: `${gitStatus.commitsBehind} commit${gitStatus.commitsBehind === 1 ? " is" : "s are"} waiting to be integrated before pushing.` }
              : { tone: "success", title: "Project is ready", detail: `${projectFiles.length.toLocaleString()} readable file${projectFiles.length === 1 ? "" : "s"} · ${gitStatus.changes.length} local change${gitStatus.changes.length === 1 ? "" : "s"}` };

  const openChangedFile = (path: string) => {
    if (projectFiles.some((file) => file.relativePath === path)) openFile(path);
    else {
      onLoadGitDiff([path]);
      setFilesChangesView("changes");
      openCodingPanePanel("files-changes");
    }
  };

  const fitWorkspace = () => {
    setWorkspaceView("chat");
    openCodingPanePanel("editor");
    setFileExplorerVisible(true);
    setTaskInspectorOpen(false);
    setTerminalOpen(false);
  };

  const updateSplitRatioFromPointer = (clientX: number, grid: Element) => {
    const bounds = grid.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = threadFirst ? (clientX - bounds.left) / bounds.width : (bounds.right - clientX) / bounds.width;
    const threadPercent = Math.min(70, Math.max(30, Math.round(ratio * 100)));
    setCodingSplitRatio({ projectId: selectedProject.id, threadPercent });
  };

  const beginSplitResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSplitResizeActive(true);
    const grid = event.currentTarget.closest(".coding-session-grid");
    if (grid) updateSplitRatioFromPointer(event.clientX, grid);
  };

  const moveSplitResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const grid = event.currentTarget.closest(".coding-session-grid");
    if (grid) updateSplitRatioFromPointer(event.clientX, grid);
  };

  const endSplitResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setSplitResizeActive(false);
  };

  const adjustSplitRatioByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const threadPercent = Math.min(70, Math.max(30, threadPanePercent + direction * (threadFirst ? 3 : -3)));
    setCodingSplitRatio({ projectId: selectedProject.id, threadPercent });
  };

  const requestCloseFileTab = (path: string) => {
    if (path === selectedFile && hasChanges) {
      setPendingCloseFile(path);
      return;
    }
    fileTabs.closeTab(path);
  };

  useEffect(() => {
    if (!pendingCloseFile || selectedFile !== pendingCloseFile || hasChanges || fileBusy) return;
    fileTabs.closeTab(pendingCloseFile);
    setPendingCloseFile(null);
  }, [fileBusy, fileTabs.closeTab, hasChanges, pendingCloseFile, selectedFile]);

  const renderFileExplorerPanel = (onSelectFile: (path: string) => void = openFile, allowHide = true) => <aside className={`project-file-explorer${allowHide ? "" : " is-standalone-files-page"}`} aria-label="Project files and changes">
    {allowHide && <div className="project-file-explorer-heading"><strong>Files</strong><Button variant="ghost" type="button" aria-label="Hide file explorer" title="Hide file explorer" onClick={() => setFileExplorerVisible(false)}>Hide</Button></div>}
    <ProjectScratchpad projectId={selectedProject.id} />
    <div className="file-list-toolbar"><input ref={fileSearchRef} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Filter files…" aria-label="Filter project files" /><kbd>Ctrl P</kbd></div>
    {gitStatus?.changes.length ? <details className="coding-explorer-changes" open>
      <summary><strong>Changed files</strong><span>{gitStatus.changes.length}</span></summary>
      <ul aria-label="Changed files">
        {filteredChanges.map((change) => {
          const fileName = change.path.replaceAll("\\", "/").split("/").at(-1) ?? change.path;
          const parentPath = change.path.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
          const status = change.status.trim() || "M";
          return <li key={`${status}-${change.path}`}><button className={`coding-explorer-change${selectedFile === change.path ? " is-selected" : ""}${fileTabs.tabs.includes(change.path) ? " is-open" : ""}`} type="button" onClick={() => openChangedFile(change.path)} title={change.path}>
            <span className="coding-explorer-change-name">{fileName}</span><small>{parentPath || selectedProject.name}</small><b aria-label={`Change status ${status}`} title={status}>{status}</b>
          </button></li>;
        })}
        {!filteredChanges.length && <li className="coding-explorer-empty">No matching changed files.</li>}
      </ul>
    </details> : <div className="coding-explorer-changes is-clean"><strong>Changed files</strong><span>{gitStatus ? "No local changes" : "Git status unavailable"}</span></div>}
    <section className="coding-explorer-project-files" aria-label="Project file tree"><div className="coding-explorer-section-heading"><strong>Project files</strong><span>{filteredFiles.length}</span></div>
      {projectFiles.length === 0 ? <EmptyState title="No readable files" description="Protected names and unsupported files are hidden." /> : filteredFiles.length === 0 ? <EmptyState title="No matching files" description="Try a shorter path or filename." /> : <ProjectFileTree key={selectedProject.id} projectId={selectedProject.id} files={filteredFiles} query={fileQuery} selectedFile={selectedFile} onOpenFile={onSelectFile} onAddToContext={addFileToComposerContext} onCompareWithChat={compareFileWithChat} onStartReview={startFileReview} />}
    </section>
  </aside>;

  const paneTabHost = document.getElementById("coding-secondary-tab-group");

  return <>
    {paneTabHost ? createPortal(<CodingPaneTabs pages={codingPanePages} activePageId={activeCodingPanePageId} changeCount={gitStatus?.changes.length ?? 0} contextLabel={`Project tools for ${selectedProject.name} · current thread`} isSplitOpen={codingSplitOpen} onSelect={(page) => { codingPane.selectPage(page); if (page.filePath) openFile(page.filePath); }} onClose={codingPane.closePage} onReorder={codingPane.reorderPage} onOpenPanel={openCodingPanePanel} onApplyPreset={applyCodingPanePreset} onCloseSplit={codingPane.closeSplitView} />, paneTabHost) : null}
    <div className="coding-project-context" aria-label="Project status"><div className={`git-summary${gitStatus?.hasConflicts ? " has-conflicts" : ""}`} aria-live="polite"><strong>{gitStatus ? gitStatus.branch : "Git status unavailable"}</strong><span>{gitStatus ? `${gitStatus.changes.length} change${gitStatus.changes.length === 1 ? "" : "s"}${gitStatus.hasConflicts ? " · conflicts" : ""}` : "Connect a Git repository to inspect changes"}</span></div><div className="coding-project-context-actions"><OverflowMenu label="Project actions" icon={<NavIcon name="more" />} items={[{ label: "Open activity", onSelect: () => { setInspectorTab("activity"); setWorkspaceView("chat"); setTaskInspectorOpen(true); } }, { label: "Open terminal", onSelect: () => { setInspectorTab("terminal"); setWorkspaceView("chat"); setTaskInspectorOpen(true); } }, { label: "New coding thread", onSelect: onNewWorkspaceTab }, { label: preflightBusy ? "Scanning project…" : "Run preflight", disabled: preflightBusy, onSelect: () => void runPreflight() }, { label: gitBusy ? "Refreshing Git…" : "Refresh Git status", disabled: gitBusy, onSelect: onRefreshGitStatus }]} /></div></div>
    <div className={`coding-health-banner is-${health.tone}`} role={health.tone === "danger" ? "alert" : "status"}><NavIcon name="activity" /><div><strong>{health.title}</strong><span>{health.detail}</span></div>{health.tone === "warning" && !gitStatus && selectedProject.folderPaths.length > 0 && <Button variant="secondary" type="button" disabled={gitBusy} onClick={onRefreshGitStatus}>{gitBusy ? "Checking…" : "Check Git"}</Button>}{health.tone === "danger" && gitStatus?.hasConflicts && <Button variant="secondary" type="button" onClick={() => { setInspectorTab("changes"); setWorkspaceView("files"); setTaskInspectorOpen(true); }}>Open changes</Button>}{health.tone === "danger" && !gitStatus?.hasConflicts && <Button variant="secondary" type="button" onClick={() => { setInspectorTab("activity"); setWorkspaceView("chat"); setTaskInspectorOpen(true); }}>Open activity</Button>}</div>
    {(preflight || preflightMessage) && <Card className="project-preflight" aria-label="Project preflight results"><div className="panel-heading"><div><p className="section-kicker">LOCAL PREFLIGHT</p><h3>{preflight ? "Project setup" : "Preflight status"}</h3></div><Button variant="ghost" onClick={() => { setPreflight(null); setPreflightMessage(""); }}>Dismiss</Button></div>{preflightMessage && <p role="status">{preflightMessage}</p>}{preflight && <><p>{preflight.manifests.length ? `Detected ${preflight.manifests.join(", ")}.` : "No supported dependency manifest was detected at the selected folder roots."}</p>{preflight.runtimes.length > 0 && <ul className="project-preflight-runtimes">{preflight.runtimes.map((runtime) => <li key={runtime.name}><strong>{runtime.name}</strong><span>{runtime.available ? "Available" : "Required runtime not found on PATH"}</span></li>)}</ul>}{preflight.suggestedChecks.length > 0 && <><strong>Suggested checks (not run)</strong><ul className="project-preflight-checks">{preflight.suggestedChecks.map((command) => <li key={command}><code>{command}</code></li>)}</ul></>}<small>{preflight.executionNote}</small></>}</Card>}
    {snapshotMode && <div className="coding-snapshot-notice" role="status"><NavIcon name="document" /><div><strong>Read-only project snapshot</strong><span>Files, previews, and diffs are available for review. Saving edits and terminal commands are disabled.</span></div><Button variant="secondary" type="button" onClick={() => setSnapshotMode(false)}>Exit snapshot</Button></div>}
    <div className={`coding-session-grid is-${workspaceView}${codingSplitOpen ? " is-split-open" : ""}${threadFirst && codingSplitOpen ? " is-thread-first" : ""}${panelMode === "diff" ? " is-reviewing-diff" : ""}${workspaceView === "files" && gitDiff ? " is-reviewing-git" : ""}${focusLayout ? " is-focus-layout" : ""}`} data-project-id={selectedProject.id} data-workspace-tab-id={workspaceTabId} data-conversation-id={conversationId ?? ""} style={{ "--coding-thread-pane-size": `${threadPanePercent}%` } as CSSProperties}>
      {codingSplitOpen && <button className={`coding-split-resizer${splitResizeActive ? " is-resizing" : ""}`} type="button" role="separator" aria-orientation="vertical" aria-label="Resize conversation and workspace panes" aria-valuemin={30} aria-valuemax={70} aria-valuenow={threadPanePercent} title="Drag or use the arrow keys to resize the split" onPointerDown={beginSplitResize} onPointerMove={moveSplitResize} onPointerUp={endSplitResize} onPointerCancel={endSplitResize} onKeyDown={adjustSplitRatioByKeyboard} />}
      <Card id="coding-files-workspace" role="tabpanel" className={`project-browser-card coding-project-browser is-${workspacePanel}-panel${workspacePanel === "files-changes" ? ` is-${filesChangesView}-view` : ""}${workspacePanel === "editor" && !fileExplorerVisible ? " is-file-explorer-hidden" : ""}${workspacePanel === "editor" && !selectedFile ? " is-empty-editor" : ""}`}>
      <div className="panel-heading">
        <div><p className="section-kicker">{workspacePanel === "editor" ? "PROJECT EDITOR" : workspacePanel === "side-chat" ? "CODING AGENT" : workspacePanel === "files-changes" ? "PROJECT FILES & GIT CHANGES" : workspacePanel === "scratchpad" ? "PROJECT NOTES" : "LOCAL PREVIEW"}</p><h3>{workspacePanel === "editor" ? "Editor" : workspacePanel === "side-chat" ? "Side chat" : workspacePanel === "files-changes" ? "Files & Changes" : workspacePanel === "scratchpad" ? "Scratchpad" : "Preview"}</h3></div>
        <div className="project-browser-actions">
          {workspacePanel === "files-changes" && <div className="coding-files-changes-switch" role="group" aria-label="Files and changes view"><Button type="button" variant={filesChangesView === "files" ? "secondary" : "ghost"} aria-pressed={filesChangesView === "files"} onClick={() => setFilesChangesView("files")}>Files</Button><Button type="button" variant={filesChangesView === "changes" ? "secondary" : "ghost"} aria-pressed={filesChangesView === "changes"} onClick={() => setFilesChangesView("changes")}>Changes{gitStatus?.changes.length ? ` · ${gitStatus.changes.length}` : ""}</Button></div>}
          {workspacePanel === "editor" && <><Button variant={focusLayout ? "secondary" : "ghost"} type="button" aria-pressed={focusLayout} title="Temporarily hide project details and secondary panes" onClick={() => setFocusLayout((focused) => !focused)}>{focusLayout ? "Exit focus" : "Focus layout"}</Button><Button variant="ghost" type="button" title="Restore the default thread and editor layout" onClick={fitWorkspace}>Fit workspace</Button><Button variant="ghost" type="button" aria-pressed={threadFirst} className="coding-layout-swap" title="Swap the conversation and editor sides" onClick={() => setCodingLayout({ projectId: selectedProject.id, threadFirst: !threadFirst })}>Swap sides</Button><Button variant={snapshotMode ? "secondary" : "ghost"} type="button" aria-pressed={snapshotMode} title="Inspect this project without saving edits or running terminal commands" onClick={() => setSnapshotMode((enabled) => !enabled)}>{snapshotMode ? "Snapshot on" : "Snapshot"}</Button><Button variant={fileExplorerVisible ? "secondary" : "ghost"} type="button" aria-pressed={fileExplorerVisible} aria-label={fileExplorerVisible ? "Hide file explorer" : "Show file explorer"} onClick={() => setFileExplorerVisible((visible) => !visible)}>{fileExplorerVisible ? "Hide files" : "Show files"}</Button><Button variant="ghost" type="button" aria-controls="coding-project-scratchpad" onClick={() => openCodingPanePanel("scratchpad")}>Scratchpad</Button><Button variant="ghost" type="button" aria-controls="coding-local-preview" onClick={() => openCodingPanePanel("preview")}>Preview</Button></>}
          {workspacePanel !== "side-chat" && <Button variant={terminalOpen ? "secondary" : "ghost"} disabled={snapshotMode} aria-pressed={terminalOpen} onClick={() => setTerminalOpen((open) => !open)}>{terminalOpen ? "Hide terminal" : "Show terminal"}</Button>}
        </div>
      </div>
      {workspacePanel === "scratchpad" && <section id="coding-project-scratchpad" className="coding-project-scratchpad" aria-label={`Project scratchpad for ${selectedProject.name}`}><div className="coding-project-scratchpad-heading"><strong>Project scratchpad</strong><span>{scratchpadText.trim() ? "Saved locally" : "Notes stay on this device"}</span></div><textarea value={scratchpadText} onChange={(event) => setScratchpadText(event.target.value)} placeholder="Capture decisions, commands, links, or follow-ups…" aria-label="Project scratchpad" /></section>}
      {workspacePanel === "preview" && <section id="coding-local-preview" className="coding-local-preview" aria-label="Local project preview"><div className="coding-local-preview-heading"><div><strong>Local project preview</strong><span>Inspect the running project</span></div></div><BrowserPreview key={selectedProject.id} projectId={selectedProject.id} /></section>}
      {fileSummary && workspacePanel === "editor" && <p className="file-summary">{fileSummary}</p>}
      {workspacePanel === "side-chat" && <CodingSideChat projectId={selectedProject.id} conversationId={conversationId} tasks={tasks} busy={tasks.some((task) => task.projectId === selectedProject.id && task.conversationId === conversationId && task.title.startsWith("Side chat · ") && ["queued", "running", "verifying"].includes(task.status))} onStart={onStartSubagent} onCancel={onCancelTask} onOpenFile={openFilePage} />}
      {workspacePanel === "files-changes" && filesChangesView === "files" && renderFileExplorerPanel(openFilePage, false)}
      {workspacePanel === "files-changes" && filesChangesView === "changes" && gitStatus && <div className={`git-change-summary${gitStatus.hasConflicts ? " has-conflicts" : ""}`} aria-label="Local Git changes"><div><p className="section-kicker">LOCAL GIT REVIEW</p><strong>{gitStatus.changes.length ? `${gitStatus.changes.length} changed file${gitStatus.changes.length === 1 ? "" : "s"}` : "Working tree clean"}</strong><span>{gitStatus.commitsAhead} ahead · {gitStatus.commitsBehind} behind · {gitStatus.repository}</span></div>{gitStatus.changes.length > 0 && <ul className="git-change-list">{gitStatus.changes.map((change) => <li key={`${change.status}-${change.path}`}><label><input type="checkbox" checked={selectedGitPaths.includes(change.path)} onChange={(event) => setSelectedGitPaths((current) => event.target.checked ? [...current, change.path] : current.filter((path) => path !== change.path))} /><b>{change.status}</b><span>{change.path}</span></label></li>)}</ul>}{gitStatus.changes.length > 8 && <small>Showing all {gitStatus.changes.length} changes. Review and commit are bounded to 24 files per operation.</small>}{gitStatus.hasConflicts && <small role="alert">Conflicts need review before any commit workflow can proceed.</small>}{gitStatus.changes.length > 0 && <div className="git-review-actions"><Button variant="ghost" onClick={() => setSelectedGitPaths(gitStatus.changes.map((change) => change.path))}>Select all</Button><Button variant="ghost" onClick={() => setSelectedGitPaths([])}>Clear selection</Button><Button variant="secondary" disabled={gitDiffBusy || gitStatus.hasConflicts || !selectedGitPaths.length} onClick={() => onLoadGitDiff(selectedGitPaths)}>{gitDiffBusy ? "Loading diff…" : gitDiff ? "Refresh diff" : "Review diff"}</Button><input value={gitMessage} onChange={(event) => setGitMessage(event.target.value)} aria-label="Local Git commit message" maxLength={256} placeholder="Commit message" /><Button variant="primary" disabled={gitCommitBusy || gitStatus.hasConflicts || !gitMessage.trim() || !commitSelection.paths.length} onClick={() => void onCommitGitChanges(gitMessage, commitSelection.paths, Object.keys(commitSelection.hunks).length ? commitSelection.hunks : undefined)}>{gitCommitBusy ? "Committing…" : `Commit ${commitSelection.paths.length} selected${Object.keys(commitSelection.hunks).length ? " · selected hunks" : ""}`}</Button></div>}{gitDiff && <GitDiffReview projectId={selectedProject.id} diff={gitDiff.text} changes={gitStatus?.changes ?? []} selectedPaths={selectedGitPaths} onTogglePath={(path, included) => setSelectedGitPaths((current) => included ? [...new Set([...current, path])] : current.filter((item) => item !== path))} selectedHunks={selectedGitHunks} onSelectedHunksChange={setSelectedGitHunks} onSendReview={onSendReview} projectChecks={projectChecks} onOpenFile={openFilePage} />}</div>}
      {workspacePanel === "files-changes" && filesChangesView === "changes" && !gitStatus && <p className="coding-change-empty" role="status">Git status is unavailable. Connect a Git repository or refresh its status to review project changes.</p>}
      {workspacePanel === "files-changes" && filesChangesView === "changes" && gitStatus && gitStatus.changes.length === 0 && gitStatus.commitsAhead > 0 && <div className="git-review-actions"><span className="settings-help">Clean working tree · push uses the configured local Git credential helper.</span><Button variant="primary" disabled={gitPushBusy || gitStatus.commitsBehind > 0} onClick={() => void onPushGitChanges()}>{gitPushBusy ? "Pushing…" : "Push local commits"}</Button><Button variant="secondary" disabled={gitPullRequestBusy || gitStatus.commitsBehind > 0} onClick={() => setPullRequestOpen(true)}>{gitPullRequestBusy ? "Opening PR…" : "Create pull request"}</Button></div>}
       {workspacePanel === "editor" && <div className={`project-file-layout${fileExplorerVisible ? "" : " is-file-explorer-hidden"}`}>
        <div className="file-editor-panel">
      {fileTabs.tabs.length > 0 && <div className="file-tabs" role="tablist" aria-orientation="horizontal" aria-label="Open project files">{fileTabs.tabs.map((path, index) => <div className={`file-tab ${selectedFile === path ? "is-active" : ""}`} key={path} draggable onDragStart={(event) => { event.dataTransfer.setData("text/skai-file-tab", path); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const sourcePath = event.dataTransfer.getData("text/skai-file-tab"); if (sourcePath) fileTabs.reorderTab(sourcePath, path); }} onAuxClick={(event) => { if (event.button === 1) requestCloseFileTab(path); }}><button id={`coding-file-tab-${index}`} type="button" role="tab" tabIndex={selectedFile === path || (!selectedFile && index === 0) ? 0 : -1} aria-label={`${path}${selectedFile === path && hasChanges ? " · unsaved changes" : ""}`} title={path} aria-selected={selectedFile === path} aria-controls="coding-file-editor" onClick={() => openFile(path)} onKeyDown={(event) => fileTabs.onTabKeyDown(event, index)}><span>{path}</span>{selectedFile === path && hasChanges ? <i aria-label="Unsaved changes">•</i> : null}</button><button className="file-tab-close" type="button" onClick={() => requestCloseFileTab(path)} aria-label={`Close ${path}`}>×</button></div>)}</div>}
          {selectedFile ? <>{selectedKind === "text" || selectedKind === "svg" ? <><div id="coding-file-editor" className="file-editor-heading"><div className="file-editor-heading-copy"><small>{selectedProject.name} / Files / {selectedFile}</small><span>{selectedFile} · {languageForPath(selectedFile)}</span><Button variant="ghost" type="button" title="Show this file in the project tree" onClick={() => { const editorWidth = document.querySelector(".coding-project-browser.is-editor-panel")?.getBoundingClientRect().width ?? Infinity; setFileExplorerVisible(true); setFileQuery(selectedFile); if (editorWidth <= 620) { setFilesChangesView("files"); openCodingPanePanel("files-changes"); } window.requestAnimationFrame(() => { fileSearchRef.current?.focus(); fileSearchRef.current?.select(); }); }}>Reveal in tree</Button></div><div><Button variant={panelMode === "editor" ? "secondary" : "ghost"} onClick={() => setPanelMode("editor")}>Editor</Button>{(selectedFile.toLowerCase().endsWith(".html") || selectedFile.toLowerCase().endsWith(".svg") || selectedFile.toLowerCase().endsWith(".md") || selectedFile.toLowerCase().endsWith(".markdown")) && <Button variant={panelMode === "preview" ? "secondary" : "ghost"} onClick={() => setPanelMode("preview")}>Preview</Button>}<Button variant={panelMode === "diff" ? "secondary" : "ghost"} disabled={!hasChanges} onClick={() => setPanelMode("diff")}>Review diff</Button><Button variant="ghost" disabled={fileBusy || !fileUndoAvailable} title={fileUndoAvailable ? "Undo the last saved edit" : "No saved edit to undo"} onClick={onUndoFile}>Undo</Button><Button variant="primary" disabled={fileBusy || !hasChanges} onClick={onSaveFile}>{fileBusy ? "Saving…" : "Save edit"}</Button></div></div>{panelMode === "preview" ? selectedFile.toLowerCase().endsWith(".md") || selectedFile.toLowerCase().endsWith(".markdown") ? <div className="project-markdown-preview-scroll"><MarkdownPreview source={fileDraft} /></div> : <iframe className={selectedFile.toLowerCase().endsWith(".svg") ? "project-svg-preview-frame" : "project-html-preview-frame"} title={`Preview ${selectedFile}`} sandbox="" srcDoc={fileDraft} /> : panelMode === "diff" ? <div className="coding-diff-preview" role="table" aria-label="Local file side-by-side comparison"><div className="coding-diff-header" role="row"><span role="columnheader">Original</span><span role="columnheader">Working copy · {reviewRows.filter((row) => row.kind === "added").length} additions · {reviewRows.filter((row) => row.kind === "removed").length} removals</span></div><div className="coding-diff-lines">{splitReviewRows.map((row, index) => <div className="coding-diff-line" role="row" key={`split-${index}`}>{[row.original, row.working].map((side, sideIndex) => <div className={`coding-diff-cell is-${side?.kind ?? "empty"}`} role="cell" key={sideIndex}><span className="coding-diff-number">{side ? sideIndex === 0 ? side.oldLine ?? "" : side.newLine ?? "" : ""}</span><span className="coding-diff-marker" aria-hidden="true">{side?.kind === "removed" ? "−" : side?.kind === "added" ? "+" : " "}</span><code>{side?.text || " "}</code></div>)}</div>)}</div></div> : <div className="monaco-editor-shell" aria-label={`Edit ${selectedFile}`}><Editor path={monacoFileModelPath(selectedProject.id, selectedFile)} value={fileDraft} language={languageForPath(selectedFile)} theme={monacoTheme.theme} beforeMount={monacoTheme.beforeMount} onChange={(value) => onDraftChange(value ?? "")} options={{ automaticLayout: true, ...monacoTheme.fontOptions, folding: true, lineNumbers: "on", minimap: { enabled: true }, padding: { top: 12, bottom: 12 }, scrollBeyondLastLine: false, tabSize: 2, wordWrap: "off" }} /></div>}</> : <div className="project-file-preview">{filePreview ? filePreview.kind === "image" ? <img src={`data:${filePreview.mediaType};base64,${filePreview.content}`} alt={selectedFile} /> : filePreview.mediaType === "application/pdf" ? <><div className="project-pdf-preview-label">PDF rendered locally · original file stays in the project</div><iframe className="project-pdf-preview-frame" title={`Preview ${selectedFile}`} sandbox="" src={`data:application/pdf;base64,${filePreview.content}`} /></> : <><div className="project-pdf-preview-label">Selectable text extracted locally · original PDF stays in the project</div><pre>{filePreview.content || "No selectable text was found in this PDF."}</pre></> : <p aria-live="polite">{filePreviewError ? `Preview unavailable: ${filePreviewError}` : "Loading safe preview…"}</p>}</div>}</> : <div className="coding-editor-empty-state"><strong>Select a file to begin</strong><span>Open a project file from the Files panel, or press Ctrl+P to search by name.</span><Button variant="secondary" type="button" onClick={() => { setFileExplorerVisible(true); fileSearchRef.current?.focus(); }}>Browse project files</Button></div>}
        </div>
        {fileExplorerVisible && renderFileExplorerPanel(openFile)}
      </div>}
      {terminalOpen && <div className="project-dock"><TerminalPanel projects={projects} initialProjectId={selectedProject.id} busy={terminalBusy} output={terminalOutput} exitCode={terminalExitCode} compact onRun={onRunTerminal} /></div>}
      </Card>{conversation && <div id="coding-chat-workspace" role="tabpanel" hidden={workspaceView !== "chat"} className="project-thread-panel">{conversation}</div>}{taskInspectorOpen && <section id="coding-task-inspector-drawer" className="coding-task-drawer" aria-label="Project workspace panel"><header><div><p className="section-kicker">PROJECT WORKSPACE</p><strong>{inspectorTab === "sources" ? "Sources" : inspectorTab === "changes" ? "Changes" : inspectorTab === "activity" ? "Activity" : "Terminal"}</strong></div><button type="button" aria-label="Close project panel" onClick={() => setTaskInspectorOpen(false)}>×</button></header><div className="coding-inspector-tabs" role="tablist" aria-label="Project panel"><button type="button" role="tab" aria-selected={inspectorTab === "sources"} onClick={() => setInspectorTab("sources")}>Sources <span>{messages.reduce((total, message) => total + (message.attachments?.length ?? 0), 0)}</span></button><button type="button" role="tab" aria-selected={inspectorTab === "changes"} onClick={() => setInspectorTab("changes")}>Changes <span>{gitStatus?.changes.length ?? 0}</span></button><button type="button" role="tab" aria-selected={inspectorTab === "activity"} onClick={() => setInspectorTab("activity")}>Activity <span>{tasks.length}</span></button><button type="button" role="tab" aria-selected={inspectorTab === "terminal"} onClick={() => setInspectorTab("terminal")}>Terminal</button></div>{inspectorTab === "sources" ? <div className="coding-source-inspector">{messages.flatMap((message, messageIndex) => (message.attachments ?? []).map((attachment) => <article key={`${messageIndex}-${attachment.fileName}`}><strong>{attachment.fileName}</strong><span>Attached to the conversation</span></article>))}{messages.flatMap((message) => [...message.content.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0])).filter((url, index, urls) => urls.indexOf(url) === index).map((url) => <article key={url}><strong>{url}</strong><span>Referenced in the conversation</span></article>)}{messages.every((message) => !message.attachments?.length && !/https?:\/\//.test(message.content)) && <p className="coding-change-empty">Files and links attached to this conversation will appear here.</p>}</div> : inspectorTab === "changes" ? <div className="coding-change-inspector"><div className="coding-change-inspector-summary"><div><strong>{gitStatus?.changes.length ? `${gitStatus.changes.length} changed files` : gitStatus ? "Working tree clean" : "Git unavailable"}</strong><small>{gitStatus ? `${gitStatus.branch} · ${gitStatus.commitsAhead} ahead · ${gitStatus.commitsBehind} behind` : "Connect a Git repository to inspect changes."}</small></div>{gitStatus?.changes.length ? <Button variant="secondary" disabled={gitDiffBusy || gitStatus.hasConflicts} onClick={() => onLoadGitDiff(selectedGitPaths.length ? selectedGitPaths : undefined)}>{gitDiffBusy ? "Loading…" : gitDiff ? "Refresh diff" : "Review diff"}</Button> : null}</div><ReviewChecklist projectId={selectedProject.id} branch={gitStatus?.branch ?? "unknown"} />{gitStatus?.hasConflicts && <p className="coding-change-warning" role="alert">Resolve merge conflicts before committing.</p>}{gitStatus?.changes.length ? <ul className="coding-change-file-list">{gitStatus.changes.map((change) => <li key={`${change.status}-${change.path}`}><button type="button" onClick={() => openFilePage(change.path)} title={`Open ${change.path}`}><b>{change.status}</b><span>{change.path}</span></button><input type="checkbox" aria-label={`Include ${change.path} in commit`} checked={selectedGitPaths.includes(change.path)} onChange={(event) => setSelectedGitPaths((current) => event.target.checked ? [...current, change.path] : current.filter((path) => path !== change.path))} /></li>)}</ul> : <p className="coding-change-empty">Changes Skai makes in this project will appear here for review.</p>}{gitDiff && <GitDiffReview projectId={selectedProject.id} diff={gitDiff.text} changes={gitStatus?.changes ?? []} selectedPaths={selectedGitPaths} onTogglePath={(path, included) => setSelectedGitPaths((current) => included ? [...new Set([...current, path])] : current.filter((item) => item !== path))} selectedHunks={selectedGitHunks} onSelectedHunksChange={setSelectedGitHunks} onSendReview={onSendReview} />}</div> : inspectorTab === "activity" ? <CodingTaskInspector projectId={selectedProject.id} tasks={tasks} models={models} projectChecks={projectChecks} projectChecksBusy={projectChecksBusy} projectCheckBusy={projectCheckBusy} gitStatus={gitStatus} gitDiffReady={Boolean(gitDiff)} gitDiffBusy={gitDiffBusy} onLoadProjectChecks={onLoadProjectChecks} onRunProjectCheck={onRunProjectCheck} onCancelTask={onCancelTask} onTransitionTask={onTransitionTask} onSteerTask={onSteerTask} onDelegateTask={onDelegateTask} onOpenTaskWorktree={onOpenTaskWorktree} onPlanTask={onPlanTask} onExecuteTask={onExecuteTask} onReviewChanges={onLoadGitDiff} /> : <div className="coding-terminal-inspector"><TerminalPanel projects={projects} initialProjectId={selectedProject.id} busy={terminalBusy} output={terminalOutput} exitCode={terminalExitCode} compact onRun={onRunTerminal} /></div>}</section>}</div>
    <ModalDialog open={Boolean(pendingCloseFile)} onClose={() => setPendingCloseFile(null)} titleId="close-unsaved-file-title"><section className="coding-unsaved-close-dialog"><div className="dialog-heading"><div><p className="section-kicker">UNSAVED FILE</p><h3 id="close-unsaved-file-title">Save changes to {pendingCloseFile?.split(/[\\/]/).at(-1)}?</h3><p>Your edits are still a draft. Save them before closing this file tab, or discard the draft.</p></div></div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setPendingCloseFile(null)}>Keep editing</Button><Button variant="secondary" type="button" disabled={fileBusy} onClick={() => { if (pendingCloseFile) { onDraftChange(fileOriginal); fileTabs.closeTab(pendingCloseFile); } setPendingCloseFile(null); }}>Discard draft and close</Button><Button variant="primary" type="button" disabled={fileBusy} onClick={onSaveFile}>Save</Button></div></section></ModalDialog>
    <ModalDialog open={pullRequestOpen} onClose={() => setPullRequestOpen(false)} titleId="create-pull-request-title"><form onSubmit={(event) => { event.preventDefault(); void onCreateGitPullRequest(pullRequestTitle, pullRequestBody, pullRequestDraft).then((created) => { if (created) setPullRequestOpen(false); }); }}><div className="dialog-heading"><div><p className="section-kicker">GITHUB WORKFLOW</p><h3 id="create-pull-request-title">Create pull request</h3><p>Uses the repository default branch and the local GitHub CLI session. No token is entered into Skai Desktop.</p></div><button type="button" onClick={() => setPullRequestOpen(false)} aria-label="Close dialog">×</button></div><label>Title<input value={pullRequestTitle} onChange={(event) => setPullRequestTitle(event.target.value)} maxLength={256} /></label><label>Description<textarea value={pullRequestBody} onChange={(event) => setPullRequestBody(event.target.value)} maxLength={16000} rows={6} /></label><label className="coding-pr-draft-toggle"><input type="checkbox" checked={pullRequestDraft} onChange={(event) => setPullRequestDraft(event.target.checked)} />Create as draft</label><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setPullRequestOpen(false)}>Cancel</Button><Button variant="primary" type="submit" disabled={gitPullRequestBusy || !pullRequestTitle.trim()}>{gitPullRequestBusy ? "Creating…" : pullRequestDraft ? "Create draft pull request" : "Create pull request"}</Button></div></form></ModalDialog>
  </>;
}
