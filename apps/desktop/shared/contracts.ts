export const AGENT_PROTOCOL_VERSION = 1 as const;

export type AgentRequest = {
  v: typeof AGENT_PROTOCOL_VERSION;
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type AgentResponse = {
  v: typeof AGENT_PROTOCOL_VERSION;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
};

export type RuntimeHealth = {
  service: "agent-host";
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  status: "ready";
  capabilities: string[];
};

export type DesktopHarnessAdapter = {
  contractVersion: number;
  id: string;
  name: string;
  description: string;
  status: "ready" | "detected-not-connected" | "not-installed";
  available: boolean;
  executionSupported: boolean;
  executablePath?: string | null;
  capabilities: string[];
  nativeCapabilities: string[];
  prerequisites: string[];
  ownsSessionFormat: boolean;
  taskJournal: string;
  healthNote: string;
  authenticationStatus: "not-applicable" | "unknown";
};

export type LocalCapacitySnapshot = {
  capturedAtUtc: string;
  ramTotalBytes: number | null;
  ramAvailableBytes: number | null;
  cpuUtilizationPercent: number | null;
  gpu: { name: string; totalBytes: number | null; availableBytes: number | null; utilizationPercent: number | null } | null;
  measurementNote: string | null;
  scheduler?: {
    activeTaskCount: number;
    queuedTaskCount: number;
    executionSlotLimit: number;
    limitingResource?: string;
    estimatedRamPerTaskBytes?: number | null;
    effectiveAvailableRamBytes?: number | null;
    effectiveAvailableGpuBytes?: number | null;
    estimateBasis?: string;
    queuePolicy?: string;
  };
  runtime?: {
    loadedModelsKnown: boolean;
    loadedModels: Array<{ runtime: string; model: string; ramBytes: number | null; gpuBytes: number | null }>;
    loadedRamBytes: number;
    loadedGpuBytes: number;
    loadedModelNote: string | null;
    airLlmReady: boolean | null;
  };
};

export type DesktopProject = {
  id: string;
  name: string;
  instructions: string;
  folderPaths: string[];
  gitHubRepository?: string | null;
  updatedAt: string;
};

export type DesktopProjectPreflight = {
  projectId: string;
  projectName: string;
  inspectedAt: string;
  manifests: string[];
  runtimes: Array<{ name: string; required: boolean; available: boolean }>;
  suggestedChecks: string[];
  executionNote: string;
};

export type DesktopProjectFile = {
  relativePath: string;
  bytes: number;
  kind?: "text" | "image" | "pdf" | "svg";
};

export type DesktopProjectPreview = {
  relativePath: string;
  kind: "image" | "pdf" | "svg";
  mediaType: string | null;
  content: string;
};

export type DesktopGitChange = {
  status: string;
  requiresApproval?: boolean;
  path: string;
  originalPath?: string | null;
};

export type DesktopGitStatus = {
  branch: string;
  repository: string;
  commitsAhead: number;
  commitsBehind: number;
  hasConflicts: boolean;
  changes: DesktopGitChange[];
};

export type DesktopGitDiff = {
  repository: string;
  text: string;
  includedFiles: number;
  redactedFiles: number;
  truncated: boolean;
};

export type DesktopPullRequestDraft = {
  title: string;
  body: string;
};

export type DesktopConversation = {
  id: string;
  title: string;
  mode?: "ChatBot" | "Coding Agent";
  responseMode?: "think" | "coding" | "security";
  model?: string | null;
  modelProvider?: string | null;
  modelSizeBytes?: number | null;
  modelContextLength?: number | null;
  personaId?: string | null;
  personaName?: string | null;
  personaSourceMode?: string | null;
  personaIds?: string[];
  isPersonaGroup?: boolean;
  airLlmCompatible?: boolean;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; attachments?: ChatAttachment[] }>;
  projectId?: string | null;
  projectName?: string | null;
  includeProjectFilesInChat?: boolean;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  tags: string[];
  folderName?: string | null;
};

export type DesktopPersonaSource = {
  title: string;
  url: string;
  authorOrPublisher: string;
  publishedDate: string;
  type: string;
  speakerAttribution?: string;
  attributedTurnCount?: number;
  evidenceQuality?: string;
  reliabilityNote: string;
  excerpt: string;
};

