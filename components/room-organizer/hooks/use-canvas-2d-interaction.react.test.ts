// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get2DViewTransform } from '../canvas-2d/render';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useCanvas2DInteraction, type UseCanvas2DInteractionParams } from './use-canvas-2d-interaction';

const W = 800;
const H = 600;

function pointer(type: string, clientX: number, clientY: number, pointerType = 'mouse'): MouseEvent {
  const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

function setup(selected: string[]) {
  const floor = makeFloor({
    items: [
      makeItem({ id: 'a', width: 2, depth: 1, position: { x: 0, z: 0 } }),
      makeItem({ id: 'b', position: { x: 2.5, z: 0 } }),
    ],
  });
  const layout = makeLayout({ floors: [floor] });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: W });
  Object.defineProperty(canvas, 'clientHeight', { value: H });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  const transform = get2DViewTransform(W, H, layout);
  const toClient = (x: number, z: number) => ({
    cx: transform.offsetX + (x + layout.width / 2) * transform.scale,
    cy: transform.offsetY + (z + layout.height / 2) * transform.scale,
  });
  const params: UseCanvas2DInteractionParams = {
    enabled: true,
    canvasRef: { current: canvas },
    layout,
    activeFloor: floor,
    view: { showMeasurements: false, showWiFiSignals: false, showHeatmap: false, drawZoneMode: false },
    selectedItemId: selected[0] ?? null,
    extraSelectedIds: new Set(selected.slice(1)),
    allSelectedIds: new Set(selected),
    onItemSelect: vi.fn(),
    onDeselect: vi.fn(),
    snapPosition: (_id, x, z) => ({ x, z }),
    onItemDragStart: vi.fn(),
    onItemDrag: vi.fn(),
    onItemDragEnd: vi.fn(),
    onItemDragCancel: vi.fn(),
  };
  renderHook(() => useCanvas2DInteraction(params));
  const fire = (type: string, x: number, z: number, pointerType = 'mouse') => {
    const { cx, cy } = toClient(x, z);
    canvas.dispatchEvent(pointer(type, cx, cy, pointerType));
  };
  return { params, fire, scale: transform.scale };
}

describe('useCanvas2DInteraction gestures (#291, #292)', () => {
  const raf = vi.fn(() => 1);
  beforeEach(() => {
    raf.mockClear();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a press on a selected member keeps the multi-selection for a group drag', () => {
    const { params, fire } = setup(['a', 'b']);
    fire('pointerdown', 0, 0);
    expect(params.onItemSelect).not.toHaveBeenCalled();
    fire('pointermove', 1, 0);
    expect(params.onItemDragStart).toHaveBeenCalledWith('a');
    fire('pointerup', 1, 0);
    expect(params.onItemDragEnd).toHaveBeenCalledWith('a');
    expect(params.onItemSelect).not.toHaveBeenCalled();
  });

  it('a click without movement on a selected member narrows on release', () => {
    const { params, fire } = setup(['a', 'b']);
    fire('pointerdown', 0, 0);
    fire('pointerup', 0, 0);
    expect(params.onItemSelect).toHaveBeenCalledWith('a', 'replace');
    expect(params.onItemDragStart).not.toHaveBeenCalled();
  });

  it('an unselected item still selects on press', () => {
    const { params, fire } = setup(['b']);
    fire('pointerdown', 0, 0);
    expect(params.onItemSelect).toHaveBeenCalledWith('a', 'replace');
  });

  it('pointercancel aborts with restore and repaints instead of committing', () => {
    const { params, fire } = setup([]);
    fire('pointerdown', 0, 0);
    fire('pointermove', 1, 0);
    raf.mockClear();
    fire('pointercancel', 1, 0);
    expect(params.onItemDragCancel).toHaveBeenCalledWith('a', { restore: true });
    expect(params.onItemDragEnd).not.toHaveBeenCalled();
    // One repaint from committed state clears the ghost frame.
    expect(raf).toHaveBeenCalledTimes(1);
    fire('pointerup', 1, 0);
    expect(params.onItemDragEnd).not.toHaveBeenCalled();
  });

  it('keeps the grab offset: pressing near the edge moves by the pointer delta', () => {
    const { params, fire } = setup([]);
    // 0.8 m right of the 2 m sofa's centre.
    fire('pointerdown', 0.8, 0.2);
    fire('pointermove', 1.8, 0.2);
    const [, x, z] = vi.mocked(params.onItemDrag).mock.lastCall!;
    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('a small touch wobble is a tap, the same distance with a mouse is a drag', () => {
    const { params, fire, scale } = setup([]);
    const sixPx = 6 / scale;
    fire('pointerdown', 0, 0, 'touch');
    fire('pointermove', sixPx, 0, 'touch');
    fire('pointerup', sixPx, 0, 'touch');
    expect(params.onItemDragStart).not.toHaveBeenCalled();
    fire('pointerdown', 0, 0);
    fire('pointermove', sixPx, 0);
    expect(params.onItemDragStart).toHaveBeenCalledTimes(1);
  });
});

describe('useCanvas2DInteraction beside the HUD', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('holds the item while the pointer is over a HUD panel and commits the last plan point (#511)', () => {
    const { params, fire } = setup([]);
    const hud = document.createElement('div');
    const canvas = params.canvasRef.current!;
    // A panel over the plan right of x = 2 m.
    const { offsetX, scale } = get2DViewTransform(W, H, params.layout);
    const edge = offsetX + (2 + params.layout.width / 2) * scale;
    (document as { elementFromPoint?: unknown }).elementFromPoint = (x: number) => (x >= edge ? hud : canvas);
    fire('pointerdown', 0, 0);
    fire('pointermove', 1, 0);
    fire('pointermove', 3, 0);
    expect(params.onItemDrag).toHaveBeenCalledTimes(1);
    expect(params.onItemDrag).toHaveBeenLastCalledWith('a', 1, 0);
    fire('pointerup', 3, 0);
    expect(params.onItemDragEnd).toHaveBeenCalledWith('a');
  });

  it('maps the pointer through the same inset transform the plan is painted with', () => {
    // jsdom's 1024×768 window is a compact viewport; a dock covers the
    // canvas's bottom 200 px.
    const dock = document.createElement('div');
    dock.setAttribute('data-scene-occluder', '');
    dock.getBoundingClientRect = () => ({ left: 0, top: H - 200, width: W, height: 200, right: W, bottom: H, x: 0, y: H - 200, toJSON: () => ({}) });
    document.body.appendChild(dock);
    const { params } = setup([]);
    const canvas = params.canvasRef.current!;
    const inset = get2DViewTransform(W, H, params.layout, undefined, { top: 0, right: 0, bottom: 200, left: 0 });
    // Item 'a' sits at the room centre, now the centre of the free 800×400.
    const cx = inset.offsetX + (params.layout.width / 2) * inset.scale;
    const cy = inset.offsetY + (params.layout.height / 2) * inset.scale;
    expect(cy).toBeCloseTo(200, 6);
    canvas.dispatchEvent(pointer('pointerdown', cx, cy));
    expect(params.onItemSelect).toHaveBeenCalledWith('a', 'replace');
    canvas.dispatchEvent(pointer('pointerup', cx, cy));
  });
});
