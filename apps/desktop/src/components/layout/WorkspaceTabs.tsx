import { useEffect, useState } from "react";
import type { DesktopTask } from "../../../shared/contracts";
import type { WorkspaceSessionTab } from "../../app/workspaceTabStore";
import { NavIcon } from "../ui/NavIcon";
import { formatShortcutForAssistiveTech, formatShortcutLabel } from "../../features/commands/preferences";

function tabRunStatus(tab: WorkspaceSessionTab, tasks: DesktopTask[]) {
  if (!tab.conversationId) return null;
  const linked = tasks.filter((task) => task.conversationId === tab.conversationId);
  if (linked.some((task) => task.status === "running" || task.status === "verifying")) return { label: "Running", kind: "running" };
  if (linked.some((task) => task.status === "queued")) return { label: "Queued", kind: "queued" };
  if (linked.some((task) => task.status === "completed")) return { label: "Review", kind: "review" };
  if (linked.some((task) => task.status === "failed" || task.status === "blocked")) return { label: "Attention", kind: "attention" };
  return null;
}

type TabMenu = { tabId: string | null; left: number; top: number };

export function WorkspaceTabs({ tabs, tasks, activeId, onSelect, onClose, onCloseMany, onReorder, onNew, newActionLabel = "New tab", canRestore = false, onRestore }: { tabs: WorkspaceSessionTab[]; tasks: DesktopTask[]; activeId: string; onSelect: (tab: WorkspaceSessionTab) => void; onClose: (id: string) => void; onCloseMany: (ids: string[]) => void; onReorder: (sourceId: string, targetId: string) => void; onNew: () => void; newActionLabel?: string; canRestore?: boolean; onRestore?: () => void }) {
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const active = tabs.findIndex((tab) => tab.id === activeId);
      const key = event.key.toLowerCase();
      if (key === "t" && event.shiftKey && onRestore) { event.preventDefault(); if (canRestore) onRestore(); }
      else if (key === "t" && !event.shiftKey) { event.preventDefault(); onNew(); }
      else if (key === "w") { event.preventDefault(); onClose(activeId); }
      else if ((key === "tab" || key === "pageup" || key === "pagedown") && tabs.length > 1) { event.preventDefault(); const step = event.shiftKey || key === "pageup" ? -1 : 1; onSelect(tabs[(active + step + tabs.length) % tabs.length]); }
      else if (/^[1-8]$/.test(key) && tabs.length) { event.preventDefault(); const index = Number(key) - 1; if (tabs[index]) onSelect(tabs[index]); }
      else if (key === "9" && tabs.length) { event.preventDefault(); onSelect(tabs[tabs.length - 1]); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, canRestore, onClose, onNew, onRestore, onSelect, tabs]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setMenu(null);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", close); };
  }, [menu]);
  const showMenu = (event: React.MouseEvent, tabId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ tabId, left: Math.min(event.clientX, window.innerWidth - 208), top: Math.min(event.clientY, window.innerHeight - 190) });
  };
  const moveTab = (event: React.DragEvent, targetId: string) => {
    const sourceId = event.dataTransfer.getData("text/skai-workspace-tab");
    if (sourceId && sourceId !== targetId) onReorder(sourceId, targetId);
  };
  const menuTabIndex = menu?.tabId ? tabs.findIndex((tab) => tab.id === menu.tabId) : -1;
  return <div className="workspace-tab-strip" role="group" aria-label="Open chats and projects" onContextMenu={(event) => showMenu(event, null)} onDoubleClick={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains("workspace-tab-list")) onNew(); }}>
    <div className="workspace-tab-list">{tabs.map((tab) => { const status = tabRunStatus(tab, tasks); return <div className={`workspace-tab${tab.id === activeId ? " is-active" : ""}${dropTargetId === tab.id ? " is-drop-target" : ""}`} key={tab.id} data-workspace-tab-id={tab.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/skai-workspace-tab", tab.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnter={() => setDropTargetId(tab.id)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null); }} onDrop={(event) => { event.preventDefault(); moveTab(event, tab.id); setDropTargetId(null); }} onDragEnd={() => setDropTargetId(null)} onContextMenu={(event) => showMenu(event, tab.id)} onAuxClick={(event) => { if (event.button === 1) onClose(tab.id); }}>
      <button className="workspace-tab-select" type="button" aria-current={tab.id === activeId ? "page" : undefined} title={`${tab.title}${status ? ` · ${status.label}` : ""}`} onClick={() => onSelect(tab)}><NavIcon name={tab.projectId ? "project" : "chat"} /><span>{tab.title}</span>{status && <small className={`workspace-tab-status is-${status.kind}`}>{status.label}</small>}</button>
      <button className="workspace-tab-close" type="button" aria-label={`Close ${tab.title}`} title="Close tab" onClick={() => onClose(tab.id)}><NavIcon name="close" /></button>
    </div>; })}</div>
    <button className="workspace-tab-new" type="button" aria-label={newActionLabel} aria-keyshortcuts={formatShortcutForAssistiveTech("Ctrl+T")} title={`${newActionLabel} (${formatShortcutLabel("Ctrl+T")})`} onClick={onNew}><NavIcon name="plus" /></button>
    {menu && <div className="workspace-tab-context-menu" role="menu" aria-label="Tab actions" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>
      {menu.tabId && <><button type="button" role="menuitem" aria-keyshortcuts={formatShortcutForAssistiveTech("Ctrl+W")} onClick={() => { onClose(menu.tabId!); setMenu(null); }}>Close tab <kbd>{formatShortcutLabel("Ctrl+W")}</kbd></button><button type="button" role="menuitem" disabled={tabs.length < 2} onClick={() => { onCloseMany(tabs.filter((tab) => tab.id !== menu.tabId).map((tab) => tab.id)); setMenu(null); }}>Close other tabs</button><button type="button" role="menuitem" disabled={menuTabIndex < 0 || menuTabIndex === tabs.length - 1} onClick={() => { onCloseMany(tabs.slice(menuTabIndex + 1).map((tab) => tab.id)); setMenu(null); }}>Close tabs to the right</button><div className="workspace-tab-menu-divider" />{onRestore && <button type="button" role="menuitem" aria-keyshortcuts={formatShortcutForAssistiveTech("Ctrl+Shift+T")} disabled={!canRestore} onClick={() => { onRestore(); setMenu(null); }}>Reopen closed tab <kbd>{formatShortcutLabel("Ctrl+Shift+T")}</kbd></button>}</>}
      <button type="button" role="menuitem" aria-keyshortcuts={formatShortcutForAssistiveTech("Ctrl+T")} onClick={() => { onNew(); setMenu(null); }}>{newActionLabel} <kbd>{formatShortcutLabel("Ctrl+T")}</kbd></button>
    </div>}
  </div>;
}
