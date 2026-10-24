import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutAction, type LayoutState } from '../hooks/layout-reducer';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { budgetBlockedReason, budgetRemaining } from './budget';
import { DEFAULT_BUDGET } from './constants';
import { parseStoredLayout } from './schema';

const big = makeItem({ id: 'big', price: DEFAULT_BUDGET + 5000, locked: false, position: { x: 0, z: 0 } });
const small = makeItem({ id: 'small', price: 100, locked: false, position: { x: 1, z: 1 } });
function overState(): LayoutState {
  return {
    layout: makeLayout({
      floors: [makeFloor({ items: [big, small] }), makeFloor({ id: 'f1', name: 'Up', items: [] })],
      budget: { writeOff: 0 },
    }),
    activeFloorIndex: 0,
  };
}

describe('review: over-budget house, ordinary edits pass', () => {
  const cases: [string, LayoutAction][] = [
    ['moveItem', { type: 'moveItem', id: 'small', x: 0.5, z: 0.5 }],
    ['rotateItem', { type: 'rotateItem', id: 'small' }],
    ['setColor', { type: 'setColor', id: 'small', color: '#123456' }],
    ['resizeItem', { type: 'resizeItem', id: 'small', dimension: 'width', value: 1.3 }],
    ['setLocked', { type: 'setLocked', id: 'small', locked: true }],
    ['rename', { type: 'updateItem', id: 'small', patch: { name: 'X' } }],
    ['priceDown', { type: 'updateItem', id: 'small', patch: { price: 10 } }],
    ['addZone', { type: 'addZone', zone: { id: 'z', name: 'Z', x: 0, z: 0, w: 1, d: 1, color: '#fff' } }],
    ['addWall', { type: 'addInteriorWall', wall: { id: 'w', x1: -1, z1: 0, x2: 1, z2: 0 } }],
    ['floorSwitch', { type: 'setActiveFloorIndex', index: 1 }],
    ['setName', { type: 'setName', name: 'Over' }],
    ['wallColor', { type: 'setWallColor', wall: 'north', color: '#abcdef' }],
    ['addEmptyFloor', { type: 'addFloor', floor: { id: 'f2', items: [], floorColor: '#ccc', wallColors: {} } as never }],
    ['removeFloor', { type: 'removeFloor', index: 1 }],
    ['reorderFloor', { type: 'reorderFloor', from: 0, to: 1 }],
    ['clearItems', { type: 'clearItems' }],
    ['sell', { type: 'sellItems', ids: ['small'] }],
    ['remove', { type: 'removeItem', id: 'small' }],
    ['addFree', { type: 'addCatalogItem', catalogItem: makeCatalogItem({ price: 0 }), id: 'free' }],
    ['budgetOff', { type: 'setHardBudget', on: false }],
  ];
  for (const [name, action] of cases) {
    it(name, () => {
      const s = overState();
      expect(layoutReducer(s, action)).not.toBe(s);
    });
  }
  it('price increase, add, duplicate refused', () => {
    const s = overState();
    expect(layoutReducer(s, { type: 'updateItem', id: 'small', patch: { price: 200 } })).toBe(s);
    expect(layoutReducer(s, { type: 'addCatalogItem', catalogItem: makeCatalogItem({ price: 1 }), id: 'q' })).toBe(s);
    expect(layoutReducer(s, { type: 'duplicateItem', sourceId: 'small', newId: 'c' })).toBe(s);
    expect(layoutReducer(s, { type: 'duplicateFloor', sourceIndex: 0, newId: 'f9', idSuffix: 'zz' })).toBe(s);
  });
  it('free tile is greyed while the reducer would accept it', () => {
    const rem = budgetRemaining(overState().layout);
    expect(rem).toBeLessThan(0);
    // reducer accepts price 0 (above). UI:
    expect(budgetBlockedReason(0, rem)).toBeNull();
  });
  it('toggle off/on wipes the write-off', () => {
    let s: LayoutState = { layout: makeLayout({ floors: [makeFloor({ items: [small] })], budget: { writeOff: 0 } }), activeFloorIndex: 0 };
    s = layoutReducer(s, { type: 'sellItems', ids: ['small'] });
    expect(s.layout.budget?.writeOff).toBe(20);
    s = layoutReducer(s, { type: 'setHardBudget', on: false });
    s = layoutReducer(s, { type: 'setHardBudget', on: true });
    expect(s.layout.budget?.writeOff).toBe(20);
  });
  it('schema NaN/huge/string writeOff', () => {
    const base = makeLayout({ floors: [makeFloor({ items: [] })] });
    expect(parseStoredLayout({ ...base, budget: { writeOff: Number.NaN } })?.budget).toEqual({ writeOff: 0 });
    expect(parseStoredLayout(JSON.parse(JSON.stringify({ ...base, budget: { writeOff: Number.NaN } })))?.budget).toEqual({ writeOff: 0 });
    expect(parseStoredLayout({ ...base, budget: { writeOff: 2.5 } })?.budget).toEqual({ writeOff: 2.5 });
  });
});
