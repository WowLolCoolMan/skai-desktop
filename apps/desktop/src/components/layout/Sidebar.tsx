import { useEffect, useRef, useState } from "react";
import type { Route } from "../../app/types";
import type { DesktopConversation, DesktopProject } from "../../../shared/contracts";
import { NavIcon } from "../ui/NavIcon";
import { Button } from "../ui/Primitives";

type ConversationPatch = { pinned?: boolean; archived?: boolean; title?: string };
type AgentMode = "ChatBot" | "Coding Agent";
const activeSessionLabels: Record<Route, string> = { chat: "Home chat", projects: "Projects", coding: "Coding workspace", settings: "Settings", models: "Models", images: "Image Studio", marketplace: "Marketplace", plugins: "Marketplace", workbench: "Home chat", terminal: "Terminal", memory: "Memory", usage: "Usage", "pet-workshop": "Pet Workshop", "voice-workbench": "Voice Workbench", "persona-workshop": "Skai Personas", personas: "Skai Personas", "persona-groups": "Skai Personas" };

export function Sidebar({ route, agentMode, onAgentModeChange, onNavigate, conversations, projects, query, collapsed, sidebarWidth, onSidebarWidthChange, onQueryChange, onToggleCollapsed, onNewChat, onOpenProject, onSelectConversation, onConversationMetadata, className = "" }: { route: Route; agentMode: AgentMode; onAgentModeChange: (mode: AgentMode) => void; onNavigate: (route: Route) => void; conversations: DesktopConversation[]; projects: DesktopProject[]; query: string; collapsed: boolean; sidebarWidth: number; onSidebarWidthChange: (width: number) => void; onQueryChange: (query: string) => void; onToggleCollapsed: () => void; onNewChat: () => void; onOpenProject: (project: DesktopProject) => void; onSelectConversation: (id: string) => void; onConversationMetadata: (id: string, patch: ConversationPatch) => Promise<boolean>; className?: string }) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [menuConversationId, setMenuConversationId] = useState<string | null>(null);
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
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => { if (collapsed) return; event.preventDefault(); resizeState.current = { startX: event.clientX, startWidth: sidebarWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); setResizing(true); };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => { if (collapsed) return; const amount = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : event.key === "Home" ? 220 - sidebarWidth : event.key === "End" ? 360 - sidebarWidth : 0; if (!amount) return; event.preventDefault(); onSidebarWidthChange(sidebarWidth + amount); };
  return <aside className={`app-sidebar ${className} ${collapsed ? "is-collapsed" : ""} ${resizing ? "is-resizing" : ""}`} aria-label="Threads and projects">
    <div className="sidebar-agent-switcher" ref={agentMenuRef}><button className="sidebar-agent-trigger" type="button" aria-haspopup="menu" aria-expanded={agentMenuOpen} onClick={() => setAgentMenuOpen((open) => !open)}><NavIcon name={agentMode === "Coding Agent" ? "code" : "chat"} /><span><small>AGENT</small><strong>{agentMode === "Coding Agent" ? "Coding Agent" : "Chatting Agent"}</strong></span><NavIcon name="chevron-right" /></button>{agentMenuOpen && <div className="sidebar-agent-menu" role="menu" aria-label="Switch agent"><button type="button" role="menuitemradio" aria-checked={agentMode === "ChatBot"} onClick={() => { onAgentModeChange("ChatBot"); setAgentMenuOpen(false); }}><NavIcon name="chat" /><span><strong>Chatting Agent</strong><small>General conversations</small></span>{agentMode === "ChatBot" && <span className="sidebar-agent-check">✓</span>}</button><button type="button" role="menuitemradio" aria-checked={agentMode === "Coding Agent"} onClick={() => { onAgentModeChange("Coding Agent"); setAgentMenuOpen(false); }}><NavIcon name="code" /><span><strong>Coding Agent</strong><small>Code and project threads</small></span>{agentMode === "Coding Agent" && <span className="sidebar-agent-check">✓</span>}</button></div>}</div>
    <div className="sidebar-top-actions"><Button variant="primary" className="new-chat-button" onClick={onNewChat}><NavIcon name="plus" /> <span>{agentMode === "Coding Agent" ? "New coding thread" : "New chat"}</span></Button><button className="sidebar-collapse" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}><NavIcon name={collapsed ? "chevron-right" : "chevron-left"} /></button></div>
    {agentMode === "Coding Agent" && <nav className="sidebar-projects" aria-label="Projects"><div className="sidebar-label-row"><p className="sidebar-label">PROJECTS</p><button type="button" aria-label="Create project" onClick={() => onNavigate("projects")}><NavIcon name="plus" /></button></div>{projects.length === 0 ? <button className="sidebar-project-empty" type="button" onClick={() => onNavigate("projects")}><strong>No local projects yet</strong><span>Browse or create a project</span></button> : <>{projects.slice(0, 4).map((project) => <button className="sidebar-project-item" key={project.id} type="button" onClick={() => onOpenProject(project)}><span className="sidebar-project-icon"><NavIcon name="project" /></span><span><strong>{project.name}</strong><small>{project.folderPaths.length ? `${project.folderPaths.length} folder${project.folderPaths.length === 1 ? "" : "s"}` : "No folders connected"}</small></span></button>)}<button className="sidebar-project-more" type="button" onClick={() => onNavigate("projects")}>View all {projects.length} projects</button></>}</nav>}
    <div className="sidebar-history"><div className="sidebar-label-row"><p className="sidebar-label">{agentMode === "Coding Agent" ? "CODING THREADS" : "RECENT CHATS"}</p><button type="button" aria-label={agentMode === "Coding Agent" ? "Start a new coding thread" : "Start a new chat"} onClick={onNewChat}><NavIcon name="plus" /></button></div><input className="sidebar-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={agentMode === "Coding Agent" ? "Search coding threads…" : "Search chats…"} aria-label={agentMode === "Coding Agent" ? "Search coding threads" : "Search chats"} /><div className="sidebar-history-list" aria-label={agentMode === "Coding Agent" ? "Coding agent threads" : "Chatting agent threads"}>{visibleConversations.length === 0 ? <p className="sidebar-muted">{query ? "No matching threads." : agentMode === "Coding Agent" ? "No coding threads yet." : "No saved chats yet."}</p> : visibleConversations.map((conversation) => <div className="sidebar-history-row" key={conversation.id}><button className="sidebar-history-item" onClick={() => { onSelectConversation(conversation.id); setMenuConversationId(null); }} onContextMenu={(event) => { event.preventDefault(); openMenu(conversation, event.currentTarget); }} type="button">{conversation.title}</button><button className="sidebar-history-menu-trigger" type="button" aria-label={`Actions for ${conversation.title}`} aria-haspopup="menu" aria-expanded={menuConversationId === conversation.id} onClick={(event) => menuConversationId === conversation.id ? setMenuConversationId(null) : openMenu(conversation, event.currentTarget)}><NavIcon name="more" /></button>{menuConversationId === conversation.id && <div ref={menuRef} className="sidebar-context-menu" role="menu" aria-label={`Actions for ${conversation.title}`} onKeyDown={onMenuKeyDown}><button ref={menuFirstActionRef} type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { pinned: !conversation.pinned })}>{conversation.pinned ? "Unpin" : "Pin"}</button><button type="button" role="menuitem" onClick={() => void runMetadataAction(conversation.id, { archived: true })}>Archive</button></div>}</div>)}</div></div>
    <section className="sidebar-active-session" aria-label="Active session"><div className="sidebar-label-row"><p className="sidebar-label">ACTIVE SESSION</p><span className="sidebar-session-dot" aria-hidden="true" /></div><button type="button" className="sidebar-session-item" onClick={() => onNavigate(route)}><span><strong>{activeSessionLabels[route]}</strong><small>Local workspace · ready</small></span><NavIcon name="chevron-right" /></button></section>
    <div className="sidebar-resize-handle" role="separator" tabIndex={collapsed ? -1 : 0} aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={220} aria-valuemax={360} aria-valuenow={sidebarWidth} onPointerDown={startResize} onKeyDown={resizeWithKeyboard} />
  </aside>;
}
