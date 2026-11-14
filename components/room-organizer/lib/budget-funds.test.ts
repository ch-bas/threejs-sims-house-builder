import { describe, expect, it } from 'vitest';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  MAX_FUNDS,
  MIN_FUNDS,
  budgetOf,
  budgetRemaining,
  clampFunds,
  loadTemplateUnderBudget,
  readFunds,
  purchaseRefusal,
  repairHardBudget,
  withFunds,
} from './budget';
import { DEFAULT_BUDGET } from './constants';
import { parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';
import type { FurnitureItem, HardBudget } from './types';

function stateWith(items: FurnitureItem[], budget?: HardBudget): LayoutState {
  return {
    layout: makeLayout({ floors: [makeFloor({ items })], ...(budget ? { budget } : {}) }),
    activeFloorIndex: 0,
  };
}

const sofa = makeItem({ id: 'sofa', category: 'seating', price: 650 });

describe('household funds (#609)', () => {
  it('a house that never set funds has the default, so older saves keep 25,000', () => {
    expect(budgetOf(makeLayout())).toBe(DEFAULT_BUDGET);
    expect(budgetOf(makeLayout({ budget: { writeOff: 40 } }))).toBe(DEFAULT_BUDGET);
    expect(budgetOf(makeLayout({ budget: { writeOff: 0, amount: 8000 } }))).toBe(8000);
  });

  it('clamps to whole units in range, and refuses what is not a number', () => {
    expect(clampFunds(8000.4)).toBe(8000);
    expect(clampFunds(-5)).toBe(MIN_FUNDS);
    expect(clampFunds(1e12)).toBe(MAX_FUNDS);
    expect(clampFunds(Number.NaN)).toBeNull();
    expect(clampFunds(Infinity)).toBeNull();
  });

  it('withFunds stores only what differs from the default and drops an empty field', () => {
    const plain = makeLayout();
    const set = withFunds(plain, 8000);
    expect(set.budget).toEqual({ writeOff: 0, enabled: false, amount: 8000 });
    expect(withFunds(set, 8000)).toBe(set);
    expect(withFunds(plain, DEFAULT_BUDGET)).toBe(plain);
    expect(withFunds(plain, Number.NaN)).toBe(plain);
    // Back to the default: a house that never used the budget looks as it did.
    expect('budget' in withFunds(set, DEFAULT_BUDGET)).toBe(false);
    // On, or carrying a write-off: the field stays without the amount.
    expect(withFunds(makeLayout({ budget: { writeOff: 0, amount: 9000 } }), DEFAULT_BUDGET).budget).toEqual({ writeOff: 0 });
    const kept = makeLayout({ budget: { writeOff: 30, enabled: false, amount: 9000 } });
    expect(withFunds(kept, DEFAULT_BUDGET).budget).toEqual({ writeOff: 30, enabled: false });
  });

  it('the hard budget measures spending against the funds', () => {
    const on = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 50, amount: 1000 } });
    expect(budgetRemaining(on)).toBe(300);
    expect(purchaseRefusal(on, 300)).toBeNull();
    expect(purchaseRefusal(on, 301)).toMatch(/Over budget: \$300 left/);
  });
});

