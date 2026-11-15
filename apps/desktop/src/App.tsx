import type { CSSProperties } from "react";
import { AppRouteView } from "./app/AppRouteView";
import { useDesktopWorkspace } from "./app/useDesktopWorkspace";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { CommandPalette } from "./components/overlays/CommandPalette";
import { CloseChoiceDialog } from "./components/overlays/CloseChoiceDialog";
import { GlobalRail } from "./components/layout/GlobalRail";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UpdateNotice } from "./components/overlays/UpdateNotice";

export default function App() {
  const workspace = useDesktopWorkspace();
  const shellStyle = { "--skai-sidebar-width": `${workspace.sidebarWidth}px` } as CSSProperties;
  return <ErrorBoundary><div className={`app-shell ${workspace.sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={shellStyle}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <GlobalRail route={workspace.route} onNavigate={workspace.onNavigate} onOpenLauncher={workspace.openCommandPalette} />
      <Sidebar className="thread-sidebar" route={workspace.route} onNavigate={workspace.onNavigate} conversations={workspace.conversations} projects={workspace.routeState.projects} query={workspace.conversationQuery} collapsed={workspace.sidebarCollapsed} sidebarWidth={workspace.sidebarWidth} onSidebarWidthChange={workspace.resizeSidebar} onQueryChange={workspace.setConversationQuery} onToggleCollapsed={workspace.toggleSidebar} onNewChat={workspace.startNewChat} onOpenProject={workspace.routeActions.onOpenProject} onSelectConversation={workspace.selectConversation} onConversationMetadata={workspace.updateConversationMetadata} />
    <main className="app-main">
      <Toolbar route={workspace.route} connection={workspace.connection} canGoBack={workspace.canGoBack} canGoForward={workspace.canGoForward} onBack={workspace.goBack} onForward={workspace.goForward} onSettings={() => workspace.onNavigate("settings")} onRetryConnection={workspace.retryConnection} />
      <div id="main-content" tabIndex={-1} className={`app-content ${workspace.route === "chat" ? "app-content-chat" : ""} ${workspace.route === "coding" ? "app-content-coding" : ""} ${workspace.route === "settings" ? "app-content-settings" : ""} ${workspace.route === "images" ? "app-content-images" : ""} ${workspace.route === "marketplace" ? "app-content-marketplace" : ""} ${workspace.route === "plugins" ? "app-content-plugins" : ""} ${workspace.route === "workbench" ? "app-content-workbench" : ""} ${workspace.route === "terminal" ? "app-content-terminal" : ""}`}><AppRouteView state={workspace.routeState} actions={workspace.routeActions} />{workspace.error && <div className="global-error" role="alert"><span>{workspace.error}</span><button type="button" onClick={workspace.dismissError} aria-label="Dismiss notification">Dismiss</button></div>}{workspace.health && <span className="sr-only">{workspace.health.service} protocol {workspace.health.protocolVersion}</span>}</div>
    </main>
    <CommandPalette open={workspace.commandOpen} onClose={workspace.closeCommandPalette} onNavigate={workspace.onNavigate} />
    <CloseChoiceDialog />
    <UpdateNotice />
  </div></ErrorBoundary>;
}
