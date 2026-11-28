import { useEffect, useRef, useState } from "react";
import { Button, StatusBadge } from "../../components/ui/Primitives";
import type { AgentResponse, ChatAttachment } from "../../../shared/contracts";
import { NavIcon, type NavIconName } from "../../components/ui/NavIcon";
import "./ImagesGenerationBrief.css";
import "./ImagesContactSheet.css";

type ImageResult = { url: string; fileName: string; mediaType?: "image" | "video" | "audio"; provider?: ImageProvider; prompt?: string; createdAt?: string; model?: string; seed?: number; width?: number; height?: number; workflow?: string; origin?: "generated" | "edited" | "imported" | "user-authored" };
type Workflow = { name: string; workflow: string };
type VisualPreset = { id: string; name: string; tool: VisualTool; prompt: string; provider: ImageProvider; workflow: string };
type VisualJob = { id: string; prompt: string; source?: ChatAttachment; options: { provider: ImageProvider; prompt: string; workflow?: string; model?: string; seed?: number; width?: number; height?: number }; status: "queued" | "running" | "completed" | "failed" | "cancelled"; error?: string };
type WorkflowMode = "generate" | "edit";
type VisualTool = "image" | "edit" | "cutout" | "enhance" | "erase" | "video" | "animate" | "character" | "lipsync" | "music" | "extend" | "motion";
type GalleryFilter = "all" | "image" | "video" | "audio";
const visualTools: Array<{ id: VisualTool; label: string; icon: NavIconName; prompt: string; note: string; comingSoon?: boolean }> = [
  { id: "image", label: "Generate", icon: "image", prompt: "Describe the image you want to create…", note: "Create a still image with the local Diffusers engine or a ComfyUI workflow." },
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
const visualPresetsKey = "skai.visuals.presets.v1";
const visualJobsKey = "skai.visuals.jobs.v1";

function readVisualPresets(): VisualPreset[] {
  try {
    const value = JSON.parse(localStorage.getItem(visualPresetsKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VisualPreset => Boolean(item && typeof item === "object"
      && typeof (item as VisualPreset).id === "string" && typeof (item as VisualPreset).name === "string"
      && visualTools.some((tool) => tool.id === (item as VisualPreset).tool && !tool.comingSoon)
      && typeof (item as VisualPreset).prompt === "string" && typeof (item as VisualPreset).workflow === "string"
      && (item as VisualPreset).workflow.length <= 100_000
      && ["comfyui", "diffusers"].includes((item as VisualPreset).provider))).slice(0, 12);
  } catch { return []; }
}

function workflowModelAndSize(workflow: string) {
  let model: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let seed: number | undefined;
  try {
    const graph = JSON.parse(workflow) as Record<string, { inputs?: Record<string, unknown> }>;
    for (const node of Object.values(graph)) {
      const inputs = node?.inputs;
      if (!inputs) continue;
      if (!model && typeof inputs.ckpt_name === "string") model = inputs.ckpt_name;
      if (!width && typeof inputs.width === "number") width = inputs.width;
      if (!height && typeof inputs.height === "number") height = inputs.height;
      if (seed === undefined && typeof inputs.seed === "number") seed = inputs.seed;
    }
  } catch { /* Keep metadata optional for a custom workflow that is not plain JSON. */ }
  return { model, width, height, seed };
}

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
type GenerationBrief = { subject: string; composition: string; style: string; motion: string; exclusions: string; constraints: string };

function readVisualJobs(): VisualJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(visualJobsKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is VisualJob => {
      if (!item || typeof item !== "object") return false;
      const job = item as VisualJob;
      const options = job.options;
      return typeof job.id === "string" && job.id.length <= 100
        && typeof job.prompt === "string" && job.prompt.length <= 8_000
        && ["queued", "running", "completed", "failed", "cancelled"].includes(job.status)
        && Boolean(options && typeof options === "object" && ["comfyui", "diffusers"].includes(options.provider)
          && typeof options.prompt === "string" && options.prompt.length <= 8_000
          && (options.workflow === undefined || (typeof options.workflow === "string" && options.workflow.length <= 100_000)));
    }).slice(-12).map((job) => job.status === "running"
      ? { ...job, status: "failed" as const, error: "Skai closed before this generation finished. Review the job and retry." }
      : job);
  } catch { return []; }
}

