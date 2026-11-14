// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { createNpcHandOff } from '../lib/npc-bodies';
import { useNpcs, type UseNpcsOptions } from './use-npcs';
import type { RoomLayout } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threeModuleRef = { current: THREE as unknown as typeof import('../three/three-runtime') };

function walkersIn(scene: THREE.Scene): THREE.Object3D[] {
  return scene.children.filter((child) => child.userData.type === 'npc');
}

/** On the floor at `y`, give or take the stride's bob. */
function standsAt(walker: THREE.Object3D, y: number): boolean {
  return walker.position.y >= y && walker.position.y < y + 0.03;
}

/** The same figures, by identity. */
function sameWalkers(a: readonly THREE.Object3D[], b: readonly THREE.Object3D[]): boolean {
  return a.length === b.length && a.every((walker, index) => walker === b[index]);
}

describe('walkers spawned while the frame budget is paused (#671 review)', () => {
  it('are posed, shadowed and painted at once, without waiting for a budget step', () => {
    const scene = new THREE.Scene();
    const invalidate = vi.fn();
    const requestShadowUpdate = vi.fn();
    // A budget that never ticks: a hidden tab.
    const steps: Array<(delta: number) => boolean> = [];
    const addDecorativeStep = vi.fn((step: (delta: number) => boolean) => {
      steps.push(step);
      return () => {};
    });
    renderHook(() =>
      useNpcs({
        enabled: true,
        threeModuleRef,
        sceneRef: { current: scene },
        building: makeLayout({ width: 6, height: 6 }),
        shownFrom: 0,
        shownTo: 0,
        invalidate,
        requestShadowUpdate,
        addDecorativeStep,
      })
    );
    expect(walkersIn(scene)).toHaveLength(3);
    expect(requestShadowUpdate).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    // The walk itself still runs on the budget.
    expect(steps).toHaveLength(1);
  });
});

describe('walkers per storey (#580)', () => {
  const twoStoreys = makeLayout({
    floors: [makeFloor({ id: 'ground' }), makeFloor({ id: 'upper', name: 'Upper' })],
  });

  function mount(initial: Pick<UseNpcsOptions, 'building' | 'shownFrom' | 'shownTo'>) {
    const scene = new THREE.Scene();
    const steps: Array<(delta: number) => boolean> = [];
    const sceneRef = { current: scene };
    const addDecorativeStep = (step: (delta: number) => boolean) => {
      steps.push(step);
      return () => {};
    };
    const hook = renderHook((props: Pick<UseNpcsOptions, 'building' | 'shownFrom' | 'shownTo'>) =>
      useNpcs({ enabled: true, threeModuleRef, sceneRef, addDecorativeStep, ...props }),
    { initialProps: initial });
    return { scene, steps, ...hook };
  }

  it('keeps the storey left behind, parked and hidden, and spawns the new one once', () => {
    const { scene, rerender } = mount({ building: twoStoreys, shownFrom: 0, shownTo: 0 });
    const ground = walkersIn(scene);
    expect(ground).toHaveLength(3);
    // Up the stairs: the flight is in view of both storeys.
    rerender({ building: twoStoreys, shownFrom: 0, shownTo: 1 });
    expect(walkersIn(scene)).toHaveLength(6);
    expect(ground.every((walker) => scene.children.includes(walker) && walker.visible)).toBe(true);
    // Away from the stairs: the ground floor's walkers are hidden, not removed.
    rerender({ building: twoStoreys, shownFrom: 1, shownTo: 1 });
    expect(walkersIn(scene)).toHaveLength(6);
    expect(ground.every((walker) => !walker.visible)).toBe(true);
    const upper = walkersIn(scene).filter((walker) => !ground.includes(walker));
    expect(upper.every((walker) => walker.visible && standsAt(walker, 3))).toBe(true);
    // Back down: the same people, where they were.
    const parked = ground.map((walker) => walker.position.clone());
    rerender({ building: twoStoreys, shownFrom: 0, shownTo: 0 });
    expect(walkersIn(scene)).toHaveLength(6);
    expect(ground.every((walker, index) => walker.visible && walker.position.equals(parked[index]!))).toBe(true);
  });

  it('a parked storey does not walk', () => {
    const { scene, steps, rerender } = mount({ building: twoStoreys, shownFrom: 0, shownTo: 0 });
    const ground = walkersIn(scene);
    rerender({ building: twoStoreys, shownFrom: 1, shownTo: 1 });
    const parked = ground.map((walker) => walker.position.clone());
    for (let frame = 0; frame < 60; frame++) steps[0]!(1 / 60);
    expect(ground.every((walker, index) => walker.position.equals(parked[index]!))).toBe(true);
  });

  it('a storey-height edit lifts the walkers above it with their floor, without a respawn', () => {
    const { scene, rerender } = mount({ building: twoStoreys, shownFrom: 1, shownTo: 1 });
    const upper = walkersIn(scene);
    const taller: RoomLayout = { ...twoStoreys, floors: [{ ...twoStoreys.floors[0]!, height: 3.5 }, twoStoreys.floors[1]!] };
    rerender({ building: taller, shownFrom: 1, shownTo: 1 });
    expect(sameWalkers(walkersIn(scene), upper)).toBe(true);
    expect(upper.every((walker) => standsAt(walker, 3.5))).toBe(true);
  });

  it('a floor edit re-routes the storey without a respawn; deleting the storey removes its walkers', () => {
    const { scene, rerender } = mount({ building: twoStoreys, shownFrom: 0, shownTo: 1 });
    const before = walkersIn(scene);
    const furnished: RoomLayout = {
      ...twoStoreys,
      floors: [{ ...twoStoreys.floors[0]!, items: [makeItem({ id: 'table', type: 'table', width: 2, depth: 2 })] }, twoStoreys.floors[1]!],
    };
    rerender({ building: furnished, shownFrom: 0, shownTo: 1 });
    expect(sameWalkers(walkersIn(scene), before)).toBe(true);
    const groundOnly: RoomLayout = { ...furnished, floors: [furnished.floors[0]!] };
    rerender({ building: groundOnly, shownFrom: 0, shownTo: 0 });
    expect(walkersIn(scene)).toHaveLength(3);
  });

  it('turning walkers off removes every storey’s walkers', () => {
    const scene = new THREE.Scene();
    const sceneRef = { current: scene };
    const addDecorativeStep = () => () => {};
    const { rerender } = renderHook(({ enabled }: { enabled: boolean }) =>
      useNpcs({ enabled, threeModuleRef, sceneRef, building: twoStoreys, shownFrom: 0, shownTo: 1, addDecorativeStep }),
    { initialProps: { enabled: true } });
    expect(walkersIn(scene)).toHaveLength(6);
    rerender({ enabled: false });
    expect(walkersIn(scene)).toHaveLength(0);
  });

  it('lifts the bodies the player bumps into with their floor', () => {
    const handOff = createNpcHandOff();
    const scene = new THREE.Scene();
    const sceneRef = { current: scene };
    const addDecorativeStep = () => () => {};
    const { rerender } = renderHook(({ building }: { building: RoomLayout }) =>
      useNpcs({ enabled: true, threeModuleRef, sceneRef, building, shownFrom: 1, shownTo: 1, addDecorativeStep, handOff }),
    { initialProps: { building: twoStoreys } });
    expect(handOff.bodies).toHaveLength(3);
    const taller: RoomLayout = { ...twoStoreys, floors: [{ ...twoStoreys.floors[0]!, height: 3.5 }, twoStoreys.floors[1]!] };
    rerender({ building: taller });
    expect(handOff.bodies.every((body) => body.collider.bottom === 3.5)).toBe(true);
  });
});

