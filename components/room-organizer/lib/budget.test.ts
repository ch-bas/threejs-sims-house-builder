import { describe, expect, it } from 'vitest';
import { INITIAL_GROUND_FLOOR, layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_WRITE_OFF,
  budgetBlockedReason,
  budgetRemaining,
  budgetSpent,
  furnitureSpend,
  repairHardBudget,
  sellBackLoss,
  sellBackRefund,
} from './budget';
import { DEFAULT_BUDGET } from './constants';
import { parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';
import { ENTRANCE_DOOR_ID } from './street';
import type { FurnitureItem, RoomLayout } from './types';

function stateWith(items: FurnitureItem[], budget?: { writeOff: number }): LayoutState {
  return {
    layout: makeLayout({ floors: [makeFloor({ items })], ...(budget ? { budget } : {}) }),
    activeFloorIndex: 0,
  };
}

const sofa = makeItem({ id: 'sofa', price: 650 });
const lamp = makeItem({ id: 'lamp', price: 45 });

describe('budget arithmetic (#463e)', () => {
  it('spend is the furniture standing, without the porch door', () => {
    const door = makeItem({ id: ENTRANCE_DOOR_ID, price: 300 });
    const layout = makeLayout({ floors: [makeFloor({ items: [sofa, door] }), makeFloor({ id: 'f1', items: [lamp] })] });
    expect(furnitureSpend(layout)).toBe(695);
    expect(budgetSpent(layout)).toBe(695);
    expect(budgetSpent({ ...layout, budget: { writeOff: 100 } })).toBe(795);
  });

  it('remaining is null while the hard budget is off', () => {
    expect(budgetRemaining(makeLayout({ floors: [makeFloor({ items: [sofa] })] }))).toBeNull();
    const on = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 50 } });
    expect(budgetRemaining(on)).toBe(DEFAULT_BUDGET - 700);
  });

  it('sell-back refunds 80 % in whole units and books the rest as loss', () => {
    expect(sellBackRefund(650)).toBe(520);
    expect(sellBackRefund(45)).toBe(36);
    expect(sellBackRefund(-10)).toBe(0);
    expect(sellBackLoss([sofa, lamp])).toBe(130 + 9);
    expect(sellBackLoss([makeItem({ id: ENTRANCE_DOOR_ID, price: 300 })])).toBe(0);
  });

  it('a tile is blocked only when the hard budget is on and the price is over what is left', () => {
    expect(budgetBlockedReason(5000, null)).toBeNull();
    expect(budgetBlockedReason(500, 500)).toBeNull();
    expect(budgetBlockedReason(501, 500)).toMatch(/Over budget: \$500 left/);
    expect(budgetBlockedReason(10, -40)).toMatch(/\$0 left/);
  });

  it('repairs the stored field instead of refusing it', () => {
    const clean = { writeOff: 12 };
    expect(repairHardBudget(clean)).toBe(clean);
    expect(repairHardBudget(true)).toBeUndefined();
    expect(repairHardBudget(null)).toBeUndefined();
    expect(repairHardBudget([])).toBeUndefined();
    expect(repairHardBudget({})).toEqual({ writeOff: 0 });
    expect(repairHardBudget({ writeOff: -5 })).toEqual({ writeOff: 0 });
    expect(repairHardBudget({ writeOff: 1e300 })).toEqual({ writeOff: MAX_WRITE_OFF });
    expect(repairHardBudget({ writeOff: 'lots' })).toEqual({ writeOff: 0 });
    expect(repairHardBudget({ writeOff: 3, extra: 1 })).toEqual({ writeOff: 3 });
  });
});

