import { useEffect } from "react";
import type { WorkspaceSessionTab } from "../../app/useDesktopWorkspace";
import { NavIcon } from "../ui/NavIcon";

export function WorkspaceTabs({ tabs, activeId, onSelect, onClose, onNew, canRestore = false, onRestore }: { tabs: WorkspaceSessionTab[]; activeId: string; onSelect: (tab: WorkspaceSessionTab) => void; onClose: (id: string) => void; onNew: () => void; canRestore?: boolean; onRestore?: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const active = tabs.findIndex((tab) => tab.id === activeId);
      if (event.key.toLowerCase() === "t" && event.shiftKey && onRestore) { event.preventDefault(); if (canRestore) onRestore(); }
      else if (event.key.toLowerCase() === "t") { event.preventDefault(); onNew(); }
      else if (event.key.toLowerCase() === "w") { event.preventDefault(); onClose(activeId); }
      else if (event.key === "Tab" && tabs.length > 1) { event.preventDefault(); const step = event.shiftKey ? -1 : 1; onSelect(tabs[(active + step + tabs.length) % tabs.length]); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, canRestore, onClose, onNew, onRestore, onSelect, tabs]);
  return <div className="workspace-tab-strip" role="group" aria-label="Open chats and projects">
    <div className="workspace-tab-list">{tabs.map((tab) => <div className={`workspace-tab${tab.id === activeId ? " is-active" : ""}`} key={tab.id}>
      <button className="workspace-tab-select" type="button" aria-current={tab.id === activeId ? "page" : undefined} title={tab.title} onClick={() => onSelect(tab)}><NavIcon name={tab.projectId ? "project" : "chat"} /><span>{tab.title}</span></button>
      <button className="workspace-tab-close" type="button" aria-label={`Close ${tab.title}`} title="Close tab" onClick={() => onClose(tab.id)}>×</button>
    </div>)}</div>
    {onRestore && <button className="workspace-tab-new" type="button" aria-label="Restore closed tab" title="Restore closed tab (Ctrl+Shift+T)" disabled={!canRestore} onClick={onRestore}>↶</button>}
    <button className="workspace-tab-new" type="button" aria-label="New tab" title="New tab (Ctrl+T)" onClick={onNew}><NavIcon name="plus" /></button>
  </div>;
}
