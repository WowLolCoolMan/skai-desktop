import type { DesktopTask } from "../../../shared/contracts";
import type { Route } from "../../app/types";
import { Button } from "../../components/ui/Primitives";

type ChatThreadActivityProps = {
  tasks: DesktopTask[];
  taskBusy: string | null;
  workspaceMode: "conversation" | "project";
  onTaskAction: (id: string, operation: "cancel" | "retry") => void;
  onOpenFile: (path: string) => void;
  onNavigate: (route: Route) => void;
};

const activeStatuses = ["queued", "running", "verifying", "awaiting_approval", "failed", "blocked"];

export function ChatThreadActivity({ tasks, taskBusy, workspaceMode, onTaskAction, onOpenFile, onNavigate }: ChatThreadActivityProps) {
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const approvalCount = tasks.filter((task) => task.status === "awaiting_approval").length;
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const currentTasks = tasks.filter((task) => activeStatuses.includes(task.status));
  const earlierTasks = tasks.filter((task) => !currentTasks.includes(task));

  if (!tasks.length) return null;

  const renderTask = (task: DesktopTask) => <article className={`thread-run-card thread-run-${task.status}`} key={task.id}>
    <div className="thread-run-heading"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}</span></div>
    {task.resultSummary && <p>{task.resultSummary}</p>}
    {(task.changedFiles?.length || task.artifactLabels?.length) ? <div className="thread-run-files">{(task.changedFiles?.length ? task.changedFiles : task.artifactLabels ?? []).map((file) => <code key={file}>{file}</code>)}</div> : null}
    <div className="thread-run-actions">
      {["queued", "running", "verifying"].includes(task.status) && <Button variant="ghost" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "cancel")}>Stop</Button>}
      {["failed", "blocked"].includes(task.status) && <Button variant="secondary" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "retry")}>Retry</Button>}
      {task.status === "completed" && <Button variant="secondary" type="button" onClick={() => { const file = task.changedFiles?.[0]; if (file && workspaceMode === "project") onOpenFile(file); onNavigate("coding"); }}>{task.changedFiles?.length ? "Review first file" : "Review changes"}</Button>}
    </div>
  </article>;

  return <>
    {currentTasks.length > 0 && <details className="thread-run-current" open={currentTasks.length === 1 || activeCount > 0}>
      <summary><strong>Task activity</strong><span>{[activeCount ? `${activeCount} active` : "", queuedCount ? `${queuedCount} queued` : "", approvalCount ? `${approvalCount} awaiting approval` : "", attentionCount ? `${attentionCount} need attention` : ""].filter(Boolean).join(" · ") || `${currentTasks.length} open`}</span></summary>
      <div className="thread-run-current-list">{currentTasks.map(renderTask)}</div>
    </details>}
    {earlierTasks.length > 0 && <details className="thread-run-history"><summary><strong>Earlier tasks · {earlierTasks.length}</strong><span>Plans and past runs</span></summary><div>{earlierTasks.map(renderTask)}</div></details>}
  </>;
}
