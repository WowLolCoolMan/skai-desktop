import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentResponse, DesktopPersona, DesktopProjectPreflight, DesktopScheduledTask, DesktopTask, DesktopTaskWorkerDraft, LocalCapacitySnapshot, RuntimeHealth, ScheduledTaskDraft, TaskEnvironment } from "../../shared/contracts";
import { PRODUCT_DISPLAY_NAME } from "../../shared/productIdentity";
import type { AppRouteActions, AppRouteState } from "./AppRouteView";
import { initializeNavigation, navigate, navigatePersonaWorkshop, readNavigationState, routeFromLocation, type NavigationState } from "./navigation";
import type { ConnectionState, CorpusDocument, MemoryEntry, Model, Route, ThemeMode } from "./types";
import type { DesktopWorkspace } from "./desktopWorkspaceTypes";
import { defaultEndpoint, defaultModel, defaultProvider, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, readAgentMode, readPetInteractionDemoPreference, readSidebarWidth, readStoredBoolean, readThemeMode, SIDEBAR_WIDTH_KEY } from "./workspacePreferences";
import { createAgentClient } from "../services/agentClient";
import { isLocalEndpoint, LOCAL_ENDPOINT_ERROR, localEndpointOrFallback, localProviderOrFallback } from "../services/localOnly";
import { useChatWorkspace } from "../features/chat/useChatWorkspace";
import { useCodingWorkspace } from "../features/coding/useCodingWorkspace";
import { loadImageHistory, saveImageHistory, type ImageHistoryEntry } from "../features/catalog/imageHistory";
import { useThemeEngine } from "../theme/useThemeEngine";
import { useWorkspaceSessionTabs } from "./useWorkspaceSessionTabs";

export type { WorkspaceSessionTab } from "./workspaceTabStore";
export type { DesktopWorkspace } from "./desktopWorkspaceTypes";

