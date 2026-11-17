export const PET_ANIMATIONS = [
  { id: "idle", label: "Idle", pose: "idle" },
  { id: "walking", label: "Walking", pose: "walk" },
  { id: "blink", label: "Blink", pose: "idle" },
  { id: "thinking", label: "Thinking", pose: "thinking" },
  { id: "working", label: "Working", pose: "coding" },
  { id: "stuck", label: "Stuck", pose: "stuck" },
  { id: "fail", label: "Fail", pose: "error" },
  { id: "needs-attention", label: "Needs attention", pose: "error" },
  { id: "success", label: "Success", pose: "success" },
  { id: "malicious-coding", label: "Malicious coding", pose: "coding_malicious" },
  { id: "angry", label: "Angry", pose: "angry" },
  { id: "pounce", label: "Pounce / attack", pose: "pounce" },
  { id: "fire-breath", label: "Fire breath", pose: "fire-breath" },
] as const;

export const PET_FRAME_COUNT = 11;
export const PET_ACTIONS = [
  { id: "approach-cursor", label: "Approach the cursor", needsCursor: true },
  { id: "pounce", label: "Pounce / lunge", needsCursor: true },
  { id: "fire-breath", label: "Breathe fire", needsCursor: true },
  { id: "celebrate", label: "Celebrate", needsCursor: false },
  { id: "curious-scan", label: "Curious scan", needsCursor: false },
  { id: "ember-curl", label: "Curl up by the flame", needsCursor: false },
  { id: "star-orbit", label: "Make a star orbit", needsCursor: false },
  { id: "rock-roll", label: "Roll and settle", needsCursor: false },
  { id: "sprout-stretch", label: "Stretch and unfurl", needsCursor: false },
] as const;

export type PetAnimationId = typeof PET_ANIMATIONS[number]["id"];
export type PetActionId = PetAttackAction;
export type PetStrip = { dataUrl: string; frameWidth: number; frameHeight: number; frameCount?: number; fps?: number; loop?: boolean };
export const PET_BLINK_DURATION_DEFAULT_MS = 280;
export const PET_BLINK_DURATION_MIN_MS = 170;
export const PET_BLINK_DURATION_MAX_MS = 700;
const PET_BLINK_STORAGE_PREFIX = "skai.pet.blinkDuration.v1.";
const PET_BEHAVIOR_STORAGE_PREFIX = "skai.pet.behavior.v1.";
const BUILTIN_BEHAVIORS: Record<string, PetActionId[]> = {
  percy: ["celebrate"],
  byte: ["curious-scan"],
  ember: ["ember-curl"],
  blaze: ["approach-cursor", "pounce", "fire-breath"],
  nova: ["star-orbit"],
  rocky: ["rock-roll"],
  sprout: ["sprout-stretch"],
};

export function petPreferenceId(character: string): string {
  return character.replace(/^(?:custom:|builtin:)/, "");
}

export function readPetBlinkDuration(character: string): number {
  try {
    const saved = Number(localStorage.getItem(`${PET_BLINK_STORAGE_PREFIX}${petPreferenceId(character)}`));
    return Number.isFinite(saved) && saved > 0
      ? Math.round(Math.max(PET_BLINK_DURATION_MIN_MS, Math.min(PET_BLINK_DURATION_MAX_MS, saved)))
      : PET_BLINK_DURATION_DEFAULT_MS;
  } catch { return PET_BLINK_DURATION_DEFAULT_MS; }
}

export function savePetBlinkDuration(character: string, durationMs: number): number {
  const duration = Math.round(Math.max(PET_BLINK_DURATION_MIN_MS, Math.min(PET_BLINK_DURATION_MAX_MS, durationMs)));
  const petId = petPreferenceId(character);
  const key = `${PET_BLINK_STORAGE_PREFIX}${petId}`;
  localStorage.setItem(key, String(duration));
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: String(duration) }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("skai-companion-profiles");
    channel.postMessage({ type: "blink-duration-changed", petId, duration });
    channel.close();
  }
  return duration;
}

export function readPetBehavior(character: string, name: string): PetBehaviorSettings {
  try {
    const saved = localStorage.getItem(`${PET_BEHAVIOR_STORAGE_PREFIX}${petPreferenceId(character)}`);
    return normalizePetBehavior(saved ? JSON.parse(saved) : null, name);
  } catch { return defaultPetBehavior(name); }
}

