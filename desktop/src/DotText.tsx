import { useEffect, useRef } from 'react';
import { FONT_HEIGHT, renderText } from '@matrix-bridge/core';

type Props = {
  text: string;
  /** Size of one dot cell in CSS pixels. */
  cell?: number;
  /** Also draw the unlit dots, like a real LED panel. */
  ghost?: boolean;
  color?: string;
};

/**
 * Text set in the same 5x7 dot font the phone shows, so the app's headings are
 * made of the thing it controls.
 * Decorative: the parent element carries the readable label.
 */
export function DotText({ text, cell = 4, ghost = false, color = '#f4f4f4' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const strip = renderText(text.toUpperCase());
    const dpr = window.devicePixelRatio || 1;
    const step = cell * dpr;
    canvas.width = Math.max(1, Math.round(strip.width * step));
    canvas.height = Math.round(FONT_HEIGHT * step);
    canvas.style.width = `${strip.width * cell}px`;
    canvas.style.height = `${FONT_HEIGHT * cell}px`;
    const ctx = canvas.getContext('2d')!;

    const dots = (lit: boolean) => {
      for (let x = 0; x < strip.width; x++) {
        for (let y = 0; y < FONT_HEIGHT; y++) {
          if ((((strip.columns[x]! >> y) & 1) === 1) !== lit) continue;
          ctx.beginPath();
          ctx.arc((x + 0.5) * step, (y + 0.5) * step, step * 0.38, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (ghost) {
      ctx.fillStyle = '#1b1b1b';
      dots(false);
    }
    ctx.fillStyle = color;
    dots(true);
  }, [text, cell, ghost, color]);

  return <canvas ref={ref} className="dot-text" aria-hidden="true" />;
}