export function useDesktopWorkspace(): DesktopWorkspace {
  const agent = useMemo(() => createAgentClient((method, params) => {
    const bridge = window.skaiAgent;
    if (!bridge) return Promise.resolve({ v: 1, id: `bridge-unavailable-${method}`, ok: false, error: { code: "BRIDGE_UNAVAILABLE", message: "The Electron agent bridge is unavailable." } });
    return bridge.request(method, params);
  }), []);
  const request = agent.request;
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [settingsReturnRoute, setSettingsReturnRoute] = useState<Route>(() => routeFromLocation() === "settings" ? "chat" : routeFromLocation());

  const [navigation, setNavigation] = useState<NavigationState>(() => readNavigationState(routeFromLocation()));
  const [commandOpen, setCommandOpen] = useState(false);
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
  const [subagentModel, setSubagentModel] = useState("");
  const [subagentModelProvider, setSubagentModelProvider] = useState("");
  const [subagentModelSizeBytes, setSubagentModelSizeBytes] = useState<number | null>(null);
  const [subagentModelContextLength, setSubagentModelContextLength] = useState<number | null>(null);
  const [ollamaContextWindowTokens, setOllamaContextWindowTokens] = useState(0);
  const [localRamBudgetBytes, setLocalRamBudgetBytes] = useState(0);
  const [localGpuBudgetBytes, setLocalGpuBudgetBytes] = useState(0);
  const [models, setModels] = useState<Model[]>([]);
  const modelInventoryLoadedRef = useRef(false);
  const [personas, setPersonas] = useState<DesktopPersona[]>([]);
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("skai.accentColor") ?? "cyan");
  const [density, setDensity] = useState(() => localStorage.getItem("skai.density") ?? "comfortable");
  const [backdrop, setBackdrop] = useState(() => localStorage.getItem("skai.backdrop") ?? "none");
  const [reduceMotion, setReduceMotion] = useState(() => readStoredBoolean("skai.reduceMotion", false));
  const [petVisible, setPetVisible] = useState(localStorage.getItem("skai.pet.visible") !== "false");
  const [petWander, setPetWander] = useState(localStorage.getItem("skai.pet.wander") !== "false");
  const [petInteractionDemo, setPetInteractionDemo] = useState(readPetInteractionDemoPreference);
  const [petCharacter] = useState(() => { const saved = localStorage.getItem("skai.pet.character"); return saved && (["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"].includes(saved) || saved.startsWith("custom:")) ? saved : "percy"; });
  const [petSpriteDataUrl, setPetSpriteDataUrl] = useState(() => localStorage.getItem("skai.pet.sprite") ?? "");
  const [developerMode, setDeveloperMode] = useState(false);
  const [memoryInjectionEnabled, setMemoryInjectionEnabled] = useState(false);
  const [smartPromptRewritingEnabled, setSmartPromptRewritingEnabled] = useState(() => readStoredBoolean("skai.smartPromptRewriting", false));
  const [imageEndpoint, setImageEndpoint] = useState(localEndpointOrFallback(localStorage.getItem("skai.imageEndpoint"), "http://127.0.0.1:8188"));
  const [imageProvider, setImageProvider] = useState(() => localStorage.getItem("skai.imageProvider") === "comfyui" ? "comfyui" : "diffusers");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageWorkflow, setImageWorkflow] = useState(localStorage.getItem("skai.imageWorkflow") ?? "");
  const [threeDWorkflow, setThreeDWorkflow] = useState(localStorage.getItem("skai.threeDWorkflow") ?? "");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageCancelRequested, setImageCancelRequested] = useState(false);
  const [imageProgress, setImageProgress] = useState<string[]>([]);
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
    if (connection !== "ready") return;
    void request("persona.list").then((response) => {
      if (!response.ok) return;
      const result = response.result as { personas?: DesktopPersona[] };
      setPersonas(result.personas ?? []);
    });
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
    if (nextRoute === "personas") navigatePersonaWorkshop("library");
    else if (nextRoute === "persona-groups") navigatePersonaWorkshop("groups");
    else if (nextRoute === "persona-workshop") navigatePersonaWorkshop("library", null, null, route === "persona-workshop");
    else navigate(nextRoute);
  }, [route]);
  const goBack = useCallback(() => { if (navigation.index > 0) window.history.back(); }, [navigation.index]);
  const goForward = useCallback(() => { if (navigation.index < navigation.length - 1) window.history.forward(); }, [navigation.index, navigation.length]);
  const coding = useCodingWorkspace({ request, connection, onError: setError, onNavigate });
  const chat = useChatWorkspace({ request, connection, provider, endpoint, model, modelMetadata: models.find((entry) => entry.model === model), mode: agentMode, project: route === "coding" ? coding.selectedProject : null, onConversationModelRestore: (savedModel, savedProvider) => { if (savedModel) setModel(savedModel); if (savedProvider) setProvider(localProviderOrFallback(savedProvider)); }, onError: setError });
  const workspaceSession = useWorkspaceSessionTabs({ chat, coding, route, connection, onNavigate, agentMode, setAgentModeState, setModel, setProvider, setEndpoint, setError });
  const { workspaceTabs, activeWorkspaceTabId, canRestoreWorkspaceTab, openNewWorkspaceTab, openNewProjectThread, openSideChat, sideChatRequest, startNewChat, selectConversation, selectWorkspaceTab, closeWorkspaceTab, closeWorkspaceTabs, reorderWorkspaceTab, restoreWorkspaceTab, openProjectTab } = workspaceSession;
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  const resizeSidebar = useCallback((width: number) => setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))), []);
  const setAgentMode = useCallback((mode: "ChatBot" | "Coding Agent") => {
    if (mode === agentMode) return;
    try {
      const preferred = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}");
      const choice = preferred?.[mode === "Coding Agent" ? "coding" : "chat"] as { model?: string; provider?: string; endpoint?: string | null } | undefined;
      if (choice?.model) {
        setModel(choice.model);
        if (choice.provider) setProvider(localProviderOrFallback(choice.provider));
        if (choice.endpoint && isLocalEndpoint(choice.endpoint)) setEndpoint(choice.endpoint);
      }
    } catch { /* keep the current model when task preferences are unavailable */ }
    setAgentModeState(mode);
    localStorage.setItem("skai.agentMode", mode);
    const matchingConversation = chat.conversations.find((conversation) => (conversation.mode ?? "ChatBot") === mode);
    if (matchingConversation) chat.selectConversation(matchingConversation.id);
    else { chat.startNewChat(); chat.setResponseMode(mode === "Coding Agent" ? "coding" : "think"); }
    onNavigate("chat");
  }, [agentMode, chat, onNavigate]);

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
  useThemeEngine(request, themeMode);
  useEffect(() => { document.title = `${PRODUCT_DISPLAY_NAME} · ${route}`; document.documentElement.dataset.theme = themeMode; document.documentElement.dataset.accent = accentColor; document.documentElement.dataset.density = density; document.documentElement.dataset.backdrop = backdrop; document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false"; }, [route, themeMode, accentColor, density, backdrop, reduceMotion]);
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
  useEffect(() => { const onShortcut = (event: KeyboardEvent) => { const modifier = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase(); if (modifier && key === "k") { event.preventDefault(); openCommandPalette(); return; } if (event.key === "Escape") { closeCommandPalette(); return; } if (!modifier) return; if (key === "n") { event.preventDefault(); startNewChat(); return; } if (key === ",") { event.preventDefault(); onNavigate("settings"); return; } if (key === "1") { event.preventDefault(); onNavigate("chat"); return; } if (key === "2") { event.preventDefault(); onNavigate("coding"); return; } if (key === "3" || (event.shiftKey && key === "l")) { event.preventDefault(); onNavigate("terminal"); } }; window.addEventListener("keydown", onShortcut); return () => window.removeEventListener("keydown", onShortcut); }, [closeCommandPalette, openCommandPalette, onNavigate, startNewChat]);
  const retryConnection = useCallback(() => { setConnection("checking"); setError(null); void request("runtime.health").then((response: AgentResponse) => { if (!response.ok) { setConnection("error"); setError(response.error?.message ?? "Agent host unavailable."); return; } setHealth(response.result as RuntimeHealth); setConnection("ready"); }).catch((requestError: unknown) => { setConnection("error"); setError(requestError instanceof Error ? requestError.message : "Agent host unavailable."); }); }, [request]);
  useEffect(() => { retryConnection(); }, [retryConnection]);
  useEffect(() => {
    if (connection !== "ready" || modelInventoryLoadedRef.current) return;
    modelInventoryLoadedRef.current = true;
    void request("settings.get").then((settingsResponse: AgentResponse) => {
      if (!settingsResponse.ok) return null;
      const settings = settingsResponse.result as { endpoint?: string; provider?: string };
      const selectedEndpoint = settings.endpoint && isLocalEndpoint(settings.endpoint) ? settings.endpoint : endpoint;
      const selectedProvider = localProviderOrFallback(settings.provider ?? provider);
      if (!isLocalEndpoint(selectedEndpoint)) return null;
      return request("models.list", { provider: selectedProvider, endpoint: selectedEndpoint });
    }).then((response: AgentResponse | null) => {
      if (response?.ok) setModels((response.result as Model[]) ?? []);
    }).catch(() => { /* Model discovery remains available from Settings if the runtime is offline. */ });
  }, [connection, endpoint, provider, request]);
  useEffect(() => { if (connection !== "ready") return; void request("settings.get").then((settingsResponse) => { if (settingsResponse.ok) { const settings = settingsResponse.result as { endpoint?: string; model?: string; provider?: string; comfyEndpoint?: string; imageWorkflow?: string; threeDWorkflow?: string; subagentModel?: string; subagentModelProvider?: string; subagentModelSizeBytes?: number | null; subagentModelContextLength?: number | null; ollamaContextWindowTokens?: number; localRamBudgetBytes?: number; localGpuBudgetBytes?: number; themeMode?: string; accentColor?: string; interfaceDensity?: string; backdropPreset?: string; reduceMotion?: boolean; developerMode?: boolean; memoryInjectionEnabled?: boolean; smartPromptRewritingEnabled?: boolean }; if (settings.endpoint && isLocalEndpoint(settings.endpoint)) setEndpoint(settings.endpoint); else if (settings.endpoint) setError(LOCAL_ENDPOINT_ERROR); if (settings.model) setModel(settings.model); if (settings.provider) setProvider(localProviderOrFallback(settings.provider)); if (settings.comfyEndpoint && isLocalEndpoint(settings.comfyEndpoint)) { setImageEndpoint(settings.comfyEndpoint); localStorage.setItem("skai.imageEndpoint", settings.comfyEndpoint); } else if (settings.comfyEndpoint) setError(LOCAL_ENDPOINT_ERROR); if (typeof settings.imageWorkflow === "string" && (settings.imageWorkflow.length > 0 || !localStorage.getItem("skai.imageWorkflow"))) { setImageWorkflow(settings.imageWorkflow); localStorage.setItem("skai.imageWorkflow", settings.imageWorkflow); } if (typeof settings.threeDWorkflow === "string" && (settings.threeDWorkflow.length > 0 || !localStorage.getItem("skai.threeDWorkflow"))) { setThreeDWorkflow(settings.threeDWorkflow); localStorage.setItem("skai.threeDWorkflow", settings.threeDWorkflow); } setSubagentModel(settings.subagentModel ?? ""); setSubagentModelProvider(settings.subagentModelProvider ?? ""); setSubagentModelSizeBytes(settings.subagentModelSizeBytes ?? null); setSubagentModelContextLength(settings.subagentModelContextLength ?? null); if ([0, 32768, 131072, 1048576].includes(settings.ollamaContextWindowTokens ?? 0)) setOllamaContextWindowTokens(settings.ollamaContextWindowTokens ?? 0); if (Number.isFinite(settings.localRamBudgetBytes) && (settings.localRamBudgetBytes ?? 0) >= 0) setLocalRamBudgetBytes(settings.localRamBudgetBytes ?? 0); if (Number.isFinite(settings.localGpuBudgetBytes) && (settings.localGpuBudgetBytes ?? 0) >= 0) setLocalGpuBudgetBytes(settings.localGpuBudgetBytes ?? 0); if (settings.themeMode === "light" || settings.themeMode === "dark" || settings.themeMode === "system") setThemeMode(settings.themeMode); if (settings.accentColor) setAccentColor(settings.accentColor); if (settings.interfaceDensity) setDensity(settings.interfaceDensity); if (settings.backdropPreset) setBackdrop(settings.backdropPreset); if (typeof settings.reduceMotion === "boolean") setReduceMotion(settings.reduceMotion); if (typeof settings.developerMode === "boolean") setDeveloperMode(settings.developerMode); if (typeof settings.memoryInjectionEnabled === "boolean") setMemoryInjectionEnabled(settings.memoryInjectionEnabled); if (typeof settings.smartPromptRewritingEnabled === "boolean") { setSmartPromptRewritingEnabled(settings.smartPromptRewritingEnabled); localStorage.setItem("skai.smartPromptRewriting", String(settings.smartPromptRewritingEnabled)); } } else setError(settingsResponse.error?.message ?? "Workspace settings could not be loaded."); }).catch(() => setError("Workspace settings could not be loaded.")); }, [connection, request]);
  const loadTaskState = useCallback(async (showLoading = true) => { if (showLoading) setTasksLoading(true); setTasksError(null); try { const [taskResponse, scheduleResponse] = await Promise.all([request("tasks.list"), request("scheduled.list")]); if (!taskResponse.ok) throw new Error(taskResponse.error?.message ?? "Agent tasks could not be loaded."); if (!scheduleResponse.ok) throw new Error(scheduleResponse.error?.message ?? "Scheduled runs could not be loaded."); setTasks((taskResponse.result as DesktopTask[]) ?? []); setScheduledTasks((scheduleResponse.result as DesktopScheduledTask[]) ?? []); } catch (loadError) { setTasksError(loadError instanceof Error ? loadError.message : "Task state could not be loaded."); } finally { if (showLoading) setTasksLoading(false); } }, [request]);
  // Compatibility alias for the existing route action; the user-facing destination is gone.
  const loadWorkbench = loadTaskState;
  useEffect(() => { if (connection !== "ready") return; void loadTaskState(); }, [connection, loadTaskState]);
  useEffect(() => {
    if (connection !== "ready") return;
    const refresh = () => { void request("tasks.list").then((response) => { if (response.ok) setTasks((response.result as DesktopTask[]) ?? []); }); };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => window.clearInterval(interval);
  }, [connection, request]);
  useEffect(() => { if (connection !== "ready" || route !== "memory") return; setMemoryLoading(true); setCorpusLoading(true); setMemoryError(null); setCorpusError(null); void Promise.all([request("memory.list"), request("corpus.list")]).then(([memoryResponse, corpusResponse]) => { if (!memoryResponse.ok) setMemoryError(memoryResponse.error?.message ?? "Memory could not be loaded."); else setMemoryEntries((memoryResponse.result as MemoryEntry[]) ?? []); if (!corpusResponse.ok) setCorpusError(corpusResponse.error?.message ?? "Document corpus could not be loaded."); else setCorpusDocuments((corpusResponse.result as CorpusDocument[]) ?? []); }).catch(() => { setMemoryError("Memory could not be loaded."); setCorpusError("Document corpus could not be loaded."); }).finally(() => { setMemoryLoading(false); setCorpusLoading(false); }); }, [connection, route, request]);

  const transitionTask = async (id: string, operation: "queue" | "approve" | "deny" | "cancel" | "retry" | "release") => { setTaskBusy(id); const method = operation === "release" ? "tasks.worktree.release" : `tasks.${operation}`; const response = await request(method, { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Task could not be updated."); return; } await loadTaskState(); };
  const steerTask = async (id: string, instruction: string): Promise<boolean> => { const text = instruction.trim(); if (!text || text.length > 4_000) return false; setTaskBusy(id); const response = await request("tasks.steer", { id, instruction: text }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "The follow-up could not be added to this running task."); return false; } setError(null); await loadTaskState(); return true; };
  const delegateTask = async (parentId: string, workers: DesktopTaskWorkerDraft[]): Promise<boolean> => {
    const normalized = workers.map((worker) => ({ title: worker.title.trim(), instruction: worker.instruction.trim(), role: worker.role.trim() || "subagent" }));
    if (!parentId || normalized.length < 1 || normalized.length > 6 || normalized.some((worker) => !worker.title || worker.title.length > 180 || !worker.instruction || worker.instruction.length > 6_000 || worker.role.length > 80)) return false;
    setTaskBusy(parentId);
    const response = await request("tasks.delegate", { parentId, workers: normalized });
    setTaskBusy(null);
    if (!response.ok) { setError(response.error?.message ?? "Specialist tasks could not be created."); return false; }
    setError(null);
    await loadTaskState();
    return true;
  };
  const runProjectPreflight = async (projectId: string): Promise<DesktopProjectPreflight | null> => { const response = await request("project.preflight", { id: projectId }); if (!response.ok) { setError(response.error?.message ?? "Project preflight could not run."); return null; } setError(null); return response.result as DesktopProjectPreflight; };
  const executeTask = async (id: string) => { setTaskBusy(id); const response = await request("tasks.execute", { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "The local task could not be started."); return; } setError(null); await loadTaskState(); };
  const startSubagentTask = async (projectId: string, instruction: string): Promise<string | null> => {
    const project = coding.projects.find((item) => item.id === projectId);
    if (!project || !instruction.trim()) return null;
    setTaskBusy("planning");
    try {
      let preferredCoding: { model?: string; provider?: string } | undefined;
      try { preferredCoding = JSON.parse(localStorage.getItem("skai.preferredModels.v1") ?? "{}").coding; } catch { preferredCoding = undefined; }
      const selectedModel = preferredCoding?.model
        ? models.find((entry) => entry.model === preferredCoding?.model && entry.provider === preferredCoding?.provider)
        : models.find((entry) => entry.model === model);
      const planned = await request("tasks.plan", {
        title: `Side chat · ${instruction.trim().slice(0, 160)}`,
        instruction: project.instructions ? `${instruction.trim()}\n\nProject instructions:\n${project.instructions}` : instruction.trim(),
        environment: "local",
        projectId,
        conversationId: null,
        responseMode: "coding",
        model: selectedModel?.model ?? model,
        modelProvider: selectedModel?.provider ?? provider,
        ...(typeof selectedModel?.sizeBytes === "number" ? { modelSizeBytes: selectedModel.sizeBytes } : {}),
        ...(typeof selectedModel?.contextLength === "number" ? { modelContextLength: selectedModel.contextLength } : {}),
        airLlmCompatible: (selectedModel?.provider ?? provider).toLowerCase() === "airllm" || (selectedModel?.model ?? model).includes("/"),
        requiresApproval: false,
      });
      if (!planned.ok) throw new Error(planned.error?.message ?? "The side chat task could not be planned.");
      const taskId = (planned.result as { id?: string }).id;
      if (!taskId) throw new Error("The side chat task did not return an ID.");
      const queued = await request("tasks.queue", { id: taskId });
      if (!queued.ok) throw new Error(queued.error?.message ?? "The side chat task could not be queued.");
      const started = await request("tasks.execute", { id: taskId });
      if (!started.ok) throw new Error(started.error?.message ?? "The side chat task could not start.");
      setError(null);
      await loadTaskState();
      return taskId;
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "The side chat task could not start.");
      return null;
    } finally {
      setTaskBusy(null);
    }
  };
  const scheduleTask = async (draft: ScheduledTaskDraft) => { setTaskBusy("schedule"); const response = await request("scheduled.create", draft as unknown as Record<string, unknown>); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Scheduled task could not be created."); return false; } await loadTaskState(); setError(null); return true; };
  const transitionScheduledTask = async (id: string, operation: "pause" | "resume" | "cancel" | "runNow") => { setTaskBusy(id); const response = await request(`scheduled.${operation}`, { id }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Scheduled task could not be updated."); return false; } await loadTaskState(); return true; };
  const planTask = async (title: string, instruction: string, environment: TaskEnvironment, conversationId?: string | null, requiresApproval = true, projectId?: string | null) => { setTaskBusy("planning"); const response = await request("tasks.plan", { title, instruction, environment, conversationId: conversationId ?? null, projectId: projectId ?? null, requiresApproval }); setTaskBusy(null); if (!response.ok) { setError(response.error?.message ?? "Task could not be planned."); return false; } setError(null); await loadTaskState(false); return true; };
  const loadMemory = async (query?: string) => { setMemoryLoading(true); setMemoryError(null); try { const response = await request(query?.trim() ? "memory.search" : "memory.list", query?.trim() ? { query: query.trim() } : undefined); if (!response.ok) throw new Error(response.error?.message ?? "Memory could not be loaded."); setMemoryEntries((response.result as MemoryEntry[]) ?? []); } catch (loadError) { setMemoryError(loadError instanceof Error ? loadError.message : "Memory could not be loaded."); } finally { setMemoryLoading(false); } };
  const saveMemory = async (content: string, scope: string, tags: string, id?: string) => { setMemoryBusy(true); const response = await request("memory.save", { ...(id ? { id } : {}), content, scope, source: "user", approvalId: `electron-${Date.now()}`, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); setMemoryBusy(false); if (!response.ok) { setError(response.error?.message ?? "Memory could not be saved."); return false; } await loadMemory(); return true; };
  const toggleMemory = async (entry: MemoryEntry) => { setMemoryBusy(true); const response = await request("memory.enabled", { id: entry.id, enabled: !entry.enabled }); setMemoryBusy(false); if (!response.ok) setError(response.error?.message ?? "Memory state could not be changed."); else await loadMemory(); };
  const removeMemory = async (entry: MemoryEntry) => { setMemoryBusy(true); const response = await request("memory.remove", { id: entry.id }); setMemoryBusy(false); if (!response.ok) { setError(response.error?.message ?? "Memory could not be removed."); return false; } await loadMemory(); return true; };
  const exportMemory = async () => { const response = await request("memory.export"); if (!response.ok) { setError(response.error?.message ?? "Memory export failed."); return; } const result = response.result as { fileName: string; json: string }; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([result.json], { type: "application/json" })); link.download = result.fileName; link.click(); URL.revokeObjectURL(link.href); };
  const loadCorpus = async (query?: string) => { setCorpusLoading(true); setCorpusError(null); try { const response = await request(query?.trim() ? "corpus.search" : "corpus.list", query?.trim() ? { query: query.trim() } : undefined); if (!response.ok) throw new Error(response.error?.message ?? "Document corpus could not be loaded."); const result = response.result as Array<CorpusDocument | { document: CorpusDocument }>; setCorpusDocuments(result.map((item) => "document" in item ? item.document : item)); } catch (loadError) { setCorpusError(loadError instanceof Error ? loadError.message : "Document corpus could not be loaded."); } finally { setCorpusLoading(false); } };
  const saveCorpus = async (title: string, source: string, content: string, tags: string, id?: string) => { setCorpusLoading(true); setCorpusError(null); try { const response = await request("corpus.upsert", { ...(id ? { id } : {}), title, source, content, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) }); if (!response.ok) throw new Error(response.error?.message ?? "Document could not be added to the local corpus."); await loadCorpus(); return true; } catch (saveError) { setCorpusError(saveError instanceof Error ? saveError.message : "Document could not be added to the local corpus."); return false; } finally { setCorpusLoading(false); } };
  const removeCorpus = async (document: CorpusDocument) => { setCorpusLoading(true); setCorpusError(null); try { const response = await request("corpus.remove", { id: document.id }); if (!response.ok) throw new Error(response.error?.message ?? "Document could not be removed from the local corpus."); await loadCorpus(); return true; } catch (removeError) { setCorpusError(removeError instanceof Error ? removeError.message : "Document could not be removed from the local corpus."); return false; } finally { setCorpusLoading(false); } };
  const importCorpus = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) { setCorpusError(response.error?.message ?? "Local files could not be selected."); return; } const attachments = (response.result as { attachments?: Array<{ fileName: string; mediaType?: string | null; content: string }> }).attachments ?? []; if (!attachments.length) return; setCorpusLoading(true); setCorpusError(null); try { for (const attachment of attachments) { if (attachment.mediaType?.startsWith("image/")) throw new Error(`${attachment.fileName}: OCR is not available in the local corpus yet; add extracted text instead.`); let content = attachment.content; if (attachment.fileName.toLowerCase().endsWith(".pdf")) { const extracted = await request("workspace.attachment.extract", { fileName: attachment.fileName, content }); if (!extracted.ok) throw new Error(extracted.error?.message ?? `Could not extract ${attachment.fileName}.`); content = (extracted.result as { content?: string }).content ?? ""; } await request("corpus.upsert", { title: attachment.fileName, source: attachment.fileName, content, tags: [attachment.fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "imported"] }); } await loadCorpus(); } catch (importError) { setCorpusError(importError instanceof Error ? importError.message : "Local files could not be imported."); } finally { setCorpusLoading(false); } };
  const discoverModels = async (): Promise<boolean> => { if (!isLocalEndpoint(endpoint)) { setError(LOCAL_ENDPOINT_ERROR); return false; } const response = await request("models.list", { provider, endpoint }); if (!response.ok) { setError(response.error?.message ?? "Model discovery failed."); return false; } setModels((response.result as Model[]) ?? []); setError(null); return true; };
  const activeModelPullId = useRef<string | null>(null);
  const pullModel = async (modelId: string, onProgress: (message: string) => void): Promise<boolean> => { if (!isLocalEndpoint(endpoint) || provider !== "Ollama") { setError("Model downloads are currently available only through a local Ollama endpoint."); return false; } const started = await request("models.pull.start", { endpoint, model: modelId }); if (!started.ok) { setError(started.error?.message ?? "Local model download could not start."); return false; } const operationId = (started.result as { id?: string }).id; if (!operationId) { setError("Local model download did not return an operation ID."); return false; } activeModelPullId.current = operationId; for (let attempt = 0; attempt < 600; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 500)); const status = await request("models.pull.status", { id: operationId }); if (!status.ok) { setError(status.error?.message ?? "Local model download status was unavailable."); activeModelPullId.current = null; return false; } const result = status.result as { status: string; progress?: string[]; error?: string }; for (const message of result.progress ?? []) onProgress(message); if (result.status === "completed") { setError(null); activeModelPullId.current = null; return true; } if (result.status === "failed" || result.status === "cancelled") { setError(result.error ?? "Local model download did not complete."); activeModelPullId.current = null; return false; } } setError("Local model download timed out; the local operation may still be running."); return false; };
  const cancelModelPull = async (): Promise<boolean> => { const id = activeModelPullId.current; if (!id) return false; const response = await request("models.pull.cancel", { id }); if (!response.ok) { setError(response.error?.message ?? "Local model cancellation failed."); return false; } setError(null); return true; };
  const compareModel = async (selectedModel: Model, prompt: string): Promise<string> => {
    const selectedProvider = selectedModel.provider === "AirLLM" ? "AirLLM" : selectedModel.provider === "LM Studio" ? "LM Studio" : selectedModel.provider === "Ollama" ? "Ollama" : "Local API";
    const selectedEndpoint = selectedModel.endpoint || endpoint;
    if (!isLocalEndpoint(selectedEndpoint)) throw new Error(LOCAL_ENDPOINT_ERROR);
    const response = await request("chat.complete", { provider: selectedProvider, endpoint: selectedEndpoint, model: selectedModel.model, modelContextLength: selectedModel.contextLength ?? null, messages: [{ role: "user", content: prompt }], responseMode: "think", maxTokens: 1200 });
    if (!response.ok) throw new Error(response.error?.message ?? `${selectedModel.model} could not complete the comparison.`);
    const content = (response.result as { content?: unknown } | undefined)?.content;
    if (typeof content !== "string") throw new Error(`${selectedModel.model} returned an invalid response.`);
    return content;
  };
  const saveSettings = async () => { const selectedProvider = localProviderOrFallback(provider); if (!isLocalEndpoint(endpoint) || !isLocalEndpoint(imageEndpoint)) { setError(LOCAL_ENDPOINT_ERROR); return false; } const response = await request("settings.save", { provider: selectedProvider, endpoint, model, comfyEndpoint: imageEndpoint, imageWorkflow, threeDWorkflow, subagentModel, subagentModelProvider, subagentModelSizeBytes, subagentModelContextLength, ollamaContextWindowTokens, localRamBudgetBytes, localGpuBudgetBytes, themeMode, accentColor, interfaceDensity: density, backdropPreset: backdrop, reduceMotion, developerMode, memoryInjectionEnabled, smartPromptRewritingEnabled }); if (!response.ok) { setError(response.error?.message ?? "Workspace settings could not be saved."); return false; } setProvider(selectedProvider); localStorage.setItem("skai.provider", selectedProvider); localStorage.setItem("skai.endpoint", endpoint); localStorage.setItem("skai.model", model); localStorage.setItem("skai.themeMode", themeMode); localStorage.setItem("skai.accentColor", accentColor); localStorage.setItem("skai.density", density); localStorage.setItem("skai.backdrop", backdrop); localStorage.setItem("skai.reduceMotion", String(reduceMotion)); localStorage.setItem("skai.smartPromptRewriting", String(smartPromptRewritingEnabled)); localStorage.setItem("skai.imageEndpoint", imageEndpoint); localStorage.setItem("skai.imageWorkflow", imageWorkflow); localStorage.setItem("skai.threeDWorkflow", threeDWorkflow); localStorage.setItem("skai.imageProvider", imageProvider); setError(null); return true; };
  const activeImageGenerationId = useRef<string | null>(null);
  const generateImage = async (source?: import("../../shared/contracts").ChatAttachment, options?: { provider: "comfyui" | "diffusers"; prompt: string }) => {
    const generationProvider = options?.provider ?? imageProvider;
    const generationPrompt = options?.prompt ?? imagePrompt;
    if (generationProvider === "comfyui" && !isLocalEndpoint(imageEndpoint)) { setError(LOCAL_ENDPOINT_ERROR); return; }
    setImageBusy(true);
    setImageCancelRequested(false);
    setImageProgress([]);
    setError(null);
    localStorage.setItem("skai.imageEndpoint", imageEndpoint);
    localStorage.setItem("skai.imageProvider", generationProvider);
    localStorage.setItem("skai.imageWorkflow", imageWorkflow);
    try {
      const started = await request("image.generate.start", { provider: generationProvider, ...(generationProvider === "comfyui" ? { endpoint: imageEndpoint, workflow: imageWorkflow } : {}), ...(source ? { sourceImage: source.content, sourceImageMediaType: source.mediaType } : {}), prompt: generationPrompt });
      if (!started.ok) { setError(started.error?.message ?? "Image generation failed to start."); return; }
      const operationId = (started.result as { id?: string }).id;
      if (!operationId) { setError("Image generation did not return an operation ID."); return; }
      activeImageGenerationId.current = operationId;
      let result: { status: string; progress?: string[]; images?: Array<{ url: string; fileName: string; mediaType?: "image" | "video" | "audio" }>; error?: string } = { status: "running" };
      while (result.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const status = await request("image.generate.status", { id: operationId });
        if (!status.ok) { setError(status.error?.message ?? "Image generation status was unavailable."); return; }
        result = status.result as typeof result;
        setImageProgress(result.progress ?? []);
      }
      if (result.status === "cancelled") { setError("Image generation cancelled."); return; }
      if (result.status === "failed") { setError(result.error ?? "Image generation failed."); return; }
      if (result.status !== "completed") { setError("Image generation ended without a completed result."); return; }
      const createdAt = new Date().toISOString();
      const imageSource = generationProvider === "comfyui" ? "comfyui" : "diffusers";
      const images: ImageHistoryEntry[] = (result.images ?? []).map((image) => ({ ...image, mediaType: image.mediaType ?? "image", createdAt, provider: imageSource, prompt: generationPrompt.trim() }));
      setGeneratedImages((current) => [...images, ...current].slice(0, 24));
      void saveImageHistory(images);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      activeImageGenerationId.current = null;
      setImageBusy(false);
      setImageCancelRequested(false);
    }
  };
  const cancelImageGeneration = async (): Promise<boolean> => {
    const id = activeImageGenerationId.current;
    if (!id) return false;
    const response = await request("image.generate.cancel", { id });
    if (!response.ok) { setError(response.error?.message ?? "Image generation cancellation failed."); return false; }
    setImageCancelRequested(true);
    setError(null);
    return true;
  };
  const pickImageSource = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) throw new Error(response.error?.message ?? "Image selection failed."); const attachments = (response.result as { attachments?: import("../../shared/contracts").ChatAttachment[] }).attachments ?? []; const source = attachments.find((item) => item.mediaType === "image/png" || item.mediaType === "image/jpeg"); if (!source) return null; return source; };
  const importImageWorkflow = async () => { const response = await request("workspace.pickFiles"); if (!response.ok) throw new Error(response.error?.message ?? "A local workflow file could not be selected."); const attachments = (response.result as { attachments?: Array<{ fileName: string; content: string }> }).attachments ?? []; const workflowFile = attachments.find((attachment) => /\.(json|json5)$/i.test(attachment.fileName)); if (!workflowFile) throw new Error("Choose a ComfyUI API workflow file (.json or .json5)."); let parsed: unknown; try { parsed = JSON.parse(workflowFile.content); } catch { throw new Error("The selected workflow is not valid JSON."); } if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The selected workflow must be a JSON object."); return { name: workflowFile.fileName.replace(/\.(json|json5)$/i, ""), workflow: JSON.stringify(parsed, null, 2) }; };
  const routeState: AppRouteState = { route: route === "settings" ? settingsReturnRoute : route, workspaceTabId: activeWorkspaceTabId, sideChatRequest, conversations: chat.conversations, provider, model, subagentModel, subagentModelProvider, subagentModelSizeBytes, subagentModelContextLength, responseMode: chat.responseMode, capacity, models, ollamaContextWindowTokens, localRamBudgetBytes, localGpuBudgetBytes, endpoint, messages: chat.messages, busy: chat.busy, attachments: chat.attachments, queuedMessages: chat.queuedMessages, conversationId: chat.conversationId, conversationTitle: chat.activeConversation?.title ?? "New chat", pinned: chat.activeConversation?.pinned ?? false, archived: chat.activeConversation?.archived ?? false, projects: coding.projects, selectedProject: coding.selectedProject, projectFiles: coding.projectFiles, selectedFile: coding.selectedFile, filePreview: coding.filePreview, filePreviewError: coding.filePreviewError, fileDraft: coding.fileDraft, fileOriginal: coding.fileOriginal, fileSummary: coding.fileSummary, fileBusy: coding.fileBusy, fileUndoAvailable: coding.fileUndoAvailable, terminalBusy: coding.terminalBusy, terminalOutput: coding.terminalOutput, terminalExitCode: coding.terminalExitCode, gitStatus: coding.gitStatus, gitBusy: coding.gitBusy, gitDiff: coding.gitDiff, gitDiffBusy: coding.gitDiffBusy, gitCommitBusy: coding.gitCommitBusy, gitPullRequestBusy: coding.gitPullRequestBusy, projectChecks: coding.projectChecks, projectChecksBusy: coding.projectChecksBusy, projectCheckBusy: coding.projectCheckBusy, themeMode, accentColor, density, backdrop, reduceMotion, petVisible, petWander, petInteractionDemo, petCharacter, petSpriteDataUrl, developerMode, memoryInjectionEnabled, smartPromptRewritingEnabled, imageProvider, imageEndpoint, imagePrompt, imageWorkflow, imageBusy, imageCancelRequested, imageProgress, generatedImages, tasks, scheduledTasks, taskBusy, tasksLoading, tasksError, memoryEntries, memoryBusy, memoryLoading, memoryError, corpusDocuments, corpusLoading, corpusError };
  routeState.threeDWorkflow = threeDWorkflow;
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
  };  const routeActions: AppRouteActions = { onNavigate, onSelectProject: (project) => void coding.selectProject(project, false), onSelectConversation: selectConversation, onNewWorkspaceTab: openNewWorkspaceTab, onNewProjectThread: openNewProjectThread, onStartSubagent: startSubagentTask, onDelegateTask: delegateTask, onSend: chat.sendMessage, onRewritePrompt: chat.rewritePrompt, onStartTemporaryChat: chat.startNewChat, onQueue: chat.queueMessage, onRemoveQueued: chat.removeQueuedMessage, onAttach: chat.pickAttachments, onFilesDropped: chat.importDroppedFiles, onRemoveAttachment: (index) => chat.setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index)), onSetAttachments: (attachments) => chat.setAttachments(attachments), onModelChange: selectModel, onCompareModel: compareModel, onResponseModeChange: chat.setResponseMode, onProviderChange: (nextProvider) => { const selectedProvider = localProviderOrFallback(nextProvider); setProvider(selectedProvider); localStorage.setItem("skai.provider", selectedProvider); if (!isLocalEndpoint(endpoint)) setEndpoint(defaultEndpoint); }, onExportConversations: chat.exportConversations, onPreviewConversationImport: chat.previewConversationImport, onApplyConversationImport: chat.applyConversationImport, onFork: () => void chat.forkConversation(), onForkFromMessage: (index) => void chat.forkConversation(index), onRetryMessage: (index) => void chat.retryMessage(index), onEditMessage: chat.editMessage, onTogglePinned: () => void chat.updateConversationMetadata({ pinned: !(chat.activeConversation?.pinned ?? false) }), onArchive: () => void chat.updateConversationMetadata({ archived: !(chat.activeConversation?.archived ?? false) }), onRenameConversation: (title) => chat.updateConversationMetadata({ title }), onPickFolder: coding.pickProjectFolder, onSaveProject: coding.saveProject, onOpenProject: openProjectTab, onOpenFile: (path) => void coding.openProjectFile(path), onCloseFile: () => void coding.closeProjectFile(), onDraftChange: coding.setFileDraft, onSaveFile: () => void coding.saveProjectFile(), onUndoFile: () => void coding.undoProjectFile(), onRunTerminal: (projectId, command, cwd) => void coding.runTerminal(projectId, command, cwd), onRefreshGitStatus: () => void coding.refreshGitStatus(), onLoadGitDiff: (paths) => void coding.loadGitDiff(paths), onCommitGitChanges: coding.commitGitChanges, onPlanTask: planTask, onTaskAction: (id, operation) => void transitionTask(id, operation), onSettingsChange: (key, value) => { if (key === "themeMode") setThemeMode(value as ThemeMode); if (key === "accentColor") setAccentColor(String(value)); if (key === "density") setDensity(String(value)); if (key === "backdrop") setBackdrop(String(value)); if (key === "reduceMotion") setReduceMotion(Boolean(value)); if (key === "petVisible") setPetVisible(Boolean(value)); if (key === "petWander") setPetWander(Boolean(value)); if (key === "petInteractionDemo") setPetInteractionDemo(Boolean(value)); if (key === "petSpriteDataUrl") { setPetSpriteDataUrl(String(value)); localStorage.setItem("skai.pet.sprite", String(value)); } if (key === "developerMode") setDeveloperMode(Boolean(value)); if (key === "memoryInjectionEnabled") setMemoryInjectionEnabled(Boolean(value)); if (key === "smartPromptRewritingEnabled") setSmartPromptRewritingEnabled(Boolean(value)); if (key === "provider") setProvider(localProviderOrFallback(String(value))); if (key === "model") setModel(String(value)); if (key === "endpoint") { setEndpoint(String(value)); localStorage.setItem("skai.endpoint", String(value)); } if (key === "ollamaContextWindowTokens") { const parsed = Number(value); if ([0, 32768, 131072, 1048576].includes(parsed)) setOllamaContextWindowTokens(parsed); } if (key === "localRamBudgetBytes") { const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) setLocalRamBudgetBytes(parsed); } if (key === "localGpuBudgetBytes") { const parsed = Number(value); if (Number.isFinite(parsed) && parsed >= 0) setLocalGpuBudgetBytes(parsed); } }, onSaveSettings: saveSettings, onDiscoverModels: () => void discoverModels(), onPullModel: pullModel, onSelectModel: (nextModel) => { selectModel(nextModel); onNavigate("chat"); }, onImageChange: (key, value) => { if (key === "provider") { const next = value === "diffusers" ? "diffusers" : "comfyui"; setImageProvider(next); localStorage.setItem("skai.imageProvider", next); } if (key === "endpoint") setImageEndpoint(value); if (key === "prompt") setImagePrompt(value); if (key === "workflow") setImageWorkflow(value); }, onGenerateImage: (source, options) => void generateImage(source, options), onRetryWorkbench: () => void loadWorkbench(), onTransitionTask: (id, operation) => void transitionTask(id, operation), onSteerTask: steerTask, onExecuteTask: (id) => void executeTask(id), onScheduleTask: scheduleTask, onTransitionScheduledTask: transitionScheduledTask, onRetryMemory: () => void loadMemory(), onSearchMemory: (query) => void loadMemory(query), onSaveMemory: saveMemory, onToggleMemory: (entry) => void toggleMemory(entry), onRemoveMemory: removeMemory, onExportMemory: () => void exportMemory(), onRunProjectCommand: (projectId, command, cwd) => void coding.runTerminal(projectId, command, cwd), onRunProjectPreflight: runProjectPreflight };

  const onImageChange = routeActions.onImageChange;
  routeActions.onImageChange = (key, value) => { onImageChange(key, value); if (key === "threeDWorkflow") setThreeDWorkflow(value); };
  routeState.personas = personas;
  routeActions.onImportCorpus = () => void importCorpus();
  routeActions.onSearchCorpus = (query) => void loadCorpus(query);
  routeActions.onSaveCorpus = saveCorpus;
  routeActions.onRemoveCorpus = removeCorpus;
  routeActions.onPickImageSource = pickImageSource;
  routeActions.onCancelModelPull = cancelModelPull;
  routeActions.onPushGitChanges = coding.pushGitChanges;
  routeActions.onCreateGitPullRequest = coding.createGitPullRequest;
  routeActions.onLoadProjectChecks = coding.loadProjectChecks;
  routeActions.onRunProjectCheck = async (projectId, taskId, checkId) => { const result = await coding.runProjectCheck(projectId, taskId, checkId); await loadTaskState(false); return result; };
  routeActions.onStartTerminalSession = coding.startTerminalSession;
  routeActions.onWriteTerminalSession = coding.writeTerminalSession;
  routeActions.onRefreshTerminalSession = coding.refreshTerminalSession;
  routeActions.onCloseTerminalSession = coding.closeTerminalSession;
  routeActions.onDiscoverModels = discoverModels;
  routeActions.onImportWorkflow = importImageWorkflow;
  routeActions.onCancelImageGeneration = cancelImageGeneration;
  return { routeState, routeActions, route, settingsReturnRoute, workspaceTabs, activeWorkspaceTabId, canRestoreWorkspaceTab, openNewWorkspaceTab, openNewProjectThread, openSideChat, sideChatRequest, selectWorkspaceTab, closeWorkspaceTab, closeWorkspaceTabs, reorderWorkspaceTab, restoreWorkspaceTab, connection, health, error, dismissError, retryConnection, conversations: chat.conversations, agentMode, setAgentMode, conversationQuery, setConversationQuery, sidebarWidth, resizeSidebar, commandOpen, openCommandPalette, closeCommandPalette, startNewChat, selectConversation, updateConversationMetadata: (id, patch) => chat.updateConversationMetadata(patch, id), onNavigate, canGoBack: navigation.index > 0, canGoForward: navigation.index < navigation.length - 1, goBack, goForward, petVisible, petWander, petInteractionDemo, setPetVisible, setPetWander };
}