export function savePetBehavior(character: string, settings: PetBehaviorSettings): void {
  const petId = petPreferenceId(character);
  const key = `${PET_BEHAVIOR_STORAGE_PREFIX}${petId}`;
  const value = JSON.stringify(settings);
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("skai-companion-profiles");
    channel.postMessage({ type: "behavior-settings-changed", petId });
    channel.close();
  }
}
export type PetSpriteProfile = {
  id: string;
  name: string;
  strips: Partial<Record<PetAnimationId, PetStrip>>;
  blink?: PetStrip;
  referenceImageDataUrl?: string;
  behavior?: PetBehaviorSettings;
};

export function petStripFrameCount(strip: PetStrip): number {
  // Old profiles did not persist a frame count; they contain six-cel strips.
  return strip.frameCount ?? 6;
}

export function defaultPetBehavior(name: string, enabled?: boolean): PetBehaviorSettings {
  const normalizedName = name.trim().toLocaleLowerCase();
  const actions = BUILTIN_BEHAVIORS[normalizedName] ?? [];
  return {
    enabled: enabled ?? actions.length > 0,
    triggerDuringIdle: true,
    triggerDuringWalk: true,
    minimumIntervalSeconds: 30,
    maximumIntervalSeconds: 60,
    actions,
    orderedActions: false,
  };
}

export function normalizePetBehavior(value: unknown, name = ""): PetBehaviorSettings {
  const fallback = defaultPetBehavior(name);
  const cursorAttacksAllowed = name.trim().toLocaleLowerCase() === "blaze";
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Partial<PetBehaviorSettings>;
  const allowed = new Set<string>(PET_ACTIONS.map((action) => action.id));
  const actions = Array.isArray(candidate.actions)
    ? [...new Set(candidate.actions.filter((action): action is PetActionId => typeof action === "string" && allowed.has(action) && (cursorAttacksAllowed || !PET_ACTIONS.find((item) => item.id === action)?.needsCursor)))]
    : fallback.actions;
  const legacyDefault = candidate.minimumIntervalSeconds === 60 && candidate.maximumIntervalSeconds === 180;
  const minimumIntervalSeconds = legacyDefault ? 30 : clampInterval(candidate.minimumIntervalSeconds, fallback.minimumIntervalSeconds);
  const maximumIntervalSeconds = Math.max(minimumIntervalSeconds, legacyDefault ? 60 : clampInterval(candidate.maximumIntervalSeconds, fallback.maximumIntervalSeconds));
  return {
    enabled: actions.length > 0 && (typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled),
    triggerDuringIdle: typeof candidate.triggerDuringIdle === "boolean" ? candidate.triggerDuringIdle : true,
    triggerDuringWalk: typeof candidate.triggerDuringWalk === "boolean" ? candidate.triggerDuringWalk : true,
    minimumIntervalSeconds,
    maximumIntervalSeconds,
    actions,
    orderedActions: candidate.orderedActions === true,
  };
}

function clampInterval(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(10, Math.min(480, parsed))) : fallback;
}

export function makePetAttackSequence(settings: PetBehaviorSettings, random = Math.random): PetActionId[] {
  const available = settings.actions.filter((action) => PET_ACTIONS.some((item) => item.id === action));
  if (available.length === 0) return [];
  if (settings.orderedActions) {
    const steps: PetActionId[] = available.filter((action) => action !== "approach-cursor");
    const firstCursorAttack = steps.findIndex((action) => action === "pounce" || action === "fire-breath");
    if (firstCursorAttack >= 0) steps.splice(firstCursorAttack, 0, "approach-cursor");
    return steps;
  }
  const attacks = available.filter((action) => action === "pounce" || action === "fire-breath");
  const selectedAttacks = attacks.filter(() => random() < 0.66);
  if (selectedAttacks.length === 0 && attacks.length > 0) selectedAttacks.push(attacks[Math.floor(random() * attacks.length)]);
  return [...(available.includes("approach-cursor") || selectedAttacks.length > 0 ? ["approach-cursor" as const] : []), ...selectedAttacks];
}

const databaseName = "skai-companion-profiles";
const profileStore = "profiles";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(profileStore, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Custom companion storage could not be opened."));
  });
}

export async function listPetSpriteProfiles(): Promise<PetSpriteProfile[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(profileStore, "readonly").objectStore(profileStore).getAll();
      request.onsuccess = () => resolve((request.result as PetSpriteProfile[]).sort((left, right) => left.name.localeCompare(right.name)));
      request.onerror = () => reject(request.error ?? new Error("Custom companion profiles could not be read."));
    });
  } finally { database.close(); }
}

