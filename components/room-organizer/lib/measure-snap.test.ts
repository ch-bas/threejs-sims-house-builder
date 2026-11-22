import { describe, expect, it } from 'vitest';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeItem } from './__testfixtures__/fixtures';
import { snapMeasurePoint, type MeasureSnapTargets } from './measure-snap';
import { INTERIOR_WALL_THICKNESS } from './opening-snap';
import type { InteriorWall } from './types';

const building = { width: 8, height: 6 };
const wall: InteriorWall = { id: 'w1', x1: 0, z1: -3, x2: 0, z2: 1 };
const sofa = makeItem({ id: 'sofa', width: 2, depth: 1, position: { x: -2, z: 1 } });

function targets(overrides: Partial<MeasureSnapTargets> = {}): MeasureSnapTargets {
  return { floor: { items: [sofa], interiorWalls: [wall] }, building, reach: 0.2, ...overrides };
}

describe('snapMeasurePoint (#921)', () => {
  it('catches on the house corners and a wall end', () => {
    expect(snapMeasurePoint({ x: 3.9, z: 2.9 }, targets())).toEqual({ point: { x: 4, z: 3 }, kind: 'corner' });
    expect(snapMeasurePoint({ x: 0.1, z: 1.05 }, targets())).toEqual({ point: { x: 0, z: 1 }, kind: 'corner' });
  });

  it('catches on an item centre, its corners and the middle of its sides', () => {
    expect(snapMeasurePoint({ x: -2.1, z: 1.1 }, targets())).toEqual({ point: { x: -2, z: 1 }, kind: 'centre' });
    expect(snapMeasurePoint({ x: -3.05, z: 0.45 }, targets())).toEqual({ point: { x: -3, z: 0.5 }, kind: 'corner' });
    expect(snapMeasurePoint({ x: -2.05, z: 1.55 }, targets())).toEqual({ point: { x: -2, z: 1.5 }, kind: 'edge' });
  });

  it('catches on the line of an item side, a wall face or the outline when no point is near', () => {
    const side = snapMeasurePoint({ x: -1.4, z: 1.6 }, targets());
    expect(side.kind).toBe('edge');
    expect(side.point.x).toBeCloseTo(-1.4);
    expect(side.point.z).toBeCloseTo(1.5);
    // The east face of the partition, not its centreline: a gap measured to it is the clear gap.
    const face = snapMeasurePoint({ x: 0.2, z: -1 }, targets());
    expect(face.kind).toBe('wall');
    expect(face.point.x).toBeCloseTo(INTERIOR_WALL_THICKNESS / 2);
    expect(face.point.z).toBeCloseTo(-1);
    const shell = snapMeasurePoint({ x: 2, z: -2.9 }, targets());
    expect(shell).toMatchObject({ kind: 'wall', point: { x: 2, z: -3 } });
  });

  it('a corner beats a nearer line', () => {
    // 0.02 m from the sofa's top edge, 0.15 m from its corner.
    expect(snapMeasurePoint({ x: -2.85, z: 0.52 }, targets()).kind).toBe('corner');
  });

  it('leaves a point with nothing in reach, or with no reach, where it is', () => {
    expect(snapMeasurePoint({ x: 2, z: -1 }, targets())).toEqual({ point: { x: 2, z: -1 }, kind: 'none' });
    expect(snapMeasurePoint({ x: 3.95, z: 2.95 }, targets({ reach: 0 }))).toEqual({ point: { x: 3.95, z: 2.95 }, kind: 'none' });
    // Out in the garden there is nothing to catch on: no clamp to the house.
    expect(snapMeasurePoint({ x: 9, z: 9 }, targets())).toEqual({ point: { x: 9, z: 9 }, kind: 'none' });
  });

  it('follows the L: the cut corner snaps, the old corner does not', () => {
    const cut = { ...building, cutout: { corner: 'ne' as const, width: 3, depth: 2 } };
    expect(snapMeasurePoint({ x: 3.95, z: -2.95 }, targets({ building: cut })).kind).toBe('none');
    expect(snapMeasurePoint({ x: 1.05, z: -1.05 }, targets({ building: cut }))).toEqual({ point: { x: 1, z: -1 }, kind: 'corner' });
  });

  it('snaps a pointer over a full floor within a frame budget', () => {
    const items = Array.from({ length: 300 }, (_, index) => makeItem({ id: `i${index}`, position: { x: (index % 20) - 10, z: Math.floor(index / 20) - 7 } }));
    const walls = Array.from({ length: 120 }, (_, index) => ({ id: `w${index}`, x1: index / 10, z1: -3, x2: index / 10, z2: 3 }));
    const { cpuMs } = measureCpu(() => {
      for (let i = 0; i < 100; i++) snapMeasurePoint({ x: i / 50, z: 0.3 }, targets({ floor: { items, interiorWalls: walls } }));
    });
    expect(cpuMs / 100).toBeLessThan(4);
  });
});
