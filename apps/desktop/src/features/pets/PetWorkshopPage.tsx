import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from "react";
import type { PetBehaviorSettings } from "../../../shared/contracts";
import { Button, PageHeader } from "../../components/ui/Primitives";
import { defaultPetBehavior, deletePetSpriteProfile, listPetSpriteProfiles, normalizePetBehavior, PET_ACTIONS, PET_ANIMATIONS, PET_BLINK_DURATION_DEFAULT_MS, PET_BLINK_DURATION_MAX_MS, PET_BLINK_DURATION_MIN_MS, PET_FRAME_COUNT, readPetBehavior, readPetBlinkDuration, savePetBehavior, savePetBlinkDuration, savePetSpriteProfile, validatePetProfileImport, validatePetStrip, type PetActionId, type PetAnimationId, type PetSpriteProfile, type PetStrip } from "../settings/petSprites";

const DEFAULT_FRAME_SIZE = 128;
const BUILTIN_NAMES = ["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"] as const;
const BUILTIN_LABELS: Record<(typeof BUILTIN_NAMES)[number], string> = { percy: "Percy", byte: "Byte", ember: "Ember", blaze: "Blaze", nova: "Nova", rocky: "Rocky", sprout: "Sprout" };
const BUILTIN_SOURCE_NAMES: Record<(typeof BUILTIN_NAMES)[number], string> = { percy: "percy", byte: "byte", ember: "ember", blaze: "blaze", nova: "nova", rocky: "rocky", sprout: "sprout" };
const BUILTIN_STATES: Partial<Record<PetAnimationId, string>> = { idle: "idle", walking: "walk", thinking: "thinking", working: "coding", stuck: "stuck", fail: "error", success: "success", "malicious-coding": "coding_malicious" };
const BUILTIN_ASSETS = import.meta.glob("../../../../../assets/pets/generated/*-frames.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const BUILTIN_PROFILES: PetSpriteProfile[] = BUILTIN_NAMES.map((name) => ({
  id: `builtin:${name}`, name: BUILTIN_LABELS[name], strips: Object.fromEntries(Object.entries(BUILTIN_STATES).map(([animation, state]) => [animation, { dataUrl: BUILTIN_ASSETS[`../../../../../assets/pets/generated/${BUILTIN_SOURCE_NAMES[name]}-${state}-frames.png`], frameWidth: 256, frameHeight: 256, frameCount: PET_FRAME_COUNT }])) as PetSpriteProfile["strips"],
  blink: { dataUrl: BUILTIN_ASSETS[`../../../../../assets/pets/generated/${BUILTIN_SOURCE_NAMES[name]}-blink-frames.png`], frameWidth: 256, frameHeight: 256, frameCount: 11 },
}));
BUILTIN_PROFILES.forEach((profile, index) => {
  profile.blink = { dataUrl: BUILTIN_ASSETS[`../../../../../assets/pets/generated/${BUILTIN_SOURCE_NAMES[BUILTIN_NAMES[index]]}-blink-frames.png`], frameWidth: 256, frameHeight: 256, frameCount: 11 };
});

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be opened."));
    image.src = source;
  });
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The generated concept could not be saved locally."));
    reader.onerror = () => reject(new Error("The generated concept could not be saved locally."));
    reader.readAsDataURL(blob);
  });
}

