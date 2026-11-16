import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PetActivity, PetBehaviorSettings, PetCompletionEvent, PetMotionSettings } from "../../../shared/contracts";
import { defaultPetBehavior, getPetSpriteProfile, petStripFrameCount, type PetAnimationId, type PetSpriteProfile } from "../../features/settings/petSprites";

type PetPose = "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "success" | "error" | "needs-attention" | "angry" | "pounce" | "fire-breath";
type BuiltinPose = Exclude<PetPose, "needs-attention" | "angry" | "pounce" | "fire-breath">;
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

// Native Wayland: the app cannot move its own windows, so the compositor drags
// Percy (CSS app-region) and Percy stays put instead of walking in place.
const COMPOSITOR_DRAG = new URLSearchParams(window.location.search).get("drag") === "compositor";
// X11 without a compositor cannot show transparency; draw Percy on a solid card instead of a black box.
const OPAQUE_SURFACE = new URLSearchParams(window.location.search).get("surface") === "opaque";
const animationByPose: Record<PetPose, PetAnimationId> = {
  idle: "idle", walk: "walking", thinking: "thinking", coding: "working", coding_malicious: "malicious-coding",
  stuck: "stuck", success: "success", error: "fail", "needs-attention": "needs-attention", angry: "angry", pounce: "pounce", "fire-breath": "fire-breath",
};
const BUILTIN_NAMES: Record<string, string> = { percy: "Percy", byte: "Byte", ember: "Ember", nova: "Nova", rocky: "Rocky", sprout: "Sprout" };

function readPetCharacter() {
  const saved = localStorage.getItem("skai.pet.character");
  if (saved && (["percy", "byte", "ember", "nova", "rocky", "sprout"].includes(saved) || saved.startsWith("custom:"))) return saved;
  localStorage.setItem("skai.pet.character", "percy");
  return "percy";
}

