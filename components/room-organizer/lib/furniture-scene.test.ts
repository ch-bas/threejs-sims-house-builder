import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';
import { furnitureCollisionKey, furnitureItemsKey, planFurniture } from './furniture-scene';
import type { RoomLayout } from './types';

const keys = (layout: RoomLayout, showAll = false, active = 0) => {
  const plan = planFurniture(layout, showAll, active);
  return { items: furnitureItemsKey(plan), collisions: furnitureCollisionKey(plan) };
};

describe('planFurniture (#214)', () => {
  const sofa = makeItem({ id: 'sofa', type: 'sofa', width: 2, depth: 0.9, height: 0.8, position: { x: 0, z: 0 } });
  const lamp = makeItem({ id: 'lamp', type: 'lamp', width: 0.4, depth: 0.4, height: 1.5, position: { x: 2.5, z: 2.5 } });
  const ground = makeFloor({ items: [sofa, lamp, makeUnplacedItem({ id: 'boxed' })] });
  const upper = makeFloor({ id: 'upper', items: [makeItem({ id: 'bed', position: { x: 1, z: 1 } })] });
  const layout = makeLayout({ floors: [ground, upper] });

  it('plans the placed items of the active storey, or of every storey', () => {
    expect(planFurniture(layout, false, 1).map((f) => [f.index, f.items.map((i) => i.id)])).toEqual([[1, ['bed']]]);
    expect(planFurniture(layout, true, 0).map((f) => [f.index, f.items.map((i) => i.id)])).toEqual([
      [0, ['sofa', 'lamp']],
      [1, ['bed']],
    ]);
  });

  it('keeps both keys when a floor-scoped edit leaves the items alone', () => {
    const before = keys(layout);
    const painted = makeLayout({
      floors: [{ ...ground, wallColors: { north: '#ff0000' }, floorPattern: 'tile' }, upper],
    });
    expect(keys(painted)).toEqual(before);
  });

  it('changes the items key when an item moves', () => {
    const moved = makeLayout({ floors: [{ ...ground, items: [{ ...sofa, position: { x: 0.5, z: 0 } }, lamp] }, upper] });
    expect(keys(moved).items).not.toBe(keys(layout).items);
  });

  it('changes only the collision key when an interior wall starts cutting through an item', () => {
    const across = makeLayout({ floors: [{ ...ground, interiorWalls: [{ id: 'w', x1: -3, z1: 0, x2: 3, z2: 0 }] }, upper] });
    expect(keys(across).items).toBe(keys(layout).items);
    expect(keys(across).collisions).not.toBe(keys(layout).collisions);
    expect(planFurniture(across, false, 0)[0]?.collisions).toEqual([true, false]);
  });

  it('leaves both keys alone for a wall that misses every item', () => {
    const clear = makeLayout({ floors: [{ ...ground, interiorWalls: [{ id: 'w', x1: -3, z1: -3.5, x2: 3, z2: -3.5 }] }, upper] });
    expect(keys(clear)).toEqual(keys(layout));
  });
});

describe('planFurniture — storey heights (#470)', () => {
  it('tests a pendant against the furniture under it at its own storey height', () => {
    const pendant = makeItem({ id: 'pl', type: 'pendant-light', width: 0.45, depth: 0.45, height: 1, position: { x: 0, z: 0 } });
    const wardrobe = makeItem({ id: 'w', type: 'wardrobe', width: 1.2, depth: 0.6, height: 2.1, position: { x: 0, z: 0 } });
    const collisions = (height?: number): readonly boolean[] =>
      planFurniture(makeLayout({ floors: [makeFloor({ ...(height ? { height } : {}), items: [pendant, wardrobe] })] }), false, 0)[0]!.collisions;
    expect(collisions()).toEqual([true, true]);
    expect(collisions(4.5)).toEqual([false, false]);
  });
});