export function ImagesPage({ provider, endpoint, prompt, workflow, busy, cancelRequested, progress, images, onChange, onGenerate, onCancel, onImportWorkflow, onPickSourceImage }: { provider: string; endpoint: string; prompt: string; workflow: string; busy: boolean; cancelRequested: boolean; progress: string[]; images: ImageResult[]; onChange: (key: "endpoint" | "prompt" | "workflow" | "provider", value: string) => void; onGenerate: (source?: ChatAttachment, options?: { provider: ImageProvider; prompt: string; workflow?: string; model?: string; seed?: number; width?: number; height?: number }) => Promise<boolean>; onCancel: () => Promise<boolean>; onImportWorkflow: () => Promise<Workflow | null>; onPickSourceImage: () => Promise<ChatAttachment | null> }) {
  const selectedProvider: ImageProvider = provider === "diffusers" ? "diffusers" : "comfyui";
  const [activeTool, setActiveTool] = useState<VisualTool>(() => {
    const stored = localStorage.getItem("skai.visuals.tool");
    return visualTools.some((item) => item.id === stored && !item.comingSoon) ? stored as VisualTool : "image";
  });
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
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
  const [localMedia, setLocalMedia] = useState<ImageResult[]>([]);
  const localMediaInputRef = useRef<HTMLInputElement>(null);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>("all");
  const preserveImageSelectionRef = useRef(false);
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
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [contactSelection, setContactSelection] = useState<string[]>([]);
  const [savedPresets, setSavedPresets] = useState<VisualPreset[]>(readVisualPresets);
  const [batchSize, setBatchSize] = useState(1);
  const [seedLocked, setSeedLocked] = useState(() => localStorage.getItem("skai.visuals.seedLocked") === "true");
  const [lockedSeed, setLockedSeed] = useState(() => {
    const parsed = Number(localStorage.getItem("skai.visuals.lockedSeed"));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 42;
  });
  const [variation, setVariation] = useState(() => {
    const parsed = Number(localStorage.getItem("skai.visuals.variation"));
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  });
  const [generationBrief, setGenerationBrief] = useState<GenerationBrief>({ subject: "", composition: "", style: "", motion: "", exclusions: "", constraints: "" });
  const [generationBriefOpen, setGenerationBriefOpen] = useState(false);
  const [visualJobs, setVisualJobs] = useState<VisualJob[]>(readVisualJobs);
  const visualJobsRef = useRef<VisualJob[]>(visualJobs);
  const queueRunnerRef = useRef(false);
  const [activeVisualJobId, setActiveVisualJobId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
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
  useEffect(() => { localStorage.setItem(visualPresetsKey, JSON.stringify(savedPresets)); }, [savedPresets]);
  useEffect(() => { localStorage.setItem(visualJobsKey, JSON.stringify(visualJobs)); }, [visualJobs]);
  useEffect(() => { localStorage.setItem("skai.visuals.seedLocked", String(seedLocked)); }, [seedLocked]);
  useEffect(() => { localStorage.setItem("skai.visuals.lockedSeed", String(lockedSeed)); }, [lockedSeed]);
  useEffect(() => { localStorage.setItem("skai.visuals.variation", String(variation)); }, [variation]);
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
    preserveImageSelectionRef.current = true;
    setReopeningImage(true);
    setWorkflowError(null);
    try {
      setSourceImage(await imageHistorySource(selectedImage));
      setSelectedImage(null);
      chooseTool("edit");
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "The saved local image could not be reopened for editing.");
    } finally { setReopeningImage(false); }
  };
  const chooseTool = (tool: VisualTool) => {
    if (tool !== "edit") preserveImageSelectionRef.current = false;
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
  const saveVisualPreset = () => {
    const name = presetName.trim().slice(0, 80);
    if (!name || workflow.length > 100_000) return;
    const preset: VisualPreset = { id: crypto.randomUUID(), name, tool: activeTool, prompt, provider: selectedProvider, workflow };
    setSavedPresets((current) => [preset, ...current.filter((item) => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase())].slice(0, 12));
    setSelectedPresetId(preset.id);
    setPresetName("");
  };
  const applyVisualPreset = (preset: VisualPreset) => {
    setSelectedPresetId(preset.id);
    setActiveTool(preset.tool);
    localStorage.setItem("skai.visuals.tool", preset.tool);
    onChange("provider", preset.provider);
    onChange("workflow", preset.workflow);
    onChange("prompt", preset.prompt);
    const saved = savedWorkflows.find((item) => item.workflow === preset.workflow);
    setSelectedWorkflowName(saved?.name ?? "");
    setWorkflowName(saved?.name ?? "");
    setWorkflowSettingsOpen(preset.provider === "comfyui" && Boolean(preset.workflow.trim()));
  };
  const mediaTypeOf = (image: ImageResult) => image.mediaType ?? "image";
  const provenanceOf = (image: ImageResult) => image.origin ?? (localMedia.includes(image) ? "imported" : image.provider ? "generated" : "user-authored");
  const allGalleryImages = [...localMedia, ...images];
  const galleryImages = galleryFilter === "all" ? allGalleryImages : allGalleryImages.filter((image) => mediaTypeOf(image) === galleryFilter);
  const contactSheetImages = galleryImages.filter((image) => contactSelection.includes(image.url));
  const toggleContactSelection = (image: ImageResult) => setContactSelection((current) => current.includes(image.url) ? current.filter((url) => url !== image.url) : [...current, image.url].slice(-6));
  const importLocalMedia = async (files: FileList | null) => {
    if (!files?.length) return;
    const supported = [...files].filter((file) => /^(image|video|audio)\//.test(file.type)).slice(0, 6);
    const imported: ImageResult[] = [];
    for (const file of supported) {
      if (file.size > 12 * 1024 * 1024) continue;
      const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? "")); reader.onerror = () => reject(reader.error ?? new Error("The media file could not be read.")); reader.readAsDataURL(file); });
      if (!url) continue;
      imported.push({ url, fileName: file.name, mediaType: file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image", createdAt: new Date().toISOString(), provider: selectedProvider, origin: "imported" });
    }
    if (imported.length) { setLocalMedia((current) => [...imported, ...current].slice(0, 12)); setSelectedImage(imported[0]); preserveImageSelectionRef.current = true; }
  };
  const renderMedia = (image: ImageResult, inGallery = false) => mediaTypeOf(image) === "video"
    ? <video className={inGallery ? "visuals-gallery-media" : "visuals-output-media"} src={image.url} muted={inGallery} controls={!inGallery} playsInline preload={inGallery ? "metadata" : "auto"} aria-label={image.fileName} />
    : mediaTypeOf(image) === "audio"
      ? inGallery ? <span className="visuals-gallery-audio"><NavIcon name="audio" /></span> : <div className="visuals-audio-output"><NavIcon name="audio" /><strong>{image.fileName}</strong><audio src={image.url} controls preload="metadata" aria-label={`Play ${image.fileName}`} /></div>
      : <img className={inGallery ? "visuals-gallery-media" : "visuals-output-media"} src={image.url} alt={image.fileName} />;
  const sourceImageUrl = sourceImage?.mediaType && sourceImage.content
    ? `data:${sourceImage.mediaType};base64,${sourceImage.content}`
    : null;
  const pendingVisualJobs = visualJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const availableVisualJobSlots = Math.max(0, 8 - pendingVisualJobs);
  const briefPrompt = [prompt.trim(), generationBrief.subject && `Subject: ${generationBrief.subject.trim()}`, generationBrief.composition && `Composition: ${generationBrief.composition.trim()}`, generationBrief.style && `Style and lighting: ${generationBrief.style.trim()}`, generationBrief.motion && `Motion: ${generationBrief.motion.trim()}`, generationBrief.exclusions && `Avoid: ${generationBrief.exclusions.trim()}`, generationBrief.constraints && `Output constraints: ${generationBrief.constraints.trim()}`].filter(Boolean).join("\n");
  const canGenerate = Boolean(briefPrompt && (generationProvider === "diffusers"
    ? imageRuntime?.dependenciesAvailable
    : endpoint.trim() && workflow.includes("{{prompt}}") && (!workflow.includes("{{image}}") || sourceImage) && (!sourceImage || workflow.includes("{{image}}"))));
  useEffect(() => { if (!preserveImageSelectionRef.current) setSelectedImage(images[0] ?? null); }, [images]);
  const updateVisualJobs = (update: (current: VisualJob[]) => VisualJob[]) => {
    const next = update(visualJobsRef.current);
    while (next.length > 12) {
      const removable = next.findIndex((job) => job.status !== "queued" && job.status !== "running");
      if (removable < 0) break;
      next.splice(removable, 1);
    }
    visualJobsRef.current = next;
    setVisualJobs(next);
  };
  const runVisualQueue = async () => {
    if (queueRunnerRef.current) return;
    queueRunnerRef.current = true;
    try {
      while (true) {
        const next = visualJobsRef.current.find((job) => job.status === "queued");
        if (!next) break;
        setActiveVisualJobId(next.id);
        updateVisualJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: "running", error: undefined } : job));
        preserveImageSelectionRef.current = false;
        let succeeded = false;
        try { succeeded = await onGenerate(next.source, next.options); }
        catch (error) { updateVisualJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: "failed", error: error instanceof Error ? error.message : "Generation failed." } : job)); }
        if (succeeded) updateVisualJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: "completed" } : job));
        else if (visualJobsRef.current.find((job) => job.id === next.id)?.status === "running") updateVisualJobs((current) => current.map((job) => job.id === next.id ? { ...job, status: "failed", error: "The local generation did not complete. Review the runtime message, then retry." } : job));
        setActiveVisualJobId(null);
      }
    } finally { queueRunnerRef.current = false; }
  };
  const queueGeneration = (count = 1, retry?: VisualJob) => {
    if (retry) {
      if (visualJobsRef.current.filter((job) => job.status === "queued" || job.status === "running").length >= 8) return;
      const item = { ...retry, id: crypto.randomUUID(), status: "queued" as const, error: undefined };
      updateVisualJobs((current) => [...current, item]);
      void runVisualQueue();
      return;
    }
    if (!canGenerate) return;
    const pendingCount = visualJobsRef.current.filter((job) => job.status === "queued" || job.status === "running").length;
    const allowedCount = Math.min(Math.max(1, count), 4, Math.max(0, 8 - pendingCount));
    if (!allowedCount) return;
    const generationWorkflow = workflow;
    const composedPrompt = briefPrompt;
    const metadata = workflowModelAndSize(generationWorkflow);
    const jobs = Array.from({ length: allowedCount }, (_, index): VisualJob => {
      const variationOffset = Math.round(variation * 10_000) + index * 1_009;
      const generationSeed = generationProvider === "comfyui" && generationWorkflow.includes("{{seed}}")
        ? ((seedLocked ? lockedSeed : Math.floor(Math.random() * 2_147_483_647)) + variationOffset) % 2_147_483_647
        : metadata.seed;
      const jobPrompt = composedPrompt;
      return {
        id: crypto.randomUUID(), prompt: jobPrompt, source: sourceImage ?? undefined, status: "queued",
        options: { provider: generationProvider, prompt: jobPrompt, workflow: generationWorkflow, model: generationProvider === "diffusers" ? "Stable Diffusion Turbo" : metadata.model ?? "ComfyUI workflow", seed: generationSeed, width: metadata.width ?? (generationProvider === "diffusers" ? 512 : undefined), height: metadata.height ?? (generationProvider === "diffusers" ? 512 : undefined) },
      };
    });
    updateVisualJobs((current) => [...current, ...jobs]);
    void runVisualQueue();
  };
  useEffect(() => {
    if (visualJobsRef.current.some((job) => job.status === "queued")) void runVisualQueue();
  }, []);
  const cancelVisualJob = async (job: VisualJob) => {
    if (job.status === "queued") {
      updateVisualJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: "cancelled" } : item));
      return;
    }
    if (job.status === "running") await onCancel();
  };
  return <div className={`feature-page image-studio-page visuals-workshop-page${activeTool === "edit" ? " is-editing" : ""}${activeTool === "image" && images.length === 0 ? " is-generate-empty" : ""}`}>
    <div className="visuals-page-heading"><div><p className="section-kicker">LOCAL CREATIVE WORKSPACE</p><h1 className="visuals-page-title">Visuals Workshop</h1><p className="visuals-page-subtitle">Create, edit, and organize local media with one workflow.</p></div><span className="visuals-page-scope">Runs on this device</span></div>
    <nav className="visuals-toolstrip" aria-label="Visuals Workshop tools">
      <div className="visuals-toolstrip-scroll">{visualTools.slice(0, 2).map((tool) => <button key={tool.id} type="button" className={`visuals-tool-tab${activeTool === tool.id ? " is-active" : ""}`} aria-pressed={activeTool === tool.id} onClick={() => chooseTool(tool.id)}><NavIcon name={tool.icon} /><span>{tool.label}</span></button>)}</div>
      <details className="visuals-more-tools" open={toolsMenuOpen} onToggle={(event) => setToolsMenuOpen(event.currentTarget.open)}><summary>More tools{activeTool !== "image" && activeTool !== "edit" ? ` · ${activeToolDetails.label}` : ""}</summary><div className="visuals-more-tools-menu" role="group" aria-label="Additional image tools">{visualTools.slice(2).map((tool) => <button key={tool.id} type="button" className={`visuals-tool-tab${activeTool === tool.id ? " is-active" : ""}${tool.comingSoon ? " is-coming-soon" : ""}`} disabled={tool.comingSoon} aria-pressed={activeTool === tool.id} title={tool.comingSoon ? `${tool.label} generation is coming soon` : undefined} onClick={() => { chooseTool(tool.id); setToolsMenuOpen(false); }}><NavIcon name={tool.icon} /><span>{tool.label}</span>{tool.comingSoon && <small>Soon</small>}</button>)}</div></details>
    </nav>
    <div className="visuals-main">
      <main className="visuals-stage" aria-label={`${activeToolDetails.label} workspace`}>
        <header className="visuals-stage-header"><div><p className="section-kicker">{activeToolDetails.label.toUpperCase()} WORKSPACE</p><strong>{selectedImage?.fileName ?? "Ready to create"}</strong></div><StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge></header>
        <section className={`visuals-canvas${selectedImage ? " has-output" : ""}`} aria-live="polite">
          {selectedImage && <small className="visuals-provenance-badge" aria-label={`Provenance: ${provenanceOf(selectedImage)}`}>{provenanceOf(selectedImage)}</small>}
          {selectedImage ? <div className={`visuals-output visuals-output-${mediaTypeOf(selectedImage)}`}>{comparisonOpen && sourceImageUrl && mediaTypeOf(selectedImage) === "image" ? <div className="visuals-before-after" aria-label="Before and after comparison"><figure><img src={sourceImageUrl} alt={`Before: ${sourceImage?.fileName ?? "source image"}`} /><figcaption>Before · {sourceImage?.fileName}</figcaption></figure><figure>{renderMedia(selectedImage)}<figcaption>After · {selectedImage.fileName}</figcaption></figure></div> : renderMedia(selectedImage)}<div className="visuals-output-caption"><span>{selectedImage.prompt || selectedImage.fileName}</span><div>{mediaTypeOf(selectedImage) === "image" && sourceImageUrl && <Button variant="secondary" type="button" onClick={() => setComparisonOpen((open) => !open)}>{comparisonOpen ? "Show result" : "Compare before/after"}</Button>}<a className="ui-button ui-button-secondary" href={selectedImage.url} download={selectedImage.fileName}>Download</a>{mediaTypeOf(selectedImage) === "image" && <Button variant="secondary" type="button" disabled={reopeningImage} onClick={() => void useHistoryImageForEdit()}>{reopeningImage ? "Opening…" : "Use for edit"}</Button>}</div><details className="visuals-result-details"><summary>Generation details</summary><dl><div><dt>Model</dt><dd>{selectedImage.model ?? (selectedImage.provider === "diffusers" ? "Stable Diffusion Turbo" : "Local ComfyUI workflow")}</dd></div>{selectedImage.width && selectedImage.height && <div><dt>Size</dt><dd>{selectedImage.width} × {selectedImage.height}</dd></div>}{selectedImage.seed !== undefined && <div><dt>Seed</dt><dd>{selectedImage.seed}</dd></div>}{selectedImage.createdAt && <div><dt>Created</dt><dd>{new Date(selectedImage.createdAt).toLocaleString()}</dd></div>}</dl></details></div></div> : busy ? <div className="visuals-generation-state" role="status" aria-live="polite"><span className="visuals-generation-spinner" aria-hidden="true" /><h2>{cancelRequested ? "Stopping safely" : `Creating ${activeToolDetails.label.toLowerCase()}`}</h2><p>{progress.at(-1) ?? "Waiting for the local runtime…"}</p>{progress.length > 1 && <small>{progress.at(-2)}</small>}</div> : activeTool === "edit" && sourceImageUrl ? <div className="visuals-edit-source-preview"><img src={sourceImageUrl} alt={`Source image: ${sourceImage?.fileName ?? "selected image"}`} /><span>Source image</span></div> : <div className="visuals-empty-state"><span className="visuals-empty-mark"><NavIcon name={activeToolDetails.icon} /></span><h2>{activeTool === "video" ? "Describe a scene to animate" : activeTool === "music" ? "Describe the sound you want to make" : `${activeToolDetails.label} something new`}</h2><p>{activeToolDetails.note}</p><div className="visuals-suggestions">{(activeTool === "video" ? ["a wave breaking on rocks in slow motion, cinematic", "timelapse of clouds over a mountain range"] : activeTool === "music" ? ["warm ambient piano with soft tape texture", "upbeat electronic track with a deep bass line"] : promptRecipes.map((recipe) => recipe.prompt)).map((suggestion) => <button type="button" key={suggestion} onClick={() => onChange("prompt", suggestion)}>{suggestion}</button>)}</div></div>}
        </section>
      </main>
      <aside className="visuals-gallery" aria-label="Generated media gallery"><div className="visuals-gallery-heading"><NavIcon name="image" /><strong>Gallery</strong><span>{galleryImages.length}{galleryFilter !== "all" ? ` / ${allGalleryImages.length}` : ""}</span><label className="sr-only" htmlFor="visuals-gallery-filter">Filter gallery</label><select id="visuals-gallery-filter" value={galleryFilter} onChange={(event) => setGalleryFilter(event.target.value as GalleryFilter)} aria-label="Filter gallery"><option value="all">All media</option><option value="image">Images</option><option value="video">Video</option><option value="audio">Audio</option></select><input ref={localMediaInputRef} className="sr-only" type="file" accept="image/*,video/*,audio/*" aria-label="Import local media files" multiple onChange={(event) => { void importLocalMedia(event.target.files); event.currentTarget.value = ""; }} /><div className="visuals-gallery-actions"><Button variant="secondary" type="button" onClick={() => localMediaInputRef.current?.click()}>Browse media</Button><Button variant="ghost" type="button" disabled={!galleryImages.length} onClick={() => { setContactSelection([]); setContactSheetOpen(true); }}>Contact sheet</Button></div></div><div className="visuals-gallery-items">{galleryImages.length ? galleryImages.map((image) => <button key={`${image.createdAt ?? ""}:${image.url}`} type="button" className={`visuals-gallery-item${selectedImage?.url === image.url ? " is-selected" : ""}`} aria-label={`Open ${mediaTypeOf(image)} ${image.fileName}`} aria-pressed={selectedImage?.url === image.url} onClick={() => { preserveImageSelectionRef.current = true; setSelectedImage(image); }}>{renderMedia(image, true)}<small>{mediaTypeOf(image)}{localMedia.includes(image) ? " · local" : ""}</small></button>) : <p className="visuals-gallery-empty">{allGalleryImages.length ? "No media matches this filter." : "Your generated work appears here."}</p>}</div></aside>
      {contactSheetOpen && <div className="visuals-contact-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContactSheetOpen(false); }}><section className="visuals-contact-sheet" role="dialog" aria-modal="true" aria-labelledby="visuals-contact-sheet-title"><header><div><p className="section-kicker">MEDIA REVIEW</p><h2 id="visuals-contact-sheet-title">Contact sheet</h2><p>Select up to six candidates to compare, then promote one into the main canvas.</p></div><Button variant="ghost" type="button" onClick={() => setContactSheetOpen(false)}>Close</Button></header><div className="visuals-contact-sheet-grid">{galleryImages.map((image) => { const selected = contactSelection.includes(image.url); return <button key={`contact:${image.createdAt ?? ""}:${image.url}`} type="button" className={`visuals-contact-sheet-item${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => toggleContactSelection(image)}>{renderMedia(image, true)}<span>{selected ? "Selected" : "Select"}</span><small>{image.fileName}</small></button>; })}</div>{contactSheetImages.length > 1 && <div className="visuals-contact-sheet-compare" aria-label="Selected media comparison">{contactSheetImages.map((image) => <figure key={`compare:${image.url}`}>{renderMedia(image, true)}<figcaption>{image.fileName}</figcaption></figure>)}</div>}<footer><span>{contactSheetImages.length}/6 selected</span><div><Button variant="ghost" type="button" onClick={() => setContactSelection([])} disabled={!contactSelection.length}>Clear</Button><Button variant="secondary" type="button" disabled={!contactSheetImages.length} onClick={() => { const image = contactSheetImages[0]; if (image) { preserveImageSelectionRef.current = true; setSelectedImage(image); setContactSheetOpen(false); } }}>Promote selected</Button><Button variant="primary" type="button" disabled={contactSheetImages.length < 2} onClick={() => { const image = contactSheetImages[0]; if (image) { preserveImageSelectionRef.current = true; setSelectedImage(image); setContactSheetOpen(false); } }}>Compare in canvas</Button></div></footer></section></div>}
    </div>
    <section className="visuals-controls" aria-label="Generation controls">
      <div className="visuals-control-summary"><span>{activeToolDetails.note}</span>{usesBuiltInImageEngine ? <><StatusBadge tone={imageRuntime?.dependenciesAvailable ? "success" : "warning"}>{imageRuntime?.dependenciesAvailable ? "Local runtime ready" : "Runtime setup needed"}</StatusBadge><label>Image engine<select value={selectedProvider} onChange={(event) => onChange("provider", event.target.value)}><option value="diffusers">Stable Diffusion Turbo</option><option value="comfyui">ComfyUI workflow</option></select></label></> : <StatusBadge tone="neutral">Local ComfyUI workflow</StatusBadge>}</div>
      {sourceImage && <div className="visuals-source-image">{sourceImageUrl && <img src={sourceImageUrl} alt="" />}<span>Source image: {sourceImage.fileName}</span><Button variant="ghost" type="button" disabled={busy} onClick={() => setSourceImage(null)}>Remove source</Button></div>}
      <label className="sr-only" htmlFor="visuals-prompt">{activeToolDetails.label} prompt</label><textarea id="visuals-prompt" value={prompt} onChange={(event) => onChange("prompt", event.target.value)} maxLength={8000} rows={2} placeholder={activeToolDetails.prompt} disabled={busy} />
      <details className="visuals-generation-brief" open={generationBriefOpen} onToggle={(event) => setGenerationBriefOpen(event.currentTarget.open)}><summary>Generation brief{Object.values(generationBrief).some(Boolean) ? " · configured" : " · optional"}</summary><div className="visuals-generation-brief-grid">{(["subject", "composition", "style", "motion", "exclusions", "constraints"] as const).map((key) => { const labels: Record<keyof GenerationBrief, string> = { subject: "Subject", composition: "Composition", style: "Style and lighting", motion: "Motion", exclusions: "Exclusions", constraints: "Output constraints" }; const placeholders: Record<keyof GenerationBrief, string> = { subject: "Who or what is in frame?", composition: "Framing, camera, depth, layout…", style: "Medium, palette, lighting, mood…", motion: "Movement, timing, camera motion…", exclusions: "What should the result avoid?", constraints: "Aspect ratio, size, duration, format…" }; return <label key={key}>{labels[key]}<textarea value={generationBrief[key]} maxLength={1200} rows={2} placeholder={placeholders[key]} disabled={busy} onChange={(event) => setGenerationBrief((current) => ({ ...current, [key]: event.target.value }))} /></label>; })}</div><p className="visuals-generation-brief-help">These fields become a labeled, reproducible prompt in each queued job. Leave them blank to use the freeform prompt only.</p></details>
      <div className="visuals-composer-footer"><div className="visuals-composer-options"><Button variant="secondary" type="button" disabled={selectingImage || busy} onClick={() => { setSelectingImage(true); void onPickSourceImage().then((next) => { setSourceImage(next); setComparisonOpen(false); }).catch((error) => setWorkflowError(error instanceof Error ? error.message : "Image selection failed.")).finally(() => setSelectingImage(false)); }}>{selectingImage ? "Selecting…" : sourceImage ? "Replace source" : "Add source image"}</Button><details className="visuals-presets"><summary>Presets{savedPresets.length ? ` · ${savedPresets.length}` : ""}</summary><div className="visuals-presets-panel"><label>Saved generation<select aria-label="Saved generation presets" value={selectedPresetId} onChange={(event) => { const preset = savedPresets.find((item) => item.id === event.target.value); if (preset) applyVisualPreset(preset); }}><option value="">Choose a preset…</option>{savedPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><label>Preset name<input value={presetName} onChange={(event) => setPresetName(event.target.value)} maxLength={80} placeholder="Name this setup" /></label><div><Button variant="secondary" type="button" disabled={!presetName.trim() || !prompt.trim() || workflow.length > 100_000 || busy} onClick={saveVisualPreset}>Save preset</Button>{selectedPresetId && <Button variant="ghost" type="button" disabled={busy} onClick={() => { setSavedPresets((current) => current.filter((item) => item.id !== selectedPresetId)); setSelectedPresetId(""); }}>Delete preset</Button>}</div>{workflow.length > 100_000 && <small>This workflow is too large to save as a preset.</small>}</div></details><div className="visuals-seed-controls" aria-label="Seed and variation controls"><label><input type="checkbox" checked={seedLocked} disabled={busy} onChange={(event) => setSeedLocked(event.target.checked)} /> Lock seed</label><input aria-label="Locked seed" type="number" min="0" max="2147483646" step="1" value={lockedSeed} disabled={busy || !seedLocked} onChange={(event) => { const next = Number(event.target.value); if (Number.isSafeInteger(next)) setLockedSeed(Math.min(2147483646, Math.max(0, next))); }} /><label className="visuals-variation-control">Variation <output>{variation}%</output><input aria-label="Variation" type="range" min="0" max="100" step="5" value={variation} disabled={busy} onChange={(event) => setVariation(Number(event.target.value))} /></label></div></div><div className="visuals-composer-action"><label className="visuals-batch-select">Batch<select aria-label="Batch generation size" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>{busy ? <Button variant="secondary" type="button" disabled={cancelRequested} onClick={() => void onCancel()}>{cancelRequested ? "Stopping…" : "Cancel"}</Button> : <Button variant="primary" type="button" disabled={!canGenerate || availableVisualJobSlots === 0} onClick={() => queueGeneration(batchSize)}>{batchSize > 1 ? `Queue ${Math.min(batchSize, availableVisualJobSlots)} images` : generationProvider === "diffusers" ? activeTool === "edit" ? "Edit image" : "Create image" : `Create ${activeToolDetails.label.toLowerCase()}`}<NavIcon name="sparkle" /></Button>}</div></div>

      {visualJobs.length > 0 && <section className="visuals-job-queue" aria-label="Generation queue"><div className="visuals-job-queue-heading"><div><strong>Generation queue</strong><span>{pendingVisualJobs} pending; runs one at a time</span></div><div className="visuals-job-queue-actions">{visualJobs.some((job) => job.status === "queued") && <Button variant="secondary" type="button" onClick={() => void runVisualQueue()}>Resume queue</Button>}<Button variant="secondary" type="button" disabled={!canGenerate || availableVisualJobSlots === 0} onClick={() => queueGeneration(batchSize)}>Queue batch</Button></div></div><ol>{visualJobs.slice().reverse().map((job) => <li key={job.id} className={`visuals-job visuals-job-${job.status}`}><span className="visuals-job-status">{job.status === "running" ? cancelRequested ? "Stopping" : "Running" : job.status}</span><span className="visuals-job-prompt" title={job.prompt}>{job.prompt}</span>{job.status === "running" && <small>{progress.at(-1) ?? "Waiting for local runtime..."}</small>}{job.error && <small role="status">{job.error}</small>}<div>{job.status === "queued" && <Button variant="ghost" type="button" onClick={() => void cancelVisualJob(job)}>Remove</Button>}{job.status === "running" && <Button variant="ghost" type="button" disabled={cancelRequested} onClick={() => void cancelVisualJob(job)}>Cancel</Button>}{(job.status === "failed" || job.status === "cancelled") && <Button variant="secondary" type="button" disabled={!canGenerate || availableVisualJobSlots === 0} onClick={() => queueGeneration(1, job)}>Retry</Button>}{job.status === "completed" && images.some((image) => image.prompt === job.prompt && (image.createdAt ?? "") >= new Date(Date.now() - 10 * 60_000).toISOString()) && <Button variant="ghost" type="button" disabled={reopeningImage} onClick={() => { const result = images.find((image) => image.prompt === job.prompt); if (result) { setSelectedImage(result); preserveImageSelectionRef.current = true; void imageHistorySource(result).then(setSourceImage).then(() => chooseTool("edit")).catch((error) => setWorkflowError(error instanceof Error ? error.message : "The generated image could not be reopened.")); } }}>Open in edit</Button>}</div></li>)}</ol></section>}
      <details className="visuals-workflow-settings" open={workflowSettingsOpen} onToggle={(event) => setWorkflowSettingsOpen(event.currentTarget.open)}><summary>Workflow settings</summary><div className="visuals-workflow-panel">
        {generationProvider === "diffusers" ? <div className="visuals-runtime-settings"><p><strong>Stable Diffusion Turbo · local inference</strong></p><p>{imageRuntime?.message ?? "Checking the optional image runtime…"} The first generation downloads model weights (about 5.2 GB); CPU generation is supported but may be slow.</p><details className="visuals-requirements" open><summary>Before activation</summary><ul><li><strong>Model:</strong> Stable Diffusion Turbo weights, downloaded locally.</li><li><strong>Disk:</strong> reserve about 5.2 GB plus temporary model/cache space.</li><li><strong>License:</strong> review the upstream model terms before installing.</li><li><strong>Network:</strong> setup downloads once; generation stays on this device.</li></ul></details><div className="settings-model-actions"><StatusBadge tone={imageRuntimeInstall?.status === "running" ? "warning" : imageRuntime?.dependenciesAvailable ? "success" : imageRuntime ? "warning" : "neutral"}>{imageRuntimeInstall?.status === "running" ? "Installing" : imageRuntime?.status ?? "Checking"}</StatusBadge><Button variant="secondary" type="button" disabled={imageRuntimeBusy} onClick={() => void refreshImageRuntime()}>Check runtime</Button>{!imageRuntime?.dependenciesAvailable && <Button variant="primary" type="button" disabled={imageRuntimeBusy || imageRuntimeInstall?.status === "running"} onClick={() => void installImageRuntime()}>{imageRuntimeBusy ? "Installing…" : "Install local image runtime"}</Button>}{imageRuntimeInstall?.status === "running" && <Button variant="ghost" type="button" onClick={() => void cancelImageRuntimeInstall()}>Cancel setup</Button>}</div></div> : <>
          <details className="visuals-requirements" open><summary>Before activation</summary><ul><li><strong>Runtime:</strong> a local ComfyUI endpoint and a reachable API port.</li><li><strong>Models:</strong> the workflow’s checkpoint, VAE, and any referenced custom nodes must already be installed.</li><li><strong>Disk:</strong> Skai cannot estimate arbitrary ComfyUI model sizes; check the local runtime before importing large workflows.</li><li><strong>License:</strong> checkpoints and custom nodes keep their upstream terms; Skai does not relicense them.</li></ul></details>
          <label>Local ComfyUI endpoint<input value={endpoint} onChange={(event) => { setCheckpoints([]); setCheckpoint(""); onChange("endpoint", event.target.value); }} placeholder="http://127.0.0.1:8188" /></label>
          {(activeTool === "image" || activeTool === "edit") && <div className="image-checkpoint-builder"><div className="workflow-source-row"><label>Installed checkpoint<select value={checkpoint} onChange={(event) => setCheckpoint(event.target.value)} disabled={checkpoints.length === 0}><option value="">{checkpoints.length ? "Choose a local checkpoint…" : "Discover local checkpoints first"}</option>{checkpoints.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><Button variant="secondary" type="button" disabled={discoveringCheckpoints || !endpoint.trim()} onClick={() => void discoverCheckpoints()}>{discoveringCheckpoints ? "Discovering…" : "Discover checkpoints"}</Button></div><div className="workflow-source-row"><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("generate")}>Create image workflow</Button><Button variant="secondary" type="button" disabled={!checkpoint} onClick={() => buildWorkflow("edit")}>Create edit workflow</Button></div></div>}
          <div className="workflow-source-row"><label>Saved workflow<select value={selectedWorkflowName} onChange={(event) => { const selected = savedWorkflows.find((item) => item.name === event.target.value); setSelectedWorkflowName(event.target.value); if (selected) { setWorkflowName(selected.name); setToolWorkflow(selected.workflow); } }}><option value="">{savedWorkflows.length ? "Choose a saved workflow…" : "No saved workflows yet"}</option>{savedWorkflows.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><Button variant="secondary" type="button" disabled={importingWorkflow} onClick={() => void importWorkflow()}>{importingWorkflow ? "Importing…" : "Import workflow"}</Button></div>
          {workflowError && <p className="form-error" role="alert">{workflowError}</p>}
          <label>ComfyUI API workflow<textarea value={workflow} onChange={(event) => setToolWorkflow(event.target.value)} placeholder="Import a local ComfyUI API workflow containing {{prompt}}." rows={5} /><small>ComfyUI video and audio workflows work when their output nodes save supported files. Video and music model packs or custom nodes must be installed in your local ComfyUI first. Source-image workflows use {"{{image}}"}.</small><div className="workflow-save-row"><input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} placeholder="Workflow name" maxLength={80} aria-label="Workflow name" /><Button variant="secondary" type="button" disabled={!workflow.trim() || !workflowName.trim()} onClick={saveWorkflow}>Save workflow</Button></div></label>
        </>}
      </div></details>
    </section>
  </div>;
}
