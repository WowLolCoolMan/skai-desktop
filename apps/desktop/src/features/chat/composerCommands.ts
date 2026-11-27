import type { Route } from "../../app/types";

export type ComposerCommand = { id: string; label: string; detail: string; shortcut: string; route?: Route; prompt?: string };

export const composerCommands: ComposerCommand[] = [
  { id: "coding", label: "Open Coding Workspace", detail: "Projects, files, terminal, and edits", shortcut: "/coding", route: "coding" },
  { id: "models", label: "Open Models", detail: "Discover and select a local model", shortcut: "/models", route: "models" },
  { id: "images", label: "Open Image Studio", detail: "Create with a local workflow", shortcut: "/images", route: "images" },
  { id: "marketplace", label: "Open Marketplace", detail: "Review local voices, skills, and tools", shortcut: "/marketplace", route: "marketplace" },
  { id: "memory", label: "Open Memory", detail: "Review approved local memory", shortcut: "/memory", route: "memory" },
  { id: "settings", label: "Open Settings", detail: "Appearance and workspace preferences", shortcut: "/settings", route: "settings" },
];
