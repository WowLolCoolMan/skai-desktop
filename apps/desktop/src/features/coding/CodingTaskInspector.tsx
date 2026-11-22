import { useEffect, useState } from "react";
import type { DesktopProjectCheck, DesktopTask, DesktopGitStatus } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

type CodingTaskInspectorProps = {
  projectId: string;
  tasks: DesktopTask[];
  projectChecks: DesktopProjectCheck[];
  projectChecksBusy: boolean;
  projectCheckBusy: boolean;
  gitStatus: DesktopGitStatus | null;
  gitDiffReady: boolean;
  gitDiffBusy: boolean;
  onReviewChanges: (paths?: string[]) => void;
  onLoadProjectChecks: (projectId?: string) => void;
  onRunProjectCheck: (projectId: string, taskId: string, checkId: string) => Promise<unknown>;
};

function statusLabel(status: string) {
  switch (status) {
    case "running":
    case "verifying":
      return "Active";
    case "queued":
      return "Queued";
    case "completed":
    case "succeeded":
      return "Complete";
    case "failed":
    case "blocked":
      return "Needs attention";
    default:
      return status || "Unknown";
  }
}

function statusTone(status: string) {
  if (status === "failed" || status === "blocked") return "attention";
  if (status === "running" || status === "verifying") return "active";
  if (status === "queued") return "queued";
  return "complete";
}

export function CodingTaskInspector({ projectId, tasks, projectChecks, projectChecksBusy, projectCheckBusy, gitStatus, gitDiffReady, gitDiffBusy, onReviewChanges, onLoadProjectChecks, onRunProjectCheck }: CodingTaskInspectorProps) {
  const recentTasks = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedCheckId, setSelectedCheckId] = useState("");
  const changedPaths = gitStatus?.changes.map((change) => change.path) ?? [];
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;

  useEffect(() => {
    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(recentTasks[0]?.id ?? "");
  }, [recentTasks, selectedTaskId, tasks]);
  useEffect(() => {
    if (!selectedCheckId || !projectChecks.some((check) => check.id === selectedCheckId)) setSelectedCheckId(projectChecks[0]?.id ?? "");
  }, [projectChecks, selectedCheckId]);

  return <Card className="coding-task-inspector" aria-label="Project task and changes inspector">
    <div className="coding-task-inspector-heading">
      <div><p className="section-kicker">PROJECT ACTIVITY</p><h3>Tasks &amp; review</h3></div>
      <span className={`coding-task-inspector-count is-${attentionCount ? "attention" : activeCount ? "active" : "quiet"}`}>{attentionCount || activeCount || tasks.length}</span>
    </div>
    <div className="coding-task-inspector-summary" aria-live="polite">
      <span><strong>{activeCount}</strong> active</span>
      <span><strong>{attentionCount}</strong> attention</span>
      <span><strong>{changedPaths.length}</strong> changed</span>
    </div>
    {changedPaths.length > 0 && <section className="coding-task-inspector-section">
      <div className="coding-task-inspector-section-heading"><div><p className="section-kicker">CHANGES</p><strong>Review the project diff</strong></div><span>{changedPaths.length}</span></div>
      <p>Changed files stay attached to this project session while the conversation remains visible.</p>
      <Button variant="secondary" disabled={gitDiffBusy} onClick={() => onReviewChanges(changedPaths)}>{gitDiffBusy ? "Loading diff…" : gitDiffReady ? "Refresh review" : "Review changes"}</Button>
    </section>}
    <section className="coding-task-inspector-section">
      <div className="coding-task-inspector-section-heading"><div><p className="section-kicker">THREAD TASKS</p><strong>{tasks.length ? "Recent work" : "No task activity"}</strong></div>{tasks.length > 8 && <span>8+</span>}</div>
      {recentTasks.length ? <div className="coding-task-list">{recentTasks.map((task) => <article className="coding-task-item" key={task.id}>
        <div className="coding-task-item-heading"><strong>{task.title}</strong><span className={`coding-task-status-pill is-${statusTone(task.status)}`}>{statusLabel(task.status)}</span></div>
        <p className="coding-task-instruction">{task.instruction}</p>
        {task.resultSummary && <p className="coding-task-result"><strong>Result</strong> {task.resultSummary}</p>}
        {task.changedFiles?.length ? <details className="coding-task-files"><summary>{task.changedFiles.length} changed file{task.changedFiles.length === 1 ? "" : "s"}</summary><ul>{task.changedFiles.slice(0, 12).map((path) => <li key={path}><code>{path}</code></li>)}</ul>{task.changedFiles.length > 12 && <small>And {task.changedFiles.length - 12} more</small>}</details> : <small>No changed files recorded</small>}
        {task.requiresApproval && <small className="coding-task-approval">This task required approval before execution.</small>}
        <time dateTime={task.updatedAt}>Updated {Number.isNaN(Date.parse(task.updatedAt)) ? "recently" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.updatedAt))}</time>
      </article>)}</div> : <EmptyState title="No task activity" description="Coding runs and their results will remain visible here beside the thread." />}
    </section>
    <section className="coding-task-inspector-section" aria-label="Project verification checks">
      <div className="coding-task-inspector-section-heading"><div><p className="section-kicker">VERIFICATION EVIDENCE</p><strong>Run a detected project check</strong></div><span>{projectChecks.length}</span></div>
      <p>Checks are discovered from the project files and only run when you explicitly choose one. Preflight never executes them.</p>
      <div className="coding-verification-controls">
        <label><span>Task</span><select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} disabled={!tasks.length}><option value="">Select task</option>{recentTasks.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label>
        <label><span>Check</span><select value={selectedCheckId} onChange={(event) => setSelectedCheckId(event.target.value)} disabled={!projectChecks.length}><option value="">Select check</option>{projectChecks.map((check) => <option value={check.id} key={check.id}>{check.label} · {check.command}</option>)}</select></label>
      </div>
      <div className="coding-verification-actions"><Button variant="ghost" disabled={projectChecksBusy} onClick={() => onLoadProjectChecks(projectId)}>{projectChecksBusy ? "Detecting…" : "Refresh checks"}</Button><Button variant="primary" disabled={projectCheckBusy || !selectedTaskId || !selectedCheckId} onClick={() => void onRunProjectCheck(projectId, selectedTaskId, selectedCheckId)}>{projectCheckBusy ? "Running check…" : "Run selected check"}</Button></div>
      {recentTasks.some((task) => task.verificationEvidence) ? <div className="coding-verification-results">{recentTasks.filter((task) => task.verificationEvidence).map((task) => { const evidence = task.verificationEvidence; if (!evidence) return null; return <article className="coding-verification-result" key={`${task.id}-${evidence.completedAtUtc}`}><div className="coding-task-item-heading"><strong>{task.title}</strong><span className={`coding-task-status-pill is-${evidence.exitCode === 0 && !evidence.timedOut ? "complete" : "attention"}`}>{evidence.timedOut ? "Timed out" : `Exit ${evidence.exitCode}`}</span></div><small>{evidence.checkLabel} · {new Date(evidence.completedAtUtc).toLocaleString()} · {evidence.source}{evidence.isolationStatus ? ` · ${evidence.isolationStatus}` : ""}</small><pre tabIndex={0}>{evidence.output || "(no output)"}</pre></article>; })}</div> : <EmptyState title="No verification evidence yet" description="Select a detected check and run it when you are ready to validate the task." />}
    </section>
  </Card>;
}
