// Monaco is bundled with the app (no CDN): @monaco-editor/react would otherwise fetch it
// from cdn.jsdelivr.net, which the production CSP (script-src 'self') blocks and which
// breaks the local-only design.
//
// Kept small on purpose (the app is being slimmed down): the core editor API, the editor
// features the coding view uses, syntax highlighting for the languages it maps files to,
// and the one core worker. The TypeScript/JSON/CSS/HTML language services (≈13 MB of
// workers) are left out, so there is highlighting but no IntelliSense or validation.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

// Editor features (a subset of monaco-editor's editor.main).
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/links/browser/links";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/smartSelect/browser/smartSelect";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations";
// The package "exports" map only serves .js, so the two codicon stylesheets use a file path.
import "../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import "monaco-editor/editor/common/standaloneStrings";

// Syntax highlighting (Monarch) for the languages languageForPath() returns.
import "monaco-editor/languages/definitions/cpp/register";
import "monaco-editor/languages/definitions/csharp/register";
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/java/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/shell/register";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/languages/definitions/xml/register";
import "monaco-editor/languages/definitions/yaml/register";

// JSON's own highlighter belongs to the (omitted) JSON service; JavaScript's tokenizer
// reads JSON well, so "json" reuses it.
monaco.languages.register({ id: "json", extensions: [".json"], aliases: ["JSON", "json"] });
void import("monaco-editor/languages/definitions/javascript/javascript").then(({ conf, language }) => {
  monaco.languages.setMonarchTokensProvider("json", language);
  monaco.languages.setLanguageConfiguration("json", conf);
});

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