export async function getPetSpriteProfile(id: string): Promise<PetSpriteProfile | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(profileStore, "readonly").objectStore(profileStore).get(id);
      request.onsuccess = () => resolve((request.result as PetSpriteProfile | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Custom companion could not be read."));
    });
  } finally { database.close(); }
}

export async function savePetSpriteProfile(profile: PetSpriteProfile): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(profileStore, "readwrite");
      transaction.objectStore(profileStore).put(profile);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Custom companion could not be saved."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Custom companion save was cancelled."));
    });
  } finally { database.close(); }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("skai-companion-profiles");
    channel.postMessage({ type: "profile-updated", id: profile.id });
    channel.close();
  }
}

export async function deletePetSpriteProfile(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(profileStore, "readwrite");
      transaction.objectStore(profileStore).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Custom companion could not be deleted."));
    });
  } finally { database.close(); }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("skai-companion-profiles");
    channel.postMessage({ type: "profile-updated", id });
    channel.close();
  }
}

export async function validatePetStrip(file: File, allowLegacySixFrames = false, legacyFrameWidth?: number, expectedFrameCount?: number, loop = true): Promise<PetStrip> {
  if (!(file.type === "image/png" || file.type === "image/webp")) throw new Error("Choose a PNG or WebP sprite strip.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Each sprite strip must be 5 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The sprite strip could not be read."));
    reader.onerror = () => reject(new Error("The sprite strip could not be read."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const decoded = new Image();
    decoded.onload = () => resolve(decoded);
    decoded.onerror = () => reject(new Error("This image could not be decoded."));
    decoded.src = dataUrl;
  });
  const legacyWidthCount = allowLegacySixFrames && Number.isFinite(legacyFrameWidth)
    ? [10, 6].find((count) => image.naturalWidth === Number(legacyFrameWidth) * count)
    : undefined;
  const inferredCount = Array.from({ length: 29 }, (_, index) => 32 - index)
    .filter((count) => image.naturalWidth % count === 0)
    .sort((left, right) => Math.abs(image.naturalWidth / left / image.naturalHeight - 1) - Math.abs(image.naturalWidth / right / image.naturalHeight - 1))[0] ?? 0;
  const frameCount = legacyWidthCount ?? expectedFrameCount ?? inferredCount;
  if (!frameCount || image.naturalWidth < frameCount || image.naturalHeight < 1)
    throw new Error(expectedFrameCount === 4 ? "The blink strip must have 4 equal-width frames in one horizontal row." : "The sprite strip must have 4–32 equal-width frames in one horizontal row.");
  const frameWidth = image.naturalWidth / frameCount;
  if (frameWidth > 2048 || image.naturalHeight > 2048)
    throw new Error("Each frame must be 2048 pixels or smaller in either direction.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Skai could not inspect this sprite strip.");
  context.drawImage(image, 0, 0);
  if (loop && frameCount > 1) {
    const rest = context.getImageData(0, 0, frameWidth, image.naturalHeight);
    context.putImageData(rest, frameWidth * (frameCount - 1), 0);
  }
  if (expectedFrameCount === 4) validateBlinkMotion(context, frameWidth, image.naturalHeight);
  else validateAnimationMotion(context, frameWidth, image.naturalHeight, frameCount);
  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasTransparentPixel = false;
    let hasVisiblePixel = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) hasTransparentPixel = true;
      if (pixels[index] > 0) hasVisiblePixel = true;
    }
    if (!hasVisiblePixel) throw new Error("Draw or import visible artwork before saving this animation.");
    if (!hasTransparentPixel) throw new Error("Use a transparent background so the companion fits cleanly over your desktop.");
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Use a transparent") || error.message.startsWith("Draw or import"))) throw error;
    throw new Error("Skai could not verify the strip transparency. Export it as a PNG or WebP with transparency and try again.");
  }
  return { dataUrl: loop ? canvas.toDataURL("image/png") : dataUrl, frameWidth, frameHeight: image.naturalHeight, frameCount };
}

