import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PetActivity, PetCompletionEvent, PetMotionSettings } from "../../../shared/contracts";
import { NavIcon } from "../ui/NavIcon";

type PetPose = "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "success" | "error";
const BUILTIN_STRIPS: Record<string, Record<PetPose, string>> = {
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

export function PetWindow() {
  const [pose, setPose] = useState<PetPose>("walk");
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubbleKind, setBubbleKind] = useState<PetCompletionEvent["kind"]>("success");
  const [motion, setMotion] = useState<PetMotionSettings>({ wander: true, reduceMotion: false });
  const [activity, setActivity] = useState<PetActivity>({ state: "idle", facing: 1 });
  const [character, setCharacter] = useState(() => localStorage.getItem("skai.pet.character") ?? "percy");
  const [customSprite, setCustomSprite] = useState(() => localStorage.getItem("skai.pet.sprite") ?? "");
  const dragging = useRef(false);
  const motionRef = useRef(motion);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const poseTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    document.title = "Percy · Skai companion";
    document.documentElement.dataset.petWindow = "true";
    document.body.dataset.petWindow = "true";
    if (OPAQUE_SURFACE) document.documentElement.dataset.petSurface = "opaque";
    const syncSettings = () => { setCharacter(localStorage.getItem("skai.pet.character") ?? "percy"); setCustomSprite(localStorage.getItem("skai.pet.sprite") ?? ""); };
    window.addEventListener("storage", syncSettings);
    const pet = window.serverRockAgent?.pet;
    if (!pet) return () => { window.removeEventListener("storage", syncSettings); delete document.documentElement.dataset.petWindow; delete document.body.dataset.petWindow; };
    const showCompletion = (event: PetCompletionEvent) => {
      setBubble(event.text);
      setBubbleKind(event.kind);
      setPose(event.kind);
      window.clearTimeout(bubbleTimer.current);
      window.clearTimeout(poseTimer.current);
      bubbleTimer.current = window.setTimeout(() => setBubble(null), 6500);
      poseTimer.current = window.setTimeout(() => setPose(motionRef.current.wander && !COMPOSITOR_DRAG ? "walk" : "idle"), 1500);
    };
    const removeMessage = pet.onMessage(showCompletion);
    const removeMotion = pet.onMotionChange(setMotion);
    const removeActivity = pet.onActivityChange(setActivity);
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
      window.removeEventListener("blur", cancelDrag);
      cancelDrag();
      window.clearTimeout(bubbleTimer.current);
      window.clearTimeout(poseTimer.current);
      delete document.documentElement.dataset.petWindow;
      delete document.body.dataset.petWindow;
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  const activePose = pose === "success" || pose === "error" ? pose : COMPOSITOR_DRAG ? "idle" : activity.state;
  const sheet = customSprite || (BUILTIN_STRIPS[character] ?? BUILTIN_STRIPS.percy)[activePose];
  const animationPaused = motion.reduceMotion;
  const spriteStyle = { backgroundImage: `url(${sheet})` } as CSSProperties;
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
  return <main className={`pet-window-root${COMPOSITOR_DRAG ? " is-compositor-drag" : ""}`} aria-label="Percy desktop companion. Drag to move." data-pose={activePose} {...dragHandlers}>
    {bubble && <div className={`pet-window-bubble pet-window-bubble-${bubbleKind}`} role="status" aria-live="polite">{bubble}</div>}
    <button className="pet-window-hide" type="button" onClick={() => window.serverRockAgent?.pet?.hide()} aria-label="Hide Percy companion"><NavIcon name="close" /></button>
    <div className={`pet-window-sprite pet-window-sprite-${activePose}${animationPaused ? " is-paused" : ""}${activity.facing === -1 ? " is-facing-left" : ""}`} style={spriteStyle} role="img" aria-label={`Animated ${character} companion`} />
  </main>;
}
