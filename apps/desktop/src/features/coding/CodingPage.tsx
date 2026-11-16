import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesktopGitDiff, DesktopGitStatus, DesktopProject, DesktopProjectFile } from "../../../shared/contracts";
import type { Route } from "../../app/types";
import { Button, EmptyState, PageHeader } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import { NavIcon } from "../../components/ui/NavIcon";
import { CodingSessionView } from "./CodingSessionView";

type CodingPageProps = {
  conversation?: ReactNode;
  projectDirectory?: boolean;
  projects: DesktopProject[];
  selectedProject: DesktopProject | null;
  projectFiles: DesktopProjectFile[];
  selectedFile: string | null;
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
  onRefreshGitStatus: () => void;
  onLoadGitDiff: () => void;
  onCommitGitChanges: (message: string) => Promise<boolean>;
  onPushGitChanges: () => Promise<boolean>;
  onCreateGitPullRequest: (title: string, body: string) => Promise<boolean>;
  onPickFolder: () => Promise<string | null>;
  onSaveProject: (name: string, instructions: string, folders: string[], id?: string) => Promise<DesktopProject | null>;
  onOpenProject: (project: DesktopProject) => void;
  onOpenFile: (relativePath: string) => void;
  onCloseFile: () => void;
  onDraftChange: (value: string) => void;
  onSaveFile: () => void;
  onUndoFile: () => void;
  onRunTerminal: (projectId: string, command: string, cwd: string) => void;
  onNavigate: (route: Route) => void;
};

