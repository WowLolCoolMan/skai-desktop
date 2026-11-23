import { useMemo, useState } from "react";
import type { DesktopScheduledTask, ScheduledTaskDraft } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";

type ScheduleFilter = "active" | "paused" | "completed";
type ScheduledWorkspace = "ChatBot" | "Coding Agent";
type ScheduleTemplate = { icon: NavIconName; title: string; description: string; prompt: string; workspaceMode: ScheduledWorkspace };

const templates: ScheduleTemplate[] = [
  { icon: "sparkle", title: "Daily focus plan", description: "Start the day with three clear priorities.", prompt: "Create a concise, encouraging focus plan for today with three realistic priorities, one quick win, and a short break. Keep it practical and easy to scan.", workspaceMode: "ChatBot" },
  { icon: "code", title: "Coding practice", description: "Get a small programming exercise each day.", prompt: "Give me a 20-minute programming exercise that teaches one useful coding concept. Include the prompt, a small hint, and a concise solution in a separate section.", workspaceMode: "Coding Agent" },
  { icon: "document", title: "Writing warm-up", description: "A fresh prompt to get words flowing.", prompt: "Give me one original writing prompt I can complete in 10 minutes. Make it specific, imaginative, and no more than three sentences.", workspaceMode: "ChatBot" },
  { icon: "activity", title: "Weekly reflection", description: "Review the week and choose a next step.", prompt: "Create a short weekly reflection with three questions about progress, friction, and what to try next week. End with one small, achievable next step.", workspaceMode: "ChatBot" },
  { icon: "project", title: "Plan the week", description: "Turn a goal into a practical weekly outline.", prompt: "Help me plan the coming week. Give me a reusable outline with one main outcome, a few small actions, likely blockers, and a Friday review question. Keep it brief.", workspaceMode: "Coding Agent" },
  { icon: "chat", title: "Daily journal prompts", description: "Three thoughtful prompts for a quick check-in.", prompt: "Give me three thoughtful journaling prompts for a quick daily check-in: one about something that went well, one about what needs attention, and one about what I am looking forward to.", workspaceMode: "ChatBot" },
];

const filterOptions: Array<{ id: ScheduleFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
];

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function scheduleGroup(task: DesktopScheduledTask): ScheduleFilter {
  if (task.status === "paused") return "paused";
  if (task.status === "scheduled" || task.status === "running") return "active";
  return "completed";
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "scheduled" || status === "completed") return "success";
  if (status === "running" || status === "paused") return "warning";
  return "neutral";
}

function dueLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function repeatLabel(minutes?: number | null) {
  if (!minutes) return "Once";
  if (minutes === 60) return "Hourly";
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  return `Every ${minutes} minutes`;
}

