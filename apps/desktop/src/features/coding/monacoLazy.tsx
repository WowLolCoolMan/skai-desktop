import { lazy, Suspense } from "react";
import type { DiffEditorProps, EditorProps } from "@monaco-editor/react";

// Monaco (about 4 MB) loads only when the coding view first shows an editor, keeping it
// out of the startup bundle. Same props as @monaco-editor/react's Editor and DiffEditor.
const EditorImpl = lazy(() => import("./monacoEditors").then((module) => ({ default: module.Editor })));
const DiffEditorImpl = lazy(() => import("./monacoEditors").then((module) => ({ default: module.DiffEditor })));
const fallback = <div className="monaco-loading" role="status">Loading editor…</div>;

export function Editor(props: EditorProps) {
  return <Suspense fallback={fallback}><EditorImpl {...props} /></Suspense>;
}

export function DiffEditor(props: DiffEditorProps) {
  return <Suspense fallback={fallback}><DiffEditorImpl {...props} /></Suspense>;
}
