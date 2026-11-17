import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PetActivity, PetBehaviorSettings, PetCompletionEvent, PetMotionSettings } from "../../../shared/contracts";
import { defaultPetBehavior, getPetSpriteProfile, normalizePetBehavior, petPreferenceId, petStripFrameCount, readPetBehavior, readPetBlinkDuration, type PetAnimationId, type PetSpriteProfile } from "../../features/settings/petSprites";
import { PetSpriteCanvas } from "../../features/pets/engine/PetSpriteCanvas";
import { loadMotionPet, motionAnimationClip, type MotionPetManifest } from "../../features/pets/engine/motionPets";
import { PetMotionCanvas } from "../../features/pets/engine/PetMotionCanvas";

type PetPose = "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "success" | "error" | "needs-attention" | "angry" | "pounce" | "fire-breath" | "celebrate" | "curious-scan" | "ember-curl" | "star-orbit" | "rock-roll" | "sprout-stretch";
type BuiltinPose = "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "success" | "error";
const BUILTIN_POSE_BY_ACTIVITY: Record<PetPose, BuiltinPose> = {
  idle: "idle", walk: "walk", thinking: "thinking", coding: "coding", coding_malicious: "coding_malicious",
  stuck: "stuck", success: "success", error: "error", "needs-attention": "error", angry: "idle", pounce: "idle", "fire-breath": "idle",
  celebrate: "success", "curious-scan": "thinking", "ember-curl": "idle", "star-orbit": "idle", "rock-roll": "walk", "sprout-stretch": "idle",
};
const BUILTIN_STRIPS: Record<string, Record<BuiltinPose, string>> = {
  percy: {
    idle: new URL("../../../../../assets/pets/generated/percy-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/percy-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/percy-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/percy-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/percy-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/percy-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/percy-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/percy-error-frames.png", import.meta.url).href,
  },
  byte: {
    idle: new URL("../../../../../assets/pets/generated/byte-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/byte-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/byte-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/byte-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/byte-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/byte-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/byte-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/byte-error-frames.png", import.meta.url).href,
  },
  ember: {
    idle: new URL("../../../../../assets/pets/generated/ember-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/ember-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/ember-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/ember-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/ember-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/ember-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/ember-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/ember-error-frames.png", import.meta.url).href,
  },
  blaze: {
    idle: new URL("../../../../../assets/pets/generated/blaze-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/blaze-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/blaze-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/blaze-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/blaze-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/blaze-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/blaze-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/blaze-error-frames.png", import.meta.url).href,
  },
  nova: {
    idle: new URL("../../../../../assets/pets/generated/nova-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/nova-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/nova-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/nova-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/nova-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/nova-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/nova-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/nova-error-frames.png", import.meta.url).href,
  },
  rocky: {
    idle: new URL("../../../../../assets/pets/generated/rocky-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/rocky-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/rocky-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/rocky-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/rocky-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/rocky-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/rocky-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/rocky-error-frames.png", import.meta.url).href,
  },
  sprout: {
    idle: new URL("../../../../../assets/pets/generated/sprout-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/sprout-walk-frames.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/sprout-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/sprout-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/sprout-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/sprout-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/sprout-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/sprout-error-frames.png", import.meta.url).href,
  },
};
const BUILTIN_BLINK_STRIPS: Record<string, string> = {
  percy: new URL("../../../../../assets/pets/generated/percy-blink-frames.png", import.meta.url).href,
  byte: new URL("../../../../../assets/pets/generated/byte-blink-frames.png", import.meta.url).href,
  ember: new URL("../../../../../assets/pets/generated/ember-blink-frames.png", import.meta.url).href,
  blaze: new URL("../../../../../assets/pets/generated/blaze-blink-frames.png", import.meta.url).href,
  nova: new URL("../../../../../assets/pets/generated/nova-blink-frames.png", import.meta.url).href,
  rocky: new URL("../../../../../assets/pets/generated/rocky-blink-frames.png", import.meta.url).href,
  sprout: new URL("../../../../../assets/pets/generated/sprout-blink-frames.png", import.meta.url).href,
};
const BLAZE_FIRE_BREATH = new URL("../../../../../assets/pets/generated/blaze-fire-breath-frames.png", import.meta.url).href;
const BLAZE_FIRE_IMPACT = new URL("../../../../../assets/pets/generated/blaze-fire-impact-frames.png", import.meta.url).href;
const BLAZE_FIRE_BREATH_BODY_V2 = new URL("../../../../../assets/pets/generated/blaze-fire-breath-body-v2-atlas.png", import.meta.url).href;

