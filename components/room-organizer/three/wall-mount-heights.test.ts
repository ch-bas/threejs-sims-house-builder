import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { WINDOW_SILL_HEIGHT } from '../lib/constants';
import { buildWallClock, buildWallShelf } from './builders/builders-decor';
import { buildWindow } from './builders/builders-structure';
import { computeWallOpenings, openingsForWall } from './wall-openings';
import type { BuilderContext } from './builder-utils';
import type { FurnitureItem } from '../lib/types';

const WALL_HEIGHT = 3;

const context = (item: FurnitureItem): BuilderContext => ({
  THREE,
  item,
  hasCollision: false,
  baseColor: 0x8b4513,
  opacity: 1,
});

const bounds = (group: THREE.Group): THREE.Box3 => new THREE.Box3().setFromObject(group);

describe('window sill datum (#212)', () => {
  const windowOn = (item: FurnitureItem) =>
    openingsForWall(computeWallOpenings([item], 10, 10, WALL_HEIGHT), 'north')[0];

  it('cuts the wall hole at the same sill the window mesh is built around', () => {
    // Catalog default window: 1.2 m tall, snapped to the north wall plane.
    const opening = windowOn(
      makeItem({ type: 'window', width: 1.2, depth: 0.15, height: 1.2, position: { x: 0, z: -5 } })
    );
    expect(opening).toBeDefined();
    expect(opening!.bottomFromFloor).toBe(WINDOW_SILL_HEIGHT);
    // Hole top must coincide with the mesh top (sill + item height) — the
    // 10 cm see-through slit came from these two disagreeing.
    expect(opening!.bottomFromFloor + opening!.height).toBeCloseTo(WINDOW_SILL_HEIGHT + 1.2, 10);
  });

  it('drops the sill for a window too tall to fit above it', () => {
    const opening = windowOn(
      makeItem({ type: 'window', width: 1.2, depth: 0.15, height: 2.8, position: { x: 0, z: -5 } })
    );
    expect(opening!.bottomFromFloor).toBeCloseTo(WALL_HEIGHT - 2.8, 10);
  });

  it('honours a per-window sill in the hole and the mesh alike (#204)', () => {
    const item = makeItem({ type: 'window', width: 1.2, depth: 0.15, height: 1.2, sillHeight: 0.4, position: { x: 0, z: -5 } });
    const opening = windowOn(item);
    expect(opening!.bottomFromFloor).toBeCloseTo(0.4, 10);
    // The mesh (frame over a filler panel down to the floor) tops out where the hole does.
    const mesh = bounds(buildWindow(context(item)));
    expect(mesh.max.y).toBeCloseTo(0.4 + 1.2, 5);
    expect(opening!.bottomFromFloor + opening!.height).toBeCloseTo(mesh.max.y, 5);
  });

  it('keeps doors on the floor', () => {
    const opening = windowOn(
      makeItem({ type: 'door', width: 0.9, depth: 0.12, height: 2.1, position: { x: 0, z: -5 } })
    );
    expect(opening!.bottomFromFloor).toBe(0);
  });
});

describe('wall decor hangs off the floor (#163)', () => {
  it('hangs the wall clock centred at eye level', () => {
    const box = bounds(
      buildWallClock(context(makeItem({ type: 'wall-clock', width: 0.5, depth: 0.08, height: 0.5 })))
    );
    const centerY = (box.min.y + box.max.y) / 2;
    expect(centerY).toBeGreaterThan(1.3);
    expect(centerY).toBeLessThan(1.7);
    // Nothing may rest on the floor — that was the bug.
    expect(box.min.y).toBeGreaterThan(1.0);
  });

  it('hangs the wall shelf at picture-rail height, brackets included', () => {
    const box = bounds(
      buildWallShelf(context(makeItem({ type: 'wall-shelf', width: 1.0, depth: 0.25, height: 0.06 })))
    );
    // Lowest point is the bracket tip just under the board — well off the
    // floor, well under the ceiling.
    expect(box.min.y).toBeGreaterThan(0.9);
    expect(box.max.y).toBeLessThan(1.6);
  });
});
