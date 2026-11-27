import { useEffect, useState } from "react";
import type { DesktopProject, DesktopTask } from "../../../shared/contracts";
import { Button } from "../../components/ui/Primitives";

const preferenceKey = "skai.taskNotifications.preferences.v1";
const historyKey = "skai.taskNotifications.history.v1";
const statusKey = "skai.taskNotifications.statuses.v1";
const preferenceEvent = "skai-task-notification-preferences-changed";
const historyEvent = "skai-task-notification-history-changed";
const maxHistory = 50;

type NotificationPreferences = {
  enabled: boolean;
  completed: boolean;
  failed: boolean;
  decisions: boolean;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
  mutedProjectIds: string[];
  showTaskTitles: boolean;
};
type Delivery = "shown" | "disabled" | "category-disabled" | "quiet-hours" | "project-muted" | "permission-required" | "unsupported" | "error";
type HistoryEntry = { id: string; taskId: string; taskTitle: string; projectId: string | null; status: string; createdAt: string; delivery: Delivery };

const defaultPreferences: NotificationPreferences = { enabled: false, completed: true, failed: true, decisions: true, quietHours: false, quietStart: "22:00", quietEnd: "08:00", mutedProjectIds: [], showTaskTitles: false };
const statuses = new Set(["completed", "failed", "blocked", "awaiting_approval"]);

function readPreferences(): NotificationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? "null") as Partial<NotificationPreferences> | null;
    if (!value || typeof value !== "object") return defaultPreferences;
    return {
      enabled: value.enabled === true,
      completed: value.completed !== false,
      failed: value.failed !== false,
      decisions: value.decisions !== false,
      quietHours: value.quietHours === true,
      quietStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietStart ?? "") ? value.quietStart! : "22:00",
      quietEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.quietEnd ?? "") ? value.quietEnd! : "08:00",
      mutedProjectIds: Array.isArray(value.mutedProjectIds) ? value.mutedProjectIds.filter((item): item is string => typeof item === "string").slice(0, 200) : [],
      showTaskTitles: value.showTaskTitles === true,
    };
  } catch { return defaultPreferences; }
}

function readHistory(): HistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(historyKey) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is HistoryEntry => Boolean(entry && typeof entry === "object" && typeof (entry as HistoryEntry).id === "string" && typeof (entry as HistoryEntry).taskId === "string" && typeof (entry as HistoryEntry).taskTitle === "string" && typeof (entry as HistoryEntry).status === "string" && typeof (entry as HistoryEntry).createdAt === "string" && typeof (entry as HistoryEntry).delivery === "string")).slice(0, maxHistory) : [];
  } catch { return []; }
}

function inQuietHours(start: string, end: string, now = new Date()) {
  const minute = now.getHours() * 60 + now.getMinutes();
  const parse = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };
  const from = parse(start), to = parse(end);
  if (from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

function statusEnabled(status: string, preferences: NotificationPreferences) {
  if (status === "completed") return preferences.completed;
  if (status === "failed" || status === "blocked") return preferences.failed;
  if (status === "awaiting_approval") return preferences.decisions;
  return false;
}

/** Watches task status transitions while recording even undelivered events for recovery. */
export function TaskNotificationMonitor({ tasks, loading, onOpenTask }: { tasks: DesktopTask[]; loading: boolean; onOpenTask: (task: DesktopTask) => void }) {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const refresh = () => setPreferences(readPreferences());
    window.addEventListener(preferenceEvent, refresh);
    return () => window.removeEventListener(preferenceEvent, refresh);
  }, []);
  useEffect(() => {
    if (loading) return;
    let previous: Record<string, string> = {};
    let hasBaseline = false;
    try {
      const raw = localStorage.getItem(statusKey);
      if (raw) { const parsed = JSON.parse(raw) as unknown; if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) { previous = parsed as Record<string, string>; hasBaseline = true; } }
    } catch { /* malformed local history starts from a clean baseline */ }
    if (!hasBaseline && tasks.length === 0) return;
    const next = Object.fromEntries(tasks.slice(0, 1000).map((task) => [task.id, task.status]));
    try { localStorage.setItem(statusKey, JSON.stringify(next)); } catch { /* task loading must not depend on notification storage */ }
    if (!hasBaseline) return;
    const changed = tasks.filter((task) => statuses.has(task.status) && previous[task.id] !== task.status);
    if (!changed.length) return;

    const delivered = changed.map((task): HistoryEntry => {
      let delivery: Delivery = "disabled";
      if (preferences.enabled) {
        if (!statusEnabled(task.status, preferences)) delivery = "category-disabled";
        else if (preferences.mutedProjectIds.includes(task.projectId ?? "")) delivery = "project-muted";
        else if (preferences.quietHours && inQuietHours(preferences.quietStart, preferences.quietEnd)) delivery = "quiet-hours";
        else if (typeof Notification === "undefined") delivery = "unsupported";
        else if (Notification.permission !== "granted") delivery = "permission-required";
        else delivery = "shown";
      }
      return { id: `${task.id}:${task.status}:${task.updatedAt}`, taskId: task.id, taskTitle: task.title.slice(0, 180), projectId: task.projectId ?? null, status: task.status, createdAt: task.updatedAt || new Date().toISOString(), delivery };
    });
    try {
      const existing = readHistory();
      const known = new Set(existing.map((entry) => entry.id));
      const fresh = delivered.filter((entry) => !known.has(entry.id));
      localStorage.setItem(historyKey, JSON.stringify([...fresh, ...existing].slice(0, maxHistory)));
      if (fresh.length) window.dispatchEvent(new Event(historyEvent));
      const visible = fresh.filter((entry) => entry.delivery === "shown");
      if (!visible.length) return;
      const count = visible.length;
      const details = preferences.showTaskTitles ? `: ${visible.slice(0, 2).map((entry) => entry.taskTitle).join(" · ")}${count > 2 ? ` · and ${count - 2} more` : ""}` : ". Open Skai to review it.";
      let notification: Notification;
      try { notification = new Notification("Skai task update", { body: `${count} task${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your attention${details}`, tag: "skai-agent-task-updates", silent: true }); }
      catch {
        const failed = new Set(visible.map((entry) => entry.id));
        localStorage.setItem(historyKey, JSON.stringify([...fresh.map((entry) => failed.has(entry.id) ? { ...entry, delivery: "error" as const } : entry), ...existing].slice(0, maxHistory)));
        window.dispatchEvent(new Event(historyEvent));
        return;
      }
      notification.onclick = () => { window.focus(); const target = tasks.find((task) => task.id === visible[0].taskId) ?? changed[0]; onOpenTask(target); notification.close(); };
    } catch { /* notification storage or native delivery can fail without affecting tasks */ }
  }, [tasks, loading, preferences, onOpenTask]);
  return null;
}

