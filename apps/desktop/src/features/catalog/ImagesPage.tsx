import { useEffect, useState } from "react";
import { Button, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui/Primitives";
import { ModalDialog } from "../../components/ui/ModalDialog";
import type { AgentResponse } from "../../../shared/contracts";
import type { ChatAttachment } from "../../../shared/contracts";

type ImageResult = { url: string; fileName: string; provider?: ImageProvider; prompt?: string; createdAt?: string };
type Workflow = { name: string; workflow: string };
type WorkflowMode = "generate" | "edit";

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

export function ImagesPage({ provider, endpoint, prompt, workflow, busy, images, onChange, onGenerate, onImportWorkflow, onPickSourceImage }: { provider: string; endpoint: string; prompt: string; workflow: string; busy: boolean; images: ImageResult[]; onChange: (key: "endpoint" | "prompt" | "workflow" | "provider", value: string) => void; onGenerate: (source?: ChatAttachment) => void; onImportWorkflow: () => Promise<Workflow | null>; onPickSourceImage: () => Promise<ChatAttachment | null> }) {
  const selectedProvider: ImageProvider = provider === "diffusers" ? "diffusers" : "comfyui";
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
  const promptRecipes = [
    { title: "Product scene", prompt: "A clean studio product photograph with soft directional light, subtle shadows, and a refined editorial backdrop." },
    { title: "Character portrait", prompt: "A cinematic character portrait with expressive lighting, detailed materials, and a calm atmospheric background." },
    { title: "Concept landscape", prompt: "A wide concept-art landscape with layered depth, dramatic natural light, and a strong visual focal point." },
  ];
  const refreshImageRuntime = async () => { try { const response: AgentResponse | undefined = await window.skaiAgent?.request("image.runtime.status"); if (response?.ok) setImageRuntime(response.result as ImageRuntime); } catch { /* The status card stays informative if Agent Host is offline. */ } };
  const installImageRuntime = async () => { if (imageRuntimeBusy || imageRuntimeInstall?.status === "running") return; setImageRuntimeBusy(true); setWorkflowError(null); try { const response = await window.skaiAgent?.request("image.runtime.install.start"); if (!response?.ok) throw new Error(response?.error?.message ?? "Local image runtime setup could not start."); let session = response.result as ImageRuntimeInstall; setImageRuntimeInstall(session); for (let attempt = 0; attempt < 1800 && session.status === "running"; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 1000)); const status = await window.skaiAgent?.request("image.runtime.install.status", { id: session.id }); if (!status?.ok) throw new Error(status?.error?.message ?? "Local image runtime setup status was unavailable."); session = status.result as ImageRuntimeInstall; setImageRuntimeInstall(session); } if (session.status === "failed") throw new Error(session.error ?? "Local image runtime setup failed."); await refreshImageRuntime(); } catch (error) { setWorkflowError(error instanceof Error ? error.message : "Local image runtime setup failed."); } finally { setImageRuntimeBusy(false); } };
  const cancelImageRuntimeInstall = async () => { if (!imageRuntimeInstall?.id) return; const response = await window.skaiAgent?.request("image.runtime.install.cancel", { id: imageRuntimeInstall.id }); if (response?.ok) setImageRuntimeInstall(response.result as ImageRuntimeInstall); };
  const readiness = busy ? { label: "Generating", tone: "warning" as const, detail: selectedProvider === "diffusers" ? "Stable Diffusion is generating locally." : "ComfyUI is processing the current workflow." } : !prompt.trim() ? { label: "Prompt required", tone: "warning" as const, detail: "Describe the image you want to create." } : selectedProvider === "diffusers" ? imageRuntime?.dependenciesAvailable ? { label: "Ready", tone: "success" as const, detail: sourceImage ? "Stable Diffusion Turbo will edit this image locally." : "Stable Diffusion Turbo will run on this computer." } : { label: "Runtime setup needed", tone: "warning" as const, detail: "Install the optional local Diffusers runtime to generate images." } : !endpoint.trim() ? { label: "Endpoint required", tone: "warning" as const, detail: "Add the address of your local ComfyUI instance." } : !workflow.trim() ? { label: "Workflow required", tone: "warning" as const, detail: "Build a workflow from a local checkpoint or import a ComfyUI API workflow." } : workflow.includes("{{image}}") && !sourceImage ? { label: "Source image required", tone: "warning" as const, detail: "This workflow has an image input. Choose the source image you want it to edit." } : { label: "Ready", tone: "success" as const, detail: "The local image bridge has everything it needs to run." };
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
  return <div className="feature-page image-studio-page">
    <PageHeader eyebrow="IMAGE STUDIO" title="Create visual work" description="A creative local workspace for prompts, saved workflows, and generated outputs." actions={<StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>} />
    <div className="image-studio-layout">
      <Card className="form-card image-editor-card"><div className="studio-panel-heading"><div><p className="section-kicker">LOCAL IMAGE WORKSPACE</p><h3>Create or edit an image</h3></div><label className="image-provider-picker">Image engine<select value={selectedProvider} onChange={(event) => onChange("provider", event.target.value)}><option value="diffusers">Stable Diffusion Turbo · built in</option><option value="comfyui">ComfyUI · workflow</option></select></label></div><div className="form-grid">
        <label>Prompt<textarea value={prompt} onChange={(event) => onChange("prompt", event.target.value)} placeholder="Describe what you want to create…" rows={5} aria-describedby="image-prompt-help" /><small id="image-prompt-help">Use a recipe below as a starting point, then make it yours.</small></label>
        <div className="prompt-recipes" aria-label="Prompt recipes"><span className="field-caption">START WITH A RECIPE</span><div>{promptRecipes.map((recipe) => <Button key={recipe.title} variant="ghost" className="prompt-recipe" onClick={() => onChange("prompt", recipe.prompt)}>{recipe.title}</Button>)}</div></div>
        {selectedProvider === "diffusers" && <div className="settings-callout image-runtime-callout"><strong>Stable Diffusion Turbo · local inference</strong><span>{imageRuntime?.message ?? "Checking the optional image runtime…"} The first generation downloads model weights (about 5.2 GB); generation runs on this computer. CPU generation is supported but may be slow. {imageRuntime?.dependenciesAvailable && (imageRuntime.backgroundRemovalAvailable ? "Pet Workshop background removal is ready." : "Install the local pet image tools to enable background removal in Pet Workshop; U2Net model weights download only when you first remove a background.")}</span><div className="settings-model-actions"><StatusBadge tone={imageRuntimeInstall?.status === "running" ? "warning" : imageRuntime?.dependenciesAvailable ? "success" : imageRuntime ? "warning" : "neutral"}>{imageRuntimeInstall?.status === "running" ? "Installing" : imageRuntime?.status ?? "Checking"}</StatusBadge><Button variant="secondary" disabled={imageRuntimeBusy} onClick={() => void refreshImageRuntime()}>Check runtime</Button>{(!imageRuntime?.dependenciesAvailable || !imageRuntime.backgroundRemovalAvailable) && <Button variant="primary" disabled={imageRuntimeBusy || imageRuntimeInstall?.status === "running"} onClick={() => void installImageRuntime()}>{imageRuntimeBusy ? "Installing…" : imageRuntime?.dependenciesAvailable ? "Install pet image tools" : "Install optional runtime"}</Button>}{imageRuntimeInstall?.status === "running" && <Button variant="ghost" onClick={() => void cancelImageRuntimeInstall()}>Cancel setup</Button>}</div>{imageRuntimeInstall && <div className={`airllm-install-log${imageRuntimeInstall.status === "failed" ? " is-error" : ""}`} role="status" aria-live="polite">{imageRuntimeInstall.error && <strong>{imageRuntimeInstall.error}</strong>}{imageRuntimeInstall.progress.slice(-4).map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>}</div>}
        <div className="workflow-source-row"><span>{sourceImage ? `Editing from ${sourceImage.fileName}` : "Optional source image for editing"}</span><Button variant="secondary" type="button" disabled={selectingImage} onClick={() => { setSelectingImage(true); void onPickSourceImage().then(setSourceImage).catch((error) => setWorkflowError(error instanceof Error ? error.message : "Image selection failed.")).finally(() => setSelectingImage(false)); }}>{selectingImage ? "Selecting…" : sourceImage ? "Replace image" : "Choose image"}</Button>{sourceImage && <Button variant="ghost" type="button" onClick={() => setSourceImage(null)}>Remove</Button>}</div>
        {selectedProvider === "comfyui" && <>
        <details className="image-workflow-details"><summary><span>Generation setup</span><small>Local endpoint, checkpoints, and workflows</small></summary><label>ComfyUI endpoint<input value={endpoint} onChange={(event) => { setCheckpoints([]); setCheckpoint(""); onChange("endpoint", event.target.value); }} placeholder="http://127.0.0.1:8188" aria-describedby="image-endpoint-help" /><small id="image-endpoint-help">The local address where ComfyUI is listening.</small></label>
          <div className="image-checkpoint-builder"><div className="workflow-source-row"><label>Installed checkpoint<select value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} disabled={checkpoints.length === 0}><option value="">{checkpoints.length ? "Choose a local checkpoint…" : "Discover local checkpoints first"}</option>{checkpoints.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><Button variant="secondary" type="button" disabled={discoveringCheckpoints || !endpoint.trim()} onClick={() => void discoverCheckpoints()}>{discoveringCheckpoints ? "Discovering…" : "Discover checkpoints"}</Button></div><p>Build a basic local workflow from one of ComfyUI’s installed checkpoints. Advanced API workflows can still be imported below.</p><div className="workflow-source-row"><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("generate")}>Create text-to-image workflow</Button><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("edit")}>Create image-edit workflow</Button></div></div>
          <div className="workflow-source-row"><label>Saved workflow<select value={selectedWorkflowName} onChange={(event) => { const selected = savedWorkflows.find((item) => item.name === event.target.value); setSelectedWorkflowName(event.target.value); if (selected) { setWorkflowName(selected.name); onChange("workflow", selected.workflow); } }}><option value="">{savedWorkflows.length ? "Choose a saved workflow…" : "No saved workflows yet"}</option>{savedWorkflows.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><Button variant="secondary" type="button" disabled={importingWorkflow} onClick={() => void importWorkflow()}>{importingWorkflow ? "Importing…" : "Import workflow"}</Button></div>
          {workflowError && <p className="form-error" role="alert">{workflowError}</p>}
          <label>Workflow JSON<textarea value={workflow} onChange={(event) => { setWorkflowError(null); setSelectedWorkflowName(""); onChange("workflow", event.target.value); }} placeholder="Build a workflow above or paste a ComfyUI API workflow." rows={6} aria-describedby="image-workflow-help" /><small id="image-workflow-help">Generated workflows use a fresh random seed for each run. For edits, the workflow must include {"{{image}}"} and {"{{prompt}}"}; the source image is uploaded to local ComfyUI for this run.</small><div className="workflow-save-row"><input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Workflow name" maxLength={80} aria-label="Workflow name" /><Button variant="secondary" type="button" disabled={!workflow.trim() || !workflowName.trim()} onClick={saveWorkflow}>Save workflow</Button></div></label>
        </details>
        </>}
      </div><div className="studio-readiness"><StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge><span>{readiness.detail}</span></div><div className="form-footer"><span>{selectedProvider === "diffusers" ? sourceImage ? "Edits run locally with Stable Diffusion Turbo." : "First generation downloads the selected model locally." : sourceImage ? "Edit workflow needs {{image}} and {{prompt}}." : "Outputs stay in this local workspace history."}</span><Button variant="primary" disabled={busy || !prompt.trim() || (selectedProvider === "diffusers" ? !imageRuntime?.dependenciesAvailable : !endpoint.trim() || !workflow.trim() || Boolean(workflow.includes("{{image}}") && !sourceImage) || Boolean(sourceImage && !workflow.includes("{{image}}")))} onClick={() => onGenerate(sourceImage ?? undefined)}>{busy ? "Generating…" : sourceImage ? "Edit image" : "Generate image"}</Button></div></Card>
      <Card className="image-history"><div className="panel-heading"><div><p className="section-kicker">GENERATION HISTORY</p><h3>Recent outputs</h3></div><span className="panel-count">{images.length}</span></div>{images.length === 0 ? <EmptyState title="No generated images" description="Your local outputs will appear here after a successful generation." /> : <div className="image-gallery">{images.map((image) => <button className="image-result" key={image.url} type="button" onClick={() => setSelectedImage(image)}><img src={image.url} alt={image.fileName} /><span>{image.fileName}</span></button>)}</div>}</Card>
    </div>
    <ModalDialog open={Boolean(selectedImage)} onClose={() => setSelectedImage(null)} titleId="image-preview-title" className="ui-dialog image-preview-dialog"><div className="dialog-heading"><div><p className="section-kicker">OUTPUT INSPECTOR</p><h3 id="image-preview-title">{selectedImage?.fileName ?? "Image preview"}</h3><p>Generated locally with {(selectedImage?.provider ?? selectedProvider) === "diffusers" ? "Stable Diffusion Turbo" : "the ComfyUI workflow"}.</p>{selectedImage?.prompt && <p>{selectedImage.prompt}</p>}</div><button type="button" onClick={() => setSelectedImage(null)} aria-label="Close image preview">×</button></div>{selectedImage && <img className="image-preview-full" src={selectedImage.url} alt={selectedImage.fileName} />}<div className="dialog-actions"><Button variant="ghost" type="button" onClick={() => setSelectedImage(null)}>Close</Button>{selectedImage && <Button variant="secondary" type="button" disabled={reopeningImage} onClick={() => void useHistoryImageForEdit()}>{reopeningImage ? "Opening…" : "Use for edit"}</Button>}{selectedImage && <a className="ui-button ui-button-secondary" href={selectedImage.url} download={selectedImage.fileName}>Download image</a>}</div></ModalDialog>
  </div>;
}
