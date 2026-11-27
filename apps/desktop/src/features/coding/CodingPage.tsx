import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DesktopGitDiff, DesktopGitStatus, DesktopHarnessAdapter, DesktopProject, DesktopProjectActivityEvent, DesktopProjectCheck, DesktopProjectFile, DesktopProjectPreflight, DesktopProjectPreview, DesktopTask, DesktopTaskWorkerDraft } from "../../../shared/contracts";
import type { Route } from "../../app/types";
import type { Message } from "../../app/types";
import type { Model } from "../../app/types";
import { Button, EmptyState, PageHeader } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { NavIcon } from "../../components/ui/NavIcon";
import { CodingSessionView } from "./CodingSessionView";
import "./CodingProjectOverview.css";

type CodingPageProps = {
  conversation?: ReactNode;
  messages: Message[];
  sideChatRequest: number;
  onNewWorkspaceTab: () => void;
  onNewProjectThread: (project: DesktopProject) => void;
  onStartSubagent: (projectId: string, instruction: string) => Promise<string | null>;
  projectDirectory?: boolean;
  projects: DesktopProject[];
  tasks: DesktopTask[];
  harnessAdapters: DesktopHarnessAdapter[];
  onRefreshHarnessAdapters: (probe?: boolean) => Promise<DesktopHarnessAdapter[]>;
  models: Model[];
  selectedModel: string;
  onModelChange?: (model: Model) => void;
  selectedProject: DesktopProject | null;
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
  projectActivity: DesktopProjectActivityEvent[];
  projectActivityBusy: boolean;
  onLoadProjectActivity: (projectId?: string) => void;
  onRefreshGitStatus: () => void;
  onLoadGitDiff: (paths?: string[]) => void;
  onCommitGitChanges: (message: string, paths?: string[], hunks?: Record<string, number[]>) => Promise<boolean>;
  onSendReview: (prompt: string) => void;
  onPushGitChanges: () => Promise<boolean>;
  onCreateGitPullRequest: (title: string, body: string, draft?: boolean) => Promise<boolean>;
  onPickFolder: () => Promise<string | null>;
  onSaveProject: (name: string, instructions: string, folders: string[], id?: string) => Promise<DesktopProject | null>;
  onOpenProject: (project: DesktopProject) => void;
  onOpenFile: (relativePath: string) => void;
  onCloseFile: () => void;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onUndoFile: () => void;
  onRunTerminal: (projectId: string, command: string, cwd: string) => void;
  onRunProjectPreflight: (projectId: string) => Promise<DesktopProjectPreflight | null>;
  onNavigate: (route: Route) => void;
  onLoadProjectChecks: (projectId?: string) => void;
  onRunProjectCheck: (projectId: string, taskId: string, checkId: string) => Promise<unknown>;
  onCancelTask: (taskId: string) => void;
  onTransitionTask: (taskId: string, operation: "queue" | "approve" | "deny" | "retry" | "release") => void;
  onSteerTask: (taskId: string, instruction: string) => Promise<boolean>;
  onDelegateTask: (parentId: string, workers: DesktopTaskWorkerDraft[]) => Promise<boolean>;
  onOpenTaskWorktree: (taskId: string) => Promise<boolean>;
  onPlanTask: (title: string, instruction: string, environment: "local" | "worktree", conversationId?: string | null, requiresApproval?: boolean, projectId?: string | null) => Promise<boolean>;
  onExecuteTask: (taskId: string) => void;
};

