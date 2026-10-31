import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../__testfixtures__/fixtures';
import { DEFAULT_VISION_FOV_DEG, DEFAULT_VISION_RANGE_M } from '../constants';
import {
  buildingContentBounds,
  buildingFrameBounds,
  clipArc,
  clipSegment,
  COVERAGE_MARGIN_M,
  coverageExtents,
  coverageRings,
  formatDimension,
  growBounds,
  interiorWallDimensions,
  itemSchedule,
  planContentBounds,
  planFrameBounds,
  polarPoint,
  roomDimensions,
  visionWedges,
} from './plan-geometry';

describe('planContentBounds', () => {
  it('ignores wall-mounted items — openings and cameras (#401)', () => {
    const camera = makeItem({ id: 'cam', type: 'security-camera', width: 0.25, depth: 0.2, position: { x: 3.9, z: -3.9 }, rotation: (3 * Math.PI) / 4 });
    const door = makeItem({ id: 'door', type: 'door', width: 0.9, depth: 0.1, position: { x: 0, z: -4 } });
    const floor = makeFloor({ items: [camera, door] });
    expect(planContentBounds(makeLayout({ floors: [floor] }), floor)).toEqual({ minX: -4, minZ: -4, maxX: 4, maxZ: 4 });
  });

  it('still follows free-standing outdoor items (#287)', () => {
    const tree = makeItem({ id: 'tree', type: 'tree', width: 1.4, depth: 1.4, position: { x: 0, z: 6.7 } });
    const floor = makeFloor({ items: [tree] });
    expect(planContentBounds(makeLayout({ floors: [floor] }), floor).maxZ).toBeCloseTo(7.4);
  });
});

describe('buildingContentBounds', () => {
  it('unions every floor’s content (#405)', () => {
    const west = makeItem({ id: 'w', type: 'pool', width: 4, depth: 2, position: { x: -7, z: 0 } });
    const south = makeItem({ id: 's', type: 'tree', width: 1, depth: 1, position: { x: 0, z: 6 } });
    const layout = makeLayout({ floors: [makeFloor({ id: 'g', items: [west] }), makeFloor({ id: 'f', items: [south] })] });
    expect(buildingContentBounds(layout)).toEqual({ minX: -9, minZ: -4, maxX: 4, maxZ: 6.5 });
    expect(growBounds(buildingContentBounds(layout), 1)).toEqual({ minX: -10, minZ: -5, maxX: 5, maxZ: 7.5 });
  });
});

describe('coverage maths (#420)', () => {
  it('rings Wi-Fi and CCTV units at a third, two thirds and the full range', () => {
    const items = [
      makeItem({ id: 'ap', type: 'wifi', position: { x: 1, z: 2 }, isWiFiAccessPoint: true, signalRange: 9 }),
      makeItem({ id: 'cctv', type: 'cctv', position: { x: 0, z: 0 }, isCCTV: true, signalRange: 3 }),
      makeItem({ id: 'mute', type: 'wifi', position: { x: 0, z: 0 }, isWiFiAccessPoint: true }),
      makeUnplacedItem({ id: 'tray', type: 'wifi', isWiFiAccessPoint: true, signalRange: 5 }),
    ];
    expect(coverageRings(items)).toEqual([
      { kind: 'wifi', center: { x: 1, z: 2 }, radii: [3, 6, 9] },
      { kind: 'cctv', center: { x: 0, z: 0 }, radii: [1, 2, 3] },
    ]);
  });

  it('turns the wedge with the camera, and falls back to the 3D cone defaults (#401)', () => {
    // Rotation 0 faces +z (down the plan): centre angle π/2.
    const [south] = visionWedges([makeItem({ type: 'security-camera', position: { x: 0, z: 0 }, hasVisionCone: true, visionRange: 5, visionFov: 90 })]);
    expect(south!.radius).toBe(5);
    expect(south!.startAngle).toBeCloseTo(Math.PI / 4);
    expect(south!.endAngle).toBeCloseTo((3 * Math.PI) / 4);
    expect(south!.full).toBe(false);
    const tip = polarPoint(south!.apex, 5, (south!.startAngle + south!.endAngle) / 2);
    expect(tip.x).toBeCloseTo(0);
    expect(tip.z).toBeCloseTo(5);

    const [bare] = visionWedges([makeItem({ type: 'security-camera', position: { x: 0, z: 0 }, hasVisionCone: true })]);
    expect(bare!.radius).toBe(DEFAULT_VISION_RANGE_M);
    expect(bare!.endAngle - bare!.startAngle).toBeCloseTo((DEFAULT_VISION_FOV_DEG * Math.PI) / 180);

    const [dome] = visionWedges([makeItem({ type: 'security-camera', position: { x: 0, z: 0 }, hasVisionCone: true, visionFov: 360 })]);
    expect(dome!.full).toBe(true);
    expect(visionWedges([makeItem({ type: 'security-camera', position: { x: 0, z: 0 } })])).toEqual([]);
  });
});

