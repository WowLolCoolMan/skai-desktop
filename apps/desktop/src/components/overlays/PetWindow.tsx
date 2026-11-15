import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { PetActivity, PetCompletionEvent, PetMotionSettings } from "../../../shared/contracts";
import { NavIcon } from "../ui/NavIcon";
import { getPetSpriteProfile, type PetAnimationId, type PetSpriteProfile } from "../../features/settings/petSprites";

type PetPose = "idle" | "walk" | "thinking" | "coding" | "coding_malicious" | "stuck" | "success" | "error" | "needs-attention";
type BuiltinPose = Exclude<PetPose, "needs-attention">;
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
    walk: new URL("../../../../../assets/pets/generated/byte-walk-frames-v2.png", import.meta.url).href,
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
    walk: new URL("../../../../../assets/pets/generated/nova-walk-frames-v2.png", import.meta.url).href,
    thinking: new URL("../../../../../assets/pets/generated/nova-thinking-frames.png", import.meta.url).href,
    coding: new URL("../../../../../assets/pets/generated/nova-coding-frames.png", import.meta.url).href,
    coding_malicious: new URL("../../../../../assets/pets/generated/nova-coding_malicious-frames.png", import.meta.url).href,
    stuck: new URL("../../../../../assets/pets/generated/nova-stuck-frames.png", import.meta.url).href,
    success: new URL("../../../../../assets/pets/generated/nova-success-frames.png", import.meta.url).href,
    error: new URL("../../../../../assets/pets/generated/nova-error-frames.png", import.meta.url).href,
  },
  rocky: {
    idle: new URL("../../../../../assets/pets/generated/rocky-idle-frames.png", import.meta.url).href,
    walk: new URL("../../../../../assets/pets/generated/rocky-walk-frames-v2.png", import.meta.url).href,
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
  stuck: "stuck", success: "success", error: "fail", "needs-attention": "needs-attention",
};
const BUILTIN_NAMES: Record<string, string> = { percy: "Percy", byte: "Byte", ember: "Ember", nova: "Nova", rocky: "Rocky", sprout: "Sprout", "skai-rig": "Skai" };

type PetDragHandlers = Partial<Record<"onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel", (event: PointerEvent<any>) => void>>;

type RigPoint = { x: number; y: number };
type RigPose = Record<string, RigPoint>;

const RIG_BASE: RigPose = {
  root: { x: 110, y: 116 }, neck: { x: 110, y: 72 }, head: { x: 110, y: 45 },
  shoulderL: { x: 98, y: 77 }, elbowL: { x: 78, y: 98 }, handL: { x: 78, y: 119 },
  shoulderR: { x: 122, y: 77 }, elbowR: { x: 142, y: 98 }, handR: { x: 142, y: 119 },
  hipL: { x: 101, y: 116 }, kneeL: { x: 86, y: 145 }, footL: { x: 82, y: 173 },
  hipR: { x: 119, y: 116 }, kneeR: { x: 134, y: 145 }, footR: { x: 138, y: 173 },
};

const RIG_POSES: Record<PetPose, Partial<RigPose>> = {
  idle: {},
  walk: { elbowL: { x: 69, y: 94 }, handL: { x: 63, y: 112 }, elbowR: { x: 151, y: 102 }, handR: { x: 159, y: 121 }, kneeL: { x: 97, y: 148 }, footL: { x: 111, y: 173 }, kneeR: { x: 122, y: 141 }, footR: { x: 111, y: 173 } },
  thinking: { head: { x: 106, y: 43 }, elbowL: { x: 79, y: 93 }, handL: { x: 94, y: 68 }, elbowR: { x: 139, y: 94 }, handR: { x: 128, y: 67 } },
  coding: { root: { x: 110, y: 121 }, neck: { x: 110, y: 77 }, head: { x: 110, y: 50 }, elbowL: { x: 82, y: 104 }, handL: { x: 94, y: 122 }, elbowR: { x: 138, y: 104 }, handR: { x: 126, y: 122 }, kneeL: { x: 94, y: 151 }, footL: { x: 84, y: 170 }, kneeR: { x: 126, y: 151 }, footR: { x: 136, y: 170 } },
  success: { elbowL: { x: 75, y: 55 }, handL: { x: 61, y: 34 }, elbowR: { x: 145, y: 55 }, handR: { x: 159, y: 34 }, kneeL: { x: 92, y: 143 }, footL: { x: 76, y: 166 }, kneeR: { x: 128, y: 143 }, footR: { x: 144, y: 166 } },
  error: { head: { x: 114, y: 48 }, elbowL: { x: 83, y: 105 }, handL: { x: 75, y: 122 }, elbowR: { x: 137, y: 105 }, handR: { x: 145, y: 122 } },
  stuck: { head: { x: 114, y: 48 }, elbowL: { x: 83, y: 105 }, handL: { x: 75, y: 122 }, elbowR: { x: 137, y: 105 }, handR: { x: 145, y: 122 } },
  coding_malicious: {},
  "needs-attention": {},
};

