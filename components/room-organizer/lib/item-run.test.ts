import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG } from './constants';
import { floorKeepOut } from './floor-keep-out';
import { hasCollisions } from './geometry';
import {
  cornerInset,
  fitRun,
  isRunItem,
  layRun,
  MIN_RUN_LENGTH,
  runLot,
  runPitch,
  runPrice,
  runRotation,
  sectionEnds,
  snapRunPoint,
} from './item-run';
import { roadEdges } from './site';
import type { CatalogItem, FurnitureItem } from './types';

const entry = (type: string): CatalogItem => FURNITURE_CATALOG.find((item) => item.type === type)!;
const fence = entry('fence');
const hedge = entry('hedge');
const stone = entry('stepping-stone');

describe('isRunItem / runPitch (#915)', () => {
  it('lays fences, hedges and stepping stones in runs, nothing else', () => {
    expect(isRunItem('fence')).toBe(true);
    expect(isRunItem('hedge')).toBe(true);
    expect(isRunItem('stepping-stone')).toBe(true);
    expect(isRunItem('sofa')).toBe(false);
    expect(isRunItem('constructor')).toBe(false);
  });

  it('steps a section by its width, a stone by a fixed pitch', () => {
    expect(runPitch(fence)).toBe(2);
    expect(runPitch(hedge)).toBe(2);
    expect(runPitch(stone)).toBe(0.9);
  });
});

