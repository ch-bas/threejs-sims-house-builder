// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_INSET_PADDING_PX, PLAN_PADDING_PX } from '../lib/plan-view-fit';
import { observeSceneOccluders, PLAN_GESTURE_ATTR, planFit, planInsets } from './scene-occluders';

const W = 750;
const H = 342;

function rectOf(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function canvasOf(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: W });
  Object.defineProperty(canvas, 'clientHeight', { value: H });
  canvas.getBoundingClientRect = () => rectOf(0, 0, W, H);
  return canvas;
}

function panel(bounds: { current: DOMRect }): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-scene-occluder', '');
  el.getBoundingClientRect = () => bounds.current;
  document.body.appendChild(el);
  return el;
}

describe('planInsets', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-sheet-open');
  });

  it('is the edges the panels cover, on a compact viewport', () => {
    panel({ current: rectOf(0, 0, W, 62) });
    panel({ current: rectOf(0, 264, W, H) });
    expect(planInsets(canvasOf())).toEqual({ top: 62, right: 0, bottom: H - 264, left: 0 });
  });

  it('is undefined when nothing covers the canvas', () => {
    expect(planInsets(canvasOf())).toBeUndefined();
  });

  it('stays frozen while the item sheet is open, so the plan never rescales under the finger', () => {
    const dock = { current: rectOf(0, 264, W, H) };
    panel(dock);
    const canvas = canvasOf();
    const closed = planInsets(canvas);
    // The press opens the sheet, which hides the dock's catalog row.
    document.documentElement.setAttribute('data-sheet-open', '');
    dock.current = rectOf(0, 300, W, H);
    expect(planInsets(canvas)).toEqual(closed);
    // Closed again: measured afresh.
    document.documentElement.removeAttribute('data-sheet-open');
    expect(planInsets(canvas)).toEqual({ top: 0, right: 0, bottom: H - 300, left: 0 });
  });

  it('measures afresh when the canvas was never measured with the sheet closed', () => {
    panel({ current: rectOf(0, 264, W, H) });
    document.documentElement.setAttribute('data-sheet-open', '');
    expect(planInsets(canvasOf())).toEqual({ top: 0, right: 0, bottom: H - 264, left: 0 });
  });
});

describe('planInsets on a desktop window (#381)', () => {
  const DW = 1440;
  const DH = 900;
  const square = { width: 8, height: 8 };
  let saved: { width: number; height: number };

  function desktopCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: DW });
    Object.defineProperty(canvas, 'clientHeight', { value: DH });
    canvas.getBoundingClientRect = () => rectOf(0, 0, DW, DH);
    return canvas;
  }

  beforeEach(() => {
    saved = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { value: DW, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: DH, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: saved.width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: saved.height, configurable: true });
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
  });

  it('keeps the classic fit without content, or while no panel covers the plan', () => {
    panel({ current: rectOf(16, 16, 272, 70) });
    expect(planInsets(desktopCanvas())).toBeUndefined();
    expect(planInsets(desktopCanvas(), square)).toBeUndefined();
    expect(planFit(desktopCanvas(), square)).toEqual({ insets: undefined, padding: PLAN_PADDING_PX });
  });

  it('fits above the catalog strip once it covers the plan, with the slimmer padding', () => {
    panel({ current: rectOf(444, 673, 984, 884) });
    const fit = planFit(desktopCanvas(), square);
    expect(fit.padding).toBe(PLAN_INSET_PADDING_PX);
    expect(fit.insets).toBeDefined();
    expect(DH - fit.insets!.bottom).toBeLessThanOrEqual(673);
  });

  it('counts the header stats, which only the plan treats as a panel', () => {
    const stats = document.createElement('div');
    stats.setAttribute('data-plan-occluder', '');
    stats.getBoundingClientRect = () => rectOf(413, 16, 1122, 93);
    document.body.appendChild(stats);
    panel({ current: rectOf(444, 673, 984, 884) });
    const insets = planInsets(desktopCanvas(), square)!;
    // The free region either starts below the stats or lies beside them.
    const free = { left: insets.left, top: insets.top, right: DW - insets.right, bottom: DH - insets.bottom };
    expect(free.top >= 93 || free.right <= 413 || free.left >= 1122).toBe(true);
  });

  it('stays frozen while a plan gesture is armed', () => {
    const strip = { current: rectOf(444, 673, 984, 884) };
    panel(strip);
    const canvas = desktopCanvas();
    const before = planInsets(canvas, square);
    document.documentElement.setAttribute(PLAN_GESTURE_ATTR, '');
    strip.current = rectOf(444, 500, 984, 884);
    expect(planInsets(canvas, square)).toEqual(before);
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
    expect(planInsets(canvas, square)).not.toEqual(before);
  });
});

describe('observeSceneOccluders', () => {
  let frames: Array<() => void>;
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
  });
  /** Let the MutationObserver deliver, then run the scheduled frame. */
  const flush = async () => {
    await Promise.resolve();
    const run = frames;
    frames = [];
    for (const cb of run) cb();
  };

  it('calls back when a panel moves without resizing, and not when nothing moved', async () => {
    const bounds = { current: rectOf(16, 503, 248, 627) };
    const el = panel(bounds);
    const onChange = vi.fn();
    const dispose = observeSceneOccluders(onChange);
    el.className = 'unrelated';
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    // The drawer folds: the column drops, same size.
    bounds.current = rectOf(16, 760, 248, 884);
    el.className = 'folded';
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('schedules nothing while the page is idle', async () => {
    panel({ current: rectOf(0, 264, W, H) });
    const dispose = observeSceneOccluders(vi.fn());
    await Promise.resolve();
    expect(frames).toHaveLength(0);
    dispose();
  });

  it('waits out a plan gesture and re-checks when it ends', async () => {
    const bounds = { current: rectOf(0, 264, W, H) };
    const el = panel(bounds);
    const onChange = vi.fn();
    const dispose = observeSceneOccluders(onChange);
    document.documentElement.setAttribute(PLAN_GESTURE_ATTR, '');
    bounds.current = rectOf(0, 300, W, H);
    el.className = 'moved';
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    dispose();
  });
});
