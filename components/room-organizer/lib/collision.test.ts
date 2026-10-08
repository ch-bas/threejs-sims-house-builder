import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem } from './__testfixtures__/fixtures';
import { floorKeepOut, stairwellKeepOut } from './floor-keep-out';
import { autoOrganize, hasCollisions, itemsOverlap } from './geometry';
import type { FloorLayout } from './types';

describe('hasCollisions — interior walls (#368)', () => {
  const W = 10;
  const D = 10;
  const walls = [{ id: 'w', x1: -3, z1: 0, x2: 3, z2: 0 }];
  const sofa = (position: { x: number; z: number }) =>
    makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position });

  it('flags floor furniture straddling a partition, and only with the walls passed', () => {
    const straddling = sofa({ x: 0, z: 0 });
    expect(hasCollisions(straddling, [straddling], W, D)).toBe(false);
    expect(hasCollisions(straddling, [straddling], W, D, { interiorWalls: walls })).toBe(true);
    // Flush against the 0.16 m slab (0.08 + 0.45) is clear; past its end too.
    const flush = sofa({ x: 0, z: 0.53 });
    expect(hasCollisions(flush, [flush], W, D, { interiorWalls: walls })).toBe(false);
    const beyondEnd = sofa({ x: 4, z: 0 });
    expect(hasCollisions(beyondEnd, [beyondEnd], W, D, { interiorWalls: walls })).toBe(false);
  });

  it('tests rotated items against diagonal walls as oriented boxes', () => {
    const diagonal = [{ id: 'd', x1: -3, z1: -3, x2: 3, z2: 3 }];
    const near = makeItem({ id: 'a', width: 0.5, depth: 0.5, height: 0.8, position: { x: 0.3, z: 0 } });
    expect(hasCollisions(near, [near], W, D, { interiorWalls: diagonal })).toBe(true);
    const clear = makeItem({ id: 'b', width: 0.5, depth: 0.5, height: 0.8, position: { x: 1, z: -1 } });
    expect(hasCollisions(clear, [clear], W, D, { interiorWalls: diagonal })).toBe(false);
    // A bar turned parallel to the wall, 0.57 m off it, is clear; turned across it is not.
    const parallel = makeItem({
      id: 'c',
      width: 2,
      depth: 0.2,
      height: 0.8,
      rotation: -Math.PI / 4,
      position: { x: 0.4, z: -0.4 },
    });
    expect(hasCollisions(parallel, [parallel], W, D, { interiorWalls: diagonal })).toBe(false);
    const across = { ...parallel, rotation: Math.PI / 4 };
    expect(hasCollisions(across, [across], W, D, { interiorWalls: diagonal })).toBe(true);
  });

  it('honours the gap a door cuts in its wall', () => {
    const door = makeItem({ id: 'door', type: 'door', width: 1, depth: 0.1, height: 2.05, position: { x: 0, z: 0 } });
    const inGap = makeItem({ id: 'chair', width: 0.6, depth: 0.6, height: 0.8, position: { x: 0, z: 0 } });
    expect(hasCollisions(inGap, [door, inGap], W, D, { interiorWalls: walls })).toBe(false);
    expect(hasCollisions(inGap, [inGap], W, D, { interiorWalls: walls })).toBe(true);
    const besideGap = { ...inGap, position: { x: 1.5, z: 0 } };
    expect(hasCollisions(besideGap, [door, besideGap], W, D, { interiorWalls: walls })).toBe(true);
  });

  it('exempts rugs, wall-hung decor and wall-plane items', () => {
    const rug = makeItem({ id: 'rug', type: 'rug', width: 2, depth: 2, height: 0.02, position: { x: 0, z: 0 } });
    expect(hasCollisions(rug, [rug], W, D, { interiorWalls: walls })).toBe(false);
    const painting = makeItem({ id: 'p', type: 'painting', width: 0.8, depth: 0.05, height: 0.6, position: { x: 0, z: 0.1 } });
    expect(hasCollisions(painting, [painting], W, D, { interiorWalls: walls })).toBe(false);
    const window = makeItem({ id: 'win', type: 'window', width: 1, depth: 0.1, height: 1.2, position: { x: 1, z: 0 } });
    expect(hasCollisions(window, [window], W, D, { interiorWalls: walls })).toBe(false);
  });
});