describe('layRun (#915)', () => {
  it('lays whole sections end to end and cuts the last to fit', () => {
    const items = layRun({ x: 0, z: 10 }, { x: 7, z: 10 }, fence);
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.position!.x)).toEqual([1, 3, 5, 6.5]);
    expect(items.map((item) => item.width)).toEqual([2, 2, 2, 1]);
    // A whole section keeps the catalogue width, written only where it differs.
    expect(Object.hasOwn(items[0]!, 'width')).toBe(true);
    expect(items.every((item) => item.rotation === 0 && item.locked && item.type === 'fence')).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
  });

  it('lays an exact multiple without a sliver, and stretches the last section over a stub', () => {
    expect(layRun({ x: 0, z: 0 }, { x: 6, z: 0 }, fence).map((item) => item.width)).toEqual([2, 2, 2]);
    const stub = layRun({ x: 0, z: 0 }, { x: 6.2, z: 0 }, fence);
    expect(stub.map((item) => item.width)).toEqual([2, 2, expect.closeTo(2.2, 12)]);
    // The run still reaches its end.
    expect(sectionEnds(stub.at(-1)!)![1].x).toBeCloseTo(6.2, 12);
    expect(layRun({ x: 0, z: 0 }, { x: 6.3, z: 0 }, fence).map((item) => item.width)).toEqual([2, 2, 2, expect.closeTo(0.3, 12)]);
    expect(layRun({ x: 0, z: 0 }, { x: 0.3, z: 0 }, fence).map((item) => item.width)).toEqual([0.3]);
  });

  it('is nothing for a drag shorter than a run', () => {
    expect(layRun({ x: 0, z: 0 }, { x: MIN_RUN_LENGTH - 0.01, z: 0 }, fence)).toEqual([]);
  });

  it('turns every section to the line, as three turns +X', () => {
    const south = layRun({ x: 0, z: 0 }, { x: 0, z: 4 }, hedge);
    expect(south).toHaveLength(2);
    expect(south[0]!.rotation).toBeCloseTo(-Math.PI / 2, 12);
    expect(south.map((item) => item.position!.z)).toEqual([1, 3]);
    const diagonal = layRun({ x: 0, z: 0 }, { x: 3, z: -3 }, fence);
    expect(diagonal[0]!.rotation).toBeCloseTo(Math.PI / 4, 12);
    // The ends of the sections run along the line, from `from` to `to`.
    const [start] = sectionEnds(diagonal[0]!)!;
    expect(start.x).toBeCloseTo(0, 12);
    expect(start.z).toBeCloseTo(0, 12);
    const [, last] = sectionEnds(diagonal.at(-1)!)!;
    expect(last.x).toBeCloseTo(3, 12);
    expect(last.z).toBeCloseTo(-3, 12);
  });

  it('keeps stepping stones whole at a fixed pitch', () => {
    const stones = layRun({ x: 0, z: 0 }, { x: 3.6, z: 0 }, stone);
    expect(stones.map((item) => item.position!.x)).toEqual([0.45, 1.35, 2.25, 3.15].map((x) => expect.closeTo(x, 12)));
    expect(stones.every((item) => item.width === 0.6)).toBe(true);
    expect(layRun({ x: 0, z: 0 }, { x: 0.5, z: 0 }, stone)).toHaveLength(1);
  });

  it('never has its own sections collide, at any of the steps', () => {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const angle = (degrees * Math.PI) / 180;
      const items = layRun({ x: 30, z: 30 }, { x: 30 + 9.3 * Math.cos(angle), z: 30 + 9.3 * Math.sin(angle) }, hedge);
      for (const item of items) expect(hasCollisions(item, items, 8, 8)).toBe(false);
    }
  });

  it('starts and stops past a corner inset', () => {
    const items = layRun({ x: 0, z: 0 }, { x: 5, z: 0 }, fence, { insetStart: 0.5, insetEnd: 0.5 });
    expect(sectionEnds(items[0]!)![0].x).toBeCloseTo(0.5, 12);
    expect(sectionEnds(items.at(-1)!)![1].x).toBeCloseTo(4.5, 12);
  });

  it('costs every section at the entry price', () => {
    expect(runPrice(layRun({ x: 0, z: 0 }, { x: 7, z: 0 }, fence))).toBe(4 * fence.price!);
  });

  it('lays a 20 m run quickly', () => {
    const started = performance.now();
    for (let i = 0; i < 200; i += 1) layRun({ x: 0, z: 0 }, { x: 20, z: 0.5 * i }, fence);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('snapRunPoint (#915)', () => {
  const laid = layRun({ x: 0, z: 10 }, { x: 4, z: 10 }, fence);

  it('rounds a free point to the grid', () => {
    expect(snapRunPoint({ x: 1.23, z: -0.07 }, null, 'fence', [])).toEqual({ point: { x: 1.2, z: -0.1 }, joined: null });
  });

  it('turns the tip to 15° steps at a grid length from the anchor', () => {
    const { point } = snapRunPoint({ x: 5.02, z: 0.4 }, { x: 0, z: 0 }, 'fence', []);
    expect(point).toEqual({ x: 5, z: 0 });
    const diagonal = snapRunPoint({ x: 3, z: 3.1 }, { x: 0, z: 0 }, 'fence', []).point;
    expect(Math.atan2(diagonal.z, diagonal.x)).toBeCloseTo(Math.PI / 4, 12);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(4.3, 9);
  });

  it('joins the free end of a section of the same type, not another type', () => {
    const near = snapRunPoint({ x: 4.2, z: 10.1 }, null, 'fence', laid);
    expect(near.point.x).toBeCloseTo(4, 12);
    expect(near.joined?.id).toBe(laid.at(-1)!.id);
    expect(snapRunPoint({ x: 4.2, z: 10.1 }, null, 'hedge', laid).joined).toBeNull();
  });
});

describe('cornerInset (#915)', () => {
  // Well clear of the 8 m house the collision test is given.
  const laid = layRun({ x: 0, z: 20 }, { x: 4, z: 20 }, hedge);
  const last = laid.at(-1)!;
  const end = { x: 4, z: 20 };

  it('is none carrying straight on, or with nothing joined', () => {
    expect(cornerInset(end, { x: 8, z: 20 }, last)).toBe(0);
    expect(cornerInset(end, { x: 4, z: 24 }, null)).toBe(0);
  });

  it('turning a corner, the new run clears the section it starts from', () => {
    for (const degrees of [30, 45, 90, 120, 150]) {
      const angle = (degrees * Math.PI) / 180;
      const to = { x: end.x + 6 * Math.cos(angle), z: end.z + 6 * Math.sin(angle) };
      const inset = cornerInset(end, to, last);
      expect(inset).toBeGreaterThan(0);
      const next: FurnitureItem[] = layRun(end, to, hedge, { insetStart: inset, makeId: (i) => `next-${i}` });
      expect(hasCollisions(next[0]!, [...laid, ...next], 8, 8)).toBe(false);
    }
    // A square corner sits half the depth in.
    expect(cornerInset(end, { x: 4, z: 26 }, last)).toBeCloseTo(hedge.depth / 2, 2);
  });

  it('turns the rotation helper the three way', () => {
    expect(runRotation({ x: 0, z: 0 }, { x: 1, z: 0 })).toBe(0);
    expect(runRotation({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('runLot (#915)', () => {
  it('runs LOT_MARGIN round the house, short of the road, and stops at a party wall', () => {
    expect(runLot({ width: 10, height: 8 })).toEqual({ x0: -11, x1: 11, z0: -10, z1: 10 });
    // The pavement at the front wall: nothing north of the house.
    expect(runLot({ width: 10, height: 8, frontage: 'pavement' }).z0).toBe(-4);
    expect(runLot({ width: 10, height: 8, neighbours: { west: true } }).x0).toBe(-5);
    // Never as far as the road.
    for (const frontage of ['garden', 'pavement'] as const) {
      expect(-runLot({ width: 10, height: 8, frontage }).z0).toBeLessThanOrEqual(roadEdges(4, frontage).near);
    }
  });

  it('keeps an anchor and a tip in the lot, the tip on its angle step', () => {
    const lot = runLot({ width: 10, height: 8 });
    expect(snapRunPoint({ x: 2, z: -30 }, null, 'fence', [], lot).point).toEqual({ x: 2, z: -10 });
    // Dragged north across the road: stops at the lot's edge, still straight.
    expect(snapRunPoint({ x: 9.2, z: -48 }, { x: 9, z: 2 }, 'hedge', [], lot).point).toEqual({ x: 9, z: -10 });
    const diagonal = snapRunPoint({ x: 40, z: 40 }, { x: 8, z: 8 }, 'fence', [], lot).point;
    // On the 45° line, a grid length short of the corner.
    expect(diagonal.x).toBeCloseTo(diagonal.z, 12);
    expect(diagonal.x).toBeLessThanOrEqual(10);
    expect(diagonal.x).toBeGreaterThan(9.9);
  });
});

describe('fitRun (#915)', () => {
  const house = { width: 10, height: 8, floors: [{ id: 'g', name: 'Ground', items: [] }] };
  const context = (items: FurnitureItem[] = []) => ({ items, roomWidth: 10, roomDepth: 8, keepOut: floorKeepOut(house as never, 0) });

  it('leaves out the sections in the house: a run across it goes round it in two parts', () => {
    const across = layRun({ x: -8, z: 0 }, { x: 8, z: 0 }, fence);
    const fit = fitRun(across, context());
    expect(fit.blocker).toBeNull();
    expect(fit.dropped).toBe(across.length - fit.sections.length);
    expect(fit.sections.map((section) => section.position!.x)).toEqual([-7, 7]);
  });

  it('a run drawn across the road stays in the lot, every section laid', () => {
    const lot = runLot({ width: 10, height: 8 });
    const anchor = snapRunPoint({ x: 9, z: 2 }, null, 'hedge', [], lot).point;
    const tip = snapRunPoint({ x: 9, z: -48 }, anchor, 'hedge', [], lot).point;
    const fit = fitRun(layRun(anchor, tip, hedge), context());
    expect(fit.sections).toHaveLength(6);
    const road = roadEdges(4, undefined);
    for (const section of fit.sections) expect(section.position!.z - section.width / 2).toBeGreaterThanOrEqual(-road.near);
  });

  it('names an item a section would stand in, so the run is refused whole', () => {
    const tree = { ...layRun({ x: 3, z: 6 }, { x: 4, z: 6 }, hedge)[0]!, id: 'tree', type: 'tree', name: 'Oak Tree', width: 1, depth: 1 };
    const fit = fitRun(layRun({ x: -8, z: 6 }, { x: 8, z: 6 }, fence), context([tree]));
    expect(fit.blocker?.name).toBe('Oak Tree');
    // A stone stands in a tree's way as much as a fence does.
    expect(fitRun(layRun({ x: -8, z: 6 }, { x: 8, z: 6 }, stone), context([tree])).blocker?.name).toBe('Oak Tree');
  });

  it('chains stepping stones straight on at their pitch', () => {
    const first = layRun({ x: 0, z: 6 }, { x: 1.8, z: 6 }, stone);
    const end = snapRunPoint({ x: 1.85, z: 6 }, null, 'stepping-stone', first);
    expect(end.point.x).toBeCloseTo(1.8, 12);
    const next = layRun(end.point, { x: 3.6, z: 6 }, stone, { insetStart: cornerInset(end.point, { x: 3.6, z: 6 }, end.joined) });
    expect(next[0]!.position!.x - first.at(-1)!.position!.x).toBeCloseTo(0.9, 12);
  });
});
