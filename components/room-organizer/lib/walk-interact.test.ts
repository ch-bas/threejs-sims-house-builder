import { describe, expect, it } from 'vitest';
import { SEATED_EYE, findSeat, isSeat, seatPose } from './walk-interact';
import type { FurnitureItem } from './types';

function item(overrides: Partial<FurnitureItem> & { type: string; position: { x: number; z: number } }): FurnitureItem {
  return { id: overrides.type, name: overrides.type, width: 1, depth: 1, height: 1, color: '#000', icon: '', rotation: 0, ...overrides };
}

const SOFA = item({ id: 'sofa', type: 'sofa', name: 'Sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: 0 } });
const TV = item({ id: 'tv', type: 'tv', width: 1.5, depth: 0.4, height: 0.5, position: { x: 0.4, z: 2.5 }, rotation: Math.PI });
const CHAIR = item({ id: 'chair', type: 'chair', width: 0.5, depth: 0.5, height: 0.8, position: { x: 3, z: 0 } });
const TABLE = item({ id: 'table', type: 'dining-table', width: 1.6, depth: 0.9, height: 0.75, position: { x: 0, z: -2 } });

describe('isSeat', () => {
  it('knows what you can sit on', () => {
    expect(['chair', 'dining-chair', 'armchair', 'sofa', 'bench', 'garden-bench', 'bed', 'toilet'].every((type) => isSeat({ type }))).toBe(true);
    expect(isSeat({ type: 'dining-table' })).toBe(false);
  });
});

describe('findSeat (#463b)', () => {
  const items = [SOFA, TV, CHAIR, TABLE];

  it('finds the sofa in front of the walker', () => {
    expect(findSeat(items, 0, 1.2, 0, -1)?.id).toBe('sofa');
  });

  it('ignores a seat behind the walker unless it is right there', () => {
    expect(findSeat(items, 0, 1.4, 0, 1)).toBeNull();
    expect(findSeat(items, 0, 0.8, 0, 1)?.id).toBe('sofa');
  });

  it('ignores a seat out of reach, and things that are not seats', () => {
    expect(findSeat(items, -3, -3, 1, 0)).toBeNull();
    expect(findSeat([TABLE], 0, -1, 0, -1)).toBeNull();
  });

  it('prefers the seat straight ahead', () => {
    const other = { ...CHAIR, id: 'chair-2', position: { x: -0.9, z: 1.6 } };
    expect(findSeat([SOFA, other], 0, 1.5, 0, -1)?.id).toBe('sofa');
  });
});

describe('seatPose (#463b)', () => {
  it('sits on the sofa and faces the TV', () => {
    const pose = seatPose(SOFA, [SOFA, TV], 0)!;
    expect(pose.eyeY).toBeCloseTo(0.42 + SEATED_EYE, 9);
    expect(pose.z).toBeCloseTo(0.09, 9);
    expect([pose.lookX, pose.lookZ]).toEqual([0.4, 2.5]);
    expect(pose.lookY).toBeCloseTo(0.85, 9);
  });

  it('with no TV in front, looks the way the seat faces', () => {
    const turned = { ...SOFA, rotation: Math.PI / 2 };
    const pose = seatPose(turned, [turned, TV], 3)!;
    expect(pose.lookX - pose.x).toBeCloseTo(3, 9);
    expect(pose.lookZ - pose.z).toBeCloseTo(0, 9);
    expect(pose.lookY).toBe(pose.eyeY);
    expect(pose.eyeY).toBeCloseTo(3 + 0.42 + SEATED_EYE, 9);
  });

  it('caps the seat at a low item’s own height', () => {
    const bench = item({ id: 'bench', type: 'bench', height: 0.3, position: { x: 0, z: 0 } });
    expect(seatPose(bench, [bench], 0)!.eyeY).toBeCloseTo(0.3 + SEATED_EYE, 9);
  });

  it('is null for something you cannot sit on', () => {
    expect(seatPose(TABLE, [TABLE], 0)).toBeNull();
  });
});
