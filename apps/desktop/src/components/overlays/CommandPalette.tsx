import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Route } from "../../app/types";
import type { DesktopProject } from "../../../shared/contracts";
import type { DesktopTask } from "../../../shared/contracts";
import { ModalDialog } from "../ui/ModalDialog";
import { NavIcon } from "../ui/NavIcon";
import { themeCommands } from "../../theme/themeCommands";
import { unlockAchievement } from "../../features/settings/easterEggs";
import { commandPreferencesKey, readCommandPreferences } from "../../features/commands/preferences";

type Command = { id: string; label: string; detail: string; route?: Route; project?: DesktopProject; task?: DesktopTask; run?: () => void; context?: Route[]; shortcutId?: string };
const ariaShortcut = (shortcut: string) => (shortcut === "↵" ? "Enter" : shortcut.replace(/^Ctrl\+/, "Control+").replace(/^⌘\+/, "Meta+"));
const commands: Command[] = [
  { id: "search", label: "Search workspace", detail: "Find chats, projects, tasks, files, and local artifacts", route: "search", context: ["chat", "projects", "coding"] },
  { id: "onboarding", label: "Open Getting Started", detail: "Review setup, privacy, and local capability readiness", route: "onboarding", context: ["chat"] },
  { id: "chat", label: "Open Chat", detail: "Start or continue a conversation", route: "chat", shortcutId: "chat", context: ["chat"] },
  { id: "projects", label: "Open Projects", detail: "Browse and choose a local workspace", route: "projects", context: ["projects", "coding"] },
  { id: "coding", label: "Open Coding Workspace", detail: "Projects, files, terminal, and edits", route: "coding", shortcutId: "coding", context: ["coding", "projects"] },
  { id: "terminal", label: "Open Terminal", detail: "Run a bounded command in a selected project", route: "terminal", shortcutId: "terminal", context: ["coding", "terminal"] },
  { id: "models", label: "Open Models", detail: "Discover and select a provider model", route: "models", context: ["chat", "models"] },
  { id: "images", label: "Open Image Studio", detail: "Create with a local workflow", route: "images", context: ["images", "chat"] },
  { id: "marketplace", label: "Open Marketplace", detail: "Find models, voices, tools, and skills", route: "marketplace", context: ["marketplace", "plugins"] },
  { id: "voice-workbench", label: "Open Voice Workbench", detail: "Customize installed and local voice profiles", route: "voice-workbench", context: ["voice-workbench", "marketplace"] },
  { id: "memory", label: "Open Memory", detail: "Review approved local memory", route: "memory", context: ["memory", "chat"] },
  { id: "settings", label: "Open Settings", detail: "Appearance and workspace preferences", route: "settings", shortcutId: "settings", context: ["settings"] },
  ...themeCommands,
];

