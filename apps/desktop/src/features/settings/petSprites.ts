export const PET_ANIMATIONS = [
  { id: "idle", label: "Idle", pose: "idle" },
  { id: "walking", label: "Walking", pose: "walk" },
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

export const PET_FRAME_COUNT = 10;
export const PET_ACTIONS = [
  { id: "approach-cursor", label: "Approach the cursor", needsCursor: true },
  { id: "pounce", label: "Pounce / lunge", needsCursor: true },
  { id: "fire-breath", label: "Breathe fire", needsCursor: true },
] as const;

export type PetAnimationId = typeof PET_ANIMATIONS[number]["id"];
export type PetActionId = PetAttackAction;
export type PetStrip = { dataUrl: string; frameWidth: number; frameHeight: number; frameCount?: number };
export type PetSpriteProfile = {
  id: string;
  name: string;
  strips: Partial<Record<PetAnimationId, PetStrip>>;
  behavior?: PetBehaviorSettings;
};

export function petStripFrameCount(strip: PetStrip): number {
  // Old profiles did not persist a frame count; they contain six-cel strips.
  return strip.frameCount ?? 6;
}

export function defaultPetBehavior(name: string, enabled = false): PetBehaviorSettings {
  const blaze = name.trim().toLocaleLowerCase() === "blaze";
  return {
    enabled: enabled || blaze,
    triggerDuringIdle: true,
    triggerDuringWalk: true,
    minimumIntervalSeconds: 60,
    maximumIntervalSeconds: 180,
    actions: ["approach-cursor", "pounce", "fire-breath"],
  };
}

export function normalizePetBehavior(value: unknown, name = ""): PetBehaviorSettings {
  const fallback = defaultPetBehavior(name);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Partial<PetBehaviorSettings>;
  const allowed = new Set<string>(PET_ACTIONS.map((action) => action.id));
  const actions = Array.isArray(candidate.actions)
    ? [...new Set(candidate.actions.filter((action): action is PetActionId => typeof action === "string" && allowed.has(action)))]
    : fallback.actions;
  const minimumIntervalSeconds = clampInterval(candidate.minimumIntervalSeconds, 60);
  const maximumIntervalSeconds = Math.max(minimumIntervalSeconds, clampInterval(candidate.maximumIntervalSeconds, 180));
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    triggerDuringIdle: typeof candidate.triggerDuringIdle === "boolean" ? candidate.triggerDuringIdle : true,
    triggerDuringWalk: typeof candidate.triggerDuringWalk === "boolean" ? candidate.triggerDuringWalk : true,
    minimumIntervalSeconds,
    maximumIntervalSeconds,
    actions,
  };
}

function clampInterval(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(20, Math.min(480, parsed))) : fallback;
}

export function makePetAttackSequence(settings: PetBehaviorSettings, random = Math.random): PetActionId[] {
  const available = settings.actions.filter((action) => PET_ACTIONS.some((item) => item.id === action));
  if (available.length === 0) return [];
  const selected = available.filter(() => random() < 0.66);
  if (selected.length === 0) selected.push(available[Math.floor(random() * available.length)]);
  const approachNeeded = selected.some((action) => action === "pounce" || action === "fire-breath");
  const sequence: PetActionId[] = [];
  if (approachNeeded || selected.includes("approach-cursor")) sequence.push("approach-cursor");
  sequence.push(...selected.filter((action) => action !== "approach-cursor"));
  return sequence;
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

export async function validatePetStrip(file: File, allowLegacySixFrames = false): Promise<PetStrip> {
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
  const frameCount = image.naturalWidth % PET_FRAME_COUNT === 0 ? PET_FRAME_COUNT : allowLegacySixFrames && image.naturalWidth % 6 === 0 ? 6 : 0;
  if (!frameCount || image.naturalWidth < frameCount || image.naturalHeight < 1)
    throw new Error("The strip must have ten equal-width frames in one horizontal row. Frame 0 is the resting pose.");
  const frameWidth = image.naturalWidth / frameCount;
  if (frameWidth > 2048 || image.naturalHeight > 2048)
    throw new Error("Each frame must be 2048 pixels or smaller in either direction.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Skai could not inspect this sprite strip.");
  context.drawImage(image, 0, 0);
  if (frameCount === PET_FRAME_COUNT) {
    const rest = context.getImageData(0, 0, frameWidth, image.naturalHeight);
    context.putImageData(rest, frameWidth * (PET_FRAME_COUNT - 1), 0);
  }
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
  return { dataUrl: frameCount === PET_FRAME_COUNT ? canvas.toDataURL("image/png") : dataUrl, frameWidth, frameHeight: image.naturalHeight, frameCount };
}

export async function validatePetProfileImport(file: File): Promise<PetSpriteProfile> {
  if (!file.name.toLowerCase().endsWith(".json") || file.size > 64 * 1024 * 1024)
    throw new Error("Choose a companion profile JSON file up to 64 MB.");
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error("This companion profile is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This file does not contain a companion profile.");
  const candidate = value as { name?: unknown; strips?: unknown; behavior?: unknown };
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
    strips[animation.id] = await validatePetStrip(new File([blob], `${animation.id}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type }), true);
  }
  return { id: crypto.randomUUID(), name: candidate.name.trim(), strips, behavior: normalizePetBehavior(candidate.behavior, candidate.name) };
}
import type { PetAttackAction, PetBehaviorSettings } from "../../../shared/contracts";

