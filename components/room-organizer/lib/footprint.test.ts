import { describe, expect, it } from 'vitest';
import { buildingArea, clampToFootprint, cutoutFits, cutoutRect, footprintOutline, isFootprintCutout, isInsideBuilding, onFootprintEdge, shellWalls, shellWallSpan } from './footprint';
import { INTERIOR_WALL_THICKNESS } from './opening-snap';
import { buildWalkColliders } from './walk-collision';
import type { FootprintCorner } from './types';

describe('clampToFootprint (#451)', () => {
  it('keeps an item inside the room by its rotated footprint', () => {
    const sofa = { width: 2, depth: 1, rotation: 0 };
    expect(clampToFootprint(sofa, { x: 10, z: -10 }, 8, 6)).toEqual({ x: 3, z: -2.5 });
    // A quarter turn swaps the extents.
    const turned = clampToFootprint({ ...sofa, rotation: Math.PI / 2 }, { x: 10, z: -10 }, 8, 6);
    expect(turned.x).toBeCloseTo(3.5);
    expect(turned.z).toBeCloseTo(-2);
  });

  it('leaves a position that already fits alone', () => {
    expect(clampToFootprint({ width: 1, depth: 1 }, { x: 1.25, z: -0.5 }, 8, 6)).toEqual({ x: 1.25, z: -0.5 });
  });

  it('centres an item wider than the room instead of flipping it past the far wall', () => {
    expect(clampToFootprint({ width: 10, depth: 1 }, { x: 3, z: 0 }, 8, 6)).toEqual({ x: 0, z: 0 });
  });
});