describe('reducer: setFunds (#609)', () => {
  it('sets the funds, and an unchanged amount returns the same state (no undo entry)', () => {
    const state = stateWith([sofa]);
    const next = layoutReducer(state, { type: 'setFunds', amount: 8000 });
    expect(budgetOf(next.layout)).toBe(8000);
    expect(layoutReducer(next, { type: 'setFunds', amount: 8000 })).toBe(next);
    expect(layoutReducer(next, { type: 'setFunds', amount: 8000.2 })).toBe(next);
    expect(layoutReducer(state, { type: 'setFunds', amount: DEFAULT_BUDGET })).toBe(state);
    // Undo is a snapshot restore.
    expect(layoutReducer(next, { type: 'applyLayout', layout: state.layout }).layout).toEqual(state.layout);
  });

  it('the hard budget switch keeps the funds both ways, and never switches on by itself', () => {
    let state = layoutReducer(stateWith([sofa]), { type: 'setFunds', amount: 8000 });
    expect(budgetRemaining(state.layout)).toBeNull();
    state = layoutReducer(state, { type: 'setHardBudget', on: true });
    expect(state.layout.budget).toEqual({ writeOff: 0, amount: 8000 });
    expect(budgetRemaining(state.layout)).toBe(7350);
    state = layoutReducer(state, { type: 'setHardBudget', on: false });
    expect(state.layout.budget).toEqual({ writeOff: 0, enabled: false, amount: 8000 });
  });

  it('a sale keeps the funds', () => {
    const state = stateWith([sofa], { writeOff: 0, amount: 8000 });
    const sold = layoutReducer(state, { type: 'sellItems', ids: ['sofa'] });
    expect(sold.layout.budget).toEqual({ writeOff: 130, amount: 8000 });
  });

  it('the reducer guard refuses what goes past the funds, and lowering the funds under the spend is allowed', () => {
    const state = stateWith([sofa], { writeOff: 0, amount: 1000 });
    expect(layoutReducer(state, { type: 'addItems', items: [makeItem({ id: 'y', price: 351 })] })).toBe(state);
    expect(layoutReducer(state, { type: 'addItems', items: [makeItem({ id: 'y', price: 350 })] })).not.toBe(state);
    const lowered = layoutReducer(state, { type: 'setFunds', amount: 500 });
    expect(budgetRemaining(lowered.layout)).toBe(-150);
    // Over the funds now: selling still works, buying doesn't.
    expect(layoutReducer(lowered, { type: 'sellItems', ids: ['sofa'] }).layout.floors[0]!.items).toHaveLength(0);
    expect(layoutReducer(lowered, { type: 'addItems', items: [makeItem({ id: 'y', price: 1 })] })).toBe(lowered);
  });

  it('a template load keeps the house funds and measures against them', () => {
    const current = makeLayout({ floors: [makeFloor({ items: [] })], budget: { writeOff: 0, amount: 1000 } });
    const cheap = makeLayout({ floors: [makeFloor({ items: [sofa] })] });
    const loaded = loadTemplateUnderBudget(current, cheap, 'template');
    expect(loaded.layout?.budget).toEqual({ writeOff: 0, amount: 1000 });
    const dear = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'x', price: 1001 })] })] });
    expect(loadTemplateUnderBudget(current, dear, 'template').refusal).toMatch(/\$1,000 is left/);
  });
});

describe('funds in saves and links (#609)', () => {
  it('repairs, never refuses', () => {
    const clean = { writeOff: 0, amount: 8000 };
    expect(repairHardBudget(clean)).toBe(clean);
    const cleanOff = { writeOff: 3, enabled: false, amount: 8000 };
    expect(repairHardBudget(cleanOff)).toBe(cleanOff);
    expect(repairHardBudget({ writeOff: 0, amount: 8000.5 })).toEqual({ writeOff: 0, amount: 8001 });
    expect(repairHardBudget({ writeOff: 0, amount: -1 })).toEqual({ writeOff: 0, amount: MIN_FUNDS });
    expect(repairHardBudget({ writeOff: 0, amount: 1e300 })).toEqual({ writeOff: 0, amount: MAX_FUNDS });
    expect(repairHardBudget({ writeOff: 0, amount: 'lots' })).toEqual({ writeOff: 0 });
    expect(repairHardBudget({ writeOff: 0, amount: Number.NaN })).toEqual({ writeOff: 0 });
    expect(repairHardBudget({ writeOff: 0, enabled: false, amount: null })).toEqual({ writeOff: 0, enabled: false });
  });

  it('survives the schema round trip and a share link', async () => {
    const house = makeLayout({ floors: [makeFloor({ items: [sofa] })], budget: { writeOff: 0, enabled: false, amount: 8000 } });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(house)))?.budget).toEqual(house.budget);
    const { url } = await encodeShareUrl(house, 'https://x.test/');
    const decoded = await decodeShareUrl(url.slice(url.indexOf('#')));
    expect(decoded?.budget).toEqual(house.budget);
  });
});

describe('readFunds (#609)', () => {
  it('reads a plain amount, grouped with commas or spaces, after an optional currency sign', () => {
    expect(readFunds('8000')).toEqual({ funds: 8000, note: null });
    expect(readFunds(' $8,000 ')).toEqual({ funds: 8000, note: null });
    expect(readFunds('1 250 000')).toEqual({ funds: 1_250_000, note: null });
    expect(readFunds('')).toBeNull();
    expect(readFunds('  ')).toBeNull();
  });

  it('refuses what it would have to guess at', () => {
    for (const text of ['1e20', '5k', '$5k', '-300', '8000.5', '30.000', '$', ',000', 'lots']) {
      expect(readFunds(text)).toEqual({ refusal: 'Funds take a plain amount, like $8,000' });
    }
  });

  it('clamps to the range and says so', () => {
    expect(readFunds('999999999999')).toEqual({ funds: MAX_FUNDS, note: 'Funds go up to $100,000,000' });
    expect(readFunds('0')).toEqual({ funds: MIN_FUNDS, note: 'Funds start at $100' });
    expect(readFunds('100')).toEqual({ funds: 100, note: null });
  });
});
