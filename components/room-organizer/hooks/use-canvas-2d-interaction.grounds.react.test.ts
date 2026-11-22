// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get2DViewTransform } from '../canvas-2d/render';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { GROUND_REFUSAL_MESSAGES } from '../lib/grounds';
import { setGroundDrawKind } from './ground-draw';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useCanvas2DInteraction, type UseCanvas2DInteractionParams } from './use-canvas-2d-interaction';
import { layoutStore } from './use-layout-store';

const W = 800;
const H = 600;

function pointer(type: string, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

function setup(overrides: Partial<UseCanvas2DInteractionParams> = {}) {
  const floor = makeFloor({ items: [makeItem({ id: 'chair', position: { x: 3, z: 0 } })] });
  const layout = makeLayout({ floors: [floor] });
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: W });
  Object.defineProperty(canvas, 'clientHeight', { value: H });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  const transform = get2DViewTransform(W, H, layout);
  const params: UseCanvas2DInteractionParams = {
    enabled: true,
    canvasRef: { current: canvas },
    layout,
    activeFloor: floor,
    view: { showMeasurements: false, showWiFiSignals: false, showHeatmap: false, showFloorBelow: false, drawZoneMode: false },
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
    onZoneRefused: vi.fn(),
    onGroundAdded: vi.fn(),
    ...overrides,
  };
  renderHook(() => useCanvas2DInteraction(params));
  const fire = (type: string, x: number, z: number) => {
    canvas.dispatchEvent(pointer(type, transform.offsetX + (x + layout.width / 2) * transform.scale, transform.offsetY + (z + layout.height / 2) * transform.scale));
  };
  return { params, fire };
}

describe('useCanvas2DInteraction garden surfaces (#924)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });
  afterEach(() => {
    setGroundDrawKind(null);
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a drag lays the picked kind with one dispatch, selecting nothing', () => {
    const addGround = vi.spyOn(layoutStore.getState().actions, 'addGround').mockImplementation(() => 'g');
    setGroundDrawKind('deck');
    const { params, fire } = setup();
    fire('pointerdown', 3, -1);
    fire('pointermove', 5, 0);
    fire('pointermove', 6, 1);
    expect(addGround).not.toHaveBeenCalled();
    fire('pointerup', 6, 1);
    expect(addGround).toHaveBeenCalledTimes(1);
    // From inside the house: the part outside, flush to the east wall.
    expect(addGround.mock.lastCall![0]).toEqual({ kind: 'deck', x: 4, z: -1, w: 2, d: 2 });
    expect(params.onItemSelect).not.toHaveBeenCalled();
    // The shared placement cue, with the new surface's id.
    expect(params.onGroundAdded).toHaveBeenCalledWith('g');
  });

  it('lays nothing when the tool ended mid-drag', () => {
    const addGround = vi.spyOn(layoutStore.getState().actions, 'addGround').mockImplementation(() => 'g');
    setGroundDrawKind('paving');
    const { params, fire } = setup();
    fire('pointerdown', 4.5, -1);
    fire('pointermove', 6, 1);
    setGroundDrawKind(null);
    fire('pointerup', 6, 1);
    expect(addGround).not.toHaveBeenCalled();
    expect(params.onZoneRefused).not.toHaveBeenCalled();
  });

  it('says why a drag on the house lays nothing', () => {
    const addGround = vi.spyOn(layoutStore.getState().actions, 'addGround').mockImplementation(() => 'g');
    setGroundDrawKind('paving');
    const { params, fire } = setup();
    fire('pointerdown', -2, -2);
    fire('pointermove', 2, 2);
    fire('pointerup', 2, 2);
    expect(addGround).not.toHaveBeenCalled();
    expect(params.onZoneRefused).toHaveBeenCalledWith(GROUND_REFUSAL_MESSAGES['on-house']);
  });

  it('is off in EXPLORE, where the press selects', () => {
    const addGround = vi.spyOn(layoutStore.getState().actions, 'addGround').mockImplementation(() => 'g');
    setGroundDrawKind('lawn');
    const { params, fire } = setup({ exploring: true });
    fire('pointerdown', 3, 0);
    fire('pointermove', 3.5, 1);
    fire('pointerup', 3.5, 1);
    expect(addGround).not.toHaveBeenCalled();
    expect(params.onItemSelect).toHaveBeenCalled();
  });
});
