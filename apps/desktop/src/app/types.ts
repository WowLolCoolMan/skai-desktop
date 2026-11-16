import type { ChatAttachment, RuntimeHealth } from "../../shared/contracts";

export type ConnectionState = "checking" | "ready" | "error";
export type ThemeMode = "dark" | "light" | "system";
export type Route = "chat" | "projects" | "coding" | "settings" | "models" | "images" | "marketplace" | "plugins" | "workbench" | "terminal" | "memory" | "usage" | "pet-workshop" | "voice-workbench";
export type View = Route;
export type Message = { role: "user" | "assistant"; content: string; attachments?: ChatAttachment[] };
export type Model = { model: string; displayName?: string | null; vision: string; capabilities: string[]; provider?: string; endpoint?: string | null; sizeBytes?: number | null; contextLength?: number | null; isLoaded?: boolean | null };
export type MemoryEntry = { id: string; scope: string; content: string; source: string; approvalId: string; tags: string[]; enabled: boolean; updatedAtUtc: string };
export type CorpusDocument = { id: string; title: string; source: string; content: string; tags: string[]; createdAtUtc: string; updatedAtUtc: string };
export type CorpusSearchResult = { document: CorpusDocument; score: number; snippet: string };

export type AppHealth = RuntimeHealth | null;
