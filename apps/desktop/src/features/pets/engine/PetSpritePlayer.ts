/**
 * Skai's strip/atlas renderer, adapted from OpenPets' pet-motion-player
 * lifecycle (generation-owned playback, decoded-frame presentation, pause,
 * cancel, and disposal). This version keeps Skai's PNG spritesheets and uses
 * requestAnimationFrame so legacy strips and grid atlases share one clock.
 * See THIRD_PARTY_NOTICES.md for the OpenPets MIT notice.
 */
export type PetSpriteClip = {
  imageUrl: string;
  frameCount: number;
  columns: number;
  rows: number;
  fps: number;
  loop: boolean;
};

type Playback = {
  generation: number;
  clip: PetSpriteClip;
  elapsedMs: number;
  lastTimestamp: number | null;
  lastFrame: number;
  image: HTMLImageElement | null;
  frameId: number | null;
};

const decodedImages = new Map<string, HTMLImageElement>();

export class PetSpritePlayer {
  private readonly context: CanvasRenderingContext2D;
  private current: Playback | null = null;
  private generation = 0;
  private paused = false;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Pet sprite canvas is unavailable.");
    this.context = context;
  }

  play(clip: PetSpriteClip, playbackKey: string | number): void {
    this.stop();
    if (this.disposed) return;
    const generation = ++this.generation;
    const playback: Playback = {
      generation,
      clip: { ...clip, fps: Math.max(1, Math.min(60, clip.fps)) },
      elapsedMs: 0,
      lastTimestamp: null,
      lastFrame: -1,
      image: null,
      frameId: null,
    };
    this.current = playback;
    this.canvas.dataset.playbackKey = String(playbackKey);
    this.canvas.width = Math.max(1, Math.ceil(this.canvas.width));
    this.canvas.height = Math.max(1, Math.ceil(this.canvas.height));
    this.loadImage(playback.clip.imageUrl, (image) => {
      if (this.disposed || this.current !== playback || playback.generation !== this.generation) return;
      playback.image = image;
      const sourceFrameWidth = image.naturalWidth / playback.clip.columns;
      const sourceFrameHeight = image.naturalHeight / playback.clip.rows;
      if (!sourceFrameWidth || !sourceFrameHeight || playback.clip.frameCount > playback.clip.columns * playback.clip.rows) {
        this.clear();
        this.current = null;
        return;
      }
      this.draw(playback, 0);
      if (!this.paused && (playback.clip.loop || playback.clip.frameCount > 1)) {
        playback.frameId = requestAnimationFrame((timestamp) => this.tick(playback, timestamp));
      }
    });
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused || this.disposed) return;
    this.paused = paused;
    const playback = this.current;
    if (!playback) return;
    if (paused) {
      if (playback.frameId !== null) cancelAnimationFrame(playback.frameId);
      playback.frameId = null;
      playback.lastTimestamp = null;
      return;
    }
    playback.lastTimestamp = null;
    if (playback.image && (playback.clip.loop || playback.lastFrame < playback.clip.frameCount - 1)) {
      playback.frameId = requestAnimationFrame((timestamp) => this.tick(playback, timestamp));
    }
  }

  stop(): void {
    const playback = this.current;
    if (playback?.frameId !== null && playback?.frameId !== undefined) cancelAnimationFrame(playback.frameId);
    this.current = null;
    this.generation += 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.clear();
  }

  private tick(playback: Playback, timestamp: number): void {
    if (this.disposed || this.paused || this.current !== playback || playback.generation !== this.generation || !playback.image) return;
    if (playback.lastTimestamp !== null) playback.elapsedMs += Math.min(100, Math.max(0, timestamp - playback.lastTimestamp));
    playback.lastTimestamp = timestamp;
    const framesElapsed = Math.floor(playback.elapsedMs * playback.clip.fps / 1000);
    const finished = !playback.clip.loop && framesElapsed >= playback.clip.frameCount;
    const frame = playback.clip.loop
      ? framesElapsed % playback.clip.frameCount
      : Math.min(playback.clip.frameCount - 1, framesElapsed);
    if (frame !== playback.lastFrame) this.draw(playback, frame);
    if (!finished && (playback.clip.loop || frame < playback.clip.frameCount - 1)) {
      playback.frameId = requestAnimationFrame((nextTimestamp) => this.tick(playback, nextTimestamp));
    } else playback.frameId = null;
  }

  private draw(playback: Playback, frame: number): void {
    const image = playback.image;
    if (!image) return;
    const { columns, rows, frameCount } = playback.clip;
    if (columns < 1 || rows < 1 || frame < 0 || frame >= frameCount) return;
    const cellWidth = image.naturalWidth / columns;
    const cellHeight = image.naturalHeight / rows;
    const sx = (frame % columns) * cellWidth;
    const sy = Math.floor(frame / columns) * cellHeight;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(image, sx, sy, cellWidth, cellHeight, 0, 0, this.canvas.width, this.canvas.height);
    playback.lastFrame = frame;
  }

  private clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private loadImage(url: string, onLoad: (image: HTMLImageElement) => void): void {
    const cached = decodedImages.get(url);
    if (cached?.complete && cached.naturalWidth > 0) {
      onLoad(cached);
      return;
    }
    if (cached) {
      cached.addEventListener("load", () => onLoad(cached), { once: true });
      return;
    }
    const image = new Image();
    image.decoding = "async";
    decodedImages.set(url, image);
    image.addEventListener("load", () => onLoad(image), { once: true });
    image.addEventListener("error", () => { if (decodedImages.get(url) === image) decodedImages.delete(url); }, { once: true });
    image.src = url;
  }
}
