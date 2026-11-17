// Monaco's ESM subpaths (contributions, Monarch language definitions) are imported for
// their side effects or their exported { conf, language }; not all ship .d.ts files.
declare module "monaco-editor/languages/definitions/*";
declare module "monaco-editor/editor/contrib/*";
declare module "monaco-editor/editor/browser/*";
declare module "monaco-editor/editor/common/standaloneStrings";
declare module "monaco-editor/editor/editor.worker?worker" { const WorkerConstructor: new () => Worker; export default WorkerConstructor; }
