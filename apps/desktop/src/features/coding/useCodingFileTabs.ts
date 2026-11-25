import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DesktopProjectFile } from "../../../shared/contracts";
import { reorderItem } from "../../app/reorderItem";

function openTabsStorageKey(projectId: string) {
  return `skai.coding.openTabs.${projectId}`;
}

function activeFileStorageKey(projectId: string) {
  return `skai.coding.activeFile.${projectId}`;
}

type UseCodingFileTabsOptions = {
  projectId: string;
  projectFiles: DesktopProjectFile[];
  selectedFile: string | null;
  onOpenFile: (path: string) => void;
  onCloseFile: () => void;
};

export function useCodingFileTabs({ projectId, projectFiles, selectedFile, onOpenFile, onCloseFile }: UseCodingFileTabsOptions) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const loadedProjectRef = useRef<string | null>(null);
  const lastRestoredFileRef = useRef<string | null>(null);
  const skipNextPersistenceRef = useRef(false);

  useEffect(() => {
    let restoredTabs: string[] = [];
    try {
      const storedTabs = JSON.parse(localStorage.getItem(openTabsStorageKey(projectId)) ?? "[]");
      if (Array.isArray(storedTabs)) restoredTabs = storedTabs.filter((path): path is string => typeof path === "string" && path.length > 0).slice(0, 12);
    } catch {
      restoredTabs = [];
    }
    loadedProjectRef.current = projectId;
    lastRestoredFileRef.current = null;
    skipNextPersistenceRef.current = true;
    setTabs(restoredTabs);
    setLoadedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (loadedProjectRef.current !== projectId) return;
    if (skipNextPersistenceRef.current) {
      skipNextPersistenceRef.current = false;
      return;
    }
    localStorage.setItem(openTabsStorageKey(projectId), JSON.stringify(tabs));
  }, [projectId, tabs]);

  useEffect(() => {
    if (selectedFile) setTabs((current) => current.includes(selectedFile) ? current : [...current, selectedFile]);
  }, [selectedFile]);

  useEffect(() => {
    if (loadedProjectId !== projectId) return;
    const path = localStorage.getItem(activeFileStorageKey(projectId));
    if (!path || lastRestoredFileRef.current === `${projectId}:${path}` || !projectFiles.some((file) => file.relativePath === path)) return;
    lastRestoredFileRef.current = `${projectId}:${path}`;
    setTabs((current) => current.includes(path) ? current : [...current, path]);
    onOpenFile(path);
  }, [loadedProjectId, onOpenFile, projectFiles, projectId]);

  const openFile = useCallback((path: string) => {
    setTabs((current) => current.includes(path) ? current : [...current, path]);
    localStorage.setItem(activeFileStorageKey(projectId), path);
    lastRestoredFileRef.current = `${projectId}:${path}`;
    onOpenFile(path);
  }, [onOpenFile, projectId]);

  const focusTab = useCallback((index: number) => {
    const path = tabs[index];
    if (!path) return;
    openFile(path);
    window.requestAnimationFrame(() => document.getElementById(`coding-file-tab-${index}`)?.focus());
  }, [openFile, tabs]);

  const reorderTab = useCallback((sourcePath: string, targetPath: string) => {
    setTabs((current) => reorderItem(current, sourcePath, targetPath, (path) => path));
  }, []);

  const onTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : -1;
    if (nextIndex < 0 || !tabs.length) return;
    event.preventDefault();
    focusTab(nextIndex);
  }, [focusTab, tabs.length]);

  const closeTab = useCallback((path: string) => {
    const index = tabs.indexOf(path);
    const next = tabs.filter((item) => item !== path);
    setTabs(next);
    if (path !== selectedFile) return;
    const nextActive = next[index] ?? next[index - 1];
    if (nextActive) openFile(nextActive);
    else {
      localStorage.removeItem(activeFileStorageKey(projectId));
      lastRestoredFileRef.current = null;
      onCloseFile();
    }
  }, [onCloseFile, openFile, projectId, selectedFile, tabs]);

  return { tabs, isLoaded: loadedProjectId === projectId, openFile, reorderTab, onTabKeyDown, closeTab };
}