function ProjectActivityTimeline({ projectId, projectName, tasks, events, busy, onRefresh }: { projectId: string; projectName: string; tasks: DesktopTask[]; events: DesktopProjectActivityEvent[]; busy: boolean; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const titleId = `project-activity-title-${useId().replaceAll(":", "")}`;
  const visibleEvents = events.filter((event) => event.type !== "run.created").slice(0, 8);
  const labelFor = (type: string) => ({
    "project.git.commit.completed": "Committed changes",
    "project.git.push.completed": "Pushed commits",
    "project.git.pull_request.created": "Created pull request",
    "project.check.passed": "Project check passed",
    "project.check.failed": "Project check failed",
    "task.created": "Task proposed",
    "task.status.changed": "Task status changed",
  } as Record<string, string>)[type] ?? type.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const detailFor = (event: DesktopProjectActivityEvent) => {
    const task = tasks.find((entry) => entry.id === event.runId);
    const payload = event.payload;
    const detail = payload.checkLabel ?? payload.title ?? payload.commitMessage ?? (payload.fileCount ? `${payload.fileCount} files` : null) ?? payload.toStatus ?? payload.status ?? "";
    return [task?.title, detail].filter(Boolean).join(" · ") || "Project-level activity";
  };
  return <><Button variant="ghost" onClick={() => setOpen(true)} aria-haspopup="dialog">Activity{visibleEvents.length ? ` · ${visibleEvents.length}` : ""}</Button>
    <ModalDialog open={open} onClose={() => setOpen(false)} titleId={titleId}><section className="coding-project-activity-modal" aria-label="Project activity">
      <header><div><p className="section-kicker">PROJECT JOURNAL · {projectName}</p><h2 id={titleId}>Recent activity</h2><span>Task, check, commit, push, and pull request events saved locally for this project.</span></div><div className="coding-project-activity-actions"><Button variant="secondary" disabled={busy} onClick={onRefresh}>{busy ? "Refreshing…" : "Refresh"}</Button><Button variant="ghost" aria-label="Close activity" onClick={() => setOpen(false)}>×</Button></div></header>
      {visibleEvents.length ? <ol>{visibleEvents.map((event) => <li key={event.eventId}><span className={`coding-activity-marker ${event.type.includes("failed") ? "is-failed" : event.type.includes("passed") ? "is-success" : ""}`} aria-hidden="true" /><div><strong>{labelFor(event.type)}</strong><small>{detailFor(event)}</small></div><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time></li>)}</ol> : <p className="coding-project-activity-empty">{busy ? "Loading recorded activity…" : "No recorded task or Git activity for this project yet."}</p>}
    </section></ModalDialog>
  </>;
}

function CodingProjectOverview({ project, tasks, files, gitStatus, checks, activity, onNewThread, onReview, onOpenTerminal, onRefreshGit }: {
  project: DesktopProject;
  tasks: DesktopTask[];
  files: DesktopProjectFile[];
  gitStatus: DesktopGitStatus | null;
  checks: DesktopProjectCheck[];
  activity: DesktopProjectActivityEvent[];
  onNewThread: () => void;
  onReview: () => void;
  onOpenTerminal: () => void;
  onRefreshGit: () => void;
}) {
  const activeTasks = tasks.filter((task) => ["running", "verifying", "queued", "awaiting_approval"].includes(task.status));
  const failedChecks = activity.filter((event) => event.type === "project.check.failed");
  const recentActivity = activity.filter((event) => event.type !== "run.created").slice(0, 3);
  const activityLabel = (event: DesktopProjectActivityEvent) => ({
    "project.git.commit.completed": "Committed changes",
    "project.git.push.completed": "Pushed commits",
    "project.git.pull_request.created": "Created pull request",
    "project.check.passed": "Check passed",
    "project.check.failed": "Check failed",
    "task.created": "Task proposed",
    "task.status.changed": "Task status changed",
  } as Record<string, string>)[event.type] ?? "Project activity";
  return <section className="coding-project-overview" aria-label={`${project.name} project home`}>
    <div className="coding-project-overview-heading">
      <div><p className="section-kicker">PROJECT HOME</p><h2>{project.name}</h2><p>Keep the current work, local tools, and next action in one view.</p></div>
      <span className={`coding-project-health ${failedChecks.length || gitStatus?.hasConflicts ? "is-attention" : "is-ready"}`}>{failedChecks.length || gitStatus?.hasConflicts ? "Needs attention" : activeTasks.length ? `${activeTasks.length} active` : "Ready"}</span>
    </div>
    <div className="coding-project-metrics" role="list" aria-label="Project summary">
      <div role="listitem"><strong>{tasks.length}</strong><span>Tasks</span><small>{activeTasks.length ? `${activeTasks.length} active` : "No active tasks"}</small></div>
      <div role="listitem"><strong>{files.length}</strong><span>Files</span><small>{project.folderPaths.length} connected folder{project.folderPaths.length === 1 ? "" : "s"}</small></div>
      <div role="listitem"><strong>{gitStatus?.changes.length ?? "—"}</strong><span>Changes</span><small>{gitStatus?.branch ?? "Git unavailable"}</small></div>
      <div role="listitem"><strong>{checks.length}</strong><span>Checks</span><small>{failedChecks.length ? `${failedChecks.length} failing` : "No failures reported"}</small></div>
    </div>
    <div className="coding-project-overview-footer">
      <div className="coding-project-recent-activity"><span className="coding-project-overview-label">Recent activity</span>{recentActivity.length ? <ul>{recentActivity.map((event) => <li key={event.eventId}><span aria-hidden="true" /> <strong>{activityLabel(event)}</strong><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleDateString()}</time></li>)}</ul> : <p>No task or Git activity recorded yet.</p>}</div>
      <div className="coding-project-quick-actions" aria-label="Project quick actions"><Button variant="primary" onClick={onNewThread}><NavIcon name="plus" />New thread</Button><Button variant="secondary" onClick={onReview} disabled={!gitStatus?.changes.length}>Review changes</Button><Button variant="ghost" onClick={onOpenTerminal}><NavIcon name="terminal" />Terminal</Button><Button variant="ghost" onClick={onRefreshGit}>Refresh Git</Button></div>
    </div>
  </section>;
}

