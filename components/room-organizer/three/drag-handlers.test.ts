// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDragHandlers, dragThresholdPx, keepsSelectionOnPress, type SceneEventHandlers } from './drag-handlers';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const SIZE = 200;

function pointer(type: string, clientX: number, clientY: number, init: { pointerType?: string; ctrlKey?: boolean } = {}): MouseEvent {
  const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true, ctrlKey: init.ctrlKey ?? false });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return event;
}

/** A top-down camera over two 1 m boxes: 'a' at the origin, 'b' at x = 2. */
function setup(selected: string[]) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0, toJSON: () => ({}) });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const groups = new Map<string, THREE.Group>();
  for (const [id, x] of [['a', 0], ['b', 2]] as const) {
    const group = new THREE.Group();
    group.userData = { type: 'furniture', id };
    group.position.set(x, 0, 0);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1)));
    scene.add(group);
    groups.set(id, group);
  }
  scene.updateMatrixWorld(true);
  const handlers: SceneEventHandlers = {
    selectedIds: new Set(selected),
    onItemSelect: vi.fn(),
    onItemDragStart: vi.fn(),
    onItemDrag: vi.fn(),
    onItemDragEnd: vi.fn(),
    onItemDragCancel: vi.fn(),
    snapPosition: (_id, x, z) => ({ x, z }),
  };
  const controls = { enabled: true } as unknown as OrbitControls;
  const detach = attachDragHandlers({
    THREE,
    canvas,
    camera,
    scene,
    controls,
    markDirty: vi.fn(),
    handlersRef: { current: handlers },
  });
  // World floor point under a client position, for checking the grab offset.
  const raycaster = new THREE.Raycaster();
  const worldAt = (clientX: number, clientY: number): THREE.Vector3 => {
    raycaster.setFromCamera(new THREE.Vector2((clientX / SIZE) * 2 - 1, -(clientY / SIZE) * 2 + 1), camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    return hit;
  };
  return { canvas, handlers, groups, controls, detach, worldAt };
}

describe('drag-handlers selection on press (#291)', () => {
  let detach: (() => void) | null = null;
  afterEach(() => detach?.());

  it('keepsSelectionOnPress only for a plain press on a multi-selection member', () => {
    const both = new Set(['a', 'b']);
    expect(keepsSelectionOnPress('replace', 'a', both)).toBe(true);
    expect(keepsSelectionOnPress('replace', 'c', both)).toBe(false);
    expect(keepsSelectionOnPress('toggle', 'a', both)).toBe(false);
    expect(keepsSelectionOnPress('single', 'a', both)).toBe(false);
    expect(keepsSelectionOnPress('replace', 'a', new Set(['a']))).toBe(false);
    expect(keepsSelectionOnPress('replace', 'a', undefined)).toBe(false);
  });

  it('a press on a selected member keeps the multi-selection and arms a group drag', () => {
    const t = setup(['a', 'b']);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(t.handlers.onItemSelect).not.toHaveBeenCalled();
    t.canvas.dispatchEvent(pointer('pointermove', 120, 100));
    expect(t.handlers.onItemDragStart).toHaveBeenCalledWith('a');
    t.canvas.dispatchEvent(pointer('pointerup', 120, 100));
    expect(t.handlers.onItemDragEnd).toHaveBeenCalledWith('a');
    // The drag never collapsed the selection.
    expect(t.handlers.onItemSelect).not.toHaveBeenCalled();
  });

  it('a click without movement on a selected member narrows on release', () => {
    const t = setup(['a', 'b']);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    t.canvas.dispatchEvent(pointer('pointerup', 101, 100));
    expect(t.handlers.onItemSelect).toHaveBeenCalledWith('a', 'replace');
    expect(t.handlers.onItemDragStart).not.toHaveBeenCalled();
  });

  it('an unselected item still selects on press', () => {
    const t = setup(['b']);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(t.handlers.onItemSelect).toHaveBeenCalledWith('a', 'replace');
    t.canvas.dispatchEvent(pointer('pointerup', 100, 100));
    expect(t.handlers.onItemSelect).toHaveBeenCalledTimes(1);
  });
});

describe('drag-handlers cancel, grab offset and touch threshold (#292)', () => {
  let detach: (() => void) | null = null;
  afterEach(() => detach?.());

  it('pointercancel aborts with restore instead of committing', () => {
    const t = setup([]);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    t.canvas.dispatchEvent(pointer('pointermove', 130, 100));
    t.canvas.dispatchEvent(pointer('pointercancel', 130, 100));
    expect(t.handlers.onItemDragCancel).toHaveBeenCalledWith('a', { restore: true });
    expect(t.handlers.onItemDragEnd).not.toHaveBeenCalled();
    expect(t.controls.enabled).toBe(true);
    // A later pointerup is a no-op.
    t.canvas.dispatchEvent(pointer('pointerup', 130, 100));
    expect(t.handlers.onItemDragEnd).not.toHaveBeenCalled();
  });

  it('pointercancel before the threshold neither selects nor drags', () => {
    const t = setup(['a', 'b']);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    t.canvas.dispatchEvent(pointer('pointercancel', 100, 100));
    expect(t.handlers.onItemSelect).not.toHaveBeenCalled();
    expect(t.handlers.onItemDragCancel).not.toHaveBeenCalled();
  });

  it('keeps the grab offset: the item moves by the pointer delta, not to the pointer', () => {
    const t = setup([]);
    detach = t.detach;
    // Press near the box's corner, well off its centre.
    const down = t.worldAt(108, 108);
    expect(Math.abs(down.x)).toBeGreaterThan(0.2);
    t.canvas.dispatchEvent(pointer('pointerdown', 108, 108));
    t.canvas.dispatchEvent(pointer('pointermove', 140, 108));
    const moved = t.worldAt(140, 108);
    const group = t.groups.get('a')!;
    expect(group.position.x).toBeCloseTo(moved.x - down.x, 6);
    expect(group.position.z).toBeCloseTo(moved.z - down.z, 6);
    expect(t.handlers.onItemDrag).toHaveBeenLastCalledWith('a', group.position.x, group.position.z);
  });

  it('touch needs a wider radius than the mouse before a drag starts', () => {
    expect(dragThresholdPx('touch')).toBeGreaterThan(dragThresholdPx('mouse'));
    const t = setup([]);
    detach = t.detach;
    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100, { pointerType: 'touch' }));
    t.canvas.dispatchEvent(pointer('pointermove', 106, 100, { pointerType: 'touch' }));
    expect(t.handlers.onItemDragStart).not.toHaveBeenCalled();
    t.canvas.dispatchEvent(pointer('pointerup', 106, 100, { pointerType: 'touch' }));
    expect(t.handlers.onItemDragEnd).not.toHaveBeenCalled();

    t.canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    t.canvas.dispatchEvent(pointer('pointermove', 106, 100));
    expect(t.handlers.onItemDragStart).toHaveBeenCalledTimes(1);
  });
});