describe('coverage frame and clipping (#420)', () => {
  const rect = { minX: -4, minZ: -4, maxX: 4, maxZ: 4 };

  it('grows the frame for coverage, capped 5 m past the content unless full', () => {
    // A 30 m camera mounted on the outside of the south wall, facing the garden.
    const cam = makeItem({ id: 'c', type: 'security-camera', width: 0.25, depth: 0.2, position: { x: 0, z: 4.12 }, rotation: 0, hasVisionCone: true, visionRange: 30, visionFov: 90 });
    const floor = makeFloor({ items: [cam] });
    const layout = makeLayout({ floors: [floor] });
    // Outside the walls, so the camera itself is content.
    const content = planContentBounds(layout, floor);
    expect(content.maxZ).toBeGreaterThan(4.2);
    expect(planFrameBounds(layout, floor, 'off')).toEqual(content);
    const capped = planFrameBounds(layout, floor);
    expect(capped.maxZ).toBeCloseTo(content.maxZ + COVERAGE_MARGIN_M);
    expect(capped.minX).toBeCloseTo(-4 - COVERAGE_MARGIN_M);
    expect(capped.minZ).toBe(-4); // nothing reaches north
    const full = planFrameBounds(layout, floor, 'full');
    expect(full.maxZ).toBeCloseTo(4.12 + 30);
    // No coverage, no growth.
    const plain = makeFloor({ items: [makeItem()] });
    expect(planFrameBounds(makeLayout({ floors: [plain] }), plain)).toEqual({ minX: -4, minZ: -4, maxX: 4, maxZ: 4 });
  });

  it('unions every floor’s frame for the building', () => {
    const ap = makeItem({ id: 'ap', type: 'wifi', position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 6 });
    const layout = makeLayout({ floors: [makeFloor({ id: 'g', items: [ap] }), makeFloor({ id: 'f' })] });
    expect(buildingFrameBounds(layout)).toEqual({ minX: -6, minZ: -6, maxX: 6, maxZ: 6 });
    expect(buildingFrameBounds(layout, 'off')).toEqual({ minX: -4, minZ: -4, maxX: 4, maxZ: 4 });
  });

  it('extents a wedge by its arc, not its whole circle', () => {
    // Facing south (π/2) ± 45°, radius 2 from the origin.
    const cam = makeItem({ type: 'security-camera', position: { x: 0, z: 0 }, hasVisionCone: true, visionRange: 2, visionFov: 90 });
    const ext = coverageExtents([cam])!;
    expect(ext.minZ).toBeCloseTo(0);
    expect(ext.maxZ).toBeCloseTo(2);
    expect(ext.maxX).toBeCloseTo(Math.SQRT2);
    expect(coverageExtents([makeItem()])).toBeNull();
  });

  it('clips segments to the rectangle', () => {
    expect(clipSegment({ x: 0, z: 0 }, { x: 10, z: 0 }, rect)).toEqual({ from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });
    expect(clipSegment({ x: 5, z: 5 }, { x: 9, z: 9 }, rect)).toBeNull();
    expect(clipSegment({ x: -1, z: 1 }, { x: 1, z: -1 }, rect)).toEqual({ from: { x: -1, z: 1 }, to: { x: 1, z: -1 } });
    // Zero-length results draw nothing: a point, and a segment touching only a corner.
    expect(clipSegment({ x: 1, z: 1 }, { x: 1, z: 1 }, rect)).toBeNull();
    expect(clipSegment({ x: 4, z: 4 }, { x: 6, z: 6 }, rect)).toBeNull();
  });

  it('clips arcs to the rectangle', () => {
    const whole = clipArc({ x: 0, z: 0 }, 2, 0, 2 * Math.PI, rect);
    expect(whole).toHaveLength(1);
    expect(whole[0]![1] - whole[0]![0]).toBeCloseTo(2 * Math.PI);
    // A 5 m circle at the centre leaves four corner arcs inside the 8 m square.
    const corners = clipArc({ x: 0, z: 0 }, 5, 0, 2 * Math.PI, rect);
    expect(corners).toHaveLength(4);
    for (const [a, b] of corners) {
      expect(b - a).toBeCloseTo(2 * Math.asin(4 / 5) - Math.PI / 2);
    }
    // A quarter arc partly outside: from 0 (east) to π/2 (south), radius 5 about (0, 0) — only the middle is inside.
    const quarter = clipArc({ x: 0, z: 0 }, 5, 0, Math.PI / 2, rect);
    expect(quarter).toHaveLength(1);
    expect(quarter[0]![0]).toBeCloseTo(Math.acos(4 / 5));
    expect(quarter[0]![1]).toBeCloseTo(Math.asin(4 / 5));
    expect(clipArc({ x: 20, z: 20 }, 1, 0, 2 * Math.PI, rect)).toEqual([]);
  });
});

