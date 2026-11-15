import { describe, expect, it } from 'vitest';
import { buildNpcNav, isFreeAt } from './npc-path';
import { type SeatGround, findNpcSeats, isNpcSeat } from './npc-seats';
import type { FurnitureItem, InteriorWall } from './types';

function seat(overrides: Partial<FurnitureItem>): FurnitureItem {
  return {
    id: 's',
    type: 'chair',
    name: 'Chair',
    width: 0.5,
    depth: 0.5,
    height: 0.8,
    color: '#000',
    icon: '',
    position: { x: 0, z: 0 },
    rotation: 0,
    ...overrides,
  };
}

function unplaced(): FurnitureItem {
  const { position: _position, ...rest } = seat({});
  return rest;
}

describe('findNpcSeats', () => {
  it('puts a chair seat in front of the backrest, facing +z, with the approach outside the footprint', () => {
    const [only] = findNpcSeats([seat({})]);
    expect(only).toMatchObject({ key: 's:0', rotation: 0, seatHeight: 0.8 * 0.55 });
    expect(only!.z).toBeGreaterThan(0);
    expect(only!.approachZ).toBeGreaterThan(0.25 + 0.3);
    expect(only!.approachX).toBeCloseTo(0);
  });

  it('turns with the item', () => {
    const [only] = findNpcSeats([seat({ rotation: Math.PI / 2 })]);
    // A quarter turn points local +z along world +x.
    expect(only!.approachX).toBeGreaterThan(0.5);
    expect(only!.approachZ).toBeCloseTo(0);
  });

  it('gives a sofa a slot per sitter along its width', () => {
    const slots = findNpcSeats([seat({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9 })]);
    expect(slots.map((s) => s.key)).toEqual(['sofa:0', 'sofa:1', 'sofa:2']);
    expect(slots[0]!.x).toBeLessThan(slots[2]!.x);
  });

  it('sits on the end of a bed, away from the headboard (#617)', () => {
    const slots = findNpcSeats([seat({ id: 'bed', type: 'bed', width: 2, depth: 1.6, height: 0.6 })]);
    expect(slots.map((s) => s.itemType)).toEqual(['bed', 'bed', 'bed']);
    expect(slots[0]!.z).toBeCloseTo(0.8 - 0.25);
    expect(slots[0]!.approachZ).toBeGreaterThan(0.8);
  });

  it('skips corner sofas, unplaced seats and things that are not seats', () => {
    expect(isNpcSeat({ type: 'sofa', sofaShape: 'L-shape' })).toBe(false);
    expect(findNpcSeats([unplaced(), seat({ type: 'table' })])).toEqual([]);
  });

  describe('a chair pushed in (#904)', () => {
    const item = (id: string, type: string, x: number, z: number, width: number, depth: number, rotation = 0): FurnitureItem =>
      seat({ id, type, name: id, width, depth, height: type.includes('chair') ? 0.9 : 0.75, position: { x, z }, rotation });
    /** The storey's nav, as the walkers' hook hands it over. */
    function ground(items: FurnitureItem[], walls: InteriorWall[] = []): SeatGround {
      const nav = buildNpcNav({ items, interiorWalls: walls, keepOut: [], roomWidth: 8, roomDepth: 8 })!;
      return { isFree: (x, z) => isFreeAt(nav, x, z), blockers: nav.colliders };
    }
    const seatsAt = (items: FurnitureItem[], walls: InteriorWall[] = []) => findNpcSeats(items, ground(items, walls));
    const frontOf = (items: FurnitureItem[], id: string) => findNpcSeats(items).find((found) => found.itemId === id)!;

    it('at a desk, is entered from the side, the walk in clear of the desk', () => {
      // The office template: the chair a little out from the desk, facing it.
      const items = [item('desk', 'desk', 0, -0.8, 1.2, 0.6), item('chair', 'chair', 0, 0, 0.5, 0.5, Math.PI)];
      const [chair] = seatsAt(items);
      // Its front (−z) is under the desk; facing −z, its right is −x.
      expect(chair!.approachX).toBeCloseTo(-(0.25 + 0.35));
      expect(chair!.approachZ).toBeCloseTo(0);
    });

    it('comes in from behind when both sides are blocked too', () => {
      const items = [
        item('desk', 'desk', 0, -0.8, 1.2, 0.6),
        item('chair', 'chair', 0, 0, 0.5, 0.5, Math.PI),
        item('left', 'bookshelf', -0.8, 0, 0.6, 0.6),
        item('right', 'bookshelf', 0.8, 0, 0.6, 0.6),
      ];
      const chair = seatsAt(items).find((found) => found.itemId === 'chair')!;
      expect(chair.approachX).toBeCloseTo(0);
      expect(chair.approachZ).toBeCloseTo(0.25 + 0.35);
    });

    it('tucked in at both ends of a table, keeps its blocked front: its feet would be under the table', () => {
      // The kitchen template's table and chairs.
      const items = [
        item('table', 'dining-table', 0, 0.6, 1.8, 1.0),
        item('c1', 'dining-chair', -0.7, 0.6, 0.45, 0.45, Math.PI / 2),
        item('c2', 'dining-chair', 0.7, 0.6, 0.45, 0.45, -Math.PI / 2),
      ];
      const seats = seatsAt(items);
      for (const id of ['c1', 'c2']) {
        const found = seats.find((candidate) => candidate.itemId === id)!;
        expect(found.approachX).toBeCloseTo(frontOf(items, id).approachX);
        expect(found.approachZ).toBeCloseTo(frontOf(items, id).approachZ);
      }
    });

    it('three along one side of a table keep their blocked fronts', () => {
      const items = [item('table', 'dining-table', 0, 0.3, 1.8, 1.0)];
      for (const [id, x] of [['a', -0.6], ['b', 0], ['c', 0.6]] as const) items.push(item(id, 'dining-chair', x, 0.85, 0.45, 0.45, Math.PI));
      const seats = seatsAt(items);
      for (const id of ['a', 'b', 'c']) {
        const found = seats.find((candidate) => candidate.itemId === id)!;
        expect([found.approachX, found.approachZ]).toEqual([frontOf(items, id).approachX, frontOf(items, id).approachZ]);
      }
    });

    it('never comes in through a partition', () => {
      // A desk chair against a partition along x = −0.35: its right side is
      // the far side of the wall, so it is entered from the left.
      const walls: InteriorWall[] = [{ id: 'w', x1: -0.35, z1: -3, x2: -0.35, z2: 3 }];
      const items = [item('desk', 'desk', 0.3, -0.8, 1.2, 0.6), item('chair', 'chair', 0, 0, 0.5, 0.5, Math.PI)];
      const chair = seatsAt(items, walls).find((found) => found.itemId === 'chair')!;
      expect(chair.approachX).toBeGreaterThan(0);
      // Boxed in by the wall, the desk and a cabinet: the front stays (blocked), and it is passed over.
      const boxed = [...items, item('cab', 'bookshelf', 0.8, 0, 0.6, 0.6), item('back', 'bookshelf', 0, 0.8, 1.2, 0.4)];
      const stuck = seatsAt(boxed, walls).find((found) => found.itemId === 'chair')!;
      expect([stuck.approachX, stuck.approachZ]).toEqual([frontOf(boxed, 'chair').approachX, frontOf(boxed, 'chair').approachZ]);
    });

    it('leaves a sofa, a free front, and no ground at all alone', () => {
      const desk = [item('chair', 'chair', 0, 0, 0.5, 0.5, Math.PI)];
      expect(seatsAt(desk)).toEqual(findNpcSeats(desk));
      const sofa = [item('desk', 'desk', 0, -0.9, 1.2, 0.6), seat({ type: 'sofa', width: 0.6, rotation: Math.PI })];
      expect(seatsAt(sofa)).toEqual(findNpcSeats(sofa));
    });
  });
});
