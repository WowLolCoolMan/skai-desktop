import { useState, type FormEvent } from "react";
import type { Model, Route } from "../../app/types";
import { MessageContent } from "./MessageContent";
import { NavIcon } from "../../components/ui/NavIcon";
import { Button, StatusBadge } from "../../components/ui/Primitives";

type CompareSide = "a" | "b";
type CompareResult = { status: "waiting" | "running" | "complete" | "error"; content?: string; error?: string };

function modelKey(model: Model) {
  return `${model.provider ?? ""}|${model.endpoint ?? ""}|${model.model}`;
}

function modelName(model: Model) {
  return model.displayName?.trim() || model.model;
}

function modelOptionLabel(model: Model) {
  const runtime = model.provider || "Local runtime";
  return model.displayName && model.displayName !== model.model
    ? `${model.displayName} · ${model.model} · ${runtime}`
    : `${model.model} · ${runtime}`;
}

export function ComparePage({ models, onNavigate, onCompareModel }: {
  models: Model[];
  onNavigate: (route: Route) => void;
  onCompareModel: (model: Model, prompt: string) => Promise<string>;
}) {
  const [modelAKey, setModelAKey] = useState("");
  const [modelBKey, setModelBKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<Record<CompareSide, CompareResult>>({ a: { status: "waiting" }, b: { status: "waiting" } });
  const [running, setRunning] = useState(false);
  const modelA = models.find((model) => modelKey(model) === modelAKey) ?? null;
  const modelB = models.find((model) => modelKey(model) === modelBKey) ?? null;
  const canCompare = Boolean(modelA && modelB && modelAKey !== modelBKey && prompt.trim() && !running);

  const selectModel = (side: CompareSide, key: string) => {
    if (side === "a") setModelAKey(key);
    else setModelBKey(key);
    setResults({ a: { status: "waiting" }, b: { status: "waiting" } });
  };

  const compare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCompare || !modelA || !modelB) return;
    const submittedPrompt = prompt.trim();
    setRunning(true);
    setResults({ a: { status: "running" }, b: { status: "waiting" } });
    try {
      // Run one local model at a time to avoid doubling peak memory use.
      const selectedModels: Array<[CompareSide, Model]> = [["a", modelA], ["b", modelB]];
      for (const [side, model] of selectedModels) {
        setResults((current) => ({ ...current, [side]: { status: "running" } }));
        try {
          const content = await onCompareModel(model, submittedPrompt);
          setResults((current) => ({ ...current, [side]: { status: "complete", content } }));
        } catch (error) {
          setResults((current) => ({ ...current, [side]: { status: "error", error: error instanceof Error ? error.message : "This model could not complete the comparison." } }));
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const renderPane = (side: CompareSide, model: Model | null) => {
    const result = results[side];
    const label = side === "a" ? "Model A" : "Model B";
    return <section className={`compare-pane compare-pane-${side}`} aria-label={`${label} response`}>
      <header className="compare-pane-header"><div><span className="compare-pane-mark">{side.toUpperCase()}</span><div><h2>{model ? modelName(model) : label}</h2><p>{model ? `${model.provider || "Local runtime"} · ${model.model}` : "Choose a local model above"}</p></div></div>{result.status === "running" ? <StatusBadge tone="warning">Running</StatusBadge> : result.status === "complete" ? <StatusBadge tone="success">Complete</StatusBadge> : result.status === "error" ? <StatusBadge tone="danger">Failed</StatusBadge> : null}</header>
      <div className="compare-pane-content" aria-live="polite">
        {result.status === "running" && <p className="compare-placeholder">Generating with {model ? modelName(model) : label}…</p>}
        {result.status === "complete" && <MessageContent content={result.content ?? ""} />}
        {result.status === "error" && <p className="compare-error" role="alert">{result.error}</p>}
        {result.status === "waiting" && <p className="compare-placeholder">{model ? "Ready when you are. Enter a prompt below." : `Select ${label} to begin.`}</p>}
      </div>
    </section>;
  };

  return <div className="feature-page compare-page">
    <header className="compare-page-header">
      <Button variant="ghost" type="button" className="compare-back-button" aria-label="Back to chat" onClick={() => onNavigate("chat")}><NavIcon name="chevron-left" /><span>Back</span></Button>
      <h1>A/B Compare</h1>
      <div className="compare-model-selectors">
        <label className="compare-select compare-select-a"><span className="sr-only">Select Model A</span><select value={modelAKey} disabled={running} onChange={(event) => selectModel("a", event.target.value)}><option value="">Select Model A</option>{models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{modelOptionLabel(model)}</option>)}</select></label>
        <span className="compare-versus" aria-hidden="true">vs</span>
        <label className="compare-select compare-select-b"><span className="sr-only">Select Model B</span><select value={modelBKey} disabled={running} onChange={(event) => selectModel("b", event.target.value)}><option value="">Select Model B</option>{models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{modelOptionLabel(model)}</option>)}</select></label>
      </div>
    </header>
    {models.length === 0 && <div className="compare-no-models" role="status">No local models are loaded. Discover models in <button type="button" onClick={() => onNavigate("models")}>Models</button> first.</div>}
    <main className="compare-results">{renderPane("a", modelA)}{renderPane("b", modelB)}</main>
    <form className="compare-composer" onSubmit={(event) => void compare(event)}>
      <label className="sr-only" htmlFor="compare-prompt">Prompt to send to both models</label>
      <textarea id="compare-prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); setResults({ a: { status: "waiting" }, b: { status: "waiting" } }); }} maxLength={120000} rows={2} placeholder="Ask both models the same thing…" disabled={running} />
      <div className="compare-composer-footer"><p>{running ? "Running one model at a time to reduce memory use." : "Both models receive the same prompt. Comparison stays local and is not saved to chat history."}</p><Button variant="primary" type="submit" disabled={!canCompare} aria-busy={running}>{running ? "Comparing…" : "Compare"}<NavIcon name="arrow-right" /></Button></div>
      {modelAKey && modelAKey === modelBKey && <p className="compare-validation" role="status">Choose two different models to compare.</p>}
    </form>
  </div>;
}
