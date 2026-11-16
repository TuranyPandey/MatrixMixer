/**
 * The picture library: everything saved by name (drawings, animations, pictures
 * brought in from a file) plus the ready-made ones that ship with the app.
 * One list, shared by the Images page and the island.
 */
import { useSyncExternalStore } from 'react';
import { DESIGNS, PIXELS, animationSource, type Frame } from '@matrix-bridge/core';
import { player } from './bridge';

/** `px` is the first frame (and the whole picture when it is not animated). */
export type SavedImage = { name: string; px: number[]; frames?: number[][]; delay?: number };

/** The most frames a saved animation (and the editor) holds. */
export const MAX_FRAMES = 24;

// The key predates the library, from when only drawings could be saved. Kept so those are still there.
const KEY = 'matrix-bridge.drawings';

function load(): SavedImage[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedImage[];
    return Array.isArray(list) ? list.filter((d) => typeof d.name === 'string' && Array.isArray(d.px) && d.px.length === PIXELS) : [];
  } catch {
    return [];
  }
}

let saved: SavedImage[] = load();
const listeners = new Set<() => void>();

function store(next: SavedImage[]): void {
  saved = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* not saved; still usable this session */
  }
  listeners.forEach((fn) => fn());
}

/** Calls `fn` whenever something is saved or deleted. Returns the function that stops listening. */
export function onSaved(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function useSaved(): SavedImage[] {
  return useSyncExternalStore(onSaved, () => saved);
}

/** Saves under its name, newest first. Saving a name again replaces what was there. */
export function saveImage(image: SavedImage): void {
  store([image, ...saved.filter((d) => d.name !== image.name)]);
}

export function deleteImage(name: string): void {
  store(saved.filter((d) => d.name !== name));
}

/** A picture ready to show: frames as the matrix takes them. `id` tells a saved one from a ready-made one of the same name. */
export type LibraryItem = { id: string; name: string; frames: Frame[]; delay: number; builtin: boolean };

/** Everything there is to pick from: yours first, then the ready-made ones. */
export function library(): LibraryItem[] {
  const yours = saved.map((d) => ({
    id: `s:${d.name}`,
    name: d.name,
    frames: (d.frames?.length ? d.frames : [d.px]).map((px) => Uint8Array.from(px)),
    delay: d.delay ?? 200,
    builtin: false,
  }));
  return [...yours, ...DESIGNS.map((d) => ({ id: `r:${d.name}`, name: d.name, frames: [d.frame], delay: 200, builtin: true }))];
}

/** What the player calls a picture while it is showing. */
export const imageLabel = (name: string): string => `image: ${name}`;

/** Puts a picture on the matrix, or loops it if it is an animation. */
export function showImage(item: LibraryItem): void {
  if (item.frames.length > 1) void player.play(animationSource(item.frames, item.delay, true, imageLabel(item.name)));
  else player.show(item.frames[0]!, imageLabel(item.name));
}

/**
 * Squeezes an animation into what the library holds: at most MAX_FRAMES, one
 * delay for all. A longer one keeps every k-th frame and holds each for longer,
 * so it runs for about as long as it did.
 */
export function fitFrames(frames: Frame[], delays: number[]): { frames: Frame[]; delay: number } {
  if (frames.length <= 1) return { frames, delay: 200 };
  const total = frames.reduce((sum, _, i) => sum + (delays[i] || 100), 0);
  const step = Math.ceil(frames.length / MAX_FRAMES);
  const kept = frames.filter((_, i) => i % step === 0).slice(0, MAX_FRAMES);
  return { frames: kept, delay: Math.max(50, Math.min(1000, Math.round(total / kept.length / 10) * 10)) };
}

// ---- "open this one in the editor" ------------------------------------------------

const editors = new Set<(image: SavedImage) => void>();

/** The Draw view listens here for pictures to open. */
export function onEdit(fn: (image: SavedImage) => void): () => void {
  editors.add(fn);
  return () => void editors.delete(fn);
}

export function editImage(image: SavedImage): void {
  editors.forEach((fn) => fn(image));
}
