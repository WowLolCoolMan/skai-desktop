import { useEffect, useMemo, useState } from "react";
import type { DesktopConversation, DesktopPersona, DesktopProject, DesktopScheduledTask, DesktopTask } from "../../../shared/contracts";
import type { MemoryEntry, Model, Route } from "../../app/types";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";

export type WorkspaceSearchResult = {
  id: string;
  type: "chat" | "project" | "file" | "task" | "skill" | "persona" | "memory" | "reference" | "image" | "schedule" | "model";
  title: string;
  detail: string;
  content: string;
  updatedAt?: string;
  projectId?: string | null;
  conversationId?: string | null;
  model?: string | null;
  status?: string | null;
  filePath?: string;
};

type SearchFilters = { type: string; project: string; date: string; model: string; status: string };
type ActivityFilter = "all" | "tools" | "files" | "git" | "decisions";
const QUERY_KEY = "skai.workspace-search.query.v1";
const FILTERS_KEY = "skai.workspace-search.filters.v1";
const SAVED_KEY = "skai.workspace-search.saved.v1";
const defaultFilters: SearchFilters = { type: "all", project: "all", date: "all", model: "all", status: "all" };

function readSavedSearches(): string[] {
  try { const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 12) : []; }
  catch { return []; }
}
function readFilters(): SearchFilters {
  try { const parsed = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}"); return { ...defaultFilters, ...parsed }; }
  catch { return defaultFilters; }
}
function matchesText(result: WorkspaceSearchResult, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || `${result.title} ${result.detail} ${result.content} ${result.filePath ?? ""}`.toLowerCase().includes(needle);
}
const formatDate = (value?: string) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type Props = {
  conversations: DesktopConversation[];
  projects: DesktopProject[];
  tasks: DesktopTask[];
  scheduledTasks: DesktopScheduledTask[];
  models: Model[];
  personas: DesktopPersona[];
  memories: MemoryEntry[];
  references: Array<{ id: string; title: string; source: string; content: string; updatedAtUtc: string }>;
  images: Array<{ fileName: string; prompt?: string; createdAt?: string }>;
  onSearchWorkspace: (query: string) => Promise<WorkspaceSearchResult[]>;
  onNavigate: (route: Route) => void;
  onOpenConversation: (id: string) => void;
  onOpenProject: (project: DesktopProject) => void;
  onOpenFile: (project: DesktopProject, path: string) => void;
  onTransitionTask: (id: string, operation: "queue" | "approve" | "deny" | "cancel" | "retry" | "release") => void;
  onExecuteTask: (id: string) => void;
};

