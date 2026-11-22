// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useNpcs, type UseNpcsOptions } from './use-npcs';
import type { FurnitureItem, RoomLayout, Weather } from '../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const threeModuleRef = { current: THREE as unknown as typeof import('../three/three-runtime') };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const garden = (extra: FurnitureItem[] = [], storeys = 1): RoomLayout =>
  makeLayout({
    width: 8,
    height: 8,
    grounds: [{ id: 'g', kind: 'paving', x: -3, z: 5, w: 6, d: 2.5 }],
    floors: [
      makeFloor({
        items: [
          makeItem({ id: 'back', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 4 } }),
          makeItem({ id: 'bench', type: 'garden-bench', name: 'Garden Bench', category: 'outdoor', width: 1.5, depth: 0.5, height: 0.85, position: { x: -2, z: 8 }, rotation: Math.PI }),
          ...extra,
        ],
      }),
      ...Array.from({ length: storeys - 1 }, (_, i) => makeFloor({ id: `up-${i}`, name: `Upstairs ${i}`, items: [] })),
    ],
  });

function walkersIn(scene: THREE.Scene): THREE.Object3D[] {
  return scene.children.filter((child) => child.userData.type === 'npc');
}

/** Whether any walker stands out on the lot. */
function anyOutside(scene: THREE.Scene): boolean {
  return walkersIn(scene).some((walker) => Math.abs(walker.position.x) > 4.05 || Math.abs(walker.position.z) > 4.05);
}

function mount(weather: Weather) {
  vi.spyOn(Math, 'random').mockImplementation(seeded(913));
  const scene = new THREE.Scene();
  const steps: Array<(delta: number) => boolean> = [];
  const addDecorativeStep = (step: (delta: number) => boolean) => {
    steps.push(step);
    return () => {};
  };
  const hook = renderHook((props: Pick<UseNpcsOptions, 'building'>) =>
    useNpcs({ enabled: true, threeModuleRef, sceneRef: { current: scene }, addDecorativeStep, shownFrom: 0, shownTo: 0, weather, clock: { current: 12 }, ...props }),
  { initialProps: { building: garden() } });
  /** Run the walk for `seconds`; true when anyone was out on the lot. */
  const run = (seconds: number): boolean => {
    let out = false;
    for (let t = 0; t < seconds; t += 1 / 30) {
      steps[0]!(1 / 30);
      out ||= anyOutside(scene);
    }
    return out;
  };
  return { scene, run, ...hook };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('walkers and the weather from the start (#913 review)', () => {
  it('in clear weather they go out into the garden', () => {
    const { run } = mount('clear');
    expect(run(90)).toBe(true);
  });

  it('in the rain nobody heads out: not at spawn, nor after a floor edit', () => {
    const { scene, run, rerender } = mount('rain');
    expect(walkersIn(scene)).toHaveLength(3);
    expect(run(45)).toBe(false);
    // An edit rebuilds the nav and re-routes everyone: still closed.
    rerender({ building: garden([makeItem({ id: 'tree', type: 'tree', category: 'outdoor', width: 1.4, depth: 1.4, height: 3.8, position: { x: 3, z: 8 } })]) });
    expect(run(45)).toBe(false);
  });
});

describe('garden walkers while an upper storey is drawn (#913)', () => {
  // Well inside the 8 x 8 m walls; the door's threshold (about 0.2 m either side of the wall) is neither.
  const inside = (walker: THREE.Object3D) => Math.abs(walker.position.x) < 3.8 && Math.abs(walker.position.z) < 3.8;
  const outside = (walker: THREE.Object3D) => Math.abs(walker.position.x) > 4.2 || Math.abs(walker.position.z) > 4.2;
  const groundWalkers = (scene: THREE.Scene) => walkersIn(scene).filter((walker) => walker.position.y < 1);

  it('those out on the lot keep walking and showing; those indoors park, and one coming in parks at the door', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(9131));
    const scene = new THREE.Scene();
    const steps: Array<(delta: number) => boolean> = [];
    const addDecorativeStep = (step: (delta: number) => boolean) => {
      steps.push(step);
      return () => {};
    };
    const building = garden([], 2);
    const sceneRef = { current: scene };
    const { rerender } = renderHook(
      (props: Pick<UseNpcsOptions, 'shownFrom' | 'shownTo' | 'weather'>) =>
        useNpcs({ enabled: true, threeModuleRef, sceneRef, addDecorativeStep, building, clock: { current: 12 }, ...props }),
      { initialProps: { shownFrom: 0, shownTo: 0, weather: 'clear' as Weather } }
    );
    const step = (seconds: number, each?: () => void) => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        steps.at(-1)!(1 / 30);
        each?.();
      }
    };
    // Until someone is out on the lot and someone is in.
    let t = 0;
    while (t < 180 && !(groundWalkers(scene).some(outside) && groundWalkers(scene).some(inside))) {
      step(1);
      t += 1;
    }
    expect(groundWalkers(scene).some(outside)).toBe(true);
    expect(groundWalkers(scene).some(inside)).toBe(true);
    // The upper storey drawn: the ground storey's walkers out on the lot stay, the rest park.
    rerender({ shownFrom: 1, shownTo: 1, weather: 'clear' });
    const ground = groundWalkers(scene);
    for (const walker of ground) {
      if (inside(walker)) expect(walker.visible).toBe(false);
      if (outside(walker)) expect(walker.visible).toBe(true);
    }
    const out = ground.filter((w) => w.visible);
    const parked = ground.filter((w) => !w.visible).map((w) => w.position.clone());
    // They walk on; the parked ones don't move, and nobody shows indoors.
    const from = out.map((w) => w.position.clone());
    step(20, () => {
      for (const walker of ground) if (walker.visible) expect(inside(walker)).toBe(false);
    });
    expect(out.some((w, i) => w.position.distanceTo(from[i]!) > 0.05)).toBe(true);
    ground.filter((w) => parked.length > 0 && !out.includes(w)).forEach((w, i) => expect(w.position.distanceTo(parked[i]!)).toBeLessThan(1e-9));
    // Rain: everyone outside comes in and parks just inside the walls, never shown indoors.
    rerender({ shownFrom: 1, shownTo: 1, weather: 'rain' });
    step(60, () => {
      for (const walker of ground) if (walker.visible) expect(inside(walker)).toBe(false);
    });
    for (const walker of ground) {
      expect(walker.visible).toBe(false);
      expect(outside(walker)).toBe(false);
    }
    // The ground storey drawn again: all of them show and walk.
    rerender({ shownFrom: 0, shownTo: 0, weather: 'rain' });
    for (const walker of ground) expect(walker.visible).toBe(true);
  }, 30_000);
});
