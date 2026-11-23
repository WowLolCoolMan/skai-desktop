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
      environment: value.environment === "local" ? "local" : "local",
    };
  } catch {
    try { localStorage.removeItem(PREFILL_KEY); } catch { /* Storage may be disabled. */ }
    return null;
  }
}

export function ChatTaskComposer({ busy, onPlanTask, initialOpen = false }: {
  busy: boolean;
  onPlanTask: (title: string, instruction: string, environment: TaskEnvironment, requiresApproval: boolean) => Promise<boolean>;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [environment, setEnvironment] = useState<TaskEnvironment>("local");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const applyPrefill = () => {
      const prefill = consumeTaskPrefill();
      if (!prefill) return;
      setTitle(prefill.title);
      setInstruction(prefill.instruction);
      setEnvironment(prefill.environment);
      setOpen(true);
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
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const safeTitle = title.trim().slice(0, 200);
    const safeInstruction = instruction.trim().slice(0, 6000);
    if (!safeTitle || !safeInstruction || busy) return;
    const saved = await onPlanTask(safeTitle, safeInstruction, environment, requiresApproval);
    setStatus(saved ? "Plan saved to this conversation for review." : "The plan could not be saved. Check the status message and retry.");
  };

  return <section className={`task-composer chat-task-composer${open ? " is-open" : ""}`} aria-label="Plan a local task">
    <div className="task-composer-heading">
      <div><p className="section-kicker">LOCAL TASK</p><h3>Turn this into a task</h3><p>Save a reviewable plan in this conversation. Planning does not start execution.</p></div>
      <Button variant="secondary" type="button" aria-expanded={open} aria-controls="chat-task-composer-fields" onClick={() => setOpen((value) => !value)}>{open ? "Hide planner" : "Plan a task"}</Button>
    </div>
    {open && <form id="chat-task-composer-fields" onSubmit={(event) => void submit(event)}>
      <div className="task-composer-fields"><label>Task title<input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} required /></label><label>Task brief<textarea value={instruction} maxLength={6000} rows={5} onChange={(event) => setInstruction(event.target.value)} required /></label></div>
      <EnvironmentPicker value={environment} onChange={setEnvironment} />
      <label className="task-require-approval"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /> Require approval before starting the local agent run</label>
      <div className="task-composer-footer"><span role="status">{status || "Review the brief before saving the plan."}</span><Button variant="primary" type="submit" disabled={busy || !title.trim() || !instruction.trim()}>{busy ? "Saving plan…" : "Save plan in thread"}</Button></div>
    </form>}
  </section>;
}
