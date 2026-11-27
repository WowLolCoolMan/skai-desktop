import { useMemo, useState } from "react";
import type { DesktopConversation, DesktopProject, DesktopScheduledTask, DesktopTask, LocalCapacitySnapshot } from "../../../shared/contracts";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";

type UsagePageProps = {
  conversations: DesktopConversation[];
  projects: DesktopProject[];
  tasks: DesktopTask[];
  scheduledTasks: DesktopScheduledTask[];
  memoryCount: number;
  corpusCount: number;
  savedImageCount: number;
  provider: string;
  model: string;
  capacity: LocalCapacitySnapshot | null;
  onTransitionTask: (id: string, operation: "queue" | "approve" | "deny" | "cancel" | "retry" | "release") => void;
  onExecuteTask: (id: string) => void;
  onOpenProject: (project: DesktopProject) => void;
  onOpenConversation: (id: string) => void;
};

const numberFormat = new Intl.NumberFormat();
const formatCount = (value: number) => numberFormat.format(value);
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};
const formatBytes = (bytes: number | null | undefined) => bytes == null || !Number.isFinite(bytes) || bytes < 0
  ? "Not measured"
  : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
const usagePercent = (used: number | null, total: number | null) => used == null || total == null || total <= 0 ? null : percent(used / total * 100);

function UsageMeter({ label, detail, value }: { label: string; detail: string; value: number | null }) {
  return <div className="usage-meter">
    <div className="usage-meter-heading"><strong>{label}</strong><span>{detail}</span></div>
    <div className="usage-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}><span style={{ width: value == null ? "0%" : `${value}%` }} /></div>
    <small>{value == null ? "Not measured" : `${Math.round(value)}% in use`}</small>
  </div>;
}

function StatCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return <Card className="usage-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></Card>;
}

