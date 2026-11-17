export type MotionClipDefinition = { file: string; frames: number; playbackRate?: number };
export type MotionAnimationDefinition =
  | { play: "loop"; intro?: string; loop: string; outro?: string }
  | { play: "once"; intro?: string; clip: string; outro?: string };
export type MotionPetManifest = {
  format: "motion";
  version: 1;
  id: string;
  displayName: string;
  description: string;
  geometry: { width: number; height: number; pixelsPerUnit: number; footAnchor: { x: number; y: number } };
  clips: Record<string, MotionClipDefinition>;
  animations: Record<string, MotionAnimationDefinition>;
  bindings: unknown;
  activities?: Array<{ id: string; displayName: string; outfitId: string; animation: string }>;
};

const motionBaseUrl = (path: string): string => new URL(path, document.baseURI).href;
const manifestUrls: Record<string, string> = Object.fromEntries(["percy", "byte", "ember", "blaze", "nova", "rocky", "sprout"].map((petId) => [petId, motionBaseUrl(`./pets/motion/${petId}/pet.json`)]));
const cache = new Map<string, Promise<MotionPetManifest>>();

export function motionManifestUrl(petId: string): string | undefined { return manifestUrls[petId]; }

export function loadMotionPet(petId: string): Promise<MotionPetManifest | null> {
  const manifestUrl = manifestUrls[petId];
  if (!manifestUrl) return Promise.resolve(null);
  const existing = cache.get(petId);
  if (existing) return existing;
  const request = fetch(manifestUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Motion pet manifest could not be loaded: ${petId}`);
    const value = await response.json() as MotionPetManifest;
    if (value.format !== "motion" || value.version !== 1 || value.id !== petId) throw new Error(`Invalid Motion pet manifest: ${petId}`);
    return value;
  });
  cache.set(petId, request);
  return request;
}

export function motionClipUrl(manifest: MotionPetManifest, clipId: string): string | null {
  const clip = manifest.clips[clipId];
  return clip ? motionBaseUrl(`./pets/motion/${manifest.id}/${clip.file}`) : null;
}

export function motionAnimationClip(manifest: MotionPetManifest, animationId: string): { url: string; frames: number; playbackRate: number; loop: boolean } | null {
  const animation = manifest.animations[animationId];
  if (!animation) return null;
  const clipId = animation.play === "loop" ? animation.loop : animation.intro ?? animation.clip;
  const clip = manifest.clips[clipId];
  const url = motionClipUrl(manifest, clipId);
  if (!clip || !url) return null;
  return { url, frames: clip.frames, playbackRate: clip.playbackRate ?? 1, loop: animation.play === "loop" };
}