export type DesktopPersonaQuote = { text: string; sourceId: string; attribution: string };
export type DesktopPersonaResearchPass = { completedAtUtc: string; focus: string; sourcesAdded: number; summary: string };
export type DesktopPersonaDistillation = { updatedAtUtc: string; focus: string; sourceUrls: string[]; roles: string; speechPatterns: string; personality: string; thinkingStyle: string; interactionStyle: string; values: string; knowledge: string; evidenceBoundaries: string; timeline: string };
export type DesktopPersona = {
  id: string;
  name: string;
  sourceMode: "public-research" | "own-material";
  subjectType: "person" | "character";
  isPublicFigure: boolean;
  birthDate?: string | null;
  deathDate?: string | null;
  knowledgeCutoffDate?: string | null;
  eraDate?: string | null;
  roles: string;
  voiceProfileId: string;
  voice: string;
  personality: string;
  thinkingStyle: string;
  interactionStyle: string;
  values: string;
  knowledge: string;
  evidenceBoundaries: string;
  timeline: string;
  instructions: string;
  sourceMaterial: string;
  personalContinuityEnabled: boolean;
  progressiveResearchEnabled: boolean;
  interactionCount: number;
  researchPassCount: number;
  lastResearchAtUtc?: string | null;
  lastResearchSummary: string;
  latestDistillation?: DesktopPersonaDistillation | null;
  researchHistory: DesktopPersonaResearchPass[];
  verifiedQuotes: DesktopPersonaQuote[];
  sources: DesktopPersonaSource[];
  profileEvidenceUrls?: string[];
  updatedAtUtc: string;
  versions?: Array<{ versionId: string; createdAtUtc: string; name: string }>;
};

export type ChatAttachment = { fileName: string; content: string; mediaType?: string | null; ocr?: boolean };

export type DesktopConversationSearchResult = DesktopConversation & {
  display: string;
};

export type DesktopTask = {
  id: string;
  title: string;
  instruction: string;
  followUpInstructions?: string[];
  responseMode?: "think" | "coding" | "security";
  model?: string | null;
  modelProvider?: string | null;
  modelSizeBytes?: number | null;
  modelContextLength?: number | null;
  airLlmCompatible?: boolean;
  environment?: TaskEnvironment;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  gitHubIssueUrl?: string | null;
  acceptanceCriteria?: string | null;
  parentRunId?: string | null;
  changedFiles?: string[];
  role: string;
  status: string;
  capacityWaitReason?: string | null;
  resultSummary?: string | null;
  artifactLabels?: string[];
  requiresApproval?: boolean;
  activity?: Array<{ sequence: number; type: string; actor: string; timestamp: string; payload: Record<string, string> }>;
  verificationEvidence?: {
    checkId: string;
    checkLabel: string;
    command: string;
    relativeWorkingDirectory: string;
    source: string;
    exitCode: number;
    output: string;
    timedOut: boolean;
    outputTruncated: boolean;
    startedAtUtc: string;
    completedAtUtc: string;
    isolationStatus?: string;
  } | null;
  dependsOn: string[];
  updatedAt: string;
};

export type DesktopTaskWorkerDraft = { title: string; instruction: string; role: string; model?: string; modelProvider?: string; modelSizeBytes?: number | null; modelContextLength?: number | null; airLlmCompatible?: boolean };

export type DesktopProjectCheck = {
  id: string;
  label: string;
  command: string;
  relativeWorkingDirectory: string;
  source: string;
};

export type DesktopProjectActivityEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  actor: string;
  timestamp: string;
  payload: Record<string, string>;
};

export type TaskEnvironment = "local" | "worktree";

export type DesktopScheduledTask = {
  id: string;
  conversationId?: string | null;
  prompt: string;
  workspaceMode: string;
  dueAt: string;
  repeatEveryMinutes?: number | null;
  missedRunPolicy?: "run_once" | "skip" | "ask_first";
  triggerType?: "schedule" | "manual" | "project_event" | "webhook";
  triggerValue?: string | null;
  overlapPolicy?: "skip" | "queue" | "replace";
  dryRunCompletedAt?: string | null;
  sourceTaskId?: string | null;
  sourceWorkflowName?: string | null;
  status: string;
  outcome?: string | null;
  selectedModel?: string | null;
  runs?: Array<{ id: string; input: string; status: "running" | "succeeded" | "failed" | "skipped"; startedAtUtc: string; completedAtUtc?: string | null; result?: string | null; failure?: string | null; artifactPaths?: string[] }>;
};