export function CodingPage({ conversation, messages, sideChatRequest, onNewWorkspaceTab, onNewProjectThread, onStartSubagent, projectDirectory = false, projects, tasks, harnessAdapters, onRefreshHarnessAdapters, models, selectedModel, onModelChange, selectedProject, projectFiles, selectedFile, filePreview, filePreviewError, fileDraft, fileOriginal, fileSummary, fileBusy, fileUndoAvailable, terminalBusy, terminalOutput, terminalExitCode, gitStatus, gitBusy, gitDiff, gitDiffBusy, gitCommitBusy, gitPushBusy, gitPullRequestBusy, projectChecks, projectChecksBusy, projectCheckBusy, projectActivity, projectActivityBusy, onLoadProjectActivity, onLoadProjectChecks, onRunProjectCheck, onCancelTask, onTransitionTask, onSteerTask, onDelegateTask, onOpenTaskWorktree, onPlanTask, onExecuteTask, onRefreshGitStatus, onLoadGitDiff, onCommitGitChanges, onSendReview, onPushGitChanges, onCreateGitPullRequest, onPickFolder, onSaveProject, onOpenProject, onOpenFile, onCloseFile, onDraftChange, onSaveFile, onUndoFile, onRunTerminal, onRunProjectPreflight, onNavigate }: CodingPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [refreshingHarnesses, setRefreshingHarnesses] = useState(false);
  const [harnessRefreshError, setHarnessRefreshError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectModelChoice, setProjectModelChoice] = useState("");
  const projectNameRef = useRef<HTMLInputElement>(null);

  const projectModelStorageKey = selectedProject ? `skai.project.model-profile.${selectedProject.id}` : null;
  const projectModel = models.find((item) => `${item.provider ?? "Local API"}:${item.model}` === projectModelChoice);
  const projectModelLabel = projectModel?.displayName || projectModel?.model || "Use current chat model";

  useEffect(() => {
    if (!selectedProject) { setProjectModelChoice(""); return; }
    const raw = localStorage.getItem(`skai.project.model-profile.${selectedProject.id}`);
    if (!raw) { setProjectModelChoice(""); return; }
    try {
      const profile = JSON.parse(raw) as { model?: string; provider?: string };
      const key = profile.model ? `${profile.provider ?? "Local API"}:${profile.model}` : "";
      setProjectModelChoice(models.some((item) => `${item.provider ?? "Local API"}:${item.model}` === key) ? key : "");
      const match = models.find((item) => `${item.provider ?? "Local API"}:${item.model}` === key);
      if (match && onModelChange && match.model !== selectedModel) onModelChange(match);
    } catch { setProjectModelChoice(""); }
  }, [models, selectedProject]);

  const updateProjectModel = (value: string) => {
    setProjectModelChoice(value);
    if (!projectModelStorageKey) return;
    if (!value) { localStorage.removeItem(projectModelStorageKey); return; }
    const match = models.find((item) => `${item.provider ?? "Local API"}:${item.model}` === value);
    if (!match) return;
    localStorage.setItem(projectModelStorageKey, JSON.stringify({ model: match.model, provider: match.provider ?? "Local API", endpoint: match.endpoint ?? null }));
    onModelChange?.(match);
  };

  const createProject = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const saved = await onSaveProject(name.trim(), instructions.trim(), folders, editingDetails ? selectedProject?.id : undefined);
    setSaving(false);
    if (saved) { setName(""); setInstructions(""); setFolders([]); setDialogOpen(false); setEditingDetails(false); if (!editingDetails) void onOpenProject(saved); }
  };

  const addFolder = async (preferredPath?: string) => {
    const folder = preferredPath ?? await onPickFolder();
    if (folder && !folders.includes(folder)) setFolders((current) => [...current, folder]);
  };

  const openFolderAsProject = async () => {
    const folder = await onPickFolder();
    if (!folder) return;
    const existing = projects.find((project) => project.folderPaths.some((path) => path.toLowerCase() === folder.toLowerCase()));
    if (existing) { onOpenProject(existing); return; }
    const folderName = folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "New project";
    const saved = await onSaveProject(folderName, "", [folder]);
    if (saved) onOpenProject(saved);
  };

  const refreshHarnessCatalog = async () => {
    if (refreshingHarnesses) return;
    setRefreshingHarnesses(true);
    setHarnessRefreshError(null);
    try { await onRefreshHarnessAdapters(true); }
    catch (error) { setHarnessRefreshError(error instanceof Error ? error.message : "Harness availability could not be refreshed."); }
    finally { setRefreshingHarnesses(false); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const folder = params.get("createProjectFolder");
    const projectName = params.get("createProjectName");
    if (!folder || !projectName) return;
    setName(projectName);
    setInstructions("Build a polished, playable Python Snake game here. Use the selected model to implement the game and verify it runs.");
    setFolders([folder]);
    setDialogOpen(true);
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
  }, []);

  const visibleProjects = projects.filter((project) => `${project.name} ${project.folderPaths.join(" ")}`.toLowerCase().includes(projectQuery.trim().toLowerCase()));
  const projectTasks = selectedProject ? tasks.filter((task) => task.projectId === selectedProject.id) : [];
  const activeTask = projectTasks.find((task) => ["running", "verifying", "queued", "awaiting_approval"].includes(task.status));
  const harnessCatalog = <details className="coding-harness-adapters"><summary>Execution harnesses · {harnessAdapters.filter((adapter) => adapter.available).length} ready · {harnessAdapters.filter((adapter) => adapter.status === "detected-not-connected").length} detected · contract v{harnessAdapters[0]?.contractVersion ?? 2}</summary><div className="coding-harness-adapters-actions"><span>Refresh detects executables. The optional health probe runs only a bounded <code>--version</code> command; sign-in remains unknown.</span><Button variant="secondary" type="button" disabled={refreshingHarnesses} onClick={() => void refreshHarnessCatalog()}>{refreshingHarnesses ? "Checking…" : "Check harness health"}</Button></div>{harnessRefreshError && <p className="form-error" role="alert">{harnessRefreshError}</p>}<ul>{harnessAdapters.map((adapter) => <li key={adapter.id}><div><strong>{adapter.name}</strong><span className={adapter.available ? "is-ready" : "is-unavailable"}>{adapter.available ? "Ready" : adapter.status === "detected-not-connected" ? "Detected · not connected" : "Not installed"}</span></div><p>{adapter.description}</p><small>{adapter.healthNote} {adapter.authenticationStatus === "unknown" ? "Sign-in status is unknown." : ""}</small>{adapter.prerequisites.length > 0 && <small>Requirements: {adapter.prerequisites.join(" · ")}</small>}<div className="coding-harness-capability-groups"><div><span>Skai integration</span>{adapter.capabilities.length ? <div>{adapter.capabilities.map((capability) => <small className="coding-harness-capability" key={capability}>{capability}</small>)}</div> : <small>Not integrated yet</small>}</div><div><span>Harness-reported features · not verified by Skai</span><div>{adapter.nativeCapabilities.map((capability) => <small className="coding-harness-capability is-native" key={capability}>{capability}</small>)}</div></div></div>{adapter.healthStatus === "not-checked" && adapter.status === "detected-not-connected" && <small>Health not checked yet. Use Check harness health to run a read-only version probe.</small>}{adapter.healthStatus !== "not-checked" && adapter.healthStatus !== "missing" && <small>Health probe: {adapter.healthStatus}{adapter.healthVersion ? ` · ${adapter.healthVersion}` : ""}</small>}{adapter.ownsSessionFormat && <small>Session format belongs to this harness. Skai keeps its task journal authoritative; import and resume are not connected.</small>}</li>)}</ul></details>;
  const projectModelControl = <label className="coding-model-profile"><small>Project default</small><select value={projectModelChoice} onChange={(event) => updateProjectModel(event.target.value)} aria-label="Project default model"><option value="">Use current chat model</option>{models.map((item) => <option key={`${item.provider ?? "Local API"}:${item.model}`} value={`${item.provider ?? "Local API"}:${item.model}`}>{item.displayName || item.model} · {item.provider ?? "Local API"}</option>)}</select><em>{projectModelChoice && selectedModel !== projectModel?.model ? "Chat override active" : projectModelLabel}</em></label>;
  return <div className={`feature-page coding-page ${selectedProject && !projectDirectory ? "coding-page-active" : ""} ${projectDirectory ? "project-directory-page" : ""}`}>
    {projectDirectory ? <>
      <PageHeader eyebrow="WORKSPACES" title="Projects" description="Open a project to work with its files, tasks, terminal, and changes." actions={<><Button variant="secondary" onClick={() => void openFolderAsProject()}><NavIcon name="project" />Open folder</Button><Button variant="primary" onClick={() => setDialogOpen(true)}><NavIcon name="plus" />New project</Button></>} />
      <div className="project-directory-toolbar"><label className="project-directory-search"><span className="sr-only">Search projects and folders</span><NavIcon name="search" /><input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects and folders…" /></label><span>{visibleProjects.length} {visibleProjects.length === 1 ? "project" : "projects"}</span></div>
      {visibleProjects.length === 0 ? <div className="project-directory-empty"><EmptyState title={projects.length === 0 ? "No projects yet" : "No projects match"} description={projects.length === 0 ? "Open a folder or create a project to get started." : "Try a different name or folder path."} action={projects.length === 0 ? <Button variant="secondary" onClick={() => void openFolderAsProject()}><NavIcon name="project" />Open folder</Button> : undefined} /></div> : <div className="project-directory-table" role="table" aria-label="Projects"><div className="project-directory-row project-directory-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Path</span><span role="columnheader">Activity</span><span aria-hidden="true" /></div>{visibleProjects.map((project) => { const projectTaskCount = tasks.filter((task) => task.projectId === project.id).length; const activeProjectTaskCount = tasks.filter((task) => task.projectId === project.id && ["queued", "running", "verifying", "awaiting_approval"].includes(task.status)).length; return <div className="project-directory-row" role="row" key={project.id}><button type="button" className="project-directory-open" role="cell" onClick={() => onOpenProject(project)}><NavIcon name="project" /><span>{project.name}</span></button><span className="project-directory-path" role="cell" title={project.folderPaths.join("\n")}>{project.folderPaths[0] || "No folder connected"}</span><span className="project-directory-activity" role="cell"><strong>{activeProjectTaskCount ? `${activeProjectTaskCount} active` : "Ready"}</strong><small>{projectTaskCount} task{projectTaskCount === 1 ? "" : "s"} · {new Date(project.updatedAt).toLocaleDateString()}</small></span><button type="button" className="project-directory-open-action" role="cell" aria-label={`Open ${project.name}`} onClick={() => onOpenProject(project)}><NavIcon name="arrow-right" /></button></div>; })}</div>}
    </> : <>
      {selectedProject ? <><div className="coding-project-heading"><div className="coding-project-heading-main"><button className="coding-project-breadcrumb" type="button" onClick={() => onNavigate("projects")}>Projects</button><span aria-hidden="true">/</span><strong title={selectedProject.name}>{selectedProject.name}</strong></div><div className="coding-project-heading-actions"><ProjectActivityTimeline projectId={selectedProject.id} projectName={selectedProject.name} tasks={projectTasks} events={projectActivity} busy={projectActivityBusy} onRefresh={() => onLoadProjectActivity(selectedProject.id)} /><Button variant="secondary" onClick={() => onNewProjectThread(selectedProject)}><NavIcon name="plus" />New thread</Button><label><span className="sr-only">Switch coding project</span><select value={selectedProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) onOpenProject(project); }} aria-label="Switch coding project">{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><Button variant="ghost" onClick={() => { setEditingDetails(true); setName(selectedProject.name); setInstructions(selectedProject.instructions); setFolders(selectedProject.folderPaths); setDialogOpen(true); }}>Project settings</Button></div></div><CodingProjectOverview project={selectedProject} tasks={projectTasks} files={projectFiles} gitStatus={gitStatus} checks={projectChecks} activity={projectActivity} onNewThread={() => onNewProjectThread(selectedProject)} onReview={() => onSendReview("Review the current project changes and summarize risks, test coverage, and the safest next step.")} onOpenTerminal={() => onNavigate("terminal")} onRefreshGit={onRefreshGitStatus} /><div className="coding-context-strip" aria-label="Current workspace context">{projectModelControl}<span><small>Branch</small><strong>{gitStatus?.branch ?? "Checking…"}</strong></span><span><small>Model</small><strong title={selectedModel}>{models.find((model) => model.model === selectedModel)?.displayName ?? selectedModel ?? "Not selected"}</strong></span><span><small>Task</small><strong title={activeTask?.title}>{activeTask ? `${activeTask.title} · ${activeTask.status}` : "No active task"}</strong></span><span><small>Changes</small><strong>{gitStatus?.changes.length ?? "—"} files</strong></span><span><small>Tools</small><strong>Files · Git · Terminal</strong></span></div>{harnessCatalog}<CodingSessionView conversation={conversation} messages={messages} sideChatRequest={sideChatRequest} onNewWorkspaceTab={onNewWorkspaceTab} onStartSubagent={onStartSubagent} projects={projects} models={models} selectedProject={selectedProject} tasks={projectTasks} projectFiles={projectFiles} selectedFile={selectedFile} filePreview={filePreview} filePreviewError={filePreviewError} fileDraft={fileDraft} fileOriginal={fileOriginal} fileSummary={fileSummary} fileBusy={fileBusy} fileUndoAvailable={fileUndoAvailable} terminalBusy={terminalBusy} terminalOutput={terminalOutput} terminalExitCode={terminalExitCode} gitStatus={gitStatus} gitBusy={gitBusy} gitDiff={gitDiff} gitDiffBusy={gitDiffBusy} gitCommitBusy={gitCommitBusy} gitPushBusy={gitPushBusy} gitPullRequestBusy={gitPullRequestBusy} projectChecks={projectChecks} projectChecksBusy={projectChecksBusy} projectCheckBusy={projectCheckBusy} onLoadProjectChecks={onLoadProjectChecks} onRunProjectCheck={onRunProjectCheck} onCancelTask={onCancelTask} onTransitionTask={onTransitionTask} onSteerTask={onSteerTask} onDelegateTask={onDelegateTask} onOpenTaskWorktree={onOpenTaskWorktree} onPlanTask={onPlanTask} onExecuteTask={onExecuteTask} onRefreshGitStatus={onRefreshGitStatus} onLoadGitDiff={onLoadGitDiff} onCommitGitChanges={onCommitGitChanges} onSendReview={onSendReview} onPushGitChanges={onPushGitChanges} onCreateGitPullRequest={onCreateGitPullRequest} onOpenProject={onOpenProject} onOpenFile={onOpenFile} onCloseFile={onCloseFile} onDraftChange={onDraftChange} onSaveFile={onSaveFile} onUndoFile={onUndoFile} onRunTerminal={onRunTerminal} onRunProjectPreflight={onRunProjectPreflight} /></> : <div className="coding-no-project"><EmptyState title="Choose a project to start" description="Browse your projects, then open one to work with files and tasks." action={<Button variant="primary" onClick={() => onNavigate("projects")}><NavIcon name="project" />Browse projects</Button>} />{harnessCatalog}</div>}
    </>}
    <ModalDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingDetails(false); }} titleId="new-project-title" initialFocusRef={projectNameRef}><form onSubmit={(event) => { event.preventDefault(); void createProject(); }}><div className="dialog-heading"><div><p className="section-kicker">{editingDetails ? "PROJECT DETAILS" : "NEW PROJECT"}</p><h3 id="new-project-title">{editingDetails ? "Edit project" : "Create project"}</h3><p>{editingDetails ? "Manage the folders and instructions for this project." : "Choose a name and local folder for this project."}</p></div><button type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }} aria-label="Close dialog">×</button></div><label>Project name<input ref={projectNameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" /></label>{editingDetails && <label>Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional instructions for this project" rows={3} /></label>}<div className="dialog-folders"><div className="dialog-folders-heading"><span>{editingDetails ? "Connected folders" : "Folder"}</span><Button variant="secondary" type="button" onClick={() => void addFolder()}>{editingDetails ? "Add folder" : folders[0] ? "Change folder" : "Choose folder"}</Button></div>{folders.length === 0 ? <p>{editingDetails ? "No folders connected yet." : "Choose a local folder to continue."}</p> : folders.map((folder) => <div className="dialog-folder" key={folder}><span>{folder}</span>{editingDetails && <button type="button" onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>Remove</button>}</div>)}</div>{editingDetails && folders.length === 0 && <Button variant="secondary" type="button" onClick={() => void addFolder()}>Add folder</Button>}<div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }}>Cancel</Button><Button variant="primary" type="submit" disabled={saving || !name.trim() || (!editingDetails && folders.length === 0)}>{saving ? "Saving…" : editingDetails ? "Save project" : "Create project"}</Button></div></form></ModalDialog>
  </div>;
}