export function PetWindow() {
  const [pose, setPose] = useState<PetPose>("walk");
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubbleKind, setBubbleKind] = useState<PetCompletionEvent["kind"]>("success");
  const [motion, setMotion] = useState<PetMotionSettings>({ wander: true, reduceMotion: false, interactionDemo: false });
  const [activity, setActivity] = useState<PetActivity>({ state: "idle", facing: 1 });
  const [entering, setEntering] = useState(false);
  const [character, setCharacter] = useState(readPetCharacter);
  const [customProfile, setCustomProfile] = useState<PetSpriteProfile | null>(null);
  const dragging = useRef(false);
  const motionRef = useRef(motion);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const poseTimer = useRef<number | undefined>(undefined);
  const companionName = customProfile?.name ?? BUILTIN_NAMES[character] ?? "Companion";

  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    let active = true;
    const syncProfile = async (nextCharacter = readPetCharacter()) => {
      setCharacter(nextCharacter);
      if (!nextCharacter.startsWith("custom:")) {
        setCustomProfile(null);
        window.serverRockAgent?.pet?.setBehaviorSettings(defaultPetBehavior(BUILTIN_NAMES[nextCharacter] ?? "", false));
        return;
      }
      try {
        const profile = await getPetSpriteProfile(nextCharacter.slice("custom:".length));
        if (active) {
          setCustomProfile(profile);
          const behavior: PetBehaviorSettings = profile?.behavior ?? defaultPetBehavior(profile?.name ?? "", false);
          window.serverRockAgent?.pet?.setBehaviorSettings(behavior);
        }
      } catch {
        if (active) setCustomProfile(null);
        window.serverRockAgent?.pet?.setBehaviorSettings(defaultPetBehavior("", false));
      }
    };
    void syncProfile();
    const syncSettings = () => { void syncProfile(); };
    window.addEventListener("storage", syncSettings);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("skai-companion-profiles");
    if (channel) channel.onmessage = () => { void syncProfile(); };
    return () => { active = false; window.removeEventListener("storage", syncSettings); channel?.close(); };
  }, []);

  useEffect(() => {
    document.title = `${companionName} · Skai companion`;
    document.documentElement.dataset.petWindow = "true";
    document.body.dataset.petWindow = "true";
    if (OPAQUE_SURFACE) document.documentElement.dataset.petSurface = "opaque";
    const pet = window.serverRockAgent?.pet;
    if (!pet) return () => { delete document.documentElement.dataset.petWindow; delete document.body.dataset.petWindow; };
    const showCompletion = (event: PetCompletionEvent) => {
      setBubble(event.text);
      setBubbleKind(event.kind);
      setPose(event.kind === "error" && /needs attention|requires approval|awaiting approval/i.test(event.text) ? "needs-attention" : event.kind);
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
  const animationId = animationByPose[activePose];
  const customStrip = customProfile?.strips[animationId];
  const builtinPose: BuiltinPose = activePose === "needs-attention" ? "error" : activePose === "angry" || activePose === "pounce" || activePose === "fire-breath" ? "idle" : activePose;
  // A custom companion may omit a state, but it must never borrow another
  // companion's artwork. Reuse that profile's idle strip instead and keep its
  // identity stable while the missing state is being displayed.
  const resolvedCustomStrip = customStrip ?? customProfile?.strips.idle;
  const sheet = resolvedCustomStrip?.dataUrl ?? (BUILTIN_STRIPS[character] ?? BUILTIN_STRIPS.percy)[builtinPose];
  const animationPaused = motion.reduceMotion;
  // Fit custom frames inside the companion canvas. A wide uploaded sprite should
  // never expand the always-on-top window across the desktop.
  const frameScale = resolvedCustomStrip ? Math.min(128 / resolvedCustomStrip.frameWidth, 128 / resolvedCustomStrip.frameHeight) : 1;
  const frameWidth = resolvedCustomStrip ? resolvedCustomStrip.frameWidth * frameScale : 128;
  const frameHeight = resolvedCustomStrip ? resolvedCustomStrip.frameHeight * frameScale : 128;
  const frameCount = resolvedCustomStrip ? petStripFrameCount(resolvedCustomStrip) : 10;
  const spriteStyle = { backgroundImage: `url(${sheet})`, backgroundSize: `${frameWidth * frameCount}px ${frameHeight}px`, width: `${frameWidth}px`, height: `${frameHeight}px`, "--pet-strip-end": `${-frameWidth * (frameCount - 1)}px`, "--pet-frame-steps": frameCount - 1, "--pet-facing": activity.facing } as CSSProperties;
  const target = activity.target ?? { x: activity.facing === -1 ? 8 : 212, y: 104 };
  const mouthX = activity.facing === -1 ? 76 : 144;
  const firePath = `M ${mouthX} 105 Q ${(mouthX + target.x) / 2} ${(105 + target.y) / 2 - 18} ${target.x} ${target.y}`;
  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.serverRockAgent?.pet?.beginDrag({ x: event.screenX, y: event.screenY });
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    window.serverRockAgent?.pet?.moveDrag({ x: event.screenX, y: event.screenY });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.serverRockAgent?.pet?.endDrag();
  };
  const dragHandlers = COMPOSITOR_DRAG ? {} : { onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag };
  return <main className={`pet-window-root${COMPOSITOR_DRAG ? " is-compositor-drag" : ""}${animationPaused ? " is-paused" : ""}${entering && !animationPaused ? " is-entering" : ""}`} aria-label={`${companionName} desktop companion. Drag to move.`} data-pose={activePose}>
    {bubble && <div className={`pet-window-bubble pet-window-bubble-${bubbleKind}`} role="status" aria-live="polite">{bubble}</div>}
    {activePose === "angry" && <span className={`pet-window-anger${activity.facing === -1 ? " is-facing-left" : ""}`} aria-hidden="true">✦</span>}
    {activePose === "fire-breath" && <svg className="pet-window-fire" viewBox="0 0 220 190" aria-hidden="true"><path className="pet-window-fire-glow" d={firePath} /><path className="pet-window-fire-core" d={firePath} /><circle className="pet-window-fire-impact" cx={target.x} cy={target.y} r="7" /></svg>}
    <div className={`pet-window-sprite pet-window-sprite-${activePose}${animationPaused ? " is-paused" : ""}${activity.facing === -1 ? " is-facing-left" : ""}`} style={spriteStyle} onAnimationEnd={(event) => { if (event.animationName.startsWith("pet-window-enter-")) setEntering(false); }} role="img" aria-label={`Animated ${companionName} companion`} {...dragHandlers} />
  </main>;
}
