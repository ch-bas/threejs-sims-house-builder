import { desktopPlanInsets, PLAN_INSET_PADDING_PX, PLAN_PADDING_PX } from '../lib/plan-view-fit';
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
/**
 * Panels that cover the 2D plan but not the 3D framing: the desktop header
 * stats, which the camera framing never needed to clear (#381). The plan
 * measures and observes them on top of `OCCLUDER_SELECTOR`.
 */
export const PLAN_OCCLUDER_SELECTOR = '[data-plan-occluder]';
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

/** The last insets measured outside a freeze, per plan canvas and fit key. */
const settledInsets = new WeakMap<HTMLCanvasElement, { key: string; insets: Insets | undefined }>();

/**
 * Set on `<html>` while a press on the 2D plan is armed (an item or zone
 * gesture, use-canvas-2d-interaction). It freezes `planInsets`, and
 * globals.css turns text selection off page-wide under it, or a drag across
 * the HUD selected its labels (#442).
 */
export const PLAN_GESTURE_ATTR = 'data-plan-gesture';

function rectOf(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
}

/** Every panel over the 2D plan: the scene's occluders and the plan-only ones. */
function planOccluderRects(): Rect[] {
  const planOnly = [...document.querySelectorAll(PLAN_OCCLUDER_SELECTOR)].map(rectOf).filter((r): r is Rect => r !== null);
  return [...sceneOccluderRects(false), ...planOnly];
}

/**
 * The 2D plan's occluder insets: the canvas edges the HUD covers.
 *
 * On a desktop window, with `content` (the plan's fit extent in metres,
 * `planViewBounds`), the plan keeps the classic whole-canvas fit, pixel for
 * pixel, until a HUD panel would cover it; then it fits the HUD-free part it
 * shows biggest in (`desktopPlanInsets`, #381), so nothing on the plan sits
 * under the catalog strip, the mode panel or the header stats. Without
 * `content` desktop gets `undefined`.
 *
 * On a compact viewport the plan fits the largest HUD-free rectangle.
 *
 * Frozen while a plan gesture is armed and, on a compact viewport, while
 * the phone item sheet is open: opening it (the first press on an item)
 * hides the catalog and the build tools, and a panel that resizes mid-drag
 * (the header's save label) would otherwise re-fit the plan under the
 * finger. The sheet itself is never an inset, for the same reason. A canvas
 * resize (a rotation) or a new fit extent measures afresh.
 */
export function planInsets(
  canvas: HTMLCanvasElement,
  content?: { width: number; height: number }
): Insets | undefined {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return undefined;
  const compact = isCompactViewport(window.innerWidth, window.innerHeight);
  if (!compact && !content) return undefined;
  const root = document.documentElement;
  const key = `${canvas.clientWidth}x${canvas.clientHeight}${compact || !content ? '' : `:${content.width}x${content.height}`}`;
  const frozen = root.hasAttribute(PLAN_GESTURE_ATTR) || (compact && root.hasAttribute('data-sheet-open'));
  const settled = settledInsets.get(canvas);
  if (settled && settled.key === key && frozen) return settled.insets;
  const bounds = canvas.getBoundingClientRect();
  let insets: Insets | undefined;
  if (compact || !content) {
    const free = visibleRegion(bounds, sceneOccluderRects(false));
    const measured = insetsFromRegion(bounds, free);
    // Nothing covers the canvas: the classic whole-canvas fit.
    insets = measured.top || measured.right || measured.bottom || measured.left ? measured : undefined;
  } else {
    insets = desktopPlanInsets(rectOf(canvas) ?? bounds, planOccluderRects(), content);
  }
  settledInsets.set(canvas, { key, insets });
  return insets;
}

/** How the 2D plan is fitted: `get2DViewTransform`'s insets and padding. */
export interface PlanFitInsets {
  insets: Insets | undefined;
  padding: number;
}

/**
 * `planInsets` with the padding the plan is drawn with: a desktop plan
 * fitted between the HUD panels keeps the slimmer `PLAN_INSET_PADDING_PX`
 * it was placed for (#381); every other fit keeps `PLAN_PADDING_PX`.
 */
export function planFit(canvas: HTMLCanvasElement, content: { width: number; height: number }): PlanFitInsets {
  const insets = planInsets(canvas, content);
  const desktop = !isCompactViewport(window.innerWidth, window.innerHeight);
  return { insets, padding: desktop && insets ? PLAN_INSET_PADDING_PX : PLAN_PADDING_PX };
}

const WATCHED_SELECTOR = `${OCCLUDER_SELECTOR}, ${PLAN_OCCLUDER_SELECTOR}`;

/**
 * Call `onChange` whenever the HUD panels over the 2D plan
 * (`OCCLUDER_SELECTOR`, `PLAN_OCCLUDER_SELECTOR`) mount, unmount, are
 * re-tagged, resize or move. Event-driven, never polled: nothing runs while
 * the page is idle.
 *
 * Every trigger only schedules one check on the next animation frame, which
 * compares the panels' rects with the last ones and calls `onChange` when
 * they differ. The triggers: a ResizeObserver on the panels; a DOM mutation
 * (children, `class` or `style`, the tags) anywhere in the document, which is
 * how a panel moves without resizing (the left column dropping when the
 * drawer folds, which used to leave the plan fitted around where it was);
 * and the end of a CSS transition or animation, for a panel that slides.
 * The panels present at the start set the baseline and don't fire. While a
 * plan gesture is armed the check waits: the fit is frozen and a repaint
 * would overwrite the ghost frames; the flag's removal re-checks.
 * Returns the disposer.
 */
export function observeSceneOccluders(onChange: () => void): () => void {
  const placement = (): string => planOccluderRects().map((r) => `${r.left},${r.top},${r.right},${r.bottom}`).join(';');
  const root = document.documentElement;
  let placed = placement();
  let frame: number | null = null;
  const check = (): void => {
    frame = null;
    if (root.hasAttribute(PLAN_GESTURE_ATTR)) return;
    const now = placement();
    if (now === placed) return;
    placed = now;
    onChange();
  };
  const schedule = (): void => {
    if (frame === null) frame = requestAnimationFrame(check);
  };

  const resizeObserver = new ResizeObserver(schedule);
  let observed: Element[] = [];
  const syncObserved = (): void => {
    const now = [...document.querySelectorAll(WATCHED_SELECTOR)];
    if (now.length === observed.length && now.every((el, i) => el === observed[i])) return;
    for (const el of observed) if (!now.includes(el)) resizeObserver.unobserve(el);
    for (const el of now) if (!observed.includes(el)) resizeObserver.observe(el);
    observed = now;
  };
  syncObserved();
  const mutationObserver = new MutationObserver(() => {
    syncObserved();
    schedule();
  });
  mutationObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-scene-occluder', 'data-plan-occluder', PLAN_GESTURE_ATTR],
  });
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
  };
}