export function WorkspaceSearchPage({ conversations, projects, tasks, scheduledTasks, models, personas, memories, references, images, onSearchWorkspace, onNavigate, onOpenConversation, onOpenProject, onOpenFile, onTransitionTask, onExecuteTask }: Props) {
  const [query, setQuery] = useState(() => localStorage.getItem(QUERY_KEY) ?? "");
  const [filters, setFilters] = useState<SearchFilters>(readFilters);
  const [savedSearches, setSavedSearches] = useState(readSavedSearches);
  const [remoteResults, setRemoteResults] = useState<WorkspaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [view, setView] = useState<"search" | "activity">("search");
  const [groupBy, setGroupBy] = useState<"status" | "project" | "agent">("status");
  const [lastActivityVisit, setLastActivityVisit] = useState(() => Number(localStorage.getItem("skai.workspace-activity.last-visit.v1") ?? 0));
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [busyTask, setBusyTask] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem(QUERY_KEY, query); }, [query]);
  useEffect(() => { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); }, [filters]);
  useEffect(() => {
    const normalized = query.trim();
    let current = true;
    if (normalized.length < 2) { setRemoteResults([]); setSearchError(null); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearchWorkspace(normalized).then((results) => { if (current) { setRemoteResults(results); setSearchError(null); } })
        .catch((error: unknown) => { if (current) setSearchError(error instanceof Error ? error.message : "Workspace search is unavailable."); })
        .finally(() => { if (current) setSearching(false); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [onSearchWorkspace, query]);
  useEffect(() => {
    if (view !== "activity") return;
    const now = Date.now();
    localStorage.setItem("skai.workspace-activity.last-visit.v1", String(now));
    setLastActivityVisit(now);
    window.dispatchEvent(new Event("skai:workspace-activity-read"));
  }, [view]);

  const localResults = useMemo<WorkspaceSearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const matches = (text: string) => text.toLowerCase().includes(needle);
    const result: WorkspaceSearchResult[] = [];
    for (const project of projects) if (matches(`${project.name} ${project.instructions} ${project.gitHubRepository ?? ""}`)) result.push({ id: `project:${project.id}`, type: "project", title: project.name, detail: project.folderPaths.join(" · ") || "Local project", content: project.instructions, updatedAt: project.updatedAt, projectId: project.id });
    for (const task of tasks) if (matches(`${task.title} ${task.instruction} ${task.resultSummary ?? ""} ${(task.changedFiles ?? []).join(" ")} ${task.activity?.map((entry) => `${entry.type} ${Object.values(entry.payload).join(" ")}`).join(" ") ?? ""}`)) result.push({ id: `task:${task.id}`, type: "task", title: task.title, detail: `${task.role} · ${task.status}${task.projectId ? ` · ${projects.find((item) => item.id === task.projectId)?.name ?? "Project"}` : ""}`, content: task.resultSummary ?? task.instruction, updatedAt: task.updatedAt, projectId: task.projectId, conversationId: task.conversationId, model: task.model, status: task.status });
    for (const conversation of conversations) if (matches(`${conversation.title} ${conversation.projectName ?? ""} ${conversation.model ?? ""} ${conversation.messages.map((item) => item.content).join(" ")}`)) result.push({ id: `chat:${conversation.id}`, type: "chat", title: conversation.title || "Untitled chat", detail: `${conversation.mode === "Coding Agent" ? "Coding agent" : "Chat"} · ${conversation.model ?? "Model unavailable"}`, content: conversation.messages.find((item) => item.role === "assistant")?.content ?? conversation.messages.find((item) => item.role === "user")?.content ?? "", updatedAt: conversation.updatedAt, projectId: conversation.projectId, conversationId: conversation.id, model: conversation.model });
    for (const persona of personas) if (matches(`${persona.name} ${persona.roles} ${persona.instructions}`)) result.push({ id: `persona:${persona.id}`, type: "persona", title: persona.name, detail: `Persona · ${persona.roles}`, content: persona.instructions, updatedAt: persona.updatedAtUtc });
    for (const memory of memories) if (matches(`${memory.content} ${memory.tags.join(" ")} ${memory.scope}`)) result.push({ id: `memory:${memory.id}`, type: "memory", title: memory.content.slice(0, 90), detail: `Memory · ${memory.scope} · ${memory.tags.join(", ")}`, content: memory.content, updatedAt: memory.updatedAtUtc });
    for (const reference of references) if (matches(`${reference.title} ${reference.source} ${reference.content}`)) result.push({ id: `reference:${reference.id}`, type: "reference", title: reference.title, detail: `Reference · ${reference.source}`, content: reference.content.slice(0, 260), updatedAt: reference.updatedAtUtc });
    for (const image of images) if (matches(`${image.fileName} ${image.prompt ?? ""}`)) result.push({ id: `image:${image.fileName}`, type: "image", title: image.fileName, detail: "Saved local media", content: image.prompt ?? "", updatedAt: image.createdAt });
    for (const schedule of scheduledTasks) if (matches(`${schedule.prompt} ${schedule.status}`)) result.push({ id: `schedule:${schedule.id}`, type: "schedule", title: schedule.prompt, detail: `Scheduled task · ${schedule.status}`, content: schedule.outcome ?? "", updatedAt: schedule.dueAt, status: schedule.status, conversationId: schedule.conversationId });
    for (const model of models) if (matches(`${model.displayName ?? ""} ${model.model} ${model.provider ?? ""} ${model.capabilities.join(" ")}`)) result.push({ id: `model:${model.provider}:${model.model}`, type: "model", title: model.displayName || model.model, detail: `${model.provider ?? "Local runtime"} · ${model.capabilities.join(" · ") || "Text generation"}`, content: model.model, model: model.model });
    return result;
  }, [conversations, images, memories, models, personas, projects, query, references, scheduledTasks, tasks]);

  const filteredResults = useMemo(() => {
    const merged = [...remoteResults, ...localResults].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).filter((item) => matchesText(item, query));
    const since = filters.date === "7" ? Date.now() - 7 * 86400000 : filters.date === "30" ? Date.now() - 30 * 86400000 : null;
    return merged.filter((item) => filters.type === "all" || item.type === filters.type)
      .filter((item) => filters.project === "all" || item.projectId === filters.project)
      .filter((item) => filters.model === "all" || item.model === filters.model)
      .filter((item) => filters.status === "all" || item.status === filters.status)
      .filter((item) => !since || (item.updatedAt && Date.parse(item.updatedAt) >= since))
      .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  }, [filters, localResults, query, remoteResults]);

  const taskLanes = useMemo(() => {
    const matchesActivity = (task: DesktopTask) => {
      if (activityFilter === "all") return true;
      const events = task.activity ?? [];
      if (activityFilter === "files") return (task.changedFiles?.length ?? 0) > 0 || events.some((event) => /file|write|edit/i.test(event.type));
      if (activityFilter === "git") return Boolean(task.gitHubIssueUrl || task.worktreeBranch) || events.some((event) => /git|commit|pull.?request|branch|check/i.test(event.type));
      if (activityFilter === "decisions") return task.requiresApproval || ["awaiting_approval", "blocked", "paused", "proposed", "failed"].includes(task.status) || events.some((event) => /approval|decision|denied|approved/i.test(event.type));
      return events.some((event) => /tool\./i.test(event.type));
    };
    const lanes = [
      { id: "active", title: "Active", tasks: tasks.filter((item) => ["running", "verifying"].includes(item.status)) },
      { id: "waiting", title: "Waiting for you", tasks: tasks.filter((item) => ["awaiting_approval", "blocked", "paused", "failed"].includes(item.status)) },
      { id: "queued", title: "Queued and proposed", tasks: tasks.filter((item) => ["queued", "proposed"].includes(item.status)) },
      { id: "done", title: "Recently completed", tasks: tasks.filter((item) => item.status === "completed" && Date.parse(item.updatedAt) >= Date.now() - 7 * 86400000) },
    ].map((lane) => ({ ...lane, tasks: lane.tasks.filter(matchesActivity) }));
    return lanes.map((lane) => {
      if (groupBy === "status") return { ...lane, groups: [{ label: "", tasks: lane.tasks }] };
      const grouped = new Map<string, DesktopTask[]>();
      for (const task of lane.tasks) {
        const project = projects.find((item) => item.id === task.projectId);
        const label = groupBy === "project" ? (project?.name ?? "Workspace") : groupBy === "agent" ? task.role : task.environment === "worktree" ? "Worktree" : "Local";
        grouped.set(label, [...(grouped.get(label) ?? []), task]);
      }
      return { ...lane, groups: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, groupedTasks]) => ({ label, tasks: groupedTasks })) };
    });
  }, [activityFilter, groupBy, projects, tasks]);
  const newCompletions = tasks.filter((task) => task.status === "completed" && Date.parse(task.updatedAt) > lastActivityVisit).length;

  const updateFilter = (key: keyof SearchFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const saveSearch = () => {
    const normalized = query.trim();
    if (!normalized) return;
    setSavedSearches((current) => {
      const next = [normalized, ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 12);
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      return next;
    });
  };
  const openResult = (result: WorkspaceSearchResult) => {
    if (result.type === "chat" && result.conversationId) onOpenConversation(result.conversationId);
    else if (result.type === "project" && result.projectId) { const project = projects.find((item) => item.id === result.projectId); if (project) onOpenProject(project); }
    else if (result.type === "file" && result.projectId && result.filePath) { const project = projects.find((item) => item.id === result.projectId); if (project) onOpenFile(project, result.filePath); }
    else if (result.type === "task" || result.type === "schedule") onNavigate("usage");
    else if (result.type === "skill") onNavigate("marketplace");
    else if (result.type === "persona") onNavigate("persona-workshop");
    else if (result.type === "image") onNavigate("images");
    else if (result.type === "model") onNavigate("models");
    else if (result.type === "reference") { localStorage.setItem("skai.search.reference-query.v1", query.trim()); onNavigate("memory"); }
    else onNavigate("memory");
  };
  const transition = async (task: DesktopTask, operation: "queue" | "approve" | "deny" | "cancel" | "retry") => {
    if (busyTask) return;
    setBusyTask(task.id);
    try { if (operation === "queue") onTransitionTask(task.id, operation); else onTransitionTask(task.id, operation); }
    finally { window.setTimeout(() => setBusyTask((current) => current === task.id ? null : current), 500); }
  };

  return <div className="feature-page workspace-search-page">
    <PageHeader eyebrow="WORKSPACE" title={view === "search" ? "Search everything" : "Activity"} description={view === "search" ? "Find chats, projects, files, tasks, skills, memories, and saved media in one place." : "See what is running, waiting on you, queued, or recently complete."} actions={<div className="workspace-search-view-toggle" role="group" aria-label="Workspace search view"><Button variant={view === "search" ? "primary" : "secondary"} onClick={() => setView("search")}>Search</Button><Button variant={view === "activity" ? "primary" : "secondary"} onClick={() => setView("activity")}>Activity{newCompletions > 0 ? ` · ${newCompletions} new` : ""}</Button></div>} />
    {view === "search" ? <>
      <Card className="workspace-search-toolbar"><label className="workspace-search-input"><span className="sr-only">Search workspace</span><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats, projects, tasks, files…" type="search" /></label><Button variant="secondary" disabled={!query.trim()} onClick={saveSearch}>Save search</Button></Card>
      {savedSearches.length > 0 && <div className="workspace-saved-searches" aria-label="Saved searches">{savedSearches.map((item) => <button key={item} type="button" onClick={() => setQuery(item)}>{item}</button>)}</div>}
      <Card className="workspace-search-filters" aria-label="Search filters">
        <label>Type<select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}><option value="all">All content</option>{["chat", "project", "file", "task", "schedule", "skill", "persona", "memory", "reference", "image", "model"].map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
        <label>Project<select value={filters.project} onChange={(event) => updateFilter("project", event.target.value)}><option value="all">All projects</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Date<select value={filters.date} onChange={(event) => updateFilter("date", event.target.value)}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <label>Model<select value={filters.model} onChange={(event) => updateFilter("model", event.target.value)}><option value="all">Any model</option>{models.map((item) => <option key={`${item.provider}:${item.model}`} value={item.model}>{item.displayName || item.model}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="all">Any status</option>{[...new Set([...tasks.map((item) => item.status), ...scheduledTasks.map((item) => item.status)])].sort().map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label>
      </Card>
      <div className="workspace-search-results-heading"><strong>{query.trim().length < 2 ? "Start with a search" : searching ? "Searching your workspace…" : `${filteredResults.length} result${filteredResults.length === 1 ? "" : "s"}`}</strong><span>Files are matched by name and path; their contents stay unopened.</span></div>
      {searchError && <p className="workspace-search-error" role="alert">{searchError}</p>}
      {query.trim().length < 2 ? <Card className="workspace-search-empty"><EmptyState title="Search your local workspace" description="Search requires at least two characters. Recent queries stay on this device, and opening a result preserves your filters." /></Card> : filteredResults.length === 0 && !searching ? <Card className="workspace-search-empty"><EmptyState title="No matching results" description="Try a shorter phrase or clear one of the filters." action={<Button variant="secondary" onClick={() => { setQuery(""); setFilters(defaultFilters); }}>Clear search and filters</Button>} /></Card> : <div className="workspace-search-results">{filteredResults.slice(0, 100).map((result) => <button key={result.id} type="button" className="workspace-search-result" onClick={() => openResult(result)}><span className="workspace-search-result-type">{titleCase(result.type)}</span><span className="workspace-search-result-copy"><strong>{result.title}</strong><small>{result.detail}</small>{result.content && <span>{result.content.slice(0, 220)}</span>}</span><span className="workspace-search-result-date">{formatDate(result.updatedAt)}</span></button>)}</div>}
    </> : <>
      <div className="workspace-activity-toolbar"><p>Live task state with recent tool, file, Git, and decision events.</p><div className="workspace-activity-controls"><label>Show<select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}><option value="all">All activity</option><option value="tools">Tool calls</option><option value="files">File changes</option><option value="git">Git and checks</option><option value="decisions">User decisions</option></select></label><label>Group by<select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}><option value="status">Status</option><option value="project">Project</option><option value="agent">Agent</option><option value="environment">Environment</option></select></label></div></div>
      <div className="workspace-activity-board">{taskLanes.map((lane) => <Card className="workspace-activity-lane" key={lane.id}><header><h2>{lane.title}</h2><StatusBadge tone={lane.id === "active" || lane.id === "waiting" ? "warning" : "neutral"}>{lane.tasks.length}</StatusBadge></header>{lane.tasks.length ? lane.groups.map((group) => <section className="workspace-activity-group" key={group.label || lane.id}>{group.label && <h3>{group.label}</h3>}{group.tasks.map((task) => { const busy = busyTask === task.id; const project = projects.find((item) => item.id === task.projectId); const events = (task.activity ?? []).slice(-3); return <article className="workspace-activity-task" key={task.id}><div><strong>{task.title}</strong><small>{project?.name ?? "Workspace"} · {task.role} · {task.environment === "worktree" ? "Worktree" : "Local"} · {formatDate(task.updatedAt)}</small><span className={`usage-task-status is-${task.status}`}>{titleCase(task.status)}</span>{task.resultSummary && <p>{task.resultSummary}</p>}{task.worktreeBranch && <small>Branch · {task.worktreeBranch}</small>}{task.gitHubIssueUrl && <small>Issue · {task.gitHubIssueUrl}</small>}{task.changedFiles?.slice(0, 4).map((file) => <small key={file}>File · {file}</small>)}{task.verificationEvidence && <small>Check · {task.verificationEvidence.checkLabel} · {task.verificationEvidence.exitCode === 0 ? "passed" : "failed"}</small>}{events.map((event) => <small key={event.sequence}>{titleCase(event.type)} · {event.actor} · {formatDate(event.timestamp)}</small>)}</div><div className="workspace-activity-actions">{task.status === "awaiting_approval" && <><Button variant="primary" disabled={busy} onClick={() => void transition(task, "approve")}>Approve</Button><Button variant="secondary" disabled={busy} onClick={() => void transition(task, "deny")}>Decline</Button></>}{task.status === "proposed" && <Button variant="secondary" disabled={busy} onClick={() => void transition(task, "queue")}>Queue plan</Button>}{task.status === "queued" && <Button variant="primary" disabled={busy} onClick={() => onExecuteTask(task.id)}>Start</Button>}{["running", "verifying"].includes(task.status) && <Button variant="secondary" disabled={busy} onClick={() => void transition(task, "cancel")}>Stop</Button>}{["blocked", "failed"].includes(task.status) && <Button variant="secondary" disabled={busy} onClick={() => void transition(task, "retry")}>Retry</Button>}{project && <Button variant="ghost" onClick={() => onOpenProject(project)}>Project</Button>}</div></article>})}</section>) : <p className="workspace-activity-empty">No tasks in this lane.</p>}</Card>)}</div>
    </>}
  </div>;
}
