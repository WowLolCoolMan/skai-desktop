import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentResponse, DesktopConversation, DesktopScheduledTask, DesktopTask, LocalCapacitySnapshot, RuntimeHealth, ScheduledTaskDraft, TaskEnvironment } from "../../shared/contracts";
import { PRODUCT_DISPLAY_NAME } from "../../shared/productIdentity";
import type { AppRouteActions, AppRouteState } from "./AppRouteView";
import { initializeNavigation, navigate, readNavigationState, routeFromLocation, type NavigationState } from "./navigation";
import type { ConnectionState, CorpusDocument, MemoryEntry, Model, Route, ThemeMode } from "./types";
import { createAgentClient } from "../services/agentClient";
import { isLocalEndpoint, LOCAL_ENDPOINT_ERROR, localEndpointOrFallback, localProviderOrFallback } from "../services/localOnly";
import { useChatWorkspace } from "../features/chat/useChatWorkspace";
import { removeChatDraft } from "../features/chat/chatDraftStore";
import { useCodingWorkspace } from "../features/coding/useCodingWorkspace";
import { loadImageHistory, saveImageHistory, type ImageHistoryEntry } from "../features/catalog/imageHistory";
import { useNativeThemeSync } from "../theme/useNativeThemeSync";

export type DesktopWorkspace = {
  routeState: AppRouteState;
  routeActions: AppRouteActions;
  route: Route;
  settingsReturnRoute: Route;
  workspaceTabs: WorkspaceSessionTab[];
  canRestoreWorkspaceTab: boolean;
  activeWorkspaceTabId: string;
  openNewWorkspaceTab: () => void;
  selectWorkspaceTab: (tab: WorkspaceSessionTab) => void;
  closeWorkspaceTab: (tabId: string) => void;
  restoreWorkspaceTab: () => void;
  connection: ConnectionState;
  health: RuntimeHealth | null;
  error: string | null;
  dismissError: () => void;
  retryConnection: () => void;
  conversations: DesktopConversation[];
  agentMode: "ChatBot" | "Coding Agent";
  setAgentMode: (mode: "ChatBot" | "Coding Agent") => void;
  conversationQuery: string;
  setConversationQuery: (query: string) => void;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  resizeSidebar: (width: number) => void;
  commandOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  startNewChat: () => void;
  selectConversation: (id: string) => void;
  updateConversationMetadata: (id: string, patch: { pinned?: boolean; archived?: boolean; title?: string }) => Promise<boolean>;
  onNavigate: (route: Route) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  petVisible: boolean;
  petWander: boolean;
  petInteractionDemo: boolean;
  setPetVisible: (value: boolean) => void;
  setPetWander: (value: boolean) => void;
};

export type WorkspaceSessionTab = { id: string; title: string; route: "chat" | "coding"; conversationId: string | null; projectId: string | null };

const defaultEndpoint = localEndpointOrFallback(localStorage.getItem("skai.endpoint"), "http://localhost:11434/v1");
const defaultModel = localStorage.getItem("skai.model") ?? "llama3.2";
const defaultProvider = localProviderOrFallback(localStorage.getItem("skai.provider"));
const SIDEBAR_WIDTH_KEY = "skai.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 276;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 360;
const WORKSPACE_TABS_KEY = "skai.workspace.tabs.v1";
const ACTIVE_WORKSPACE_TAB_KEY = "skai.workspace.activeTab.v1";
const CLOSED_WORKSPACE_TABS_KEY = "skai.workspace.closedTabs.v1";

function readWorkspaceTabs(): WorkspaceSessionTab[] {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_TABS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [{ id: "workspace-home", title: "New chat", route: "chat", conversationId: null, projectId: null }];
    const tabs = stored.filter((item): item is WorkspaceSessionTab => item && typeof item.id === "string" && typeof item.title === "string" && (item.route === "chat" || item.route === "coding") && (item.conversationId === null || typeof item.conversationId === "string") && (item.projectId === null || typeof item.projectId === "string")).slice(0, 16);
    return tabs.length ? tabs : [{ id: "workspace-home", title: "New chat", route: "chat", conversationId: null, projectId: null }];
  } catch { return [{ id: "workspace-home", title: "New chat", route: "chat", conversationId: null, projectId: null }]; }
}

function readClosedWorkspaceTabs(): WorkspaceSessionTab[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CLOSED_WORKSPACE_TABS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is WorkspaceSessionTab => item && typeof item.id === "string" && typeof item.title === "string" && (item.route === "chat" || item.route === "coding") && (item.conversationId === null || typeof item.conversationId === "string") && (item.projectId === null || typeof item.projectId === "string")).slice(0, 10) : [];
  } catch { return []; }
}

