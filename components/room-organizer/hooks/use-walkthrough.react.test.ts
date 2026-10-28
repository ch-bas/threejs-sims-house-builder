// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalkthrough, type UseWalkthroughOptions, type WalkthroughBuilding } from './use-walkthrough';
import type { FurnitureItem } from '../lib/types';

// Headless browsers can't lock the pointer, so the controls are stubbed: the
// test engages the lock the way the browser would report it.
const controlsStub = vi.hoisted(() => {
  class FakePointerLockControls {
    isLocked = false;
    private listeners = new Map<string, Set<() => void>>();
    constructor(
      public camera: unknown,
      public domElement: unknown
    ) {
      controlsStub.last = this;
    }
    addEventListener(type: string, fn: () => void): void {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: () => void): void {
      this.listeners.get(type)?.delete(fn);
    }
    emit(type: 'lock' | 'unlock'): void {
      this.isLocked = type === 'lock';
      for (const fn of this.listeners.get(type) ?? []) fn();
    }
    unlock(): void {
      if (this.isLocked) this.emit('unlock');
    }
    disconnect(): void {}
  }
  return { Controls: FakePointerLockControls, last: null as InstanceType<typeof FakePointerLockControls> | null };
});

vi.mock('three/examples/jsm/controls/PointerLockControls.js', () => ({ PointerLockControls: controlsStub.Controls }));

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: overrides.type, name: overrides.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...overrides };
}

const FRONT_DOOR = item({ id: 'front', type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: -4 } });
const SOFA = item({ id: 'sofa', type: 'sofa', name: 'Sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -2 } });
const TV = item({ id: 'tv', type: 'tv', width: 1.5, depth: 0.4, height: 0.5, position: { x: 0, z: 1 }, rotation: Math.PI });
const STAIRS = item({ id: 'stairs', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 3.2, z: 0.3 } });

const building = (ground: FurnitureItem[], upper: FurnitureItem[] = []): WalkthroughBuilding => ({
  width: 8,
  depth: 8,
  floors: [{ items: ground }, { items: upper }],
});

let clock = 0;
let frameQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  clock = 0;
  frameQueue = [];
  controlsStub.last = null;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return frameQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run `count` animation frames of `ms` each. */
function frames(count: number, ms = 16): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      clock += ms;
      const queue = frameQueue;
      frameQueue = [];
      for (const cb of queue) cb(clock);
    }
  });
}

function key(type: 'keydown' | 'keyup', code: string, keyName = code): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { code, key: keyName, bubbles: true }));
  });
}

function pointer(target: EventTarget, type: string, init: { pointerType: string; pointerId: number; clientX: number; clientY: number }): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  act(() => {
    target.dispatchEvent(event);
  });
}

async function setup(b: WalkthroughBuilding, extra: Partial<UseWalkthroughOptions> = {}) {
  // The app's orbit camera: 75°, near 0.3 (hooks/use-three-scene).
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.3, 1000);
  camera.position.set(0, 8, 8);
  const canvas = document.createElement('canvas');
  const orbit = { enabled: true, target: new THREE.Vector3(0, 1.5, 0) };
  const onExit = vi.fn();
  const onFloorChange = vi.fn();
  const props: UseWalkthroughOptions = {
    enabled: true,
    canvasRef: { current: canvas },
    threeModuleRef: { current: THREE as unknown as typeof import('../three/three-runtime') },
    cameraRef: { current: camera },
    orbitRef: { current: orbit as never },
    building: b,
    activeFloorIndex: 0,
    onExit,
    onFloorChange,
    ...extra,
  };
  const hook = renderHook((p: UseWalkthroughOptions) => useWalkthrough(p), { initialProps: props });
  await waitFor(() => expect(controlsStub.last).not.toBeNull());
  const controls = controlsStub.last!;
  const lock = () => act(() => controls.emit('lock'));
  const facing = () => camera.getWorldDirection(new THREE.Vector3());
  return { ...hook, props, camera, canvas, orbit, onExit, onFloorChange, controls, lock, facing };
}