export type ScheduledTaskDraft = {
  prompt: string;
  conversationId?: string | null;
  dueAt: string;
  repeatEveryMinutes?: number | null;
  missedRunPolicy?: "run_once" | "skip" | "ask_first";
  triggerType?: "schedule" | "manual" | "project_event" | "webhook";
  triggerValue?: string | null;
  overlapPolicy?: "skip" | "queue" | "replace";
  dryRunCompleted?: boolean;
  sourceTaskId?: string | null;
  sourceWorkflowName?: string | null;
  workspaceMode?: "ChatBot" | "Coding Agent";
};

export type DesktopQueuedMessage = {
  index: number;
  text: string;
  attachments?: Array<{ fileName: string; mediaType?: string | null }>;
};

export type PetMotionSettings = {
  wander: boolean;
  reduceMotion: boolean;
  interactionDemo: boolean;
};

export type PetActivity = {
  state: "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "needs-attention" | "angry" | "pounce" | "fire-breath" | "celebrate" | "curious-scan" | "ember-curl" | "star-orbit" | "rock-roll" | "sprout-stretch";
  facing: 1 | -1;
  /** Monotonic clip generation so a repeated action restarts even in the same state. */
  generation?: number;
  target?: { x: number; y: number };
};

export type PetAttackAction = "approach-cursor" | "pounce" | "fire-breath" | "celebrate" | "curious-scan" | "ember-curl" | "star-orbit" | "rock-roll" | "sprout-stretch";
export type PetBehaviorSettings = {
  enabled: boolean;
  triggerDuringIdle: boolean;
  triggerDuringWalk: boolean;
  minimumIntervalSeconds: number;
  maximumIntervalSeconds: number;
  actions: PetAttackAction[];
  /** Custom Workshop routines can opt into executing every action in order. */
  orderedActions?: boolean;
};

export type PetCompletionEvent = {
  text: string;
  at: number;
  kind: "success" | "error";
};

export interface PetBridge {
  /** Whether this platform can provide demo window-surface interactions. */
  interactionDemoAvailable: boolean;
  setVisible(visible: boolean): void;
  setMotion(settings: PetMotionSettings): void;
  setBehaviorSettings(settings: PetBehaviorSettings): void;
  setState(state: PetActivity["state"]): void;
  beginDrag(point: { x: number; y: number }): void;
  moveDrag(point: { x: number; y: number }): void;
  endDrag(): void;
  hide(): void;
  onMessage(handler: (event: PetCompletionEvent) => void): () => void;
  onVisibilityChange(handler: (visible: boolean) => void): () => void;
  onMotionChange(handler: (settings: PetMotionSettings) => void): () => void;
  onActivityChange(handler: (activity: PetActivity) => void): () => void;
  onEntrance(handler: (entering: boolean) => void): () => void;
}

/** What closing the main window does. "ask" shows the Linux close prompt. */
export type CloseBehavior = "ask" | "background" | "quit";
export type CloseChoice = "background" | "quit" | "cancel";

export interface WindowBridge {
  /** process.platform of the desktop shell, e.g. "linux" or "win32". */
  platform: string;
  /** Fired on Linux when the user closes the main window and no choice is remembered. */
  onCloseRequested(handler: (request: { trayAvailable: boolean }) => void): () => void;
  respondToClose(choice: CloseChoice, remember: boolean): void;
  getCloseBehavior(): Promise<CloseBehavior>;
  setCloseBehavior(behavior: CloseBehavior): Promise<CloseBehavior>;
  /** Update the Windows native title-bar button area to match the active app theme. */
  setTitleBarTheme(background: string, foreground: string): Promise<boolean>;
}