describe('the L-shaped footprint (#727)', () => {
  const house = (corner: FootprintCorner) => ({ width: 10, height: 8, cutout: { corner, width: 4, depth: 3 } });

  it('is the plain rectangle without a cut', () => {
    const plain = { width: 10, height: 8 };
    expect(footprintOutline(plain)).toEqual([
      { x: -5, z: -4 },
      { x: 5, z: -4 },
      { x: 5, z: 4 },
      { x: -5, z: 4 },
    ]);
    expect(shellWalls(plain).map((wall) => wall.id)).toEqual(['north', 'south', 'west', 'east']);
    expect(cutoutRect(plain)).toBeNull();
    expect(buildingArea(plain)).toBe(80);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('walks the %s outline clockwise as six right angles', (corner) => {
    const outline = footprintOutline(house(corner));
    expect(outline).toHaveLength(6);
    let area = 0;
    outline.forEach((point, index) => {
      const next = outline[(index + 1) % outline.length]!;
      expect(point.x === next.x || point.z === next.z).toBe(true);
      area += point.x * next.z - next.x * point.z;
    });
    // Clockwise on the plan (x right, z down) is a positive shoelace.
    expect(area / 2).toBeCloseTo(68);
    expect(buildingArea(house(corner))).toBe(68);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('closes the %s shell: the walls trace the outline', (corner) => {
    const walls = shellWalls(house(corner));
    expect(walls).toHaveLength(6);
    // An L has the perimeter of its rectangle.
    expect(walls.reduce((sum, wall) => sum + shellWallSpan(wall).length, 0)).toBeCloseTo(36);
    const outline = footprintOutline(house(corner));
    const onOutline = (x: number, z: number) => outline.some((point) => point.x === x && point.z === z);
    for (const wall of walls) {
      expect(onOutline(wall.x1, wall.z1)).toBe(true);
      expect(onOutline(wall.x2, wall.z2)).toBe(true);
    }
  });

  it('faces the two new walls away from the house', () => {
    const walls = shellWalls(house('ne'));
    expect(walls.find((wall) => wall.id === 'notch-x')).toMatchObject({ side: 'north', z1: -1, x1: 1, x2: 5 });
    expect(walls.find((wall) => wall.id === 'notch-z')).toMatchObject({ side: 'east', x1: 1, z1: -4, z2: -1 });
    const sw = shellWalls(house('sw'));
    expect(sw.find((wall) => wall.id === 'notch-x')).toMatchObject({ side: 'south' });
    expect(sw.find((wall) => wall.id === 'notch-z')).toMatchObject({ side: 'west' });
  });

  it('knows what stands on the building', () => {
    const l = house('ne');
    expect(isInsideBuilding(l, 3, -3)).toBe(false);
    expect(isInsideBuilding(l, 0, -3)).toBe(true);
    expect(isInsideBuilding(l, 3, 0)).toBe(true);
    expect(isInsideBuilding(l, 6, 0)).toBe(false);
    expect(isInsideBuilding({ width: 10, height: 8 }, 3, -3)).toBe(true);
  });

  it('offsets the outline outwards, walls and all', () => {
    expect(footprintOutline(house('ne'), 0.5)).toEqual([
      { x: -5.5, z: -4.5 },
      { x: 1.5, z: -4.5 },
      { x: 1.5, z: -1.5 },
      { x: 5.5, z: -1.5 },
      { x: 5.5, z: 4.5 },
      { x: -5.5, z: 4.5 },
    ]);
  });

  it('clamps an item out of the cut by the shorter way', () => {
    const cutout = { corner: 'ne', width: 4, depth: 3 } as const;
    expect(clampToFootprint({ width: 1, depth: 1 }, { x: 1.2, z: -3 }, 10, 8, cutout)).toEqual({ x: 0.5, z: -3 });
    expect(clampToFootprint({ width: 1, depth: 1 }, { x: 4, z: -1.2 }, 10, 8, cutout)).toEqual({ x: 4, z: -0.5 });
    expect(clampToFootprint({ width: 1, depth: 1 }, { x: 0, z: 0 }, 10, 8, cutout)).toEqual({ x: 0, z: 0 });
  });

  it('tries the other exit when the shorter one leaves the house (review M4)', () => {
    // A 3 m bed in an 8 x 8 house with a 5 x 4 cut: the wing beside the cut is 3 m wide, so only south fits.
    const cutout = { corner: 'ne', width: 5.5, depth: 4 } as const;
    expect(clampToFootprint({ width: 3, depth: 3 }, { x: 0, z: -3 }, 8, 8, cutout)).toEqual({ x: 0, z: 1.5 });
  });

  it('only fits when both wings keep their width', () => {
    expect(cutoutFits({ width: 8, depth: 6 }, 10, 8)).toBe(true);
    expect(cutoutFits({ width: 9, depth: 3 }, 10, 8)).toBe(false);
    expect(cutoutFits({ width: 0.5, depth: 3 }, 10, 8)).toBe(false);
    expect(isFootprintCutout({ corner: 'ne', width: 2, depth: 2 })).toBe(true);
    expect(isFootprintCutout({ corner: 'up', width: 2, depth: 2 })).toBe(false);
    expect(isFootprintCutout({ corner: 'ne', width: Infinity, depth: 2 })).toBe(false);
  });
});

describe('INTERIOR_WALL_THICKNESS (#451)', () => {
  it('is the slab the walker collides with', () => {
    const colliders = buildWalkColliders([], [{ id: 'w', x1: -2, z1: 0, x2: 2, z2: 0 }], { roomWidth: 8, roomDepth: 8 });
    expect(colliders).toHaveLength(1);
    const [wall] = colliders;
    expect(wall!.hd * 2).toBeCloseTo(INTERIOR_WALL_THICKNESS);
    expect(wall!.hw * 2).toBeCloseTo(4);
  });
});

describe('onFootprintEdge (#660)', () => {
  const box = { width: 8, height: 6 };
  it('is true on each outer wall and at the corners, false inside and outside', () => {
    expect(onFootprintEdge(box, -4, 1)).toBe(true);
    expect(onFootprintEdge(box, 2, 3)).toBe(true);
    expect(onFootprintEdge(box, 4, -3)).toBe(true);
    expect(onFootprintEdge(box, -3.9995, 0)).toBe(true);
    expect(onFootprintEdge(box, -3.99, 0)).toBe(false);
    expect(onFootprintEdge(box, 0, 0)).toBe(false);
    expect(onFootprintEdge(box, 5, 0)).toBe(false);
  });

  it('counts the two walls of the cut corner, not the corner cut away', () => {
    const cut = { ...box, cutout: { corner: 'ne' as const, width: 2, depth: 2 } };
    expect(onFootprintEdge(cut, 2, -2)).toBe(true);
    expect(onFootprintEdge(cut, 2, -2.5)).toBe(true);
    expect(onFootprintEdge(cut, 3, -1)).toBe(true);
    expect(onFootprintEdge(cut, 4, -3)).toBe(false);
    expect(onFootprintEdge(cut, 3, -2.5)).toBe(false);
  });
});
