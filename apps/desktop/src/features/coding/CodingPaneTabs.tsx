import type { CodingPanePage, CodingPanePanel, CodingPanePreset } from "./useCodingPaneWorkspace";
import { codingPanePageTitle } from "./useCodingPaneWorkspace";
import { OverflowMenu } from "../../components/ui/OverflowMenu";
import { NavIcon } from "../../components/ui/NavIcon";

type CodingPaneTabsProps = {
  pages: CodingPanePage[];
  activePageId: string;
  selectedFile: string | null;
  changeCount: number;
  isSplitOpen: boolean;
  onSelect: (page: CodingPanePage) => void;
  onClose: (pageId: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  onOpenPanel: (panel: CodingPanePanel, filePath?: string) => void;
  onApplyPreset: (preset: CodingPanePreset) => void;
  onCloseSplit: () => void;
};

export function CodingPaneTabs({ pages, activePageId, selectedFile, changeCount, isSplitOpen, onSelect, onClose, onReorder, onOpenPanel, onApplyPreset, onCloseSplit }: CodingPaneTabsProps) {
  const actions = [
    { label: "Side chat", onSelect: () => onOpenPanel("side-chat") },
    { label: selectedFile ? `Editor · ${selectedFile.split(/[\\/]/).pop()}` : "Editor", onSelect: () => onOpenPanel("editor", selectedFile ?? undefined) },
    { label: "Files", onSelect: () => onOpenPanel("files") },
    { label: "Changes", onSelect: () => onOpenPanel("changes") },
    { label: "Scratchpad", onSelect: () => onOpenPanel("scratchpad") },
    { label: "Preview", onSelect: () => onOpenPanel("preview") },
  ];
  const presets = [
    { label: "Single pane", onSelect: () => onApplyPreset("single") },
    { label: "Chat + files", onSelect: () => onApplyPreset("chat-files") },
    { label: "Chat + terminal", onSelect: () => onApplyPreset("chat-terminal") },
    { label: "Review changes", onSelect: () => onApplyPreset("review") },
    { label: "Research notes", onSelect: () => onApplyPreset("research") },
  ];

  if (!isSplitOpen) {
    return <div className="coding-split-launcher"><OverflowMenu label="Add to split" items={actions} /><OverflowMenu label="Workspace layout" items={presets} /></div>;
  }

  return <div className="workspace-tab-strip coding-pane-tab-strip is-split-open" role="group" aria-label="Right workspace pages">
    <div className="workspace-tab-list">{pages.map((page) => {
      const title = codingPanePageTitle(page);
      const icon = page.panel === "side-chat" ? "chat" : page.panel === "changes" ? "activity" : page.panel === "files" ? "project" : page.panel === "scratchpad" ? "document" : page.panel === "preview" ? "image" : "code";
      return <div className={`workspace-tab${page.id === activePageId ? " is-active" : ""}`} key={page.id} draggable
        onDragStart={(event) => { event.dataTransfer.setData("text/skai-coding-pane", page.id); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("text/skai-coding-pane"); if (sourceId) onReorder(sourceId, page.id); }}
        onAuxClick={(event) => { if (event.button === 1) onClose(page.id); }}>
        <button className="workspace-tab-select" type="button" aria-current={page.id === activePageId ? "page" : undefined} title={title} onClick={() => onSelect(page)}>
          <NavIcon name={icon} />
          <span>{page.panel === "changes" && changeCount ? `Changes · ${changeCount}` : title}</span>
        </button>
        <button className="workspace-tab-close" type="button" aria-label={`Close ${title}`} title="Close page" disabled={pages.length <= 1} onClick={() => onClose(page.id)}><NavIcon name="close" /></button>
      </div>;
    })}</div>
    <OverflowMenu label="Workspace layout" items={presets} /><OverflowMenu label="Add a page to the split view" icon={<NavIcon name="plus" />} items={[...actions, { label: "Close split view", onSelect: onCloseSplit }]} />
  </div>;
}
