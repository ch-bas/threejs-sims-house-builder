// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_PLAN_ZOOM, planZoomOf, setPlanZoom, zoomPlanAbout } from '../canvas-2d/plan-zoom';
import { get2DViewTransform } from '../canvas-2d/render';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useCanvas2DInteraction, type UseCanvas2DInteractionParams } from './use-canvas-2d-interaction';

const W = 800;
const H = 600;

/** The measure tool on the plan (#921): a chair to snap to. */
function setup(overrides: Partial<UseCanvas2DInteractionParams> = {}) {
  const floor = makeFloor({
    items: [makeItem({ id: 'chair', width: 0.4, depth: 0.4, position: { x: 2, z: 0 } })],
  });
  const layout = makeLayout({ floors: [floor] });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: W });
  Object.defineProperty(canvas, 'clientHeight', { value: H });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  const params: UseCanvas2DInteractionParams = {
    enabled: true,
    canvasRef: { current: canvas },
    layout,
    activeFloor: floor,
    view: { showMeasurements: false, showWiFiSignals: false, showHeatmap: false, showFloorBelow: false, drawZoneMode: false, measurementMode: true },
    selectedItemId: null,
    extraSelectedIds: new Set(),
    allSelectedIds: new Set(),
    onItemSelect: vi.fn(),
    onDeselect: vi.fn(),
    snapPosition: (_id, x, z) => ({ x, z }),
    onItemDragStart: vi.fn(),
    onItemDrag: vi.fn(),
    onItemDragEnd: vi.fn(),
    onItemDragCancel: vi.fn(),
    onMeasurePoint: vi.fn(),
    ...overrides,
  };
  renderHook(() => useCanvas2DInteraction(params));
  const tap = (x: number, z: number, pointerType: 'mouse' | 'touch' = 'mouse') => {
    const t = get2DViewTransform(W, H, layout, undefined, undefined, undefined, planZoomOf(canvas));
    const clientX = t.offsetX + (x + layout.width / 2) * t.scale;
    const clientY = t.offsetY + (z + layout.height / 2) * t.scale;
    for (const type of ['pointerdown', 'pointerup']) {
      canvas.dispatchEvent(new PointerEvent(type, { clientX, clientY, pointerId: 1, pointerType, isPrimary: true, button: 0, bubbles: true }));
    }
  };
  return { params, canvas, tap };
}

describe('measure taps on the plan (#921)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a tap places a snapped point, and one with nothing near where it lands', () => {
    const { params, tap } = setup();
    tap(2.05, 0.05);
    expect(params.onMeasurePoint).toHaveBeenCalledWith({ point: { x: 2, z: 0 }, kind: 'centre' });
    tap(-1, 1.5);
    expect(params.onMeasurePoint).toHaveBeenLastCalledWith({ point: { x: -1, z: 1.5 }, kind: 'none' });
    expect(params.onDeselect).not.toHaveBeenCalled();
  });

  it('a finger’s double tap on empty floor goes back to the fit', () => {
    const { params, canvas, tap } = setup();
    setPlanZoom(canvas, zoomPlanAbout(get2DViewTransform(W, H, params.layout), NO_PLAN_ZOOM, 2, { x: W / 2, y: H / 2 }, { width: W, height: H }));
    tap(-1, 1.5, 'touch');
    expect(planZoomOf(canvas).zoom).toBe(2);
    tap(-1, 1.5, 'touch');
    expect(planZoomOf(canvas)).toBe(NO_PLAN_ZOOM);
    expect(params.onMeasurePoint).toHaveBeenCalledTimes(1);
  });
});
