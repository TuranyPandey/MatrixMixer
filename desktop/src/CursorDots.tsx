import { useEffect, useRef } from 'react';

/**
 * A patch of dot matrix that follows the pointer around the main window, as if
 * the whole window were LEDs and the pointer lit the ones near it. It sits
 * behind everything and never takes a click. Radius is in CSS pixels.
 */
export function CursorDots({ radius }: { radius: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      layer.style.setProperty('--mx', `${x}px`);
      layer.style.setProperty('--my', `${y}px`);
      layer.classList.add('lit');
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      // At most one style change per painted frame, however fast the pointer reports.
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const hide = () => layer.classList.remove('lit');
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  return <div ref={ref} className="cursor-dots" style={{ '--r': `${radius}px` } as React.CSSProperties} aria-hidden="true" />;
}