export function ScheduledPage({ scheduledTasks, busyTask, loading, loadError, onRetry, onSchedule, onTransition }: {
  scheduledTasks: DesktopScheduledTask[];
  busyTask: string | null;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onSchedule: (draft: ScheduledTaskDraft) => Promise<boolean>;
  onTransition: (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => Promise<boolean>;
}) {
  const [filters, setFilters] = useState<Set<ScheduleFilter>>(() => new Set(filterOptions.map((filter) => filter.id)));
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [dueAt, setDueAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [repeat, setRepeat] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<ScheduledWorkspace>("ChatBot");
  const [formError, setFormError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const filteredTasks = useMemo(() => scheduledTasks.filter((task) => {
    const matchesStatus = filters.has(scheduleGroup(task));
    const matchesQuery = task.prompt.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesStatus && matchesQuery;
  }), [filters, query, scheduledTasks]);
  const selectedTask = filteredTasks.find((task) => task.id === selectedId) ?? filteredTasks[0] ?? null;
  const counts = useMemo(() => ({
    active: scheduledTasks.filter((task) => scheduleGroup(task) === "active").length,
    paused: scheduledTasks.filter((task) => scheduleGroup(task) === "paused").length,
    completed: scheduledTasks.filter((task) => scheduleGroup(task) === "completed").length,
  }), [scheduledTasks]);

  const startFromTemplate = (template: ScheduleTemplate) => {
    setPrompt(template.prompt);
    setWorkspaceMode(template.workspaceMode);
    setDueAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat("");
    setFormError(null);
    setCreating(true);
  };

  const startBlankTask = () => {
    setPrompt("");
    setWorkspaceMode("ChatBot");
    setDueAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat("");
    setFormError(null);
    setCreating(true);
  };

  const submitSchedule = async () => {
    const due = new Date(dueAt);
    if (!prompt.trim()) { setFormError("Add a prompt for the local model to run."); return; }
    if (prompt.trim().length > 6000) { setFormError("Keep the prompt under 6,000 characters."); return; }
    if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) { setFormError("Choose a future local time."); return; }
    if (due.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) { setFormError("Choose a time within the next year."); return; }
    setFormError(null);
    const saved = await onSchedule({ prompt: prompt.trim(), dueAt: due.toISOString(), repeatEveryMinutes: repeat ? Number(repeat) : null, workspaceMode });
    if (saved) { setCreating(false); setSelectedId(null); setQuery(""); }
    else setFormError("The schedule could not be saved. Check the status message and try again.");
  };

  const transition = async (task: DesktopScheduledTask, operation: "pause" | "resume" | "cancel" | "runNow") => {
    setTransitionError(null);
    const saved = await onTransition(task.id, operation);
    if (!saved) setTransitionError("That schedule could not be updated. Refresh and try again.");
  };

  const toggleFilter = (id: ScheduleFilter) => setFilters((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <div className="feature-page scheduled-page">
    <aside className="scheduled-sidebar" aria-label="Scheduled task list">
      <div className="scheduled-sidebar-heading"><div><p className="section-kicker">LOCAL AUTOMATIONS</p><h1>Scheduled</h1></div><details className="scheduled-filter"><summary aria-label="Filter scheduled tasks" title="Filter scheduled tasks"><NavIcon name="activity" /></summary><div className="scheduled-filter-menu"><strong>Status</strong>{filterOptions.map((filter) => <label key={filter.id}><input type="checkbox" checked={filters.has(filter.id)} onChange={() => toggleFilter(filter.id)} /><span>{filter.label}</span><small>{counts[filter.id]}</small></label>)}</div></details></div>
      <Button variant="secondary" className="scheduled-new-button" type="button" onClick={startBlankTask}><NavIcon name="plus" /> New task</Button>
      <label className="scheduled-search"><NavIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a scheduled task" aria-label="Search scheduled tasks" /></label>
      <div className="scheduled-sidebar-list" aria-live="polite">
        {loading ? <p className="scheduled-list-message">Loading schedules…</p> : loadError ? <div className="scheduled-load-error"><p>{loadError}</p><Button variant="secondary" type="button" onClick={onRetry}>Try again</Button></div> : filteredTasks.length === 0 ? <p className="scheduled-list-message">{scheduledTasks.length ? "No schedules match these filters." : "No scheduled tasks yet."}</p> : filteredTasks.map((task) => <button key={task.id} type="button" className={`scheduled-list-item${selectedTask?.id === task.id && !creating ? " is-selected" : ""}`} onClick={() => { setSelectedId(task.id); setCreating(false); setTransitionError(null); }}><span className="scheduled-list-item-heading"><strong>{task.prompt}</strong><StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge></span><small>{dueLabel(task.dueAt)}</small></button>)}
      </div>
      <p className="scheduled-local-note"><NavIcon name="clock" /> Runs locally with your configured model.</p>
    </aside>

    <main className="scheduled-content" aria-label="Scheduled task details">
      {creating ? <section className="scheduled-form-panel"><div className="scheduled-form-heading"><div><p className="section-kicker">NEW AUTOMATION</p><h2>Schedule a task</h2><p>Skai will run this prompt with your configured local model.</p></div><Button variant="ghost" type="button" onClick={() => setCreating(false)}>Close</Button></div>
        <label className="scheduled-prompt-field">Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={6000} rows={7} placeholder="What should the local model do when this runs?" autoFocus /></label>
        <div className="scheduled-form-grid"><label>Run at<input type="datetime-local" value={dueAt} min={localDateTimeValue(new Date())} onChange={(event) => setDueAt(event.target.value)} /></label><label>Repeat<select value={repeat} onChange={(event) => setRepeat(event.target.value)}><option value="">Once</option><option value="60">Hourly</option><option value="1440">Daily</option><option value="10080">Weekly</option></select></label><label>Workspace mode<select value={workspaceMode} onChange={(event) => setWorkspaceMode(event.target.value as ScheduledWorkspace)}><option value="ChatBot">Chat</option><option value="Coding Agent">Coding agent</option></select></label></div>
        <p className="scheduled-form-note"><NavIcon name="activity" /> The task runs as a standalone prompt. It won’t access external services or automatically include a project’s files.</p>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="scheduled-form-actions"><Button variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="button" disabled={busyTask === "schedule" || !prompt.trim()} onClick={() => void submitSchedule()}>{busyTask === "schedule" ? "Saving…" : "Save schedule"}</Button></div>
      </section> : selectedTask ? <section className="scheduled-detail-panel"><div className="scheduled-detail-topline"><p className="section-kicker">SCHEDULE DETAILS</p><StatusBadge tone={statusTone(selectedTask.status)}>{selectedTask.status}</StatusBadge></div><h2>{selectedTask.prompt}</h2><dl className="scheduled-detail-grid"><div><dt>Next run</dt><dd>{selectedTask.status === "completed" || selectedTask.status === "cancelled" || selectedTask.status === "failed" ? "No upcoming run" : dueLabel(selectedTask.dueAt)}</dd></div><div><dt>Repeat</dt><dd>{repeatLabel(selectedTask.repeatEveryMinutes)}</dd></div><div><dt>Workspace mode</dt><dd>{selectedTask.workspaceMode === "Coding Agent" ? "Coding agent" : "Chat"}</dd></div><div><dt>Saved result</dt><dd>{selectedTask.outcome || "No result yet"}</dd></div></dl>
        {transitionError && <p className="form-error" role="alert">{transitionError}</p>}
        <div className="scheduled-detail-actions">{selectedTask.status === "scheduled" && <><Button variant="secondary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "runNow")}>Run now</Button><Button variant="ghost" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "pause")}>Pause</Button></>}{selectedTask.status === "paused" && <Button variant="secondary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "resume")}>Resume</Button>}{(selectedTask.status === "scheduled" || selectedTask.status === "paused") && <Button variant="ghost" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "cancel")}>Cancel schedule</Button>}</div>
      </section> : loading ? <div className="scheduled-loading-state"><span className="scheduled-spinner" /><p>Loading your schedules…</p></div> : scheduledTasks.length ? <EmptyState title="No schedules match" description="Change the status filters or search for a different task." /> : <section className="scheduled-start"><span className="scheduled-hero-icon"><NavIcon name="clock" /></span><p className="section-kicker">LOCAL AUTOMATIONS</p><h2>Schedule a task</h2><p>Set a prompt to run later with the local model on this device.</p><div className="scheduled-template-grid">{templates.map((template) => <button className="scheduled-template-card" type="button" key={template.title} onClick={() => startFromTemplate(template)}><span className="scheduled-template-icon"><NavIcon name={template.icon} /></span><span><strong>{template.title}</strong><small>{template.description}</small></span><NavIcon name="arrow-right" /></button>)}</div></section>}
    </main>
  </div>;
}
