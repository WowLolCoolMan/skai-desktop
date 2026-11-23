import { useEffect, useState } from "react";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import type { AgentResponse, ChatAttachment } from "../../../shared/contracts";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";

type ImageResult = { url: string; fileName: string; mediaType?: "image" | "video" | "audio"; provider?: ImageProvider; prompt?: string; createdAt?: string };
type Workflow = { name: string; workflow: string };
type WorkflowMode = "generate" | "edit";
type VisualTool = "image" | "edit" | "cutout" | "enhance" | "erase" | "video" | "animate" | "character" | "lipsync" | "music" | "extend" | "motion";
const visualTools: Array<{ id: VisualTool; label: string; icon: NavIconName; prompt: string; note: string; comingSoon?: boolean }> = [
  { id: "image", label: "Image", icon: "image", prompt: "Describe the image you want to create…", note: "Create a still image with the local Diffusers engine or a ComfyUI workflow." },
  { id: "edit", label: "Edit", icon: "sparkle", prompt: "Describe how to change this image…", note: "Edit a chosen image with local Diffusers or a ComfyUI image workflow." },
  { id: "cutout", label: "Cutout", icon: "close", prompt: "Describe the subject to isolate…", note: "Use a ComfyUI segmentation workflow with an optional source image." },
  { id: "enhance", label: "Enhance", icon: "activity", prompt: "Describe the details to improve…", note: "Use an image restoration or upscaling workflow from your local ComfyUI install." },
  { id: "erase", label: "Erase", icon: "close", prompt: "Describe what to remove…", note: "Use a local inpainting workflow; choose the source image it should edit." },
  { id: "video", label: "Video", icon: "activity", prompt: "Describe a scene to animate…", note: "Video creation is planned for a future Visuals Workshop update.", comingSoon: true },
  { id: "animate", label: "Animate", icon: "activity", prompt: "Describe the motion…", note: "Use a local ComfyUI animation workflow; image-conditioned workflows can use a source image." },
  { id: "character", label: "Character", icon: "model", prompt: "Describe the character and scene…", note: "Use a character generation workflow installed in local ComfyUI." },
  { id: "lipsync", label: "Lipsync", icon: "audio", prompt: "Describe the performance…", note: "Use a local lipsync workflow; its required audio or video inputs must be available to ComfyUI." },
  { id: "music", label: "Music", icon: "audio", prompt: "Describe the music you want to hear…", note: "Music creation is planned for a future Visuals Workshop update.", comingSoon: true },
  { id: "extend", label: "Extend", icon: "arrow-right", prompt: "Describe how the scene should continue…", note: "Use a local ComfyUI video continuation workflow." },
  { id: "motion", label: "Motion", icon: "activity", prompt: "Describe the motion path…", note: "Use a local ComfyUI motion-control workflow." },
];

function checkpointWorkflow(checkpoint: string, mode: WorkflowMode) {
  const base = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["1", 1] } },
  };
  const graph = mode === "generate"
    ? {
      ...base,
      "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
      "5": { class_type: "KSampler", inputs: { seed: "{{seed}}", steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": { class_type: "SaveImage", inputs: { filename_prefix: "Skai", images: ["6", 0] } },
    }
    : {
      ...base,
      "4": { class_type: "LoadImage", inputs: { image: "{{image}}" } },
      "5": { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["1", 2] } },
      "6": { class_type: "KSampler", inputs: { seed: "{{seed}}", steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 0.55, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["5", 0] } },
      "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
      "8": { class_type: "SaveImage", inputs: { filename_prefix: "Skai-edit", images: ["7", 0] } },
    };
  return JSON.stringify(graph, null, 2);
}

const maxReopenedImageBytes = 6 * 1024 * 1024;

async function imageHistorySource(image: ImageResult): Promise<ChatAttachment> {
  if (image.url.startsWith("data:image/png;base64,") || image.url.startsWith("data:image/jpeg;base64,")) {
    const [, content = ""] = image.url.split(",", 2);
    if (!content || content.length > maxReopenedImageBytes * 2) throw new Error("This saved image is too large to reopen for local editing.");
    return { fileName: image.fileName, mediaType: image.url.slice(5, image.url.indexOf(";")), content };
  }

  let parsed: URL;
  try { parsed = new URL(image.url); } catch { throw new Error("This saved image has an invalid local output URL."); }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("Only images still available from a local runtime can be reopened for editing.");
  const response = await fetch(parsed);
  if (!response.ok) throw new Error(`The local image output is no longer available (${response.status}).`);
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size > maxReopenedImageBytes) throw new Error("The local image output is too large to reopen for editing.");
  if (blob.type !== "image/png" && blob.type !== "image/jpeg") throw new Error("The local image output is not a supported PNG or JPEG.");
  return { fileName: image.fileName, mediaType: blob.type, content: await blobToBase64(blob) };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const value = String(reader.result ?? ""); resolve(value.slice(value.indexOf(",") + 1)); };
    reader.onerror = () => reject(reader.error ?? new Error("The local image output could not be read."));
    reader.readAsDataURL(blob);
  });
}

