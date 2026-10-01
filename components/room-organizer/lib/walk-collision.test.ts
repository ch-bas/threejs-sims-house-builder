import { describe, expect, it } from 'vitest';
import { buildWalkColliders, resolveWalkerPosition, resolveWalkerStep } from './walk-collision';
import type { FurnitureCategory, FurnitureItem, InteriorWall } from './types';

const RADIUS = 0.3;
const ROOM = { roomWidth: 10, roomDepth: 10 };
/** Half the interior-wall thickness (0.16 m) plus the walker radius. */
const WALL_STANDOFF = 0.08 + RADIUS;

function item(overrides: Partial<FurnitureItem> & { position: { x: number; z: number } }): FurnitureItem {
  return {
    id: 'item',
    type: 'sofa',
    name: 'Sofa',
    width: 2,
    depth: 1,
    height: 0.8,
    color: '#000',
    icon: '🛋️',
    rotation: 0,
    ...overrides,
  };
}

/** A 2 × 1 box centred at (0, -1.5): its near face is the line z = -1. */
const BOX = item({ position: { x: 0, z: -1.5 } });
const WALL: InteriorWall = { id: 'w', x1: -2, z1: 0, x2: 2, z2: 0 };

const walk = (
  from: { x: number; z: number },
  to: { x: number; z: number },
  items: FurnitureItem[],
  walls: InteriorWall[] = [],
  options = ROOM
) => resolveWalkerPosition(from, to, RADIUS, items, walls, options);

describe('resolveWalkerPosition — furniture', () => {
  it('walking head-on into a box stops at its surface', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -1.5 }, [BOX]);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('a diagonal push into a face slides along it', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0.6, z: -1.5 }, [BOX]);
    expect(result.x).toBeCloseTo(0.6, 3);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('brushing a corner does not stick — the walker gets past', () => {
    // Box spans x ∈ [-1, 1]; walker at x = 1.2 overlaps the corner by 0.1.
    const result = walk({ x: 1.2, z: 0 }, { x: 1.2, z: -3 }, [BOX]);
    // Rounding the corner costs a few centimetres of travel, never the move.
    expect(result.z).toBeLessThan(-2.9);
    expect(result.x).toBeGreaterThanOrEqual(1.2);
    expect(result.x).toBeLessThan(1.2 + RADIUS);
  });

  it('a walker already inside a box is pushed out through the nearest face', () => {
    const result = walk({ x: 0.9, z: -1.5 }, { x: 0.9, z: -1.5 }, [BOX]);
    expect(result.z).toBeCloseTo(-1.5, 5);
    expect(result.x).toBeCloseTo(1 + RADIUS, 3);
  });

  it('respects a rotated item', () => {
    // 2 × 0.5 box at the origin: flat along X unrotated, along Z at 90°.
    const flat = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: 0 });
    const upright = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: Math.PI / 2 });
    // Walking along z at x = 0.9 hits the flat box and clears the upright one.
    expect(walk({ x: 0.9, z: 2 }, { x: 0.9, z: -2 }, [flat]).z).toBeCloseTo(0.25 + RADIUS, 3);
    expect(walk({ x: 0.9, z: 2 }, { x: 0.9, z: -2 }, [upright]).z).toBeCloseTo(-2, 3);
    // Walking along x at z = 0.9 clears the flat box and hits the upright one.
    expect(walk({ x: 2, z: 0.9 }, { x: -2, z: 0.9 }, [flat]).x).toBeCloseTo(-2, 3);
    expect(walk({ x: 2, z: 0.9 }, { x: -2, z: 0.9 }, [upright]).x).toBeCloseTo(0.25 + RADIUS, 3);
  });

  it('a 45° item blocks the diagonal its unrotated footprint leaves clear', () => {
    const flat = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: 0 });
    const diagonal = item({ position: { x: 0, z: 0 }, depth: 0.5, rotation: Math.PI / 4 });
    // (0.7, -0.7) lies inside the diagonal footprint; outside the flat one.
    const clear = walk({ x: 2, z: -2 }, { x: 0.7, z: -0.7 }, [flat]);
    expect(clear.x).toBeCloseTo(0.7, 3);
    expect(clear.z).toBeCloseTo(-0.7, 3);
    const blocked = walk({ x: 2, z: -2 }, { x: 0.7, z: -0.7 }, [diagonal]);
    // Stopped at the box's end: 1 (half-width) + radius along the width axis.
    expect(Math.hypot(blocked.x, blocked.z)).toBeCloseTo(1 + RADIUS, 2);
  });

  it('ignores low-profile items (rugs)', () => {
    const rug = item({ id: 'rug', type: 'rug', position: { x: 0, z: -1.5 }, height: 0.02 });
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [rug]);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('ignores wall-mounted openings and cameras', () => {
    const wallItems = [
      item({ id: 'door', type: 'door', position: { x: 0, z: -1.5 }, width: 0.9, depth: 0.1, height: 2.05 }),
      item({ id: 'window', type: 'window', position: { x: 0, z: -2 }, width: 1.2, depth: 0.1, height: 1.2 }),
      item({ id: 'cam', type: 'security-camera', position: { x: 0, z: -2.5 }, width: 0.2, depth: 0.2, height: 0.2 }),
    ];
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, wallItems);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('ignores an unplaced item', () => {
    const { position: _placed, ...unplaced } = BOX;
    expect(walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [unplaced]).z).toBeCloseTo(-3, 3);
  });

  it('walks under wall-hung decor: it hangs above the path (#376)', () => {
    for (const type of ['painting', 'mirror', 'wall-shelf', 'wall-clock', 'curtains']) {
      const decor = item({ type, width: 2, depth: 1, height: 0.6, position: { x: 0, z: -1.5 } });
      expect(buildWalkColliders([decor], [])).toEqual([]);
      expect(walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [decor]).z).toBeCloseTo(-3, 3);
    }
  });
});