function validateBlinkMotion(context: CanvasRenderingContext2D, frameWidth: number, frameHeight: number) {
  const sampleSize = 48;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) throw new Error("Skai could not inspect the blink frames.");
  const frames: Uint8ClampedArray[] = [];
  for (let index = 0; index < 4; index += 1) {
    sampleContext.clearRect(0, 0, sampleSize, sampleSize);
    sampleContext.drawImage(context.canvas, index * frameWidth, 0, frameWidth, frameHeight, 0, 0, sampleSize, sampleSize);
    frames.push(sampleContext.getImageData(0, 0, sampleSize, sampleSize).data);
  }
  let best = 0;
  for (let frame = 1; frame < frames.length - 1; frame += 1) {
    let difference = 0;
    let samples = 0;
    for (let y = 8; y < 30; y += 1) {
      for (let x = 8; x < 40; x += 1) {
        const offset = (y * sampleSize + x) * 4;
        const current = frames[frame][offset] + frames[frame][offset + 1] + frames[frame][offset + 2] + frames[frame][offset + 3];
        const prior = frames[frame - 1][offset] + frames[frame - 1][offset + 1] + frames[frame - 1][offset + 2] + frames[frame - 1][offset + 3];
        difference += Math.abs(current - prior);
        samples += 1020;
      }
    }
    best = Math.max(best, difference / samples);
  }
  if (best < 0.012) throw new Error("The blink strip needs a visible eye-state change in its middle frames.");
}

/**
 * Reject strips that pass the file/alpha checks but are effectively a still
 * image being translated or scaled from cel to cel. A good strip needs both
 * visible frame-to-frame motion and pose change after translation is removed.
 */
function validateAnimationMotion(context: CanvasRenderingContext2D, frameWidth: number, frameHeight: number, frameCount: number) {
  const sampleSize = 32;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) throw new Error("Skai could not inspect the animation frames.");
  const frames: Uint8Array[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    sampleContext.clearRect(0, 0, sampleSize, sampleSize);
    sampleContext.drawImage(context.canvas, index * frameWidth, 0, frameWidth, frameHeight, 0, 0, sampleSize, sampleSize);
    const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
    const values = new Uint8Array(sampleSize * sampleSize);
    for (let pixel = 0; pixel < values.length; pixel += 1) {
      const offset = pixel * 4;
      const alpha = pixels[offset + 3] / 255;
      const luminance = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
      values[pixel] = Math.round(alpha * (0.35 + luminance * 0.65) * 255);
    }
    frames.push(values);
  }
  const comparisons = frames.slice(1).map((frame, index) => {
    const previous = frames[index];
    const currentCenter = frameCentroid(frame, sampleSize);
    const previousCenter = frameCentroid(previous, sampleSize);
    const shift = Math.hypot(currentCenter.x - previousCenter.x, currentCenter.y - previousCenter.y) / sampleSize;
    return { raw: pixelDifference(previous, frame), aligned: alignedDifference(previous, frame, previousCenter, currentCenter, sampleSize), shift };
  });
  const averageRaw = comparisons.reduce((sum, item) => sum + item.raw, 0) / comparisons.length;
  const averageAligned = comparisons.reduce((sum, item) => sum + item.aligned, 0) / comparisons.length;
  const averageShift = comparisons.reduce((sum, item) => sum + item.shift, 0) / comparisons.length;
  const changedPairs = comparisons.filter((item) => item.raw >= 0.025).length;
  // A convincing strip should move through most of its cels. This catches
  // generated sheets that only change the first/last pose and hold the same
  // drawing for the middle of the loop.
  if (averageRaw < 0.012 || changedPairs < Math.max(4, Math.ceil(comparisons.length * 0.6)))
    throw new Error("This strip is almost static. Give the character a real pose change across most frames.");
  if (averageAligned < 0.014 && averageShift > 0.018)
    throw new Error("This strip mostly moves the same drawing around. Animate the character’s limbs, face, or tail instead of only translating the frame.");
}

function frameCentroid(frame: Uint8Array, size: number) {
  let weight = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame[index];
    weight += value;
    x += (index % size) * value;
    y += Math.floor(index / size) * value;
  }
  return weight ? { x: x / weight, y: y / weight } : { x: size / 2, y: size / 2 };
}

function pixelDifference(left: Uint8Array, right: Uint8Array) {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference += Math.abs(left[index] - right[index]);
  return difference / (left.length * 255);
}

