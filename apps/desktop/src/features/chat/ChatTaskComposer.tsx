import { useEffect, useState, type FormEvent } from "react";
import type { TaskEnvironment } from "../../../shared/contracts";
import { Button } from "../../components/ui/Primitives";
import { EnvironmentPicker } from "../../components/ui/EnvironmentPicker";

const PREFILL_KEY = "skai.chat.taskPrefill";

type TaskPrefill = { title: string; instruction: string; environment: TaskEnvironment };

function consumeTaskPrefill(): TaskPrefill | null {
  try {
    const raw = localStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(PREFILL_KEY);
    const value = JSON.parse(raw) as Partial<TaskPrefill>;
    if (typeof value.title !== "string" || typeof value.instruction !== "string") return null;
    return {
      title: value.title.trim().slice(0, 200),
      instruction: value.instruction.trim().slice(0, 6000),
      environment: value.environment === "worktree" ? "worktree" : "local",
    };
  } catch {
    try { localStorage.removeItem(PREFILL_KEY); } catch { /* Storage may be disabled. */ }
    return null;
  }
}

export function ChatTaskComposer({ busy, onPlanTask, initialOpen = false, expanded, showToggle = true, onExpand, worktreeAvailable = false }: {
  busy: boolean;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, requiresApproval: boolean, gitHubIssueUrl?: string, acceptanceCriteria?: string) => Promise<boolean>;
  initialOpen?: boolean;
  expanded?: boolean;
  showToggle?: boolean;
  onExpand?: () => void;
  worktreeAvailable?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(initialOpen);
  const open = expanded ?? localOpen;
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [environment, setEnvironment] = useState<TaskEnvironment>("local");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [gitHubIssueUrl, setGitHubIssueUrl] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const applyPrefill = () => {
      const prefill = consumeTaskPrefill();
      if (!prefill) return;
      setTitle(prefill.title);
      setInstruction(prefill.instruction);
      setEnvironment(prefill.environment === "worktree" && !worktreeAvailable ? "local" : prefill.environment);
      if (expanded === undefined) setLocalOpen(true);
      else onExpand?.();
      setStatus("");
    };
    const onStorage = (event: StorageEvent) => { if (event.key === PREFILL_KEY) applyPrefill(); };
    applyPrefill();
    window.addEventListener("hashchange", applyPrefill);
    window.addEventListener("skai:task-prefill", applyPrefill);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hashchange", applyPrefill);
      window.removeEventListener("skai:task-prefill", applyPrefill);
      window.removeEventListener("storage", onStorage);
    };
  }, [onExpand, expanded, worktreeAvailable]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const safeTitle = title.trim().slice(0, 200);
    const safeInstruction = instruction.trim().slice(0, 6000);
    if (!safeTitle || !safeInstruction || busy) return;
    const safeIssueUrl = gitHubIssueUrl.trim();
    if (safeIssueUrl && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/issues\/[1-9][0-9]{0,15}\/?$/i.test(safeIssueUrl)) {
      setStatus("Use a GitHub issue link like https://github.com/owner/repository/issues/123.");
      return;
    }
    const saved = await onPlanTask(safeTitle, safeInstruction, environment, requiresApproval, safeIssueUrl, acceptanceCriteria.trim().slice(0, 4_000));
    setStatus(saved ? "Plan saved to this conversation for review." : "The plan could not be saved. Check the status message and retry.");
  };

  return <section className={`task-composer chat-task-composer${open ? " is-open" : ""}`} aria-label="Plan a local task">
    <div className="task-composer-heading">
      <div><p className="section-kicker">LOCAL TASK</p><h3>Turn this into a task</h3><p>Save a reviewable plan in this conversation. Planning does not start execution.</p></div>
      {showToggle && <Button variant="secondary" type="button" aria-expanded={open} aria-controls="chat-task-composer-fields" onClick={() => setLocalOpen((value) => !value)}>{open ? "Hide planner" : "Plan a task"}</Button>}
    </div>
    {open && <form id="chat-task-composer-fields" onSubmit={(event) => void submit(event)}>
      <div className="task-composer-fields"><label>Task title<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} required /></label><label>Task brief<textarea value={instruction} maxLength={6000} rows={3} onChange={(event) => setInstruction(event.target.value)} required /></label><label>GitHub issue link <span className="settings-help">Optional · links the plan to its issue</span><input value={gitHubIssueUrl} maxLength={512} type="url" placeholder="https://github.com/owner/repository/issues/123" onChange={(event) => setGitHubIssueUrl(event.target.value)} /></label><label>Acceptance criteria <span className="settings-help">Optional · included in the agent task context</span><textarea value={acceptanceCriteria} maxLength={4000} rows={2} placeholder="List the checks or outcomes this task must satisfy…" onChange={(event) => setAcceptanceCriteria(event.target.value)} /></label></div>
      <EnvironmentPicker value={environment} worktreeAvailable={worktreeAvailable} onChange={setEnvironment} />
      <label className="task-require-approval"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /> Require approval before starting the local agent run</label>
      <div className="task-composer-footer"><span role="status">{status || "Review the brief before saving the plan."}</span><Button variant="primary" type="submit" disabled={busy || !title.trim() || !instruction.trim()}>{busy ? "Saving plan…" : "Save plan in thread"}</Button></div>
    </form>}
  </section>;
}
