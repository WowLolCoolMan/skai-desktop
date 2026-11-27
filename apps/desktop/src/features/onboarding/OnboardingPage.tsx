import { useMemo, useState } from "react";
import type { Model, Route } from "../../app/types";
import type { RuntimeHealth } from "../../../shared/contracts";
import { Button, Card, PageHeader, StatusBadge } from "../../components/ui/Primitives";

type ChecklistId = "privacy" | "sample";
type OnboardingPageProps = {
  connection: "checking" | "ready" | "error";
  health: RuntimeHealth | null;
  models: Model[];
  selectedModel: string;
  provider: string;
  projectCount: number;
  connectedFolderCount: number;
  ramTotalBytes: number | null;
  onNavigate: (route: Route) => void;
  onSendSample: (prompt: string) => void;
};

const PROGRESS_KEY = "skai.onboarding.progress.v1";
const COMPLETED_KEY = "skai.onboarding.completed.v1";
const samplePrompt = "In one short reply, introduce yourself and suggest one useful thing I can do with this local workspace.";

function readProgress(): Set<ChecklistId> {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is ChecklistId => item === "privacy" || item === "sample") : []);
  } catch { return new Set(); }
}

export function OnboardingPage({ connection, health, models, selectedModel, provider, projectCount, connectedFolderCount, ramTotalBytes, onNavigate, onSendSample }: OnboardingPageProps) {
  const [progress, setProgress] = useState(readProgress);
  const [showDemo, setShowDemo] = useState(false);
  const [showNavigationGuide, setShowNavigationGuide] = useState(() => localStorage.getItem("skai.onboarding.navigation-guide-dismissed.v1") !== "true");
  const hasModel = models.length > 0;
  const runtimeReady = connection === "ready";
  const recommendedModel = useMemo(() => {
    if (!models.length) return null;
    const selected = models.find((item) => item.model === selectedModel);
    if (selected) return { model: selected, reason: "Your current selection is the safest recommendation because it is already configured." };
    const candidates = [...models].sort((a, b) => (a.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (b.sizeBytes ?? Number.MAX_SAFE_INTEGER));
    const small = candidates.find((item) => item.sizeBytes != null && item.sizeBytes < 8 * 1024 ** 3);
    return { model: small ?? candidates[0], reason: small ? "Advisory: the smallest discovered model is a reasonable starting point for this machine." : "Advisory: choose a discovered model and check its memory requirements before loading it." };
  }, [models, selectedModel]);
  const complete = new Set<ChecklistId>(progress);
  const checklist = [
    { id: "runtime", title: "Connect the local agent", detail: connection === "ready" ? "Agent Host is responding." : connection === "checking" ? "Checking the local runtime…" : "The local agent is not connected yet.", done: runtimeReady, action: connection === "error" ? "Retry in Settings" : "Runtime details", route: "settings" as Route },
    { id: "model", title: "Choose a chat model", detail: hasModel ? `${models.length} local model${models.length === 1 ? "" : "s"} discovered · ${provider}` : "No local models have been discovered yet.", done: hasModel, action: "Browse models", route: "models" as Route },
    { id: "workspace", title: "Connect a project folder", detail: connectedFolderCount ? `${connectedFolderCount} connected folder${connectedFolderCount === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"}.` : "Optional for chat. Connect a folder when you want project-aware coding tools.", done: connectedFolderCount > 0, action: "Open projects", route: "projects" as Route },
    { id: "privacy", title: "Review what stays local", detail: "Chat uses your configured local model. Network features such as web search or external integrations are separate capabilities and can send data outside this device when enabled.", done: complete.has("privacy"), action: complete.has("privacy") ? "Reviewed" : "Mark reviewed", route: null },
    { id: "sample", title: "Try a safe sample chat", detail: hasModel ? "Sends one short prompt to the selected chat model. It does not ask for file or project changes." : "Discover a local chat model first. The sample only runs against a model visible to Skai.", done: complete.has("sample"), action: complete.has("sample") ? "Sent" : "Send sample", route: null },
  ];
  const doneCount = checklist.filter((item) => item.done).length;
  const updateProgress = (id: ChecklistId) => setProgress((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...next]));
    return next;
  });
  const skipOptional = () => {
    localStorage.setItem(COMPLETED_KEY, "true");
    onNavigate("chat");
  };
  const resetOnboarding = () => {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(COMPLETED_KEY);
    localStorage.removeItem("skai.onboarding.navigation-guide-dismissed.v1");
    setProgress(new Set());
    setShowNavigationGuide(true);
  };

  return <div className="feature-page onboarding-page">
    <PageHeader eyebrow="GETTING STARTED" title="Make Skai yours" description="A short, optional setup path. You can skip any step and return here from Extras whenever you need it." actions={<Button variant="ghost" onClick={skipOptional}>Skip for now</Button>} />
    {showNavigationGuide && <aside className="onboarding-navigation-guide" aria-label="Navigation guide"><div><strong>Find your way around</strong><span>Home is for chat, Projects connects folders, Coding combines agent work with files and Git, and Extras contains tools, memory, usage, and media workflows.</span></div><Button variant="ghost" aria-label="Dismiss navigation guide" onClick={() => { localStorage.setItem("skai.onboarding.navigation-guide-dismissed.v1", "true"); setShowNavigationGuide(false); }}>Dismiss</Button></aside>}
    <div className="onboarding-grid">
      <Card className="onboarding-checklist-card">
        <div className="onboarding-card-heading"><div><p className="section-kicker">YOUR SETUP</p><h2>Ready when you are</h2></div><StatusBadge tone={doneCount === checklist.length ? "success" : "neutral"}>{doneCount} of {checklist.length} complete</StatusBadge></div>
        <div className="onboarding-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={doneCount}><span style={{ width: `${doneCount / checklist.length * 100}%` }} /></div>
        <ol className="onboarding-checklist">{checklist.map((item) => <li key={item.id} className={item.done ? "is-complete" : ""}>
          <span className="onboarding-check-icon" aria-hidden="true">{item.done ? "✓" : <span>{checklist.findIndex((step) => step.id === item.id) + 1}</span>}</span>
          <div className="onboarding-check-copy"><strong>{item.title}</strong><p>{item.detail}</p></div>
          {item.route ? <Button variant="secondary" onClick={() => onNavigate(item.route!)}>{item.action}</Button> : item.id === "privacy" ? <Button variant="secondary" onClick={() => updateProgress("privacy")}>{item.action}</Button> : <Button variant={item.done ? "secondary" : "primary"} disabled={!runtimeReady || !hasModel} onClick={() => { onSendSample(samplePrompt); updateProgress("sample"); }}>{item.action}</Button>}
        </li>)}</ol>
        <div className="onboarding-footer"><span>Setup progress is stored on this device. Resetting it does not remove chats, projects, or installed models.</span><Button variant="ghost" onClick={resetOnboarding}>Reset checklist</Button></div>
      </Card>

      <div className="onboarding-side-column">
        <Card className="onboarding-card onboarding-recommendation">
          <div className="onboarding-card-heading"><div><p className="section-kicker">MODEL MATCH</p><h2>A practical starting point</h2></div></div>
          {recommendedModel ? <><strong className="onboarding-model-name">{recommendedModel.model.displayName || recommendedModel.model.model}</strong><p>{recommendedModel.reason}</p><div className="onboarding-model-meta"><span>{recommendedModel.model.provider ?? provider}</span><span>{recommendedModel.model.capabilities.join(" · ") || "Text generation"}</span><span>{recommendedModel.model.sizeBytes == null ? "Size not reported" : `${(recommendedModel.model.sizeBytes / 1024 ** 3).toFixed(1)} GB on disk`}</span></div><Button variant="secondary" onClick={() => onNavigate("models")}>Compare available models</Button></> : <><p>No local chat models are visible yet. Start or configure a supported runtime, then discover its models.</p><Button variant="secondary" onClick={() => onNavigate("models")}>Discover models</Button></>}
          {ramTotalBytes != null && <small className="onboarding-advisory">System memory detected: {(ramTotalBytes / 1024 ** 3).toFixed(1)} GB. Model fit is advisory; actual memory use depends on context, quantization, and runtime.</small>}
        </Card>
        <Card className="onboarding-card onboarding-capabilities">
          <div className="onboarding-card-heading"><div><p className="section-kicker">AVAILABLE HERE</p><h2>What Skai can do now</h2></div><StatusBadge tone={runtimeReady ? "success" : "warning"}>{runtimeReady ? "Local agent connected" : connection === "checking" ? "Checking" : "Needs setup"}</StatusBadge></div>
          <ul>{[
            ["Chat", runtimeReady ? `Ready · ${selectedModel || "configured model"}` : "Connect the local agent to begin"],
            ["Project coding", connectedFolderCount ? `${connectedFolderCount} folder${connectedFolderCount === 1 ? "" : "s"} connected` : "Available after connecting a project folder"],
            ["Image creation", health?.capabilities.includes("image.generate") ? "Local image endpoint is available; check workflow readiness in Images" : "Check Images for local workflow setup"],
            ["Video and music", "Planned · workflows are not enabled yet"],
          ].map(([name, detail]) => <li key={name}><strong>{name}</strong><span>{detail}</span></li>)}</ul>
          <p className="onboarding-privacy-note">External services are opt-in. Skai labels local runtimes and network-connected integrations in their setup screens.</p>
        </Card>
      </div>

      <Card className="onboarding-demo-card">
        <div className="onboarding-card-heading"><div><p className="section-kicker">NO-CHANGE PREVIEW</p><h2>See a sample workflow</h2><p>Preview example task, Git review, and media steps without writing demo content into your workspace.</p></div><Button variant="secondary" onClick={() => setShowDemo((value) => !value)}>{showDemo ? "Hide preview" : "Preview workflows"}</Button></div>
        {showDemo && <div className="onboarding-demo-grid">{[
          { title: "Project task", steps: ["Choose a folder", "Review a proposed plan", "Approve before edits run"] },
          { title: "Git review", steps: ["Inspect changed files", "Run selected checks", "Commit or push when ready"] },
          { title: "Visuals Workshop", steps: ["Describe the image", "Choose a local workflow", "Review and save the result"] },
        ].map((demo) => <section key={demo.title}><h3>{demo.title}</h3><ol>{demo.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>)}</div>}
      </Card>
    </div>
  </div>;
}
