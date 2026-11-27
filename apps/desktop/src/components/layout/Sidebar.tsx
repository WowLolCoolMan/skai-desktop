import { useEffect, useRef, useState } from "react";
import type { Route } from "../../app/types";
import type { DesktopConversation, DesktopProject } from "../../../shared/contracts";
import { NavIcon } from "../ui/NavIcon";
import { Button } from "../ui/Primitives";

type ConversationPatch = { pinned?: boolean; archived?: boolean; title?: string };
type AgentMode = "ChatBot" | "Coding Agent";

function relativeConversationTime(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ConversationLabel({ conversation }: { conversation: DesktopConversation }) {
  return <><span>{conversation.title}</span><time dateTime={conversation.updatedAt} title={new Date(conversation.updatedAt).toLocaleString()}>{relativeConversationTime(conversation.updatedAt)}</time></>;
}

export function Sidebar({ route, activeConversationId, agentMode, onAgentModeChange, onNavigate, conversations, projects, query, sidebarWidth, onSidebarWidthChange, onQueryChange, onNewChat, onNewProjectThread, onOpenProject, onSelectConversation, onConversationMetadata, className = "" }: { route: Route; activeConversationId: string | null; agentMode: AgentMode; onAgentModeChange: (mode: "ChatBot" | "Coding Agent") => void; onNavigate: (route: Route) => void; conversations: DesktopConversation[]; projects: DesktopProject[]; query: string; sidebarWidth: number; onSidebarWidthChange: (width: number) => void; onQueryChange: (query: string) => void; onNewChat: () => void; onNewProjectThread: (project: DesktopProject) => void; onOpenProject: (project: DesktopProject) => void; onSelectConversation: (id: string) => void; onConversationMetadata: (id: string, patch: ConversationPatch) => Promise<boolean>; className?: string }) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("skai.pinnedProjects") ?? "[]"); } catch { return []; }
  });
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const menuFirstActionRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuConversationId && !menuProjectId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuConversationId(null); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".sidebar-context-menu") || target.closest(".sidebar-project-menu") || target.closest(".sidebar-history-menu-trigger") || target.closest(".sidebar-project-menu-trigger"))) return;
      setMenuConversationId(null); setMenuProjectId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("pointerdown", closeOnOutsidePointer); };
  }, [menuConversationId, menuProjectId]);
  useEffect(() => {
    if (!agentMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAgentMenuOpen(false); };
    const closeOnOutsidePointer = (event: PointerEvent) => { if (!agentMenuRef.current?.contains(event.target as Node)) setAgentMenuOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("pointerdown", closeOnOutsidePointer); };
  }, [agentMenuOpen]);
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
  const renameConversation = (conversation: DesktopConversation) => {
    const title = window.prompt("Rename conversation", conversation.title)?.trim();
    if (title && title !== conversation.title) void runMetadataAction(conversation.id, { title });
  };
  const toggleProjectPin = (projectId: string) => {
    setPinnedProjectIds((current) => {
      const next = current.includes(projectId) ? current.filter((id) => id !== projectId) : [projectId, ...current];
      localStorage.setItem("skai.pinnedProjects", JSON.stringify(next));
      return next;
    });
    setMenuProjectId(null);
  };
  const searchQuery = query.trim().toLowerCase();
  const modeConversations = conversations.filter((conversation) => (conversation.mode ?? "ChatBot") === agentMode);
  const visibleConversations = modeConversations.filter((conversation) => !searchQuery || conversation.title.toLowerCase().includes(searchQuery));
  const pinnedConversations = visibleConversations.filter((conversation) => conversation.pinned);
  const recentConversations = visibleConversations.filter((conversation) => !conversation.pinned);
  const projectMatchesSearch = (projectId: string) => {
    if (!searchQuery) return true;
    const project = projects.find((item) => item.id === projectId);
    return Boolean(project && `${project.name} ${project.folderPaths.join(" ")}`.toLowerCase().includes(searchQuery));
  };
  const projectThreads = (projectId: string) => modeConversations.filter((conversation) => conversation.projectId === projectId
    && (!searchQuery || projectMatchesSearch(projectId) || conversation.title.toLowerCase().includes(searchQuery)));
  const visibleCodingProjects = projects.filter((project) => projectMatchesSearch(project.id)
    || modeConversations.some((conversation) => conversation.projectId === project.id && conversation.title.toLowerCase().includes(searchQuery)));
  const activeProjectId = conversations.find((conversation) => conversation.id === activeConversationId
    && (conversation.mode ?? "ChatBot") === "Coding Agent")?.projectId;
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) : undefined;
  const recentCodingProjects = visibleCodingProjects.filter((project) => project.id !== activeProject?.id).slice(0, 4);
  const orderedCodingProjects = [...visibleCodingProjects].sort((a, b) => Number(pinnedProjectIds.includes(b.id)) - Number(pinnedProjectIds.includes(a.id)));
  const sidebarCodingProjects = searchQuery
    ? visibleCodingProjects
    : activeProject
      ? [activeProject, ...recentCodingProjects.filter((project) => project.id !== activeProject.id)].sort((a, b) => Number(pinnedProjectIds.includes(b.id)) - Number(pinnedProjectIds.includes(a.id)))
      : orderedCodingProjects.slice(0, 5);
  const standaloneCodingThreads = visibleConversations.filter((conversation) => !conversation.projectId);
  const toggleProject = (projectId: string) => setExpandedProjectIds((current) => { const next = new Set(current); if (next.has(projectId)) next.delete(projectId); else next.add(projectId); return next; });
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => { event.preventDefault(); resizeState.current = { startX: event.clientX, startWidth: sidebarWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); setResizing(true); };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => { const amount = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : event.key === "Home" ? 248 - sidebarWidth : event.key === "End" ? 360 - sidebarWidth : 0; if (!amount) return; event.preventDefault(); onSidebarWidthChange(sidebarWidth + amount); };
  return <aside id="workspace-sidebar" className={`app-sidebar ${className} ${agentMode === "Coding Agent" ? "is-coding-agent" : ""} ${resizing ? "is-resizing" : ""}`} aria-label="Workspace navigation">
    <div className="sidebar-brand-row"><span className="sidebar-brand-mark"><NavIcon name="sparkle" /></span><span className="sidebar-brand-copy"><strong>Skai Desktop</strong><small>Local workspace</small></span></div>
    <div className="sidebar-agent-switcher" ref={agentMenuRef}><button className="sidebar-agent-trigger" type="button" aria-haspopup="menu" aria-expanded={agentMenuOpen} onClick={() => setAgentMenuOpen((open) => !open)}><NavIcon name={agentMode === "Coding Agent" ? "code" : "chat"} /><span><small>MODE</small><strong>{agentMode === "Coding Agent" ? "Coding agent" : "Chat"}</strong></span><NavIcon name="chevron-right" /></button>{agentMenuOpen && <div className="sidebar-agent-menu" role="menu" aria-label="Switch mode"><button type="button" role="menuitemradio" aria-checked={agentMode === "ChatBot"} onClick={() => { onAgentModeChange("ChatBot"); setAgentMenuOpen(false); }}><NavIcon name="chat" /><span><strong>Chat</strong><small>General conversations</small></span>{agentMode === "ChatBot" && <span className="sidebar-agent-check">✓</span>}</button><button type="button" role="menuitemradio" aria-checked={agentMode === "Coding Agent"} onClick={() => { onAgentModeChange("Coding Agent"); setAgentMenuOpen(false); }}><NavIcon name="code" /><span><strong>Coding agent</strong><small>Code and project threads</small></span>{agentMode === "Coding Agent" && <span className="sidebar-agent-check">✓</span>}</button></div>}</div>
    <Button variant="primary" className="new-chat-button" onClick={onNewChat}><NavIcon name="plus" /> <span>{agentMode === "Coding Agent" ? "New coding thread" : "New chat"}</span><kbd>Ctrl N</kbd></Button>
    {agentMode !== "Coding Agent" && pinnedConversations.length > 0 && <section className="sidebar-pinned" aria-label="Pinned chats"><p className="sidebar-label">PINNED</p>{pinnedConversations.map((conversation) => <div className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""}`} key={`pinned-${conversation.id}`}><button className="sidebar-history-item" aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => onSelectConversation(conversation.id)} type="button"><ConversationLabel conversation={conversation} /></button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Unpin ${conversation.title}`} title="Unpin chat" onClick={() => void runMetadataAction(conversation.id, { pinned: false })}><NavIcon name="close" /></button></div>)}</section>}
    {agentMode === "Coding Agent" ? <>
      <input className="sidebar-search" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search projects and threads…" aria-label="Search projects and coding threads" />
      <nav className="sidebar-projects sidebar-project-tree" aria-label="Projects and coding threads"><div className="sidebar-label-row"><button className="sidebar-section-link" type="button" onClick={() => onNavigate("projects")}>PROJECTS</button><button type="button" aria-label="Open project directory" title="Browse projects" onClick={() => onNavigate("projects")}><NavIcon name="project" /></button></div>{projects.length === 0 ? <button className="sidebar-project-empty" type="button" onClick={() => onNavigate("projects")}><strong>No projects yet</strong><span>Open a folder to get started</span></button> : visibleCodingProjects.length === 0 ? <p className="sidebar-project-no-threads" role="status">No projects match this search.</p> : sidebarCodingProjects.map((project) => { const threads = projectThreads(project.id); const expanded = Boolean(searchQuery && (projectMatchesSearch(project.id) || threads.length > 0)) || expandedProjectIds.has(project.id) || threads.some((conversation) => conversation.id === activeConversationId); const projectPinned = pinnedProjectIds.includes(project.id); return <section className="sidebar-project-group" key={project.id}><div className={`sidebar-project-tree-row${threads.some((conversation) => conversation.id === activeConversationId) ? " is-active" : ""}`}><button type="button" className={`sidebar-project-expand${expanded ? " is-expanded" : ""}`} aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} aria-expanded={expanded} onClick={() => toggleProject(project.id)}><NavIcon name="chevron-right" /></button><button className="sidebar-project-tree-open" type="button" title={project.name} onClick={() => onOpenProject(project)}><NavIcon name="project" /><span>{project.name}</span></button><span className="sidebar-project-thread-count">{threads.length || ""}</span><button className="sidebar-project-new-thread" type="button" aria-label={`New thread in ${project.name}`} title={`New thread in ${project.name}`} onClick={() => onNewProjectThread(project)}><NavIcon name="plus" /></button><button className="sidebar-project-menu-trigger" type="button" aria-label={`Actions for ${project.name}`} aria-haspopup="menu" aria-expanded={menuProjectId === project.id} onClick={() => { setMenuConversationId(null); setMenuProjectId(menuProjectId === project.id ? null : project.id); }}><NavIcon name="more" /></button>{menuProjectId === project.id && <div ref={projectMenuRef} className="sidebar-project-menu" role="menu" aria-label={`Actions for ${project.name}`}><button type="button" role="menuitem" onClick={() => toggleProjectPin(project.id)}>{projectPinned ? "Unpin project" : "Pin project"}</button><button type="button" role="menuitem" onClick={() => { onOpenProject(project); setMenuProjectId(null); }}>Project settings</button><button type="button" role="menuitem" onClick={() => { setExpandedProjectIds((current) => new Set(current).add(project.id)); setMenuProjectId(null); }}>Show project threads</button></div>}</div>{expanded && <div className="sidebar-project-thread-list">{threads.length ? threads.map((conversation) => <div key={conversation.id} className="sidebar-project-thread-row"><button type="button" className={`sidebar-project-thread${conversation.id === activeConversationId ? " is-active" : ""}`} aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} title={conversation.title}><span>{conversation.title}</span></button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => renameConversation(conversation)}>Rename</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>) : <p className="sidebar-project-no-threads">{projectMatchesSearch(project.id) ? "No coding threads yet" : "No matching threads"}</p>}</div>}</section>; })}{!searchQuery && visibleCodingProjects.length > sidebarCodingProjects.length && <button className="sidebar-project-more" type="button" onClick={() => onNavigate("projects")}>View all {visibleCodingProjects.length} projects</button>}</nav>
      <div className="sidebar-history sidebar-coding-recent"><div className="sidebar-label-row"><p className="sidebar-label">RECENT THREADS</p><button type="button" aria-label="Start a new coding thread" onClick={onNewChat}><NavIcon name="plus" /></button></div><div className="sidebar-history-list" role="region" aria-label="Standalone coding threads">{standaloneCodingThreads.length === 0 ? <p className="sidebar-muted">{query ? "No matching threads." : "Your ungrouped coding threads will appear here."}</p> : standaloneCodingThreads.map((conversation) => <div className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""}`} key={conversation.id}><button className="sidebar-history-item" aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} type="button"><ConversationLabel conversation={conversation} /></button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>)}</div></div>
    </> : <>
      <nav className="sidebar-projects" aria-label="Recent projects"><div className="sidebar-label-row"><button className="sidebar-section-link" type="button" onClick={() => onNavigate("projects")}>RECENT PROJECTS</button><button type="button" aria-label="Open project directory" title="Browse projects" onClick={() => onNavigate("projects")}><NavIcon name="project" /></button></div>{projects.length === 0 ? <button className="sidebar-project-empty" type="button" onClick={() => onNavigate("projects")}><strong>No projects yet</strong><span>Open a folder to get started</span></button> : <>{projects.slice(0, 3).map((project) => <button className="sidebar-project-item" key={project.id} type="button" onClick={() => onOpenProject(project)}><span className="sidebar-project-icon"><NavIcon name="project" /></span><span><strong>{project.name}</strong><small>{project.folderPaths.length ? `${project.folderPaths.length} folder${project.folderPaths.length === 1 ? "s" : "s"}` : "No folders connected"}</small></span></button>)}{projects.length > 3 && <button className="sidebar-project-more" type="button" onClick={() => onNavigate("projects")}>View all {projects.length} projects</button>}</>}</nav>
      <div className="sidebar-history"><div className="sidebar-label-row"><p className="sidebar-label">RECENT CHATS</p><button type="button" aria-label="Start a new chat" onClick={onNewChat}><NavIcon name="plus" /></button></div><input className="sidebar-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search chats…" aria-label="Search chats" /><div className="sidebar-history-list" role="region" aria-label="Chatting agent threads">{recentConversations.length === 0 ? <p className="sidebar-muted">{query ? "No matching chats." : "No saved chats yet."}</p> : recentConversations.map((conversation) => <div className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""}`} key={conversation.id}><button className="sidebar-history-item" aria-current={conversation.id === activeConversationId ? "page" : undefined} onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} type="button"><ConversationLabel conversation={conversation} /></button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>)}</div></div>
    </>}
    <div className="sidebar-resize-handle" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={248} aria-valuemax={360} aria-valuenow={sidebarWidth} onPointerDown={startResize} onKeyDown={resizeWithKeyboard} />
  </aside>;
}
