import { useState } from "react";
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
  const [copiedCorrelationId, setCopiedCorrelationId] = useState<string | null>(null);
  const [exportedFailureId, setExportedFailureId] = useState<string | null>(null);
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const approvalCount = tasks.filter((task) => task.status === "awaiting_approval").length;
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const currentTasks = tasks.filter((task) => activeStatuses.includes(task.status));
  const earlierTasks = tasks.filter((task) => !currentTasks.includes(task));
  const dependencyTasks = tasks.filter((task) => task.dependsOn.length > 0);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
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

  const copyCorrelationId = async (taskId: string) => {
    let copied = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(taskId); copied = true; } } catch { /* Try the protected Electron bridge below. */ }
    if (!copied) {
      try { copied = await window.skaiAgent?.clipboard?.writeText(taskId) ?? false; } catch { /* Clipboard access may be unavailable in this runtime. */ }
    }
    if (copied) {
      setCopiedCorrelationId(taskId);
      window.setTimeout(() => setCopiedCorrelationId((current) => current === taskId ? null : current), 1400);
    }
  };

  const exportFailureBundle = (task: DesktopTask) => {
    const bundle = {
      format: "skai-failure-bundle.v1",
      exportedAt: new Date().toISOString(),
      run: { id: task.id, title: task.title, status: task.status, role: task.role, responseMode: task.responseMode ?? null, environment: task.environment ?? "local", projectId: task.projectId ?? null, parentRunId: task.parentRunId ?? null },
      request: { instruction: task.instruction, acceptanceCriteria: task.acceptanceCriteria ?? null, requiresApproval: task.requiresApproval ?? true, dependsOn: task.dependsOn },
      result: { summary: task.resultSummary ?? null, capacityWaitReason: task.capacityWaitReason ?? null, changedFiles: task.changedFiles ?? [], artifacts: task.artifactLabels ?? [] },
      verification: task.verificationEvidence ? { checkLabel: task.verificationEvidence.checkLabel, command: task.verificationEvidence.command, relativeWorkingDirectory: task.verificationEvidence.relativeWorkingDirectory, source: task.verificationEvidence.source, exitCode: task.verificationEvidence.exitCode, timedOut: task.verificationEvidence.timedOut, outputTruncated: task.verificationEvidence.outputTruncated } : null,
      privacy: "This bundle excludes chat history, credentials, exact absolute paths, and provider endpoints. Inspect before sharing.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `skai-failure-${task.id.slice(0, 12)}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportedFailureId(task.id);
    window.setTimeout(() => setExportedFailureId((current) => current === task.id ? null : current), 1600);
  };

  const renderTask = (task: DesktopTask) => <article className={`thread-run-card thread-run-${task.status}`} key={task.id}>
    <div className="thread-run-heading"><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}</span></div>
    <div className="thread-run-correlation"><span>Run ID</span><button type="button" title={`Copy correlation ID ${task.id}`} aria-label={`Copy correlation ID ${task.id}`} onClick={() => void copyCorrelationId(task.id)}>{copiedCorrelationId === task.id ? "Copied" : task.id.slice(0, 16)}</button></div>
    {task.resultSummary && <p>{task.resultSummary}</p>}
    {(task.status === "failed" || task.status === "blocked") && <section className="thread-run-failure" aria-label="Failure recovery guidance"><strong>{task.status === "blocked" ? "Blocked safely" : "Run failed"}</strong><dl><div><dt>Cause</dt><dd>{task.capacityWaitReason || task.resultSummary || "The local runtime did not provide a cause."}</dd></div><div><dt>Scope</dt><dd>{task.changedFiles?.length ? `${task.changedFiles.length} file${task.changedFiles.length === 1 ? "" : "s"} may have changed` : task.environment === "worktree" ? "Isolated worktree · no project files expected" : "No changed files recorded"}</dd></div><div><dt>Retry</dt><dd>{task.status === "blocked" ? "Retry only after resolving the blocker or adding user input." : task.verificationEvidence ? "Retry from the last verified boundary; review the check output first." : "Review the local result before retrying."}</dd></div></dl></section>}
    {task.status === "completed" && <details className="thread-run-report"><summary>Completion report</summary><dl><div><dt>Requested</dt><dd>{task.instruction || "No instruction recorded"}</dd></div><div><dt>Verified</dt><dd>{task.verificationEvidence ? `${task.verificationEvidence.checkLabel} · exit ${task.verificationEvidence.exitCode}` : "No verification evidence recorded"}</dd></div><div><dt>Artifacts</dt><dd>{task.changedFiles?.length || task.artifactLabels?.length ? `${(task.changedFiles ?? task.artifactLabels ?? []).length} local artifact${(task.changedFiles ?? task.artifactLabels ?? []).length === 1 ? "" : "s"}` : "None recorded"}</dd></div><div><dt>Deferred</dt><dd>{task.verificationEvidence?.exitCode === 0 ? "Nothing marked deferred" : "Verification remains open"}</dd></div></dl></details>}
    {(task.changedFiles?.length || task.artifactLabels?.length) ? <div className="thread-run-files">{(task.changedFiles?.length ? task.changedFiles : task.artifactLabels ?? []).map((file) => <code key={file}>{file}</code>)}</div> : null}
    <div className="thread-run-actions">
      {["queued", "running", "verifying"].includes(task.status) && <Button variant="ghost" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "cancel")}>Stop</Button>}
      {task.status === "blocked" && <Button variant="secondary" type="button" disabled={taskBusy === task.id} onClick={() => onTaskAction(task.id, "retry")}>Retry</Button>}
      {(task.status === "failed" || task.status === "blocked") && <Button variant="secondary" type="button" onClick={() => exportFailureBundle(task)}>{exportedFailureId === task.id ? "Bundle downloaded" : "Export safe bundle"}</Button>}
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
    {dependencyTasks.length > 0 && <details className="thread-dependency-graph" open>
      <summary><strong>Task dependencies</strong><span>{dependencyTasks.length} waiting chain{dependencyTasks.length === 1 ? "" : "s"}</span></summary>
      <div className="thread-dependency-list">{dependencyTasks.map((task) => { const prerequisites = task.dependsOn.map((id) => taskById.get(id)); const ready = prerequisites.every((item) => item?.status === "completed"); return <div className={`thread-dependency-row is-${ready ? "ready" : "waiting"}`} key={task.id}><div><strong>{task.title}</strong><small>{ready ? "Ready to run" : "Waiting on prerequisites"}</small></div><span aria-label={`${prerequisites.length} prerequisites`}>{prerequisites.map((item, index) => <span key={task.dependsOn[index]} className={`thread-dependency-chip is-${item?.status ?? "missing"}`} title={item ? `${item.title} · ${item.status}` : `Missing task ${task.dependsOn[index]}`}>{item?.title ?? "Missing task"}</span>)}</span></div>; })}</div>
    </details>}
    {currentTasks.length > 0 && <details className="thread-run-current" open={currentTasks.length === 1 || activeCount > 0}>
      <summary><strong>Task activity</strong><span>{[activeCount ? `${activeCount} active` : "", queuedCount ? `${queuedCount} queued` : "", approvalCount ? `${approvalCount} awaiting approval` : "", attentionCount ? `${attentionCount} need attention` : ""].filter(Boolean).join(" · ") || `${currentTasks.length} open`}</span></summary>
      <div className="thread-run-current-list">{currentTasks.map(renderTask)}</div>
    </details>}
    {earlierTasks.length > 0 && <details className="thread-run-history"><summary><strong>Earlier tasks · {earlierTasks.length}</strong><span>Plans and past runs</span></summary><div>{earlierTasks.map(renderTask)}</div></details>}
  </>;
}
