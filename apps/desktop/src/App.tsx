import type { CSSProperties } from "react";
import { AppRouteView } from "./app/AppRouteView";
import { useDesktopWorkspace } from "./app/useDesktopWorkspace";
import { Sidebar } from "./components/layout/Sidebar";
import { GlobalRail } from "./components/layout/GlobalRail";
import { WorkspaceTabs } from "./components/layout/WorkspaceTabs";
import { Toolbar } from "./components/layout/Toolbar";
import { CommandPalette } from "./components/overlays/CommandPalette";
import { CloseChoiceDialog } from "./components/overlays/CloseChoiceDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateNotice } from "./components/overlays/UpdateNotice";
import { NavIcon } from "./components/ui/NavIcon";
import { AchievementToast } from "./components/overlays/AchievementToast";

export default function App() {
  const workspace = useDesktopWorkspace();
  const shellStyle = { "--skai-sidebar-width": `${workspace.sidebarWidth}px` } as CSSProperties;
  const mainContentRoute = workspace.route === "settings" ? workspace.settingsReturnRoute : workspace.routeState.route;
  const hideThreadSidebar = workspace.route !== "chat" && workspace.route !== "coding";
  return <ErrorBoundary><div className={`app-shell ${hideThreadSidebar ? "thread-sidebar-hidden" : ""}`} style={shellStyle}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Toolbar connection={workspace.connection} canGoBack={workspace.canGoBack} canGoForward={workspace.canGoForward} onBack={workspace.goBack} onForward={workspace.goForward} onRetryConnection={workspace.retryConnection} onNavigate={workspace.onNavigate} onNewChat={workspace.startNewChat} windowsTitleBarOverlay={window.skaiAgent?.window?.platform === "win32"} />
    <GlobalRail route={workspace.route} onNavigate={workspace.onNavigate} />
    {!hideThreadSidebar && <Sidebar className="thread-sidebar" route={workspace.route} activeConversationId={workspace.routeState.conversationId} agentMode={workspace.agentMode} onAgentModeChange={workspace.setAgentMode} onNavigate={workspace.onNavigate} conversations={workspace.conversations} projects={workspace.routeState.projects} query={workspace.conversationQuery} sidebarWidth={workspace.sidebarWidth} onSidebarWidthChange={workspace.resizeSidebar} onQueryChange={workspace.setConversationQuery} onNewChat={workspace.startNewChat} onOpenProject={workspace.routeActions.onOpenProject} onSelectConversation={workspace.selectConversation} onConversationMetadata={workspace.updateConversationMetadata} />}
    <div className="workspace-tabs-hotkeys" aria-hidden="true"><WorkspaceTabs tabs={workspace.workspaceTabs} tasks={workspace.routeState.tasks} activeId={workspace.activeWorkspaceTabId} onSelect={workspace.selectWorkspaceTab} onClose={workspace.closeWorkspaceTab} onNew={workspace.openNewWorkspaceTab} canRestore={workspace.canRestoreWorkspaceTab} onRestore={workspace.restoreWorkspaceTab} /></div>
    <main className="app-main">
      <div className="backdrop-effects" aria-hidden="true" />
      <div id="main-content" tabIndex={0} className={`app-content ${workspace.route === "settings" ? "is-settings-underlay" : ""} ${mainContentRoute === "chat" ? "app-content-chat" : ""} ${mainContentRoute === "compare" ? "app-content-compare" : ""} ${["coding", "projects"].includes(mainContentRoute) ? "app-content-coding" : ""} ${mainContentRoute === "images" ? "app-content-images" : ""} ${mainContentRoute === "marketplace" ? "app-content-marketplace" : ""} ${mainContentRoute === "plugins" ? "app-content-plugins" : ""} ${mainContentRoute === "terminal" ? "app-content-terminal" : ""}`}><AppRouteView state={{ ...workspace.routeState, route: mainContentRoute }} actions={workspace.routeActions} />{workspace.error && <div className="global-error" role="alert"><span>{workspace.error}</span><button type="button" onClick={workspace.dismissError} aria-label="Dismiss notification">Dismiss</button></div>}{workspace.health && <span className="sr-only">{workspace.health.service} protocol {workspace.health.protocolVersion}</span>}</div>
    </main>
    {workspace.route === "settings" && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) workspace.onNavigate(workspace.settingsReturnRoute); }}><section className="settings-overlay-panel" role="dialog" aria-modal="true" aria-label="Settings"><header className="settings-overlay-header"><div className="settings-overlay-title"><span className="settings-overlay-icon"><NavIcon name="settings" /></span><span><strong>Settings</strong><small>Personalize your Skai workspace</small></span></div><button type="button" aria-label="Close settings" onClick={() => workspace.onNavigate(workspace.settingsReturnRoute)}><NavIcon name="close" /></button></header><AppRouteView state={{ ...workspace.routeState, route: "settings" }} actions={workspace.routeActions} /></section></div>}
    <CommandPalette open={workspace.commandOpen} onClose={workspace.closeCommandPalette} onNavigate={workspace.onNavigate} />
    <CloseChoiceDialog />
    <UpdateNotice />
    <AchievementToast />
  </div></ErrorBoundary>;
}
