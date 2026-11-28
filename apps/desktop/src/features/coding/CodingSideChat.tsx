import { useMemo, useState } from "react";
import type { DesktopTask } from "../../../shared/contracts";
import { Button } from "../../components/ui/Primitives";
import { TaskChatComposer } from "../chat/ChatComposer";

const SIDE_CHAT_PREFIX = "Side chat · ";

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function CodingSideChat({ projectId, conversationId, tasks, busy, onStart, onCancel, onOpenFile }: {
  projectId: string;
  conversationId?: string | null;
  tasks: DesktopTask[];
  busy: boolean;
  onStart: (projectId: string, instruction: string, conversationId?: string | null) => Promise<string | null>;
  onCancel: (taskId: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isBusy = busy || submitting;
  const sideTasks = useMemo(() => tasks
    .filter((task) => task.projectId === projectId && task.conversationId === (conversationId ?? null) && task.title.startsWith(SIDE_CHAT_PREFIX))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8), [conversationId, projectId, tasks]);

  const submit = async (draftOverride?: string) => {
    const instruction = (draftOverride ?? draft).trim();
    if (!instruction || isBusy) return;
    setError("");
    setSubmitting(true);
    try {
      const taskId = await onStart(projectId, instruction, conversationId ?? null);
      if (taskId) setDraft("");
      else setError("The side chat task could not start. Check the project and local model, then try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const activeSideTask = sideTasks.find((task) => ["queued", "running", "verifying"].includes(task.status));

  return <section className="coding-side-chat" aria-label="Side chat subagent">
    <div className="coding-side-chat-intro"><span>Side chat · subagent</span><p>Delegate a focused project task. The main thread stays open while the subagent works.</p></div>
    <div className="coding-side-chat-history" aria-live="polite">
      {sideTasks.length === 0 ? <div className="coding-side-chat-empty"><strong>Start a side task</strong><p>Ask the subagent to inspect, implement, or review a small piece of work in this project.</p></div> : sideTasks.map((task) => <article className="coding-side-chat-turn" key={task.id}>
        <div className="coding-side-chat-user">{task.instruction}</div>
        <div className="coding-side-chat-agent"><header><strong>Subagent</strong><span className={`coding-side-chat-status is-${task.status}`} role="status" aria-live="polite">{statusLabel(task.status)}</span></header>
          <p>{task.resultSummary || (task.status === "failed" || task.status === "blocked" ? "This task needs attention before it can continue." : task.status === "completed" ? "Task completed. Review the changed files in the main editor or Changes tab." : task.status === "awaiting_approval" ? "Waiting for approval before making project changes." : "Working in the selected project…")}</p>
          {task.changedFiles?.length ? <div className="coding-side-chat-files">{task.changedFiles.slice(0, 5).map((file) => <button type="button" key={file} onClick={() => onOpenFile(file)}>{file}</button>)}</div> : null}
          <footer>{["queued", "running", "verifying"].includes(task.status) && <Button variant="ghost" type="button" onClick={() => onCancel(task.id)}>Stop</Button>}{["failed", "blocked"].includes(task.status) && <Button variant="secondary" type="button" disabled={busy} onClick={() => { setDraft(task.instruction); }}>Use prompt again</Button>}</footer>
        </div>
      </article>)}
    </div>
    <TaskChatComposer draft={draft} busy={isBusy} onDraftChange={(value) => setDraft(value.slice(0, 6000))} onSubmit={(value) => void submit(value)} onStop={async () => { if (!activeSideTask) return false; onCancel(activeSideTask.id); return true; }} status={error || (isBusy ? "Side task is starting…" : "Runs as a local project task")} />
  </section>;
}