function newTabId() { return globalThis.crypto?.randomUUID?.() ?? `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function readAgentMode(): "ChatBot" | "Coding Agent" {
  return localStorage.getItem("skai.agentMode") === "Coding Agent" ? "Coding Agent" : "ChatBot";
}

function readSidebarWidth() {
  const storedValue = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!storedValue) return DEFAULT_SIDEBAR_WIDTH;
  const stored = Number(storedValue);
  return Number.isFinite(stored) ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored)) : DEFAULT_SIDEBAR_WIDTH;
}

function readThemeMode(): ThemeMode {
  const stored = localStorage.getItem("skai.themeMode");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}

function readStoredBoolean(key: string, fallback: boolean) {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

export function useDesktopWorkspace(): DesktopWorkspace {
  const agent = useMemo(() => createAgentClient((method, params) => {
    const bridge = window.skaiAgent;
    if (!bridge) return Promise.resolve({ v: 1, id: `bridge-unavailable-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
    return bridge.request(method, params);
  }), []);
  const request = agent.request;
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [settingsReturnRoute, setSettingsReturnRoute] = useState<Route>(() => routeFromLocation() === "settings" ? "chat" : routeFromLocation());
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readWorkspaceTabs);
  const [hasStoredWorkspaceTabs] = useState(() => localStorage.getItem(WORKSPACE_TABS_KEY) !== null);
  const [workspaceSessionRestored, setWorkspaceSessionRestored] = useState(false);
  const [closedWorkspaceTabs, setClosedWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readClosedWorkspaceTabs);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(() => localStorage.getItem(ACTIVE_WORKSPACE_TAB_KEY) ?? readWorkspaceTabs()[0].id);
  const workspaceSessionRestoreStartedRef = useRef(false);
  const [navigation, setNavigation] = useState<NavigationState>(() => readNavigationState(routeFromLocation()));
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem("skai.sidebar.collapsed") === "true");
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [conversationQuery, setConversationQuery] = useState("");
  const [agentMode, setAgentModeState] = useState(readAgentMode);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [capacity, setCapacity] = useState<LocalCapacitySnapshot | null>(null);
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [model, setModel] = useState(defaultModel);
  const [provider, setProvider] = useState(defaultProvider);
  const [ollamaContextWindowTokens, setOllamaContextWindowTokens] = useState(0);
  const [localRamBudgetBytes, setLocalRamBudgetBytes] = useState(0);
  const [localGpuBudgetBytes, setLocalGpuBudgetBytes] = useState(0);
  const [models, setModels] = useState<Model[]>([]);
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<DesktopScheduledTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [corpusDocuments, setCorpusDocuments] = useState<CorpusDocument[]>([]);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("skai.accentColor") ?? "cyan");
  const [density, setDensity] = useState(() => localStorage.getItem("skai.density") ?? "comfortable");
  const [backdrop, setBackdrop] = useState(() => localStorage.getItem("skai.backdrop") ?? "none");
  const [reduceMotion, setReduceMotion] = useState(() => readStoredBoolean("skai.reduceMotion", false));
  const [petVisible, setPetVisible] = useState(localStorage.getItem("skai.pet.visible") !== "false");
  const [petWander, setPetWander] = useState(localStorage.getItem("skai.pet.wander") !== "false");
  const [petInteractionDemo, setPetInteractionDemo] = useState(localStorage.getItem("skai.pet.interactionDemo") === "true");
  const [petCharacter, setPetCharacter] = useState(() => { const saved = localStorage.getItem("skai.pet.character"); return saved && (["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"].includes(saved) || saved.startsWith("custom:")) ? saved : "percy"; });
  const [petSpriteDataUrl, setPetSpriteDataUrl] = useState(() => localStorage.getItem("skai.pet.sprite") ?? "");
  const [developerMode, setDeveloperMode] = useState(false);
  const [memoryInjectionEnabled, setMemoryInjectionEnabled] = useState(false);
  const [smartPromptRewritingEnabled, setSmartPromptRewritingEnabled] = useState(() => readStoredBoolean("skai.smartPromptRewriting", false));
  const [imageEndpoint, setImageEndpoint] = useState(localEndpointOrFallback(localStorage.getItem("skai.imageEndpoint"), "http://127.0.0.1:8188"));
  const [imageProvider, setImageProvider] = useState(() => localStorage.getItem("skai.imageProvider") === "comfyui" ? "comfyui" : "diffusers");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageWorkflow, setImageWorkflow] = useState(localStorage.getItem("skai.imageWorkflow") ?? "");
  const [imageBusy, setImageBusy] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<ImageHistoryEntry[]>([]);
  const dismissError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (connection !== "ready") return;
    let active = true;
    const refresh = () => { void request("system.capacity").then((response) => { if (active && response.ok) setCapacity(response.result as LocalCapacitySnapshot); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connection, request]);

  useEffect(() => {
    let active = true;
    void loadImageHistory().then((images) => {
      if (active) setGeneratedImages(images);
    });
    return () => { active = false; };
  }, []);

  const onNavigate = useCallback((nextRoute: Route) => {
    setError(null);
    if (nextRoute === "workbench") nextRoute = route === "coding" ? "coding" : "chat";
    if (nextRoute === "settings" && route !== "settings") setSettingsReturnRoute(route);
    navigate(nextRoute);
  }, [route]);
  const goBack = useCallback(() => { if (navigation.index > 0) window.history.back(); }, [navigation.index]);
  const goForward = useCallback(() => { if (navigation.index < navigation.length - 1) window.history.forward(); }, [navigation.index, navigation.length]);
  const coding = useCodingWorkspace({ request, connection, onError: setError, onNavigate });
  const chat = useChatWorkspace({ request, connection, provider, endpoint, model, mode: agentMode, project: route === "coding" ? coding.selectedProject : null, onError: setError });
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), []);
  const resizeSidebar = useCallback((width: number) => setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))), []);
  const setAgentMode = useCallback((mode: "ChatBot" | "Coding Agent") => {
    if (mode === agentMode) return;
    setAgentModeState(mode);
    localStorage.setItem("skai.agentMode", mode);
    const matchingConversation = chat.conversations.find((conversation) => (conversation.mode ?? "ChatBot") === mode);
    if (matchingConversation) chat.selectConversation(matchingConversation.id);
    else { chat.startNewChat(); chat.setResponseMode(mode === "Coding Agent" ? "coding" : "think"); }
    onNavigate("chat");
  }, [agentMode, chat, onNavigate]);
  const selectConversation = useCallback((id: string) => {
    const conversation = chat.conversations.find((item) => item.id === id);
    let destination: Route = "chat";
    if (conversation) {
      const mode = conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot";
      setAgentModeState(mode);
      localStorage.setItem("skai.agentMode", mode);
      const project = conversation.projectId ? coding.projects.find((item) => item.id === conversation.projectId) : null;
      if (project) { destination = "coding"; void coding.selectProject(project); }
      const existing = workspaceTabs.find((tab) => tab.conversationId === id);
      if (existing) setActiveWorkspaceTabId(existing.id);
      else {
        const tab: WorkspaceSessionTab = { id: newTabId(), title: conversation.title, route: destination, conversationId: id, projectId: project?.id ?? null };
        setWorkspaceTabs((current) => [...current, tab].slice(-16));
        setActiveWorkspaceTabId(tab.id);
      }
    }
    chat.selectConversation(id);
    onNavigate(destination);
  }, [chat, coding, onNavigate, workspaceTabs]);
  const openNewWorkspaceTab = useCallback(() => {
    const tab: WorkspaceSessionTab = { id: newTabId(), title: agentMode === "Coding Agent" ? "New coding thread" : "New chat", route: "chat", conversationId: null, projectId: null };
    setWorkspaceTabs((current) => [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    chat.startNewChat();
    onNavigate("chat");
  }, [agentMode, chat, onNavigate]);
  const startNewChat = openNewWorkspaceTab;
  const selectWorkspaceTab = useCallback((tab: WorkspaceSessionTab) => {
    setActiveWorkspaceTabId(tab.id);
    if (tab.conversationId) {
      const conversation = chat.conversations.find((item) => item.id === tab.conversationId);
      if (conversation) {
        setAgentModeState(conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot");
        localStorage.setItem("skai.agentMode", conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot");
        chat.selectConversation(tab.conversationId);
      }
    } else chat.startNewChat();
    const project = tab.projectId ? coding.projects.find((item) => item.id === tab.projectId) : null;
    if (project) void coding.selectProject(project);
    onNavigate(tab.route);
  }, [chat, coding, onNavigate]);
  const closeWorkspaceTab = useCallback((tabId: string) => {
    const closingTab = workspaceTabs.find((item) => item.id === tabId);
    if (closingTab) {
      const next = [closingTab, ...closedWorkspaceTabs.filter((item) => item.id !== tabId)];
      for (const evicted of next.slice(10)) void removeChatDraft(evicted.id);
      setClosedWorkspaceTabs(next.slice(0, 10));
    }
    if (workspaceTabs.length <= 1) {
      const replacement: WorkspaceSessionTab = { id: newTabId(), title: "New chat", route: "chat", conversationId: null, projectId: null };
      setWorkspaceTabs([replacement]); setActiveWorkspaceTabId(replacement.id); chat.startNewChat(); onNavigate("chat"); return;
    }
    const index = workspaceTabs.findIndex((item) => item.id === tabId);
    const remaining = workspaceTabs.filter((item) => item.id !== tabId);
    setWorkspaceTabs(remaining);
    if (activeWorkspaceTabId === tabId) selectWorkspaceTab(remaining[Math.min(Math.max(index, 0), remaining.length - 1)]);
  }, [activeWorkspaceTabId, chat, closedWorkspaceTabs, onNavigate, selectWorkspaceTab, workspaceTabs]);
  const restoreWorkspaceTab = useCallback(() => {
    const [tab, ...remainingClosed] = closedWorkspaceTabs;
    if (!tab) return;
    setClosedWorkspaceTabs(remainingClosed);
    setWorkspaceTabs((current) => [...current.filter((item) => item.id !== tab.id), tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    selectWorkspaceTab(tab);
  }, [closedWorkspaceTabs, selectWorkspaceTab]);
  const openProjectTab = useCallback((project: import("../../shared/contracts").DesktopProject) => {
    const existingTab = workspaceTabs.find((tab) => tab.projectId === project.id);
    if (existingTab) { selectWorkspaceTab(existingTab); return; }
    setAgentModeState("Coding Agent");
    localStorage.setItem("skai.agentMode", "Coding Agent");
    const projectThread = chat.conversations.find((conversation) => conversation.projectId === project.id && (conversation.mode ?? "ChatBot") === "Coding Agent");
    if (projectThread) chat.selectConversation(projectThread.id); else chat.startNewChat();
    const tab: WorkspaceSessionTab = { id: newTabId(), title: project.name, route: "coding", conversationId: projectThread?.id ?? null, projectId: project.id };
    setWorkspaceTabs((current) => [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    void coding.selectProject(project);
    onNavigate("coding");
  }, [chat, coding, onNavigate, selectWorkspaceTab, workspaceTabs]);
  useEffect(() => {
    if (workspaceSessionRestored || workspaceSessionRestoreStartedRef.current || connection !== "ready" || !chat.conversationsLoaded || !coding.projectsLoaded) return;
    const activeTab = workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? workspaceTabs[0];
    if (!activeTab) { workspaceSessionRestoreStartedRef.current = true; setWorkspaceSessionRestored(true); return; }
    workspaceSessionRestoreStartedRef.current = true;
    if (activeWorkspaceTabId !== activeTab.id) setActiveWorkspaceTabId(activeTab.id);
    let restoredTab = activeTab;
    if (!hasStoredWorkspaceTabs && activeTab.id === "workspace-home") {
      const legacyConversation = chat.conversations.find((conversation) => conversation.id === chat.conversationId);
      const legacyProject = route === "coding" ? coding.projects.find((project) => project.id === localStorage.getItem("skai.selectedProject")) : undefined;
      restoredTab = {
        ...activeTab,
        title: legacyProject?.name ?? legacyConversation?.title ?? activeTab.title,
        route: legacyProject ? "coding" : "chat",
        conversationId: legacyConversation?.id ?? null,
        projectId: legacyProject?.id ?? null,
      };
      if (restoredTab !== activeTab) setWorkspaceTabs([restoredTab]);
    }
    const conversation = restoredTab.conversationId ? chat.conversations.find((item) => item.id === restoredTab.conversationId) : undefined;
    if (conversation) {
      const mode = conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot";
      setAgentModeState(mode);
      localStorage.setItem("skai.agentMode", mode);
      chat.selectConversation(conversation.id);
    } else {
      chat.startNewChat();
      const codingThread = restoredTab.route === "coding" || restoredTab.title === "New coding thread";
      const mode = codingThread ? "Coding Agent" : "ChatBot";
      setAgentModeState(mode);
      localStorage.setItem("skai.agentMode", mode);
      chat.setResponseMode(codingThread ? "coding" : "think");
    }
    const project = restoredTab.projectId ? coding.projects.find((item) => item.id === restoredTab.projectId) : undefined;
    const shouldNavigateToWorkspace = route === "chat" || route === "coding";
    if (restoredTab.projectId && project) {
      void coding.selectProject(project, shouldNavigateToWorkspace).catch(() => undefined).finally(() => setWorkspaceSessionRestored(true));
      return;
    }
    else if (restoredTab.projectId && !project) {
      setError("The project saved in this workspace tab is no longer available. Reconnect it from Projects.");
      if (shouldNavigateToWorkspace) onNavigate("projects");
    } else if (shouldNavigateToWorkspace) onNavigate(restoredTab.route === "coding" ? "projects" : "chat");
    setWorkspaceSessionRestored(true);
  }, [activeWorkspaceTabId, chat.conversationId, chat.conversations, chat.conversationsLoaded, chat.selectConversation, chat.setResponseMode, chat.startNewChat, coding.projects, coding.projectsLoaded, coding.selectProject, connection, hasStoredWorkspaceTabs, onNavigate, route, workspaceSessionRestored, workspaceTabs]);
  useEffect(() => {
    localStorage.setItem(WORKSPACE_TABS_KEY, JSON.stringify(workspaceTabs));
    localStorage.setItem(ACTIVE_WORKSPACE_TAB_KEY, activeWorkspaceTabId);
  }, [activeWorkspaceTabId, workspaceTabs]);
  useEffect(() => { localStorage.setItem(CLOSED_WORKSPACE_TABS_KEY, JSON.stringify(closedWorkspaceTabs)); }, [closedWorkspaceTabs]);
  useEffect(() => {
    if (!workspaceSessionRestored || (route !== "chat" && route !== "coding")) return;
    setWorkspaceTabs((current) => current.map((tab) => tab.id !== activeWorkspaceTabId ? tab : {
      ...tab,
      route: route === "coding" && coding.selectedProject ? "coding" : "chat",
      conversationId: chat.conversationId,
      projectId: route === "coding" ? coding.selectedProject?.id ?? tab.projectId : null,
      title: route === "coding" && coding.selectedProject ? coding.selectedProject.name : chat.activeConversation?.title ?? (agentMode === "Coding Agent" ? "New coding thread" : "New chat"),
    }));
  }, [activeWorkspaceTabId, agentMode, chat.activeConversation?.title, chat.conversationId, coding.selectedProject?.id, coding.selectedProject?.name, route, workspaceSessionRestored]);
  useEffect(() => {
    const bridge = window.skaiAgent;
    const removeConversation = bridge?.onTrayOpenConversation?.((id) => { selectConversation(id); onNavigate("chat"); });
    const removeNewChat = bridge?.onTrayNewChat?.(() => startNewChat());
    return () => { removeConversation?.(); removeNewChat?.(); };
  }, [onNavigate, selectConversation, startNewChat]);
  useEffect(() => {
    const initialRoute = routeFromLocation();
    setRoute(initialRoute);
    setNavigation(initializeNavigation(initialRoute));
    const onPopState = () => {
      const nextRoute = routeFromLocation();
      setError(null);
      setRoute(nextRoute);
      setNavigation(readNavigationState(nextRoute));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => { window.requestAnimationFrame(() => document.getElementById("main-content")?.focus()); }, [route]);
  useNativeThemeSync(request, themeMode);
  useEffect(() => { document.title = `${PRODUCT_DISPLAY_NAME} · ${route}`; document.documentElement.dataset.theme = themeMode; document.documentElement.dataset.accent = accentColor; document.documentElement.dataset.density = density; document.documentElement.dataset.backdrop = backdrop; document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false"; }, [route, themeMode, accentColor, density, backdrop, reduceMotion]);
  useEffect(() => { localStorage.setItem("skai.sidebar.collapsed", String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem("skai.pet.visible", String(petVisible)); }, [petVisible]);
  useEffect(() => { localStorage.setItem("skai.pet.wander", String(petWander)); }, [petWander]);
  useEffect(() => { localStorage.setItem("skai.pet.interactionDemo", String(petInteractionDemo)); }, [petInteractionDemo]);
  useEffect(() => { localStorage.setItem("skai.pet.character", petCharacter); }, [petCharacter]);
  useEffect(() => { if (petSpriteDataUrl.length <= 7_000_000) localStorage.setItem("skai.pet.sprite", petSpriteDataUrl); }, [petSpriteDataUrl]);
  useEffect(() => {
    const pet = window.skaiAgent?.pet;
    if (!pet) return;
    pet.setVisible(petVisible);
    pet.setMotion({ wander: petWander, reduceMotion, interactionDemo: petInteractionDemo });
    const removeVisibility = pet.onVisibilityChange(setPetVisible);
    return removeVisibility;
  }, [petVisible, petWander, petInteractionDemo, reduceMotion]);
  useEffect(() => { window.skaiAgent?.pet?.setState(taskBusy ? "coding" : chat.busy ? "thinking" : "idle"); }, [taskBusy, chat.busy]);
  useEffect(() => { const onShortcut = (event: KeyboardEvent) => { const modifier = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); if (modifier && key === "k") { event.preventDefault(); openCommandPalette(); return; } if (event.key === "Escape") { closeCommandPalette(); return; } if (!modifier) return; if (key === "n") { event.preventDefault(); startNewChat(); return; } if (key === ",") { event.preventDefault(); onNavigate("settings"); return; } if (key === "b") { event.preventDefault(); toggleSidebar(); return; } if (key === "1") { event.preventDefault(); onNavigate("chat"); return; } if (key === "2") { event.preventDefault(); onNavigate("coding"); return; } if (key === "3" || (event.shiftKey && key === "l")) { event.preventDefault(); onNavigate("terminal"); } }; window.addEventListener("keydown", onShortcut); return () => window.removeEventListener("keydown", onShortcut); }, [closeCommandPalette, openCommandPalette, onNavigate, startNewChat, toggleSidebar]);
  const retryConnection = useCallback(() => { setConnection("checking"); setError(null); void request("runtime.health").then((response: AgentResponse) => { if (!response.ok) { setConnection("error"); setError(response.error?.message ?? "Agent host unavailable."); return; } setHealth(response.result as RuntimeHealth); setConnection("ready"); }).catch((requestError: unknown) => { setConnection("error"); setError(requestError instanceof Error ? requestError.message : "Agent host unavailable."); }); }, [request]);
  useEffect(() => { retryConnection(); }, [retryConnection]);
  useEffect(() => { if (connection !== "ready") return; void request("settings.get").then((settingsResponse) => { if (settingsResponse.ok) { const settings = settingsResponse.result as { endpoint?: string; model?: string; provider?: string; ollamaContextWindowTokens?: number; localRamBudgetBytes?: number; localGpuBudgetBytes?: number; themeMode?: string; accentColor?: string; interfaceDensity?: string; backdropPreset?: string; reduceMotion?: boolean; developerMode?: boolean; memoryInjectionEnabled?: boolean; smartPromptRewritingEnabled?: boolean }; if (settings.endpoint && isLocalEndpoint(settings.endpoint)) setEndpoint(settings.endpoint); else if (settings.endpoint) setError(LOCAL_ENDPOINT_ERROR); if (settings.model) setModel(settings.model); if (settings.provider) setProvider(localProviderOrFallback(settings.provider)); if ([0, 32768, 131072, 1048576].includes(settings.ollamaContextWindowTokens ?? 0)) setOllamaContextWindowTokens(settings.ollamaContextWindowTokens ?? 0); if (Number.isFinite(settings.localRamBudgetBytes) && (settings.localRamBudgetBytes ?? 0) >= 0) setLocalRamBudgetBytes(settings.localRamBudgetBytes ?? 0); if (Number.isFinite(settings.localGpuBudgetBytes) && (settings.localGpuBudgetBytes ?? 0) >= 0) setLocalGpuBudgetBytes(settings.localGpuBudgetBytes ?? 0); if (settings.themeMode === "light" || settings.themeMode === "dark" || settings.themeMode === "system") setThemeMode(settings.themeMode); if (settings.accentColor) setAccentColor(settings.accentColor); if (settings.interfaceDensity) setDensity(settings.interfaceDensity); if (settings.backdropPreset) setBackdrop(settings.backdropPreset); if (typeof settings.reduceMotion === "boolean") setReduceMotion(settings.reduceMotion); if (typeof settings.developerMode === "boolean") setDeveloperMode(settings.developerMode); if (typeof settings.memoryInjectionEnabled === "boolean") setMemoryInjectionEnabled(settings.memoryInjectionEnabled); if (typeof settings.smartPromptRewritingEnabled === "boolean") { setSmartPromptRewritingEnabled(settings.smartPromptRewritingEnabled); localStorage.setItem("skai.smartPromptRewriting", String(settings.smartPromptRewritingEnabled)); } } else setError(settingsResponse.error?.message ?? "Workspace settings could not be loaded."); }).catch(() => setError("Workspace settings could not be loaded.")); }, [connection, request]);
  const loadWorkbench = useCallback(async (showLoading = true) => { if (showLoading) setTasksLoading(true); setTasksError(null); try { const [taskResponse, scheduleResponse] = await Promise.all([request("tasks.list"), request("scheduled.list")]); if (!taskResponse.ok) throw new Error(taskResponse.error?.message ?? "Agent tasks could not be loaded."); if (!scheduleResponse.ok) throw new Error(scheduleResponse.error?.message ?? "Scheduled runs could not be loaded."); setTasks((taskResponse.result as DesktopTask[]) ?? []); setScheduledTasks((scheduleResponse.result as DesktopScheduledTask[]) ?? []); } catch (loadError) { setTasksError(loadError instanceof Error ? loadError.message : "Agent workbench could not be loaded."); } finally { if (showLoading) setTasksLoading(false); } }, [request]);
  useEffect(() => { if (connection !== "ready") return; void loadWorkbench(); }, [connection, loadWorkbench]);
  useEffect(() => {
    if (connection !== "ready") return;
    const refresh = () => { void request("tasks.list").then((response) => { if (response.ok) setTasks((response.result as DesktopTask[]) ?? []); }); };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => window.clearInterval(interval);
  }, [connection, request]);
  useEffect(() => { if (connection !== "ready" || route !== "memory") return; setMemoryLoading(true); setCorpusLoading(true); setMemoryError(null); setCorpusError(null); void Promise.all([request("memory.list"), request("corpus.list")]).then(([memoryResponse, corpusResponse]) => { if (!memoryResponse.ok) setMemoryError(memoryResponse.error?.message ?? "Memory could not be loaded."); else setMemoryEntries((memoryResponse.result as MemoryEntry[]) ?? []); if (!corpusResponse.ok) setCorpusError(corpusResponse.error?.message ?? "Document corpus could not be loaded."); else setCorpusDocuments((corpusResponse.result as CorpusDocument[]) ?? []); }).catch(() => { setMemoryError("Memory could not be loaded."); setCorpusError("Document corpus could not be loaded."); }).finally(() => { setMemoryLoading(false); setCorpusLoading(false); }); }, [connection, route, request]);

  const transitionTask = async (id: string, operation: "queue" | "approve" | "deny" | "cancel" | "retry") => { setTaskBusy(id); const response = await request(`tasks.${operation}`, { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Task could not be updated."); return; } await loadWorkbench(); };
  const executeTask = async (id: string) => { setTaskBusy(id); const response = await request("tasks.execute", { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "The local task could not be started."); return; } setError(null); await loadWorkbench(); };
  const scheduleTask = async (draft: ScheduledTaskDraft) => { setTaskBusy("schedule"); const response = await request("scheduled.create", draft as unknown as Record<string, unknown>); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Scheduled task could not be created."); return false; } await loadWorkbench(); setError(null); return true; };
  const transitionScheduledTask = async (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => { setTaskBusy(id); const response = await request(`scheduled.${operation}`, { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Scheduled task could not be updated."); return false; } await loadWorkbench(); return true; };
  const planTask = async (title: string, instruction: string, environment: TaskEnvironment) => { setTaskBusy("planning"); const response = await request("tasks.plan", { title, instruction, environment }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Task could not be planned."); return false; } setError(null); await loadWorkbench(false); return true; };
  const loadMemory = async (query?: string) => { setMemoryLoading(true); setMemoryError(null); try { const response = await request(query?.trim() ? "memory.search" : "memory.list", query?.trim() ? { query: query.trim() } : undefined); if (!response.ok) throw new Error(response.error?.message ?? "Memory could not be loaded."); setMemoryEntries((response.result as MemoryEntry[]) ?? []); } catch (loadError) { setMemoryError(loadError instanceof Error ? loadError.message : "Memory could not be loaded."); } finally { setMemoryLoading(false); } };
  const saveMemory = async (content: string, scope: string, tags: string, id?: string) => { setMemoryBusy(true); const response = await request("memory.save", { ...(id ? { id } : {}), content, scope, source: "user", approvalId: `electron-${Date.now()}`, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setMemoryBusy(false); if (!response.ok) { setError(response.error?.message ?? "Memory could not be saved."); return false; } await loadMemory(); return true; };
  const toggleMemory = async (entry: MemoryEntry) => { setMemoryBusy(true); const response = await request("memory.enabled", { id: entry.id, enabled: !entry.enabled }); setMemoryBusy(false); if (!response.ok) setError(response.error?.message ?? "Memory state could not be changed."); else await loadMemory(); };
  const removeMemory = async (entry: MemoryEntry) => { setMemoryBusy(true); const response = await request("memory.remove", { id: entry.id }); setMemoryBusy(false); if (!response.ok) { setError(response.error?.message ?? "Memory could not be removed."); return false; } await loadMemory(); return true; };
  const exportMemory = async () => { const response = await request("memory.export"); if (!response.ok) { setError(response.error?.message ?? "Memory export failed."); return; } const result = response.result as { fileName: string; json: string }; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([result.json], { type: "application/json" })); link.download = result.fileName; link.click(); URL.revokeObjectURL(link.href); };
  const loadCorpus = async (query?: string) => { setCorpusLoading(true); setCorpusError(null); try { const response = await request(query?.trim() ? "corpus.search" : "corpus.list", query?.trim() ? { query: query.trim() } : undefined); if (!response.ok) throw new Error(response.error?.message ?? "Document corpus could not be loaded."); const result = response.result as Array<CorpusDocument | { document: CorpusDocument }>; setCorpusDocuments(result.map((item) => "document" in item ? item.document : item)); } catch (loadError) { setCorpusError(loadError instanceof Error ? loadError.message : "Document corpus could not be loaded."); } finally { setCorpusLoading(false); } };
  const saveCorpus = async (title: string, source: string, content: string, tags: string, id?: string) => { setCorpusLoading(true); const response = await request("corpus.upsert", { ...(id ? { id } : {}), title, source, content, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setCorpusLoading(false); if (!response.ok) { setCorpusError(response.error?.message ?? "Document could not be saved."); return false; } await loadCorpus(); return true; };
  const removeCorpus = async (document: CorpusDocument) => { setCorpusLoading(true); const response = await request("corpus.remove", { id: document.id }); setCorpusLoading(false); if (!response.ok) { setCorpusError(response.error?.message ?? "Document could not be removed."); return false; } await loadCorpus(); return true; };
  const importCorpus = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) { setCorpusError(response.error?.message ?? "Local files could not be selected."); return; } const attachments = (response.result as { attachments?: Array<{ fileName: string; mediaType?: string | null; content: string }> }).attachments ?? []; if (!attachments.length) return; setCorpusLoading(true); setCorpusError(null); try { for (const attachment of attachments) { if (attachment.mediaType?.startsWith("image/")) throw new Error(`${attachment.fileName}: OCR is not available in the local corpus yet; add extracted text instead.`); let content = attachment.content; if (attachment.fileName.toLowerCase().endsWith(".pdf")) { const extracted = await request("workspace.attachment.extract", { fileName: attachment.fileName, content }); if (!extracted.ok) throw new Error(extracted.error?.message ?? `Could not extract ${attachment.fileName}.`); content = (extracted.result as { content?: string }).content ?? ""; } await request("corpus.upsert", { title: attachment.fileName, source: attachment.fileName, content, tags: [attachment.fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "imported"] }); } await loadCorpus(); } catch (importError) { setCorpusError(importError instanceof Error ? importError.message : "Local files could not be imported."); } finally { setCorpusLoading(false); } };
  const discoverModels = async (): Promise<boolean> => { if (!isLocalEndpoint(endpoint)) { setError(LOCAL_ENDPOINT_ERROR); return false; } const response = await request("models.list", { provider, endpoint }); if (!response.ok) { setError(response.error?.message ?? "Model discovery failed."); return false; } setModels((response.result as Model[]) ?? []); setError(null); return true; };
  const activeModelPullId = useRef<string | null>(null);
  const pullModel = async (modelId: string, onProgress: (message: string) => void): Promise<boolean> => { if (!isLocalEndpoint(endpoint) || provider !== "Ollama") { setError("Model downloads are currently available only through a local Ollama endpoint."); return false; } const started = await request("models.pull.start", { endpoint, model: modelId }); if (!started.ok) { setError(started.error?.message ?? "Local model download could not start."); return false; } const operationId = (started.result as { id?: string }).id; if (!operationId) { setError("Local model download did not return an operation ID."); return false; } activeModelPullId.current = operationId; for (let attempt = 0; attempt < 600; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 500)); const status = await request("models.pull.status", { id: operationId }); if (!status.ok) { setError(status.error?.message ?? "Local model download status was unavailable."); activeModelPullId.current = null; return false; } const result = status.result as { status: string; progress?: string[]; error?: string }; for (const message of result.progress ?? []) onProgress(message); if (result.status === "completed") { setError(null); activeModelPullId.current = null; return true; } if (result.status === "failed" || result.status === "cancelled") { setError(result.error ?? "Local model download did not complete."); activeModelPullId.current = null; return false; } } setError("Local model download timed out; the local operation may still be running."); return false; };
  const cancelModelPull = async (): Promise<boolean> => { const id = activeModelPullId.current; if (!id) return false; const response = await request("models.pull.cancel", { id }); if (!response.ok) { setError(response.error?.message ?? "Local model cancellation failed."); return false; } setError(null); return true; };
  const saveSettings = async () => { const selectedProvider = localProviderOrFallback(provider); if (!isLocalEndpoint(endpoint)) { setError(LOCAL_ENDPOINT_ERROR); return false; } const response = await request("settings.save", { provider: selectedProvider, endpoint, model, ollamaContextWindowTokens, localRamBudgetBytes, localGpuBudgetBytes, themeMode, accentColor, interfaceDensity: density, backdropPreset: backdrop, reduceMotion, developerMode, memoryInjectionEnabled, smartPromptRewritingEnabled }); if (!response.ok) { setError(response.error?.message ?? "Workspace settings could not be saved."); return false; } setProvider(selectedProvider); localStorage.setItem("skai.provider", selectedProvider); localStorage.setItem("skai.endpoint", endpoint); localStorage.setItem("skai.model", model); localStorage.setItem("skai.themeMode", themeMode); localStorage.setItem("skai.accentColor", accentColor); localStorage.setItem("skai.density", density); localStorage.setItem("skai.backdrop", backdrop); localStorage.setItem("skai.reduceMotion", String(reduceMotion)); localStorage.setItem("skai.smartPromptRewriting", String(smartPromptRewritingEnabled)); localStorage.setItem("skai.imageEndpoint", imageEndpoint); localStorage.setItem("skai.imageWorkflow", imageWorkflow); localStorage.setItem("skai.imageProvider", imageProvider); setError(null); return true; };
  const generateImage = async (source?: import("../../shared/contracts").ChatAttachment) => {
    if (imageProvider === "comfyui" && !isLocalEndpoint(imageEndpoint)) { setError(LOCAL_ENDPOINT_ERROR); return; }
    setImageBusy(true);
    setError(null);
    localStorage.setItem("skai.imageEndpoint", imageEndpoint);
    localStorage.setItem("skai.imageProvider", imageProvider);
    localStorage.setItem("skai.imageWorkflow", imageWorkflow); localStorage.setItem("skai.imageProvider", imageProvider);
    try {
      const response = await request("image.generate", { provider: imageProvider, ...(imageProvider === "comfyui" ? { endpoint: imageEndpoint, workflow: imageWorkflow } : {}), ...(source ? { sourceImage: source.content, sourceImageMediaType: source.mediaType } : {}), prompt: imagePrompt });
      if (!response.ok) { setError(response.error?.message ?? "Image generation failed."); return; }
      const result = response.result as { images?: Array<{ url: string; fileName: string }> };
      const createdAt = new Date().toISOString();
      const imageSource = imageProvider === "comfyui" ? "comfyui" : "diffusers";
      const images: ImageHistoryEntry[] = (result.images ?? []).map((image) => ({ ...image, createdAt, provider: imageSource, prompt: imagePrompt.trim() }));
      setGeneratedImages((current) => [...images, ...current].slice(0, 24));
      void saveImageHistory(images);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setImageBusy(false);
    }
  };
  const pickImageSource = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) throw new Error(response.error?.message ?? "Image selection failed."); const attachments = (response.result as { attachments?: import("../../shared/contracts").ChatAttachment[] }).attachments ?? []; const source = attachments.find((item) => item.mediaType === "image/png" || item.mediaType === "image/jpeg"); if (!source) return null; return source; };
  const importImageWorkflow = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) throw new Error(response.error?.message ?? "A local workflow file could not be selected."); const attachments = (response.result as { attachments?: Array<{ fileName: string; content: string }> }).attachments ?? []; const workflowFile = attachments.find((attachment) => /\.(json|json5)$/i.test(attachment.fileName)); if (!workflowFile) throw new Error("Choose a ComfyUI API workflow file (.json or .json5)."); let parsed: unknown; try { parsed = JSON.parse(workflowFile.content); } catch { throw new Error("The selected workflow is not valid JSON."); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The selected workflow must be a JSON object."); return { name: workflowFile.fileName.replace(/\.(json|json5)$/i, ""), workflow: JSON.stringify(parsed, null, 2) }; };
  const routeState: AppRouteState = { route: route === "settings" ? settingsReturnRoute : route, workspaceTabId: activeWorkspaceTabId, conversations: chat.conversations, provider, model, responseMode: chat.responseMode, capacity, models, ollamaContextWindowTokens, localRamBudgetBytes, localGpuBudgetBytes, endpoint, messages: chat.messages, busy: chat.busy, attachments: chat.attachments, queuedMessages: chat.queuedMessages, conversationId: chat.conversationId, conversationTitle: chat.activeConversation?.title ?? "New chat", pinned: chat.activeConversation?.pinned ?? false, archived: chat.activeConversation?.archived ?? false, projects: coding.projects, selectedProject: coding.selectedProject, projectFiles: coding.projectFiles, selectedFile: coding.selectedFile, filePreview: coding.filePreview, filePreviewError: coding.filePreviewError, fileDraft: coding.fileDraft, fileOriginal: coding.fileOriginal, fileSummary: coding.fileSummary, fileBusy: coding.fileBusy, fileUndoAvailable: coding.fileUndoAvailable, terminalBusy: coding.terminalBusy, terminalOutput: coding.terminalOutput, terminalExitCode: coding.terminalExitCode, gitStatus: coding.gitStatus, gitBusy: coding.gitBusy, gitDiff: coding.gitDiff, gitDiffBusy: coding.gitDiffBusy, gitCommitBusy: coding.gitCommitBusy, gitPullRequestBusy: coding.gitPullRequestBusy, themeMode, accentColor, density, backdrop, reduceMotion, petVisible, petWander, petInteractionDemo, petCharacter, petSpriteDataUrl, developerMode, memoryInjectionEnabled, smartPromptRewritingEnabled, imageProvider, imageEndpoint, imagePrompt, imageWorkflow, imageBusy, generatedImages, tasks, scheduledTasks, taskBusy, tasksLoading, tasksError, memoryEntries, memoryBusy, memoryLoading, memoryError, corpusDocuments, corpusLoading, corpusError };
  const selectModel = (nextModel: Model) => {
    const selectedProvider = nextModel.provider === "AirLLM" ? "AirLLM" : nextModel.provider === "LM Studio" ? "LM Studio" : nextModel.provider === "Ollama" ? "Ollama" : "Local API";
    setModel(nextModel.model);
    setProvider(selectedProvider);
    localStorage.setItem("skai.model", nextModel.model);
    localStorage.setItem("skai.provider", selectedProvider);
    if (selectedProvider !== "AirLLM" && nextModel.endpoint && isLocalEndpoint(nextModel.endpoint)) {
      setEndpoint(nextModel.endpoint);
      localStorage.setItem("skai.endpoint", nextModel.endpoint);
    }
  };  const routeActions: AppRouteActions = { onNavigate, onSelectConversation: selectConversation, onNewWorkspaceTab: openNewWorkspaceTab, onSend: chat.sendMessage, onRewritePrompt: chat.rewritePrompt, onStartTemporaryChat: chat.startNewChat, onQueue: chat.queueMessage, onRemoveQueued: chat.removeQueuedMessage, onAttach: chat.pickAttachments, onFilesDropped: chat.importDroppedFiles, onRemoveAttachment: (index) => chat.setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index)), onSetAttachments: (attachments) => chat.setAttachments(attachments), onModelChange: selectModel, onResponseModeChange: chat.setResponseMode, onProviderChange: (nextProvider) => { const selectedProvider = localProviderOrFallback(nextProvider); setProvider(selectedProvider); localStorage.setItem("skai.provider", selectedProvider); if (!isLocalEndpoint(endpoint)) setEndpoint(defaultEndpoint); }, onExportConversations: chat.exportConversations, onFork: () => void chat.forkConversation(), onForkFromMessage: (index) => void chat.forkConversation(index), onRetryMessage: (index) => void chat.retryMessage(index), onEditMessage: chat.editMessage, onTogglePinned: () => void chat.updateConversationMetadata({ pinned: !(chat.activeConversation?.pinned ?? false) }), onArchive: () => void chat.updateConversationMetadata({ archived: !(chat.activeConversation?.archived ?? false) }), onRenameConversation: (title) => chat.updateConversationMetadata({ title }), onPickFolder: coding.pickProjectFolder, onSaveProject: coding.saveProject, onOpenProject: openProjectTab, onOpenFile: (path) => void coding.openProjectFile(path), onCloseFile: () => void coding.closeProjectFile(), onDraftChange: coding.setFileDraft, onSaveFile: () => void coding.saveProjectFile(), onUndoFile: () => void coding.undoProjectFile(), onRunTerminal: (projectId, command, cwd) => void coding.runTerminal(projectId, command, cwd), onRefreshGitStatus: () => void coding.refreshGitStatus(), onLoadGitDiff: () => void coding.loadGitDiff(), onCommitGitChanges: coding.commitGitChanges, onPlanTask: planTask, onTaskAction: (id, operation) => void transitionTask(id, operation), onSettingsChange: (key, value) => { if (key === "themeMode") setThemeMode(value as ThemeMode); if (key === "accentColor") setAccentColor(String(value)); if (key === "density") setDensity(String(value)); if (key === "backdrop") setBackdrop(String(value)); if (key === "reduceMotion") setReduceMotion(Boolean(value)); if (key === "petVisible") setPetVisible(Boolean(value)); if (key === "petWander") setPetWander(Boolean(value)); if (key === "petInteractionDemo") setPetInteractionDemo(Boolean(value)); if (key === "petSpriteDataUrl") { setPetSpriteDataUrl(String(value)); localStorage.setItem("skai.pet.sprite", String(value)); } if (key === "developerMode") setDeveloperMode(Boolean(value)); if (key === "memoryInjectionEnabled") setMemoryInjectionEnabled(Boolean(value)); if (key === "smartPromptRewritingEnabled") setSmartPromptRewritingEnabled(Boolean(value)); if (key === "provider") setProvider(localProviderOrFallback(String(value))); if (key === "model") setModel(String(value)); if (key === "endpoint") { setEndpoint(String(value)); localStorage.setItem("skai.endpoint", String(value)); } if (key === "ollamaContextWindowTokens") { const parsed = Number(value); if ([0, 32768, 131072, 1048576].includes(parsed)) setOllamaContextWindowTokens(parsed); } if (key === "localRamBudgetBytes") { const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) setLocalRamBudgetBytes(parsed); } if (key === "localGpuBudgetBytes") { const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) setLocalGpuBudgetBytes(parsed); } }, onSaveSettings: saveSettings, onDiscoverModels: () => void discoverModels(), onPullModel: pullModel, onSelectModel: (nextModel) => { selectModel(nextModel); onNavigate("chat"); }, onImageChange: (key, value) => { if (key === "provider") { const next = value === "diffusers" ? "diffusers" : "comfyui"; setImageProvider(next); localStorage.setItem("skai.imageProvider", next); } if (key === "endpoint") setImageEndpoint(value); if (key === "prompt") setImagePrompt(value); if (key === "workflow") setImageWorkflow(value); }, onGenerateImage: (source) => void generateImage(source), onRetryWorkbench: () => void loadWorkbench(), onTransitionTask: (id, operation) => void transitionTask(id, operation), onExecuteTask: (id) => void executeTask(id), onScheduleTask: scheduleTask, onTransitionScheduledTask: transitionScheduledTask, onRetryMemory: () => void loadMemory(), onSearchMemory: (query) => void loadMemory(query), onSaveMemory: saveMemory, onToggleMemory: (entry) => void toggleMemory(entry), onRemoveMemory: removeMemory, onExportMemory: () => void exportMemory(), onRunProjectCommand: (projectId, command, cwd) => void coding.runTerminal(projectId, command, cwd) };

  routeActions.onImportCorpus = () => void importCorpus();
  routeActions.onPickImageSource = pickImageSource;
  routeActions.onCancelModelPull = cancelModelPull;
  routeActions.onPushGitChanges = coding.pushGitChanges;
  routeActions.onCreateGitPullRequest = coding.createGitPullRequest;
  routeActions.onStartTerminalSession = coding.startTerminalSession;
  routeActions.onWriteTerminalSession = coding.writeTerminalSession;
  routeActions.onRefreshTerminalSession = coding.refreshTerminalSession;
  routeActions.onCloseTerminalSession = coding.closeTerminalSession;
  routeActions.onDiscoverModels = discoverModels;
  routeActions.onImportWorkflow = importImageWorkflow;
  return { routeState, routeActions, route, settingsReturnRoute, workspaceTabs, activeWorkspaceTabId, canRestoreWorkspaceTab: closedWorkspaceTabs.length > 0, openNewWorkspaceTab, selectWorkspaceTab, closeWorkspaceTab, restoreWorkspaceTab, connection, health, error, dismissError, retryConnection, conversations: chat.conversations, agentMode, setAgentMode, conversationQuery, setConversationQuery, sidebarCollapsed, sidebarWidth, toggleSidebar, resizeSidebar, commandOpen, openCommandPalette, closeCommandPalette, startNewChat, selectConversation, updateConversationMetadata: (id, patch) => chat.updateConversationMetadata(patch, id), onNavigate, canGoBack: navigation.index > 0, canGoForward: navigation.index < navigation.length - 1, goBack, goForward, petVisible, petWander, petInteractionDemo, setPetVisible, setPetWander };
}