describe('reducer: hard budget and sell-back (#463e)', () => {
  it('setHardBudget switches on with nothing written off, and off drops the field', () => {
    const off = stateWith([sofa]);
    const on = layoutReducer(off, { type: 'setHardBudget', on: true });
    expect(on.layout.budget).toEqual({ writeOff: 0 });
    expect(layoutReducer(on, { type: 'setHardBudget', on: true })).toBe(on);
    const again = layoutReducer(on, { type: 'setHardBudget', on: false });
    expect('budget' in again.layout).toBe(false);
    expect(layoutReducer(off, { type: 'setHardBudget', on: false })).toBe(off);
  });

  it('with the budget off, sellItems is plain removal and leaves no field behind', () => {
    const state = stateWith([sofa, lamp]);
    const next = layoutReducer(state, { type: 'sellItems', ids: ['sofa'] });
    expect(next.layout.floors[0]!.items).toEqual([lamp]);
    expect('budget' in next.layout).toBe(false);
  });

  it('with the budget on, Demolish refunds 80 %: the other 20 % is written off', () => {
    const state = stateWith([sofa, lamp], { writeOff: 10 });
    const before = budgetRemaining(state.layout)!;
    const next = layoutReducer(state, { type: 'sellItems', ids: ['sofa', 'lamp'] });
    expect(next.layout.floors[0]!.items).toEqual([]);
    expect(next.layout.budget).toEqual({ writeOff: 10 + 130 + 9 });
    expect(budgetRemaining(next.layout)! - before).toBe(520 + 36);
  });

  it('sells locked items (a lock pins position, not existence) and refuses an unknown id', () => {
    const locked = makeItem({ id: 'bed', price: 900, locked: true });
    const state = stateWith([locked], { writeOff: 0 });
    expect(layoutReducer(state, { type: 'sellItems', ids: ['nope'] })).toBe(state);
    const next = layoutReducer(state, { type: 'sellItems', ids: ['bed'] });
    expect(next.layout.floors[0]!.items).toHaveLength(0);
    expect(next.layout.budget!.writeOff).toBe(180);
  });

  it('refuses any edit that would push spending over the budget, by whatever route', () => {
    const big = makeItem({ id: 'big', price: DEFAULT_BUDGET - 100 });
    const state = stateWith([big], { writeOff: 50 });
    const pricey = makeCatalogItem({ price: 60 });
    expect(layoutReducer(state, { type: 'addCatalogItem', catalogItem: pricey, id: 'x' })).toBe(state);
    expect(layoutReducer(state, { type: 'addItems', items: [makeItem({ id: 'y', price: 51 })] })).toBe(state);
    expect(layoutReducer(state, { type: 'duplicateItem', sourceId: 'big', newId: 'c' })).toBe(state);
    // Exactly what's left is affordable.
    const fits = layoutReducer(state, { type: 'addItems', items: [makeItem({ id: 'z', price: 50 })] });
    expect(fits).not.toBe(state);
    expect(budgetRemaining(fits.layout)).toBe(0);
  });

  it('never refuses with the budget off, nor an edit that does not raise spending', () => {
    const big = makeItem({ id: 'big', price: DEFAULT_BUDGET + 500 });
    const off = stateWith([big]);
    const added = layoutReducer(off, { type: 'addItems', items: [makeItem({ id: 'y', price: 51 })] });
    expect(added.layout.floors[0]!.items).toHaveLength(2);
    // Over budget already (switched on late): moving and selling still work.
    const on = layoutReducer(off, { type: 'setHardBudget', on: true });
    expect(on.layout.budget).toEqual({ writeOff: 0 });
    const moved = layoutReducer(on, { type: 'updateItem', id: 'big', patch: { position: { x: 1, z: 1 } } });
    expect(moved).not.toBe(on);
    expect(layoutReducer(on, { type: 'sellItems', ids: ['big'] }).layout.floors[0]!.items).toHaveLength(0);
  });

  it('applyLayout restores verbatim, over budget or not (undo, loads)', () => {
    const state = stateWith([], { writeOff: 0 });
    const over: RoomLayout = makeLayout({
      floors: [makeFloor({ items: [makeItem({ id: 'big', price: DEFAULT_BUDGET * 2 })] })],
      budget: { writeOff: 5 },
    });
    const next = layoutReducer(state, { type: 'applyLayout', layout: over });
    expect(next.layout.budget).toEqual({ writeOff: 5 });
    expect(next.layout.floors[0]!.items).toHaveLength(1);
  });

  it('selling the porch door records the removal like Demolish always has (#273)', () => {
    const initial: LayoutState = { layout: makeLayout({ floors: [INITIAL_GROUND_FLOOR] }), activeFloorIndex: 0 };
    const withEntrance = layoutReducer(initial, {
      type: 'setEntrance',
      entrance: { width: 2, depth: 1, offset: 0, height: 2.4 },
    });
    expect(withEntrance.layout.floors[0]!.items.some((item) => item.id === ENTRANCE_DOOR_ID)).toBe(true);
    const sold = layoutReducer(withEntrance, { type: 'sellItems', ids: [ENTRANCE_DOOR_ID] });
    expect(sold.layout.entrance?.door).toBe(false);
  });
});

describe('persistence and sharing (#463e)', () => {
  it('the hard budget survives the schema round trip; a broken one switches off, never refusing the house', () => {
    const on = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 130 } });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(on)))?.budget).toEqual({ writeOff: 130 });
    const broken = parseStoredLayout({ ...on, budget: 'yes' });
    expect(broken).not.toBeNull();
    expect(broken && 'budget' in broken).toBe(false);
    expect(parseStoredLayout({ ...on, budget: { writeOff: -1 } })?.budget).toEqual({ writeOff: 0 });
    // A save from before the field opens with the budget off.
    const { budget: _none, ...legacy } = on;
    expect(parseStoredLayout(legacy)).toEqual(legacy);
  });

  it('rides share links', async () => {
    const on = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 130 } });
    const { url } = await encodeShareUrl(on, 'https://x.test/');
    const decoded = await decodeShareUrl(url.slice(url.indexOf('#')));
    expect(decoded?.budget).toEqual({ writeOff: 130 });
  });
});
