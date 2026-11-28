import type { DesktopTask } from "../../../shared/contracts";
import type { Message } from "../../app/types";
import type { Route } from "../../app/types";
import { Button } from "../../components/ui/Primitives";
import "./ChatThreadActivity.css";

type ChatThreadActivityProps = {
  tasks: DesktopTask[];
  messages: Message[];
  taskBusy: string | null;
  workspaceMode: "conversation" | "project";
  onTaskAction: (id: string, operation: "cancel" | "retry") => void;
  onOpenFile: (path: string) => void;
  onNavigate: (route: Route) => void;
};

const activeStatuses = ["queued", "running", "verifying", "awaiting_approval", "failed", "blocked"];

export function ChatThreadActivity({ tasks, messages, taskBusy, workspaceMode, onTaskAction, onOpenFile, onNavigate }: ChatThreadActivityProps) {
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const approvalCount = tasks.filter((task) => task.status === "awaiting_approval").length;
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const currentTasks = tasks.filter((task) => activeStatuses.includes(task.status));
  const earlierTasks = tasks.filter((task) => !currentTasks.includes(task));
  const timelineEvents = [
    ...messages.map((message, index) => ({
      id: `message:${index}`,
      kind: message.role === "user" ? "chat-user" : "chat-agent",
      label: message.role === "user" ? "You" : "Agent",
      detail: message.content.replace(/\s+/g, " ").trim().slice(0, 180),
      timestamp: message.createdAtUtc ?? "",
    })),
    ...tasks.flatMap((task) => (task.activity ?? []).map((event) => ({
      id: `task:${task.id}:${event.sequence}`,
      kind: "task-event",
      label: task.title,
      detail: [event.type.replaceAll("_", " "), event.actor, event.payload?.detail ?? event.payload?.command ?? event.payload?.path].filter(Boolean).join(" · ").slice(0, 180),
      timestamp: event.timestamp,
    }))),
  ].filter((event) => event.detail && Number.isFinite(Date.parse(event.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 24);

  if (!tasks.length) return null;

  const renderTask = (task: DesktopTask) => <article className={`thread-run-card thread-run-${task.status}`} key={task.id}>
    <div className="thread-run-heading"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}</span></div>
    {task.resultSummary && <p>{task.resultSummary}</p>}
    {(task.changedFiles?.length || task.artifactLabels?.length) ? <div className="thread-run-files">{(task.changedFiles?.length ? task.changedFiles : task.artifactLabels ?? []).map((file) => <code key={file}>{file}</code>)}</div> : null}
    <div className="thread-run-actions">
      {["queued", "running", "verifying"].includes(task.status) && <Button variant="ghost" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "cancel")}>Stop</Button>}
      {task.status === "blocked" && <Button variant="secondary" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "retry")}>Retry</Button>}
      {task.status === "completed" && <Button variant="secondary" type="button" onClick={() => { const file = task.changedFiles?.[0]; if (file && workspaceMode === "project") onOpenFile(file); onNavigate("coding"); }}>{task.changedFiles?.length ? "Review first file" : "Review changes"}</Button>}
    </div>
  </article>;

  return <>
    {timelineEvents.length > 0 && <details className="thread-activity-timeline" open>
      <summary><strong>Activity timeline</strong><span>{timelineEvents.length} recent event{timelineEvents.length === 1 ? "" : "s"}</span></summary>
      <ol aria-label="Conversation and task activity">
        {timelineEvents.map((event) => <li className={`thread-activity-event is-${event.kind}`} key={event.id}>
          <span className="thread-activity-dot" aria-hidden="true" />
          <div><strong>{event.label}</strong><p>{event.detail}</p></div>
          <time dateTime={event.timestamp} title={new Date(event.timestamp).toLocaleString()}>{new Date(event.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        </li>)}
      </ol>
    </details>}
    {currentTasks.length > 0 && <details className="thread-run-current" open={currentTasks.length === 1 || activeCount > 0}>
      <summary><strong>Task activity</strong><span>{[activeCount ? `${activeCount} active` : "", queuedCount ? `${queuedCount} queued` : "", approvalCount ? `${approvalCount} awaiting approval` : "", attentionCount ? `${attentionCount} need attention` : ""].filter(Boolean).join(" · ") || `${currentTasks.length} open`}</span></summary>
      <div className="thread-run-current-list">{currentTasks.map(renderTask)}</div>
    </details>}
    {earlierTasks.length > 0 && <details className="thread-run-history"><summary><strong>Earlier tasks · {earlierTasks.length}</strong><span>Plans and past runs</span></summary><div>{earlierTasks.map(renderTask)}</div></details>}
  </>;
}
