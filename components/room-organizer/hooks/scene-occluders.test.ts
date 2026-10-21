// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { planInsets } from './scene-occluders';

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
