import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesktopGitDiff, DesktopGitStatus, DesktopProject, DesktopProjectCheck, DesktopProjectFile, DesktopProjectPreflight, DesktopProjectPreview, DesktopTask, DesktopTaskWorkerDraft } from "../../../shared/contracts";
import type { Route } from "../../app/types";
import type { Message } from "../../app/types";
import type { Model } from "../../app/types";
import { Button, EmptyState, PageHeader } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { NavIcon } from "../../components/ui/NavIcon";
import { CodingSessionView } from "./CodingSessionView";

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
  models: Model[];
  selectedModel: string;
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
  onRefreshGitStatus: () => void;
  onLoadGitDiff: (paths?: string[]) => void;
  onCommitGitChanges: (message: string, paths?: string[]) => Promise<boolean>;
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

export function CodingPage({ conversation, messages, sideChatRequest, onNewWorkspaceTab, onNewProjectThread, onStartSubagent, projectDirectory = false, projects, tasks, models, selectedModel, selectedProject, projectFiles, selectedFile, filePreview, filePreviewError, fileDraft, fileOriginal, fileSummary, fileBusy, fileUndoAvailable, terminalBusy, terminalOutput, terminalExitCode, gitStatus, gitBusy, gitDiff, gitDiffBusy, gitCommitBusy, gitPushBusy, gitPullRequestBusy, projectChecks, projectChecksBusy, projectCheckBusy, onLoadProjectChecks, onRunProjectCheck, onCancelTask, onTransitionTask, onSteerTask, onDelegateTask, onOpenTaskWorktree, onPlanTask, onExecuteTask, onRefreshGitStatus, onLoadGitDiff, onCommitGitChanges, onPushGitChanges, onCreateGitPullRequest, onPickFolder, onSaveProject, onOpenProject, onOpenFile, onCloseFile, onDraftChange, onSaveFile, onUndoFile, onRunTerminal, onRunProjectPreflight, onNavigate }: CodingPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const projectNameRef = useRef<HTMLInputElement>(null);

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
  return <div className={`feature-page coding-page ${selectedProject && !projectDirectory ? "coding-page-active" : ""} ${projectDirectory ? "project-directory-page" : ""}`}>
    {projectDirectory ? <>
      <PageHeader eyebrow="WORKSPACES" title="Projects" description="Open a project to work with its files, tasks, terminal, and changes." actions={<><Button variant="secondary" onClick={() => void openFolderAsProject()}><NavIcon name="project" />Open folder</Button><Button variant="primary" onClick={() => setDialogOpen(true)}><NavIcon name="plus" />New project</Button></>} />
      <div className="project-directory-toolbar"><label className="project-directory-search"><span className="sr-only">Search projects and folders</span><NavIcon name="search" /><input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects and folders…" /></label><span>{visibleProjects.length} {visibleProjects.length === 1 ? "project" : "projects"}</span></div>
      {visibleProjects.length === 0 ? <div className="project-directory-empty"><EmptyState title={projects.length === 0 ? "No projects yet" : "No projects match"} description={projects.length === 0 ? "Open a folder or create a project to get started." : "Try a different name or folder path."} action={projects.length === 0 ? <Button variant="secondary" onClick={() => void openFolderAsProject()}><NavIcon name="project" />Open folder</Button> : undefined} /></div> : <div className="project-directory-table" role="table" aria-label="Projects"><div className="project-directory-row project-directory-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Path</span><span aria-hidden="true" /></div>{visibleProjects.map((project) => <div className="project-directory-row" role="row" key={project.id}><button type="button" className="project-directory-open" role="cell" onClick={() => onOpenProject(project)}><NavIcon name="project" /><span>{project.name}</span></button><span className="project-directory-path" role="cell" title={project.folderPaths.join("\n")}>{project.folderPaths[0] || "No folder connected"}</span><button type="button" className="project-directory-open-action" role="cell" aria-label={`Open ${project.name}`} onClick={() => onOpenProject(project)}><NavIcon name="arrow-right" /></button></div>)}</div>}
    </> : <>
      {selectedProject ? <><div className="coding-project-heading"><div className="coding-project-heading-main"><button className="coding-project-breadcrumb" type="button" onClick={() => onNavigate("projects")}>Projects</button><span aria-hidden="true">/</span><strong title={selectedProject.name}>{selectedProject.name}</strong></div><div className="coding-project-heading-actions"><Button variant="secondary" onClick={() => onNewProjectThread(selectedProject)}><NavIcon name="plus" />New thread</Button><label><span className="sr-only">Switch coding project</span><select value={selectedProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) onOpenProject(project); }} aria-label="Switch coding project">{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><Button variant="ghost" onClick={() => { setEditingDetails(true); setName(selectedProject.name); setInstructions(selectedProject.instructions); setFolders(selectedProject.folderPaths); setDialogOpen(true); }}>Project settings</Button></div></div><div className="coding-context-strip" aria-label="Current workspace context"><span><small>Branch</small><strong>{gitStatus?.branch ?? "Checking…"}</strong></span><span><small>Model</small><strong title={selectedModel}>{models.find((model) => model.model === selectedModel)?.displayName ?? selectedModel ?? "Not selected"}</strong></span><span><small>Task</small><strong title={activeTask?.title}>{activeTask ? `${activeTask.title} · ${activeTask.status}` : "No active task"}</strong></span><span><small>Changes</small><strong>{gitStatus?.changes.length ?? "—"} files</strong></span><span><small>Tools</small><strong>Files · Git · Terminal</strong></span></div><CodingSessionView conversation={conversation} messages={messages} sideChatRequest={sideChatRequest} onNewWorkspaceTab={onNewWorkspaceTab} onStartSubagent={onStartSubagent} projects={projects} models={models} selectedProject={selectedProject} tasks={projectTasks} projectFiles={projectFiles} selectedFile={selectedFile} filePreview={filePreview} filePreviewError={filePreviewError} fileDraft={fileDraft} fileOriginal={fileOriginal} fileSummary={fileSummary} fileBusy={fileBusy} fileUndoAvailable={fileUndoAvailable} terminalBusy={terminalBusy} terminalOutput={terminalOutput} terminalExitCode={terminalExitCode} gitStatus={gitStatus} gitBusy={gitBusy} gitDiff={gitDiff} gitDiffBusy={gitDiffBusy} gitCommitBusy={gitCommitBusy} gitPushBusy={gitPushBusy} gitPullRequestBusy={gitPullRequestBusy} projectChecks={projectChecks} projectChecksBusy={projectChecksBusy} projectCheckBusy={projectCheckBusy} onLoadProjectChecks={onLoadProjectChecks} onRunProjectCheck={onRunProjectCheck} onCancelTask={onCancelTask} onTransitionTask={onTransitionTask} onSteerTask={onSteerTask} onDelegateTask={onDelegateTask} onOpenTaskWorktree={onOpenTaskWorktree} onPlanTask={onPlanTask} onExecuteTask={onExecuteTask} onRefreshGitStatus={onRefreshGitStatus} onLoadGitDiff={onLoadGitDiff} onCommitGitChanges={onCommitGitChanges} onPushGitChanges={onPushGitChanges} onCreateGitPullRequest={onCreateGitPullRequest} onOpenProject={onOpenProject} onOpenFile={onOpenFile} onCloseFile={onCloseFile} onDraftChange={onDraftChange} onSaveFile={onSaveFile} onUndoFile={onUndoFile} onRunTerminal={onRunTerminal} onRunProjectPreflight={onRunProjectPreflight} /></> : <div className="coding-no-project"><EmptyState title="Choose a project to start" description="Browse your projects, then open one to work with files and tasks." action={<Button variant="primary" onClick={() => onNavigate("projects")}><NavIcon name="project" />Browse projects</Button>} /></div>}
    </>}
    <ModalDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingDetails(false); }} titleId="new-project-title" initialFocusRef={projectNameRef}><form onSubmit={(event) => { event.preventDefault(); void createProject(); }}><div className="dialog-heading"><div><p className="section-kicker">{editingDetails ? "PROJECT DETAILS" : "NEW PROJECT"}</p><h3 id="new-project-title">{editingDetails ? "Edit project" : "Create project"}</h3><p>{editingDetails ? "Manage the folders and instructions for this project." : "Choose a name and local folder for this project."}</p></div><button type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }} aria-label="Close dialog">×</button></div><label>Project name<input ref={projectNameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" /></label>{editingDetails && <label>Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional instructions for this project" rows={3} /></label>}<div className="dialog-folders"><div className="dialog-folders-heading"><span>{editingDetails ? "Connected folders" : "Folder"}</span><Button variant="secondary" type="button" onClick={() => void addFolder()}>{editingDetails ? "Add folder" : folders[0] ? "Change folder" : "Choose folder"}</Button></div>{folders.length === 0 ? <p>{editingDetails ? "No folders connected yet." : "Choose a local folder to continue."}</p> : folders.map((folder) => <div className="dialog-folder" key={folder}><span>{folder}</span>{editingDetails && <button type="button" onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>Remove</button>}</div>)}</div>{editingDetails && folders.length === 0 && <Button variant="secondary" type="button" onClick={() => void addFolder()}>Add folder</Button>}<div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }}>Cancel</Button><Button variant="primary" type="submit" disabled={saving || !name.trim() || (!editingDetails && folders.length === 0)}>{saving ? "Saving…" : editingDetails ? "Save project" : "Create project"}</Button></div></form></ModalDialog>
  </div>;
}
