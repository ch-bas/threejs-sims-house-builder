// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ORBIT_LENS_SCALE, ORBIT_START, frameInRegion, houseFrameBox, type Vec3 } from '../lib/scene-insets';
import { useCameraPresets, type UseCameraPresetsOptions } from './use-camera-presets';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// #608: the camera presets, item focus and the house framing, including the
// compact (phone) framing that fits the house beside the HUD panels and the
// rules for when a resize may move the camera.

function rectOf(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: width });
  Object.defineProperty(canvas, 'clientHeight', { value: height });
  canvas.getBoundingClientRect = () => rectOf(0, 0, width, height);
  return canvas;
}

function occluder(bounds: { current: DOMRect }): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-scene-occluder', '');
  el.getBoundingClientRect = () => bounds.current;
  document.body.appendChild(el);
  return el;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

interface Rig {
  camera: PerspectiveCamera;
  controls: { target: Vector3; update: Mock<() => boolean> };
  invalidate: Mock<() => void>;
}

function rig(): Rig {
  const camera = new PerspectiveCamera(40, 1, 0.1, 1000);
  camera.position.set(...ORBIT_START);
  return { camera, controls: { target: new Vector3(), update: vi.fn(() => false) }, invalidate: vi.fn() };
}

function render(r: Rig, options: Partial<UseCameraPresetsOptions> = {}) {
  const base: UseCameraPresetsOptions = {
    cameraRef: { current: r.camera },
    controlsRef: { current: r.controls as unknown as OrbitControls },
    roomSize: 8,
    invalidate: r.invalidate,
    ...options,
  };
  return renderHook((props: Partial<UseCameraPresetsOptions>) => useCameraPresets({ ...base, ...props }), { initialProps: {} });
}

const pose = (camera: PerspectiveCamera): Vec3 => [camera.position.x, camera.position.y, camera.position.z];
const near = (actual: Vec3 | Vector3, expected: Vec3) => {
  const [x, y, z] = actual instanceof Vector3 ? [actual.x, actual.y, actual.z] : actual;
  expect(x).toBeCloseTo(expected[0], 6);
  expect(y).toBeCloseTo(expected[1], 6);
  expect(z).toBeCloseTo(expected[2], 6);
};

