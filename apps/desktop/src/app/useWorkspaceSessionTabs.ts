import { useCallback, useEffect, useRef, useState } from "react";
import type { useChatWorkspace } from "../features/chat/useChatWorkspace";
import type { useCodingWorkspace } from "../features/coding/useCodingWorkspace";
import { removeChatDraft } from "../features/chat/chatDraftStore";
import { reorderItem } from "./reorderItem";
import { createWorkspaceTabId, hasStoredWorkspaceTabs as readHasStoredWorkspaceTabs, readActiveWorkspaceTabId, readClosedWorkspaceTabs, readWorkspaceTabs, saveClosedWorkspaceTabs, saveWorkspaceTabs, type WorkspaceSessionTab } from "./workspaceTabStore";
import type { ConnectionState, Route } from "./types";
import { isLocalEndpoint, localProviderOrFallback } from "../services/localOnly";

const codingThreadTitle = (conversation?: { title?: string | null } | null) => conversation?.title?.trim() || "New coding thread";

type WorkspaceSessionTabOptions = {
  chat: ReturnType<typeof useChatWorkspace>;
  coding: ReturnType<typeof useCodingWorkspace>;
  route: Route;
  connection: ConnectionState;
  onNavigate: (route: Route) => void;
  agentMode: "ChatBot" | "Coding Agent";
  setAgentModeState: (mode: "ChatBot" | "Coding Agent") => void;
  setModel: (model: string) => void;
  setProvider: (provider: ReturnType<typeof localProviderOrFallback>) => void;
  setEndpoint: (endpoint: string) => void;
  setError: (error: string | null) => void;
};

