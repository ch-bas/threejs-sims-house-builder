import { describe, expect, it } from 'vitest';
import { INITIAL_GROUND_FLOOR, layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeCatalogItem, makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_WRITE_OFF,
  budgetBlockedReason,
  budgetRemaining,
  budgetSpent,
  floorClonePrice,
  floorCloneRefusal,
  furnitureSpend,
  isHardBudgetOn,
  loadTemplateUnderBudget,
  purchasePrice,
  purchaseRefusal,
  repairHardBudget,
  sellBackLoss,
  sellBackRefund,
} from './budget';
import { DEFAULT_BUDGET, ROOM_TEMPLATES } from './constants';
import { parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';
import { ENTRANCE_DOOR_ID } from './street';
import { surpriseFloorItems } from './surprise';
import type { FurnitureItem, RoomLayout } from './types';

function stateWith(items: FurnitureItem[], budget?: { writeOff: number }): LayoutState {
  return {
    layout: makeLayout({ floors: [makeFloor({ items })], ...(budget ? { budget } : {}) }),
    activeFloorIndex: 0,
  };
}

const sofa = makeItem({ id: 'sofa', category: 'seating', price: 650 });
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
    // A free item is never greyed, even over budget: buying it raises nothing.
    expect(budgetBlockedReason(0, -40)).toBeNull();
  });

  it('purchaseRefusal prices a buy against what is left; the porch door is free', () => {
    const on = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 0 } });
    expect(purchasePrice([sofa, lamp, makeItem({ id: ENTRANCE_DOOR_ID, price: 300 })])).toBe(695);
    expect(purchaseRefusal(on, DEFAULT_BUDGET - 650)).toBeNull();
    expect(purchaseRefusal(on, DEFAULT_BUDGET - 649)).toMatch(/Over budget/);
    expect(purchaseRefusal({ ...on, budget: { writeOff: 0, enabled: false } }, DEFAULT_BUDGET * 9)).toBeNull();
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
    const disabled = { writeOff: 7, enabled: false };
    expect(repairHardBudget(disabled)).toBe(disabled);
    expect(repairHardBudget({ writeOff: 7, enabled: true })).toEqual({ writeOff: 7 });
    expect(repairHardBudget({ writeOff: -7, enabled: false })).toEqual({ writeOff: 0, enabled: false });
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

  it('off after a sale keeps the write-off disabled; on again brings it back, so the loss is not free to dodge', () => {
    let state = stateWith([sofa, lamp], { writeOff: 0 });
    state = layoutReducer(state, { type: 'sellItems', ids: ['sofa'] });
    state = layoutReducer(state, { type: 'setHardBudget', on: false });
    expect(state.layout.budget).toEqual({ writeOff: 130, enabled: false });
    expect(budgetRemaining(state.layout)).toBeNull();
    expect(budgetSpent(state.layout)).toBe(45);
    expect(layoutReducer(state, { type: 'setHardBudget', on: false })).toBe(state);
    // Disabled: removal is plain, nothing more written off, nothing refused.
    const sold = layoutReducer(state, { type: 'sellItems', ids: ['lamp'] });
    expect(sold.layout.budget).toEqual({ writeOff: 130, enabled: false });
    const pricey = makeItem({ id: 'p', price: DEFAULT_BUDGET * 2 });
    expect(layoutReducer(state, { type: 'addItems', items: [pricey] })).not.toBe(state);
    state = layoutReducer(state, { type: 'setHardBudget', on: true });
    expect(state.layout.budget).toEqual({ writeOff: 130 });
    expect(budgetRemaining(state.layout)).toBe(DEFAULT_BUDGET - 45 - 130);
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

describe('every removal route sells back under the hard budget (#534)', () => {
  const chair = makeItem({ id: 'chair', price: 100 });
  const upstairsBed = makeItem({ id: 'bed', price: 900 });

  function twoStoreys(budget?: { writeOff: number }): LayoutState {
    return {
      layout: makeLayout({
        floors: [makeFloor({ items: [sofa, lamp] }), makeFloor({ id: 'upper', name: 'First Floor', items: [upstairsBed, chair] })],
        ...(budget ? { budget } : {}),
      }),
      activeFloorIndex: 0,
    };
  }

  /** Undo is a snapshot restore: applyLayout of the layout before the edit. */
  function undo(before: LayoutState, after: LayoutState): LayoutState {
    return layoutReducer(after, { type: 'applyLayout', layout: before.layout });
  }

  it('Clear floor books 20 % of the cleared furniture, and undo takes it back', () => {
    const state = twoStoreys({ writeOff: 10 });
    const before = budgetRemaining(state.layout)!;
    const next = layoutReducer(state, { type: 'clearItems' });
    expect(next.layout.floors[0]!.items).toEqual([]);
    expect(next.layout.budget).toEqual({ writeOff: 10 + 130 + 9 });
    expect(budgetRemaining(next.layout)! - before).toBe(520 + 36);
    expect(undo(state, next).layout).toEqual(state.layout);
  });

  it('Remove floor books 20 % of that storey, and undo takes it back', () => {
    const state = twoStoreys({ writeOff: 0 });
    const next = layoutReducer(state, { type: 'removeFloor', index: 1 });
    expect(next.layout.floors).toHaveLength(1);
    expect(next.layout.budget).toEqual({ writeOff: 180 + 20 });
    expect(undo(state, next).layout).toEqual(state.layout);
  });

  it('Surprise replacing a floor books 20 % of what it replaced, not of what it kept', () => {
    const state = twoStoreys({ writeOff: 0 });
    const items = surpriseFloorItems(state.layout, 0, DEFAULT_BUDGET, 3);
    const next = layoutReducer(state, { type: 'replaceItems', items });
    expect(next).not.toBe(state);
    expect(next.layout.budget).toEqual({ writeOff: 130 + 9 });
    expect(undo(state, next).layout).toEqual(state.layout);
    // Auto-arrange moves the same items: nothing is sold.
    const moved = [{ ...sofa, position: { x: 1, z: 1 } }, lamp];
    expect(layoutReducer(state, { type: 'replaceItems', items: moved }).layout.budget).toEqual({ writeOff: 0 });
  });

  it('Surprise budgets for the loss on what it replaces, so it is not refused for it', () => {
    // 1,400 left; selling the 2,000 piece back frees 1,600 more, not 2,000.
    const pricey = makeItem({ id: 'pricey', price: 2000 });
    const tight: LayoutState = {
      layout: makeLayout({ floors: [makeFloor({ items: [pricey] })], budget: { writeOff: DEFAULT_BUDGET - 3400 } }),
      activeFloorIndex: 0,
    };
    expect(budgetRemaining(tight.layout)).toBe(1400);
    // Seeds whose decor would fill a 3,400 cap to the brim.
    for (const seed of [4, 20]) {
      const items = surpriseFloorItems(tight.layout, 0, DEFAULT_BUDGET, seed);
      expect(purchasePrice(items)).toBeLessThanOrEqual(3000);
      const next = layoutReducer(tight, { type: 'replaceItems', items });
      expect(next).not.toBe(tight);
      expect(budgetRemaining(next.layout)).toBeGreaterThanOrEqual(0);
    }
  });

  it('with the budget off, the three routes are plain removal and leave no field behind', () => {
    const state = twoStoreys();
    expect('budget' in layoutReducer(state, { type: 'clearItems' }).layout).toBe(false);
    expect('budget' in layoutReducer(state, { type: 'removeFloor', index: 1 }).layout).toBe(false);
    const items = surpriseFloorItems(state.layout, 0, DEFAULT_BUDGET, 3);
    expect('budget' in layoutReducer(state, { type: 'replaceItems', items }).layout).toBe(false);
    // Switched off after a sale: the stored write-off is left alone.
    const off: LayoutState = { ...state, layout: { ...state.layout, budget: { writeOff: 50, enabled: false } } };
    expect(layoutReducer(off, { type: 'clearItems' }).layout.budget).toEqual({ writeOff: 50, enabled: false });
    expect(layoutReducer(off, { type: 'removeFloor', index: 1 }).layout.budget).toEqual({ writeOff: 50, enabled: false });
  });

  it('a no-op clear keeps state identity and books nothing', () => {
    const empty = stateWith([], { writeOff: 5 });
    expect(layoutReducer(empty, { type: 'clearItems' })).toBe(empty);
  });

  it('Clear floor keeps the porch door and charges nothing for it', () => {
    const door = makeItem({ id: ENTRANCE_DOOR_ID, price: 400 });
    const state = stateWith([door, lamp], { writeOff: 0 });
    const next = layoutReducer(state, { type: 'clearItems' });
    expect(next.layout.floors[0]!.items).toEqual([door]);
    expect(next.layout.budget).toEqual({ writeOff: 9 });
  });
});

describe('floorClonePrice (#588)', () => {
  it('charges what the reducer copies: no porch door, no garden', () => {
    const items = [
      makeItem({ id: 'bed', category: 'bedroom', price: 800 }),
      makeItem({ id: ENTRANCE_DOOR_ID, price: 300 }),
      makeItem({ id: 'tree', category: 'outdoor', price: 120 }),
    ];
    const state = stateWith(items);
    const next = layoutReducer(state, { type: 'duplicateFloor', sourceIndex: 0, newId: 'f2', idSuffix: 'x' });
    expect(floorClonePrice(items)).toBe(800);
    expect(furnitureSpend(next.layout) - furnitureSpend(state.layout)).toBe(floorClonePrice(items));
  });

  it('names the floor and the price when the budget refuses the copy', () => {
    const beds = Array.from({ length: 18 }, (_, i) => makeItem({ id: `bed-${i}`, category: 'bedroom', price: 800 }));
    const layout = makeLayout({ floors: [makeFloor({ items: beds })], budget: { writeOff: 0 } });
    expect(floorCloneRefusal(layout, 'Ground', beds)).toBe('Cloning Ground buys $14,400 of furniture. Over budget: $10,600 left');
    expect(floorCloneRefusal({ ...layout, budget: { writeOff: 0, enabled: false } }, 'Ground', beds)).toBeNull();
    expect(floorCloneRefusal(layout, 'Ground', beds.slice(0, 10))).toBeNull();
  });
});

describe('loadTemplateUnderBudget (#691)', () => {
  const studio = ROOM_TEMPLATES.studio;
  const studioPrice = purchasePrice(studio.floors.flatMap((floor) => floor.items));
  const houseWith = (items: FurnitureItem[], budget?: RoomLayout['budget']): RoomLayout =>
    makeLayout({ floors: [makeFloor({ items })], ...(budget ? { budget } : {}) });

  it('keeps the hard budget on and the write-off of earlier sales', () => {
    // Repro: a $1,000 sofa demolished under the hard budget wrote off $200.
    const load = loadTemplateUnderBudget(houseWith([], { writeOff: 200 }), studio, 'Studio template');
    expect(load.refusal).toBeNull();
    expect(load.layout!.budget).toEqual({ writeOff: 200 });
    expect(isHardBudgetOn(load.layout!)).toBe(true);
    expect(load.layout!.floors).toEqual(studio.floors);
  });

  it('sells the outgoing furniture back, like Clear floor', () => {
    const sofa1000 = makeItem({ id: 'sofa', price: 1000 });
    const load = loadTemplateUnderBudget(houseWith([sofa1000], { writeOff: 0 }), studio, 'Studio template');
    expect(load.layout!.budget).toEqual({ writeOff: 200 });
    expect(load.writtenOff).toBe(200);
  });

  it('keeps a switched-off budget off, write-off and all, and sells nothing', () => {
    const sofa1000 = makeItem({ id: 'sofa', price: 1000 });
    const load = loadTemplateUnderBudget(houseWith([sofa1000], { writeOff: 50, enabled: false }), studio, 'Studio template');
    expect(load.layout!.budget).toEqual({ writeOff: 50, enabled: false });
    expect(load.writtenOff).toBe(0);
  });

  it('gives a house that never used the hard budget none, whatever the template carries', () => {
    const load = loadTemplateUnderBudget(houseWith([]), { ...studio, budget: { writeOff: 9 } }, 'Studio template');
    expect('budget' in load.layout!).toBe(false);
  });

  it('refuses a template whose furniture does not fit what is left', () => {
    const writeOff = DEFAULT_BUDGET - studioPrice + 1;
    const load = loadTemplateUnderBudget(houseWith([], { writeOff }), studio, 'Studio template');
    expect(load.layout).toBeNull();
    expect(load.refusal).toContain('Over budget: the Studio template costs');
    expect(loadTemplateUnderBudget(houseWith([], { writeOff: writeOff - 1 }), studio, 'Studio template').refusal).toBeNull();
  });
});
