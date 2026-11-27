import { useEffect, useMemo, useState } from "react";
import type { DesktopProjectFile } from "../../../shared/contracts";

type FileNode = { kind: "file"; file: DesktopProjectFile };
type DirectoryNode = { kind: "directory"; name: string; path: string; children: TreeNode[] };
type TreeNode = FileNode | DirectoryNode;

function buildTree(files: DesktopProjectFile[]): DirectoryNode {
  const root: DirectoryNode = { kind: "directory", name: "", path: "", children: [] };
  const directories = new Map<string, DirectoryNode>([["", root]]);

  for (const file of files) {
    const segments = file.relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
    if (segments.length === 0) continue;
    let parent = root;
    for (const [index, segment] of segments.slice(0, -1).entries()) {
      const path = segments.slice(0, index + 1).join("/");
      let directory = directories.get(path);
      if (!directory) {
        directory = { kind: "directory", name: segment, path, children: [] };
        directories.set(path, directory);
        parent.children.push(directory);
      }
      parent = directory;
    }
    parent.children.push({ kind: "file", file });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.kind === "directory" && right.kind === "directory"
        ? left.name.localeCompare(right.name)
        : left.kind === "file" && right.kind === "file"
          ? left.file.relativePath.localeCompare(right.file.relativePath)
          : 0;
    });
    for (const node of nodes) if (node.kind === "directory") sort(node.children);
  };
  sort(root.children);
  return root;
}

type ProjectFileTreeProps = {
  files: DesktopProjectFile[];
  selectedFile: string | null;
  query: string;
  onOpenFile: (relativePath: string) => void;
  onAddToContext?: (relativePath: string) => void;
  onCompareWithChat?: (relativePath: string) => void;
  onStartReview?: (relativePath: string) => void;
};

export function ProjectFileTree({ files, selectedFile, query, onOpenFile, onAddToContext, onCompareWithChat, onStartReview }: ProjectFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [collapsedSearchPaths, setCollapsedSearchPaths] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLocaleLowerCase();
  useEffect(() => setCollapsedSearchPaths(new Set()), [normalizedQuery]);

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode => nodes.map((node) => {
    if (node.kind === "directory") {
      const expanded = normalizedQuery.length > 0
        ? !collapsedSearchPaths.has(node.path)
        : expandedPaths.has(node.path);
      const folderId = `project-folder-${encodeURIComponent(node.path)}`;
      return <div className="project-file-directory" key={node.path}>
        <button
          aria-controls={folderId}
          aria-expanded={expanded}
          className="project-file-tree-row project-file-folder"
          onClick={() => {
            if (normalizedQuery) {
              setCollapsedSearchPaths((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
                return next;
              });
              return;
            }
            setExpandedPaths((current) => {
              const next = new Set(current);
              if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
              return next;
            });
          }}
          style={{ "--tree-depth": depth } as React.CSSProperties}
          type="button"
        >
          <span className="project-file-tree-chevron" aria-hidden="true">{expanded ? "⌄" : "›"}</span>
          <span className="project-file-tree-icon" aria-hidden="true">▰</span>
          <span className="project-file-tree-name">{node.name}</span>
        </button>
        {expanded && <div id={folderId} className="project-file-directory-children">{renderNodes(node.children, depth + 1)}</div>}
      </div>;
    }
    const file = node.file;
    const filename = file.relativePath.replaceAll("\\", "/").split("/").at(-1) ?? file.relativePath;
    const hasActions = Boolean(onAddToContext || onCompareWithChat || onStartReview);
    return <div className={`project-file-tree-entry${selectedFile === file.relativePath ? " is-selected" : ""}`} key={file.relativePath} style={{ "--tree-depth": depth } as React.CSSProperties}>
      <button
        aria-current={selectedFile === file.relativePath ? "page" : undefined}
        className="project-file-tree-row project-file-item"
        onClick={() => onOpenFile(file.relativePath)}
        title={file.relativePath}
        type="button"
      >
        <span className="project-file-tree-chevron project-file-tree-spacer" aria-hidden="true" />
        <span className="project-file-tree-icon project-file-document-icon" aria-hidden="true">{file.kind === "image" ? "▧" : file.kind === "pdf" ? "PDF" : file.kind === "svg" ? "SVG" : "·"}</span>
        <span className="project-file-tree-name">{filename}</span>
        <small>{file.bytes.toLocaleString()} B</small>
      </button>
      {hasActions && <details className="project-file-row-actions">
        <summary aria-label={`Actions for ${file.relativePath}`} title="File actions">•••</summary>
        <div className="project-file-row-menu" role="menu" aria-label={`Actions for ${file.relativePath}`}>
          <button type="button" role="menuitem" onClick={() => onOpenFile(file.relativePath)}>Open in editor</button>
          {onAddToContext && <button type="button" role="menuitem" onClick={() => onAddToContext(file.relativePath)}>Add to context</button>}
          {onCompareWithChat && <button type="button" role="menuitem" onClick={() => onCompareWithChat(file.relativePath)}>Compare with chat</button>}
          {onStartReview && <button type="button" role="menuitem" onClick={() => onStartReview(file.relativePath)}>Start review</button>}
        </div>
      </details>}
    </div>;
  });

  return <div className="project-file-list" aria-label="Project files">
    {renderNodes(tree.children, 0)}
  </div>;
}
