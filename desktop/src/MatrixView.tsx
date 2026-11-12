import { useEffect, useRef } from 'react';
import { SIZE, isLed, type Frame } from '@matrix-bridge/core';

type Props = {
  /** Frame to draw. For live previews pass `subscribe` instead to skip React re-renders. */
  frame?: Frame;
  subscribe?: (draw: (frame: Frame) => void) => () => void;
  /** Width and height in CSS pixels. */
  size: number;
  /** Makes the matrix paintable: called for each LED the pointer presses or drags over. */
  onPaint?: (x: number, y: number, first: boolean) => void;
  label: string;
};

/** The matrix as round LEDs in its real circular shape. */
export function MatrixView({ frame, subscribe, size, onPaint, label }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    const cell = (size * dpr) / SIZE;

    const draw = (f: Frame) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (!isLed(x, y)) continue;
          const v = f[y * SIZE + x]! / 255;
          // Unlit LEDs stay faintly visible so the shape reads even when blank.
          const level = Math.round(34 + Math.pow(v, 0.6) * 221);
          ctx.fillStyle = v > 0 ? `rgb(${level},${level},${level})` : '#1c1c1c';
          ctx.beginPath();
          ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    if (frame) draw(frame);
    return subscribe?.(draw);
  }, [frame, subscribe, size]);

  const cellAt = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return [
      Math.floor(((ev.clientX - rect.left) / rect.width) * SIZE),
      Math.floor(((ev.clientY - rect.top) / rect.height) * SIZE),
    ] as const;
  };

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      className={onPaint ? 'matrix paintable' : 'matrix'}
      style={{ width: size, height: size }}
      onPointerDown={
        onPaint &&
        ((ev) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          const [x, y] = cellAt(ev);
          if (isLed(x, y)) onPaint(x, y, true);
        })
      }
      onPointerMove={
        onPaint &&
        ((ev) => {
          if (ev.buttons === 0) return;
          const [x, y] = cellAt(ev);
          if (isLed(x, y)) onPaint(x, y, false);
        })
      }
    />
  );
}
