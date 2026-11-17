import { useEffect, useRef, type CanvasHTMLAttributes, type CSSProperties } from "react";
import { PetSpritePlayer, type PetSpriteClip } from "./PetSpritePlayer";

type Props = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "width" | "height"> & {
  clip: PetSpriteClip;
  playbackKey: string | number;
  paused: boolean;
  pixelWidth: number;
  pixelHeight: number;
  className: string;
  style?: CSSProperties;
  label: string;
};

export function PetSpriteCanvas({ clip, playbackKey, paused, pixelWidth, pixelHeight, className, style, label, ...canvasProps }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PetSpritePlayer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(pixelWidth));
    canvas.height = Math.max(1, Math.round(pixelHeight));
    const player = new PetSpritePlayer(canvas);
    playerRef.current = player;
    player.play(clip, playbackKey);
    player.setPaused(paused);
    return () => {
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [clip.imageUrl, clip.frameCount, clip.columns, clip.rows, clip.fps, clip.loop, playbackKey, pixelWidth, pixelHeight]);

  useEffect(() => { playerRef.current?.setPaused(paused); }, [paused]);

  return <canvas {...canvasProps} ref={canvasRef} className={className} style={style} role="img" aria-label={label} />;
}