let saved: { width: number; height: number };
beforeEach(() => {
  saved = { width: window.innerWidth, height: window.innerHeight };
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  setViewport(saved.width, saved.height);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('applyPreset', () => {
  it('puts the camera and the orbit target where the preset says, through the orbit lens', () => {
    const r = rig();
    const { result } = render(r);
    act(() => result.current.applyPreset('top'));
    near(r.camera.position, [0, 8 * 1.6 * ORBIT_LENS_SCALE, 0.001 * ORBIT_LENS_SCALE]);
    near(r.controls.target, [0, 0, 0]);
    expect(r.controls.update).toHaveBeenCalledTimes(1);
    expect(r.invalidate).toHaveBeenCalledTimes(1);

    act(() => result.current.applyPreset('front'));
    near(r.controls.target, [0, 8 * 0.3, 0]);
    near(r.camera.position, [0, 8 * 0.3 + (8 * 0.4 - 8 * 0.3) * ORBIT_LENS_SCALE, 8 * 1.4 * ORBIT_LENS_SCALE]);
  });

  it('stands back in proportion to the room, but never closer than for a 2 m room', () => {
    const distance = (roomSize: number) => {
      const r = rig();
      const { result } = render(r, { roomSize });
      act(() => result.current.applyPreset('iso'));
      return r.camera.position.length();
    };
    expect(distance(16)).toBeCloseTo(distance(8) * 2, 6);
    expect(distance(0.5)).toBeCloseTo(distance(2), 6);
  });

  it('does nothing before the camera exists', () => {
    const r = rig();
    const { result } = render(r, { cameraRef: { current: null } });
    act(() => result.current.applyPreset('iso'));
    expect(r.controls.update).not.toHaveBeenCalled();
    expect(r.invalidate).not.toHaveBeenCalled();
  });
});

describe('focusOn', () => {
  it("lifts the camera and the orbit target onto the item's floor (#126)", () => {
    const r = rig();
    const { result } = render(r);
    act(() => result.current.focusOn({ x: 2, z: -1 }, { floorY: 3 }));
    near(r.controls.target, [2, 3, -1]);
    expect(r.camera.position.y).toBeGreaterThan(3);

    act(() => result.current.focusOn({ x: 2, z: -1 }));
    near(r.controls.target, [2, 0, -1]);
    expect(r.invalidate).toHaveBeenCalledTimes(2);
  });
});

describe('fitToRoom on a desktop window', () => {
  it('frames the building diagonal from the three-quarter view, with no projection shift', () => {
    setViewport(1440, 900);
    const r = rig();
    r.camera.setViewOffset(1440, 900, 40, 0, 1440, 900);
    const { result } = render(r, { roomSize: 10, buildingHeight: 6, canvasRef: { current: canvasOf(1440, 900) } });
    act(() => result.current.fitToRoom());
    const distance = Math.max(10 * 1.4, 6 * 2.2) * ORBIT_LENS_SCALE;
    near(r.controls.target, [0, 3, 0]);
    near(r.camera.position, [distance * 0.6, distance * 0.7 + 3, distance * 0.6]);
    expect(r.camera.view?.enabled).toBe(false);
  });

  it('keeps the start pose on load', () => {
    setViewport(1440, 900);
    vi.useFakeTimers();
    const r = rig();
    render(r, { active: true, canvasRef: { current: canvasOf(1440, 900) } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    near(pose(r.camera), ORBIT_START);
    expect(r.camera.view?.enabled ?? false).toBe(false);
  });
});

describe('framing on a compact screen (phone layout contract)', () => {
  const W = 390;
  const H = 844;
  const dock = () => occluder({ current: rectOf(0, 600, W, H) });
  const expectedFit = (camera: PerspectiveCamera, region: { left: number; top: number; right: number; bottom: number }, direction: Vec3) =>
    frameInRegion({
      canvasWidth: W,
      canvasHeight: H,
      region,
      fovDeg: camera.fov,
      ...houseFrameBox({ width: 8, depth: 8, height: 3, roof: null }),
      direction,
    });

  it('FIT frames the house in the region the HUD leaves free, shifting the projection to its middle', () => {
    setViewport(W, H);
    dock();
    const r = rig();
    const { result } = render(r, { canvasRef: { current: canvasOf(W, H) } });
    act(() => result.current.fitToRoom());
    const fit = expectedFit(r.camera, { left: 0, top: 0, right: W, bottom: 600 }, [0.6, 0.7, 0.6]);
    near(pose(r.camera), fit.position);
    near(r.controls.target, fit.target);
    expect(r.camera.view).toMatchObject({ enabled: true, fullWidth: W, fullHeight: H, offsetX: fit.offsetX, offsetY: fit.offsetY });
  });

  it('frames the house from the front on load, and again after a HUD change while the camera is untouched', () => {
    setViewport(W, H);
    vi.useFakeTimers();
    const panel = { current: rectOf(0, 600, W, H) };
    occluder(panel);
    const r = rig();
    render(r, { active: true, canvasRef: { current: canvasOf(W, H) } });
    near(pose(r.camera), expectedFit(r.camera, { left: 0, top: 0, right: W, bottom: 600 }, [0, 1, 1]).position);

    const loaded = pose(r.camera);

    // The panel becomes a side panel: the untouched camera follows the new
    // free region.
    panel.current = rectOf(250, 0, W, H);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(200);
    });
    const moved = expectedFit(r.camera, { left: 0, top: 0, right: 250, bottom: H }, [0, 1, 1]).position;
    expect(moved).not.toEqual(loaded);
    near(pose(r.camera), moved);
  });

  it('leaves a camera the user moved where it is, and only re-centres the projection shift', () => {
    setViewport(W, H);
    vi.useFakeTimers();
    const panel = { current: rectOf(0, 600, W, H) };
    occluder(panel);
    const r = rig();
    render(r, { active: true, canvasRef: { current: canvasOf(W, H) } });
    r.camera.position.set(5, 5, 5);
    const offsetBefore = r.camera.view!.offsetY;

    panel.current = rectOf(0, 400, W, H);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(200);
    });
    near(pose(r.camera), [5, 5, 5]);
    expect(r.camera.view?.enabled).toBe(true);
    expect(r.camera.view!.offsetY).not.toBe(offsetBefore);
  });

  it('never moves the camera under a finger: the re-frame waits for the last pointer to lift', () => {
    setViewport(W, H);
    vi.useFakeTimers();
    const panel = { current: rectOf(0, 600, W, H) };
    occluder(panel);
    const r = rig();
    render(r, { active: true, canvasRef: { current: canvasOf(W, H) } });
    const loaded = pose(r.camera);

    const pointer = (type: string, pointerId: number) => {
      const event = new Event(type);
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      window.dispatchEvent(event);
    };
    panel.current = rectOf(250, 0, W, H);
    act(() => {
      pointer('pointerdown', 1);
      pointer('pointerdown', 2);
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(200);
    });
    near(pose(r.camera), loaded);
    act(() => {
      pointer('pointerup', 1);
      vi.advanceTimersByTime(200);
    });
    near(pose(r.camera), loaded);
    act(() => {
      pointer('pointerup', 2);
      vi.advanceTimersByTime(200);
    });
    const moved = expectedFit(r.camera, { left: 0, top: 0, right: 250, bottom: H }, [0, 1, 1]).position;
    expect(moved).not.toEqual(loaded);
    near(pose(r.camera), moved);
  });

  it('drops the projection shift while walking through, and puts it back after', () => {
    setViewport(W, H);
    dock();
    const r = rig();
    const { result, rerender } = render(r, { canvasRef: { current: canvasOf(W, H) } });
    act(() => result.current.fitToRoom());
    const shifted = { ...r.camera.view! };
    rerender({ walkthroughActive: true });
    expect(r.camera.view?.enabled).toBe(false);
    rerender({ walkthroughActive: false });
    expect(r.camera.view).toMatchObject({ enabled: true, offsetX: shifted.offsetX, offsetY: shifted.offsetY });
  });
});