describe('hasCollisions — stairwell holes (#372)', () => {
  const W = 10;
  const D = 10;
  const hole = [{ x0: 1, x1: 2, z0: -2, z1: 1, hole: true }];

  it('flags furniture standing over the hole', () => {
    const bed = makeItem({ id: 'bed', type: 'bed', width: 1.6, depth: 2, height: 0.6, position: { x: 0.5, z: 0 } });
    expect(hasCollisions(bed, [bed], W, D, { keepOut: hole })).toBe(true);
    const beside = { ...bed, position: { x: -0.5, z: 0 } };
    expect(hasCollisions(beside, [beside], W, D, { keepOut: hole })).toBe(false);
  });

  it('exempts low-profile items, wall-hung decor and stacked stairs', () => {
    const rug = makeItem({ id: 'rug', type: 'rug', width: 1, depth: 1, height: 0.02, position: { x: 1.5, z: 0 } });
    expect(hasCollisions(rug, [rug], W, D, { keepOut: hole })).toBe(false);
    const clock = makeItem({ id: 'clock', type: 'wall-clock', width: 0.5, depth: 0.08, height: 0.5, position: { x: 1.5, z: 0 } });
    expect(hasCollisions(clock, [clock], W, D, { keepOut: hole })).toBe(false);
    const stairs = makeItem({ id: 's', type: 'stairs', width: 1, depth: 3, height: 3, position: { x: 1.5, z: -0.5 } });
    expect(hasCollisions(stairs, [stairs], W, D, { keepOut: hole })).toBe(false);
  });

  it('tests a rotated hole as an oriented box', () => {
    // A 2 × 1 hole at the origin; turned 90° it spans x ∈ [-0.5, 0.5], z ∈ [-1, 1].
    const rect = { x0: -1, x1: 1, z0: -0.5, z1: 0.5, hole: true };
    const turned = { ...rect, rotation: Math.PI / 2 };
    const lamp = makeItem({ id: 'l', type: 'floor-lamp', width: 0.2, depth: 0.2, height: 1.7, position: { x: 0.8, z: 0 } });
    expect(hasCollisions(lamp, [lamp], W, D, { keepOut: [rect] })).toBe(true);
    expect(hasCollisions(lamp, [lamp], W, D, { keepOut: [turned] })).toBe(false);
    const moved = { ...lamp, position: { x: 0, z: 0.8 } };
    expect(hasCollisions(moved, [moved], W, D, { keepOut: [turned] })).toBe(true);
  });
});

describe('floorKeepOut (#372)', () => {
  const stairs = makeItem({ id: 'stairs', type: 'stairs', width: 1, depth: 3, height: 3, position: { x: 2, z: 0 } });
  const floors: FloorLayout[] = [makeFloor({ id: 'ground', items: [stairs] }), makeFloor({ id: 'first' })];
  const building = { width: 10, height: 10, floors };

  it('cuts the floor above the stairs, not the floor they stand on', () => {
    expect(stairwellKeepOut(floors, 0)).toEqual([]);
    expect(stairwellKeepOut(floors, -1)).toEqual([]);
    const [rect, ...rest] = stairwellKeepOut(floors, 1);
    expect(rest).toEqual([]);
    expect(rect?.hole).toBe(true);
    expect(rect!.x0).toBeLessThan(2);
    expect(rect!.x1).toBeGreaterThan(2);
    expect(floorKeepOut(building, 0)).toEqual([]);
  });

  it('keeps the rotation of rotated stairs', () => {
    const turned = [makeFloor({ items: [{ ...stairs, rotation: Math.PI / 2 }] }), makeFloor({ id: 'first' })];
    expect(stairwellKeepOut(turned, 1)[0]?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('flags a bed over the stairwell upstairs, but not on the ground floor', () => {
    const bed = makeItem({ id: 'bed', type: 'bed', width: 1.6, depth: 2, height: 0.6, position: { x: 2, z: 0 } });
    expect(hasCollisions(bed, [bed], 10, 10, { keepOut: floorKeepOut(building, 1) })).toBe(true);
    const away = { ...bed, position: { x: -2, z: 0 } };
    expect(hasCollisions(away, [away], 10, 10, { keepOut: floorKeepOut(building, 1) })).toBe(false);
  });
});

describe('hasCollisions — wall-hung decor (#376)', () => {
  const W = 8;
  const D = 8;
  const sofa = makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: -3.55 } });
  const painting = makeItem({ id: 'p', type: 'painting', width: 0.8, depth: 0.05, height: 0.6, position: { x: 0, z: -3.975 } });

  it('lets a painting hang over a sofa (the issue repro)', () => {
    const items = [sofa, painting];
    expect(hasCollisions(painting, items, W, D)).toBe(false);
    expect(hasCollisions(sofa, items, W, D)).toBe(false);
    const overSofa = { ...painting, position: { x: 0, z: -3.6 } };
    expect(hasCollisions(overSofa, [sofa, overSofa], W, D)).toBe(false);
  });

  it('still collides with furniture tall enough to reach it', () => {
    const wardrobe = makeItem({ id: 'w', type: 'wardrobe', width: 1.2, depth: 0.6, height: 2.1, position: { x: 0, z: -3.7 } });
    expect(hasCollisions(painting, [painting, wardrobe], W, D)).toBe(true);
    const counter = makeItem({ id: 'c', type: 'counter', width: 2, depth: 0.6, height: 0.9, position: { x: 0, z: -3.7 } });
    expect(hasCollisions(painting, [painting, counter], W, D)).toBe(true);
  });

  it('collides with other hung decor where the mount bands overlap', () => {
    const clock = makeItem({ id: 'clock', type: 'wall-clock', width: 0.5, depth: 0.08, height: 0.5, position: { x: 0.2, z: -3.96 } });
    expect(hasCollisions(painting, [painting, clock], W, D)).toBe(true);
    // A 0.4 m painting tops out at 1.2 m, under the clock's 1.25 m mount.
    const shortPainting = { ...painting, height: 0.4 };
    expect(hasCollisions(shortPainting, [shortPainting, clock], W, D)).toBe(false);
  });

  it('leaves wall-plane items alone: curtains over a window are fine', () => {
    const window = makeItem({ id: 'win', type: 'window', width: 1.2, depth: 0.1, height: 1.2, position: { x: 0, z: -4 } });
    const curtains = makeItem({ id: 'cur', type: 'curtains', width: 1.4, depth: 0.2, height: 2.4, position: { x: 0, z: -3.9 } });
    expect(hasCollisions(curtains, [window, curtains], W, D)).toBe(false);
    expect(hasCollisions(window, [window, curtains], W, D)).toBe(false);
  });
});