describe('dimensions (#424)', () => {
  it('formats to two decimals', () => {
    expect(formatDimension(4)).toBe('4.00 m');
    expect(formatDimension(2.345)).toBe('2.35 m');
    expect(formatDimension(-0.001)).toBe('0.00 m');
  });

  it('measures the room along its south and west edges', () => {
    const { width, depth } = roomDimensions({ width: 6, height: 4 });
    expect(width).toEqual({ from: { x: -3, z: 2 }, to: { x: 3, z: 2 }, lengthM: 6, label: '6.00 m' });
    expect(depth).toEqual({ from: { x: -3, z: -2 }, to: { x: -3, z: 2 }, lengthM: 4, label: '4.00 m' });
  });

  it('dimensions interior walls, skipping stubs too short to label', () => {
    const floor = makeFloor({
      interiorWalls: [
        { id: 'a', x1: 0, z1: 0, x2: 3, z2: 4 },
        { id: 'b', x1: 0, z1: 0, x2: 0.2, z2: 0 },
      ],
    });
    // Left-hand normal of (0.6, 0.8) in the x-right / z-down plane: (−0.8, 0.6).
    expect(interiorWallDimensions(floor)).toEqual([
      { from: { x: 0, z: 0 }, to: { x: 3, z: 4 }, lengthM: 5, label: '5.00 m', normal: { x: -0.8, z: 0.6 }, labelShiftM: 0 },
    ]);
  });

  it('puts a wall’s dimension on the side clear of item footprints', () => {
    // A wall running south along x = 0: its left-hand side is west (−x).
    const wall = { id: 'w', x1: 0, z1: -2, x2: 0, z2: 2 };
    expect(interiorWallDimensions(makeFloor({ interiorWalls: [wall] }))[0]!.normal).toEqual({ x: -1, z: 0 });
    // A desk hard against its west face: the label moves east.
    const desk = makeItem({ id: 'd', name: 'Desk', width: 1.2, depth: 0.6, position: { x: -0.5, z: 0 } });
    expect(interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [desk] }))[0]!.normal).toEqual({ x: 1, z: 0 });
  });

  describe('door swings (#592)', () => {
    // A wall running south along x = 0, so the label's default side is west.
    const wall = { id: 'w', x1: 0, z1: -3, x2: 0, z2: 3 };
    const door = (rotation: number, z = 0) =>
      makeItem({ id: `d${z}`, type: 'door', width: 0.9, depth: 0.1, position: { x: 0, z }, rotation });
    const SWING_WEST = -Math.PI / 2;
    const SWING_EAST = Math.PI / 2;

    it('moves the label off the side the door swings into', () => {
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [door(SWING_WEST)] }));
      expect(dim!.normal).toEqual({ x: 1, z: 0 });
      expect(dim!.labelShiftM).toBe(0);
    });

    it('leaves the label alone when the door swings away from it', () => {
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [door(SWING_EAST)] }));
      expect(dim!.normal).toEqual({ x: -1, z: 0 });
      expect(dim!.labelShiftM).toBe(0);
    });

    it('does not count a window, which has no swing', () => {
      const window = makeItem({ id: 'win', type: 'window', width: 0.9, depth: 0.1, position: { x: 0, z: 0 }, rotation: SWING_WEST });
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [window] }));
      expect(dim!.normal).toEqual({ x: -1, z: 0 });
    });

    it('slides the label along the wall when both sides are crowded', () => {
      const desk = makeItem({ id: 'desk', name: 'Desk', width: 0.8, depth: 0.8, position: { x: 0.5, z: 0 } });
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [door(SWING_WEST), desk] }));
      // Clear of the swing's 0.45 m half-width and the 0.25 m clearance, label end included.
      expect(Math.abs(dim!.labelShiftM)).toBeGreaterThanOrEqual(0.45 + 0.25 + 0.35);
      expect(Math.abs(dim!.labelShiftM)).toBeLessThanOrEqual(3 - 0.35);
    });

    it('sees a swing that only the end of the label would touch', () => {
      const off = door(SWING_WEST, 0.9);
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [wall], items: [off] }));
      expect(dim!.normal).toEqual({ x: 1, z: 0 });
    });

    it('stays at the middle when no spot along a short wall is clear', () => {
      const short = { id: 's', x1: 0, z1: -0.5, x2: 0, z2: 0.5 };
      const desk = makeItem({ id: 'desk', name: 'Desk', width: 0.8, depth: 3, position: { x: 0.5, z: 0 } });
      const wide = makeItem({ id: 'door', type: 'door', width: 2, depth: 0.1, position: { x: 0, z: 0 }, rotation: SWING_WEST });
      const [dim] = interiorWallDimensions(makeFloor({ interiorWalls: [short], items: [wide, desk] }));
      expect(dim!.labelShiftM).toBe(0);
    });
  });
});

describe('itemSchedule (#424)', () => {
  it('groups identical placed items, totals the price and sorts by name', () => {
    const rows = itemSchedule([
      makeItem({ id: '1', name: 'Sofa', type: 'sofa', width: 2, depth: 0.9, price: 500 }),
      makeItem({ id: '2', name: 'Chair', price: 40 }),
      makeItem({ id: '3', name: 'Chair', price: 40 }),
      makeItem({ id: '4', name: 'Chair', price: 60 }),
      makeUnplacedItem({ id: '5', name: 'Chair', price: 40 }),
      makeItem({ id: '6', name: 'Rug', type: 'rug' }),
    ]);
    expect(rows.map((r) => [r.name, r.count, r.unitPrice, r.totalPrice])).toEqual([
      ['Chair', 2, 40, 80],
      ['Chair', 1, 60, 60],
      ['Rug', 1, 0, 0],
      ['Sofa', 1, 500, 500],
    ]);
    expect(rows[3]).toMatchObject({ width: 2, depth: 0.9, height: 1 });
  });
});
