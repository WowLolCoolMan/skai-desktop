import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "../../components/ui/Primitives";
import { PET_ANIMATIONS, PET_FRAME_COUNT, validatePetStrip, type PetAnimationId, type PetStrip } from "../settings/petSprites";
import { blobAsDataUrl, loadImage } from "./petWorkshopImageUtils";

const DEFAULT_FRAME_SIZE = 128;

export function PetFrameEditor({ strip, animation, onSave, busy, readOnly = false, referenceImage, loop = true }: { strip?: PetStrip; animation: PetAnimationId; onSave: (strip: PetStrip) => Promise<void>; busy: boolean; readOnly?: boolean; referenceImage?: string; loop?: boolean }) {
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
  const [color, setColor] = useState(() => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--skai-color-accent").trim()));
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
    context.fillStyle = tool === "eraser" ? getComputedStyle(canvas).getPropertyValue("--skai-color-shadow").trim() || "black" : color;
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
    context.strokeStyle = tool === "eraser" ? getComputedStyle(event.currentTarget).getPropertyValue("--skai-color-shadow").trim() || "black" : color;
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
      <div className="pet-workshop-frame-rail" role="region" aria-label="Animation frames">
        <p>{animation === "blink" ? "4-frame blink sequence · adjustable duration" : `${activeFrameCount}-frame ${loop ? "loop · final cel mirrors rest" : "one-shot"}`}</p>
        <div>{frameThumbs.map((frame, index) => <button key={index} type="button" className={index === frameIndex ? "is-active" : ""} aria-label={`Edit frame ${index}`} aria-pressed={index === frameIndex} onClick={() => selectFrame(index)}><span>{frame ? <img src={frame} alt="" /> : <i />}</span><small>{index}</small></button>)}</div>
      </div>
    </div>
    {generatedCandidate && <div className="pet-generation-review pet-generation-strip-review"><img src={generatedCandidate} alt={"Generated " + animation + " cel candidate"} /><span>Review this cel before it enters the strip. Frame {frameIndex} of {activeFrameCount - 1}; the last loop cel always mirrors rest.</span><div><Button variant="ghost" onClick={() => void removeBackground(generatedCandidate)} disabled={backgroundBusy}>{backgroundBusy ? "Removing background locally…" : "Remove background locally"}</Button><Button variant="ghost" onClick={() => setGeneratedCandidate(null)}>Discard</Button><Button variant="primary" disabled={busy} onClick={() => void approveGeneratedCel()}>Use this cel</Button></div><small>Background removal runs locally. If needed, install “Pet image tools” in Image Studio first; the U2Net model downloads only when you use this action.</small></div>}
  </section>;
}
