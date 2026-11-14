import {
  fitsWithoutScrolling,
  renderText,
  scrollFrame,
  scrollLength,
  staticTextFrame,
} from './font';
import { applyMask, blankFrame, type Frame } from './frame';
import { SIZE } from './protocol';

/**
 * Something that produces frames over time: scrolling text, an animation, a
 * widget. `next` is called every `intervalMs`; return null to finish.
 */
export type Source = {
  label: string;
  intervalMs: number;
  next(tick: number): Frame | null;
};

export type TextOptions = {
  /** Milliseconds per one-pixel scroll step. Lower is faster. */
  speedMs?: number;
  /** How many times to scroll past. Infinity loops forever. */
  loops?: number;
  /**
   * After the last pass, bring the text back and leave its start on the matrix
   * until something replaces it, instead of ending on a blank matrix.
   */
  hold?: boolean;
  brightness?: number;
};

/** Text that fits is shown still; longer text scrolls right to left. */
export function textSource(text: string, options: TextOptions = {}): Source {
  const { speedMs = 60, loops = Infinity, hold = false, brightness = 255 } = options;
  const strip = renderText(text);
  if (fitsWithoutScrolling(strip)) {
    const frame = staticTextFrame(strip, brightness);
    // Still text has nothing to scroll, so "loops" means seconds on screen.
    const ticks = Number.isFinite(loops) && !hold ? Math.max(1, Math.round((loops * 1000) / 250)) : Infinity;
    return { label: `text: ${text}`, intervalMs: 250, next: (tick) => (tick < ticks ? frame : null) };
  }
  const length = scrollLength(strip);
  return {
    label: `text: ${text}`,
    intervalMs: speedMs,
    next: (tick) => {
      if (tick < length * loops) return scrollFrame(strip, tick % length, brightness);
      // Scroll in once more and stop with the first letters against the left edge.
      return hold ? scrollFrame(strip, Math.min(tick - length * loops, SIZE), brightness) : null;
    },
  };
}

/** A single still frame, held until something replaces it. */
export function staticSource(frame: Frame, label = 'frame'): Source {
  return { label, intervalMs: 1000, next: () => frame };
}

/** Plays frames in order. `delaysMs` is per frame; one number applies to all. */
export function animationSource(
  frames: Frame[],
  delaysMs: number[] | number,
  loop = true,
  label = 'animation',
): Source {
  if (frames.length === 0) return staticSource(blankFrame(), label);
  const delays = typeof delaysMs === 'number' ? frames.map(() => delaysMs) : delaysMs;
  // A source has one fixed interval, so tick at the shortest delay and hold longer frames.
  const base = Math.max(30, Math.min(...delays.map((d) => d || 100)));
  const schedule: number[] = [];
  frames.forEach((_, i) => {
    const repeats = Math.max(1, Math.round((delays[i] || 100) / base));
    for (let r = 0; r < repeats; r++) schedule.push(i);
  });
  return {
    label,
    intervalMs: base,
    next: (tick) => {
      if (!loop && tick >= schedule.length) return null;
      return frames[schedule[tick % schedule.length]!]!;
    },
  };
}

/** Calls `render` on a timer. Use for clocks, meters and anything computed live. */
export function liveSource(label: string, intervalMs: number, render: (tick: number) => Frame | null): Source {
  return { label, intervalMs, next: render };
}

type FrameListener = (frame: Frame) => void;

/**
 * Runs one Source at a time and hands every frame to its listeners (the
 * connection to the phone, the on-screen preview). Starting a new source
 * replaces the old one.
 */
export class Player {
  private source: Source | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tick = 0;
  private listeners = new Set<FrameListener>();
  private sourceListeners = new Set<(label: string | null) => void>();
  private last: Frame = blankFrame();
  private finish: (() => void) | null = null;
  /** Notices waiting their turn, and a counter that changes whenever the user takes the matrix back. */
  private notices: Source[] = [];
  private noticing = false;
  private turn = 0;

  /** The most recent frame, for late subscribers. */
  get current(): Frame {
    return this.last;
  }

  get label(): string | null {
    return this.source?.label ?? null;
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onSourceChange(fn: (label: string | null) => void): () => void {
    this.sourceListeners.add(fn);
    return () => this.sourceListeners.delete(fn);
  }

  /** Starts a source. Resolves when it finishes or is replaced. */
  play(source: Source): Promise<void> {
    this.dropNotices();
    return this.start(source);
  }

  /**
   * Shows a finite source over whatever is playing, then goes back to it.
   * Notices that arrive while one is showing wait their turn. Playing or
   * stopping anything else in the meantime cancels them and the going back.
   */
  notify(source: Source): void {
    this.notices.push(source);
    if (!this.noticing) void this.runNotices();
  }

  private async runNotices(): Promise<void> {
    const turn = ++this.turn;
    this.noticing = true;
    const resume = this.source;
    while (this.notices.length > 0) {
      await this.start(this.notices.shift()!);
      if (turn !== this.turn) return;
    }
    this.noticing = false;
    if (resume) void this.start(resume);
  }

  private dropNotices(): void {
    this.notices = [];
    this.noticing = false;
    this.turn++;
  }

  private start(source: Source): Promise<void> {
    this.cancel();
    this.source = source;
    this.tick = 0;
    this.sourceListeners.forEach((fn) => fn(source.label));
    return new Promise((resolve) => {
      this.finish = resolve;
      const step = () => {
        if (this.source !== source) return;
        const frame = source.next(this.tick++);
        if (frame === null) {
          this.source = null;
          this.timer = null;
          this.finish = null;
          this.emit(blankFrame());
          this.sourceListeners.forEach((fn) => fn(null));
          return resolve();
        }
        this.emit(frame);
        this.timer = setTimeout(step, source.intervalMs);
      };
      step();
    });
  }

  /** Shows one still frame, replacing whatever was playing. */
  show(frame: Frame, label = 'frame'): void {
    void this.play(staticSource(frame, label));
  }

  /** Stops whatever is playing and blanks the matrix. */
  stop(): void {
    this.dropNotices();
    this.cancel();
    this.source = null;
    this.emit(blankFrame());
    this.sourceListeners.forEach((fn) => fn(null));
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.finish?.();
    this.finish = null;
  }

  private emit(frame: Frame): void {
    this.last = applyMask(frame);
    this.listeners.forEach((fn) => fn(this.last));
  }
}
