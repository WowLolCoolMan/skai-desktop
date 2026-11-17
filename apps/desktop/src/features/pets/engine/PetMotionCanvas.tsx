import { useEffect, useRef, type CanvasHTMLAttributes, type CSSProperties } from "react";

type Props = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "width" | "height"> & {
  clip: { url: string; frames: number; playbackRate: number; loop: boolean };
  playbackKey: string | number;
  paused: boolean;
  pixelWidth: number;
  pixelHeight: number;
  className: string;
  style?: CSSProperties;
  label: string;
};

type Decoder = { decode: (options: { frameIndex: number; completeFramesOnly: boolean }) => Promise<{ image: VideoFrame & { duration?: number }; complete: boolean }>; close: () => void };

function supportsDecoder(): boolean { return typeof (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder === "function"; }

export function PetMotionCanvas({ clip, playbackKey, paused, pixelWidth, pixelHeight, className, style, label, ...canvasProps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !supportsDecoder()) return;
    let cancelled = false;
    let frameId: number | undefined;
    let decoder: Decoder | undefined;
    let frameIndex = 0;
    let nextDue = 0;
    let lastFrame: VideoFrame | undefined;
    canvas.width = Math.max(1, Math.round(pixelWidth));
    canvas.height = Math.max(1, Math.round(pixelHeight));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const draw = (frame: VideoFrame) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      canvas.dataset.frame = String(frameIndex);
      lastFrame?.close();
      lastFrame = frame;
    };
    const tick = (timestamp: number) => {
      if (cancelled || paused || !decoder) return;
      if (timestamp < nextDue) { frameId = requestAnimationFrame(tick); return; }
      void decoder.decode({ frameIndex, completeFramesOnly: true }).then((result) => {
        if (cancelled || paused) { result.image.close(); return; }
        draw(result.image);
        const nativeDuration = Number(result.image.duration ?? 0) / 1000;
        nextDue = timestamp + Math.max(16, (nativeDuration || 1000 / 12) / Math.max(.1, clip.playbackRate));
        frameIndex += 1;
        if (frameIndex >= clip.frames) {
          if (!clip.loop) return;
          frameIndex = 0;
        }
        frameId = requestAnimationFrame(tick);
      }).catch(() => {});
    };
    void fetch(clip.url).then((response) => response.arrayBuffer()).then((data) => {
      if (cancelled) return;
      const DecoderCtor = (globalThis as unknown as { ImageDecoder: new (options: { data: ArrayBuffer; type: string; preferAnimation: boolean }) => Decoder }).ImageDecoder;
      decoder = new DecoderCtor({ data, type: "image/webp", preferAnimation: true });
      frameId = requestAnimationFrame(tick);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      decoder?.close();
      lastFrame?.close();
    };
  }, [clip.url, clip.frames, clip.playbackRate, clip.loop, playbackKey, pixelWidth, pixelHeight, paused]);
  return <canvas {...canvasProps} ref={canvasRef} className={className} style={style} role="img" aria-label={label} />;
}
