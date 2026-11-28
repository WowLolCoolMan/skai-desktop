import { useCallback, useEffect, useState } from "react";
import { reorderItem } from "../../app/reorderItem";

export type CodingPanePanel = "editor" | "files-changes" | "side-chat" | "scratchpad" | "preview";
export type CodingPanePage = { id: string; panel: CodingPanePanel; filePath?: string };
export type CodingPanePreset = "single" | "chat-files" | "chat-terminal" | "review" | "research";

const DEFAULT_PAGES: CodingPanePage[] = [
  { id: "coding-side-chat", panel: "side-chat" },
  { id: "coding-editor", panel: "editor" },
  { id: "coding-files-changes", panel: "files-changes" },
];

const pagePanels: CodingPanePanel[] = ["editor", "files-changes", "side-chat", "scratchpad", "preview"];
const MAX_PAGES = 24;

const PRESET_PAGES: Record<CodingPanePreset, CodingPanePage[]> = {
  single: [{ id: "coding-editor", panel: "editor" }, { id: "coding-files-changes", panel: "files-changes" }],
  "chat-files": [{ id: "coding-side-chat", panel: "side-chat" }, { id: "coding-files-changes", panel: "files-changes" }],
  "chat-terminal": [{ id: "coding-side-chat", panel: "side-chat" }, { id: "coding-editor", panel: "editor" }],
  review: [{ id: "coding-side-chat", panel: "side-chat" }, { id: "coding-files-changes", panel: "files-changes" }, { id: "coding-editor", panel: "editor" }],
  research: [{ id: "coding-side-chat", panel: "side-chat" }, { id: "coding-scratchpad", panel: "scratchpad" }, { id: "coding-files-changes", panel: "files-changes" }],
};

const pagesKey = (projectId: string) => `skai.coding.panePages.${projectId}`;
const versionKey = (projectId: string) => `skai.coding.panePagesVersion.${projectId}`;
const activePageKey = (projectId: string) => `skai.coding.activePanePage.${projectId}`;
const splitOpenKey = (projectId: string) => `skai.coding.splitOpen.${projectId}`;

function normalizeCodingPanePage(value: unknown): CodingPanePage | null {
  if (!value || typeof value !== "object") return null;
  const page = value as Partial<CodingPanePage>;
  if (typeof page.id !== "string" || typeof page.panel !== "string" || (page.filePath !== undefined && typeof page.filePath !== "string")) return null;
  const panel = page.panel as string;
  if (panel === "files" || panel === "changes" || panel === "files-changes") return { id: "coding-files-changes", panel: "files-changes" };
  return pagePanels.includes(page.panel as CodingPanePanel) ? { ...page, panel: page.panel as CodingPanePanel } as CodingPanePage : null;
}

function normalizeCodingPanePageId(id: string | null) {
  return id === "coding-files" || id === "coding-changes" ? "coding-files-changes" : id;
}

export function codingPanePageTitle(page: CodingPanePage) {
  if (page.filePath) return page.filePath.split(/[\\/]/).pop() ?? page.filePath;
  return page.panel === "side-chat" ? "Side chat" : page.panel === "editor" ? "Editor" : page.panel === "files-changes" ? "Files & Changes" : page.panel === "scratchpad" ? "Scratchpad" : "Preview";
}

export function useCodingPaneWorkspace(projectId: string) {
  const [pages, setPages] = useState<CodingPanePage[]>(DEFAULT_PAGES);
  const [activePageId, setActivePageId] = useState("coding-editor");
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [splitLoadedProjectId, setSplitLoadedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let restoredPages = DEFAULT_PAGES;
    try {
      const stored = JSON.parse(localStorage.getItem(pagesKey(projectId)) ?? "null");
      if (Array.isArray(stored)) {
        const valid = stored.map(normalizeCodingPanePage).filter((page): page is CodingPanePage => page !== null)
          .filter((page, index, items) => items.findIndex((entry) => entry.id === page.id) === index);
        if (valid.length) restoredPages = valid.slice(0, MAX_PAGES);
      }
      localStorage.setItem(versionKey(projectId), "6");
    } catch { /* use the standard project pages */ }

    const storedActiveId = localStorage.getItem(activePageKey(projectId));
    setPages(restoredPages);
    const normalizedActiveId = normalizeCodingPanePageId(storedActiveId);
    setActivePageId(normalizedActiveId && restoredPages.some((page) => page.id === normalizedActiveId)
      ? normalizedActiveId
      : restoredPages.find((page) => page.panel === "editor")?.id ?? restoredPages[0].id);
    setIsSplitOpen(localStorage.getItem(splitOpenKey(projectId)) === "true");
    setLoadedProjectId(projectId);
    setSplitLoadedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (loadedProjectId !== projectId) return;
    try {
      localStorage.setItem(pagesKey(projectId), JSON.stringify(pages));
      localStorage.setItem(activePageKey(projectId), activePageId);
    } catch { /* keep the in-memory workspace usable when storage is unavailable */ }
  }, [activePageId, loadedProjectId, pages, projectId]);

  useEffect(() => {
    if (splitLoadedProjectId !== projectId) return;
    try { localStorage.setItem(splitOpenKey(projectId), String(isSplitOpen)); }
    catch { /* split layout remains available for the current session */ }
  }, [isSplitOpen, projectId, splitLoadedProjectId]);

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0] ?? null;

  const openPanel = useCallback((panel: CodingPanePanel, filePath?: string) => {
    const id = filePath ? `coding-file-${filePath}` : `coding-${panel}`;
    setIsSplitOpen(true);
    setPages((current) => current.some((page) => page.id === id)
      ? current
      : [...current, { id, panel, ...(filePath ? { filePath } : {}) }].slice(-MAX_PAGES));
    setActivePageId(id);
  }, []);

  const closePage = useCallback((pageId: string) => {
    if (pages.length <= 1) return;
    const index = pages.findIndex((page) => page.id === pageId);
    const remaining = pages.filter((page) => page.id !== pageId);
    setPages(remaining);
    if (activePageId === pageId) setActivePageId(remaining[Math.min(Math.max(index, 0), remaining.length - 1)].id);
  }, [activePageId, pages]);

  const reorderPage = useCallback((sourceId: string, targetId: string) => {
    setPages((current) => reorderItem(current, sourceId, targetId, (page) => page.id));
  }, []);

  const selectPage = useCallback((page: CodingPanePage) => setActivePageId(page.id), []);
  const applyPreset = useCallback((preset: CodingPanePreset) => {
    const nextPages = PRESET_PAGES[preset].map((page) => ({ ...page }));
    setPages(nextPages);
    setIsSplitOpen(preset !== "single");
    setActivePageId(nextPages[preset === "single" ? 0 : 1]?.id ?? nextPages[0].id);
  }, []);
  const ensureSplitOpen = useCallback(() => setIsSplitOpen(true), []);
  const closeSplitView = useCallback(() => setIsSplitOpen(false), []);

  return { pages, activePageId, activePage, panel: activePage?.panel ?? null, isSplitOpen, openPanel, closePage, reorderPage, selectPage, applyPreset, ensureSplitOpen, closeSplitView };
}
