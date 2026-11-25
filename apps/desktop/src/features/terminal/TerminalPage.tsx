import { useState } from "react";
import type { DesktopGitStatus, DesktopProject, DesktopProjectFile, DesktopProjectPreflight } from "../../../shared/contracts";
import { Button, Card, PageHeader } from "../../components/ui/Primitives";
import { TerminalPanel } from "./TerminalPanel";

type TerminalPageProps = {
  projects: DesktopProject[];
  initialProjectId?: string | null;
  projectFiles: DesktopProjectFile[];
  gitStatus: DesktopGitStatus | null;
  busy: boolean;
  output: string | null;
  exitCode: number | null;
  sessionId: string | null;
  screen: string | null;
  onRun: (projectId: string, command: string, cwd: string) => void;
  onRunPreflight: (projectId: string) => Promise<DesktopProjectPreflight | null>;
  onRefreshGit: () => void;
  onOpenFile: (path: string) => void;
  onSelectProject: (project: DesktopProject) => void;
  onStartSession: (projectId: string, cwd: string) => Promise<boolean>;
  onWriteSession: (text: string) => Promise<boolean>;
  onRefreshSession: () => Promise<boolean>;
  onCloseSession: () => Promise<boolean>;
  onOpenCoding: () => void;
};

export function TerminalPage({ projects, initialProjectId, projectFiles, gitStatus, busy, output, exitCode, sessionId, screen, onRun, onRunPreflight, onRefreshGit, onOpenFile, onSelectProject, onStartSession, onWriteSession, onRefreshSession, onCloseSession, onOpenCoding }: TerminalPageProps) {
  const [preflight, setPreflight] = useState<DesktopProjectPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const selectedProject = projects.find((project) => project.id === initialProjectId) ?? projects[0] ?? null;
  const runPreflight = async () => {
    if (!selectedProject || preflightBusy) return;
    setPreflightBusy(true);
    try { setPreflight(await onRunPreflight(selectedProject.id)); }
    finally { setPreflightBusy(false); }
  };

  return <div className="feature-page terminal-page">
    <PageHeader eyebrow="PROJECT WORKSPACE" title="Terminal" description="Run a command, check the project setup, and inspect its files in one workspace." />
    <div className="terminal-workspace-grid">
      <section className="terminal-workspace-main" aria-label="Project terminal">
        <TerminalPanel projects={projects} initialProjectId={selectedProject?.id} busy={busy} output={output} exitCode={exitCode} sessionId={sessionId} screen={screen} onRun={onRun} onStartSession={onStartSession} onWriteSession={onWriteSession} onRefreshSession={onRefreshSession} onCloseSession={onCloseSession} onOpenCoding={onOpenCoding} onProjectChange={(id) => { const project = projects.find((item) => item.id === id); if (project) { setPreflight(null); onSelectProject(project); } }} />
      </section>
      <aside className="terminal-workspace-inspector" aria-label="Project overview">
        <Card className="terminal-inspector-card">
          <div className="terminal-inspector-heading"><div><p className="section-kicker">PROJECT PREFLIGHT</p><h2>Setup</h2></div><Button variant="secondary" disabled={!selectedProject || preflightBusy} onClick={() => void runPreflight()}>{preflightBusy ? "Checking…" : preflight ? "Run again" : "Run preflight"}</Button></div>
          {!selectedProject ? <p className="terminal-inspector-empty">Choose a project to inspect its setup.</p> : preflight ? <><p>{preflight.manifests.length ? `Detected ${preflight.manifests.join(", ")}.` : "No supported dependency manifest detected."}</p>{preflight.runtimes.length > 0 && <ul className="project-preflight-runtimes">{preflight.runtimes.map((runtime) => <li key={runtime.name}><strong>{runtime.name}</strong><span>{runtime.available ? "Available" : "Not found"}</span></li>)}</ul>}{preflight.suggestedChecks.length > 0 && <div><strong>Suggested checks · not run</strong><ul className="project-preflight-checks">{preflight.suggestedChecks.map((check) => <li key={check}><code>{check}</code></li>)}</ul></div>}<small>{preflight.executionNote}</small></> : <p className="terminal-inspector-empty">Check detected runtimes and suggested commands. Suggested checks are never run automatically.</p>}
        </Card>
        <Card className="terminal-inspector-card terminal-files-card">
          <div className="terminal-inspector-heading"><div><p className="section-kicker">FILES &amp; DIFFS</p><h2>{gitStatus ? `${gitStatus.changes.length} changes` : "Project files"}</h2></div><Button variant="ghost" onClick={onRefreshGit}>Refresh</Button></div>
          {gitStatus && <div className="terminal-git-summary"><strong>{gitStatus.branch}</strong><span>{gitStatus.commitsAhead} ahead · {gitStatus.commitsBehind} behind{gitStatus.hasConflicts ? " · conflicts" : ""}</span></div>}
          {gitStatus?.changes.length ? <ul className="terminal-file-list" aria-label="Changed files">{gitStatus.changes.slice(0, 8).map((change) => <li key={`${change.status}-${change.path}`}><button type="button" onClick={() => onOpenFile(change.path)} title={`Open ${change.path}`}><b>{change.status}</b><span>{change.path}</span></button></li>)}</ul> : <ul className="terminal-file-list" aria-label="Project files">{projectFiles.slice(0, 8).map((file) => <li key={file.relativePath}><button type="button" onClick={() => onOpenFile(file.relativePath)} title={`Open ${file.relativePath}`}><b>{file.kind === "image" ? "IMG" : "FILE"}</b><span>{file.relativePath}</span></button></li>)}</ul>}
          {!projectFiles.length && !gitStatus?.changes.length && <p className="terminal-inspector-empty">Files and changes appear here when a project is selected.</p>}
        </Card>
      </aside>
    </div>
  </div>;
}
