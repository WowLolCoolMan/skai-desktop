import type { DesktopTask, DesktopGitStatus } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

type CodingTaskInspectorProps = {
  tasks: DesktopTask[];
  gitStatus: DesktopGitStatus | null;
  gitDiffReady: boolean;
  gitDiffBusy: boolean;
  onReviewChanges: (paths?: string[]) => void;
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

export function CodingTaskInspector({ tasks, gitStatus, gitDiffReady, gitDiffBusy, onReviewChanges }: CodingTaskInspectorProps) {
  const recentTasks = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const changedPaths = gitStatus?.changes.map((change) => change.path) ?? [];
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;

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
        {task.resultSummary && <p>{task.resultSummary}</p>}
        {task.changedFiles?.length ? <small>{task.changedFiles.length} changed file{task.changedFiles.length === 1 ? "" : "s"}</small> : null}
      </article>)}</div> : <EmptyState title="No task activity" description="Coding runs and their results will remain visible here beside the thread." />}
    </section>
  </Card>;
}
