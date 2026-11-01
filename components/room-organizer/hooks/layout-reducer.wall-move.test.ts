import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ENTRANCE_WALL_ID } from '../lib/street';
import { layoutReducer, type LayoutState } from './layout-reducer';
import type { InteriorWall } from '../lib/types';

const partition: InteriorWall = { id: 'p', x1: -2, z1: 0, x2: 2, z2: 0, color: '#123456' };
const door = makeItem({ id: 'd', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: 0, z: 0 }, rotation: 0, locked: true });

function state(walls: readonly InteriorWall[] = [partition]): LayoutState {
  return {
    layout: makeLayout({ width: 10, height: 8, floors: [makeFloor({ interiorWalls: [...walls], items: [door] })] }),
    activeFloorIndex: 0,
  };
}

const floor = (s: LayoutState) => s.layout.floors[0]!;

describe('updateInteriorWalls (#718)', () => {
  it('moves a wall in one state change, keeps its colour, and carries the door', () => {
    const before = state();
    const after = layoutReducer(before, { type: 'updateInteriorWalls', walls: [{ id: 'p', x1: -2, z1: 1, x2: 2, z2: 1 }] });
    expect(floor(after).interiorWalls?.[0]).toEqual({ ...partition, z1: 1, z2: 1 });
    expect(floor(after).items[0]?.position).toEqual({ x: 0, z: 1 });
    expect(floor(after).items[0]?.locked).toBe(true);
  });

  it.each([
    ['nothing changed', { id: 'p', x1: -2, z1: 0, x2: 2, z2: 0 }],
    ['an unknown wall', { id: 'nope', x1: 0, z1: 1, x2: 2, z2: 1 }],
    ['a NaN end', { id: 'p', x1: Number.NaN, z1: 1, x2: 2, z2: 1 }],
    ['a zero-length wall', { id: 'p', x1: 1, z1: 1, x2: 1, z2: 1 }],
    ['a wall the door no longer fits', { id: 'p', x1: 0, z1: 0, x2: 0.5, z2: 0 }],
  ])('returns the same state for %s', (_name, patch) => {
    const before = state();
    expect(layoutReducer(before, { type: 'updateInteriorWalls', walls: [patch] })).toBe(before);
  });

  it('refuses the porch back wall', () => {
    const back: InteriorWall = { id: ENTRANCE_WALL_ID, x1: -1, z1: 3, x2: 1, z2: 3 };
    const before = state([partition, back]);
    expect(layoutReducer(before, { type: 'updateInteriorWalls', walls: [{ ...back, z1: 2, z2: 2 }] })).toBe(before);
  });
});
