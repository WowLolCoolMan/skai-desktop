import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PetBehaviorSettings } from "../../../shared/contracts";
import { Button, PageHeader } from "../../components/ui/Primitives";
import { defaultPetBehavior, deletePetSpriteProfile, listPetSpriteProfiles, normalizePetBehavior, PET_ACTIONS, PET_ANIMATIONS, PET_FRAME_COUNT, savePetSpriteProfile, validatePetProfileImport, validatePetStrip, type PetAnimationId, type PetSpriteProfile, type PetStrip } from "../settings/petSprites";

const DEFAULT_FRAME_SIZE = 128;
const EMPTY_FRAMES = () => Array.from({ length: PET_FRAME_COUNT }, () => "");

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be opened."));
    image.src = source;
  });
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

function PetFrameEditor({ strip, animation, onSave, busy }: { strip?: PetStrip; animation: PetAnimationId; onSave: (strip: PetStrip) => Promise<void>; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const frameData = useRef<string[]>(EMPTY_FRAMES());
  const history = useRef<string[]>([]);
  const [frameWidth, setFrameWidth] = useState(DEFAULT_FRAME_SIZE);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_SIZE);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameThumbs, setFrameThumbs] = useState<string[]>(EMPTY_FRAMES());
  const [legacyStrip, setLegacyStrip] = useState<PetStrip | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [color, setColor] = useState("#ff793f");
  const [brushSize, setBrushSize] = useState(8);
  const [onionSkin, setOnionSkin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      frameData.current = EMPTY_FRAMES();
      history.current = [];
      setFrameThumbs(EMPTY_FRAMES());
      setFrameIndex(0);
      setError(null);
      setLegacyStrip(strip && (strip.frameCount ?? 6) !== PET_FRAME_COUNT ? strip : null);
      if (!strip || (strip.frameCount ?? 6) !== PET_FRAME_COUNT) {
        const width = strip?.frameWidth ?? DEFAULT_FRAME_SIZE;
        const height = strip?.frameHeight ?? DEFAULT_FRAME_SIZE;
        setFrameWidth(width);
        setFrameHeight(height);
        return;
      }
      try {
        const image = await loadImage(strip.dataUrl);
        const cellWidth = image.naturalWidth / PET_FRAME_COUNT;
        const loadedFrames = EMPTY_FRAMES();
        for (let index = 0; index < PET_FRAME_COUNT; index += 1) {
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
  }, [strip?.dataUrl, strip?.frameWidth, strip?.frameHeight, strip?.frameCount, animation]);

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
    if (event.button !== 0) return;
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
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, frameWidth, frameHeight);
    frameData.current[frameIndex] = "";
    setFrameThumbs([...frameData.current]);
  };
  const duplicatePrevious = async () => {
    if (!canvasRef.current) return;
    const previous = frameData.current[(frameIndex + PET_FRAME_COUNT - 1) % PET_FRAME_COUNT];
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
    output.width = frameWidth * PET_FRAME_COUNT;
    output.height = frameHeight;
    const context = output.getContext("2d");
    if (!context) { setError("The sprite strip could not be assembled."); return; }
    try {
      for (let index = 0; index < PET_FRAME_COUNT; index += 1) {
        const data = frameData.current[index];
        if (!data) continue;
        const image = await loadImage(data);
        context.drawImage(image, index * frameWidth, 0, frameWidth, frameHeight);
      }
      const blob = await (await fetch(output.toDataURL("image/png"))).blob();
      const strip = await validatePetStrip(new File([blob], `${animation}.png`, { type: "image/png" }));
      setError(null);
      await onSave(strip);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The sprite strip could not be saved.");
    }
  };
  const previousFrame = (frameIndex + PET_FRAME_COUNT - 1) % PET_FRAME_COUNT;

  return <section className="pet-workshop-editor" aria-label={`${animation} animation editor`}>
    <div className="pet-workshop-editor-heading"><div><p className="section-kicker">FRAME EDITOR</p><h3>{PET_ANIMATIONS.find((item) => item.id === animation)?.label ?? animation}</h3><p>Draw on each cel. Frame 0 is the rest pose; frame 9 closes the loop.</p></div><Button variant="primary" disabled={busy} onClick={() => void saveStrip()}>{busy ? "Saving…" : "Save 10-frame strip"}</Button></div>
    {legacyStrip && <div className="pet-workshop-legacy" role="status"><strong>Legacy six-frame art</strong><span>Redraw this animation as ten frames. Your original stays in this profile until the replacement is saved.</span><div className="pet-workshop-legacy-preview" style={stripPreviewStyle(legacyStrip)} aria-label="Legacy sprite strip preview" /></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pet-workshop-drawing-layout">
      <div className="pet-workshop-canvas-wrap">
        <div className="pet-workshop-artboard" style={{ width: Math.min(384, frameWidth * 2), height: Math.min(384, frameHeight * 2) }}>
          {onionSkin && frameThumbs[previousFrame] && <img className="pet-workshop-onion" src={frameThumbs[previousFrame]} alt="" />}
          <canvas ref={canvasRef} aria-label={`Draw frame ${frameIndex}`} onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={finishStroke} onPointerCancel={finishStroke} />
        </div>
        <div className="pet-workshop-tools" role="toolbar" aria-label="Drawing tools">
          <button type="button" className={tool === "brush" ? "is-active" : ""} onClick={() => setTool("brush")}>Brush</button>
          <button type="button" className={tool === "eraser" ? "is-active" : ""} onClick={() => setTool("eraser")}>Eraser</button>
          <label className="pet-workshop-color">Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={tool === "eraser"} /></label>
          <label className="pet-workshop-brush">Size<input type="range" min="2" max="36" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><span>{brushSize}px</span></label>
          <label className="pet-workshop-onion-toggle"><input type="checkbox" checked={onionSkin} onChange={(event) => setOnionSkin(event.target.checked)} /> Onion skin</label>
          <button type="button" onClick={() => void undo()} disabled={history.current.length === 0}>Undo</button>
          <button type="button" onClick={clearFrame}>Clear cel</button>
          <button type="button" onClick={() => void duplicatePrevious()}>Duplicate previous</button>
        </div>
      </div>
      <div className="pet-workshop-frame-rail" aria-label="Animation frames">
        <p>10-frame loop</p>
        <div>{frameThumbs.map((frame, index) => <button key={index} type="button" className={index === frameIndex ? "is-active" : ""} aria-label={`Edit frame ${index}`} aria-pressed={index === frameIndex} onClick={() => selectFrame(index)}><span>{frame ? <img src={frame} alt="" /> : <i />}</span><small>{index}</small></button>)}</div>
      </div>
    </div>
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
  const behavior = useMemo(() => profile ? normalizePetBehavior(profile.behavior, profile.name) : null, [profile]);
  const [behaviorPreview, setBehaviorPreview] = useState<PetBehaviorSettings | null>(null);

  useEffect(() => {
    let active = true;
    void listPetSpriteProfiles().then((stored) => {
      if (!active) return;
      setProfiles(stored);
      const selected = localStorage.getItem("skai.pet.character")?.replace(/^custom:/, "") ?? "";
      setSelectedId(stored.some((item) => item.id === selected) ? selected : stored[0]?.id ?? "");
    }).catch((error) => setLoadError(error instanceof Error ? error.message : "Companion profiles could not be loaded."));
    return () => { active = false; };
  }, []);
  useEffect(() => { setBehaviorPreview(behavior); }, [behavior]);

  const updateProfile = async (updated: PetSpriteProfile) => {
    setSaving(true);
    try {
      await savePetSpriteProfile(updated);
      setProfiles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setLoadError(null);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "The companion could not be saved."); }
    finally { setSaving(false); }
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
  };
  const addAction = (action: PetBehaviorSettings["actions"][number]) => {
    if (!behaviorPreview || behaviorPreview.actions.includes(action)) return;
    updateBehavior({ ...behaviorPreview, actions: [...behaviorPreview.actions, action] });
  };
  const moveAction = (index: number, direction: -1 | 1) => {
    if (!behaviorPreview) return;
    const actions = [...behaviorPreview.actions];
    const next = index + direction;
    if (next < 0 || next >= actions.length) return;
    [actions[index], actions[next]] = [actions[next], actions[index]];
    updateBehavior({ ...behaviorPreview, actions });
  };
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
        <div className="pet-workshop-profile-list" role="listbox" aria-label="Custom companions">{profiles.map((item) => <button key={item.id} type="button" className={item.id === selectedId ? "is-active" : ""} role="option" aria-selected={item.id === selectedId} onClick={() => activateProfile(item.id)}><span className="pet-workshop-profile-avatar">{item.strips.idle ? <i style={stripPreviewStyle(item.strips.idle)} /> : "✦"}</span><span><strong>{item.name}</strong><small>{Object.keys(item.strips).length} animations · custom pet</small></span><b>›</b></button>)}{profiles.length === 0 && <p className="pet-workshop-empty">Create a pet or import a profile to start drawing.</p>}</div>
      </aside>
      <main className="pet-workshop-main">
        {profile && behaviorPreview ? <>
          <header className="pet-workshop-profile-heading"><div><p className="section-kicker">COMPANION PROFILE</p><input aria-label="Companion name" value={profile.name} maxLength={48} onChange={(event) => setProfiles((current) => current.map((item) => item.id === profile.id ? { ...item, name: event.target.value } : item))} onBlur={() => { const next = profiles.find((item) => item.id === profile.id); if (next?.name.trim()) void updateProfile({ ...next, name: next.name.trim() }); }} /><p>Custom artwork and behavior stay with this profile.</p></div><div><Button variant="secondary" onClick={exportProfile}>Export profile</Button><Button variant="ghost" onClick={() => void removeProfile()}>Delete</Button></div></header>
          <section className="pet-workshop-behavior">
            <div className="pet-workshop-section-heading"><div><p className="section-kicker">PERSONALITY</p><h2>Boredom behavior</h2><p>Let your companion surprise you while resting or wandering.</p></div><label className="pet-workshop-switch"><input type="checkbox" checked={behaviorPreview.enabled} onChange={(event) => updateBehavior({ ...behaviorPreview, enabled: event.target.checked })} /><span>{behaviorPreview.enabled ? "Enabled" : "Disabled"}</span></label></div>
            <div className="pet-workshop-behavior-options"><label><input type="checkbox" checked={behaviorPreview.triggerDuringIdle} onChange={(event) => updateBehavior({ ...behaviorPreview, triggerDuringIdle: event.target.checked })} /> While idle</label><label><input type="checkbox" checked={behaviorPreview.triggerDuringWalk} onChange={(event) => updateBehavior({ ...behaviorPreview, triggerDuringWalk: event.target.checked })} /> While walking</label><label className="pet-workshop-interval">Random wait<input type="number" min="20" max="480" value={behaviorPreview.minimumIntervalSeconds} onChange={(event) => updateBehavior({ ...behaviorPreview, minimumIntervalSeconds: Number(event.target.value) })} /><span>to</span><input type="number" min="20" max="480" value={behaviorPreview.maximumIntervalSeconds} onChange={(event) => updateBehavior({ ...behaviorPreview, maximumIntervalSeconds: Number(event.target.value) })} /><span>seconds</span></label></div>
            <div className="pet-workshop-actions-heading"><div><strong>Possible actions</strong><small>Skai assembles a random combination; cursor actions approach first and return afterward.</small></div><label>Add action<select value="" onChange={(event) => { if (event.target.value) addAction(event.target.value as PetBehaviorSettings["actions"][number]); }}><option value="">Choose…</option>{PET_ACTIONS.filter((item) => !behaviorPreview.actions.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
            <div className="pet-workshop-action-list">{behaviorPreview.actions.map((action, index) => { const item = PET_ACTIONS.find((candidate) => candidate.id === action)!; return <article key={`${action}-${index}`}><span className="pet-workshop-action-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.label}</strong><small>{action === "fire-breath" ? "Play the fire-breath animation and aim at the cursor." : action === "pounce" ? "Lunge toward the current cursor position." : "Move beside the cursor before attacking."}</small></span><div><button type="button" aria-label={`Move ${item.label} earlier`} disabled={index === 0} onClick={() => moveAction(index, -1)}>↑</button><button type="button" aria-label={`Move ${item.label} later`} disabled={index === behaviorPreview.actions.length - 1} onClick={() => moveAction(index, 1)}>↓</button><button type="button" aria-label={`Remove ${item.label}`} onClick={() => updateBehavior({ ...behaviorPreview, actions: behaviorPreview.actions.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div></article>; })}{behaviorPreview.actions.length === 0 && <p className="pet-workshop-empty">Add an action to make this companion expressive.</p>}</div>
            <p className="pet-workshop-safety-note">Attacks only read the cursor position. They never move or click it. Hidden pets, dragging, and reduced motion pause these behaviors.</p>
          </section>
          <section className="pet-workshop-animation-section">
            <div className="pet-workshop-section-heading"><div><p className="section-kicker">ANIMATION STUDIO</p><h2>Draw every moment</h2><p>Ten cels per strip · transparent background · frame 0 is rest · frame 9 closes the loop.</p></div><label className="ui-button ui-button-secondary pet-workshop-import-strip"><span>Import 10-frame strip</span><input type="file" accept="image/png,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file || !profile) return; try { const strip = await validatePetStrip(file); await updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: strip } }); } catch (error) { setLoadError(error instanceof Error ? error.message : "This strip could not be imported."); } }} /></label></div>
            <div className="pet-workshop-animation-tabs" role="tablist" aria-label="Animations">{PET_ANIMATIONS.map((animation) => <button key={animation.id} type="button" role="tab" aria-selected={selectedAnimation === animation.id} className={selectedAnimation === animation.id ? "is-active" : ""} onClick={() => setSelectedAnimation(animation.id)}>{animation.label}<small>{profile.strips[animation.id] ? (profile.strips[animation.id]?.frameCount ?? 6) === PET_FRAME_COUNT ? "10 frames" : "Redraw" : "Empty"}</small></button>)}</div>
            <PetFrameEditor key={`${profile.id}-${selectedAnimation}`} strip={profile.strips[selectedAnimation]} animation={selectedAnimation} busy={saving} onSave={(strip) => updateProfile({ ...profile, strips: { ...profile.strips, [selectedAnimation]: strip } })} />
          </section>
        </> : <div className="pet-workshop-welcome"><div className="pet-workshop-welcome-mark">✦</div><p className="section-kicker">MAKE IT YOURS</p><h2>Start with a blank canvas</h2><p>Create a custom pet profile or import one to begin drawing ten-frame animations and designing its behavior.</p></div>}
      </main>
    </div>
  </section>;
}
