import { useMemo, useState } from "react";
import type { DesktopScheduledTask, ScheduledTaskDraft } from "../../../shared/contracts";
import { Button, Card, EmptyState } from "../../components/ui/Primitives";

function dueLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function repeatLabel(minutes?: number | null) { if (!minutes) return "Once"; if (minutes === 60) return "Hourly"; if (minutes === 1440) return "Daily"; if (minutes === 10080) return "Weekly"; return `Every ${minutes} minutes`; }

export function ChatSchedulesPanel({ conversationId, scheduled, busyTask, onSchedule, onTransition }: { conversationId: string | null; scheduled: DesktopScheduledTask[]; busyTask: string | null; onSchedule: (draft: ScheduledTaskDraft) => Promise<boolean>; onTransition: (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [when, setWhen] = useState(() => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const owned = useMemo(() => scheduled.filter((task) => task.conversationId === conversationId), [conversationId, scheduled]);
  if (!conversationId) return null;
  const submit = async () => {
    const dueAt = new Date(when);
    if (!prompt.trim()) return;
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) { setError("Choose a future local time."); return; }
    setError(null);
    const saved = await onSchedule({ prompt: prompt.trim(), conversationId, dueAt: dueAt.toISOString(), repeatEveryMinutes: repeat ? Number(repeat) : null, workspaceMode: "ChatBot" });
    if (saved) { setPrompt(""); setRepeat(""); setOpen(false); } else setError("The schedule could not be saved.");
  };
  return <Card className={`chat-schedules-panel ${open ? "is-open" : ""}`}><div className="chat-schedules-heading"><div><p className="section-kicker">THIS CONVERSATION</p><strong>Scheduled runs</strong><small>{owned.length ? `${owned.length} local schedule${owned.length === 1 ? "" : "s"}` : "Run a prompt later in this thread"}</small></div><Button variant="ghost" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Close" : "Schedule"}</Button></div>{open && <div className="chat-schedules-body"><div className="chat-schedule-form"><label>Prompt<input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Review project activity" /></label><label>Run at (local time)<input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /></label><label>Repeat<select value={repeat} onChange={(event) => setRepeat(event.target.value)}><option value="">Once</option><option value="60">Hourly</option><option value="1440">Daily</option><option value="10080">Weekly</option></select></label><Button variant="primary" type="button" disabled={busyTask === "schedule" || !prompt.trim()} onClick={() => void submit()}>{busyTask === "schedule" ? "Saving…" : "Save schedule"}</Button></div>{error && <p className="surface-error" role="alert">{error}</p>}{owned.length === 0 ? <EmptyState title="No schedules in this thread" description="Scheduled results will return here as assistant messages." /> : <div className="chat-schedule-list">{owned.map((task) => <div className="chat-schedule-row" key={task.id}><div><strong>{task.prompt}</strong><small>{task.status} · {dueLabel(task.dueAt)} · {repeatLabel(task.repeatEveryMinutes)}</small>{task.outcome && <small>Last result: {task.outcome}</small>}</div><div>{task.status === "scheduled" && <Button variant="ghost" disabled={busyTask === task.id} onClick={() => void onTransition(task.id, "pause")}>Pause</Button>}{task.status === "paused" && <Button variant="ghost" disabled={busyTask === task.id} onClick={() => void onTransition(task.id, "resume")}>Resume</Button>}{task.status === "scheduled" && <Button variant="secondary" disabled={busyTask === task.id} onClick={() => void onTransition(task.id, "runNow")}>Run now</Button>}{(task.status === "scheduled" || task.status === "paused") && <Button variant="ghost" disabled={busyTask === task.id} onClick={() => void onTransition(task.id, "cancel")}>Cancel</Button>}</div></div>)}</div>}</div>}</Card>;
}