type ImageProvider = "comfyui" | "diffusers";
type ImageRuntime = { workerAvailable: boolean; dependenciesAvailable: boolean; backgroundRemovalAvailable?: boolean; pythonCommand: string; status: string; message: string };
type ImageRuntimeInstall = { id: string; status: string; progress: string[]; error?: string | null };

export function ImagesPage({ provider, endpoint, prompt, workflow, busy, cancelRequested, progress, images, onChange, onGenerate, onCancel, onImportWorkflow, onPickSourceImage }: { provider: string; endpoint: string; prompt: string; workflow: string; busy: boolean; cancelRequested: boolean; progress: string[]; images: ImageResult[]; onChange: (key: "endpoint" | "prompt" | "workflow" | "provider", value: string) => void; onGenerate: (source?: ChatAttachment, options?: { provider: ImageProvider; prompt: string }) => void; onCancel: () => Promise<boolean>; onImportWorkflow: () => Promise<Workflow | null>; onPickSourceImage: () => Promise<ChatAttachment | null> }) {
  const selectedProvider: ImageProvider = provider === "diffusers" ? "diffusers" : "comfyui";
  const [activeTool, setActiveTool] = useState<VisualTool>(() => {
    const stored = localStorage.getItem("skai.visuals.tool");
    return visualTools.some((item) => item.id === stored && !item.comingSoon) ? stored as VisualTool : "image";
  });
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [toolWorkflows, setToolWorkflows] = useState<Record<string, string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("skai.visuals.workflows") ?? "{}") as unknown;
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter((item): item is [string, string] => typeof item[1] === "string").slice(0, visualTools.length))
        : {};
    } catch { return {}; }
  });
  const activeToolDetails = visualTools.find((item) => item.id === activeTool) ?? visualTools[0];
  const usesBuiltInImageEngine = activeTool === "image" || activeTool === "edit";
  const generationProvider: ImageProvider = usesBuiltInImageEngine ? selectedProvider : "comfyui";
  const [selectedImage, setSelectedImage] = useState<ImageResult | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [selectedWorkflowName, setSelectedWorkflowName] = useState("");
  const [importingWorkflow, setImportingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [checkpoint, setCheckpoint] = useState("");
  const [discoveringCheckpoints, setDiscoveringCheckpoints] = useState(false);
  const [sourceImage, setSourceImage] = useState<ChatAttachment | null>(null);
  const [selectingImage, setSelectingImage] = useState(false);
  const [reopeningImage, setReopeningImage] = useState(false);
  const [imageRuntime, setImageRuntime] = useState<ImageRuntime | null>(null);
  const [imageRuntimeInstall, setImageRuntimeInstall] = useState<ImageRuntimeInstall | null>(null);
  const [imageRuntimeBusy, setImageRuntimeBusy] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<Workflow[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("skai.image.workflows") ?? "[]") as unknown;
      return Array.isArray(value) ? value.filter((item): item is Workflow => Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" && typeof (item as { workflow?: unknown }).workflow === "string")).slice(0, 12) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("skai.image.workflows", JSON.stringify(savedWorkflows)); }, [savedWorkflows]);
  useEffect(() => { void refreshImageRuntime(); }, []);
  useEffect(() => {
    setToolWorkflows((current) => {
      if (current[activeTool] === workflow) return current;
      const next = { ...current, [activeTool]: workflow };
      localStorage.setItem("skai.visuals.workflows", JSON.stringify(next));
      return next;
    });
  }, [activeTool, workflow]);
  const promptRecipes = [
    { title: "Product scene", prompt: "A clean studio product photograph with soft directional light, subtle shadows, and a refined editorial backdrop." },
    { title: "Character portrait", prompt: "A cinematic character portrait with expressive lighting, detailed materials, and a calm atmospheric background." },
    { title: "Concept landscape", prompt: "A wide concept-art landscape with layered depth, dramatic natural light, and a strong visual focal point." },
  ];
  const refreshImageRuntime = async () => { try { const response: AgentResponse | undefined = await window.skaiAgent?.request("image.runtime.status"); if (response?.ok) setImageRuntime(response.result as ImageRuntime); } catch { /* The status card stays informative if Agent Host is offline. */ } };
  const installImageRuntime = async () => { if (imageRuntimeBusy || imageRuntimeInstall?.status === "running") return; setImageRuntimeBusy(true); setWorkflowError(null); try { const response = await window.skaiAgent?.request("image.runtime.install.start"); if (!response?.ok) throw new Error(response?.error?.message ?? "Local image runtime setup could not start."); let session = response.result as ImageRuntimeInstall; setImageRuntimeInstall(session); for (let attempt = 0; attempt < 1800 && session.status === "running"; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 1000)); const status = await window.skaiAgent?.request("image.runtime.install.status", { id: session.id }); if (!status?.ok) throw new Error(status?.error?.message ?? "Local image runtime setup status was unavailable."); session = status.result as ImageRuntimeInstall; setImageRuntimeInstall(session); } if (session.status === "failed") throw new Error(session.error ?? "Local image runtime setup failed."); await refreshImageRuntime(); } catch (error) { setWorkflowError(error instanceof Error ? error.message : "Local image runtime setup failed."); } finally { setImageRuntimeBusy(false); } };
  const cancelImageRuntimeInstall = async () => { if (!imageRuntimeInstall?.id) return; const response = await window.skaiAgent?.request("image.runtime.install.cancel", { id: imageRuntimeInstall.id }); if (response?.ok) setImageRuntimeInstall(response.result as ImageRuntimeInstall); };
  const readiness = busy ? { label: "Generating", tone: "warning" as const, detail: `ComfyUI is processing the ${activeToolDetails.label.toLowerCase()} workflow.` } : !prompt.trim() ? { label: "Prompt required", tone: "warning" as const, detail: "Describe what you want to create." } : generationProvider === "diffusers" ? imageRuntime?.dependenciesAvailable ? { label: "Ready", tone: "success" as const, detail: sourceImage ? "Stable Diffusion Turbo will edit this image locally." : "Stable Diffusion Turbo will run on this computer." } : { label: "Runtime setup needed", tone: "warning" as const, detail: "Install the optional local Diffusers runtime to generate images." } : !endpoint.trim() ? { label: "Endpoint required", tone: "warning" as const, detail: "Add the address of your local ComfyUI instance." } : !workflow.trim() || !workflow.includes("{{prompt}}") ? { label: "Workflow required", tone: "warning" as const, detail: "Choose or import a ComfyUI API workflow with a {{prompt}} input." } : workflow.includes("{{image}}") && !sourceImage ? { label: "Source image required", tone: "warning" as const, detail: "This workflow needs a source image. Choose one below." } : sourceImage && !workflow.includes("{{image}}") ? { label: "Workflow input missing", tone: "warning" as const, detail: "This workflow does not accept the selected source image." } : { label: "Ready", tone: "success" as const, detail: "Your local ComfyUI workflow is ready to run." };
  const saveWorkflow = () => { const name = workflowName.trim(); if (!name || !workflow.trim()) return; const savedName = name.slice(0, 80); setSavedWorkflows((current) => [{ name: savedName, workflow }, ...current.filter((item) => item.name !== savedName)].slice(0, 12)); setSelectedWorkflowName(savedName); setWorkflowName(""); };
  const discoverCheckpoints = async () => { if (discoveringCheckpoints) return; setDiscoveringCheckpoints(true); setWorkflowError(null); try { const response: AgentResponse | undefined = await window.skaiAgent?.request("image.models.list", { endpoint }); if (!response?.ok) throw new Error(response?.error?.message ?? "The local ComfyUI checkpoint list is unavailable."); const checkpointValue = (response.result as { checkpoints?: unknown }).checkpoints; const discovered = Array.isArray(checkpointValue) ? checkpointValue.filter((value: unknown): value is string => typeof value === "string") : []; setCheckpoints(discovered); setCheckpoint((current) => discovered.includes(current) ? current : discovered[0] ?? ""); if (discovered.length === 0) setWorkflowError("ComfyUI is reachable, but it reported no installed checkpoints."); } catch (error) { setCheckpoints([]); setCheckpoint(""); setWorkflowError(error instanceof Error ? error.message : "Local checkpoints could not be discovered."); } finally { setDiscoveringCheckpoints(false); } };
  const buildWorkflow = (mode: WorkflowMode) => { if (!checkpoint) { setWorkflowError("Discover and select a local checkpoint first."); return; } const kind = mode === "edit" ? "Image edit" : "Text to image"; const name = `${kind} · ${checkpoint}`.slice(0, 80); const built = checkpointWorkflow(checkpoint, mode); setSavedWorkflows((current) => [{ name, workflow: built }, ...current.filter((item) => item.name !== name)].slice(0, 12)); setSelectedWorkflowName(name); setWorkflowName(name); setWorkflowError(null); onChange("workflow", built); };
  const importWorkflow = async () => { setWorkflowError(null); setImportingWorkflow(true); try { const imported = await onImportWorkflow(); if (!imported) return; setSavedWorkflows((current) => [{ name: imported.name, workflow: imported.workflow }, ...current.filter((item) => item.name !== imported.name)].slice(0, 12)); setSelectedWorkflowName(imported.name); setWorkflowName(imported.name); onChange("workflow", imported.workflow); } catch (error) { setWorkflowError(error instanceof Error ? error.message : "The workflow could not be imported."); } finally { setImportingWorkflow(false); } };
  const useHistoryImageForEdit = async () => {
    if (!selectedImage || reopeningImage) return;
    setReopeningImage(true);
    setWorkflowError(null);
    try {
      setSourceImage(await imageHistorySource(selectedImage));
      setSelectedImage(null);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "The saved local image could not be reopened for editing.");
    } finally { setReopeningImage(false); }
  };
  const chooseTool = (tool: VisualTool) => {
    const nextWorkflow = toolWorkflows[tool] ?? ((tool === "image" || tool === "edit") ? workflow : "");
    setActiveTool(tool);
    localStorage.setItem("skai.visuals.tool", tool);
    onChange("workflow", nextWorkflow);
    const selected = savedWorkflows.find((item) => item.workflow === nextWorkflow);
    setSelectedWorkflowName(selected?.name ?? "");
    setWorkflowName(selected?.name ?? "");
    setWorkflowSettingsOpen(tool !== "image" && tool !== "edit");
  };
  const setToolWorkflow = (value: string) => {
    setWorkflowError(null);
    setSelectedWorkflowName("");
    onChange("workflow", value);
  };
  const mediaTypeOf = (image: ImageResult) => image.mediaType ?? "image";
  const renderMedia = (image: ImageResult, inGallery = false) => mediaTypeOf(image) === "video"
    ? <video className={inGallery ? "visuals-gallery-media" : "visuals-output-media"} src={image.url} muted={inGallery} controls={!inGallery} playsInline preload={inGallery ? "metadata" : "auto"} aria-label={image.fileName} />
    : mediaTypeOf(image) === "audio"
      ? inGallery ? <span className="visuals-gallery-audio"><NavIcon name="audio" /></span> : <div className="visuals-audio-output"><NavIcon name="audio" /><strong>{image.fileName}</strong><audio src={image.url} controls preload="metadata" aria-label={`Play ${image.fileName}`} /></div>
      : <img className={inGallery ? "visuals-gallery-media" : "visuals-output-media"} src={image.url} alt={image.fileName} />;
  const canGenerate = Boolean(prompt.trim() && !busy && (generationProvider === "diffusers"
    ? imageRuntime?.dependenciesAvailable
    : endpoint.trim() && workflow.includes("{{prompt}}") && (!workflow.includes("{{image}}") || sourceImage) && (!sourceImage || workflow.includes("{{image}}"))));
  useEffect(() => { setSelectedImage(images[0] ?? null); }, [images]);
  return <div className="feature-page image-studio-page visuals-workshop-page">
    <nav className="visuals-toolstrip" aria-label="Visuals Workshop tools">{visualTools.map((tool) => <button key={tool.id} type="button" className={`visuals-tool-tab${activeTool === tool.id ? " is-active" : ""}${tool.comingSoon ? " is-coming-soon" : ""}`} disabled={tool.comingSoon} aria-pressed={activeTool === tool.id} title={tool.comingSoon ? `${tool.label} generation is coming soon` : undefined} onClick={() => chooseTool(tool.id)}><NavIcon name={tool.icon} /><span>{tool.label}</span>{tool.comingSoon && <small>Soon</small>}</button>)}</nav>
    <div className="visuals-main">
      <main className="visuals-stage" aria-label={`${activeToolDetails.label} workspace`}>
        <header className="visuals-stage-header"><div><p className="section-kicker">{activeToolDetails.label.toUpperCase()} WORKSPACE</p><strong>{selectedImage?.fileName ?? "Ready to create"}</strong></div><StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge></header>
        <section className={`visuals-canvas${selectedImage ? " has-output" : ""}`} aria-live="polite">
          {selectedImage ? <div className={`visuals-output visuals-output-${mediaTypeOf(selectedImage)}`}>{renderMedia(selectedImage)}<div className="visuals-output-caption"><span>{selectedImage.prompt || selectedImage.fileName}</span><div><a className="ui-button ui-button-secondary" href={selectedImage.url} download={selectedImage.fileName}>Download</a>{mediaTypeOf(selectedImage) === "image" && <Button variant="secondary" type="button" disabled={reopeningImage} onClick={() => void useHistoryImageForEdit()}>{reopeningImage ? "Opening…" : "Use for edit"}</Button>}</div></div></div> : busy ? <div className="visuals-generation-state"><span className="visuals-generation-spinner" aria-hidden="true" /><h2>{cancelRequested ? "Stopping safely" : `Creating ${activeToolDetails.label.toLowerCase()}`}</h2><p>{progress.at(-1) ?? "Waiting for the local runtime…"}</p>{progress.length > 1 && <small>{progress.at(-2)}</small>}</div> : <div className="visuals-empty-state"><span className="visuals-empty-mark"><NavIcon name={activeToolDetails.icon} /></span><h2>{activeTool === "video" ? "Describe a scene to animate" : activeTool === "music" ? "Describe the sound you want to make" : `${activeToolDetails.label} something new`}</h2><p>{activeToolDetails.note}</p><div className="visuals-suggestions">{(activeTool === "video" ? ["a wave breaking on rocks in slow motion, cinematic", "timelapse of clouds over a mountain range"] : activeTool === "music" ? ["warm ambient piano with soft tape texture", "upbeat electronic track with a deep bass line"] : promptRecipes.map((recipe) => recipe.prompt)).map((suggestion) => <button type="button" key={suggestion} onClick={() => onChange("prompt", suggestion)}>{suggestion}</button>)}</div></div>}
        </section>
      </main>
      <aside className="visuals-gallery" aria-label="Generated media gallery"><div className="visuals-gallery-heading"><NavIcon name="image" /><strong>Gallery</strong><span>{images.length}</span></div><div className="visuals-gallery-items">{images.length ? images.map((image) => <button key={`${image.createdAt ?? ""}:${image.url}`} type="button" className={`visuals-gallery-item${selectedImage?.url === image.url ? " is-selected" : ""}`} aria-label={`Open ${mediaTypeOf(image)} ${image.fileName}`} aria-pressed={selectedImage?.url === image.url} onClick={() => setSelectedImage(image)}>{renderMedia(image, true)}<small>{mediaTypeOf(image)}</small></button>) : <p className="visuals-gallery-empty">Your generated work appears here.</p>}</div></aside>
    </div>
    <section className="visuals-controls" aria-label="Generation controls">
      <div className="visuals-control-summary"><span>{activeToolDetails.note}</span>{usesBuiltInImageEngine ? <label>Image engine<select value={selectedProvider} onChange={(event) => onChange("provider", event.target.value)}><option value="diffusers">Stable Diffusion Turbo</option><option value="comfyui">ComfyUI workflow</option></select></label> : <StatusBadge tone="neutral">Local ComfyUI workflow</StatusBadge>}</div>
      {sourceImage && <div className="visuals-source-image"><span>Source image: {sourceImage.fileName}</span><Button variant="ghost" type="button" disabled={busy} onClick={() => setSourceImage(null)}>Remove source</Button></div>}
      <label className="sr-only" htmlFor="visuals-prompt">{activeToolDetails.label} prompt</label><textarea id="visuals-prompt" value={prompt} onChange={(event) => onChange("prompt", event.target.value)} maxLength={8000} rows={2} placeholder={activeToolDetails.prompt} disabled={busy} />
      <div className="visuals-composer-footer"><div className="visuals-composer-options"><Button variant="secondary" type="button" disabled={selectingImage || busy} onClick={() => { setSelectingImage(true); void onPickSourceImage().then(setSourceImage).catch((error) => setWorkflowError(error instanceof Error ? error.message : "Image selection failed.")).finally(() => setSelectingImage(false)); }}>{selectingImage ? "Selecting…" : sourceImage ? "Replace source" : "Add source image"}</Button><details className="visuals-workflow-settings" open={workflowSettingsOpen} onToggle={(event) => setWorkflowSettingsOpen(event.currentTarget.open)}><summary>Workflow settings</summary><div className="visuals-workflow-panel">
        {generationProvider === "diffusers" ? <div className="visuals-runtime-settings"><p><strong>Stable Diffusion Turbo · local inference</strong></p><p>{imageRuntime?.message ?? "Checking the optional image runtime…"} The first generation downloads model weights (about 5.2 GB); CPU generation is supported but may be slow.</p><div className="settings-model-actions"><StatusBadge tone={imageRuntimeInstall?.status === "running" ? "warning" : imageRuntime?.dependenciesAvailable ? "success" : imageRuntime ? "warning" : "neutral"}>{imageRuntimeInstall?.status === "running" ? "Installing" : imageRuntime?.status ?? "Checking"}</StatusBadge><Button variant="secondary" type="button" disabled={imageRuntimeBusy} onClick={() => void refreshImageRuntime()}>Check runtime</Button>{!imageRuntime?.dependenciesAvailable && <Button variant="primary" type="button" disabled={imageRuntimeBusy || imageRuntimeInstall?.status === "running"} onClick={() => void installImageRuntime()}>{imageRuntimeBusy ? "Installing…" : "Install local image runtime"}</Button>}{imageRuntimeInstall?.status === "running" && <Button variant="ghost" type="button" onClick={() => void cancelImageRuntimeInstall()}>Cancel setup</Button>}</div></div> : <>
          <label>Local ComfyUI endpoint<input value={endpoint} onChange={(event) => { setCheckpoints([]); setCheckpoint(""); onChange("endpoint", event.target.value); }} placeholder="http://127.0.0.1:8188" /></label>
          {(activeTool === "image" || activeTool === "edit") && <div className="image-checkpoint-builder"><div className="workflow-source-row"><label>Installed checkpoint<select value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} disabled={checkpoints.length === 0}><option value="">{checkpoints.length ? "Choose a local checkpoint…" : "Discover local checkpoints first"}</option>{checkpoints.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><Button variant="secondary" type="button" disabled={discoveringCheckpoints || !endpoint.trim()} onClick={() => void discoverCheckpoints()}>{discoveringCheckpoints ? "Discovering…" : "Discover checkpoints"}</Button></div><div className="workflow-source-row"><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("generate")}>Create image workflow</Button><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("edit")}>Create edit workflow</Button></div></div>}
          <div className="workflow-source-row"><label>Saved workflow<select value={selectedWorkflowName} onChange={(event) => { const selected = savedWorkflows.find((item) => item.name === event.target.value); setSelectedWorkflowName(event.target.value); if (selected) { setWorkflowName(selected.name); setToolWorkflow(selected.workflow); } }}><option value="">{savedWorkflows.length ? "Choose a saved workflow…" : "No saved workflows yet"}</option>{savedWorkflows.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><Button variant="secondary" type="button" disabled={importingWorkflow} onClick={() => void importWorkflow()}>{importingWorkflow ? "Importing…" : "Import workflow"}</Button></div>
          {workflowError && <p className="form-error" role="alert">{workflowError}</p>}
          <label>ComfyUI API workflow<textarea value={workflow} onChange={(event) => setToolWorkflow(event.target.value)} placeholder="Import a local ComfyUI API workflow containing {{prompt}}." rows={5} /><small>ComfyUI video and audio workflows work when their output nodes save supported files. Video and music model packs or custom nodes must be installed in your local ComfyUI first. Source-image workflows use {"{{image}}"}.</small><div className="workflow-save-row"><input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Workflow name" maxLength={80} aria-label="Workflow name" /><Button variant="secondary" type="button" disabled={!workflow.trim() || !workflowName.trim()} onClick={saveWorkflow}>Save workflow</Button></div></label>
        </>}
      </div></details></div><div className="visuals-composer-action">{busy ? <Button variant="secondary" type="button" disabled={cancelRequested} onClick={() => void onCancel()}>{cancelRequested ? "Stopping…" : "Cancel"}</Button> : <Button variant="primary" type="button" disabled={!canGenerate} onClick={() => onGenerate(sourceImage ?? undefined, { provider: generationProvider, prompt })}>{generationProvider === "diffusers" ? activeTool === "edit" ? "Edit image" : "Create image" : `Create ${activeToolDetails.label.toLowerCase()}`}<NavIcon name="sparkle" /></Button>}</div></div>
    </section>
  </div>;
}
