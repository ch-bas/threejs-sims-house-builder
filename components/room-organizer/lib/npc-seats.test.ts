import { describe, expect, it } from 'vitest';
import { findNpcSeats, isNpcSeat } from './npc-seats';
import type { FurnitureItem } from './types';

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

  it('skips corner sofas, unplaced seats and things that are not seats', () => {
    expect(isNpcSeat({ type: 'sofa', sofaShape: 'L-shape' })).toBe(false);
    expect(findNpcSeats([unplaced(), seat({ type: 'table' })])).toEqual([]);
  });
});