export function useWorkspaceSessionTabs({ chat, coding, route, connection, onNavigate, agentMode, setAgentModeState, setModel, setProvider, setEndpoint, setError }: WorkspaceSessionTabOptions) {
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readWorkspaceTabs);
  const [sideChatRequest, setSideChatRequest] = useState(0);
  const [hasStoredWorkspaceTabs] = useState(readHasStoredWorkspaceTabs);
  const [workspaceSessionRestored, setWorkspaceSessionRestored] = useState(false);
  const [closedWorkspaceTabs, setClosedWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readClosedWorkspaceTabs);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(readActiveWorkspaceTabId);
  const workspaceSessionRestoreStartedRef = useRef(false);
  const ensureProjectThread = useCallback((project: import("../../shared/contracts").DesktopProject, tabId: string) => {
    void chat.createConversation({ mode: "Coding Agent", project, title: "New coding thread", responseMode: "coding" }).then((id) => {
      if (!id) return;
      setWorkspaceTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, title: "New coding thread", conversationId: id, route: "coding", projectId: project.id } : tab));
    });
  }, [chat]);
  const selectConversation = useCallback((id: string) => {
    const conversation = chat.conversations.find((item) => item.id === id);
    let destination: Route = "chat";
    if (conversation) {
      const mode = conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot";
      setAgentModeState(mode);
      localStorage.setItem("skai.agentMode", mode);
      const project = conversation.projectId ? coding.projects.find((item) => item.id === conversation.projectId) : null;
      if (project) {
        destination = "coding";
        void coding.selectProject(project);
        const existingProjectTab = workspaceTabs.find((tab) => tab.projectId === project.id);
        const tabId = existingProjectTab?.id ?? createWorkspaceTabId();
        const projectTab: WorkspaceSessionTab = { id: tabId, title: conversation.title, route: "coding", conversationId: id, projectId: project.id };
        setWorkspaceTabs((current) => current.some((tab) => tab.id === tabId)
          ? current.map((tab) => tab.id === tabId ? projectTab : tab)
          : [...current, projectTab].slice(-16));
        setActiveWorkspaceTabId(tabId);
      } else {
        const existing = workspaceTabs.find((tab) => tab.conversationId === id);
        if (existing) setActiveWorkspaceTabId(existing.id);
        else {
          const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: conversation.title, route: destination, conversationId: id, projectId: null };
          setWorkspaceTabs((current) => [...current, tab].slice(-16));
          setActiveWorkspaceTabId(tab.id);
        }
      }
    }
    chat.selectConversation(id);
    if (conversation?.mode === "Coding Agent") chat.setResponseMode("coding", conversation.id);
    onNavigate(destination);
  }, [chat, coding, onNavigate, workspaceTabs]);
  const openNewWorkspaceTab = useCallback(() => {
    const codingRoute = agentMode === "Coding Agent";
    const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: codingRoute ? codingThreadTitle(null) : "New chat", route: codingRoute ? "coding" : "chat", conversationId: null, projectId: null };
    setWorkspaceTabs((current) => [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    chat.startNewChat();
    chat.setResponseMode(codingRoute ? "coding" : "think");
    onNavigate(codingRoute ? "coding" : "chat");
  }, [agentMode, chat, onNavigate]);
  const openNewProjectThread = useCallback((project: import("../../shared/contracts").DesktopProject) => {
    try {
      const preferred = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}");
      const choice = preferred?.coding as { model?: string; provider?: string; endpoint?: string | null } | undefined;
      if (choice?.model) {
        setModel(choice.model);
        if (choice.provider) setProvider(localProviderOrFallback(choice.provider));
        if (choice.endpoint && isLocalEndpoint(choice.endpoint)) setEndpoint(choice.endpoint);
      }
    } catch { /* keep the current model when task preferences are unavailable */ }
    setAgentModeState("Coding Agent");
    localStorage.setItem("skai.agentMode", "Coding Agent");
    chat.startNewChat();
    chat.setResponseMode("coding");
    const existing = workspaceTabs.find((tab) => tab.projectId === project.id);
    const tabId = existing?.id ?? createWorkspaceTabId();
    const tab: WorkspaceSessionTab = { id: tabId, title: "New coding thread", route: "coding", conversationId: null, projectId: project.id };
    setWorkspaceTabs((current) => current.some((item) => item.id === tabId)
      ? current.map((item) => item.id === tabId ? tab : item)
      : [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tabId);
    ensureProjectThread(project, tabId);
    void coding.selectProject(project);
    onNavigate("coding");
  }, [chat, coding, ensureProjectThread, onNavigate, setAgentModeState, setEndpoint, setModel, setProvider, workspaceTabs]);
  const openSideChat = useCallback(() => {
    if (route === "coding" && !coding.selectedProject) {
      onNavigate("projects");
      return;
    }
    if (route !== "coding") {
      openNewWorkspaceTab();
      return;
    }
    setSideChatRequest((current) => current + 1);
  }, [coding.selectedProject, openNewWorkspaceTab, route]);
  const startNewChat = openNewWorkspaceTab;
  const selectWorkspaceTab = useCallback((tab: WorkspaceSessionTab) => {
    setActiveWorkspaceTabId(tab.id);
    if (tab.conversationId) {
      const conversation = chat.conversations.find((item) => item.id === tab.conversationId);
      if (conversation) {
        setAgentModeState(conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot");
        localStorage.setItem("skai.agentMode", conversation.mode === "Coding Agent" ? "Coding Agent" : "ChatBot");
        chat.selectConversation(tab.conversationId);
        if (conversation.mode === "Coding Agent") chat.setResponseMode("coding", conversation.id);
      }
    } else {
      chat.startNewChat();
      if (tab.route === "coding" || tab.title === "New coding thread") chat.setResponseMode("coding");
    }
    const project = tab.projectId ? coding.projects.find((item) => item.id === tab.projectId) : null;
    if (project) {
      const selectedProjectConversation = tab.conversationId ? chat.conversations.find((item) => item.id === tab.conversationId) : undefined;
      setWorkspaceTabs((current) => current.map((item) => item.id === tab.id ? { ...item, route: "coding", projectId: project.id, title: selectedProjectConversation?.title ?? "New coding thread" } : item));
      void coding.selectProject(project);
      if (!tab.conversationId && tab.route === "coding") ensureProjectThread(project, tab.id);
    }
    onNavigate(tab.route);
  }, [chat, coding, ensureProjectThread, onNavigate]);
  const closeWorkspaceTabs = useCallback((tabIds: string[]) => {
    const closing = workspaceTabs.filter((item) => tabIds.includes(item.id));
    if (!closing.length) return;
    const nextClosed = [...closing.slice().reverse(), ...closedWorkspaceTabs.filter((item) => !tabIds.includes(item.id))];
    for (const evicted of nextClosed.slice(10)) void removeChatDraft(evicted.id);
    setClosedWorkspaceTabs(nextClosed.slice(0, 10));
    const remaining = workspaceTabs.filter((item) => !tabIds.includes(item.id));
    if (!remaining.length) {
      const replacement: WorkspaceSessionTab = route === "coding"
        ? { id: createWorkspaceTabId(), title: "New coding thread", route: "coding", conversationId: null, projectId: null }
        : { id: createWorkspaceTabId(), title: "New chat", route: "chat", conversationId: null, projectId: null };
      setWorkspaceTabs([replacement]);
      selectWorkspaceTab(replacement);
      return;
    }
    setWorkspaceTabs(remaining);
    if (tabIds.includes(activeWorkspaceTabId)) {
      const oldIndex = workspaceTabs.findIndex((item) => item.id === activeWorkspaceTabId);
      selectWorkspaceTab(remaining[Math.min(Math.max(oldIndex, 0), remaining.length - 1)]);
    }
  }, [activeWorkspaceTabId, closedWorkspaceTabs, route, selectWorkspaceTab, workspaceTabs]);
  const closeWorkspaceTab = useCallback((tabId: string) => closeWorkspaceTabs([tabId]), [closeWorkspaceTabs]);
  const reorderWorkspaceTab = useCallback((sourceId: string, targetId: string) => {
    setWorkspaceTabs((current) => reorderItem(current, sourceId, targetId, (tab) => tab.id));
  }, []);
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
    if (existingTab) {
      const existingConversation = existingTab.conversationId ? chat.conversations.find((conversation) => conversation.id === existingTab.conversationId) : undefined;
      const normalizedTab = { ...existingTab, route: "coding" as const, projectId: project.id, title: existingConversation?.title ?? "New coding thread" };
      setWorkspaceTabs((current) => current.map((tab) => tab.id === existingTab.id ? normalizedTab : tab));
      selectWorkspaceTab(normalizedTab);
      return;
    }
    try {
      const preferred = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}");
      const choice = preferred?.coding as { model?: string; provider?: string; endpoint?: string | null } | undefined;
      if (choice?.model) {
        setModel(choice.model);
        if (choice.provider) setProvider(localProviderOrFallback(choice.provider));
        if (choice.endpoint && isLocalEndpoint(choice.endpoint)) setEndpoint(choice.endpoint);
      }
    } catch { /* keep the current model when task preferences are unavailable */ }
    setAgentModeState("Coding Agent");
    localStorage.setItem("skai.agentMode", "Coding Agent");
    const projectThread = chat.conversations.find((conversation) => conversation.projectId === project.id && (conversation.mode ?? "ChatBot") === "Coding Agent");
    if (projectThread) {
      chat.selectConversation(projectThread.id);
      chat.setResponseMode("coding", projectThread.id);
    } else {
      chat.startNewChat();
      chat.setResponseMode("coding");
    }
    const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: projectThread?.title ?? "New coding thread", route: "coding", conversationId: projectThread?.id ?? null, projectId: project.id };
    setWorkspaceTabs((current) => [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    if (!projectThread) ensureProjectThread(project, tab.id);
    void coding.selectProject(project);
    onNavigate("coding");
  }, [chat, coding, ensureProjectThread, onNavigate, selectWorkspaceTab, setAgentModeState, setEndpoint, setModel, setProvider, workspaceTabs]);
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
        title: legacyProject ? legacyConversation?.title ?? "New coding thread" : legacyConversation?.title ?? activeTab.title,
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
      if (!conversation && restoredTab.route === "coding") ensureProjectThread(project, restoredTab.id);
      void coding.selectProject(project, shouldNavigateToWorkspace).catch(() => undefined).finally(() => setWorkspaceSessionRestored(true));
      return;
    }
    else if (restoredTab.projectId && !project) {
      setError("The project saved in this workspace tab is no longer available. Reconnect it from Projects.");
      if (shouldNavigateToWorkspace) onNavigate("projects");
    } else if (route === "chat") onNavigate(restoredTab.route === "coding" ? "projects" : "chat");
    setWorkspaceSessionRestored(true);
  }, [activeWorkspaceTabId, chat.conversationId, chat.conversations, chat.conversationsLoaded, chat.selectConversation, chat.setResponseMode, chat.startNewChat, coding.projects, coding.projectsLoaded, coding.selectProject, connection, ensureProjectThread, hasStoredWorkspaceTabs, onNavigate, route, workspaceSessionRestored, workspaceTabs]);
  useEffect(() => {
    saveWorkspaceTabs(workspaceTabs, activeWorkspaceTabId);
  }, [activeWorkspaceTabId, workspaceTabs]);
  useEffect(() => { saveClosedWorkspaceTabs(closedWorkspaceTabs); }, [closedWorkspaceTabs]);
  useEffect(() => {
    if (!workspaceSessionRestored || (route !== "chat" && route !== "coding")) return;
    const codingRoute = route === "coding";
    const codingConversation = coding.selectedProject && chat.conversationId && chat.activeConversation?.id === chat.conversationId
      && chat.activeConversation.projectId === coding.selectedProject.id
      ? chat.activeConversation
      : undefined;
    setWorkspaceTabs((current) => current.map((tab) => tab.id !== activeWorkspaceTabId ? tab : {
      ...tab,
      route: codingRoute ? "coding" : "chat",
      conversationId: codingRoute ? codingConversation?.id ?? null : chat.conversationId,
      projectId: codingRoute ? coding.selectedProject?.id ?? null : null,
      title: codingRoute ? codingThreadTitle(codingConversation) : chat.activeConversation?.title ?? (agentMode === "Coding Agent" ? codingThreadTitle(null) : "New chat"),
    }));
  }, [activeWorkspaceTabId, agentMode, chat.activeConversation?.id, chat.activeConversation?.projectId, chat.activeConversation?.title, chat.conversationId, coding.selectedProject?.id, route, workspaceSessionRestored]);
  useEffect(() => {
    const selectedProject = route === "coding" ? coding.selectedProject : null;
    if (!selectedProject) return;
    const projectTabs = workspaceTabs.filter((tab) => tab.projectId === selectedProject.id);
    const projectTab = projectTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? projectTabs[0];
    if (!projectTab) return;
    const selectedConversation = chat.conversationId
      ? chat.conversations.find((conversation) => conversation.id === chat.conversationId)
      : chat.activeConversation;
    const projectConversation = selectedConversation?.projectId === selectedProject.id ? selectedConversation : undefined;
    const conversationId = projectConversation?.id ?? null;
    const title = codingThreadTitle(projectConversation);
    const needsTabUpdate = projectTab.route !== "coding"
      || projectTab.projectId !== selectedProject.id
      || projectTab.title !== title
      || projectTab.conversationId !== conversationId;
    if (needsTabUpdate) {
      setWorkspaceTabs((current) => current.map((tab) => tab.id === projectTab.id ? { ...tab, route: "coding", projectId: selectedProject.id, conversationId, title } : tab));
    }
    if (activeWorkspaceTabId !== projectTab.id) setActiveWorkspaceTabId(projectTab.id);
  }, [activeWorkspaceTabId, chat.activeConversation, chat.conversationId, chat.conversations, coding.selectedProject, route, workspaceSessionRestored, workspaceTabs]);
  useEffect(() => {
    const bridge = window.skaiAgent;
    const removeConversation = bridge?.onTrayOpenConversation?.((id) => { selectConversation(id); onNavigate("chat"); });
    const removeNewChat = bridge?.onTrayNewChat?.(() => startNewChat());
    return () => { removeConversation?.(); removeNewChat?.(); };
  }, [onNavigate, selectConversation, startNewChat]);
  return { workspaceTabs, activeWorkspaceTabId, canRestoreWorkspaceTab: closedWorkspaceTabs.length > 0, openNewWorkspaceTab, openNewProjectThread, openSideChat, sideChatRequest, startNewChat, selectConversation, selectWorkspaceTab, closeWorkspaceTab, closeWorkspaceTabs, reorderWorkspaceTab, restoreWorkspaceTab, openProjectTab };
}