export function CommandPalette({ open, onClose, onNavigate, projects = [], tasks = [], route = "chat", onOpenProject, onOpenTask, onNewChat, onApplyLayoutPreset }: { open: boolean; onClose: () => void; onNavigate: (route: Route) => void; projects?: DesktopProject[]; tasks?: DesktopTask[]; route?: Route; onOpenProject?: (project: DesktopProject) => void; onOpenTask?: (task: DesktopTask) => void; onNewChat?: () => void; onApplyLayoutPreset?: (preset: "chat" | "coding" | "review" | "research" | "media") => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<"all" | "recent" | "pinned">("all");
  const [preferences, setPreferences] = useState(readCommandPreferences);
  const [recent, setRecent] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    const readIds = (key: string, maximum: number) => { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, maximum) : []; } catch { return []; } };
    if (open) { setRecent(readIds(`${commandPreferencesKey}.recent`, 20)); setPinned(readIds(`${commandPreferencesKey}.pinned`, 50)); }
  }, [open]);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const easterEggCommands: Command[] = normalized === "hello skai" ? [{ id: "easter-hello-skai", label: "Say hello to Skai", detail: "A small hello from the team", run: () => unlockAchievement("hello-skai") }] : normalized === "sudo make me coffee" ? [{ id: "easter-coffee", label: "Make me coffee", detail: "Try the coffee dependency", run: () => unlockAchievement("coffee-command") }] : [];
    const projectCommands = projects.map((project): Command => ({ id: `project-${project.id}`, label: `Open project: ${project.name}`, detail: project.folderPaths.join(" · ") || "Project workspace", project, context: ["projects", "coding"] }));
    const taskCommands = tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).slice(0, 30).map((task): Command => ({ id: `task-${task.id}`, label: `Open task: ${task.title}`, detail: `${task.status.replaceAll("_", " ")} · ${task.projectId ? projects.find((project) => project.id === task.projectId)?.name ?? "Project" : "Workspace"}`, task, context: ["usage", "scheduled", "coding"] }));
    const expanded: Command[] = [...commands, { id: "new-chat", label: "Start a new chat", detail: "Open a clean conversation", run: onNewChat, context: ["chat"], shortcutId: "newChat" }, ...(["chat", "coding", "review", "research", "media"] as const).map((preset) => ({ id: `layout-${preset}`, label: `Use ${preset} layout`, detail: "Change the workspace arrangement", run: () => onApplyLayoutPreset?.(preset) })), ...projectCommands, ...taskCommands];
    const filtered = expanded.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalized));
    if (view === "recent") return filtered.filter((command) => recent.includes(command.id));
    if (view === "pinned") return filtered.filter((command) => pinned.includes(command.id));
    return filtered.concat(easterEggCommands);
  }, [onApplyLayoutPreset, onNewChat, pinned, preferences.shortcuts, projects, query, recent, tasks, view]);
  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setActiveIndex(0);
  }, [open]);
  useEffect(() => { setActiveIndex((current) => Math.min(current, Math.max(0, matches.length - 1))); }, [matches.length]);
  useEffect(() => { const refresh = () => setPreferences(readCommandPreferences()); window.addEventListener("skai-command-workflows-changed", refresh); return () => window.removeEventListener("skai-command-workflows-changed", refresh); }, []);
  const togglePinned = (id: string) => { const next = pinned.includes(id) ? pinned.filter((item) => item !== id) : [...pinned, id].slice(-50); setPinned(next); try { localStorage.setItem(`${commandPreferencesKey}.pinned`, JSON.stringify(next)); setView("pinned"); } catch { /* local pinning is optional */ } };
  const openCommand = (command: Command) => { if (command.run) command.run(); else if (command.task) onOpenTask?.(command.task); else if (command.project) onOpenProject?.(command.project); else if (command.route) onNavigate(command.route); const next = [command.id, ...recent.filter((id) => id !== command.id)].slice(0, 20); setRecent(next); try { localStorage.setItem(`${commandPreferencesKey}.recent`, JSON.stringify(next)); } catch { /* recent actions are optional */ } onClose(); };
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown" && matches.length > 0) { event.preventDefault(); setActiveIndex((current) => (current + 1) % matches.length); return; }
    if (event.key === "ArrowUp" && matches.length > 0) { event.preventDefault(); setActiveIndex((current) => (current - 1 + matches.length) % matches.length); return; }
    if (event.key === "Home" && matches.length > 0) { event.preventDefault(); setActiveIndex(0); return; }
    if (event.key === "End" && matches.length > 0) { event.preventDefault(); setActiveIndex(matches.length - 1); return; }
    if (event.key === "Enter" && matches[activeIndex]) { event.preventDefault(); openCommand(matches[activeIndex]); }
  };
  const activeCommand = matches[activeIndex];
  return <ModalDialog open={open} onClose={onClose} titleId="command-palette-title" initialFocusRef={inputRef} className="command-dialog"><div className="command-palette"><div className="command-heading"><div><p className="section-kicker">QUICK ACTIONS · {route.replaceAll("-", " ")}</p><h2 id="command-palette-title">Command palette</h2></div><button type="button" onClick={onClose} aria-label="Close command palette"><NavIcon name="close" /></button></div><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={onInputKeyDown} placeholder="Search pages, projects, tasks, layouts…" aria-label="Search commands" aria-controls="command-results" aria-activedescendant={activeCommand ? `command-${activeCommand.id}` : undefined} role="combobox" aria-expanded="true" aria-autocomplete="list" /><div className="command-filter-tabs" role="tablist" aria-label="Command groups">{(["all", "recent", "pinned"] as const).map((item) => <button type="button" role="tab" aria-selected={view === item} className={view === item ? "is-active" : ""} key={item} onClick={() => { setView(item); setActiveIndex(0); }}>{item === "all" ? "All commands" : item === "recent" ? "Recent" : "Pinned"}</button>)}</div><div className="command-list" id="command-results" role="listbox" aria-label="Available commands">{matches.length === 0 ? <p className="command-empty">{view === "pinned" ? "Pin commands with the star to keep them here." : view === "recent" ? "Commands you run will appear here." : "No matching actions."}</p> : matches.map((command, index) => { const shortcut = command.shortcutId ? preferences.shortcuts[command.shortcutId] : "↵"; return <div className={`command-row${index === activeIndex ? " is-active" : ""}`} key={command.id}><button className="command-row-open" id={`command-${command.id}`} role="option" aria-selected={index === activeIndex} aria-keyshortcuts={ariaShortcut(shortcut)} title={`${command.label} (${shortcut})`} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => openCommand(command)}><span><strong>{command.label}</strong><small>{command.detail}{command.context?.includes(route) ? " · Relevant here" : ""}</small></span><kbd>{shortcut}</kbd></button><button className="command-pin" type="button" aria-label={`${pinned.includes(command.id) ? "Unpin" : "Pin"} ${command.label}`} aria-pressed={pinned.includes(command.id)} onClick={() => togglePinned(command.id)}>★</button></div>; })}</div><p className="command-hint">Use ↑ ↓ to browse · Enter to open · Esc to close · Pin frequent actions for quick access</p></div></ModalDialog>;
}
