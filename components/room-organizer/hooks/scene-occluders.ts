import { insetsFromRegion, isCompactViewport, visibleRegion } from '../lib/scene-insets';
import type { Insets, Rect } from '../lib/scene-insets';

/**
 * Reading the HUD panels that cover a canvas from the DOM. The geometry is
 * pure (`lib/scene-insets.ts`); this is the glue that measures the rects,
 * shared by the 3D framing (`use-camera-presets`) and the 2D plan.
 */

/** HUD panels that permanently cover the canvas (tagged by the HUD). */
export const OCCLUDER_SELECTOR = '[data-scene-occluder]';
/**
 * `data-scene-occluder="children"` marks a layout container whose own box
 * is mostly transparent: its visible children are the occluders.
 */
const OCCLUDER_CHILDREN = 'children';
/** The phone item sheet: an occluder while `<html data-sheet-open>` is set. */
export const SHEET_SELECTOR = '.pc-item-popover';

/**
 * Rects of the HUD panels covering the scene, plus the item sheet while
 * open when `withSheet`. A container tagged `data-scene-occluder="children"`
 * contributes its visible children instead of its own, mostly transparent,
 * box.
 */
export function sceneOccluderRects(withSheet = true): Rect[] {
  const selector = withSheet && document.documentElement.hasAttribute('data-sheet-open')
    ? `${OCCLUDER_SELECTOR}, ${SHEET_SELECTOR}`
    : OCCLUDER_SELECTOR;
  const rects: Rect[] = [];
  const add = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  };
  for (const el of document.querySelectorAll(selector)) {
    if (el.getAttribute('data-scene-occluder') === OCCLUDER_CHILDREN) {
      for (const child of el.children) {
        if (getComputedStyle(child).visibility !== 'hidden') add(child);
      }
    } else {
      add(el);
    }
  }
  return rects;
}

/** The canvas size and its free region, in canvas-local CSS pixels. */
export function measureRegion(canvas: HTMLCanvasElement, withSheet = true): { width: number; height: number; region: Rect } {
  const bounds = canvas.getBoundingClientRect();
  const free = visibleRegion(bounds, sceneOccluderRects(withSheet));
  return {
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    region: {
      left: free.left - bounds.left,
      top: free.top - bounds.top,
      right: free.right - bounds.left,
      bottom: free.bottom - bounds.top,
    },
  };
}

/** The last insets measured with the item sheet closed, per plan canvas and size. */
const settledInsets = new WeakMap<HTMLCanvasElement, { size: string; insets: Insets | undefined }>();

/**
 * The 2D plan's occluder insets: the canvas edges the HUD covers, on a
 * compact viewport only. Desktop-sized windows get `undefined` and keep the
 * plan's classic whole-canvas fit, pixel for pixel.
 *
 * Frozen while the phone item sheet is open: opening it (the first press on
 * an item) hides the catalog and the build tools, and re-fitting the plan
 * to the panels that are left would rescale it under the finger, mid-drag.
 * The sheet itself is never an inset, for the same reason. A canvas resize
 * (a rotation) measures afresh.
 */
export function planInsets(canvas: HTMLCanvasElement): Insets | undefined {
  if (!isCompactViewport(window.innerWidth, window.innerHeight)) return undefined;
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return undefined;
  const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
  const settled = settledInsets.get(canvas);
  if (settled && settled.size === size && document.documentElement.hasAttribute('data-sheet-open')) return settled.insets;
  const bounds = canvas.getBoundingClientRect();
  const free = visibleRegion(bounds, sceneOccluderRects(false));
  const measured = insetsFromRegion(bounds, free);
  // Nothing covers the canvas: the classic whole-canvas fit.
  const insets = measured.top || measured.right || measured.bottom || measured.left ? measured : undefined;
  settledInsets.set(canvas, { size, insets });
  return insets;
}

/**
 * Call `onChange` whenever a HUD panel mounts, unmounts, is re-tagged or
 * changes size. Measuring is left to `onChange`; the observers only compare
 * element lists and sizes, and the panels present at the start don't fire
 * (a ResizeObserver reports every element once when it starts observing it,
 * which would repaint once per panel on every effect run). Returns the
 * disposer.
 */
export function observeSceneOccluders(onChange: () => void): () => void {
  const sizes = new Map<Element, string>();
  const resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const size = `${entry.contentRect.width}x${entry.contentRect.height}`;
      const before = sizes.get(entry.target);
      sizes.set(entry.target, size);
      if (before !== undefined && before !== size) changed = true;
    }
    if (changed) onChange();
  });
  let observed: Element[] = [];
  const sync = (initial: boolean) => {
    const now = [...document.querySelectorAll(OCCLUDER_SELECTOR)];
    if (now.length === observed.length && now.every((el, i) => el === observed[i])) return;
    for (const el of observed) {
      if (now.includes(el)) continue;
      resizeObserver.unobserve(el);
      sizes.delete(el);
    }
    for (const el of now) if (!observed.includes(el)) resizeObserver.observe(el);
    observed = now;
    if (!initial) onChange();
  };
  sync(true);
  // Only mutations that can touch a panel: a re-tag, or an added or removed
  // subtree that is or holds one. Most DOM churn (labels, counters) is neither.
  const touchesOccluder = (node: Node): boolean =>
    node instanceof Element && (node.matches(OCCLUDER_SELECTOR) || node.querySelector(OCCLUDER_SELECTOR) !== null);
  const mountObserver = new MutationObserver((records) => {
    const relevant = records.some(
      (r) => r.type === 'attributes' || [...r.addedNodes].some(touchesOccluder) || [...r.removedNodes].some(touchesOccluder)
    );
    if (relevant) sync(false);
  });
  mountObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-scene-occluder'] });
  return () => {
    resizeObserver.disconnect();
    mountObserver.disconnect();
  };
}
