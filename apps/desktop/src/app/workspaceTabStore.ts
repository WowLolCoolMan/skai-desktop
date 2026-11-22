export type WorkspaceSessionTab = {
  id: string;
  title: string;
  route: "chat" | "coding";
  conversationId: string | null;
  projectId: string | null;
};

const WORKSPACE_TABS_KEY = "skai.workspace.tabs.v1";
const ACTIVE_WORKSPACE_TAB_KEY = "skai.workspace.activeTab.v1";
const CLOSED_WORKSPACE_TABS_KEY = "skai.workspace.closedTabs.v1";
const MAX_OPEN_WORKSPACE_TABS = 16;
const MAX_CLOSED_WORKSPACE_TABS = 10;
const DEFAULT_TAB: WorkspaceSessionTab = { id: "workspace-home", title: "New chat", route: "chat", conversationId: null, projectId: null };

function isWorkspaceSessionTab(value: unknown): value is WorkspaceSessionTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<WorkspaceSessionTab>;
  return typeof tab.id === "string"
    && typeof tab.title === "string"
    && (tab.route === "chat" || tab.route === "coding")
    && (tab.conversationId === null || typeof tab.conversationId === "string")
    && (tab.projectId === null || typeof tab.projectId === "string");
}

export function readWorkspaceTabs(): WorkspaceSessionTab[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(WORKSPACE_TABS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [DEFAULT_TAB];
    const tabs = stored.filter(isWorkspaceSessionTab).slice(0, MAX_OPEN_WORKSPACE_TABS);
    return tabs.length ? tabs : [DEFAULT_TAB];
  } catch { return [DEFAULT_TAB]; }
}

export function readClosedWorkspaceTabs(): WorkspaceSessionTab[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CLOSED_WORKSPACE_TABS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isWorkspaceSessionTab).slice(0, MAX_CLOSED_WORKSPACE_TABS) : [];
  } catch { return []; }
}

export function readActiveWorkspaceTabId() {
  return localStorage.getItem(ACTIVE_WORKSPACE_TAB_KEY) ?? readWorkspaceTabs()[0].id;
}

export function hasStoredWorkspaceTabs() {
  return localStorage.getItem(WORKSPACE_TABS_KEY) !== null;
}

export function createWorkspaceTabId() {
  return globalThis.crypto?.randomUUID?.() ?? `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveWorkspaceTabs(tabs: WorkspaceSessionTab[], activeId: string) {
  localStorage.setItem(WORKSPACE_TABS_KEY, JSON.stringify(tabs));
  localStorage.setItem(ACTIVE_WORKSPACE_TAB_KEY, activeId);
}

export function saveClosedWorkspaceTabs(tabs: WorkspaceSessionTab[]) {
  localStorage.setItem(CLOSED_WORKSPACE_TABS_KEY, JSON.stringify(tabs));
}
