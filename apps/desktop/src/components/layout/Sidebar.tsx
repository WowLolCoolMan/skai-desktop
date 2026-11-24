import { useEffect, useRef, useState } from "react";
import type { Route } from "../../app/types";
import type { DesktopConversation, DesktopProject } from "../../../shared/contracts";
import { NavIcon, type NavIconName } from "../ui/NavIcon";
import { Button } from "../ui/Primitives";

type ConversationPatch = { pinned?: boolean; archived?: boolean; title?: string };
type AgentMode = "ChatBot" | "Coding Agent";
const workspaceDestinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "chat", icon: "chat", label: "Chat" },
  { route: "projects", icon: "project", label: "Projects" },
  { route: "coding", icon: "code", label: "Coding" },
];
const toolDestinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "images", icon: "image", label: "Images" },
  { route: "video", icon: "video", label: "Video · planned" },
  { route: "models", icon: "model", label: "Models" },
  { route: "marketplace", icon: "marketplace", label: "Marketplace" },
  { route: "scheduled", icon: "clock", label: "Scheduled" },
];
const moreDestinations: Array<{ route: Route; icon: NavIconName; label: string }> = [
  { route: "compare", icon: "compare", label: "Compare" },
  { route: "terminal", icon: "terminal", label: "Terminal" },
  { route: "memory", icon: "memory", label: "Memory" },
  { route: "usage", icon: "activity", label: "Usage" },
  { route: "persona-workshop", icon: "sparkle", label: "Personas" },
  { route: "pet-workshop", icon: "sparkle", label: "Pets" },
  { route: "voice-workbench", icon: "audio", label: "Voice Workbench" },
];

