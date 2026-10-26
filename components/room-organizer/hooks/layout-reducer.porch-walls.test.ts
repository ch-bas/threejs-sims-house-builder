import { describe, expect, it } from 'vitest';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { generateRoomShape } from '../lib/room-shapes';
import { ENTRANCE_WALL_ID, entrancePlanOutline } from '../lib/street';
import { layoutReducer, type LayoutState } from './layout-reducer';
import type { InteriorWall } from '../lib/types';

// Interior walls can't run through the recessed porch, which is outside (#614).

function porchHouse(): LayoutState {
  const state: LayoutState = { layout: makeLayout({ floors: [makeFloor({ id: 'ground' }), makeFloor({ id: 'first' })] }), activeFloorIndex: 0 };
  return layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
}

function ownWalls(state: LayoutState, floor = state.activeFloorIndex): InteriorWall[] {
  return (state.layout.floors[floor]!.interiorWalls ?? []).filter((wall) => wall.id !== ENTRANCE_WALL_ID);
}

/** Whether any point of the wall lies strictly inside the recess. */
function entersPorch(wall: InteriorWall, porch: { x0: number; x1: number; frontZ: number; backZ: number }): boolean {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = wall.x1 + (wall.x2 - wall.x1) * t;
    const z = wall.z1 + (wall.z2 - wall.z1) * t;
    if (x > porch.x0 + 1e-6 && x < porch.x1 - 1e-6 && z > porch.frontZ + 1e-6 && z < porch.backZ - 1e-6) return true;
  }
  return false;
}

describe('interior walls and the porch (#614)', () => {
  it('a 7.5 × 7.5 rectangle stamp leaves the recess open', () => {
    const state = porchHouse();
    const porch = entrancePlanOutline(state.layout, 0)!;
    expect(porch).not.toBeNull();
    const stamp = generateRoomShape('rectangle', 0, 0, 7.5, 7.5, 'stamp', undefined, { width: 8, depth: 8 });
    const next = layoutReducer(state, { type: 'addInteriorWalls', walls: stamp });
    const walls = ownWalls(next);
    expect(walls.some((wall) => entersPorch(wall, porch))).toBe(false);
    // The north wall is split either side of the recess, not dropped.
    const north = walls.filter((wall) => Math.abs(wall.z1 + 3.75) < 1e-9 && Math.abs(wall.z2 + 3.75) < 1e-9);
    expect(north).toHaveLength(2);
    expect(new Set(walls.map((wall) => wall.id)).size).toBe(walls.length);
    // The other three sides are untouched.
    expect(walls).toHaveLength(5);
  });

  it('a drawn wall ending inside the recess stops at its edge', () => {
    const state = porchHouse();
    const porch = entrancePlanOutline(state.layout, 0)!;
    const next = layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'w', x1: 0, z1: 0, x2: 0, z2: -3.5 } });
    const [wall, ...rest] = ownWalls(next);
    expect(rest).toEqual([]);
    expect(entersPorch(wall!, porch)).toBe(false);
    expect(wall!.z2).toBeCloseTo(porch.backZ);
  });

  it('refuses a wall wholly inside the recess, returning the same state', () => {
    const state = porchHouse();
    const next = layoutReducer(state, { type: 'addInteriorWall', wall: { id: 'w', x1: -0.3, z1: -3.5, x2: 0.3, z2: -3.5 } });
    expect(next).toBe(state);
    const stamp = layoutReducer(state, { type: 'addInteriorWalls', walls: [{ id: 'w', x1: -0.3, z1: -3.5, x2: 0.3, z2: -3.5 }] });
    expect(stamp).toBe(state);
  });

  it('keeps a wall that only runs along the recess edge, and walls on a storey the porch does not cross', () => {
    const state = porchHouse();
    const porch = entrancePlanOutline(state.layout, 0)!;
    const cheek: InteriorWall = { id: 'cheek', x1: porch.x1, z1: porch.backZ, x2: porch.x1, z2: 0 };
    const along = layoutReducer(state, { type: 'addInteriorWall', wall: cheek });
    expect(ownWalls(along)).toEqual([cheek]);
    const upstairs = layoutReducer({ ...state, activeFloorIndex: 1 }, { type: 'addInteriorWall', wall: { id: 'w', x1: 0, z1: 0, x2: 0, z2: -3.5 } });
    expect(ownWalls(upstairs, 1)).toEqual([{ id: 'w', x1: 0, z1: 0, x2: 0, z2: -3.5 }]);
  });
});
