// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get2DViewTransform } from '../canvas-2d/render';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { PLAN_GESTURE_ATTR } from './scene-occluders';
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

  it('holds the item while the pointer is over a HUD panel, and a release there undoes the drag (#511)', () => {
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
    expect(params.onItemDragEnd).not.toHaveBeenCalled();
    expect(params.onItemDragCancel).toHaveBeenCalledWith('a', { restore: true });
  });

  it('a release back on the plan commits as usual', () => {
    const { params, fire } = setup([]);
    const canvas = params.canvasRef.current!;
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => canvas;
    fire('pointerdown', 0, 0);
    fire('pointermove', 1, 0);
    fire('pointerup', 1, 0);
    expect(params.onItemDragEnd).toHaveBeenCalledWith('a');
    expect(params.onItemDragCancel).not.toHaveBeenCalled();
  });

  it('a second finger cancels the drag and restores the item', () => {
    const { params, fire } = setup([]);
    const canvas = params.canvasRef.current!;
    fire('pointerdown', 0, 0, 'touch');
    fire('pointermove', 1, 0, 'touch');
    expect(params.onItemDragStart).toHaveBeenCalledWith('a');
    const second = new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 2, pointerType: 'touch', isPrimary: false, button: 0, bubbles: true });
    canvas.dispatchEvent(second);
    expect(params.onItemDragCancel).toHaveBeenCalledWith('a', { restore: true });
    // The first finger keeps moving and lifts: nothing more happens.
    fire('pointermove', 2, 0, 'touch');
    fire('pointerup', 2, 0, 'touch');
    expect(params.onItemDrag).toHaveBeenCalledTimes(1);
    expect(params.onItemDragEnd).not.toHaveBeenCalled();
  });

  it('a later finger of a multi-touch gesture never selects', () => {
    const { params } = setup([]);
    const canvas = params.canvasRef.current!;
    const t = get2DViewTransform(W, H, params.layout);
    const later = new PointerEvent('pointerdown', { clientX: t.offsetX + (params.layout.width / 2) * t.scale, clientY: t.offsetY + (params.layout.height / 2) * t.scale, pointerId: 3, pointerType: 'touch', isPrimary: false, button: 0, bubbles: true });
    canvas.dispatchEvent(later);
    expect(params.onItemSelect).not.toHaveBeenCalled();
    expect(params.onDeselect).not.toHaveBeenCalled();
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

describe('useCanvas2DInteraction text selection (#442)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
  });

  it('flags the page for no text selection from an item press until the release', () => {
    const { fire } = setup([]);
    fire('pointerdown', 0, 0);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(true);
    fire('pointermove', 1, 0);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(true);
    fire('pointerup', 1, 0);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(false);
  });

  it('flags a zone drag too, and a press on empty floor not at all', () => {
    const { params, fire } = setup([]);
    fire('pointerdown', -3, -3);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(false);
    fire('pointerup', -3, -3);
    params.view = { ...params.view, drawZoneMode: true };
    fire('pointerdown', -3, -3);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(true);
    fire('pointercancel', -3, -3);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(false);
  });

  it('clears the flag when the view unmounts mid-press', () => {
    const { fire } = setup([]);
    fire('pointerdown', 0, 0);
    cleanup();
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(false);
  });
});

describe('useCanvas2DInteraction outdoor items (#381)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('selects a tree outside the walls through the content-fitted transform', () => {
    const tree = makeItem({ id: 'tree', width: 1.4, depth: 1.4, position: { x: 7.5, z: 3 } });
    const floor = makeFloor({ items: [tree] });
    const layout = makeLayout({ floors: [floor] });
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W });
    Object.defineProperty(canvas, 'clientHeight', { value: H });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
    const onItemSelect = vi.fn();
    const params: UseCanvas2DInteractionParams = {
      enabled: true,
      canvasRef: { current: canvas },
      layout,
      activeFloor: floor,
      view: { showMeasurements: false, showWiFiSignals: false, showHeatmap: false, drawZoneMode: false },
      selectedItemId: null,
      extraSelectedIds: new Set(),
      allSelectedIds: new Set(),
      onItemSelect,
      onDeselect: vi.fn(),
      snapPosition: (_id, x, z) => ({ x, z }),
      onItemDragStart: vi.fn(),
      onItemDrag: vi.fn(),
      onItemDragEnd: vi.fn(),
      onItemDragCancel: vi.fn(),
    };
    renderHook(() => useCanvas2DInteraction(params));
    // The room-only fit would put the tree past the canvas's right edge.
    const roomOnly = get2DViewTransform(W, H, layout);
    expect(roomOnly.offsetX + (7.5 + 4) * roomOnly.scale).toBeGreaterThan(W);
    const t = get2DViewTransform(W, H, layout, undefined, undefined, { minX: -4, minZ: -4, maxX: 8.2, maxZ: 4 });
    const cx = t.offsetX + (7.5 + 4) * t.scale;
    const cy = t.offsetY + (3 + 4) * t.scale;
    canvas.dispatchEvent(pointer('pointerdown', cx, cy));
    expect(onItemSelect).toHaveBeenCalledWith('tree', 'replace');
    canvas.dispatchEvent(pointer('pointerup', cx, cy));
  });
});

describe('useCanvas2DInteraction off-plan markers and lost pointers (#381 review)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute(PLAN_GESTURE_ATTR);
  });

  it('a press on a far item\'s marker selects that item', () => {
    const far = makeItem({ id: 'far', position: { x: 40, z: 0 } });
    const floor = makeFloor({ items: [far] });
    const layout = makeLayout({ floors: [floor] });
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W });
    Object.defineProperty(canvas, 'clientHeight', { value: H });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
    const onItemSelect = vi.fn();
    const onDeselect = vi.fn();
    const params: UseCanvas2DInteractionParams = {
      enabled: true,
      canvasRef: { current: canvas },
      layout,
      activeFloor: floor,
      view: { showMeasurements: false, showWiFiSignals: false, showHeatmap: false, drawZoneMode: false },
      selectedItemId: null,
      extraSelectedIds: new Set(),
      allSelectedIds: new Set(),
      onItemSelect,
      onDeselect,
      snapPosition: (_id, x, z) => ({ x, z }),
      onItemDragStart: vi.fn(),
      onItemDrag: vi.fn(),
      onItemDragEnd: vi.fn(),
      onItemDragCancel: vi.fn(),
    };
    renderHook(() => useCanvas2DInteraction(params));
    // The tree is left off the fit: the plan is the room, the marker on its east edge.
    const t = get2DViewTransform(W, H, layout);
    const x = t.offsetX + 8 * t.scale - 14;
    const y = t.offsetY + 4 * t.scale;
    canvas.dispatchEvent(pointer('pointerdown', x, y));
    expect(onItemSelect).toHaveBeenCalledWith('far', 'replace');
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('losing the window mid-drag undoes it and clears the gesture flag', () => {
    const { params, fire } = setup([]);
    fire('pointerdown', 0, 0);
    fire('pointermove', 1, 0);
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(document.documentElement.hasAttribute(PLAN_GESTURE_ATTR)).toBe(false);
    expect(params.onItemDragCancel).toHaveBeenCalledWith('a', { restore: true });
  });
});