// Native Wayland: the app cannot move its own windows, so the compositor drags
// Percy (CSS app-region) and Percy stays put instead of walking in place.
const COMPOSITOR_DRAG = new URLSearchParams(window.location.search).get("drag") === "compositor";
// X11 without a compositor cannot show transparency; draw Percy on a solid card instead of a black box.
const OPAQUE_SURFACE = new URLSearchParams(window.location.search).get("surface") === "opaque";
const animationByPose: Record<PetPose, PetAnimationId> = {
  idle: "idle", walk: "walking", thinking: "thinking", coding: "working", coding_malicious: "malicious-coding",
  stuck: "stuck", success: "success", error: "fail", "needs-attention": "needs-attention", angry: "angry", pounce: "pounce", "fire-breath": "fire-breath",
  celebrate: "success", "curious-scan": "thinking", "ember-curl": "idle", "star-orbit": "idle", "rock-roll": "walking", "sprout-stretch": "idle",
};
const BUILTIN_NAMES: Record<string, string> = { percy: "Percy", byte: "Byte", ember: "Ember", blaze: "Blaze", nova: "Nova", rocky: "Rocky", sprout: "Sprout" };

function readPetCharacter() {
  const saved = localStorage.getItem("skai.pet.character");
  if (saved && (["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"].includes(saved) || saved.startsWith("custom:"))) return saved;
  localStorage.setItem("skai.pet.character", "percy");
  return "percy";
}