export function UsagePage({ conversations, projects, tasks, scheduledTasks, memoryCount, corpusCount, savedImageCount, provider, model, capacity, onTransitionTask, onExecuteTask, onOpenProject, onOpenConversation }: UsagePageProps) {
  const [taskFilter, setTaskFilter] = useState("all");
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const messages = conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role !== "system"));
  const userPrompts = messages.filter((message) => message.role === "user").length;
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const attentionTasks = tasks.filter((task) => task.status === "failed" || task.status === "blocked").length;
  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "verifying").length;
  const queuedTasks = tasks.filter((task) => task.status === "queued").length;
  const recentConversations = [...conversations].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5);
  const recentTasks = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5);
  const inboxTasks = useMemo(() => [...tasks]
    .filter((task) => taskFilter === "all" || (taskFilter === "active" ? ["running", "verifying"].includes(task.status) : taskFilter === "queued" ? ["queued", "awaiting_approval", "proposed"].includes(task.status) : ["failed", "blocked", "awaiting_approval"].includes(task.status)))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [tasks, taskFilter]);
  const runTaskAction = async (id: string, action: () => void) => {
    if (pendingTask) return;
    setPendingTask(id);
    try { action(); } finally { window.setTimeout(() => setPendingTask((current) => current === id ? null : current), 500); }
  };
  const modelCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  for (const conversation of conversations) {
    if (conversation.model) modelCounts.set(conversation.model, (modelCounts.get(conversation.model) ?? 0) + 1);
    if (conversation.modelProvider) providerCounts.set(conversation.modelProvider, (providerCounts.get(conversation.modelProvider) ?? 0) + 1);
  }
  const topModels = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const providers = [...providerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const ramUsed = capacity?.ramTotalBytes != null && capacity.ramAvailableBytes != null ? Math.max(0, capacity.ramTotalBytes - capacity.ramAvailableBytes) : null;
  const gpuUsed = capacity?.gpu?.totalBytes != null && capacity.gpu.availableBytes != null ? Math.max(0, capacity.gpu.totalBytes - capacity.gpu.availableBytes) : null;
  const cpuValue = percent(capacity?.cpuUtilizationPercent);
  const scheduledActive = scheduledTasks.filter((task) => task.status === "scheduled").length;
  const hasActivity = conversations.length + projects.length + tasks.length + memoryCount + corpusCount + savedImageCount > 0;

  return <div className="feature-page usage-page">
    <PageHeader eyebrow="LOCAL RUNTIME" title="Usage" description="Understand your workspace activity, agent workload, and the local resources currently in use." />
    <section className="usage-overview" aria-label="Workspace totals">
      <StatCard label="Saved conversations" value={formatCount(conversations.length)} detail={`${formatCount(userPrompts)} prompts · ${formatCount(messages.length)} messages`} />
      <StatCard label="Agent tasks" value={formatCount(tasks.length)} detail={`${formatCount(completedTasks)} completed · ${formatCount(attentionTasks)} need attention`} />
      <StatCard label="Projects" value={formatCount(projects.length)} detail={`${formatCount(projects.filter((project) => project.folderPaths.length > 0).length)} connected to folders`} />
      <StatCard label="Saved image history" value={formatCount(savedImageCount)} detail="Recent local outputs · history keeps up to 24" />
    </section>

    <div className="usage-dashboard">
      <Card className="usage-card usage-task-inbox">
        <div className="usage-card-heading"><div><p className="section-kicker">TASK INBOX</p><h3>Agent task inbox</h3></div><label className="usage-task-filter"><span className="sr-only">Filter agent tasks</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="needs-attention">Needs attention</option><option value="active">Active</option><option value="queued">Queued and proposed</option><option value="all">All tasks</option></select></label></div>
        {inboxTasks.length ? <div className="usage-task-inbox-list">{inboxTasks.slice(0, 12).map((task) => {
          const project = task.projectId ? projects.find((item) => item.id === task.projectId) : undefined;
          const busy = pendingTask === task.id;
          return <article className="usage-task-inbox-item" key={task.id}>
            <div className="usage-task-inbox-copy"><div><strong title={task.title}>{task.title}</strong><span className={`usage-task-status is-${task.status}`}>{task.status.replaceAll("_", " ")}</span></div><small>{project?.name ?? (task.conversationId ? "Conversation task" : "Workspace task")} · Updated {formatDate(task.updatedAt)}</small>{task.resultSummary && <p>{task.resultSummary}</p>}</div>
            <div className="usage-task-inbox-actions">
              {task.status === "awaiting_approval" && <><Button variant="primary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onTransitionTask(task.id, "approve"))}>{busy ? "Approving…" : "Approve"}</Button><Button variant="secondary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onTransitionTask(task.id, "deny"))}>Decline</Button></>}
              {task.status === "proposed" && <Button variant="secondary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onTransitionTask(task.id, "queue"))}>{busy ? "Queueing…" : "Queue plan"}</Button>}
              {task.status === "queued" && <Button variant="primary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onExecuteTask(task.id))}>{busy ? "Starting…" : "Start"}</Button>}
              {["running", "verifying"].includes(task.status) && <Button variant="secondary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onTransitionTask(task.id, "cancel"))}>{busy ? "Stopping…" : "Stop"}</Button>}
              {task.status === "blocked" && !task.worktreePath && <Button variant="secondary" disabled={busy} onClick={() => void runTaskAction(task.id, () => onTransitionTask(task.id, "retry"))}>{busy ? "Re-queueing…" : "Retry"}</Button>}
              {project && <Button variant="ghost" onClick={() => onOpenProject(project)}>Open project</Button>}
              {!project && task.conversationId && conversations.some((conversation) => conversation.id === task.conversationId) && <Button variant="ghost" onClick={() => onOpenConversation(task.conversationId!)}>Open chat</Button>}
            </div>
          </article>;
        })}</div> : <EmptyState title={tasks.length ? "Nothing in this view" : "No agent tasks yet"} description={tasks.length ? "Try another filter to see more task activity." : "Tasks created by Chat or Coding agents will appear in this inbox."} />}
      </Card>
      <Card className="usage-card usage-activity">
        <div className="usage-card-heading"><div><p className="section-kicker">RECENT ACTIVITY</p><h3>Your latest work</h3></div><StatusBadge tone={activeTasks > 0 ? "warning" : "neutral"}>{activeTasks > 0 ? `${activeTasks} active` : "All caught up"}</StatusBadge></div>
        <div className="usage-activity-columns">
          <section aria-label="Recent conversations"><h4>Conversations</h4>{recentConversations.length ? <div className="usage-activity-list">{recentConversations.map((conversation) => <article className="usage-activity-row" key={conversation.id}><div><strong title={conversation.title}>{conversation.title || "Untitled conversation"}</strong><small>{conversation.mode === "Coding Agent" ? "Coding agent" : "Chat"} · {formatCount(conversation.messages.filter((message) => message.role !== "system").length)} messages</small></div><time dateTime={conversation.updatedAt}>{formatDate(conversation.updatedAt)}</time></article>)}</div> : <EmptyState title="No conversations yet" description="Saved conversations will appear here." />}</section>
          <section aria-label="Recent agent tasks"><h4>Agent tasks</h4>{recentTasks.length ? <div className="usage-activity-list">{recentTasks.map((task) => <article className="usage-activity-row" key={task.id}><div><strong title={task.title}>{task.title}</strong><small>{task.projectId ? "Project task" : "Conversation task"} · {formatDate(task.updatedAt)}</small></div><span className={`usage-task-status is-${task.status}`}>{task.status.replaceAll("_", " ")}</span></article>)}</div> : <EmptyState title="No agent tasks yet" description="Tasks created by Chat or Coding agents will show up here." />}</section>
        </div>
      </Card>

      <Card className="usage-card usage-capacity">
        <div className="usage-card-heading"><div><p className="section-kicker">LIVE CAPACITY</p><h3>Local machine</h3></div><span className="usage-updated">{capacity ? `Updated ${formatDate(capacity.capturedAtUtc)}` : "Waiting for runtime"}</span></div>
        {capacity ? <>
          <UsageMeter label="System memory" detail={`${formatBytes(ramUsed)} / ${formatBytes(capacity.ramTotalBytes)}`} value={usagePercent(ramUsed, capacity.ramTotalBytes)} />
          {capacity.gpu && <UsageMeter label={capacity.gpu.name || "GPU memory"} detail={`${formatBytes(gpuUsed)} / ${formatBytes(capacity.gpu.totalBytes)}`} value={usagePercent(gpuUsed, capacity.gpu.totalBytes)} />}
          <UsageMeter label="CPU" detail={cpuValue == null ? "Usage unavailable" : `${Math.round(cpuValue)}% in use`} value={cpuValue} />
          {capacity.runtime?.loadedModels?.length ? <div className="usage-loaded-models"><h4>Loaded models</h4>{capacity.runtime.loadedModels.map((loaded, index) => <div key={`${loaded.runtime}-${loaded.model}-${index}`}><strong>{loaded.model}</strong><span>{loaded.runtime} · RAM {formatBytes(loaded.ramBytes)} · GPU {formatBytes(loaded.gpuBytes)}</span></div>)}</div> : <p className="usage-note">{capacity.runtime?.loadedModelNote ?? "No loaded model details reported by the runtime."}</p>}
          {capacity.scheduler && <>
            <p className="usage-scheduler">{capacity.scheduler.activeTaskCount} active · {capacity.scheduler.queuedTaskCount} queued · {capacity.scheduler.executionSlotLimit} execution slots{capacity.scheduler.limitingResource ? ` · limited by ${capacity.scheduler.limitingResource}` : ""}</p>
            <details className="usage-capacity-details">
              <summary>Capacity estimates and queue behavior</summary>
              <div>
                <p>RAM and CPU are measured locally by the operating system. GPU memory is sampled with NVIDIA telemetry when present. Loaded model sizes are separately reported by the runtime.</p>
                <p>Effective available RAM: {formatBytes(capacity.scheduler.effectiveAvailableRamBytes ?? null)} · GPU: {formatBytes(capacity.scheduler.effectiveAvailableGpuBytes ?? null)}</p>
                <p>{capacity.scheduler.estimatedRamPerTaskBytes ? `Estimated RAM per task: ${formatBytes(capacity.scheduler.estimatedRamPerTaskBytes)}. ` : "Per-task RAM estimate unavailable. "}{capacity.scheduler.estimateBasis}</p>
                <p>Queue policy: {capacity.scheduler.queuePolicy === "fifo" ? "first in, first out" : "local FIFO"}. Work begins only after you explicitly start a task; Skai does not unload models automatically.</p>
              </div>
            </details>
          </>}
        </> : <EmptyState title="Runtime measurements unavailable" description="Reconnect to the local agent host to see memory, CPU, and loaded-model readings." />}
      </Card>

      <Card className="usage-card usage-models">
        <div className="usage-card-heading"><div><p className="section-kicker">MODEL FOOTPRINT</p><h3>Saved conversation mix</h3></div></div>
        <div className="usage-current-model"><span>Current selection</span><strong>{model || "No model selected"}</strong><small>{provider || "Provider unavailable"}</small></div>
        {topModels.length ? <div className="usage-breakdown">{topModels.map(([name, count]) => <div className="usage-breakdown-row" key={name}><div><strong title={name}>{name}</strong><span>{formatCount(count)} conversations</span></div><div className="usage-breakdown-track"><i style={{ width: `${Math.max(6, count / topModels[0][1] * 100)}%` }} /></div></div>)}</div> : <p className="usage-note">Model history will appear as conversations are saved.</p>}
        {providers.length > 0 && <p className="usage-provider-summary">Providers in saved history: {providers.map(([name, count]) => `${name} ${formatCount(count)}`).join(" · ")}</p>}
      </Card>

      <Card className="usage-card usage-inventory">
        <div className="usage-card-heading"><div><p className="section-kicker">LOCAL INVENTORY</p><h3>What Skai has saved</h3></div></div>
        {hasActivity ? <div className="usage-inventory-grid">
          <div><strong>{formatCount(memoryCount)}</strong><span>Memory notes</span></div>
          <div><strong>{formatCount(corpusCount)}</strong><span>Reference documents</span></div>
          <div><strong>{formatCount(scheduledActive)}</strong><span>Scheduled runs</span></div>
          <div><strong>{formatCount(queuedTasks)}</strong><span>Queued tasks</span></div>
        </div> : <EmptyState title="Your workspace is empty" description="Activity and saved local data will appear here as you use Skai." />}
        <p className="usage-privacy-note">This view reads local workspace and runtime state. It does not send telemetry or estimate token counts, cost, or latency.</p>
      </Card>
    </div>
  </div>;
}
