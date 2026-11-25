import { useCallback, useEffect, useRef, useState } from "react";
import type { useChatWorkspace } from "../features/chat/useChatWorkspace";
import type { useCodingWorkspace } from "../features/coding/useCodingWorkspace";
import { removeChatDraft } from "../features/chat/chatDraftStore";
import { reorderItem } from "./reorderItem";
import { createWorkspaceTabId, hasStoredWorkspaceTabs as readHasStoredWorkspaceTabs, readActiveWorkspaceTabId, readClosedWorkspaceTabs, readWorkspaceTabs, saveClosedWorkspaceTabs, saveWorkspaceTabs, type WorkspaceSessionTab } from "./workspaceTabStore";
import type { ConnectionState, Route } from "./types";
import { isLocalEndpoint, localProviderOrFallback } from "../services/localOnly";

type WorkspaceSessionTabOptions = {
  chat: ReturnType<typeof useChatWorkspace>;
  coding: ReturnType<typeof useCodingWorkspace>;
  route: Route;
  connection: ConnectionState;
  onNavigate: (route: Route) => void;
  agentMode: "ChatBot" | "Coding Agent";
  setAgentModeState: (mode: "ChatBot" | "Coding Agent") => void;
  setModel: (model: string) => void;
  setProvider: (provider: string) => void;
  setEndpoint: (endpoint: string) => void;
  setError: (error: string | null) => void;
};

export function useWorkspaceSessionTabs({ chat, coding, route, connection, onNavigate, agentMode, setAgentModeState, setModel, setProvider, setEndpoint, setError }: WorkspaceSessionTabOptions) {
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readWorkspaceTabs);
  const [hasStoredWorkspaceTabs] = useState(readHasStoredWorkspaceTabs);
  const [workspaceSessionRestored, setWorkspaceSessionRestored] = useState(false);
  const [closedWorkspaceTabs, setClosedWorkspaceTabs] = useState<WorkspaceSessionTab[]>(readClosedWorkspaceTabs);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState(readActiveWorkspaceTabId);
  const workspaceSessionRestoreStartedRef = useRef(false);
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
        const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: conversation.title, route: destination, conversationId: id, projectId: project?.id ?? null };
        setWorkspaceTabs((current) => [...current, tab].slice(-16));
        setActiveWorkspaceTabId(tab.id);
      }
    }
    chat.selectConversation(id);
    if (conversation?.mode === "Coding Agent") chat.setResponseMode("coding", conversation.id);
    onNavigate(destination);
  }, [chat, coding, onNavigate, workspaceTabs]);
  const openNewWorkspaceTab = useCallback(() => {
    const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: agentMode === "Coding Agent" ? "New coding thread" : "New chat", route: "chat", conversationId: null, projectId: null };
    setWorkspaceTabs((current) => [...current, tab].slice(-16));
    setActiveWorkspaceTabId(tab.id);
    chat.startNewChat();
    chat.setResponseMode(agentMode === "Coding Agent" ? "coding" : "think");
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
        if (conversation.mode === "Coding Agent") chat.setResponseMode("coding", conversation.id);
      }
    } else {
      chat.startNewChat();
      if (tab.route === "coding" || tab.title === "New coding thread") chat.setResponseMode("coding");
    }
    const project = tab.projectId ? coding.projects.find((item) => item.id === tab.projectId) : null;
    if (project) void coding.selectProject(project);
    onNavigate(tab.route);
  }, [chat, coding, onNavigate]);
  const closeWorkspaceTabs = useCallback((tabIds: string[]) => {
    const closing = workspaceTabs.filter((item) => tabIds.includes(item.id));
    if (!closing.length) return;
    const nextClosed = [...closing.slice().reverse(), ...closedWorkspaceTabs.filter((item) => !tabIds.includes(item.id))];
    for (const evicted of nextClosed.slice(10)) void removeChatDraft(evicted.id);
    setClosedWorkspaceTabs(nextClosed.slice(0, 10));
    const remaining = workspaceTabs.filter((item) => !tabIds.includes(item.id));
    if (!remaining.length) {
      const replacement: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: "New chat", route: "chat", conversationId: null, projectId: null };
      setWorkspaceTabs([replacement]);
      selectWorkspaceTab(replacement);
      return;
    }
    setWorkspaceTabs(remaining);
    if (tabIds.includes(activeWorkspaceTabId)) {
      const oldIndex = workspaceTabs.findIndex((item) => item.id === activeWorkspaceTabId);
      selectWorkspaceTab(remaining[Math.min(Math.max(oldIndex, 0), remaining.length - 1)]);
    }
  }, [activeWorkspaceTabId, closedWorkspaceTabs, selectWorkspaceTab, workspaceTabs]);
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
    if (existingTab) { selectWorkspaceTab(existingTab); return; }
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
    const tab: WorkspaceSessionTab = { id: createWorkspaceTabId(), title: project.name, route: "coding", conversationId: projectThread?.id ?? null, projectId: project.id };
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
    saveWorkspaceTabs(workspaceTabs, activeWorkspaceTabId);
  }, [activeWorkspaceTabId, workspaceTabs]);
  useEffect(() => { saveClosedWorkspaceTabs(closedWorkspaceTabs); }, [closedWorkspaceTabs]);
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
  return { workspaceTabs, activeWorkspaceTabId, canRestoreWorkspaceTab: closedWorkspaceTabs.length > 0, openNewWorkspaceTab, startNewChat, selectConversation, selectWorkspaceTab, closeWorkspaceTab, closeWorkspaceTabs, reorderWorkspaceTab, restoreWorkspaceTab, openProjectTab };
}