describe('resolveWalkerPosition — outdoor items', () => {
  const tree = (position: { x: number; z: number }) =>
    item({ id: 'tree', type: 'tree', category: 'outdoor' as FurnitureCategory, position, width: 1, depth: 1, height: 3 });

  it('a walker inside the room walks through outdoor items', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [tree({ x: 0, z: -1.5 })]);
    expect(result.z).toBeCloseTo(-3, 3);
  });

  it('a walker outside the room collides with outdoor items', () => {
    const result = walk({ x: 0, z: 8 }, { x: 0, z: 6 }, [tree({ x: 0, z: 6 })]);
    expect(result.z).toBeCloseTo(6.5 + RADIUS, 3);
  });

  it('a walker outside the room still collides with indoor items', () => {
    const bench = item({ id: 'bench', position: { x: 0, z: 6 }, width: 1, depth: 1 });
    const result = walk({ x: 0, z: 8 }, { x: 0, z: 6 }, [bench]);
    expect(result.z).toBeCloseTo(6.5 + RADIUS, 3);
  });

  it('without room dimensions everything is solid', () => {
    const result = walk({ x: 0, z: 0 }, { x: 0, z: -3 }, [tree({ x: 0, z: -1.5 })], [], {} as typeof ROOM);
    expect(result.z).toBeCloseTo(-1 + RADIUS, 3);
  });
});