const RIG_SEGMENTS: Array<[string, string]> = [["head", "neck"], ["neck", "shoulderL"], ["neck", "shoulderR"], ["neck", "root"], ["root", "hipL"], ["root", "hipR"]];
const RIG_CURVES: Array<[string, string, string]> = [["shoulderL", "elbowL", "handL"], ["shoulderR", "elbowR", "handR"], ["hipL", "kneeL", "footL"], ["hipR", "kneeR", "footR"]];

function solveTwoBoneIK(hip: RigPoint, foot: RigPoint, preferredKnee: RigPoint): RigPoint {
  const upper = Math.hypot(RIG_BASE.kneeL.x - RIG_BASE.hipL.x, RIG_BASE.kneeL.y - RIG_BASE.hipL.y);
  const lower = Math.hypot(RIG_BASE.footL.x - RIG_BASE.kneeL.x, RIG_BASE.footL.y - RIG_BASE.kneeL.y);
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const distance = Math.max(1, Math.min(upper + lower - 0.5, Math.hypot(dx, dy)));
  const angle = Math.atan2(dy, dx);
  const bend = Math.acos(Math.max(-1, Math.min(1, (upper * upper + distance * distance - lower * lower) / (2 * upper * distance))));
  const sign = ((preferredKnee.x - hip.x) * dy - (preferredKnee.y - hip.y) * dx) >= 0 ? 1 : -1;
  return { x: hip.x + Math.cos(angle - sign * bend) * upper, y: hip.y + Math.sin(angle - sign * bend) * upper };
}

function sampleRigPose(pose: PetPose, phase: number): RigPose {
  const target: RigPose = { ...RIG_BASE };
  Object.assign(target, RIG_POSES[pose]);
  if (pose === "walk") {
    const swing = Math.sin(phase * Math.PI * 2) * 5;
    target.root = { x: 110, y: 116 + Math.abs(swing) * 0.18 };
    target.head = { x: 110, y: 45 + Math.abs(swing) * 0.08 };
    target.handL = { x: target.handL.x, y: target.handL.y + swing };
    target.handR = { x: target.handR.x, y: target.handR.y - swing };
    target.footL = { x: target.footL.x, y: target.footL.y - Math.max(0, swing) * 0.3 };
    target.footR = { x: target.footR.x, y: target.footR.y - Math.max(0, -swing) * 0.3 };
  }
  target.kneeL = solveTwoBoneIK(target.hipL, target.footL, target.kneeL);
  target.kneeR = solveTwoBoneIK(target.hipR, target.footR, target.kneeR);
  return target;
}

function blendRigPose(from: RigPose, to: RigPose, amount: number): RigPose {
  const t = amount * amount * (3 - 2 * amount);
  return Object.fromEntries(Object.keys(RIG_BASE).map((key) => [key, {
    x: from[key].x + (to[key].x - from[key].x) * t,
    y: from[key].y + (to[key].y - from[key].y) * t,
  }])) as RigPose;
}

