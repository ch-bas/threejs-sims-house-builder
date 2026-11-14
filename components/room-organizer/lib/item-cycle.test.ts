import { describe, expect, it } from 'vitest';
import { makeItem } from './__testfixtures__/fixtures';
import { cycleItem, itemsInPlanOrder, selectionAnnouncement } from './item-cycle';

const items = [
  makeItem({ id: 'bed', name: 'Bed', position: { x: 2, z: 2 } }),
  makeItem({ id: 'sofa', name: 'Sofa', position: { x: -2, z: -2 } }),
  makeItem({ id: 'lamp', name: 'Lamp', position: { x: 2, z: -2.1 } }),
  makeItem({ id: 'rug', name: 'Rug', position: { x: -2, z: 2.05 } }),
];

describe('keyboard item cycling (#650)', () => {
  it('reads the plan like a page: rows top to bottom, each left to right', () => {
    expect(itemsInPlanOrder(items).map((item) => item.id)).toEqual(['sofa', 'lamp', 'rug', 'bed']);
  });

  it('leaves out items not on the plan', () => {
    const { position: _unused, ...unplaced } = makeItem({ id: 'boxed' });
    expect(itemsInPlanOrder([...items, unplaced]).map((item) => item.id)).not.toContain('boxed');
  });

  it('steps forward and back, starting at either end with nothing selected', () => {
    expect(cycleItem(items, null, 1)?.id).toBe('sofa');
    expect(cycleItem(items, null, -1)?.id).toBe('bed');
    expect(cycleItem(items, 'lamp', 1)?.id).toBe('rug');
    expect(cycleItem(items, 'lamp', -1)?.id).toBe('sofa');
    // An id from another floor is as good as none.
    expect(cycleItem(items, 'elsewhere', 1)?.id).toBe('sofa');
  });

  it('runs out at the ends, so Tab can leave the scene', () => {
    expect(cycleItem(items, 'bed', 1)).toBeNull();
    expect(cycleItem(items, 'sofa', -1)).toBeNull();
    expect(cycleItem([], null, 1)).toBeNull();
  });

  it('says what is selected and where it is in the order', () => {
    expect(selectionAnnouncement(items, 'lamp')).toBe('Lamp selected, 2 of 4.');
    const locked = items.map((item) => (item.id === 'lamp' ? { ...item, locked: true } : item));
    expect(selectionAnnouncement(locked, 'lamp')).toBe('Lamp selected, 2 of 4. Locked.');
    expect(selectionAnnouncement(items, 'gone')).toBe('');
  });
});