export function PetWindow() {
  const [pose, setPose] = useState<PetPose>("walk");
  const [poseGeneration, setPoseGeneration] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubbleKind, setBubbleKind] = useState<PetCompletionEvent["kind"]>("success");
  const [motion, setMotion] = useState<PetMotionSettings>({ wander: true, reduceMotion: false, interactionDemo: false });
  const [activity, setActivity] = useState<PetActivity>({ state: "idle", facing: 1 });
  const [entering, setEntering] = useState(false);
  const [character, setCharacter] = useState(readPetCharacter);
  const [customProfile, setCustomProfile] = useState<PetSpriteProfile | null>(null);
  const [motionManifest, setMotionManifest] = useState<MotionPetManifest | null>(null);
  const [draggingState, setDraggingState] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [blinkDuration, setBlinkDuration] = useState(() => readPetBlinkDuration(readPetCharacter()));
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const dragging = useRef(false);
  const motionRef = useRef(motion);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const poseTimer = useRef<number | undefined>(undefined);
  const companionName = customProfile?.name ?? BUILTIN_NAMES[character] ?? "Companion";

  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    let active = true;
    if (character.startsWith("custom:")) { setMotionManifest(null); return () => { active = false; }; }
    void loadMotionPet(character).then((manifest) => { if (active) setMotionManifest(manifest); }).catch(() => { if (active) setMotionManifest(null); });
    return () => { active = false; };
  }, [character]);

  useEffect(() => {
    let active = true;
    const syncProfile = async (nextCharacter = readPetCharacter()) => {
      setCharacter(nextCharacter);
      setBlinkDuration(readPetBlinkDuration(nextCharacter));
      if (!nextCharacter.startsWith("custom:")) {
        setCustomProfile(null);
        window.skaiAgent?.pet?.setBehaviorSettings(readPetBehavior(nextCharacter, BUILTIN_NAMES[nextCharacter] ?? ""));
        return;
      }
      try {
        const profile = await getPetSpriteProfile(nextCharacter.slice("custom:".length));
        if (active) {
          setCustomProfile(profile);
          const behavior: PetBehaviorSettings = normalizePetBehavior(profile?.behavior, profile?.name ?? "");
          window.skaiAgent?.pet?.setBehaviorSettings(behavior);
        }
      } catch {
        if (active) setCustomProfile(null);
        window.skaiAgent?.pet?.setBehaviorSettings(defaultPetBehavior("", false));
      }
    };
    void syncProfile();
    const syncSettings = (event?: StorageEvent) => {
      if (event?.key?.startsWith("skai.pet.blinkDuration.v1.")) {
        const petId = event.key.slice("skai.pet.blinkDuration.v1.".length);
        if (petId === petPreferenceId(readPetCharacter())) setBlinkDuration(readPetBlinkDuration(readPetCharacter()));
        return;
      }
      if (event?.key?.startsWith("skai.pet.behavior.v1.")) {
        const petId = event.key.slice("skai.pet.behavior.v1.".length);
        if (petId === petPreferenceId(readPetCharacter())) void syncProfile();
        return;
      }
      void syncProfile();
    };
    window.addEventListener("storage", syncSettings);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("skai-companion-profiles");
    if (channel) channel.onmessage = (event) => {
      if (event.data?.type === "blink-duration-changed" && event.data.petId === petPreferenceId(readPetCharacter())) {
        setBlinkDuration(readPetBlinkDuration(readPetCharacter()));
      } else void syncProfile();
    };
    return () => { active = false; window.removeEventListener("storage", syncSettings); channel?.close(); };
  }, []);

  useEffect(() => {
    document.title = `${companionName} · Skai companion`;
    document.documentElement.dataset.petWindow = "true";
    document.body.dataset.petWindow = "true";
    if (OPAQUE_SURFACE) document.documentElement.dataset.petSurface = "opaque";
    const pet = window.skaiAgent?.pet;
    if (!pet) return () => { delete document.documentElement.dataset.petWindow; delete document.body.dataset.petWindow; };
    const showCompletion = (event: PetCompletionEvent) => {
      setBubble(event.text);
      setBubbleKind(event.kind);
      setPose(event.kind === "error" && /needs attention|requires approval|awaiting approval/i.test(event.text) ? "needs-attention" : event.kind);
      setPoseGeneration((generation) => generation + 1);
      window.clearTimeout(bubbleTimer.current);
      window.clearTimeout(poseTimer.current);
      bubbleTimer.current = window.setTimeout(() => setBubble(null), 6500);
      poseTimer.current = window.setTimeout(() => setPose(motionRef.current.wander && !COMPOSITOR_DRAG ? "walk" : "idle"), 1500);
    };
    const removeMessage = pet.onMessage(showCompletion);
    const removeMotion = pet.onMotionChange(setMotion);
    const removeActivity = pet.onActivityChange(setActivity);
    const removeEntrance = pet.onEntrance(setEntering);
    const cancelDrag = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setDraggingState(false);
      pet.endDrag();
    };
    window.addEventListener("blur", cancelDrag);
    return () => {
      removeMessage();
      removeMotion();
      removeActivity();
      removeEntrance();
      window.removeEventListener("blur", cancelDrag);
      cancelDrag();
      window.clearTimeout(bubbleTimer.current);
      window.clearTimeout(poseTimer.current);
      delete document.documentElement.dataset.petWindow;
      delete document.body.dataset.petWindow;
    };
  }, [companionName]);

  const activePose = pose === "success" || pose === "error" || pose === "needs-attention" ? pose : COMPOSITOR_DRAG ? "idle" : activity.state;
  const motionAnimationId = activePose === "walk" ? (activity.facing === -1 ? "running-left" : "running-right") : ({ idle: "idle", thinking: "review", coding: "running", coding_malicious: "malicious", stuck: "waiting", success: "jumping", error: "failed", "needs-attention": "failed", angry: "idle", pounce: "pounce", "fire-breath": "fire-breath", celebrate: "jumping", "curious-scan": "review", "ember-curl": "idle", "star-orbit": "idle", "rock-roll": "running", "sprout-stretch": "idle" } as Record<PetPose, string>)[activePose];
  const motionClip = motionManifest ? motionAnimationClip(motionManifest, motionAnimationId) : null;
  const animationId = animationByPose[activePose];
  const customStrip = customProfile?.strips[animationId];
  const builtinPose = BUILTIN_POSE_BY_ACTIVITY[activePose];
  // A custom companion may omit a state, but it must never borrow another
  // companion's artwork. Reuse that profile's idle strip instead and keep its
  // identity stable while the missing state is being displayed.
  const resolvedCustomStrip = customStrip ?? customProfile?.strips.idle;
  const animationPaused = motion.reduceMotion;
  const usesBlazeAttackAtlas = character === "blaze" && activePose === "fire-breath" && !resolvedCustomStrip && !motionClip;
  const sheet = usesBlazeAttackAtlas ? BLAZE_FIRE_BREATH_BODY_V2 : resolvedCustomStrip?.dataUrl ?? (BUILTIN_STRIPS[character] ?? BUILTIN_STRIPS.percy)[builtinPose];
  // Fit custom frames inside the companion canvas. A wide uploaded sprite should
  // never expand the always-on-top window across the desktop.
  const sourceFrameWidth = motionManifest?.geometry.width ?? (usesBlazeAttackAtlas ? 1246 / 4 : resolvedCustomStrip?.frameWidth ?? 256);
  const sourceFrameHeight = motionManifest?.geometry.height ?? (usesBlazeAttackAtlas ? 1263 / 4 : resolvedCustomStrip?.frameHeight ?? 256);
  const frameScale = Math.min(128 / sourceFrameWidth, 128 / sourceFrameHeight);
  const frameWidth = sourceFrameWidth * frameScale;
  const frameHeight = sourceFrameHeight * frameScale;
  const frameCount = usesBlazeAttackAtlas ? 16 : resolvedCustomStrip ? petStripFrameCount(resolvedCustomStrip) : 11;
  const spriteColumns = usesBlazeAttackAtlas ? 4 : frameCount;
  const spriteRows = usesBlazeAttackAtlas ? 4 : 1;
  const spriteFps = usesBlazeAttackAtlas ? 18 : resolvedCustomStrip?.fps ?? (activePose === "walk" ? 16 : 13);
  const spriteLoops = usesBlazeAttackAtlas ? false : resolvedCustomStrip?.loop ?? !["success", "error", "needs-attention", "pounce", "celebrate"].includes(activePose);
  const spriteStyle = { width: `${frameWidth}px`, height: `${frameHeight}px`, "--pet-facing": activity.facing } as CSSProperties;
  const spritePlaybackKey = `${activePose}:${activePose === pose ? poseGeneration : activity.generation ?? 0}`;
  const stillPose = !["walk", "success", "error", "needs-attention", "angry", "pounce", "fire-breath", "celebrate", "curious-scan", "ember-curl", "star-orbit", "rock-roll", "sprout-stretch"].includes(activePose);
  const blinkSheet = motionManifest ? undefined : customProfile?.blink?.dataUrl ?? BUILTIN_BLINK_STRIPS[character];
  const blinkStrip = customProfile?.blink;
  const genericBlinkFallback = Boolean(customProfile && !blinkStrip);
  const blinkFrameCount = blinkStrip?.frameCount ?? (blinkSheet ? 11 : 0);
  const blinkStyle = blinkSheet ? { backgroundImage: `url(${blinkSheet})`, backgroundSize: `${frameWidth * blinkFrameCount}px ${frameHeight}px`, width: `${frameWidth}px`, height: `${frameHeight}px`, "--pet-blink-end": `${-frameWidth * (blinkFrameCount - 1)}px`, "--pet-blink-steps": blinkFrameCount - 1, "--pet-blink-duration": `${blinkDuration}ms` } as CSSProperties : undefined;
  const target = activity.target ?? { x: activity.facing === -1 ? 8 : 212, y: 104 };
  const fightScene = !COMPOSITOR_DRAG && (activePose === "pounce" || activePose === "fire-breath");
  const sceneWidth = fightScene ? 460 : 220;
  const mouthX = sceneWidth / 2 + (activity.facing === -1 ? -34 : 34);
  const breathDx = target.x - mouthX;
  const breathDy = target.y - 105;
  const breathLength = Math.max(24, Math.hypot(breathDx, breathDy));
  const breathAngle = Math.atan2(breathDy, breathDx) * 180 / Math.PI;
  const fireWidth = Math.max(145, Math.min(270, breathLength + 24));
  const fireHeight = 158;
  const fireSpriteStyle = { width: `${fireWidth}px`, height: `${fireHeight}px`, left: `${mouthX}px`, top: `${105 - fireHeight / 2}px`, transform: `rotate(${breathAngle}deg)` } as CSSProperties;
  const impactSize = 150;
  const impactSpriteStyle = { width: `${impactSize}px`, height: `${impactSize}px`, left: `${target.x - impactSize / 2}px`, top: `${target.y - impactSize / 2}px` } as CSSProperties;
  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    dragging.current = true;
    setDraggingState(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.skaiAgent?.pet?.beginDrag({ x: event.screenX, y: event.screenY });
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    window.skaiAgent?.pet?.moveDrag({ x: event.screenX, y: event.screenY });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setDraggingState(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.skaiAgent?.pet?.endDrag();
  };
  const dragHandlers = COMPOSITOR_DRAG ? {} : { onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag };
  useEffect(() => {
    if (!stillPose || animationPaused || COMPOSITOR_DRAG || draggingState || !pageVisible || (!blinkSheet && !genericBlinkFallback)) {
      setBlinking(false);
      return undefined;
    }
    let cancelled = false;
    let startTimer: number | undefined;
    let endTimer: number | undefined;
    const characterSeed = [...companionName].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 1800;
    const playBlink = () => {
      if (cancelled) return;
      setBlinking(true);
      endTimer = window.setTimeout(() => {
        setBlinking(false);
        if (cancelled) return;
        startTimer = window.setTimeout(schedule, Math.random() < .12 ? 105 : 0);
      }, blinkDuration);
    };
    const schedule = () => {
      startTimer = window.setTimeout(() => {
        if (cancelled) return;
        playBlink();
      }, (genericBlinkFallback ? 8000 : 6000) + characterSeed + Math.random() * (genericBlinkFallback ? 4200 : 3000));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
      setBlinking(false);
    };
  }, [activePose, animationPaused, blinkDuration, blinkSheet, companionName, draggingState, genericBlinkFallback, pageVisible, stillPose]);
  return <main className={`pet-window-root${COMPOSITOR_DRAG ? " is-compositor-drag" : ""}${fightScene ? " is-fight-scene" : ""}${animationPaused ? " is-paused" : ""}${entering && !animationPaused ? " is-entering" : ""}${stillPose ? " is-still" : ""}`} style={{ width: `${sceneWidth}px` }} aria-label={`${companionName} desktop companion. Drag to move.`} data-pose={activePose} data-character={character}>
    {bubble && <div className={`pet-window-bubble pet-window-bubble-${bubbleKind}`} role="status" aria-live="polite">{bubble}</div>}
    {activePose === "angry" && <span className={`pet-window-anger${activity.facing === -1 ? " is-facing-left" : ""}`} aria-hidden="true"><i /><i /><i /></span>}
    {activePose === "pounce" && <span className={`pet-window-pounce-trail${activity.facing === -1 ? " is-facing-left" : ""}`} aria-hidden="true"><i /><i /><i /></span>}
    {activePose === "fire-breath" && <div className="pet-window-fire-scene" aria-hidden="true"><PetSpriteCanvas clip={{ imageUrl: BLAZE_FIRE_BREATH, frameCount: 8, columns: 8, rows: 1, fps: 16, loop: true }} playbackKey={`fire:${activity.generation ?? 0}`} paused={animationPaused || !pageVisible} pixelWidth={256} pixelHeight={256} className="pet-window-fire-sprite" style={fireSpriteStyle} label="Blaze breathes fire" /><PetSpriteCanvas clip={{ imageUrl: BLAZE_FIRE_IMPACT, frameCount: 8, columns: 8, rows: 1, fps: 16, loop: false }} playbackKey={`impact:${activity.generation ?? 0}`} paused={animationPaused || !pageVisible} pixelWidth={256} pixelHeight={256} className="pet-window-fire-impact-sprite" style={impactSpriteStyle} label="Fire impact effect" /><span className="pet-window-target-lock" style={{ left: `${target.x}px`, top: `${target.y}px` }} /></div>}
    {activePose === "pounce" && <span className="pet-window-target-lock is-pounce-target" style={{ left: `${target.x}px`, top: `${target.y}px` }} aria-hidden="true" />}
    {activePose === "curious-scan" && <span className="pet-window-scanner" aria-hidden="true"><i /></span>}
    {activePose === "star-orbit" && <span className="pet-window-star-orbit" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i></span>}
    {activePose === "sprout-stretch" && <span className="pet-window-leaf-spark" aria-hidden="true">✿</span>}
    {activePose === "celebrate" && character === "percy" && <span className="pet-window-celebration" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i></span>}
    {stillPose && <span className={`pet-window-idle-life${activity.facing === -1 ? " is-facing-left" : ""}`} aria-hidden="true" />}
    <div className="pet-window-art" style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}>
      {motionClip ? <PetMotionCanvas clip={motionClip} playbackKey={spritePlaybackKey} paused={animationPaused || !pageVisible} pixelWidth={sourceFrameWidth} pixelHeight={sourceFrameHeight} className={`pet-window-sprite pet-window-motion-sprite-${activePose}${animationPaused ? " is-paused" : ""}${activity.facing === -1 ? " is-facing-left" : ""}`} style={spriteStyle} label={`Animated ${companionName} companion`} {...dragHandlers} /> : <PetSpriteCanvas clip={{ imageUrl: sheet, frameCount, columns: spriteColumns, rows: spriteRows, fps: spriteFps, loop: spriteLoops }} playbackKey={spritePlaybackKey} paused={animationPaused || !pageVisible} pixelWidth={sourceFrameWidth} pixelHeight={sourceFrameHeight} className={`pet-window-sprite pet-window-sprite-${activePose}${animationPaused ? " is-paused" : ""}${blinking ? " is-under-blink" : ""}${activity.facing === -1 ? " is-facing-left" : ""}`} style={spriteStyle} label={`Animated ${companionName} companion`} onAnimationEnd={(event) => { if (event.animationName.startsWith("pet-window-enter-")) setEntering(false); }} {...dragHandlers} />}
      {blinking && blinkStyle && <div className={`pet-window-blink-sprite${activity.facing === -1 ? " is-facing-left" : ""}`} style={blinkStyle} aria-hidden="true" />}
    </div>
    {blinking && genericBlinkFallback && <div className={`pet-window-generic-blink${activity.facing === -1 ? " is-facing-left" : ""}`} style={{ "--pet-blink-duration": `${blinkDuration}ms` } as CSSProperties} aria-hidden="true" />}
  </main>;
}