export function CodingPage({ conversation, projectDirectory = false, projects, selectedProject, projectFiles, selectedFile, fileDraft, fileOriginal, fileSummary, fileBusy, fileUndoAvailable, terminalBusy, terminalOutput, terminalExitCode, gitStatus, gitBusy, gitDiff, gitDiffBusy, gitCommitBusy, gitPushBusy, gitPullRequestBusy, onRefreshGitStatus, onLoadGitDiff, onCommitGitChanges, onPushGitChanges, onCreateGitPullRequest, onPickFolder, onSaveProject, onOpenProject, onOpenFile, onCloseFile, onDraftChange, onSaveFile, onUndoFile, onRunTerminal, onNavigate }: CodingPageProps) {
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
  return <div className={`feature-page coding-page ${selectedProject && !projectDirectory ? "coding-page-active" : ""} ${projectDirectory ? "project-directory-page" : ""}`}>
    {projectDirectory ? <>
      <PageHeader eyebrow="WORKSPACES" title="Projects" description="Open a project to work with its files, tasks, terminal, and changes." actions={<Button variant="primary" onClick={() => setDialogOpen(true)}><NavIcon name="plus" />Create</Button>} />
      <div className="project-directory-toolbar"><label className="project-directory-search"><span className="sr-only">Search projects</span><NavIcon name="search" /><input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Search projects" /></label><span>{visibleProjects.length} {visibleProjects.length === 1 ? "project" : "projects"}</span></div>
      {visibleProjects.length === 0 ? <div className="project-directory-empty"><EmptyState title={projects.length === 0 ? "Create your first project" : "No projects match"} description={projects.length === 0 ? "Choose a folder to give the coding workspace a clear, local context." : "Try a different name or folder path."} action={projects.length === 0 ? <Button variant="secondary" onClick={() => setDialogOpen(true)}><NavIcon name="plus" />Create project</Button> : undefined} /></div> : <div className="project-directory-table" role="table" aria-label="Projects"><div className="project-directory-row project-directory-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Folders</span><span role="columnheader">Updated</span><span aria-hidden="true" /></div>{visibleProjects.map((project) => <div className="project-directory-row" role="row" key={project.id}><button type="button" className="project-directory-open" role="cell" onClick={() => onOpenProject(project)}><NavIcon name="project" /><span>{project.name}</span></button><span className="project-directory-path" role="cell" title={project.folderPaths.join("\n")}>{project.folderPaths.length ? project.folderPaths.join(" · ") : "No folders connected"}</span><time role="cell" dateTime={project.updatedAt}>{Number.isNaN(Date.parse(project.updatedAt)) ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(project.updatedAt))}</time><button type="button" className="project-directory-open-action" aria-label={`Open ${project.name}`} onClick={() => onOpenProject(project)}><NavIcon name="arrow-right" /></button></div>)}</div>}
    </> : <>
      {selectedProject ? <><button className="coding-project-breadcrumb" type="button" onClick={() => onNavigate("projects")}>Projects <span aria-hidden="true">›</span></button><PageHeader className="page-header-coding-session" eyebrow="CODING WORKSPACE" title={selectedProject.name} description="Project conversation, files, terminal, and reviewable changes in one workspace." actions={<><Button variant="secondary" onClick={() => { setEditingDetails(true); setName(selectedProject.name); setInstructions(selectedProject.instructions); setFolders(selectedProject.folderPaths); setDialogOpen(true); }}>Project details</Button><Button variant="ghost" onClick={() => onNavigate("projects")}>All projects</Button></>} /><div className="coding-session-bar" aria-label="Coding shortcuts"><div className="coding-shortcuts"><span><kbd>Ctrl P</kbd> Find file</span><span><kbd>Ctrl J</kbd> Terminal</span><span><kbd>Ctrl S</kbd> Save file</span></div></div><CodingSessionView conversation={conversation} projects={projects} selectedProject={selectedProject} projectFiles={projectFiles} selectedFile={selectedFile} fileDraft={fileDraft} fileOriginal={fileOriginal} fileSummary={fileSummary} fileBusy={fileBusy} fileUndoAvailable={fileUndoAvailable} terminalBusy={terminalBusy} terminalOutput={terminalOutput} terminalExitCode={terminalExitCode} gitStatus={gitStatus} gitBusy={gitBusy} gitDiff={gitDiff} gitDiffBusy={gitDiffBusy} gitCommitBusy={gitCommitBusy} gitPushBusy={gitPushBusy} gitPullRequestBusy={gitPullRequestBusy} onRefreshGitStatus={onRefreshGitStatus} onLoadGitDiff={onLoadGitDiff} onCommitGitChanges={onCommitGitChanges} onPushGitChanges={onPushGitChanges} onCreateGitPullRequest={onCreateGitPullRequest} onOpenProject={onOpenProject} onOpenFile={onOpenFile} onCloseFile={onCloseFile} onDraftChange={onDraftChange} onSaveFile={onSaveFile} onUndoFile={onUndoFile} onRunTerminal={onRunTerminal} onNavigate={onNavigate} /></> : <div className="coding-no-project"><EmptyState title="Choose a project to start" description="Browse your projects, then open one to work with files and tasks." action={<Button variant="primary" onClick={() => onNavigate("projects")}><NavIcon name="project" />Browse projects</Button>} /></div>}
    </>}
    <ModalDialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditingDetails(false); }} titleId="new-project-title" initialFocusRef={projectNameRef}><form onSubmit={(event) => { event.preventDefault(); void createProject(); }}><div className="dialog-heading"><div><p className="section-kicker">{editingDetails ? "PROJECT DETAILS" : "NEW PROJECT"}</p><h3 id="new-project-title">{editingDetails ? "Edit project" : "Connect a workspace"}</h3><p>Only the folders you select are exposed to the project.</p></div><button type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }} aria-label="Close dialog">×</button></div><label>Project name<input ref={projectNameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" /></label><label>Instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional instructions for this project" rows={3} /></label><div className="dialog-folders"><div className="dialog-folders-heading"><span>Connected folders</span><Button variant="secondary" type="button" onClick={() => void addFolder()}>Add folder</Button></div>{folders.length === 0 ? <p>No folders connected yet.</p> : folders.map((folder) => <div className="dialog-folder" key={folder}><span>{folder}</span><button type="button" onClick={() => setFolders((current) => current.filter((item) => item !== folder))}>Remove</button></div>)}</div><div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => { setDialogOpen(false); setEditingDetails(false); }}>Cancel</Button><Button variant="primary" type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : editingDetails ? "Save project" : "Create project"}</Button></div></form></ModalDialog>
  </div>;
}