describe('useWalkthrough — spawn and HUD state (#463a, #454)', () => {
  it('spawns inside the front door looking into the house, with orbit off', async () => {
    const { camera, orbit, facing, result } = await setup(building([FRONT_DOOR]));
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(camera.position.y).toBeCloseTo(1.6, 6);
    expect(camera.position.z).toBeCloseTo(-3.1, 6);
    expect(facing().z).toBeCloseTo(1, 6);
    expect(orbit.enabled).toBe(false);
    expect(result.current.locked).toBe(false);
  });

  it('reports the lock, and puts the orbit pose back on exit', async () => {
    const { result, lock, controls, rerender, props, camera, orbit } = await setup(building([FRONT_DOOR]));
    lock();
    expect(result.current.locked).toBe(true);
    act(() => controls.emit('unlock'));
    expect(result.current.locked).toBe(false);
    rerender({ ...props, enabled: false });
    expect(camera.position.toArray()).toEqual([0, 8, 8]);
    expect(orbit.enabled).toBe(true);
  });

  it('pulls the near plane in while walking and puts it back (#446)', async () => {
    const { camera, rerender, props } = await setup(building([FRONT_DOOR]));
    expect(camera.near).toBe(0.1);
    rerender({ ...props, enabled: false });
    expect(camera.near).toBe(0.3);
  });

  it('on exit after a floor change, the camera moves with the orbit target (#446)', async () => {
    const { camera, orbit, rerender, props } = await setup(building([FRONT_DOOR]));
    // The orbit target follows the active storey mid-walk (useCameraTargetOnStorey).
    orbit.target.y += 3;
    rerender({ ...props, enabled: false });
    expect(camera.position.toArray()).toEqual([0, 11, 8]);
  });

  it('Esc leaves only once the pointer is released', async () => {
    const { onExit, lock, controls } = await setup(building([FRONT_DOOR]));
    lock();
    key('keydown', 'Escape', 'Escape');
    expect(onExit).not.toHaveBeenCalled();
    act(() => controls.emit('unlock'));
    key('keydown', 'Escape', 'Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('useWalkthrough — walking (#446)', () => {
  it("doesn't walk before the pointer is locked, then walks with W", async () => {
    const { camera, lock } = await setup(building([FRONT_DOOR]));
    key('keydown', 'KeyW', 'w');
    frames(20);
    expect(camera.position.z).toBeCloseTo(-3.1, 6);
    lock();
    frames(30);
    key('keyup', 'KeyW', 'w');
    // 30 frames of 16 ms at 3 m/s.
    expect(camera.position.z).toBeCloseTo(-3.1 + 1.44, 1);
  });

  it('walks out of the front door onto the lot', async () => {
    const { camera, lock } = await setup(building([FRONT_DOOR]));
    lock();
    key('keydown', 'KeyS', 's');
    frames(60);
    key('keyup', 'KeyS', 's');
    expect(camera.position.z).toBeLessThan(-5);
    expect(camera.position.y).toBeCloseTo(1.6, 6);
  });

  it('PgUp lands at the top of the stairs; walking down reports the ground floor; the echo keeps the walker', async () => {
    const { camera, lock, rerender, props, onFloorChange, facing } = await setup(building([STAIRS]));
    rerender({ ...props, activeFloorIndex: 1 });
    expect(camera.position.y).toBeCloseTo(4.6, 6);
    expect(camera.position.z).toBeGreaterThan(1.5);
    // Turn round to face down the flight and walk.
    act(() => {
      camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1);
    });
    expect(facing().z).toBeCloseTo(-1, 6);
    lock();
    key('keydown', 'KeyW', 'w');
    frames(70);
    key('keyup', 'KeyW', 'w');
    expect(onFloorChange).toHaveBeenCalledWith(0);
    const z = camera.position.z;
    // React echoes the change: no teleport.
    rerender({ ...props, activeFloorIndex: 0 });
    expect(camera.position.z).toBe(z);
    frames(60);
    expect(camera.position.y).toBeCloseTo(1.6, 2);
  });

  it('a touch drag turns the head and the stick walks, without pointer lock', async () => {
    const { camera, canvas, facing, result } = await setup(building([FRONT_DOOR]));
    const before = facing();
    pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 200, clientY: 300 });
    pointer(window, 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 300 });
    pointer(window, 'pointerup', { pointerType: 'touch', pointerId: 7, clientX: 100, clientY: 300 });
    expect(facing().angleTo(before)).toBeCloseTo(0.5, 2);
    act(() => result.current.setStick(0, 1));
    frames(20);
    act(() => result.current.setStick(0, 0));
    expect(camera.position.distanceTo(new THREE.Vector3(0, 1.6, -3.1))).toBeGreaterThan(0.5);
  });
});

describe('useWalkthrough — sitting (#463b)', () => {
  it('offers the sofa, sits facing the TV with E, and stands back up on a step', async () => {
    const { camera, lock, result, facing } = await setup(building([FRONT_DOOR, SOFA, TV]));
    lock();
    frames(10, 20);
    expect(result.current.seatName).toBe('Sofa');
    key('keydown', 'KeyE', 'e');
    frames(30);
    expect(result.current.seated).toBe(true);
    expect(result.current.seatName).toBeNull();
    expect(camera.position.y).toBeCloseTo(0.8 * 0.65 + 0.72, 6);
    expect(camera.position.z).toBeCloseTo(-2 + 0.09, 6);
    expect(facing().z).toBeGreaterThan(0.9);
    // A step stands the walker up where it stood.
    key('keydown', 'KeyW', 'w');
    frames(2);
    key('keyup', 'KeyW', 'w');
    frames(30);
    expect(result.current.seated).toBe(false);
    expect(camera.position.y).toBeCloseTo(1.6, 6);
    expect(camera.position.z).toBeCloseTo(-3.1, 6);
  });

  it('keys typed into a text field never reach the walker on a touch walk (#558)', async () => {
    const { camera, canvas, onExit, result } = await setup(building([FRONT_DOOR, SOFA, TV]));
    // A tap: touch walking, no pointer lock.
    pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 });
    pointer(window, 'pointerup', { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 });
    const field = document.createElement('input');
    document.body.appendChild(field);
    const typeInto = (code: string, keyName: string) =>
      act(() => {
        field.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName, bubbles: true }));
      });
    frames(10, 20);
    expect(result.current.seatName).toBe('Sofa');
    typeInto('Escape', 'Escape');
    expect(onExit).not.toHaveBeenCalled();
    typeInto('KeyE', 'e');
    frames(30);
    expect(result.current.seated).toBe(false);
    // `w` in the field leaves touch walking on: the stick still walks.
    // A `w` typed into the field is not held down as a walking key.
    typeInto('KeyW', 'w');
    const before = camera.position.clone();
    act(() => result.current.setStick(0, 0.01));
    frames(10);
    act(() => result.current.setStick(0, 0));
    expect(camera.position.distanceTo(before)).toBeLessThan(0.05);
    // Outside the field Escape still leaves.
    field.remove();
    key('keydown', 'Escape', 'Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("E does nothing before the pointer is locked", async () => {
    const { result } = await setup(building([FRONT_DOOR, SOFA, TV]));
    key('keydown', 'KeyE', 'e');
    frames(30);
    expect(result.current.seated).toBe(false);
  });
});
