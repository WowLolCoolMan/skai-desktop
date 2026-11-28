import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AppRouteView } from "./app/AppRouteView";
import { useDesktopWorkspace } from "./app/useDesktopWorkspace";
import { Sidebar } from "./components/layout/Sidebar";
import { GlobalRail } from "./components/layout/GlobalRail";
import { WorkspaceTabs } from "./components/layout/WorkspaceTabs";
import { Toolbar, type WorkspaceLayoutPreset } from "./components/layout/Toolbar";
import { CommandPalette } from "./components/overlays/CommandPalette";
import { CloseChoiceDialog } from "./components/overlays/CloseChoiceDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateNotice } from "./components/overlays/UpdateNotice";
import { NavIcon } from "./components/ui/NavIcon";
import { AchievementToast } from "./components/overlays/AchievementToast";
import type { DesktopTask } from "../shared/contracts";
import { TaskNotificationMonitor } from "./features/tasks/TaskNotifications";

export default function App() {
  const workspace = useDesktopWorkspace();
  const openTaskFromNotification = useCallback((task: DesktopTask) => {
    if (task.conversationId) {
      workspace.routeActions.onSelectConversation(task.conversationId);
      workspace.onNavigate("chat");
      return;
    }
    if (task.projectId) {
      const project = workspace.routeState.projects.find((entry) => entry.id === task.projectId);
      if (project) {
        workspace.routeActions.onOpenProject(project);
        workspace.onNavigate("coding");
        return;
      }
    }
    workspace.onNavigate("usage");
  }, [workspace.onNavigate, workspace.routeActions.onOpenProject, workspace.routeActions.onSelectConversation, workspace.routeState.projects]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(() => localStorage.getItem("skai.sidebar.collapsed") !== "true");
  const [compactViewport, setCompactViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setCompactViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { localStorage.setItem("skai.sidebar.collapsed", String(!desktopSidebarOpen)); }, [desktopSidebarOpen]);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileSidebarOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileSidebarOpen]);
  const shellStyle = { "--skai-sidebar-width": `${workspace.sidebarWidth}px` } as CSSProperties;
  const mainContentRoute = workspace.route === "settings" ? workspace.settingsReturnRoute : workspace.routeState.route;
  const workspaceTabsVisible = workspace.route === "chat" || workspace.route === "coding";
  const codingSplitOpen = workspaceTabsVisible && workspace.route === "coding" && Boolean(workspace.routeState.selectedProject);
  const workspaceTabItems = workspace.route === "coding" && workspace.routeState.selectedProject
    ? workspace.workspaceTabs.filter((tab) => tab.projectId === workspace.routeState.selectedProject?.id)
    : workspace.workspaceTabs;
  const contextualTabAction = workspace.route === "coding" && workspace.routeState.selectedProject ? workspace.openSideChat : workspace.openNewWorkspaceTab;
  const contextualTabLabel = workspace.route === "coding" && workspace.routeState.selectedProject ? "New side chat" : "New tab";
  const applyLayoutPreset = useCallback((preset: WorkspaceLayoutPreset) => {
    const layouts: Record<WorkspaceLayoutPreset, { route: Parameters<typeof workspace.onNavigate>[0]; sidebarOpen: boolean; sidebarWidth: number }> = {
      chat: { route: "chat", sidebarOpen: false, sidebarWidth: 276 },
      coding: { route: "coding", sidebarOpen: true, sidebarWidth: 300 },
      review: { route: "coding", sidebarOpen: true, sidebarWidth: 276 },
      research: { route: "memory", sidebarOpen: true, sidebarWidth: 288 },
      media: { route: "images", sidebarOpen: false, sidebarWidth: 276 },
    };
    const layout = layouts[preset];
    workspace.resizeSidebar(layout.sidebarWidth);
    setDesktopSidebarOpen(layout.sidebarOpen);
    setMobileSidebarOpen(false);
    workspace.onNavigate(layout.route);
  }, [workspace.onNavigate, workspace.resizeSidebar]);
  useEffect(() => {
    const toggleWithShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (compactViewport) setMobileSidebarOpen((open) => !open);
      else setDesktopSidebarOpen((open) => !open);
    };
    window.addEventListener("keydown", toggleWithShortcut);
    return () => window.removeEventListener("keydown", toggleWithShortcut);
  }, [compactViewport]);
  useEffect(() => {
    const applyWithShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.altKey || !["1", "2", "3", "4", "5"].includes(event.key)) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      applyLayoutPreset(({ "1": "chat", "2": "coding", "3": "review", "4": "research", "5": "media" } as const)[event.key as "1" | "2" | "3" | "4" | "5"]);
    };
    window.addEventListener("keydown", applyWithShortcut);
    return () => window.removeEventListener("keydown", applyWithShortcut);
  }, [applyLayoutPreset]);
  const isSidebarOpen = compactViewport ? mobileSidebarOpen : desktopSidebarOpen;
  return <ErrorBoundary><div className={`app-shell ${workspaceTabsVisible && workspace.workspaceTabs.length ? "has-workspace-tabs" : ""} ${mobileSidebarOpen ? "mobile-sidebar-open" : ""} ${desktopSidebarOpen ? "" : "workspace-sidebar-collapsed"}`} style={shellStyle}>
    <TaskNotificationMonitor tasks={workspace.routeState.tasks} scheduledTasks={workspace.routeState.scheduledTasks} loading={workspace.routeState.tasksLoading} onOpenTask={openTaskFromNotification} />
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Toolbar route={workspace.route} contextDetail={workspace.route === "coding" ? workspace.routeState.selectedProject?.name : workspace.route === "chat" ? workspace.routeState.conversationTitle : undefined} modeLabel={workspace.route === "coding" ? "Agent" : workspace.route === "chat" ? (workspace.agentMode === "Coding Agent" ? "Coding" : "Chat") : undefined} connection={workspace.connection} canGoBack={workspace.canGoBack} canGoForward={workspace.canGoForward} onBack={workspace.goBack} onForward={workspace.goForward} onRetryConnection={workspace.retryConnection} onNavigate={workspace.onNavigate} onNewChat={workspace.startNewChat} onOpenCommandPalette={workspace.openCommandPalette} onApplyLayoutPreset={applyLayoutPreset} onToggleSidebar={() => { if (compactViewport) setMobileSidebarOpen((open) => !open); else setDesktopSidebarOpen((open) => !open); }} sidebarOpen={isSidebarOpen} windowsTitleBarOverlay={window.skaiAgent?.window?.platform === "win32"} />
    <GlobalRail route={workspace.route} tasks={workspace.routeState.tasks} onNavigate={workspace.onNavigate} />
    {mobileSidebarOpen && <button className="mobile-sidebar-backdrop" type="button" aria-label="Close workspace navigation" onClick={() => setMobileSidebarOpen(false)} />}
    <Sidebar className={`workspace-sidebar ${mobileSidebarOpen ? "is-mobile-open" : ""}`} route={workspace.route} activeConversationId={workspace.routeState.conversationId} activeProjectId={workspace.route === "coding" ? workspace.routeState.selectedProject?.id ?? localStorage.getItem("skai.selectedProject") : null} activeCodingThreadTitle={workspace.route === "coding" && workspace.routeState.conversationTitle !== "New chat" ? workspace.routeState.conversationTitle : "New coding thread"} agentMode={workspace.agentMode} onAgentModeChange={workspace.setAgentMode} onNavigate={(route) => { workspace.onNavigate(route); setMobileSidebarOpen(false); }} conversations={workspace.conversations} projects={workspace.routeState.projects} query={workspace.conversationQuery} sidebarWidth={workspace.sidebarWidth} onSidebarWidthChange={workspace.resizeSidebar} onQueryChange={workspace.setConversationQuery} onNewChat={() => { workspace.startNewChat(); setMobileSidebarOpen(false); }} onNewProjectThread={(project) => { workspace.openNewProjectThread(project); setMobileSidebarOpen(false); }} onOpenProject={(project) => { workspace.routeActions.onOpenProject(project); setMobileSidebarOpen(false); }} onSelectConversation={(id) => { workspace.selectConversation(id); setMobileSidebarOpen(false); }} onConversationMetadata={workspace.updateConversationMetadata} />
    {workspaceTabsVisible && <div className={`workspace-tabs-hotkeys${codingSplitOpen ? " is-coding-split" : ""}`}><WorkspaceTabs tabs={workspaceTabItems} tasks={workspace.routeState.tasks} activeId={workspace.activeWorkspaceTabId} onSelect={workspace.selectWorkspaceTab} onClose={workspace.closeWorkspaceTab} onCloseMany={workspace.closeWorkspaceTabs} onReorder={workspace.reorderWorkspaceTab} onNew={contextualTabAction} newActionLabel={contextualTabLabel} canRestore={workspace.canRestoreWorkspaceTab} onRestore={workspace.restoreWorkspaceTab} />{codingSplitOpen && <div id="coding-secondary-tab-group" className="coding-secondary-tab-group" />}</div>}
    <main className="app-main">
      <div className="backdrop-effects" aria-hidden="true" />
      <div id="main-content" tabIndex={0} className={`app-content ${workspace.route === "settings" ? "is-settings-underlay" : ""} ${mainContentRoute === "chat" ? "app-content-chat" : ""} ${mainContentRoute === "compare" ? "app-content-compare" : ""} ${["coding", "projects"].includes(mainContentRoute) ? "app-content-coding" : ""} ${mainContentRoute === "images" ? "app-content-images" : ""} ${mainContentRoute === "marketplace" ? "app-content-marketplace" : ""} ${mainContentRoute === "plugins" ? "app-content-plugins" : ""} ${mainContentRoute === "terminal" ? "app-content-terminal" : ""} ${mainContentRoute === "scheduled" ? "app-content-scheduled" : ""}`}><AppRouteView state={{ ...workspace.routeState, connection: workspace.connection, health: workspace.health, route: mainContentRoute }} actions={workspace.routeActions} />{workspace.error && <div className="global-error" role="alert"><span>{workspace.error}</span><button type="button" onClick={workspace.dismissError} aria-label="Dismiss notification">Dismiss</button></div>}{workspace.health && <span className="sr-only">{workspace.health.service} protocol {workspace.health.protocolVersion}</span>}</div>
      {workspace.route === "settings" && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) workspace.onNavigate(workspace.settingsReturnRoute); }}><section className="settings-overlay-panel" role="dialog" aria-modal="true" aria-label="Settings"><header className="settings-overlay-header"><div className="settings-overlay-title"><span className="settings-overlay-icon"><NavIcon name="settings" /></span><span><strong>Settings</strong><small>Personalize your Skai workspace</small></span></div><button type="button" aria-label="Close settings" onClick={() => workspace.onNavigate(workspace.settingsReturnRoute)}><NavIcon name="close" /></button></header><AppRouteView state={{ ...workspace.routeState, connection: workspace.connection, health: workspace.health, route: "settings" }} actions={workspace.routeActions} /></section></div>}
    </main>
    <CommandPalette open={workspace.commandOpen} onClose={workspace.closeCommandPalette} onNavigate={workspace.onNavigate} route={workspace.route} projects={workspace.routeState.projects} tasks={workspace.routeState.tasks} onOpenProject={workspace.routeActions.onOpenProject} onOpenTask={openTaskFromNotification} onNewChat={workspace.startNewChat} onApplyLayoutPreset={applyLayoutPreset} />
    <CloseChoiceDialog />
    <UpdateNotice />
    <AchievementToast />
  </div></ErrorBoundary>;
}
