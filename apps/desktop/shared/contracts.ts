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

export type LocalCapacitySnapshot = {
  capturedAtUtc: string;
  ramTotalBytes: number | null;
  ramAvailableBytes: number | null;
  cpuUtilizationPercent: number | null;
  gpu: { name: string; totalBytes: number | null; availableBytes: number | null; utilizationPercent: number | null } | null;
  measurementNote: string | null;
};

export type DesktopProject = {
  id: string;
  name: string;
  instructions: string;
  folderPaths: string[];
  gitHubRepository?: string | null;
  updatedAt: string;
};

export type DesktopProjectFile = {
  relativePath: string;
  bytes: number;
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

export type ChatAttachment = { fileName: string; content: string; mediaType?: string | null };

export type DesktopConversationSearchResult = DesktopConversation & {
  display: string;
};

export type DesktopTask = {
  id: string;
  title: string;
  instruction: string;
  projectId?: string | null;
  conversationId?: string | null;
  changedFiles?: string[];
  role: string;
  status: string;
  resultSummary?: string | null;
  artifactLabels?: string[];
  dependsOn: string[];
  updatedAt: string;
};

export type TaskEnvironment = "local" | "worktree";

export type DesktopScheduledTask = {
  id: string;
  prompt: string;
  workspaceMode: string;
  dueAt: string;
  repeatEveryMinutes?: number | null;
  status: string;
  outcome?: string | null;
};

export type ScheduledTaskDraft = {
  prompt: string;
  dueAt: string;
  repeatEveryMinutes?: number | null;
  workspaceMode?: "chat" | "coding-agent";
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
}

export type UpdateCheckResult = {
  available: boolean;
  currentVersion: string;
  version?: string;
  channel?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  assetName?: string | null;
  publishedAt?: string | null;
  checkedAt?: string;
  message: string;
  error?: string;
};

export interface UpdatesBridge {
  check(): Promise<UpdateCheckResult>;
  open(url: string): Promise<boolean>;
  onAvailable(handler: (result: UpdateCheckResult) => void): () => void;
}

export interface PluginDownloadsBridge {
  openFolder(): Promise<boolean>;
}

export interface AgentBridge {
  request(method: string, params?: Record<string, unknown>): Promise<AgentResponse>;
  media?: {
    createLocalUrl(mediaType: "video/mp4" | "video/webm" | "audio/mp4" | "audio/webm" | "audio/mpeg" | "audio/wav" | "audio/ogg", content: string): Promise<string>;
    revokeLocalUrl(url: string): Promise<boolean>;
  };
  onTrayOpenConversation?(handler: (id: string) => void): () => void;
  onTrayNewChat?(handler: () => void): () => void;
  pet?: PetBridge;
  window?: WindowBridge;
  updates?: UpdatesBridge;
  pluginDownloads?: PluginDownloadsBridge;
}

declare global {
  interface Window {
    skaiAgent: AgentBridge;
  }
}