describe('walkers never appear on the player (#585)', () => {
  const twoStoreys = makeLayout({ floors: [makeFloor({ id: 'ground' }), makeFloor({ id: 'upper', name: 'Upper' })] });

  it('spawn clear of the player', () => {
    for (let trial = 0; trial < 10; trial++) {
      const handOff = createNpcHandOff();
      Object.assign(handOff.player, { present: true, x: 0.3, z: -0.4, floorIndex: 0 });
      const scene = new THREE.Scene();
      renderHook(() =>
        useNpcs({ enabled: true, threeModuleRef, sceneRef: { current: scene }, building: makeLayout({ width: 6, height: 6 }), shownFrom: 0, shownTo: 0, addDecorativeStep: () => () => {}, handOff })
      );
      for (const walker of walkersIn(scene)) expect(Math.hypot(walker.position.x - 0.3, walker.position.z + 0.4)).toBeGreaterThan(1.1);
    }
  });

  it('a parked walker standing where the player is stays parked until the player moves off', () => {
    const handOff = createNpcHandOff();
    const scene = new THREE.Scene();
    const sceneRef = { current: scene };
    const steps: Array<(delta: number) => boolean> = [];
    const addDecorativeStep = (step: (delta: number) => boolean) => {
      steps.push(step);
      return () => {};
    };
    const { rerender } = renderHook((props: Pick<UseNpcsOptions, 'shownFrom' | 'shownTo'>) =>
      useNpcs({ enabled: true, threeModuleRef, sceneRef, building: twoStoreys, addDecorativeStep, handOff, ...props }),
    { initialProps: { shownFrom: 0, shownTo: 0 } });
    const [first, ...rest] = walkersIn(scene);
    rerender({ shownFrom: 1, shownTo: 1 });
    // The player comes down onto the spot the first ground walker was parked on.
    Object.assign(handOff.player, { present: true, x: first!.position.x, z: first!.position.z, floorIndex: 0 });
    rerender({ shownFrom: 0, shownTo: 0 });
    expect(first!.visible).toBe(false);
    expect(handOff.bodies).not.toContain(undefined);
    expect(handOff.bodies).toHaveLength(rest.filter((walker) => walker.visible).length);
    // It moves off: the walker is there again, and solid.
    Object.assign(handOff.player, { x: first!.position.x + 3, z: first!.position.z + 3 });
    steps[0]!(1 / 60);
    expect(first!.visible).toBe(true);
    expect(handOff.bodies).toHaveLength(rest.filter((walker) => walker.visible).length + 1);
  });
});