describe('hasCollisions — the pendant light (#470)', () => {
  const W = 10;
  const D = 10;
  const walls = [{ id: 'w', x1: -3, z1: 0, x2: 3, z2: 0 }];
  const pendant = makeItem({ id: 'pl', type: 'pendant-light', width: 0.45, depth: 0.45, height: 1, position: { x: 0, z: 0 } });

  it('is flagged hanging through a partition, unlike decor hung on it', () => {
    expect(hasCollisions(pendant, [pendant], W, D, { interiorWalls: walls })).toBe(true);
    const painting = makeItem({ id: 'p', type: 'painting', width: 0.8, depth: 0.05, height: 0.6, position: { x: 0, z: 0.1 } });
    expect(hasCollisions(painting, [painting], W, D, { interiorWalls: walls })).toBe(false);
  });

  it('clears a partition when it ends above the partition top', () => {
    // A 3 m storey's partitions stop at 2.6 m; a 0.3 m drop ends at 2.7 m.
    const short = { ...pendant, height: 0.3 };
    expect(hasCollisions(short, [short], W, D, { interiorWalls: walls })).toBe(false);
    // A 2.4 m storey's partitions stop at 2.0 m; the same drop ends at 2.1 m.
    expect(hasCollisions(short, [short], W, D, { interiorWalls: walls, storeyHeight: 2.4 })).toBe(false);
    expect(hasCollisions(pendant, [pendant], W, D, { interiorWalls: walls, storeyHeight: 4.5 })).toBe(true);
    // In a 4.5 m storey the partitions reach 4.1 m: a 0.3 m drop ends at 4.2 m.
    expect(hasCollisions(short, [short], W, D, { interiorWalls: walls, storeyHeight: 4.5 })).toBe(false);
  });

  it('hangs from the storey height it is given when tested against furniture', () => {
    const wardrobe = makeItem({ id: 'w', type: 'wardrobe', width: 1.2, depth: 0.6, height: 2.1, position: { x: 0, z: 0 } });
    const items = [pendant, wardrobe];
    // 3 m storey: the 1 m drop reaches 2.0 m, into the 2.1 m wardrobe.
    expect(hasCollisions(pendant, items, W, D)).toBe(true);
    expect(hasCollisions(wardrobe, items, W, D, { storeyHeight: 3 })).toBe(true);
    // 4.5 m storey: it ends at 3.5 m, well above it.
    expect(hasCollisions(pendant, items, W, D, { storeyHeight: 4.5 })).toBe(false);
    expect(hasCollisions(wardrobe, items, W, D, { storeyHeight: 4.5 })).toBe(false);
  });
});