export function TaskNotificationSettings({ projects }: { projects: DesktopProject[] }) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [history, setHistory] = useState(readHistory);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  useEffect(() => {
    const refresh = () => setHistory(readHistory());
    window.addEventListener(historyEvent, refresh);
    return () => window.removeEventListener(historyEvent, refresh);
  }, []);
  const update = (patch: Partial<NotificationPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); window.dispatchEvent(new Event(preferenceEvent)); } catch { /* preferences remain in this view until storage is available */ }
  };
  const requestPermission = async () => {
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    setPermission(await Notification.requestPermission());
  };
  const clearHistory = () => { try { localStorage.removeItem(historyKey); } catch { /* displayed history clears for this session */ } setHistory([]); };
  return <section className="settings-notification-panel" aria-labelledby="task-notifications-title">
    <div className="settings-section-heading"><div><p className="section-kicker">TASK UPDATES</p><h2 id="task-notifications-title">Desktop notifications</h2><p>Local task updates only. Notification previews hide task names unless you opt in below.</p></div></div>
    <label className="settings-notification-toggle"><input type="checkbox" checked={preferences.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span><strong>Notify me about agent tasks</strong><small>Completion, failure, blocked tasks, and tasks waiting for approval.</small></span></label>
    <div className="settings-notification-permission"><span>System permission: <strong>{permission === "granted" ? "Allowed" : permission === "denied" ? "Blocked in system settings" : permission === "unsupported" ? "Unavailable" : "Not requested"}</strong></span>{permission !== "granted" && permission !== "denied" && permission !== "unsupported" && <Button variant="secondary" type="button" onClick={() => void requestPermission()}>Allow notifications</Button>}</div>
    <div className="settings-notification-grid">
      <label><input type="checkbox" checked={preferences.completed} onChange={(event) => update({ completed: event.target.checked })} /><span>Completed</span></label>
      <label><input type="checkbox" checked={preferences.failed} onChange={(event) => update({ failed: event.target.checked })} /><span>Failed or blocked</span></label>
      <label><input type="checkbox" checked={preferences.decisions} onChange={(event) => update({ decisions: event.target.checked })} /><span>Awaiting approval</span></label>
      <label><input type="checkbox" checked={preferences.showTaskTitles} onChange={(event) => update({ showTaskTitles: event.target.checked })} /><span>Show task titles in notification previews</span></label>
    </div>
    <div className="settings-notification-quiet"><label><input type="checkbox" checked={preferences.quietHours} onChange={(event) => update({ quietHours: event.target.checked })} /><span>Quiet hours</span></label><label>From<input type="time" value={preferences.quietStart} onChange={(event) => update({ quietStart: event.target.value })} /></label><label>Until<input type="time" value={preferences.quietEnd} onChange={(event) => update({ quietEnd: event.target.value })} /></label><small>Uses this computer’s local time. Alerts during quiet hours still appear in history.</small></div>
    <details className="settings-notification-projects"><summary>Mute projects · {preferences.mutedProjectIds.length} muted</summary>{projects.length ? projects.map((project) => <label key={project.id}><input type="checkbox" checked={preferences.mutedProjectIds.includes(project.id)} onChange={(event) => update({ mutedProjectIds: event.target.checked ? [...new Set([...preferences.mutedProjectIds, project.id])].slice(0, 200) : preferences.mutedProjectIds.filter((id) => id !== project.id) })} /><span>{project.name}</span></label>) : <small>No projects are available to configure.</small>}</details>
    <div className="settings-notification-history"><div className="settings-notification-history-heading"><strong>Recent delivery history</strong><Button variant="ghost" type="button" disabled={!history.length} onClick={clearHistory}>Clear history</Button></div>{history.length ? <ul>{history.slice(0, 12).map((entry) => <li key={entry.id}><span><strong>{entry.taskTitle || "Agent task"}</strong><small>{entry.status.replaceAll("_", " ")} · {new Date(entry.createdAt).toLocaleString()}</small></span><small>{entry.delivery === "shown" ? "Delivered" : entry.delivery.replaceAll("-", " ")}</small></li>)}</ul> : <p className="settings-help">Task status changes will be recorded here after the next refresh.</p>}</div>
    <p className="settings-help">Mobile approvals, task controls from lock-screen notifications, and local-network status links are unavailable until Skai has a trusted host and task-scoped approval protocol.</p>
  </section>;
}