export function Sidebar({ route, activeConversationId, agentMode, onAgentModeChange, onNavigate, conversations, projects, query, sidebarWidth, onSidebarWidthChange, onQueryChange, onNewChat, onOpenProject, onSelectConversation, onConversationMetadata, className = "" }: { route: Route; activeConversationId: string | null; agentMode: AgentMode; onAgentModeChange: (mode: AgentMode) => void; onNavigate: (route: Route) => void; conversations: DesktopConversation[]; projects: DesktopProject[]; query: string; sidebarWidth: number; onSidebarWidthChange: (width: number) => void; onQueryChange: (query: string) => void; onNewChat: () => void; onOpenProject: (project: DesktopProject) => void; onSelectConversation: (id: string) => void; onConversationMetadata: (id: string, patch: ConversationPatch) => Promise<boolean>; className?: string }) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(() => moreDestinations.some((item) => item.route === route));
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const menuFirstActionRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuConversationId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuConversationId(null); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".sidebar-context-menu") || target.closest(".sidebar-history-menu-trigger"))) return;
      setMenuConversationId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("pointerdown", closeOnOutsidePointer); };
  }, [menuConversationId]);
  useEffect(() => {
    if (!agentMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAgentMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => { if (!agentMenuRef.current?.contains(event.target as Node)) setAgentMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("pointerdown", closeOnOutsidePointer); };
  }, [agentMenuOpen]);
  useEffect(() => {
    if (moreDestinations.some((item) => item.route === route)) setMoreToolsOpen(true);
  }, [route]);
  useEffect(() => {
    if (menuConversationId) menuFirstActionRef.current?.focus();
    else menuTriggerRef.current?.focus();
  }, [menuConversationId]);
  useEffect(() => {
    if (!resizing) return;
    const onPointerMove = (event: PointerEvent) => {
      const current = resizeState.current;
      if (current) onSidebarWidthChange(current.startWidth + event.clientX - current.startX);
    };
    const stopResizing = () => { resizeState.current = null; setResizing(false); };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing, { once: true });
    window.addEventListener("blur", stopResizing, { once: true });
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", stopResizing); window.removeEventListener("blur", stopResizing); };
  }, [onSidebarWidthChange, resizing]);
  const openMenu = (conversation: DesktopConversation, trigger?: HTMLButtonElement | null) => { menuTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null); setMenuConversationId(conversation.id); };
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    if (event.key === "Tab") { event.preventDefault(); setMenuConversationId(null); return; }
    const items = Array.from(menu.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };
  const runMetadataAction = async (id: string, patch: ConversationPatch) => { const saved = await onConversationMetadata(id, patch); if (saved) setMenuConversationId(null); };
  const visibleConversations = conversations.filter((conversation) => (conversation.mode ?? "ChatBot") === agentMode && conversation.title.toLowerCase().includes(query.toLowerCase()));
  const projectThreads = (projectId: string) => visibleConversations.filter((conversation) => conversation.projectId === projectId);
  const standaloneCodingThreads = visibleConversations.filter((conversation) => !conversation.projectId);
  const toggleProject = (projectId: string) => setExpandedProjectIds((current) => { const next = new Set(current); if (next.has(projectId)) next.delete(projectId); else next.add(projectId); return next; });
  const isDestinationActive = (target: Route) => route === target;
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => { event.preventDefault(); resizeState.current = { startX: event.clientX, startWidth: sidebarWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); setResizing(true); };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => { const amount = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : event.key === "Home" ? 248 - sidebarWidth : event.key === "End" ? 360 - sidebarWidth : 0; if (!amount) return; event.preventDefault(); onSidebarWidthChange(sidebarWidth + amount); };
  return <aside id="workspace-sidebar" className={`app-sidebar ${className} ${agentMode === "Coding Agent" ? "is-coding-agent" : ""} ${resizing ? "is-resizing" : ""}`} aria-label="Workspace navigation">
    <div className="sidebar-brand-row"><span className="sidebar-brand-mark"><NavIcon name="sparkle" /></span><span className="sidebar-brand-copy"><strong>Skai Desktop</strong><small>Local workspace</small></span></div>
    <div className="sidebar-agent-switcher" ref={agentMenuRef}><button className="sidebar-agent-trigger" type="button" aria-haspopup="menu" aria-expanded={agentMenuOpen} onClick={() => setAgentMenuOpen((open) => !open)}><NavIcon name={agentMode === "Coding Agent" ? "code" : "chat"} /><span><small>MODE</small><strong>{agentMode === "Coding Agent" ? "Coding agent" : "Chat"}</strong></span><NavIcon name="chevron-right" /></button>{agentMenuOpen && <div className="sidebar-agent-menu" role="menu" aria-label="Switch mode"><button type="button" role="menuitemradio" aria-checked={agentMode === "ChatBot"} onClick={() => { onAgentModeChange("ChatBot"); setAgentMenuOpen(false); }}><NavIcon name="chat" /><span><strong>Chat</strong><small>General conversations</small></span>{agentMode === "ChatBot" && <span className="sidebar-agent-check">✓</span>}</button><button type="button" role="menuitemradio" aria-checked={agentMode === "Coding Agent"} onClick={() => { onAgentModeChange("Coding Agent"); setAgentMenuOpen(false); }}><NavIcon name="code" /><span><strong>Coding agent</strong><small>Code and project threads</small></span>{agentMode === "Coding Agent" && <span className="sidebar-agent-check">✓</span>}</button></div>}</div>
    <Button variant="primary" className="new-chat-button" onClick={onNewChat}><NavIcon name="plus" /> <span>{agentMode === "Coding Agent" ? "New coding thread" : "New chat"}</span><kbd>Ctrl N</kbd></Button>
    <div className="sidebar-workspace-nav">
      <nav className="sidebar-nav-group" aria-label="Workspace"><p className="sidebar-label">WORKSPACE</p>{workspaceDestinations.map((item) => <button type="button" key={item.route} className={`sidebar-nav-link ${isDestinationActive(item.route) ? "is-active" : ""}`} aria-current={isDestinationActive(item.route) ? "page" : undefined} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <nav className="sidebar-nav-group" aria-label="Tools"><p className="sidebar-label">TOOLS</p>{toolDestinations.map((item) => <button type="button" key={item.route} className={`sidebar-nav-link ${isDestinationActive(item.route) ? "is-active" : ""}`} aria-current={isDestinationActive(item.route) ? "page" : undefined} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <details className="sidebar-more-tools" open={moreToolsOpen} onToggle={(event) => setMoreToolsOpen(event.currentTarget.open)}><summary>More tools</summary><nav className="sidebar-nav-group" aria-label="More tools">{moreDestinations.map((item) => <button type="button" key={item.route} className={`sidebar-nav-link ${isDestinationActive(item.route) ? "is-active" : ""}`} aria-current={isDestinationActive(item.route) ? "page" : undefined} onClick={() => onNavigate(item.route)}><NavIcon name={item.icon} /><span>{item.label}</span></button>)}</nav></details>
    </div>
    {agentMode === "Coding Agent" ? <>
      <nav className="sidebar-projects sidebar-project-tree" aria-label="Projects and coding threads"><div className="sidebar-label-row"><button className="sidebar-section-link" type="button" onClick={() => onNavigate("projects")}>PROJECTS</button><button type="button" aria-label="Create project" onClick={() => onNavigate("projects")}><NavIcon name="plus" /></button></div>{projects.length === 0 ? <button className="sidebar-project-empty" type="button" onClick={() => onNavigate("projects")}><strong>No projects yet</strong><span>Open a folder to get started</span></button> : projects.map((project) => { const threads = projectThreads(project.id); const expanded = expandedProjectIds.has(project.id) || threads.some((conversation) => conversation.id === activeConversationId); return <section className="sidebar-project-group" key={project.id}><div className={`sidebar-project-tree-row${threads.some((conversation) => conversation.id === activeConversationId) ? " is-active" : ""}`}><button type="button" className={`sidebar-project-expand${expanded ? " is-expanded" : ""}`} aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} aria-expanded={expanded} onClick={() => toggleProject(project.id)}><NavIcon name="chevron-right" /></button><button className="sidebar-project-tree-open" type="button" title={project.name} onClick={() => onOpenProject(project)}><NavIcon name="project" /><span>{project.name}</span></button><span className="sidebar-project-thread-count">{threads.length || ""}</span></div>{expanded && <div className="sidebar-project-thread-list">{threads.length ? threads.map((conversation) => <div key={conversation.id} className="sidebar-project-thread-row"><button type="button" className={`sidebar-project-thread${conversation.id === activeConversationId ? " is-active" : ""}`} aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} title={conversation.title}><span>{conversation.title}</span></button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>) : <p className="sidebar-project-no-threads">{query ? "No matching threads" : "No coding threads yet"}</p>}</div>}</section>; })}</nav>
      <div className="sidebar-history sidebar-coding-recent"><div className="sidebar-label-row"><p className="sidebar-label">RECENT THREADS</p><button type="button" aria-label="Start a new coding thread" onClick={onNewChat}><NavIcon name="plus" /></button></div><input className="sidebar-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search coding threads…" aria-label="Search coding threads" /><div className="sidebar-history-list" role="region" aria-label="Standalone coding threads">{standaloneCodingThreads.length === 0 ? <p className="sidebar-muted">{query ? "No matching threads." : "Your ungrouped coding threads will appear here."}</p> : standaloneCodingThreads.map((conversation) => <div className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""}`} key={conversation.id}><button className="sidebar-history-item" aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} type="button">{conversation.title}</button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>)}</div></div>
    </> : <>
      <nav className="sidebar-projects" aria-label="Recent projects"><div className="sidebar-label-row"><button className="sidebar-section-link" type="button" onClick={() => onNavigate("projects")}>RECENT PROJECTS</button><button type="button" aria-label="Create project" onClick={() => onNavigate("projects")}><NavIcon name="plus" /></button></div>{projects.length === 0 ? <button className="sidebar-project-empty" type="button" onClick={() => onNavigate("projects")}><strong>No projects yet</strong><span>Open a folder to get started</span></button> : <>{projects.slice(0, 3).map((project) => <button className="sidebar-project-item" key={project.id} type="button" onClick={() => onOpenProject(project)}><span className="sidebar-project-icon"><NavIcon name="project" /></span><span><strong>{project.name}</strong><small>{project.folderPaths.length ? `${project.folderPaths.length} folder${project.folderPaths.length === 1 ? "" : "s"}` : "No folders connected"}</small></span></button>)}{projects.length > 3 && <button className="sidebar-project-more" type="button" onClick={() => onNavigate("projects")}>View all {projects.length} projects</button>}</>}</nav>
      <div className="sidebar-history"><div className="sidebar-label-row"><p className="sidebar-label">RECENT CHATS</p><button type="button" aria-label="Start a new chat" onClick={onNewChat}><NavIcon name="plus" /></button></div><input className="sidebar-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search chats…" aria-label="Search chats" /><div className="sidebar-history-list" role="region" aria-label="Chatting agent threads">{visibleConversations.length === 0 ? <p className="sidebar-muted">{query ? "No matching chats." : "No saved chats yet."}</p> : visibleConversations.map((conversation) => <div className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""}`} key={conversation.id}><button className="sidebar-history-item" aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} type="button">{conversation.title}</button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>)}</div></div>
    </>}
    <button type="button" className={`sidebar-nav-link sidebar-settings-link ${isDestinationActive("settings") ? "is-active" : ""}`} aria-current={isDestinationActive("settings") ? "page" : undefined} onClick={() => onNavigate("settings")}><NavIcon name="settings" /><span>Settings</span></button>
    <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={248} aria-valuemax={360} aria-valuenow={sidebarWidth} onPointerDown={startResize} onKeyDown={resizeWithKeyboard} />
  </aside>;
}