describe('resolveWalkerPosition — interior walls', () => {
  it('an interior wall segment blocks the walker at its thickness', () => {
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [], [WALL]);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('slides along a wall segment', () => {
    const result = walk({ x: 0, z: 1 }, { x: 1, z: -1 }, [], [WALL]);
    expect(result.x).toBeCloseTo(1, 3);
    expect(result.z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('is blocked from either side', () => {
    const result = walk({ x: 0, z: -1 }, { x: 0, z: 1 }, [], [WALL]);
    expect(result.z).toBeCloseTo(-WALL_STANDOFF, 3);
  });

  it('walks around the end of a segment', () => {
    const result = walk({ x: 3, z: 1 }, { x: 3, z: -1 }, [], [WALL]);
    expect(result.z).toBeCloseTo(-1, 3);
  });

  it('respects a diagonal wall', () => {
    const diagonal: InteriorWall = { id: 'd', x1: -2, z1: -2, x2: 2, z2: 2 };
    const result = walk({ x: 1, z: -1 }, { x: -1, z: 1 }, [], [diagonal]);
    // Perpendicular distance from the centreline stays at the standoff.
    expect(Math.abs(result.x - result.z) / Math.SQRT2).toBeCloseTo(WALL_STANDOFF, 3);
    expect(result.x).toBeGreaterThan(result.z);
  });

  it('never tunnels through a thin wall on a large step', () => {
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -4 }, [], [WALL]);
    expect(result.z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('ignores a degenerate zero-length wall', () => {
    const dot: InteriorWall = { id: 'dot', x1: 0, z1: 0, x2: 0, z2: 0 };
    expect(walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [], [dot]).z).toBeCloseTo(-1, 3);
  });
});

describe('resolveWalkerPosition — door gaps', () => {
  const door = (position: { x: number; z: number }, id = 'door') =>
    item({ id, type: 'door', position, width: 0.9, depth: 0.1, height: 2.05 });

  it('a door on an interior wall is a passable gap', () => {
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [door({ x: 0, z: 0 })], [WALL]);
    expect(result.z).toBeCloseTo(-1, 3);
  });

  it('the wall stays solid either side of the door', () => {
    const items = [door({ x: 0, z: 0 })];
    expect(walk({ x: 1.5, z: 1 }, { x: 1.5, z: -1 }, items, [WALL]).z).toBeCloseTo(WALL_STANDOFF, 3);
    expect(walk({ x: -1.5, z: 1 }, { x: -1.5, z: -1 }, items, [WALL]).z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('a door snapped slightly off the centreline still cuts the gap', () => {
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [door({ x: 0, z: 0.08 })], [WALL]);
    expect(result.z).toBeCloseTo(-1, 3);
  });

  it('a door far from the wall does not cut it', () => {
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [door({ x: 0, z: 1.5 })], [WALL]);
    expect(result.z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('a door owned by the exterior wall does not cut an abutting interior wall', () => {
    // Interior wall runs from the north facade (z = -5) into the room.
    const spine: InteriorWall = { id: 's', x1: 0, z1: -5, x2: 0, z2: -1 };
    // Door sits on the facade right at the junction — nearer the exterior wall.
    const items = [door({ x: 0.3, z: -5 })];
    const colliders = buildWalkColliders(items, [spine], ROOM);
    // One uncut run covering the whole 4 m spine.
    expect(colliders).toHaveLength(1);
    expect(colliders[0]!.hw).toBeCloseTo(2, 5);
  });

  it('a window is not a gap', () => {
    const window = item({ id: 'win', type: 'window', position: { x: 0, z: 0 }, width: 1.2, depth: 0.1, height: 1.2 });
    const result = walk({ x: 0, z: 1 }, { x: 0, z: -1 }, [window], [WALL]);
    expect(result.z).toBeCloseTo(WALL_STANDOFF, 3);
  });

  it('a door owned by a wall but lying past its end cuts nothing, like the renderer (#399)', () => {
    const stub: InteriorWall = { id: 'stub', x1: 0, z1: 0, x2: 2, z2: 0 };
    const past = [{ ...door({ x: 2.3, z: 0 }), width: 0.5 }];
    const colliders = buildWalkColliders(past, [stub], ROOM);
    expect(colliders).toHaveLength(1);
    expect(colliders[0]!.hw).toBeCloseTo(1, 5);
    expect(walk({ x: 1.75, z: -1 }, { x: 1.75, z: 1 }, past, [stub]).z).toBeCloseTo(-WALL_STANDOFF, 3);
  });

  it('two doors leave three solid runs', () => {
    const items = [door({ x: -1, z: 0 }, 'a'), door({ x: 1, z: 0 }, 'b')];
    const colliders = buildWalkColliders(items, [WALL], ROOM);
    expect(colliders).toHaveLength(3);
    const widths = colliders.map((c) => c.hw * 2).sort((a, b) => a - b);
    expect(widths[0]).toBeCloseTo(0.55, 5);
    expect(widths[1]).toBeCloseTo(0.55, 5);
    expect(widths[2]).toBeCloseTo(1.1, 5);
  });
});

describe('resolveWalkerStep', () => {
  it('writes into and returns the supplied output object', () => {
    const colliders = buildWalkColliders([BOX], [], ROOM);
    const out = { x: NaN, z: NaN };
    const result = resolveWalkerStep(colliders, { x: 0, z: 0 }, { x: 0, z: -2 }, RADIUS, out, ROOM);
    expect(result).toBe(out);
    expect(out.z).toBeCloseTo(-1 + RADIUS, 3);
  });

  it('a no-op move with nothing nearby leaves the position untouched', () => {
    const colliders = buildWalkColliders([BOX], [WALL], ROOM);
    const out = { x: 0, z: 0 };
    resolveWalkerStep(colliders, { x: 3, z: 3 }, { x: 3, z: 3 }, RADIUS, out, ROOM);
    expect(out).toEqual({ x: 3, z: 3 });
  });
});
