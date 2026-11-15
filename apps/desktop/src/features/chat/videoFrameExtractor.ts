import type { ChatAttachment } from "../../../shared/contracts";

const maxVideoBytes = 20 * 1024 * 1024;
const maxVideoDurationSeconds = 15 * 60;
const frameRatios = [0.08, 0.35, 0.65, 0.92];

export function videoMediaType(fileName: string, declaredType?: string | null) {
  const extension = fileName.toLowerCase().split(".").pop();
  const expected = extension === "mp4" ? "video/mp4" : extension === "webm" ? "video/webm" : null;
  if (!expected) return null;
  return !declaredType || declaredType === "application/octet-stream" || declaredType === expected || declaredType.startsWith(`${expected};`) ? expected : null;
}

export function isVideoAttachment(attachment: Pick<ChatAttachment, "fileName" | "mediaType">) {
  return videoMediaType(attachment.fileName, attachment.mediaType);
}

export async function extractVideoFrameAttachments(video: Blob, fileName: string): Promise<ChatAttachment[]> {
  const mediaType = videoMediaType(fileName, video.type);
  if (!mediaType) throw new Error("Attach an MP4 or WebM video to sample it locally.");
  if (video.size === 0 || video.size > maxVideoBytes) throw new Error("Videos must be smaller than 20 MB to sample locally.");
  if (!(await hasExpectedSignature(video, mediaType))) throw new Error("The selected video file has an invalid signature.");

  const bridge = window.serverRockAgent?.video;
  if (!bridge) throw new Error("Local video decoding is unavailable in this desktop runtime.");
  const objectUrl = await bridge.createLocalUrl(mediaType, await blobToBase64(video));
  const element = document.createElement("video");
  element.preload = "metadata";
  element.muted = true;
  element.playsInline = true;
  element.src = objectUrl;
  try {
    await waitForVideoEvent(element, "loadedmetadata");
    if (!Number.isFinite(element.duration) || element.duration <= 0 || element.duration > maxVideoDurationSeconds)
      throw new Error("Videos must be 15 minutes or shorter to sample locally.");
    if (!element.videoWidth || !element.videoHeight) throw new Error("The video has no readable image frames.");

    const stem = safeVideoStem(fileName);
    const frames: ChatAttachment[] = [];
    for (let index = 0; index < frameRatios.length; index++) {
      const seconds = Math.min(element.duration - 0.03, Math.max(0.03, element.duration * frameRatios[index]));
      await seekVideo(element, seconds);
      const image = await renderJpegFrame(element);
      const timeLabel = formatTimestamp(seconds);
      frames.push({
        fileName: `${stem}.frame-${String(index + 1).padStart(2, "0")}-at-${timeLabel}.jpg`,
        mediaType: "image/jpeg",
        content: await blobToBase64(image)
      });
    }
    return frames;
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Videos must") || error.message.startsWith("The selected video") || error.message.startsWith("The video has"))) throw error;
    const detail = error instanceof Error ? error.message : "Unknown media decode error.";
    throw new Error(`This video could not be decoded in the local desktop runtime (${detail}). Try an MP4 or WebM encoded with H.264, VP8, or VP9.`);
  } finally {
    element.pause();
    element.removeAttribute("src");
    element.load();
    await bridge.revokeLocalUrl(objectUrl);
  }
}

async function hasExpectedSignature(video: Blob, mediaType: string) {
  const header = new Uint8Array(await video.slice(0, 12).arrayBuffer());
  if (mediaType === "video/webm") return header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  return header.length >= 8 && new TextDecoder().decode(header.slice(4, 8)) === "ftyp";
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(video.error?.message || `Video decoding failed (media error ${video.error?.code ?? "unknown"}).`)); };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Video decoding timed out.")); }, 10_000);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, seconds: number) {
  const seeking = waitForVideoEvent(video, "seeked");
  video.currentTime = seconds;
  await seeking;
}

async function renderJpegFrame(video: HTMLVideoElement) {
  const maxEdge = 960;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The local video frame canvas is unavailable.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  let image = await canvasToJpeg(canvas, 0.68);
  if (image.size > 1_500_000) {
    canvas.width = Math.max(1, Math.round(canvas.width * 0.7));
    canvas.height = Math.max(1, Math.round(canvas.height * 0.7));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    image = await canvasToJpeg(canvas, 0.5);
  }
  if (image.size > 1_500_000) throw new Error("A sampled video frame exceeds the local image size limit.");
  return image;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode a local video frame.")), "image/jpeg", quality));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const separator = value.indexOf(",");
      resolve(separator >= 0 ? value.slice(separator + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read a sampled video frame."));
    reader.readAsDataURL(blob);
  });
}

function safeVideoStem(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "").normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return stem || "video";
}

function formatTimestamp(seconds: number) {
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}-${String(totalSeconds % 60).padStart(2, "0")}`;
}
