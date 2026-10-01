import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { ROOM_TEMPLATES } from './constants';
import { planDrawOrder, planLayer } from './plan-order';

describe('planLayer (#286)', () => {
  it('classifies by the collision layer model', () => {
    expect(planLayer(makeItem({ type: 'rug', height: 0.02 }))).toBe('low-profile');
    expect(planLayer(makeItem({ type: 'stepping-stone', height: 0.06 }))).toBe('floor');
    expect(planLayer(makeItem({ type: 'sofa', height: 0.8 }))).toBe('floor');
    expect(planLayer(makeItem({ type: 'lamp', height: 1.5 }))).toBe('tabletop');
    expect(planLayer(makeItem({ type: 'wifi', height: 0.1 }))).toBe('tabletop');
    expect(planLayer(makeItem({ type: 'door', height: 2.05 }))).toBe('wall');
    expect(planLayer(makeItem({ type: 'window', height: 1.2 }))).toBe('wall');
    expect(planLayer(makeItem({ type: 'security-camera', height: 2.4 }))).toBe('wall');
  });

  it('keeps a flat tabletop item above its surface, not in the rug layer', () => {
    expect(planLayer(makeItem({ type: 'books', height: 0.03 }))).toBe('tabletop');
  });

  it('paints wall-hung decor over the furniture it hangs above, under the openings (#376)', () => {
    expect(planLayer(makeItem({ type: 'painting', height: 0.6 }))).toBe('hung');
    expect(planLayer(makeItem({ type: 'wall-shelf', height: 0.06 }))).toBe('hung');
    const sofa = makeItem({ id: 'sofa', type: 'sofa', height: 0.8 });
    const lamp = makeItem({ id: 'lamp', type: 'lamp', height: 1.5 });
    const painting = makeItem({ id: 'painting', type: 'painting', height: 0.6 });
    const window = makeItem({ id: 'window', type: 'window', height: 1.2 });
    expect(planDrawOrder([window, painting, lamp, sofa]).map((item) => item.id)).toEqual([
      'sofa',
      'lamp',
      'painting',
      'window',
    ]);
  });
});

describe('planDrawOrder (#286)', () => {
  it('orders low-profile → floor → tabletop → wall regardless of array order', () => {
    const camera = makeItem({ id: 'cam', type: 'security-camera', height: 2.4 });
    const lamp = makeItem({ id: 'lamp', type: 'lamp', height: 1.5 });
    const desk = makeItem({ id: 'desk', type: 'desk', height: 0.75 });
    const rug = makeItem({ id: 'rug', type: 'rug', height: 0.02 });
    expect(planDrawOrder([camera, lamp, desk, rug]).map((item) => item.id)).toEqual(['rug', 'desk', 'lamp', 'cam']);
  });

  it('is stable: ties keep the array index', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => makeItem({ id, type: 'chair', height: 0.8 }));
    expect(planDrawOrder(items).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    const mixed = [
      makeItem({ id: 'sofa', type: 'sofa', height: 0.8 }),
      makeItem({ id: 'rug-1', type: 'rug', height: 0.02 }),
      makeItem({ id: 'table', type: 'coffee-table', height: 0.4 }),
      makeItem({ id: 'rug-2', type: 'rug', height: 0.02 }),
    ];
    expect(planDrawOrder(mixed).map((item) => item.id)).toEqual(['rug-1', 'rug-2', 'sofa', 'table']);
  });

  it('does not mutate the input and returns a new array', () => {
    const items = [makeItem({ id: 'sofa', type: 'sofa' }), makeItem({ id: 'rug', type: 'rug', height: 0.02 })];
    const ordered = planDrawOrder(items);
    expect(ordered).not.toBe(items);
    expect(items.map((item) => item.id)).toEqual(['sofa', 'rug']);
    expect(ordered[0]).toBe(items[1]);
  });

  it('paints the shipped Living Room rug under the sofa and coffee table it is listed after', () => {
    const items = ROOM_TEMPLATES.livingRoom.floors[0]!.items;
    const ids = items.map((item) => item.id);
    // The template lists the rug after the sofa and coffee table (the bug).
    expect(ids.indexOf('rug-1')).toBeGreaterThan(ids.indexOf('sofa-1'));
    expect(ids.indexOf('rug-1')).toBeGreaterThan(ids.indexOf('coffee-1'));
    const ordered = planDrawOrder(items).map((item) => item.id);
    expect(ordered[0]).toBe('rug-1');
    expect(ordered.indexOf('sofa-1')).toBeLessThan(ordered.indexOf('plant-1'));
    expect(ordered.indexOf('wifi-1')).toBeGreaterThan(ordered.indexOf('sofa-1'));
    // Every item still appears exactly once.
    expect([...ordered].sort()).toEqual([...ids].sort());
  });
});
