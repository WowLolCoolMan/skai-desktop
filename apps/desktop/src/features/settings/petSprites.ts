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
] as const;

export type PetAnimationId = typeof PET_ANIMATIONS[number]["id"];
export type PetStrip = { dataUrl: string; frameWidth: number; frameHeight: number };
export type PetSpriteProfile = { id: string; name: string; strips: Partial<Record<PetAnimationId, PetStrip>> };

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

export async function validatePetStrip(file: File): Promise<PetStrip> {
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
  if (image.naturalWidth < 6 || image.naturalHeight < 1 || image.naturalWidth % 6 !== 0)
    throw new Error("The strip must have six equal-width frames in one horizontal row.");
  const frameWidth = image.naturalWidth / 6;
  if (frameWidth > 2048 || image.naturalHeight > 2048)
    throw new Error("Each frame must be 2048 pixels or smaller in either direction.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Skai could not inspect this sprite strip.");
  context.drawImage(image, 0, 0);
  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasTransparentPixel = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) { hasTransparentPixel = true; break; }
    }
    if (!hasTransparentPixel) throw new Error("Use a transparent background so the companion fits cleanly over your desktop.");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Use a transparent")) throw error;
    throw new Error("Skai could not verify the strip transparency. Export it as a PNG or WebP with transparency and try again.");
  }
  return { dataUrl, frameWidth, frameHeight: image.naturalHeight };
}

export async function validatePetProfileImport(file: File): Promise<PetSpriteProfile> {
  if (!file.name.toLowerCase().endsWith(".json") || file.size > 64 * 1024 * 1024)
    throw new Error("Choose a companion profile JSON file up to 64 MB.");
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error("This companion profile is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This file does not contain a companion profile.");
  const candidate = value as { name?: unknown; strips?: unknown };
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
    strips[animation.id] = await validatePetStrip(new File([blob], `${animation.id}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type }));
  }
  return { id: crypto.randomUUID(), name: candidate.name.trim(), strips };
}
