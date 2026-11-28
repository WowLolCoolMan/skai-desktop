import { useEffect, useState } from "react";
import type { DesktopProjectCheck, DesktopTask, DesktopGitStatus, DesktopTaskWorkerDraft } from "../../../shared/contracts";
import type { Model } from "../../app/types";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

type CodingTaskInspectorProps = {
  projectId: string;
  tasks: DesktopTask[];
  models: Model[];
  projectChecks: DesktopProjectCheck[];
  projectChecksBusy: boolean;
  projectCheckBusy: boolean;
  gitStatus: DesktopGitStatus | null;
  gitDiffReady: boolean;
  gitDiffBusy: boolean;
  onReviewChanges: (paths?: string[]) => void;
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

function statusLabel(status: string) {
  switch (status) {
    case "proposed":
      return "Planned";
    case "running":
      return "Running";
    case "verifying":
      return "Verifying";
    case "queued":
      return "Queued";
    case "completed":
    case "succeeded":
      return "Complete";
    case "cancelled":
      return "Stopped";
    case "awaiting_approval":
      return "Waiting for you";
    case "failed":
    case "blocked":
      return "Needs attention";
    default:
      return status || "Unknown";
  }
}

function taskNextStep(task: DesktopTask) {
  switch (task.status) {
    case "proposed": return "Review and queue this plan when it is ready.";
    case "queued": return task.capacityWaitReason || "Waiting for a local execution slot.";
    case "awaiting_approval": return "Your approval is needed before this task can continue.";
    case "running": return "Working through the task plan.";
    case "verifying": return "Checking the result before completing the task.";
    case "completed": return task.verificationEvidence
      ? `Verified with ${task.verificationEvidence.checkLabel} (exit ${task.verificationEvidence.exitCode}).`
      : "Work is complete. Review the summary and changed files.";
    case "failed": return task.resultSummary || "The task failed. Review its activity for the failure context.";
    case "blocked": return task.resultSummary || "The task is blocked and needs a decision.";
    case "cancelled": return "Stopped before verification.";
    default: return "Review the task activity for its latest state.";
  }
}

function contradictionFlagged(task: DesktopTask) {
  return task.status === "blocked" && task.resultSummary?.startsWith("Contradiction flagged before editing") === true;
}

function activityLabel(type: string) {
  const labels: Record<string, string> = {
    "task.proposed": "Plan created",
    "task.queued": "Added to queue",
    "task.execution_started": "Work started",
    "task.approval_required": "Approval requested",
    "task.contradiction_flagged": "Contradiction flagged before editing",
    "task.approved": "Approved",
    "task.denied": "Approval denied",
    "task.delegation_created": "Delegated work",
    "task.worker_finished": "Worker finished",
    "task.verification.completed": "Task completed",
    "task.cancelled": "Task stopped",
    "task.follow_up_added": "Follow-up added",
    "task.follow_up_applied": "Follow-up applied",
    "task.failed": "Task failed",
    "tool.read_file.completed": "Read a file",
    "tool.write_file.completed": "Edited a file",
    "tool.write_file.rejected": "Edit was not applied",
    "tool.replace_text.completed": "Updated a file",
    "tool.command.completed": "Command finished",
    "tool.preview_page.completed": "Inspected the browser preview",
    "tool.plugin.completed": "Plugin tool finished",
    "tool.plugin.denied": "Plugin tool was declined",
    "tool.generate_3d.completed": "Generated a 3D asset",
    "tool.rig_3d.completed": "Rigged a 3D asset",
  };
  return labels[type] ?? type.replaceAll(".", " · ").replaceAll("_", " ");
}

function activityDetail(payload: Record<string, string>) {
  const safeKeys = ["path", "workingDirectory", "exitCode", "timedOut", "characters", "childCount", "status", "toolName", "url", "outputCharacters"];
  return safeKeys.flatMap((key) => payload[key] ? [`${key}: ${payload[key]}`] : []).join(" · ");
}

function statusTone(status: string) {
  if (status === "failed" || status === "blocked") return "attention";
  if (status === "running" || status === "verifying") return "active";
  if (status === "queued") return "queued";
  return "complete";
}

function taskActionVersion(task: DesktopTask) {
  return `${task.status}:${task.worktreePath ?? ""}`;
}

const taskStages = ["Queued", "Working", "Verifying", "Completed"] as const;

function taskStageIndex(status: string) {
  if (status === "running") return 1;
  if (status === "verifying") return 2;
  if (status === "completed" || status === "succeeded") return 3;
  if (status === "failed" || status === "blocked" || status === "awaiting_approval") return 1;
  return 0;
}

export function CodingTaskInspector({ projectId, tasks, models, projectChecks, projectChecksBusy, projectCheckBusy, gitStatus, gitDiffReady, gitDiffBusy, onReviewChanges, onLoadProjectChecks, onRunProjectCheck, onCancelTask, onTransitionTask, onSteerTask, onDelegateTask, onOpenTaskWorktree, onPlanTask, onExecuteTask }: CodingTaskInspectorProps) {
  const recentTasks = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedCheckId, setSelectedCheckId] = useState("");
  const [stoppingTaskIds, setStoppingTaskIds] = useState<string[]>([]);
  const [pendingTaskActions, setPendingTaskActions] = useState<Record<string, string>>({});
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [steeringTaskId, setSteeringTaskId] = useState<string | null>(null);
  const [delegationTaskId, setDelegationTaskId] = useState<string | null>(null);
  const [delegationDrafts, setDelegationDrafts] = useState<DesktopTaskWorkerDraft[]>([{ title: "", instruction: "", role: "implementer" }]);
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [openingWorktreeId, setOpeningWorktreeId] = useState<string | null>(null);
  const [worktreeOpenError, setWorktreeOpenError] = useState<string | null>(null);
  const [recoveryTaskId, setRecoveryTaskId] = useState<string | null>(null);
  const changedPaths = gitStatus?.changes.map((change) => change.path) ?? [];
  const attentionCount = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const activeCount = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;

  useEffect(() => {
    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(recentTasks[0]?.id ?? "");
  }, [recentTasks, selectedTaskId, tasks]);
  useEffect(() => {
    if (!selectedCheckId || !projectChecks.some((check) => check.id === selectedCheckId)) setSelectedCheckId(projectChecks[0]?.id ?? "");
  }, [projectChecks, selectedCheckId]);

  useEffect(() => {
    setPendingTaskActions((pending) => {
      const next = Object.fromEntries(Object.entries(pending).filter(([taskId, expectedVersion]) => {
        const task = tasks.find((item) => item.id === taskId);
        return task ? taskActionVersion(task) === expectedVersion : false;
      }));
      return Object.keys(next).length === Object.keys(pending).length ? pending : next;
    });
  }, [tasks]);

  const runTaskAction = (task: DesktopTask, run: () => void) => {
    const version = taskActionVersion(task);
    setPendingTaskActions((pending) => ({ ...pending, [task.id]: version }));
    run();
    window.setTimeout(() => setPendingTaskActions((pending) => {
      if (pending[task.id] !== version) return pending;
      const next = { ...pending };
      delete next[task.id];
      return next;
    }), 10_000);
  };

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
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Task {task.title}: {statusLabel(task.status)}. {taskNextStep(task)}</p>
        <div className="coding-task-item-heading"><strong>{task.title}</strong><div className="coding-task-item-controls"><span className={`coding-task-status-pill is-${statusTone(task.status)}`}>{statusLabel(task.status)}</span>{(task.status === "running" || task.status === "verifying") && <Button variant="ghost" type="button" disabled={stoppingTaskIds.includes(task.id)} onClick={() => { setStoppingTaskIds((ids) => ids.includes(task.id) ? ids : [...ids, task.id]); onCancelTask(task.id); }}>{stoppingTaskIds.includes(task.id) ? "Stopping…" : "Stop"}</Button>}</div></div>
        {task.status === "proposed" && <div className="coding-task-actions"><Button variant="primary" type="button" disabled={Boolean(pendingTaskActions[task.id])} onClick={() => runTaskAction(task, () => onTransitionTask(task.id, "queue"))}>{pendingTaskActions[task.id] ? "Adding to queue…" : "Queue plan"}</Button><small>Queueing only prepares this plan; execution still needs an explicit start.</small></div>}
        {task.status === "awaiting_approval" && <div className="coding-task-actions"><Button variant="primary" type="button" disabled={Boolean(pendingTaskActions[task.id])} onClick={() => runTaskAction(task, () => onTransitionTask(task.id, "approve"))}>{pendingTaskActions[task.id] ? "Approving…" : "Approve"}</Button><Button variant="secondary" type="button" disabled={Boolean(pendingTaskActions[task.id])} onClick={() => runTaskAction(task, () => onTransitionTask(task.id, "deny"))}>Decline</Button><small>No tools run until you approve and start the task.</small></div>}
        {task.status === "queued" && <div className="coding-task-actions"><Button variant="primary" type="button" disabled={Boolean(pendingTaskActions[task.id])} onClick={() => runTaskAction(task, () => onExecuteTask(task.id))}>{pendingTaskActions[task.id] ? "Starting…" : "Start task"}</Button><small>Starting runs this task against its selected local environment.</small></div>}
        {task.status === "blocked" && <div className="coding-task-actions"><Button variant="secondary" type="button" disabled={Boolean(pendingTaskActions[task.id]) || Boolean(task.worktreePath)} title={task.worktreePath ? "Review or release the retained worktree before retrying." : undefined} onClick={() => runTaskAction(task, () => onTransitionTask(task.id, "retry"))}>{pendingTaskActions[task.id] ? "Re-queueing…" : "Retry task"}</Button>{task.worktreePath && <small>Review or release the retained worktree before retrying.</small>}{contradictionFlagged(task) && <small>No file was edited. Resolve the conflicting instruction, then retry.</small>}</div>}
        {task.status === "failed" && <div className="coding-task-actions"><small>This run failed. Its history stays available for review.</small><Button variant="secondary" type="button" disabled={recoveryTaskId === task.id} onClick={() => { setRecoveryTaskId(task.id); const title = `Retry: ${task.title}`.slice(0, 180); void onPlanTask(title, task.instruction, task.environment === "worktree" ? "worktree" : "local", task.conversationId, true, task.projectId ?? projectId).finally(() => setRecoveryTaskId(null)); }}>{recoveryTaskId === task.id ? "Creating approved plan…" : "Create new approval-gated plan"}</Button><small>The new run starts as a proposal and still needs approval before execution.</small></div>}
        {task.status === "running" && <details className="coding-task-steering"><summary>Steer this task</summary><form onSubmit={(event) => { event.preventDefault(); const instruction = followUpDraft.trim(); if (!instruction || steeringTaskId) return; setSteeringTaskId(task.id); void onSteerTask(task.id, instruction).then((added) => { if (added) setFollowUpDraft(""); }).finally(() => setSteeringTaskId(null)); }}><label><span className="sr-only">Follow-up instruction for {task.title}</span><textarea value={followUpDraft} onChange={(event) => setFollowUpDraft(event.target.value)} maxLength={4_000} rows={2} placeholder="Add direction while this task is running…" /></label><div><small>Added to task history and applied on its next model turn.</small><Button variant="secondary" type="submit" disabled={!followUpDraft.trim() || Boolean(steeringTaskId)}>{steeringTaskId === task.id ? "Adding…" : "Send follow-up"}</Button></div></form></details>}
        {task.parentRunId == null && task.environment !== "worktree" && (task.status === "queued" || task.status === "running") && <details className="coding-task-delegation"><summary>Delegate specialist work</summary><p>Split independent work into up to six scoped tasks. Each specialist can use any discovered local chat model or inherit the parent model. New specialists start as proposals; queued work uses the normal local capacity limit.</p><form onSubmit={(event) => { event.preventDefault(); if (delegationTaskId) return; const workers = delegationDrafts.map((worker) => ({ ...worker, title: worker.title.trim(), instruction: worker.instruction.trim(), role: worker.role.trim() || "subagent" })); if (!workers.length || workers.some((worker) => !worker.title || !worker.instruction)) { setDelegationError("Add a title and specific instruction for each specialist."); return; } setDelegationTaskId(task.id); setDelegationError(null); void onDelegateTask(task.id, workers).then((created) => { if (created) setDelegationDrafts([{ title: "", instruction: "", role: "implementer" }]); else setDelegationError("The specialist tasks could not be created. Check task status, environment, and the task limit."); }).finally(() => setDelegationTaskId(null)); }}>
          {delegationDrafts.map((worker, index) => <fieldset className="coding-task-delegation-worker" key={index}><legend>Specialist {index + 1}</legend><label><span>Role</span><select value={worker.role} onChange={(event) => setDelegationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, role: event.target.value } : item))}><option value="planner">Planner</option><option value="implementer">Implementer</option><option value="reviewer">Reviewer</option><option value="verifier">Verifier</option><option value="researcher">Researcher</option></select></label><label><span>Model</span><select value={worker.model ? `${worker.modelProvider ?? "Local API"}::${worker.model}` : ""} onChange={(event) => setDelegationDrafts((current) => current.map((item, itemIndex) => { if (itemIndex !== index) return item; const selected = models.find((model) => `${model.provider ?? "Local API"}::${model.model}` === event.target.value); return { ...item, model: selected?.model, modelProvider: selected?.provider ?? "Local API", modelSizeBytes: selected?.sizeBytes, modelContextLength: selected?.contextLength, airLlmCompatible: Boolean(selected && ((selected.provider ?? "").toLowerCase() === "airllm" || selected.model.includes("/"))) }; }))}><option value="">Inherit the parent model</option>{models.map((model) => <option key={`${model.provider ?? "Local API"}::${model.model}`} value={`${model.provider ?? "Local API"}::${model.model}`}>{model.displayName || model.model} · {model.provider ?? "Local API"}</option>)}</select></label><label><span>Task title</span><input value={worker.title} maxLength={180} onChange={(event) => setDelegationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="e.g. Review the API boundary" /></label><label><span>Scoped instruction</span><textarea value={worker.instruction} maxLength={6_000} rows={3} onChange={(event) => setDelegationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item))} placeholder="Describe one independent deliverable and its constraints…" /></label>{delegationDrafts.length > 1 && <Button variant="ghost" type="button" onClick={() => setDelegationDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove specialist</Button>}</fieldset>)}
          {delegationError && <p role="alert" className="coding-task-delegation-error">{delegationError}</p>}<div className="coding-task-delegation-actions"><Button variant="ghost" type="button" disabled={delegationDrafts.length >= 6 || Boolean(delegationTaskId)} onClick={() => setDelegationDrafts((current) => [...current, { title: "", instruction: "", role: "reviewer" }])}>Add specialist</Button><Button variant="secondary" type="submit" disabled={Boolean(delegationTaskId)}>{delegationTaskId === task.id ? "Creating specialists…" : "Create specialist tasks"}</Button></div>
        </form></details>}
        {!!task.followUpInstructions?.length && <details className="coding-task-follow-ups"><summary>{task.followUpInstructions.length} follow-up instruction{task.followUpInstructions.length === 1 ? "" : "s"}</summary><ol>{task.followUpInstructions.map((instruction, index) => <li key={`${index}-${instruction}`}>{instruction}</li>)}</ol></details>}
        {task.environment === "worktree" && <div className="coding-task-worktree"><strong>{task.worktreePath ? "Retained isolated worktree" : "Isolated worktree"}</strong>{task.worktreeBranch && <code>{task.worktreeBranch}</code>}{task.worktreePath ? <><small title={task.worktreePath}>{task.worktreePath}</small><Button variant="secondary" type="button" disabled={openingWorktreeId === task.id} onClick={() => { setOpeningWorktreeId(task.id); setWorktreeOpenError(null); void onOpenTaskWorktree(task.id).then((opened) => { if (!opened) setWorktreeOpenError("The retained worktree folder could not be opened."); }).finally(() => setOpeningWorktreeId(null)); }}>{openingWorktreeId === task.id ? "Opening folder…" : "Open worktree folder"}</Button>{worktreeOpenError && <small role="status">{worktreeOpenError}</small>}{!["proposed", "queued", "awaiting_approval", "running", "verifying"].includes(task.status) && <Button variant="secondary" type="button" disabled={Boolean(pendingTaskActions[task.id])} onClick={() => { if (window.confirm(`Release the clean worktree for “${task.title}”? This removes the checkout from disk and keeps the Git branch.`)) runTaskAction(task, () => onTransitionTask(task.id, "release")); }}>{pendingTaskActions[task.id] ? "Releasing worktree…" : "Release clean worktree"}</Button>}<small>Only a clean checkout can be released. The task branch remains available in Git.</small></> : task.status === "completed" || task.status === "failed" || task.status === "blocked" || task.status === "cancelled" ? <small>Its retained checkout has been released.</small> : <small>The isolated checkout will be attached when execution starts.</small>}</div>}
        {task.status === "cancelled" ? <small>Stopped before verification.</small> : <ol className="coding-task-progress" aria-label={`Task progress: ${statusLabel(task.status)}`}>
          {taskStages.map((stage, index) => <li key={stage} className={index < taskStageIndex(task.status) ? "is-complete" : index === taskStageIndex(task.status) ? "is-current" : ""} aria-current={index === taskStageIndex(task.status) ? "step" : undefined}><span aria-hidden="true" />{stage}</li>)}
        </ol>}
        <div className={`coding-task-next-step is-${statusTone(task.status)}`}><strong>{task.status === "awaiting_approval" ? "Waiting for you" : task.status === "completed" ? "Completed" : contradictionFlagged(task) ? "Contradiction flagged" : task.status === "failed" || task.status === "blocked" ? "Needs attention" : "Next"}</strong><span>{taskNextStep(task)}</span></div>
        <div className="coding-task-model-context"><span><small>{["proposed", "queued", "awaiting_approval"].includes(task.status) ? "MODEL ASSIGNMENT" : "MODEL USED"}</small><strong>{task.model ? `${task.modelProvider || "Local runtime"} · ${task.model}` : "Inherited coding model · resolved when execution starts"}</strong></span>{task.modelContextLength && <span><small>CONTEXT</small><strong>{task.modelContextLength.toLocaleString()} tokens</strong></span>}{task.modelSizeBytes != null && <span><small>MODEL SIZE</small><strong>{(task.modelSizeBytes / (1024 ** 3)).toFixed(1)} GiB</strong></span>}</div>
        <p className="coding-task-instruction">{task.instruction}</p>
        {tasks.some((child) => child.parentRunId === task.id) && <div className="coding-task-children" aria-label="Delegated subagents">
          <strong>Delegated work</strong>
          {tasks.filter((child) => child.parentRunId === task.id).map((child) => <div className="coding-task-child" key={child.id}>
            <span>{child.title}{child.model && <small className="coding-task-child-model">{child.modelProvider || "Local runtime"} · {child.model}</small>}</span><span className={`coding-task-status-pill is-${statusTone(child.status)}`}>{statusLabel(child.status)}</span>
          </div>)}
        </div>}
        {task.resultSummary && <p className="coding-task-result"><strong>Result</strong> {task.resultSummary}</p>}
        {task.verificationEvidence && <div className="coding-task-verification-summary"><strong>{task.verificationEvidence.timedOut ? "Verification timed out" : task.verificationEvidence.exitCode === 0 ? "Verification passed" : `Verification failed · exit ${task.verificationEvidence.exitCode}`}</strong><span>{task.verificationEvidence.checkLabel} · {task.verificationEvidence.source}</span><details><summary>Show verification output</summary><pre tabIndex={0}>{task.verificationEvidence.output || "(no output)"}</pre></details></div>}
        {task.changedFiles?.length ? <details className="coding-task-files"><summary>{task.changedFiles.length} changed file{task.changedFiles.length === 1 ? "" : "s"}</summary><ul>{task.changedFiles.slice(0, 12).map((path) => <li key={path}><code>{path}</code></li>)}</ul>{task.changedFiles.length > 12 && <small>And {task.changedFiles.length - 12} more</small>}<Button variant="ghost" type="button" disabled={gitDiffBusy} onClick={() => onReviewChanges(task.changedFiles)}>{gitDiffReady ? "Review task diff" : "Load task diff"}</Button></details> : <small>No changed files recorded</small>}
        {task.requiresApproval && <small className="coding-task-approval">This task required approval before execution.</small>}
        {task.activity?.length ? <details className="coding-task-activity"><summary>Activity timeline · {task.activity.length}{task.activity.length === 40 ? "+" : ""}</summary><ol>{task.activity.map((event) => <li key={`${event.sequence}-${event.type}`}><span className="coding-task-activity-marker" aria-hidden="true" /><div><strong>{activityLabel(event.type)}</strong>{activityDetail(event.payload) && <small>{activityDetail(event.payload)}</small>}</div><time dateTime={event.timestamp}>{Number.isNaN(Date.parse(event.timestamp)) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(event.timestamp))}</time></li>)}</ol></details> : null}
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