function StickRigPet({ pose, facing, dragHandlers }: { pose: PetPose; facing: number; dragHandlers: PetDragHandlers }) {
  const [clock, setClock] = useState(() => performance.now());
  const previousPose = useRef(pose);
  const activePose = useRef(pose);
  const transitionStart = useRef(performance.now());
  useEffect(() => {
    if (activePose.current === pose) return;
    previousPose.current = activePose.current;
    activePose.current = pose;
    transitionStart.current = performance.now();
  }, [pose]);
  useEffect(() => {
    let frame = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      if (now - lastPaint >= 33) {
        lastPaint = now;
        setClock(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const phase = (clock / (pose === "walk" ? 560 : 1300)) % 1;
  const points = blendRigPose(sampleRigPose(previousPose.current, phase), sampleRigPose(activePose.current, phase), Math.min(1, (clock - transitionStart.current) / 260));
  const working = pose === "coding" || pose === "thinking";
  const success = pose === "success";
  const failure = pose === "error" || pose === "stuck" || pose === "needs-attention";
  const line = ({ x: x1, y: y1 }: RigPoint, { x: x2, y: y2 }: RigPoint) => <line x1={x1} y1={y1} x2={x2} y2={y2} />;
  const curve = (from: RigPoint, control: RigPoint, to: RigPoint) => <path d={`M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`} />;
  return <svg className={"pet-rig" + (facing === -1 ? " is-facing-left" : "")} viewBox="0 0 220 190" role="img" aria-label="Animated original Skai stick companion" {...dragHandlers}>
    <ellipse className="rig-shadow" cx="110" cy="177" rx="39" ry="4" />
    <g className="rig-segments">{RIG_SEGMENTS.map(([from, to]) => <g key={`${from}-${to}`}>{line(points[from], points[to])}</g>)}{RIG_CURVES.map(([from, control, to]) => <g key={`${from}-${to}`}>{curve(points[from], points[control], points[to])}</g>)}</g>
    <g className="rig-joints">{Object.entries(points).filter(([key]) => key !== "root" && !key.startsWith("shoulder") && !key.startsWith("hip")).map(([key, point]) => <circle key={key} cx={point.x} cy={point.y} r={key === "head" ? 21 : 2.5} className={key === "head" ? "rig-head" : "rig-joint"} />)}</g>
    {working && <g className="rig-laptop"><rect x="84" y="119" width="52" height="30" rx="3" /><path d="M79 149h62l-6 5H85z" /><path className="rig-screen" d="M91 126h38v17H91z" /></g>}
    <g className="rig-face">{failure ? <><circle cx="103" cy="43" r="2.4" /><circle cx="117" cy="43" r="2.4" /><path d="M102 54q8-6 16 0" /></> : success ? <><path d="M101 43l4 3M115 46l4-3M102 53q8 8 16 0" /></> : <><circle cx="103" cy="43" r="2.4" /><circle cx="117" cy="43" r="2.4" /><path d={working ? "M103 53h14" : "M103 52q7 5 14 0"} /></>}</g>
    {success && <g className="rig-confetti"><path d="M58 40l-8-9M162 40l8-9M53 76l-12-2M167 76l12-2" /></g>}
    {pose === "coding" && <g className="rig-beam"><path d="M142 119l27-17M142 119l31 5" /><circle cx="169" cy="102" r="3" /><circle cx="173" cy="124" r="3" /></g>}
  </svg>;
}

export function PetWindow() {
  const [pose, setPose] = useState<PetPose>("walk");
  const [bubble, setBubble] = useState<string | null>(null);
  const [bubbleKind, setBubbleKind] = useState<PetCompletionEvent["kind"]>("success");
  const [motion, setMotion] = useState<PetMotionSettings>({ wander: true, reduceMotion: false });
  const [activity, setActivity] = useState<PetActivity>({ state: "idle", facing: 1 });
  const [demoPose, setDemoPose] = useState<PetPose>("walk");
  const [character, setCharacter] = useState(() => localStorage.getItem("skai.pet.character") ?? "percy");
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
    if (new URLSearchParams(window.location.search).get("rig") !== "1") return;
    const demoPoses: PetPose[] = ["walk", "thinking", "coding", "success", "error"];
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % demoPoses.length;
      setDemoPose(demoPoses[index]);
    }, 2200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const syncProfile = async (nextCharacter = localStorage.getItem("skai.pet.character") ?? "percy") => {
      setCharacter(nextCharacter);
      if (!nextCharacter.startsWith("custom:")) { setCustomProfile(null); return; }
      try {
        const profile = await getPetSpriteProfile(nextCharacter.slice("custom:".length));
        if (active) setCustomProfile(profile);
      } catch { if (active) setCustomProfile(null); }
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
    };
  }, [companionName]);

  const rigDemo = new URLSearchParams(window.location.search).get("rig") === "1";
  const activePose = rigDemo ? demoPose : pose === "success" || pose === "error" || pose === "needs-attention" ? pose : COMPOSITOR_DRAG ? "idle" : activity.state;
  const animationId = animationByPose[activePose];
  const customStrip = customProfile?.strips[animationId];
  const builtinPose: BuiltinPose = activePose === "needs-attention" ? "error" : activePose;
  const sheet = customStrip?.dataUrl ?? (BUILTIN_STRIPS[character] ?? BUILTIN_STRIPS.percy)[builtinPose];
  const animationPaused = motion.reduceMotion;
  const isRig = character === "skai-rig" || new URLSearchParams(window.location.search).get("rig") === "1";
  // Fit custom frames inside the companion canvas. A wide uploaded sprite should
  // never expand the always-on-top window across the desktop.
  const frameScale = customStrip ? Math.min(128 / customStrip.frameWidth, 128 / customStrip.frameHeight) : 1;
  const frameWidth = customStrip ? customStrip.frameWidth * frameScale : 128;
  const frameHeight = customStrip ? customStrip.frameHeight * frameScale : 128;
  const spriteStyle = { backgroundImage: `url(${sheet})`, backgroundSize: `${frameWidth * 6}px ${frameHeight}px`, width: `${frameWidth}px`, height: `${frameHeight}px`, "--pet-strip-end": `${-frameWidth * 5}px` } as CSSProperties;
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
  return <main className={`pet-window-root${COMPOSITOR_DRAG ? " is-compositor-drag" : ""}`} aria-label={`${companionName} desktop companion. Drag to move.`} data-pose={activePose}>
    {bubble && <div className={`pet-window-bubble pet-window-bubble-${bubbleKind}`} role="status" aria-live="polite">{bubble}</div>}
    {isRig && <StickRigPet pose={activePose} facing={activity.facing} dragHandlers={dragHandlers} />}
    <button className="pet-window-hide" type="button" title={`Hide ${companionName}`} onClick={() => window.serverRockAgent?.pet?.hide()} aria-label={`Hide ${companionName} companion`}><NavIcon name="close" /></button>
    <div className={`pet-window-sprite pet-window-sprite-${activePose}${animationPaused ? " is-paused" : ""}${activity.facing === -1 ? " is-facing-left" : ""}`} style={spriteStyle} role="img" aria-label={`Animated ${companionName} companion`} {...dragHandlers} />
  </main>;
}