function PetGenerationGuide({ onApprove }: { onApprove: (name: string, concept: string, forkFrom: string | null) => Promise<void> }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState(() => localStorage.getItem("skai.imageProvider") === "comfyui" ? "comfyui" : "diffusers");
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem("skai.imageEndpoint") ?? "http://127.0.0.1:8188");
  const [workflow, setWorkflow] = useState(() => localStorage.getItem("skai.imageWorkflow") ?? "");
  const [forkFrom, setForkFrom] = useState("");
  const [concept, setConcept] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (generating || !name.trim() || description.trim().length < 8) return;
    setGenerating(true);
    setError(null);
    localStorage.setItem("skai.imageProvider", provider);
    localStorage.setItem("skai.imageEndpoint", endpoint);
    localStorage.setItem("skai.imageWorkflow", workflow);
    try {
      const prompt = "A single full-body desktop pet character concept: " + description.trim() + ". Cute readable pixel-art game sprite, facing right, centered with generous padding, plain simple background, no text, no watermark. This is a design reference, not a sprite sheet.";
      let sourceImage: string | undefined;
      let sourceImageMediaType: string | undefined;
      if (concept) {
        const image = await loadImage(concept);
        const normalized = document.createElement("canvas");
        normalized.width = image.naturalWidth;
        normalized.height = image.naturalHeight;
        normalized.getContext("2d")?.drawImage(image, 0, 0);
        sourceImage = normalized.toDataURL("image/png").split(",")[1];
        sourceImageMediaType = "image/png";
      }
      const response = await window.skaiAgent?.request("image.generate", {
        provider,
        prompt,
        ...(provider === "comfyui" ? { endpoint, workflow } : {}),
        ...(sourceImage && sourceImageMediaType ? { sourceImage, sourceImageMediaType } : {}),
      });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The local image generator did not respond.");
      const images = (response.result as { images?: Array<{ url?: unknown }> }).images ?? [];
      const url = images.find((image) => typeof image.url === "string")?.url;
      if (typeof url !== "string") throw new Error("The local image generator returned no concept image.");
      const blob = await (await fetch(url)).blob();
      if (!/^image\/(png|jpeg|webp)$/i.test(blob.type)) throw new Error("The concept output must be a PNG, JPEG, or WebP image.");
      if (blob.size > 5 * 1024 * 1024) throw new Error("Keep the generated concept under 5 MB.");
      setConcept(await blobAsDataUrl(blob));
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Local concept generation failed.");
    } finally { setGenerating(false); }
  };

  const approve = async () => {
    if (!concept || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try { await onApprove(name.trim().slice(0, 48), concept, forkFrom || null); setConcept(""); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "The companion draft could not be saved."); }
    finally { setSaving(false); }
  };

  return <section className="pet-generation-guide" aria-label="Guided local pet generation">
    <p className="section-kicker">LOCAL PET GENERATOR</p>
    <h3>Start with a character idea</h3>
    <p>Generate a concept locally, review it, then start with idle, walk, and blink. Add work and reaction animations when you need them. No hosted image service is used.</p>
    <label>Pet name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} placeholder="Name your companion" /></label>
    <label>What should it look like?<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="A tiny mossy dragon with rounded horns and a curled tail…" /></label>
    <label>Start from<select value={forkFrom} onChange={(event) => setForkFrom(event.target.value)}><option value="">A new blank pet</option>{BUILTIN_PROFILES.map((item) => <option key={item.id} value={item.id}>{item.name} · keep its animations</option>)}</select></label>
    <label>Local image engine<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="diffusers">Stable Diffusion Turbo</option><option value="comfyui">ComfyUI</option></select></label>
    {provider === "comfyui" && <><label>Local ComfyUI address<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:8188" /></label><label>ComfyUI API workflow<textarea value={workflow} onChange={(event) => setWorkflow(event.target.value)} rows={3} placeholder="Paste or reuse the local API workflow from Image Studio" /></label><small>For image-conditioned refinements, the workflow must accept {"{{image}}"} and {"{{prompt}}"}. Animation-strip workflows must output the exact strip dimensions shown in the editor.</small></>}
    {concept && <div className="pet-generation-review"><img src={concept} alt={"Generated concept for " + (name || "your companion")} /><span>Review this concept. It is only a reference; no animation is saved until you draw or import strips.</span><div><Button variant="secondary" disabled={generating || (provider === "comfyui" && !workflow.includes("{{image}}"))} onClick={() => void generate()}>{generating ? "Generating…" : "Refine with this image"}</Button><Button variant="primary" disabled={saving} onClick={() => void approve()}>{saving ? "Saving…" : "Approve concept & create draft"}</Button></div></div>}
    {!concept && <><small>Stable Diffusion Turbo uses the local runtime configured in Image Studio. ComfyUI uses the local endpoint and workflow above.</small><Button variant="primary" disabled={generating || !name.trim() || description.trim().length < 8 || (provider === "comfyui" && (!endpoint.trim() || !workflow.trim() || workflow.includes("{{image}}")))} onClick={() => void generate()}>{generating ? "Generating locally…" : "Generate concept"}</Button></>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function stripPreviewStyle(strip: PetStrip): CSSProperties {
  const scale = Math.min(72 / strip.frameWidth, 72 / strip.frameHeight);
  const width = strip.frameWidth * scale;
  return {
    backgroundImage: `url(${strip.dataUrl})`,
    backgroundSize: `${width * (strip.frameCount ?? 6)}px ${strip.frameHeight * scale}px`,
    "--pet-preview-strip-end": `${-width * ((strip.frameCount ?? 6) - 1)}px`,
    "--pet-preview-steps": (strip.frameCount ?? 6) - 1,
  } as CSSProperties;
}

function PetFrameEditor({ strip, animation, onSave, busy, readOnly = false, referenceImage, loop = true }: { strip?: PetStrip; animation: PetAnimationId; onSave: (strip: PetStrip) => Promise<void>; busy: boolean; readOnly?: boolean; referenceImage?: string; loop?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const frameData = useRef<string[]>(Array.from({ length: animation === "blink" ? 4 : strip?.frameCount ?? PET_FRAME_COUNT }, () => ""));
  const history = useRef<string[]>([]);
  const [frameWidth, setFrameWidth] = useState(DEFAULT_FRAME_SIZE);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_SIZE);
  const [frameIndex, setFrameIndex] = useState(0);
  const activeFrameCount = animation === "blink" ? 4 : strip?.frameCount ?? PET_FRAME_COUNT;
  const blankFrames = () => Array.from({ length: activeFrameCount }, () => "");
  const [frameThumbs, setFrameThumbs] = useState<string[]>(blankFrames);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [color, setColor] = useState("#ff793f");
  const [brushSize, setBrushSize] = useState(8);
  const [onionSkin, setOnionSkin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedCandidate, setGeneratedCandidate] = useState<string | null>(null);
  const [generatingStrip, setGeneratingStrip] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      frameData.current = blankFrames();
      history.current = [];
      setFrameThumbs(blankFrames());
      setFrameIndex(0);
      setError(null);
      if (!strip) {
        setFrameWidth(DEFAULT_FRAME_SIZE);
        setFrameHeight(DEFAULT_FRAME_SIZE);
        return;
      }
      try {
        const image = await loadImage(strip.dataUrl);
        const frameCount = strip.frameCount ?? (animation === "blink" ? 4 : PET_FRAME_COUNT);
        const cellWidth = image.naturalWidth / frameCount;
        const loadedFrames = Array.from({ length: frameCount }, () => "");
        for (let index = 0; index < frameCount; index += 1) {
          const frame = document.createElement("canvas");
          frame.width = cellWidth;
          frame.height = image.naturalHeight;
          frame.getContext("2d")?.drawImage(image, index * cellWidth, 0, cellWidth, image.naturalHeight, 0, 0, cellWidth, image.naturalHeight);
          loadedFrames[index] = frame.toDataURL("image/png");
        }
        if (!active) return;
        frameData.current = loadedFrames;
        setFrameThumbs(loadedFrames);
        setFrameWidth(cellWidth);
        setFrameHeight(image.naturalHeight);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "This strip could not be opened.");
      }
    };
    void load();
    return () => { active = false; };
  }, [strip?.dataUrl, strip?.frameWidth, strip?.frameHeight, strip?.frameCount, animation, activeFrameCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    context.clearRect(0, 0, frameWidth, frameHeight);
    const source = frameData.current[frameIndex];
    if (!source) return;
    void loadImage(source).then((image) => {
      if (canvasRef.current === canvas) context.drawImage(image, 0, 0, frameWidth, frameHeight);
    }).catch(() => setError("A frame could not be restored in the editor."));
  }, [frameIndex, frameWidth, frameHeight]);

  const pointAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  };
  const startStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || (loop && frameIndex === activeFrameCount - 1)) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    history.current.push(canvas.toDataURL("image/png"));
    if (history.current.length > 20) history.current.shift();
    drawing.current = true;
    lastPoint.current = pointAt(event);
    context.beginPath();
    context.fillStyle = tool === "eraser" ? "rgba(0,0,0,1)" : color;
    context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    context.arc(lastPoint.current.x, lastPoint.current.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
  };
  const continueStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPoint.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = pointAt(event);
    context.beginPath();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : color;
    context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    context.moveTo(lastPoint.current.x, lastPoint.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPoint.current = next;
  };
  const finishStroke = (event?: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    lastPoint.current = null;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const canvas = canvasRef.current;
    if (!canvas) return;
    frameData.current[frameIndex] = canvas.toDataURL("image/png");
    setFrameThumbs([...frameData.current]);
  };
  const selectFrame = (next: number) => {
    finishStroke();
    setFrameIndex(next);
  };
  const undo = async () => {
    const prior = history.current.pop();
    if (!prior || !canvasRef.current) return;
    const image = await loadImage(prior);
    const context = canvasRef.current.getContext("2d");
    context?.clearRect(0, 0, frameWidth, frameHeight);
    context?.drawImage(image, 0, 0, frameWidth, frameHeight);
    frameData.current[frameIndex] = canvasRef.current.toDataURL("image/png");
    setFrameThumbs([...frameData.current]);
  };
  const clearFrame = () => {
    if (loop && frameIndex === activeFrameCount - 1) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, frameWidth, frameHeight);
    frameData.current[frameIndex] = "";
    setFrameThumbs([...frameData.current]);
  };
  const duplicatePrevious = async () => {
    if (loop && frameIndex === activeFrameCount - 1) return;
    if (!canvasRef.current) return;
    const previous = frameData.current[(frameIndex + activeFrameCount - 1) % activeFrameCount];
    if (!previous) return;
    const image = await loadImage(previous);
    const context = canvasRef.current.getContext("2d");
    context?.clearRect(0, 0, frameWidth, frameHeight);
    context?.drawImage(image, 0, 0, frameWidth, frameHeight);
    frameData.current[frameIndex] = canvasRef.current.toDataURL("image/png");
    setFrameThumbs([...frameData.current]);
  };
  const saveStrip = async () => {
    finishStroke();
    const output = document.createElement("canvas");
    output.width = frameWidth * activeFrameCount;
    output.height = frameHeight;
    const context = output.getContext("2d");
    if (!context) { setError("The sprite strip could not be assembled."); return; }
    try {
      for (let index = 0; index < activeFrameCount; index += 1) {
        const data = frameData.current[index === activeFrameCount - 1 && loop ? 0 : index];
        if (!data) continue;
        const image = await loadImage(data);
        context.drawImage(image, index * frameWidth, 0, frameWidth, frameHeight);
      }
      const blob = await (await fetch(output.toDataURL("image/png"))).blob();
      const strip = await validatePetStrip(new File([blob], `${animation}.png`, { type: "image/png" }), false, undefined, activeFrameCount, loop);
      setError(null);
      await onSave(strip);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The sprite strip could not be saved.");
    }
  };
  const generateCel = async () => {
    if (generatingStrip) return;
    const provider = localStorage.getItem("skai.imageProvider") === "comfyui" ? "comfyui" : "diffusers";
    const endpoint = localStorage.getItem("skai.imageEndpoint") ?? "http://127.0.0.1:8188";
    const workflow = localStorage.getItem("skai.imageWorkflow") ?? "";
    if (provider === "comfyui" && !workflow.trim()) { setError("Add a local ComfyUI workflow in Image Studio before generating a cel."); return; }
    setGeneratingStrip(true);
    setError(null);
    try {
      const current = frameData.current[frameIndex];
      const source = current || referenceImage;
      if (provider === "comfyui" && source && !workflow.includes("{{image}}")) throw new Error("This ComfyUI workflow is text-only. Choose an image-edit workflow with {{image}} so each cel can stay matched to the approved character.");
      const canConditionOnSource = Boolean(source && (provider === "diffusers" || workflow.includes("{{image}}")));
      if (provider === "comfyui" && workflow.includes("{{image}}") && !source) throw new Error("This ComfyUI workflow needs an image. Approve a concept or draw the current cel first.");
      let sourceImage: string | undefined;
      let sourceImageMediaType: string | undefined;
      if (source && canConditionOnSource) {
        const image = await loadImage(source);
        const normalized = document.createElement("canvas");
        normalized.width = image.naturalWidth;
        normalized.height = image.naturalHeight;
        normalized.getContext("2d")?.drawImage(image, 0, 0);
        const dataUrl = normalized.toDataURL("image/png");
        sourceImage = dataUrl.slice(dataUrl.indexOf(",") + 1);
        sourceImageMediaType = "image/png";
      }
      const isBlink = animation === "blink";
      const prompt = isBlink
        ? `One single transparent pixel-art sprite cel for the approved companion, blink pose ${frameIndex + 1} of 4 (open eyes, softly closing, closed, reopening). Keep the character's design, scale, orientation, and placement unchanged; only adjust the eyes. Center it in a square image with transparent background, no text. ${canConditionOnSource ? "Match the provided character image exactly." : "Cute readable desktop-pet game art."}`
        : `One single transparent pixel-art sprite cel, pose ${frameIndex + 1} of ${activeFrameCount} for the ${animation} animation. The character is a cute desktop companion facing right. Keep its design, scale, and center placement consistent across cels; make a clear pose change suitable for ${loop ? "a looping animation" : "a one-shot animation"}. ${frameIndex === 0 ? "Frame 1 is the neutral rest pose." : "Continue the movement from the neighboring poses."} Square canvas, full character inside safe margins, transparent background, no text. ${canConditionOnSource ? "Match the provided character image exactly." : "Create a cohesive, readable game-sprite character."}`;
      const response = await window.skaiAgent?.request("image.generate", {
        provider,
        ...(provider === "comfyui" ? { endpoint, workflow } : {}),
        prompt,
        ...(sourceImage && sourceImageMediaType ? { sourceImage, sourceImageMediaType } : {}),
      });
      if (!response?.ok) throw new Error(response?.error?.message ?? "The local image generator did not respond.");
      const images = (response.result as { images?: Array<{ url?: unknown }> }).images ?? [];
      const url = images.find((image) => typeof image.url === "string")?.url;
      if (typeof url !== "string") throw new Error("The local image generator returned no sprite cel.");
      const blob = await (await fetch(url)).blob();
      if (!/^image\/(png|jpeg|webp)$/i.test(blob.type)) throw new Error("The generated cel must be a PNG, JPEG, or WebP image.");
      if (blob.size > 5 * 1024 * 1024) throw new Error("The generated cel is larger than 5 MB.");
      setGeneratedCandidate(await blobAsDataUrl(blob));
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Local cel generation failed.");
    } finally { setGeneratingStrip(false); }
  };
  const approveGeneratedCel = async () => {
    if (!generatedCandidate) return;
    try {
      const image = await loadImage(generatedCandidate);
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) throw new Error("The editor canvas is unavailable.");
      context.clearRect(0, 0, frameWidth, frameHeight);
      const scale = Math.min((frameWidth * 0.88) / image.naturalWidth, (frameHeight * 0.88) / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (frameWidth - width) / 2, (frameHeight - height) / 2, width, height);
      frameData.current[frameIndex] = canvas.toDataURL("image/png");
      setFrameThumbs([...frameData.current]);
      setGeneratedCandidate(null);
      setError(null);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "The generated cel could not be approved.");
    }
  };
  const removeBackground = async (source: string) => {
    if (backgroundBusy) return;
    setBackgroundBusy(true);
    setError(null);
    try {
      const image = await loadImage(source);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const response = await window.skaiAgent?.request("pet.background.remove", { image: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/png" });
      if (!response?.ok) throw new Error(response?.error?.message ?? "Local background removal failed.");
      const transparent = (response.result as { image?: unknown }).image;
      if (typeof transparent !== "string" || !transparent.startsWith("data:image/png;base64,")) throw new Error("The background remover returned an invalid PNG.");
      setGeneratedCandidate(transparent);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Local background removal failed.");
    } finally { setBackgroundBusy(false); }
  };
  const previousFrame = (frameIndex + activeFrameCount - 1) % activeFrameCount;

  return <section className={`pet-workshop-editor${readOnly ? " is-reference" : ""}`} aria-label={`${animation} animation editor`}>
    <div className="pet-workshop-editor-heading"><div><p className="section-kicker">{readOnly ? "BUILT-IN SOURCE STRIP" : "FRAME EDITOR"}</p><h3>{PET_ANIMATIONS.find((item) => item.id === animation)?.label ?? animation}</h3><p>{readOnly ? "Inspect the exact shipped artwork one cel at a time." : animation === "blink" ? "Four eye poses ease into and out of a longer blink; keep the rest of the pet still." : loop ? `Draw ${activeFrameCount - 1} poses; the final cel mirrors the first to close the loop.` : `Create a ${activeFrameCount}-frame one-shot animation.`}</p>{!readOnly && <small>Generate one cel at a time with the local engine selected in Image Studio. Review each result before using it; the final strip is checked when you save.</small>}</div>{!readOnly && <Button variant="primary" disabled={busy} onClick={() => void saveStrip()}>{busy ? "Saving…" : animation === "blink" ? "Save blink strip" : `Save ${activeFrameCount}-frame strip`}</Button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pet-workshop-drawing-layout">
      <div className="pet-workshop-canvas-wrap">
        <div className="pet-workshop-artboard" style={{ width: Math.min(384, frameWidth * 2), height: Math.min(384, frameHeight * 2) }}>
          {onionSkin && frameThumbs[previousFrame] && <img className="pet-workshop-onion" src={frameThumbs[previousFrame]} alt="" />}
          <canvas ref={canvasRef} aria-label={readOnly ? `View source frame ${frameIndex}` : `Draw frame ${frameIndex}`} onPointerDown={readOnly ? undefined : startStroke} onPointerMove={readOnly ? undefined : continueStroke} onPointerUp={readOnly ? undefined : finishStroke} onPointerCancel={readOnly ? undefined : finishStroke} />
        </div>
        {!readOnly && <div className="pet-workshop-tools" role="toolbar" aria-label="Drawing tools">
          <button type="button" className={tool === "brush" ? "is-active" : ""} onClick={() => setTool("brush")}>Brush</button>
          <button type="button" className={tool === "eraser" ? "is-active" : ""} onClick={() => setTool("eraser")}>Eraser</button>
          <label className="pet-workshop-color">Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={tool === "eraser"} /></label>
          <label className="pet-workshop-brush">Size<input type="range" min="2" max="36" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><span>{brushSize}px</span></label>
          <label className="pet-workshop-onion-toggle"><input type="checkbox" checked={onionSkin} onChange={(event) => setOnionSkin(event.target.checked)} /> Onion skin</label>
          <button type="button" onClick={() => void undo()} disabled={history.current.length === 0}>Undo</button>
          <button type="button" onClick={clearFrame} disabled={loop && frameIndex === activeFrameCount - 1}>Clear cel</button>
          <button type="button" onClick={() => void duplicatePrevious()} disabled={loop && frameIndex === activeFrameCount - 1}>Duplicate previous</button>
          <button type="button" onClick={() => void generateCel()} disabled={generatingStrip || busy || (loop && frameIndex === activeFrameCount - 1)}>{generatingStrip ? "Generating locally…" : `Generate ${animation === "blink" ? "blink pose" : "cel"}`}</button>
        </div>}
      </div>
      <div className="pet-workshop-frame-rail" aria-label="Animation frames">
        <p>{animation === "blink" ? "4-frame blink sequence · adjustable duration" : `${activeFrameCount}-frame ${loop ? "loop · final cel mirrors rest" : "one-shot"}`}</p>
        <div>{frameThumbs.map((frame, index) => <button key={index} type="button" className={index === frameIndex ? "is-active" : ""} aria-label={`Edit frame ${index}`} aria-pressed={index === frameIndex} onClick={() => selectFrame(index)}><span>{frame ? <img src={frame} alt="" /> : <i />}</span><small>{index}</small></button>)}</div>
      </div>
    </div>
    {generatedCandidate && <div className="pet-generation-review pet-generation-strip-review"><img src={generatedCandidate} alt={"Generated " + animation + " cel candidate"} /><span>Review this cel before it enters the strip. Frame {frameIndex} of {activeFrameCount - 1}; the last loop cel always mirrors rest.</span><div><Button variant="ghost" onClick={() => void removeBackground(generatedCandidate)} disabled={backgroundBusy}>{backgroundBusy ? "Removing background locally…" : "Remove background locally"}</Button><Button variant="ghost" onClick={() => setGeneratedCandidate(null)}>Discard</Button><Button variant="primary" disabled={busy} onClick={() => void approveGeneratedCel()}>Use this cel</Button></div><small>Background removal runs locally. If needed, install “Pet image tools” in Image Studio first; the U2Net model downloads only when you use this action.</small></div>}
  </section>;
}

export function PetWorkshopPage() {
  const [profiles, setProfiles] = useState<PetSpriteProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedAnimation, setSelectedAnimation] = useState<PetAnimationId>("idle");
  const profile = profiles.find((item) => item.id === selectedId) ?? null;
  const builtinProfile = BUILTIN_PROFILES.find((item) => item.id === selectedId) ?? null;
  const activeProfile = profile ?? builtinProfile;
  const isBuiltin = Boolean(builtinProfile);
  const behavior = useMemo(() => profile ? normalizePetBehavior(profile.behavior, profile.name) : builtinProfile ? readPetBehavior(builtinProfile.name.toLocaleLowerCase(), builtinProfile.name) : null, [profile, builtinProfile]);
  const [behaviorPreview, setBehaviorPreview] = useState<PetBehaviorSettings | null>(null);
  const preferenceId = profile ? `custom:${profile.id}` : builtinProfile ? builtinProfile.name.toLocaleLowerCase() : "";
  const [blinkDuration, setBlinkDuration] = useState(PET_BLINK_DURATION_DEFAULT_MS);

  useEffect(() => {
    let active = true;
    void listPetSpriteProfiles().then((stored) => {
      if (!active) return;
      setProfiles(stored);
      const selected = localStorage.getItem("skai.pet.character")?.replace(/^custom:/, "") ?? "";
      setSelectedId(stored.some((item) => item.id === selected) ? selected : `builtin:${selected && BUILTIN_NAMES.includes(selected as (typeof BUILTIN_NAMES)[number]) ? selected : "percy"}`);
    }).catch((error) => setLoadError(error instanceof Error ? error.message : "Companion profiles could not be loaded."));
    return () => { active = false; };
  }, []);
  useEffect(() => { setBehaviorPreview(behavior); }, [behavior]);
  useEffect(() => { if (preferenceId) setBlinkDuration(readPetBlinkDuration(preferenceId)); }, [preferenceId]);

  const updateProfile = async (updated: PetSpriteProfile) => {
    setSaving(true);
    try {
      await savePetSpriteProfile(updated);
      setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLoadError(null);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "The companion could not be saved."); }
    finally { setSaving(false); }
  };
  const importAnimationStrip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !profile) return;
    try {
      if (selectedAnimation === "blink") {
        const blink = await validatePetStrip(file, false, undefined, 4, false);
        await updateProfile({ ...profile, blink });
      } else {
        const strip = await validatePetStrip(file);
        await updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: { ...strip, fps: 13, loop: true } } });
      }
    } catch (error) { setLoadError(error instanceof Error ? error.message : "This strip could not be imported."); }
  };
  const activateProfile = (id: string) => {
    setSelectedId(id);
    localStorage.setItem("skai.pet.character", `custom:${id}`);
    window.dispatchEvent(new StorageEvent("storage", { key: "skai.pet.character", newValue: `custom:${id}` }));
  };
  const createProfile = async () => {
    const name = newName.trim().slice(0, 48);
    if (!name) { setLoadError("Name the companion first."); return; }
    const created: PetSpriteProfile = { id: crypto.randomUUID(), name, strips: {}, behavior: defaultPetBehavior(name) };
    try {
      await savePetSpriteProfile(created);
      setProfiles((current) => [...current, created]);
      setSelectedId(created.id);
      setNewName("");
      setSelectedAnimation("idle");
      setLoadError(null);
      localStorage.setItem("skai.pet.character", `custom:${created.id}`);
      window.dispatchEvent(new StorageEvent("storage", { key: "skai.pet.character", newValue: `custom:${created.id}` }));
    } catch (error) { setLoadError(error instanceof Error ? error.message : "The companion could not be created."); }
  };
  const createGeneratedProfile = async (name: string, concept: string, forkFrom: string | null) => {
    const source = forkFrom ? BUILTIN_PROFILES.find((item) => item.id === forkFrom) : null;
    const copiedStrips = source
      ? Object.fromEntries(await Promise.all(Object.entries(source.strips).map(async ([animation, strip]) => [animation, { ...strip!, dataUrl: await blobAsDataUrl(await (await fetch(strip!.dataUrl)).blob()) }] as const))) as PetSpriteProfile["strips"]
      : {};
    const created: PetSpriteProfile = { id: crypto.randomUUID(), name, strips: copiedStrips, ...(concept ? { referenceImageDataUrl: concept } : {}), behavior: defaultPetBehavior(name, source?.name === "Blaze") };
    if (source?.blink) created.blink = { ...source.blink, dataUrl: await blobAsDataUrl(await (await fetch(source.blink.dataUrl)).blob()) };
    await savePetSpriteProfile(created);
    setProfiles((current) => [...current, created]);
    setSelectedId(created.id);
    setSelectedAnimation("idle");
    if (source) activateProfile(created.id);
  };
  const importProfile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = await validatePetProfileImport(file);
      await savePetSpriteProfile(imported);
      setProfiles((current) => [...current, imported]);
      activateProfile(imported.id);
      setLoadError(null);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "The profile could not be imported."); }
  };
  const updateBehavior = (next: PetBehaviorSettings) => {
    setBehaviorPreview(next);
    if (profile) void updateProfile({ ...profile, behavior: next });
    else if (builtinProfile) savePetBehavior(preferenceId, next);
  };
  const updateBlinkDuration = (nextDuration: number) => {
    setBlinkDuration(savePetBlinkDuration(preferenceId, nextDuration));
  };
  const routineSteps: PetActionId[] = (behaviorPreview?.actions ?? []).filter((action) => action !== "approach-cursor");
  const saveRoutineSteps = (actions: PetBehaviorSettings["actions"]) => {
    if (!behaviorPreview) return;
    // Cursor approach is an automatic setup step for pounce/fire actions, not
    // a user-authored step. Existing profiles with that legacy entry still load.
    updateBehavior({ ...behaviorPreview, actions, orderedActions: true, enabled: actions.length > 0 && behaviorPreview.enabled });
  };
  const addAction = (action: PetBehaviorSettings["actions"][number]) => {
    if (!behaviorPreview || routineSteps.includes(action)) return;
    saveRoutineSteps([...routineSteps, action]);
  };
  const moveAction = (index: number, direction: -1 | 1) => {
    if (!behaviorPreview) return;
    const actions = [...routineSteps];
    const next = index + direction;
    if (next < 0 || next >= actions.length) return;
    [actions[index], actions[next]] = [actions[next], actions[index]];
    saveRoutineSteps(actions);
  };
  const removeAction = (index: number) => saveRoutineSteps(routineSteps.filter((_, actionIndex) => actionIndex !== index));
  const removeProfile = async () => {
    if (!profile || !window.confirm(`Delete ${profile.name} and its custom animations?`)) return;
    await deletePetSpriteProfile(profile.id);
    const next = profiles.filter((item) => item.id !== profile.id);
    setProfiles(next);
    setSelectedId(next[0]?.id ?? "");
    if (localStorage.getItem("skai.pet.character") === `custom:${profile.id}`) {
      localStorage.setItem("skai.pet.character", "percy");
      window.dispatchEvent(new StorageEvent("storage", { key: "skai.pet.character", newValue: "percy" }));
    }
  };
  const exportProfile = () => {
    if (!profile) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${profile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "skai-pet"}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="pet-workshop-page">
    <PageHeader eyebrow="EXTRAS · PET WORKSHOP" title="Build a companion" description="Draw the frames, shape the personality, and preview how your pet behaves on the desktop." />
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    <div className="pet-workshop-layout">
      <aside className="pet-workshop-library">
        <div className="pet-workshop-create"><label htmlFor="pet-workshop-name">New companion</label><input id="pet-workshop-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={48} placeholder="Name your pet" /><Button variant="primary" onClick={() => void createProfile()}>Create pet</Button><label className="ui-button ui-button-secondary pet-workshop-import"><span>Import profile</span><input type="file" accept="application/json,.json" onChange={(event) => { void importProfile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
        <p className="section-kicker pet-workshop-library-label">SKAI ORIGINALS</p><div className="pet-workshop-profile-list" role="listbox" aria-label="Built-in companions">{BUILTIN_PROFILES.map((item) => <button key={item.id} type="button" className={item.id === selectedId ? "is-active" : ""} role="option" aria-selected={item.id === selectedId} onClick={() => { setSelectedId(item.id); setSelectedAnimation("idle"); }}><span className="pet-workshop-profile-avatar"><i style={stripPreviewStyle(item.strips.idle!)} /></span><span><strong>{item.name}</strong><small>Built-in · 8 states + blink</small></span><b>›</b></button>)}</div>
        <PetGenerationGuide onApprove={createGeneratedProfile} />
        {profiles.length > 0 && <><p className="section-kicker pet-workshop-library-label">YOUR COMPANIONS</p><div className="pet-workshop-profile-list" role="listbox" aria-label="Custom companions">{profiles.map((item) => <button key={item.id} type="button" className={item.id === selectedId ? "is-active" : ""} role="option" aria-selected={item.id === selectedId} onClick={() => { activateProfile(item.id); setSelectedAnimation("idle"); }}><span className="pet-workshop-profile-avatar">{item.strips.idle ? <i style={stripPreviewStyle(item.strips.idle)} /> : "✦"}</span><span><strong>{item.name}</strong><small>{Object.keys(item.strips).length} animations · custom pet</small></span><b>›</b></button>)}</div></>}
      </aside>
      <main className="pet-workshop-main">
        {activeProfile && (isBuiltin || behaviorPreview) ? <>
          <header className="pet-workshop-profile-heading"><div><p className="section-kicker">{isBuiltin ? "SKAI ORIGINAL · BUILT-IN REFERENCE" : "COMPANION PROFILE"}</p>{isBuiltin ? <h2>{activeProfile.name}</h2> : <input aria-label="Companion name" value={profile!.name} maxLength={48} onChange={(event) => setProfiles((current) => current.map((item) => item.id === profile!.id ? { ...item, name: event.target.value } : item))} onBlur={() => { const next = profiles.find((item) => item.id === profile!.id); if (next?.name.trim()) void updateProfile({ ...next, name: next.name.trim() }); }} />}<p>{isBuiltin ? "Production sprite strips, frame by frame. This is the artwork shipped with Skai Desktop." : profile?.strips.idle ? "Custom artwork and behavior stay with this profile." : "Draft pet · create its idle strip before using it on the desktop."}</p></div><div>{isBuiltin ? <Button variant="secondary" disabled={saving} onClick={() => void createGeneratedProfile(activeProfile.name + " copy", "", activeProfile.id)}>Fork this pet</Button> : <><Button variant="secondary" disabled={!profile?.strips.idle || localStorage.getItem("skai.pet.character") === `custom:${profile!.id}`} onClick={() => activateProfile(profile!.id)}>Use this pet</Button><Button variant="secondary" onClick={exportProfile}>Export profile</Button><Button variant="ghost" onClick={() => void removeProfile()}>Delete</Button></>}</div></header>
          {!isBuiltin && profile?.referenceImageDataUrl && <div className="pet-generation-reference"><div><strong>Approved concept reference</strong><span>Use this local image while drawing the companion’s animation strips below.</span></div><img src={profile.referenceImageDataUrl} alt={`${profile.name} concept reference`} /></div>}
          {behaviorPreview && <>
          <section className="pet-workshop-behavior">
            <div className="pet-workshop-section-heading"><div><p className="section-kicker">{isBuiltin ? `${activeProfile.name.toLocaleUpperCase()}’S PERSONALITY` : "COMPANION PERSONALITY"}</p><h2>Signature behavior</h2><p>{isBuiltin ? "This pet has its own little routine while resting or wandering." : "Build an ordered routine for this companion using its existing animations."}</p></div><label className="pet-workshop-switch"><input type="checkbox" checked={behaviorPreview.enabled} onChange={(event) => updateBehavior({ ...behaviorPreview, enabled: event.target.checked })} /><span>{behaviorPreview.enabled ? "Enabled" : "Disabled"}</span></label></div>
            {isBuiltin ? <div className="pet-workshop-personality-chip"><strong>{behaviorPreview.actions.map((action) => PET_ACTIONS.find((item) => item.id === action)?.label ?? action).join(" + ") || "No routine selected"}</strong><span>{activeProfile.name === "Blaze" ? "Locks onto a stationary cursor, approaches, then commits to a pounce or a large fire-breath attack." : "Runs occasionally while idle or walking; it pauses during active work, dragging, or reduced motion."}</span></div> : <div className="pet-workshop-routine">
              <div className="pet-workshop-routine-heading"><div><strong>Routine steps</strong><small>Steps play in order. Cursor approach is added automatically before an attack.</small></div></div>
              {routineSteps.length > 0 ? <ol className="pet-workshop-routine-list">{routineSteps.map((action, index) => <li key={action}><span className="pet-workshop-action-number">{String(index + 1).padStart(2, "0")}</span><span>{PET_ACTIONS.find((item) => item.id === action)?.label ?? action}</span><div><button type="button" aria-label={`Move ${action} earlier`} disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button type="button" aria-label={`Move ${action} later`} disabled={index === routineSteps.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button type="button" aria-label={`Remove ${action}`} onClick={() => removeAction(index)}>Remove</button></div></li>)}</ol> : <p className="pet-workshop-routine-empty">No steps yet. Add one below to give this pet a routine.</p>}
              <div className="pet-workshop-routine-add"><span>Add a step</span>{PET_ACTIONS.filter((item) => item.id !== "approach-cursor" && (!item.needsCursor || profile?.name.trim().toLocaleLowerCase() === "blaze") && !routineSteps.includes(item.id)).map((item) => <button key={item.id} type="button" onClick={() => addAction(item.id)}>+ {item.label}</button>)}</div>
            </div>}
            <div className="pet-workshop-behavior-options"><label><input type="checkbox" checked={behaviorPreview.triggerDuringIdle} onChange={(event) => updateBehavior({ ...behaviorPreview, triggerDuringIdle: event.target.checked })} /> While idle</label><label><input type="checkbox" checked={behaviorPreview.triggerDuringWalk} onChange={(event) => updateBehavior({ ...behaviorPreview, triggerDuringWalk: event.target.checked })} /> While walking</label><label className="pet-workshop-interval">Random wait<input type="number" min="10" max="480" value={behaviorPreview.minimumIntervalSeconds} onChange={(event) => { const minimum = Math.max(10, Number(event.target.value)); updateBehavior({ ...behaviorPreview, minimumIntervalSeconds: minimum, maximumIntervalSeconds: Math.max(minimum, behaviorPreview.maximumIntervalSeconds) }); }} /><span>to</span><input type="number" min="10" max="480" value={behaviorPreview.maximumIntervalSeconds} onChange={(event) => { const maximum = Math.max(10, Number(event.target.value)); updateBehavior({ ...behaviorPreview, minimumIntervalSeconds: Math.min(behaviorPreview.minimumIntervalSeconds, maximum), maximumIntervalSeconds: maximum }); }} /><span>seconds · default 30–60</span></label></div>
            {activeProfile.name === "Blaze" && <p className="pet-workshop-safety-note">The fight scene only reads a steady cursor position. It never moves or clicks it, and the expanded effect window passes clicks through.</p>}
          </section>
          <section className="pet-workshop-blink-control"><div><p className="section-kicker">BLINK TIMING · {activeProfile.name.toLocaleUpperCase()}</p><strong>How long should {activeProfile.name} blink?</strong><span>Adjust the timing live. This setting is saved separately for each pet.</span></div><label><input aria-label={`${activeProfile.name} blink duration`} type="range" min={PET_BLINK_DURATION_MIN_MS} max={PET_BLINK_DURATION_MAX_MS} step="10" value={blinkDuration} onChange={(event) => updateBlinkDuration(Number(event.target.value))} /><output>{blinkDuration} ms</output></label></section>
          </>}
          <section className="pet-workshop-animation-section">
            <div className="pet-workshop-section-heading"><div><p className="section-kicker">{isBuiltin ? "SHIPPED ANIMATION CELLS" : "ANIMATION STUDIO"}</p><h2>{isBuiltin ? "How this pet is built" : "Draw every moment"}</h2><p>{isBuiltin ? "Source art at native 256 × 256 resolution · 11 frames · frame 0 and 10 close the loop." : "4–32 cels per strip · transparent background · choose looping or one-shot playback."}</p></div>{!isBuiltin && <label className="ui-button ui-button-secondary pet-workshop-import-strip"><span>Import sprite strip</span><input type="file" accept="image/png,image/webp" onChange={importAnimationStrip} /></label>}</div>
            <div className="pet-workshop-animation-tabs" role="tablist" aria-label="Animations">{(isBuiltin ? PET_ANIMATIONS.filter((item) => BUILTIN_STATES[item.id] || item.id === "blink") : PET_ANIMATIONS).map((animation) => { const strip = animation.id === "blink" ? activeProfile.blink : activeProfile.strips[animation.id]; return <button key={animation.id} type="button" role="tab" aria-selected={selectedAnimation === animation.id} className={selectedAnimation === animation.id ? "is-active" : ""} onClick={() => setSelectedAnimation(animation.id)}>{animation.label}<small>{strip ? `${strip.frameCount ?? (animation.id === "blink" ? 4 : PET_FRAME_COUNT)} frames` : "Empty"}</small></button>; })}</div>
            {!isBuiltin && profile && selectedAnimation !== "blink" && profile.strips[selectedAnimation] && <div className="pet-workshop-playback-controls"><label>Playback speed <input type="range" min="6" max="30" step="1" value={profile.strips[selectedAnimation]!.fps ?? 13} onChange={(event) => { const strip = profile.strips[selectedAnimation]!; void updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: { ...strip, fps: Number(event.target.value) } } }); }} /><output>{profile.strips[selectedAnimation]!.fps ?? 13} fps</output></label><label className="pet-workshop-loop-toggle"><input type="checkbox" checked={profile.strips[selectedAnimation]!.loop !== false} onChange={(event) => { const strip = profile.strips[selectedAnimation]!; void updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: { ...strip, loop: event.target.checked } } }); }} /> Loop animation</label></div>}
            <PetFrameEditor key={`${activeProfile.id}-${selectedAnimation}`} strip={selectedAnimation === "blink" ? activeProfile.blink : activeProfile.strips[selectedAnimation]} animation={selectedAnimation} loop={selectedAnimation !== "blink" && profile?.strips[selectedAnimation]?.loop !== false} busy={saving} readOnly={isBuiltin} referenceImage={profile?.referenceImageDataUrl} onSave={(strip) => profile ? selectedAnimation === "blink" ? updateProfile({ ...profile, blink: strip }) : updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: { ...strip, fps: profile.strips[selectedAnimation]?.fps ?? 13, loop: profile.strips[selectedAnimation]?.loop !== false } } }) : Promise.resolve()} />
          </section>
        </> : <div className="pet-workshop-welcome"><div className="pet-workshop-welcome-mark">✦</div><p className="section-kicker">MAKE IT YOURS</p><h2>Start with a blank canvas</h2><p>Create a custom pet profile or import one to begin drawing 4–32-frame animations and designing its behavior.</p></div>}
      </main>
    </div>
  </section>;
}