function alignedDifference(left: Uint8Array, right: Uint8Array, leftCenter: { x: number; y: number }, rightCenter: { x: number; y: number }, size: number) {
  const dx = Math.round(leftCenter.x - rightCenter.x);
  const dy = Math.round(leftCenter.y - rightCenter.y);
  let difference = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = x - dx;
      const sourceY = y - dy;
      const source = sourceX >= 0 && sourceX < size && sourceY >= 0 && sourceY < size ? right[sourceY * size + sourceX] : 0;
      difference += Math.abs(left[y * size + x] - source);
    }
  }
  return difference / (left.length * 255);
}

export async function validatePetProfileImport(file: File): Promise<PetSpriteProfile> {
  if (!file.name.toLowerCase().endsWith(".json") || file.size > 64 * 1024 * 1024)
    throw new Error("Choose a companion profile JSON file up to 64 MB.");
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error("This companion profile is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This file does not contain a companion profile.");
  const candidate = value as { name?: unknown; strips?: unknown; blink?: unknown; behavior?: unknown; referenceImageDataUrl?: unknown };
  if (typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.length > 48 || !candidate.strips || typeof candidate.strips !== "object" || Array.isArray(candidate.strips))
    throw new Error("The profile needs a name and an animations collection.");
  const strips: Partial<Record<PetAnimationId, PetStrip>> = {};
  for (const animation of PET_ANIMATIONS) {
    const raw = (candidate.strips as Record<string, unknown>)[animation.id];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${animation.label} has invalid strip data.`);
    const dataUrl = (raw as { dataUrl?: unknown }).dataUrl;
    if (typeof dataUrl !== "string" || !/^data:image\/(png|webp);base64,/i.test(dataUrl)) throw new Error(`${animation.label} must be a PNG or WebP data image.`);
    let blob: Blob;
    try { blob = await (await fetch(dataUrl)).blob(); }
    catch { throw new Error(`${animation.label} could not be read from the profile.`); }
    if (blob.size > 5 * 1024 * 1024) throw new Error(`${animation.label} is larger than 5 MB.`);
    const storedStrip = raw as { frameWidth?: unknown; fps?: unknown; loop?: unknown };
    const loop = storedStrip.loop !== false;
    const validatedStrip = await validatePetStrip(new File([blob], `${animation.id}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type }), true, Number(storedStrip.frameWidth), undefined, loop);
    const fps = typeof storedStrip.fps === "number" && Number.isFinite(storedStrip.fps) ? Math.round(Math.max(1, Math.min(60, storedStrip.fps))) : undefined;
    strips[animation.id] = { ...validatedStrip, ...(fps ? { fps } : {}), loop };
  }
  let blink: PetStrip | undefined;
  if (candidate.blink !== undefined) {
    if (!candidate.blink || typeof candidate.blink !== "object" || Array.isArray(candidate.blink)) throw new Error("Blink animation data is invalid.");
    const rawBlink = candidate.blink as { dataUrl?: unknown; frameWidth?: unknown };
    if (typeof rawBlink.dataUrl !== "string" || !/^data:image\/(png|webp);base64,/i.test(rawBlink.dataUrl)) throw new Error("Blink animation must be a PNG or WebP data image.");
    const blob = await (await fetch(rawBlink.dataUrl)).blob();
    if (blob.size > 5 * 1024 * 1024) throw new Error("Blink animation is larger than 5 MB.");
    blink = await validatePetStrip(new File([blob], `blink.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type }), false, undefined, 4);
  }
  let referenceImageDataUrl: string | undefined;
  if (candidate.referenceImageDataUrl !== undefined) {
    if (typeof candidate.referenceImageDataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/i.test(candidate.referenceImageDataUrl)) throw new Error("The concept reference must be an embedded PNG, JPEG, or WebP image.");
    try {
      const reference = await (await fetch(candidate.referenceImageDataUrl)).blob();
      if (reference.size > 5 * 1024 * 1024) throw new Error("The concept reference is larger than 5 MB.");
      referenceImageDataUrl = candidate.referenceImageDataUrl;
    } catch (error) {
      if (error instanceof Error && error.message.includes("5 MB")) throw error;
      throw new Error("The concept reference image could not be read.");
    }
  }
  return { id: crypto.randomUUID(), name: candidate.name.trim(), strips, ...(blink ? { blink } : {}), ...(referenceImageDataUrl ? { referenceImageDataUrl } : {}), behavior: normalizePetBehavior(candidate.behavior, candidate.name) };
}
import type { PetAttackAction, PetBehaviorSettings } from "../../../shared/contracts";