export type UpdateCheckResult = {
  available: boolean;
  currentVersion: string;
  status?: "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";
  version?: string;
  channel?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  assetName?: string | null;
  publishedAt?: string | null;
  checkedAt?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message: string;
  error?: string;
  rollbackAvailable?: boolean;
  rollbackVersion?: string;
};

export interface UpdatesBridge {
  check(): Promise<UpdateCheckResult>;
  state(): Promise<UpdateCheckResult | null>;
  open(url: string): Promise<boolean>;
  enabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  install(): Promise<boolean>;
  rollback(): Promise<boolean>;
  cancelDownload(): Promise<boolean>;
  download(): Promise<boolean>;
  retry(): Promise<UpdateCheckResult>;
  onState(handler: (result: UpdateCheckResult) => void): () => void;
  onAvailable(handler: (result: UpdateCheckResult) => void): () => void;
}

export interface PluginDownloadsBridge {
  openFolder(): Promise<boolean>;
}

export interface ClipboardBridge {
  writeText(text: string): Promise<boolean>;
}

// Theme: validated theme data sent by the main process (electron/theme-service.cjs).
export type ThemeGradient = { gradient: "solid"; color: string } | { gradient: "linear" | "radial" | "conic"; angle: number; stops: { color: string; at: number }[] };
export type ThemeFont = { family?: string[]; size?: number; weight?: number; lineHeight?: number; letterSpacing?: number };
export type ThemeDefinition = { id: string; name: string; appearance: "light" | "dark"; colors: Record<string, string>; gradients: Record<string, ThemeGradient>; fonts: Record<string, ThemeFont> };
export type ThemeFamily = { name: string; author: string; license: string; file?: string; themes: ThemeDefinition[] };
export type ThemeProblem = { file: string; key: string; problem: string };
export type ThemePicks = { lightTheme: string; darkTheme: string };
export type CustomFont = { family: string; file: string; bytes: number };
export type AppearanceOptions = { animateBackground: boolean; textScale: number; cornerStyle: "square" | "subtle" | "default" | "round"; chatWidth: "narrow" | "default" | "wide" | "full"; messageStyle: "bubbles" | "flat" | "cards"; motion: "system" | "reduce" | "full"; accent: string | null };
export type ThemeSnapshot = { families: ThemeFamily[]; problems: ThemeProblem[]; picks: ThemePicks; fonts: Record<string, ThemeFont>; customFonts: CustomFont[]; options?: AppearanceOptions; animateBackground?: boolean; themesDir: string; fontsDir: string };

export interface AppearanceBridge {
  onChanged(handler: (snapshot: ThemeSnapshot) => void): () => void;
}

export interface AgentBridge {
  request(method: string, params?: Record<string, unknown>): Promise<AgentResponse>;
  browserPreview?: {
    onRequest(handler: (parameters: { projectId?: string; url?: string | null } | undefined) => unknown | Promise<unknown>): () => void;
  };
  onProgress?(handler: (message: { channel: string; delta: string; reset?: boolean }) => void): () => void;
  computer?: {
    capture(): Promise<Array<{ id: string; name: string; displayId: string; display: { x: number; y: number; width: number; height: number; scaleFactor: number } | null; previewWidth: number; previewHeight: number; content: string; mediaType: "image/png" }>>;
    action(action: { action: "click" | "scroll" | "type" | "key"; displayId: string; x?: number; y?: number; button?: "left" | "right"; delta?: number; text?: string; key?: string }): Promise<{ ok: true }>;
  };
  worktree?: { openFolder(taskId: string): Promise<{ ok: boolean; error?: string }> };
  media?: {
    createLocalUrl(mediaType: "video/mp4" | "video/webm" | "audio/mp4" | "audio/webm" | "audio/mpeg" | "audio/wav" | "audio/ogg", content: string): Promise<string>;
    revokeLocalUrl(url: string): Promise<boolean>;
  };
  clipboard?: ClipboardBridge;
  onTrayOpenConversation?(handler: (id: string) => void): () => void;
  onTrayNewChat?(handler: () => void): () => void;
  pet?: PetBridge;
  window?: WindowBridge;
  updates?: UpdatesBridge;
  pluginDownloads?: PluginDownloadsBridge;
  appearance?: AppearanceBridge;
}

declare global {
  interface Window {
    skaiAgent: AgentBridge;
  }
}
