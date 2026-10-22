import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../__testfixtures__/fixtures';
import { DEFAULT_VISION_FOV_DEG, DEFAULT_VISION_RANGE_M } from '../constants';
import {
  buildingContentBounds,
  coverageRings,
  formatDimension,
  growBounds,
  interiorWallDimensions,
  itemSchedule,
  planContentBounds,
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
    expect(interiorWallDimensions(floor)).toEqual([{ from: { x: 0, z: 0 }, to: { x: 3, z: 4 }, lengthM: 5, label: '5.00 m' }]);
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
