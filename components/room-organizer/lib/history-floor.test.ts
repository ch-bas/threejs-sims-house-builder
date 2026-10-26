import { describe, expect, it } from 'vitest';
import { INITIAL_LAYOUT } from '../hooks/layout-reducer';
import { makeItem } from './__testfixtures__/fixtures';
import { floorIndexAfterRestore } from './history-floor';
import type { FloorLayout, RoomLayout } from './types';

const floor = (id: string): FloorLayout => ({ ...INITIAL_LAYOUT.floors[0]!, id, name: id, items: [] });
const house = (...floors: FloorLayout[]): RoomLayout => ({ ...INITIAL_LAYOUT, floors });
const a = floor('a');
const b = floor('b');
const c = floor('c');

describe('floorIndexAfterRestore (#578)', () => {
  it('stays on the same floor id when floors were removed or reordered', () => {
    // Undo "remove A" while on C.
    expect(floorIndexAfterRestore(house(b, c), 1, house(a, b, c))).toBe(2);
    // Undo "move A to the top" while on A.
    expect(floorIndexAfterRestore(house(b, c, a), 2, house(a, b, c))).toBe(0);
  });

  it('shows the floor that comes back where the editor stands', () => {
    // Undo "remove B" while on B: removal left the editor on C (index 1).
    expect(floorIndexAfterRestore(house(a, c), 1, house(a, b, c))).toBe(1);
    // Undo "remove C" while on C: removal clamped the editor to B.
    expect(floorIndexAfterRestore(house(a, b), 1, house(a, b, c))).toBe(2);
    // Redo "add floor D" from C.
    expect(floorIndexAfterRestore(house(a, b, c), 2, house(a, b, c, floor('d')))).toBe(3);
  });

  it('keeps the clamped index when the floor on screen did not exist yet', () => {
    // Undo "add floor D" while on D.
    expect(floorIndexAfterRestore(house(a, b, c, floor('d')), 3, house(a, b, c))).toBe(2);
  });

  it('switches to the one other floor whose contents change', () => {
    const bWithBed = { ...b, items: [makeItem({ id: 'bed' })] };
    expect(floorIndexAfterRestore(house(a, bWithBed, c), 0, house(a, b, c))).toBe(1);
  });

  it('treats a field-for-field copy as unchanged', () => {
    const bWithBed = { ...b, items: [makeItem({ id: 'bed' })] };
    const copies = house({ ...a }, bWithBed, { ...c });
    expect(floorIndexAfterRestore(copies, 0, house(a, b, c))).toBe(1);
  });

  it('stays put when the floor on screen changed, or several did, or none did', () => {
    const withBed = (f: FloorLayout) => ({ ...f, items: [makeItem({ id: 'bed' })] });
    expect(floorIndexAfterRestore(house(a, withBed(b), c), 1, house(a, b, c))).toBe(1);
    expect(floorIndexAfterRestore(house(withBed(a), withBed(b), c), 2, house(a, b, c))).toBe(2);
    expect(floorIndexAfterRestore(house(a, b, c), 2, { ...house(a, b, c), name: 'Renamed' })).toBe(2);
  });
});
