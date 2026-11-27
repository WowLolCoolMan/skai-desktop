import { useMemo, useState } from "react";
import type { DesktopScheduledTask, DesktopTask, ScheduledTaskDraft } from "../../../shared/contracts";
import { Button, EmptyState, StatusBadge } from "../../components/ui/Primitives";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";

type ScheduleFilter = "active" | "paused" | "completed";
type ScheduledWorkspace = "ChatBot" | "Coding Agent";
type TriggerType = "schedule" | "manual" | "project_event" | "webhook";
type OverlapPolicy = "skip" | "queue" | "replace";
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
  if (task.status === "scheduled" || task.status === "running" || task.status === "needs_decision") return "active";
  return "completed";
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "scheduled" || status === "completed") return "success";
  if (status === "running" || status === "paused" || status === "needs_decision") return "warning";
  return "neutral";
}

function dueLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function localTimeZoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "this device's local time zone";
}

function repeatLabel(minutes?: number | null) {
  if (!minutes) return "Once";
  if (minutes === 60) return "Hourly";
  if (minutes === 1440) return "Daily";
  if (minutes === 10080) return "Weekly";
  return `Every ${minutes} minutes`;
}

export function ScheduledPage({ scheduledTasks, successfulTasks, busyTask, loading, loadError, provider, model, onRetry, onSchedule, onPreview, onTransition }: {
  scheduledTasks: DesktopScheduledTask[];
  successfulTasks: DesktopTask[];
  busyTask: string | null;
  loading: boolean;
  loadError: string | null;
  provider: string;
  model: string;
  onRetry: () => void;
  onSchedule: (draft: ScheduledTaskDraft) => Promise<boolean>;
  onPreview: (prompt: string, workspaceMode?: ScheduledWorkspace) => Promise<string | null>;
  onTransition: (id: string, operation: "pause" | "resume" | "cancel" | "runNow" | "resolveMissed", choice?: "run_once" | "skip") => Promise<boolean>;
}) {
  const [filters, setFilters] = useState<Set<ScheduleFilter>>(() => new Set(filterOptions.map((filter) => filter.id)));
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [dueAt, setDueAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [repeat, setRepeat] = useState("");
  const [missedRunPolicy, setMissedRunPolicy] = useState<"run_once" | "skip" | "ask_first">("run_once");
  const [workspaceMode, setWorkspaceMode] = useState<ScheduledWorkspace>("ChatBot");
  const [triggerType, setTriggerType] = useState<TriggerType>("schedule");
  const [triggerValue, setTriggerValue] = useState("");
  const [overlapPolicy, setOverlapPolicy] = useState<OverlapPolicy>("skip");
  const [sourceTaskId, setSourceTaskId] = useState("");
  const [sourceWorkflowName, setSourceWorkflowName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
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
    setMissedRunPolicy("run_once");
    setTriggerType("schedule"); setTriggerValue(""); setOverlapPolicy("skip"); setSourceTaskId(""); setSourceWorkflowName("");
    setPreview(null);
    setFormError(null);
    setCreating(true);
  };

  const startBlankTask = () => {
    setPrompt("");
    setWorkspaceMode("ChatBot");
    setDueAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat("");
    setMissedRunPolicy("run_once");
    setTriggerType("schedule"); setTriggerValue(""); setOverlapPolicy("skip"); setSourceTaskId(""); setSourceWorkflowName("");
    setPreview(null);
    setFormError(null);
    setCreating(true);
  };

  const duplicateTask = (task: DesktopScheduledTask) => {
    setPrompt(task.prompt);
    setWorkspaceMode(task.workspaceMode === "Coding Agent" ? "Coding Agent" : "ChatBot");
    setDueAt(localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    setRepeat(task.repeatEveryMinutes?.toString() ?? "");
    setMissedRunPolicy(task.missedRunPolicy ?? "run_once");
    setTriggerType(task.triggerType ?? "schedule"); setTriggerValue(task.triggerValue ?? ""); setOverlapPolicy(task.overlapPolicy ?? "skip"); setSourceTaskId(task.sourceTaskId ?? ""); setSourceWorkflowName(task.sourceWorkflowName ?? "");
    setPreview(null);
    setFormError(null);
    setTransitionError(null);
    setCreating(true);
  };

  const submitSchedule = async () => {
    const due = new Date(dueAt);
    if (!prompt.trim()) { setFormError("Add a prompt for the local model to run."); return; }
    if (prompt.trim().length > 6000) { setFormError("Keep the prompt under 6,000 characters."); return; }
    if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) { setFormError("Choose a future local time."); return; }
    if (due.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) { setFormError("Choose a time within the next year."); return; }
    if ((triggerType === "project_event" || triggerType === "webhook") && !triggerValue.trim()) { setFormError("Add the local event or webhook identifier for this trigger."); return; }
    if (!preview) { setFormError("Run the one-time preview before enabling this automation."); return; }
    setFormError(null);
    const saved = await onSchedule({ prompt: prompt.trim(), dueAt: due.toISOString(), repeatEveryMinutes: repeat ? Number(repeat) : null, missedRunPolicy, workspaceMode, triggerType, triggerValue: triggerValue.trim() || null, overlapPolicy, dryRunCompleted: true, sourceTaskId: sourceTaskId || null, sourceWorkflowName: sourceWorkflowName.trim() || null });
    if (saved) { setCreating(false); setSelectedId(null); setQuery(""); }
    else setFormError("The schedule could not be saved. Check the status message and try again.");
  };

  const transition = async (task: DesktopScheduledTask, operation: "pause" | "resume" | "cancel" | "runNow" | "resolveMissed", choice?: "run_once" | "skip") => {
    setTransitionError(null);
    const saved = await onTransition(task.id, operation, choice);
    if (!saved) setTransitionError("That schedule could not be updated. Refresh and try again.");
  };

  const previewPrompt = async () => {
    setPreviewBusy(true);
    setPreview(null);
    const result = await onPreview(prompt, workspaceMode);
    if (result) setPreview(result);
    setPreviewBusy(false);
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
        <div className="scheduled-form-grid"><label>Trigger<select value={triggerType} onChange={(event) => { setTriggerType(event.target.value as TriggerType); setPreview(null); }}><option value="schedule">Schedule</option><option value="manual">Manual run</option><option value="project_event">Project event (local)</option><option value="webhook">Webhook (local)</option></select></label><label>Run at<input type="datetime-local" value={dueAt} min={localDateTimeValue(new Date())} onChange={(event) => setDueAt(event.target.value)} /></label><label>Repeat<select value={repeat} onChange={(event) => setRepeat(event.target.value)}><option value="">Once</option><option value="60">Hourly</option><option value="1440">Daily</option><option value="10080">Weekly</option>{repeat && !["60", "1440", "10080"].includes(repeat) && <option value={repeat}>{repeatLabel(Number(repeat))}</option>}</select></label><label>Workspace mode<select value={workspaceMode} onChange={(event) => setWorkspaceMode(event.target.value as ScheduledWorkspace)}><option value="ChatBot">Chat</option><option value="Coding Agent">Coding agent</option></select></label><label>When Skai missed a run<select value={missedRunPolicy} onChange={(event) => setMissedRunPolicy(event.target.value as typeof missedRunPolicy)}><option value="run_once">Run once when Skai returns</option><option value="skip">Skip missed runs</option><option value="ask_first">Ask me before running</option></select></label><label>Overlap policy<select value={overlapPolicy} onChange={(event) => setOverlapPolicy(event.target.value as OverlapPolicy)}><option value="skip">Skip while already running</option><option value="queue">Queue the next run</option><option value="replace">Replace the running request</option></select></label></div>
        {triggerType !== "schedule" && <label className="scheduled-prompt-field">Trigger identifier<input value={triggerValue} onChange={(event) => { setTriggerValue(event.target.value); setPreview(null); }} placeholder={triggerType === "webhook" ? "local webhook name" : triggerType === "project_event" ? "project id:event" : "Optional manual label"} /><small>Only local events are accepted. Skai does not expose this automation to the public network.</small></label>}
        <div className="scheduled-source-row"><label>Start from a successful task<select value={sourceTaskId} onChange={(event) => { const id = event.target.value; setSourceTaskId(id); const task = successfulTasks.find((item) => item.id === id); if (task) { setPrompt(task.instruction || task.title); setWorkspaceMode(task.responseMode === "coding" ? "Coding Agent" : "ChatBot"); setPreview(null); } }}><option value="">Write a new prompt…</option>{successfulTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>{successfulTasks.length === 0 && <small>No successful tasks yet; saved workflows can still be named below.</small>}</label><label>Saved workflow name<input value={sourceWorkflowName} onChange={(event) => setSourceWorkflowName(event.target.value)} placeholder="Optional local workflow" maxLength={200} /></label></div>
        <p className="scheduled-form-note"><NavIcon name="activity" /> Runs on this device in {localTimeZoneLabel()} while Skai is open and the device is awake. Execution uses the configured {provider} provider and {model || "selected model"}; prompts may leave this device depending on that provider. The scheduled prompt has no tools or project-file access.</p>
        <section className="scheduled-permission-preview" aria-label="Automation access preview"><strong>Execution access</strong><span>One prompt to the configured model · no tools · no automatic project writes</span><small>Project events and webhooks are unavailable until a local trigger provider is configured.</small></section>
        {preview && <section className="scheduled-dry-run-result" aria-live="polite"><strong>One-time preview · not saved</strong><p>{preview}</p></section>}
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="scheduled-form-actions"><Button variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button variant="secondary" type="button" disabled={previewBusy || !prompt.trim()} onClick={() => void previewPrompt()}>{previewBusy ? "Running preview…" : "Run one-time preview"}</Button><Button variant="primary" type="button" disabled={busyTask === "schedule" || !prompt.trim() || !preview} onClick={() => void submitSchedule()}>{busyTask === "schedule" ? "Saving…" : preview ? "Enable automation" : "Preview before enabling"}</Button></div>
      </section> : selectedTask ? <section className="scheduled-detail-panel"><div className="scheduled-detail-topline"><p className="section-kicker">SCHEDULE DETAILS</p><StatusBadge tone={statusTone(selectedTask.status)}>{selectedTask.status === "needs_decision" ? "needs decision" : selectedTask.status}</StatusBadge></div><h2>{selectedTask.prompt}</h2><dl className="scheduled-detail-grid"><div><dt>Next run</dt><dd>{selectedTask.status === "needs_decision" ? "Waiting for your decision" : selectedTask.status === "completed" || selectedTask.status === "cancelled" || selectedTask.status === "failed" ? "No upcoming run" : dueLabel(selectedTask.dueAt)}</dd></div><div><dt>Trigger</dt><dd>{selectedTask.triggerType === "project_event" ? `Project event · ${selectedTask.triggerValue}` : selectedTask.triggerType === "webhook" ? `Local webhook · ${selectedTask.triggerValue}` : selectedTask.triggerType === "manual" ? "Manual run" : "Schedule"}</dd></div><div><dt>Time zone</dt><dd>{localTimeZoneLabel()}</dd></div><div><dt>Device requirement</dt><dd>Skai open · device awake</dd></div><div><dt>Repeat</dt><dd>{repeatLabel(selectedTask.repeatEveryMinutes)}</dd></div><div><dt>Overlap</dt><dd>{selectedTask.overlapPolicy === "queue" ? "Queue next run" : selectedTask.overlapPolicy === "replace" ? "Replace running request" : "Skip overlapping run"}</dd></div><div><dt>Workspace mode</dt><dd>{selectedTask.workspaceMode === "Coding Agent" ? "Coding agent" : "Chat"}</dd></div><div><dt>Configured model</dt><dd>{selectedTask.selectedModel || `${provider} · ${model || "selected model"}`}</dd></div><div><dt>Dry run</dt><dd>{selectedTask.dryRunCompletedAt ? `Passed ${dueLabel(selectedTask.dryRunCompletedAt)}` : "Not recorded"}</dd></div><div><dt>Source</dt><dd>{selectedTask.sourceTaskId ? "Successful task" : selectedTask.sourceWorkflowName ? `Workflow · ${selectedTask.sourceWorkflowName}` : "New prompt"}</dd></div><div><dt>Missed run</dt><dd>{selectedTask.missedRunPolicy === "ask_first" ? "Ask first" : selectedTask.missedRunPolicy === "skip" ? "Skip" : "Run once when Skai returns"}</dd></div><div><dt>Latest result</dt><dd>{selectedTask.outcome || "No result yet"}</dd></div></dl>
        {!!selectedTask.runs?.length && <section className="scheduled-run-history" aria-label="Run history"><h3>Run history <small>{selectedTask.runs.length} most recent</small></h3>{[...selectedTask.runs].reverse().map((run) => <article key={run.id} className={`scheduled-run-entry is-${run.status}`}><div><StatusBadge tone={run.status === "succeeded" ? "success" : run.status === "running" ? "warning" : "neutral"}>{run.status}</StatusBadge><time dateTime={run.startedAtUtc}>{dueLabel(run.startedAtUtc)}</time></div><details><summary>Input and {run.status === "failed" || run.status === "skipped" ? "failure" : "result"}</summary><p><strong>Input</strong>{run.input}</p>{run.result && <p><strong>Result</strong>{run.result}</p>}{run.failure && <p><strong>{run.status === "skipped" ? "Outcome" : "Failure"}</strong>{run.failure}</p>}{run.artifactPaths?.length ? <p><strong>Artifacts</strong>{run.artifactPaths.map((path) => <code key={path}>{path}</code>)}</p> : null}</details></article>)}</section>}
        {transitionError && <p className="form-error" role="alert">{transitionError}</p>}
        <div className="scheduled-detail-actions"><Button variant="secondary" type="button" onClick={() => duplicateTask(selectedTask)}>Duplicate</Button>{selectedTask.status === "needs_decision" && <><Button variant="primary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "resolveMissed", "run_once")}>Run missed task once</Button><Button variant="secondary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "resolveMissed", "skip")}>Skip missed task</Button></>}{selectedTask.status === "scheduled" && <><Button variant="secondary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "runNow")}>Run now</Button><Button variant="ghost" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "pause")}>Pause</Button></>}{selectedTask.status === "paused" && <Button variant="secondary" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "resume")}>Resume</Button>}{(selectedTask.status === "scheduled" || selectedTask.status === "paused") && <Button variant="ghost" type="button" disabled={busyTask === selectedTask.id} onClick={() => void transition(selectedTask, "cancel")}>Cancel schedule</Button>}</div>
      </section> : loading ? <div className="scheduled-loading-state"><span className="scheduled-spinner" /><p>Loading your schedules…</p></div> : scheduledTasks.length ? <EmptyState title="No schedules match" description="Change the status filters or search for a different task." /> : <section className="scheduled-start"><span className="scheduled-hero-icon"><NavIcon name="clock" /></span><p className="section-kicker">LOCAL AUTOMATIONS</p><h2>Schedule a task</h2><p>Set a prompt to run later with the local model on this device.</p><div className="scheduled-template-grid">{templates.map((template) => <button className="scheduled-template-card" type="button" key={template.title} onClick={() => startFromTemplate(template)}><span className="scheduled-template-icon"><NavIcon name={template.icon} /></span><span><strong>{template.title}</strong><small>{template.description}</small></span><NavIcon name="arrow-right" /></button>)}</div></section>}
    </main>
  </div>;
}
