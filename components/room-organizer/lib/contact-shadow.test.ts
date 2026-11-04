import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { contactBlob, planContactShadow, rectCorners, type ContactPlan } from './contact-shadow';
import type { FloorLayout, FurnitureItem } from './types';

const item = (type: string, over: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id: type, type, width: 2, depth: 1, height: 0.8, position: { x: 1, z: 2 }, rotation: 0, ...over });

const floor = (over: Partial<FloorLayout> = {}): FloorLayout =>
  ({ id: 'f', name: 'F', floorColor: '#fff', items: [], ...over }) as FloorLayout;

const plan = (floors: FloorLayout[], over = {}, storey = 0): ContactPlan =>
  planContactShadow({ width: 10, height: 8, floors, ...over }, storey)!;

describe('contactBlob (#754)', () => {
  it('sits an upholstered item on the floor', () => {
    expect(contactBlob(item('sofa'))).toMatchObject({ x: 1, z: 2, width: 2, depth: 1, raised: false });
  });

  it('marks a piece on legs as raised, so it gets the weaker, wider patch', () => {
    expect(contactBlob(item('dining-table'))?.raised).toBe(true);
  });

  it.each(['rug', 'painting', 'pendant-light', 'door', 'window', 'computer', 'person', 'no-such-type'])('leaves %s out', (type) => {
    expect(contactBlob(item(type))).toBeNull();
  });

  it('leaves an unplaced item out', () => {
    const { position: _position, ...unplaced } = item('sofa');
    expect(contactBlob(unplaced as FurnitureItem)).toBeNull();
  });
});

describe('planContactShadow (#754)', () => {
  it('runs a band along the four shell walls and every partition', () => {
    const interiorWalls = [{ id: 'w', x1: 0, z1: -4, x2: 0, z2: 4 }];
    expect(plan([floor({ interiorWalls })]).walls).toHaveLength(5);
  });

  it('follows an L-shaped footprint and wipes its missing corner', () => {
    const cutout = { corner: 'ne', width: 4, depth: 3 } as const;
    const lShape = plan([floor()], { cutout });
    expect(lShape.walls).toHaveLength(6);
    const [hole] = lShape.holes;
    expect(hole).toBeDefined();
    const corners = rectCorners(hole!);
    // Covers the notch's far corner of the building.
    expect(Math.max(...corners.map(([x]) => x))).toBeGreaterThanOrEqual(5);
    expect(Math.min(...corners.map(([, z]) => z))).toBeLessThanOrEqual(-4);
  });

  it('opens the band at a door', () => {
    const door = item('door', { width: 0.9, depth: 0.12, position: { x: 0, z: 4 }, rotation: Math.PI });
    const { doors } = plan([floor({ items: [door] })]);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ x: 0, z: 4, width: 0.9 });
    expect(doors[0]!.depth).toBeGreaterThan(0.5);
  });

  it('wipes the stairwell the stairs below cut in the storey above', () => {
    const stairs = item('stairs', { width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 } });
    const floors = [floor({ items: [stairs] }), floor({ id: 'g' })];
    expect(plan(floors, {}, 0).holes).toEqual([]);
    expect(plan(floors, {}, 1).holes.length).toBeGreaterThan(0);
  });

  it.each([undefined, 'winder'] as const)('grounds %s stairs across their whole footprint', (stairsShape) => {
    const stairs = item('stairs', { width: 2, depth: 2.6, height: 3, position: { x: 1, z: 0 }, ...(stairsShape ? { stairsShape } : {}) });
    expect(plan([floor({ items: [stairs] }), floor({ id: 'g' })], {}, 0).blobs).toEqual([
      { id: 'stairs', x: 1, z: 0, width: 2, depth: 2.6, rotation: 0, raised: false },
    ]);
  });

  it('runs no band along a shell wall the user took down, and keys on it', () => {
    const shown = plan([floor()]);
    const hidden = plan([floor({ hiddenWalls: ['north'] })]);
    expect(hidden.walls).toHaveLength(3);
    expect(hidden.walls.some((wall) => wall.z1 === -4 && wall.z2 === -4)).toBe(false);
    expect(JSON.stringify(hidden)).not.toBe(JSON.stringify(shown));
  });

  it('drops both walls on a hidden side of an L', () => {
    const cutout = { corner: 'ne', width: 4, depth: 3 } as const;
    expect(plan([floor({ hiddenWalls: ['north'] })], { cutout }).walls).toHaveLength(4);
  });

  it('lifts an upper storey to its elevation', () => {
    const floors = [floor({ height: 2.5 }), floor({ id: 'g' })];
    expect(plan(floors, {}, 0).floorY).toBe(0);
    expect(plan(floors, {}, 1).floorY).toBeGreaterThan(2);
  });

  it('keeps the same key for an edit that changes nothing here', () => {
    const sofa = item('sofa');
    const a = JSON.stringify(plan([floor({ items: [sofa], floorColor: '#111' })]));
    const b = JSON.stringify(plan([floor({ items: [{ ...sofa, color: '#123456', name: 'Other' }], floorColor: '#222' })]));
    expect(b).toBe(a);
  });

  it('changes the key when a footprint moves or turns', () => {
    const sofa = item('sofa');
    const a = JSON.stringify(plan([floor({ items: [sofa] })]));
    expect(JSON.stringify(plan([floor({ items: [{ ...sofa, position: { x: 2, z: 2 } }] })]))).not.toBe(a);
    expect(JSON.stringify(plan([floor({ items: [{ ...sofa, rotation: 1 }] })]))).not.toBe(a);
  });

  it('returns nothing for a storey that does not exist', () => {
    expect(planContactShadow({ width: 10, height: 8, floors: [floor()] }, 3)).toBeNull();
  });
});

describe('rectCorners (#754)', () => {
  it('turns a corner the way a mesh turns about +Y', () => {
    const corners = rectCorners({ x: 0, z: 0, width: 2, depth: 0, rotation: Math.PI / 2 });
    // A mesh's +X end swings to −Z under a quarter turn.
    expect(corners[1]![0]).toBeCloseTo(0, 6);
    expect(corners[1]![1]).toBeCloseTo(-1, 6);
  });
});