describe('hasCollisions — stacking families (#403)', () => {
  const W = 10;
  const D = 10;
  const at = (id: string, type: string, width: number, height: number) =>
    makeItem({ id, type, width, depth: width, height, position: { x: 0, z: 0 } });

  it.each([
    ['lamp', 'table'],
    ['lamp', 'side-table'],
    ['plant', 'picnic-table'],
    ['dining-chair', 'table'],
    ['armchair', 'coffee-table'],
    ['garden-bench', 'picnic-table'],
  ])('%s with %s is an intended stack', (top, surface) => {
    const a = at('a', top, 0.4, 0.8);
    const b = at('b', surface, 1, 0.75);
    expect(hasCollisions(a, [a, b], W, D)).toBe(false);
    expect(hasCollisions(b, [a, b], W, D)).toBe(false);
  });

  it('a lamp on a sofa still collides', () => {
    const lamp = at('a', 'lamp', 0.4, 1.5);
    const sofa = at('b', 'sofa', 2, 0.8);
    expect(hasCollisions(lamp, [lamp, sofa], W, D)).toBe(true);
  });
});

describe('hasCollisions — outdoor items on the porch (#406)', () => {
  const W = 10;
  const D = 10;
  const porch = [{ x0: -0.7, x1: 0.7, z0: -5, z1: -3.8 }];
  const plant = (id: string, position: { x: number; z: number }) =>
    makeItem({ id, type: 'potted-plant', category: 'outdoor', width: 0.4, depth: 0.4, height: 0.6, position });

  it('accepts an outdoor item standing wholly on the porch', () => {
    const onPorch = plant('a', { x: 0, z: -4.5 });
    expect(hasCollisions(onPorch, [onPorch], W, D)).toBe(true);
    expect(hasCollisions(onPorch, [onPorch], W, D, { keepOut: porch })).toBe(false);
  });

  it('still flags one poking from the porch into the house, or standing in a stairwell', () => {
    const straddling = plant('a', { x: 0.6, z: -4.5 });
    expect(hasCollisions(straddling, [straddling], W, D, { keepOut: porch })).toBe(true);
    const inHole = plant('b', { x: 0, z: 0 });
    const hole = [{ x0: -1, x1: 1, z0: -1, z1: 1, hole: true }];
    expect(hasCollisions(inHole, [inHole], W, D, { keepOut: hole })).toBe(true);
  });

  it('still collides with other items on the porch', () => {
    const a = plant('a', { x: 0, z: -4.5 });
    const b = plant('b', { x: 0.1, z: -4.4 });
    expect(hasCollisions(a, [a, b], W, D, { keepOut: porch })).toBe(true);
  });
});

describe('autoOrganize — locked items (#389)', () => {
  it('keeps a locked item where it is, rotation included (the issue repro)', () => {
    const bed = makeItem({ id: 'bed', type: 'bed', width: 1.6, depth: 2, position: { x: 2, z: 2 }, rotation: 0.7, locked: true });
    expect(autoOrganize([bed], 8, 8)[0]).toBe(bed);
  });

  it('packs the unlocked items around a locked one', () => {
    const locked = makeItem({ id: 'locked', width: 1.5, depth: 1.5, position: { x: -3, z: -3 }, rotation: 0.3, locked: true });
    const loose = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: `i${i}`, width: 1, depth: 1, position: { x: 0, z: 0 }, rotation: 1 })
    );
    const result = autoOrganize([loose[0]!, locked, ...loose.slice(1)], 8, 8);
    expect(result.find((item) => item.id === 'locked')).toBe(locked);
    const placed = result.filter((item) => item.id !== 'locked');
    expect(placed).toHaveLength(8);
    for (const item of placed) {
      expect(item.rotation).toBe(0);
      expect(itemsOverlap(item, locked)).toBe(false);
    }
    const keys = placed.map((item) => `${item.position!.x},${item.position!.z}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('terminates with no margin and a locked item filling a row', () => {
    const shelf = makeItem({ id: 'shelf', width: 4, depth: 1, position: { x: 0, z: -1.5 }, locked: true });
    const box = makeItem({ id: 'box', width: 1, depth: 1, position: { x: 1, z: 1 } });
    const [, placed] = autoOrganize([shelf, box], 4, 4, 'shelf', 0);
    expect(placed!.rotation).toBe(0);
    expect(itemsOverlap(placed!, shelf)).toBe(false);
  });
});
