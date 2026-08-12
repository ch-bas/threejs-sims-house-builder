import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ACHIEVEMENTS } from './achievements';
import type { FurnitureItem } from './types';

function achievement(id: string) {
  const found = ACHIEVEMENTS.find((a) => a.id === id);
  if (!found) throw new Error(`No achievement ${id}`);
  return found;
}

function layoutWithItems(items: FurnitureItem[]) {
  return makeLayout({ floors: [makeFloor({ items })] });
}

function repeatItems(n: number, overrides: Partial<FurnitureItem> = {}): FurnitureItem[] {
  return Array.from({ length: n }, (_, i) => makeItem({ id: `i${i}`, ...overrides }));
}

describe('achievements — count thresholds fire at the boundary', () => {
  it('first-steps fires at 1 item, not at 0', () => {
    expect(achievement('first-steps').isMet(layoutWithItems([]))).toBe(false);
    expect(achievement('first-steps').isMet(layoutWithItems(repeatItems(1)))).toBe(true);
  });

  it('furnished fires at 10, not at 9', () => {
    expect(achievement('furnished').isMet(layoutWithItems(repeatItems(9)))).toBe(false);
    expect(achievement('furnished').isMet(layoutWithItems(repeatItems(10)))).toBe(true);
  });

  it('overstuffed fires at 25, not at 24', () => {
    expect(achievement('overstuffed').isMet(layoutWithItems(repeatItems(24)))).toBe(false);
    expect(achievement('overstuffed').isMet(layoutWithItems(repeatItems(25)))).toBe(true);
  });

  it('counts items across all floors', () => {
    const layout = makeLayout({
      floors: [makeFloor({ id: 'g', items: repeatItems(6) }), makeFloor({ id: 'u', items: repeatItems(6) })],
    });
    expect(achievement('furnished').isMet(layout)).toBe(true);
  });
});

describe('achievements — spend thresholds', () => {
  it('big-spender fires at exactly §10,000', () => {
    const under = repeatItems(1, { price: 9_999 });
    const at = repeatItems(1, { price: 10_000 });
    expect(achievement('big-spender').isMet(layoutWithItems(under))).toBe(false);
    expect(achievement('big-spender').isMet(layoutWithItems(at))).toBe(true);
  });

  it('open-plan requires >=5 items AND total under §3,000', () => {
    const cheapFive = repeatItems(5, { price: 100 }); // total 500
    const pricyFive = repeatItems(5, { price: 1_000 }); // total 5000
    const cheapFour = repeatItems(4, { price: 100 });
    expect(achievement('open-plan').isMet(layoutWithItems(cheapFive))).toBe(true);
    expect(achievement('open-plan').isMet(layoutWithItems(pricyFive))).toBe(false);
    expect(achievement('open-plan').isMet(layoutWithItems(cheapFour))).toBe(false);
  });
});

describe('achievements — type/structure predicates', () => {
  it('wifi-everywhere requires a real wifi access point flag', () => {
    expect(achievement('wifi-everywhere').isMet(layoutWithItems(repeatItems(1)))).toBe(false);
    expect(
      achievement('wifi-everywhere').isMet(layoutWithItems([makeItem({ isWiFiAccessPoint: true })]))
    ).toBe(true);
  });

  it('sky-high and penthouse fire at 2 and 4 floors', () => {
    const floors = (n: number) => makeLayout({ floors: Array.from({ length: n }, (_, i) => makeFloor({ id: `f${i}` })) });
    expect(achievement('sky-high').isMet(floors(1))).toBe(false);
    expect(achievement('sky-high').isMet(floors(2))).toBe(true);
    expect(achievement('penthouse').isMet(floors(3))).toBe(false);
    expect(achievement('penthouse').isMet(floors(4))).toBe(true);
  });

  it('going-up needs a staircase; door-installer needs a door', () => {
    expect(achievement('going-up').isMet(layoutWithItems([makeItem({ type: 'stairs' })]))).toBe(true);
    expect(achievement('going-up').isMet(layoutWithItems([makeItem({ type: 'chair' })]))).toBe(false);
    expect(achievement('door-installer').isMet(layoutWithItems([makeItem({ type: 'door' })]))).toBe(true);
  });

  it('roof-it requires a non-none roof style', () => {
    expect(achievement('roof-it').isMet(makeLayout({ roof: { style: 'none' } }))).toBe(false);
    expect(achievement('roof-it').isMet(makeLayout({ roof: { style: 'gable' } }))).toBe(true);
  });

  it('green-thumb fires at 3 plants/trees/flowerpots', () => {
    const two = [makeItem({ id: '1', type: 'plant' }), makeItem({ id: '2', type: 'tree' })];
    const three = [...two, makeItem({ id: '3', type: 'flowerpot' })];
    expect(achievement('green-thumb').isMet(layoutWithItems(two))).toBe(false);
    expect(achievement('green-thumb').isMet(layoutWithItems(three))).toBe(true);
  });

  it('window-watcher fires at 3 windows', () => {
    expect(achievement('window-watcher').isMet(layoutWithItems(repeatItems(2, { type: 'window' })))).toBe(false);
    expect(achievement('window-watcher').isMet(layoutWithItems(repeatItems(3, { type: 'window' })))).toBe(true);
  });

  it('wall-whisperer fires when any floor has an interior wall', () => {
    const withWall = makeLayout({
      floors: [makeFloor({ interiorWalls: [{ id: 'w', x1: 0, z1: 0, x2: 1, z2: 0 }] })],
    });
    expect(achievement('wall-whisperer').isMet(makeLayout())).toBe(false);
    expect(achievement('wall-whisperer').isMet(withWall)).toBe(true);
  });

  it('decorator fires at 6 unique furniture types', () => {
    const types = ['chair', 'table', 'bed', 'desk', 'lamp', 'sofa'];
    const items = types.map((t, i) => makeItem({ id: `i${i}`, type: t }));
    expect(achievement('decorator').isMet(layoutWithItems(items.slice(0, 5)))).toBe(false);
    expect(achievement('decorator').isMet(layoutWithItems(items))).toBe(true);
  });
});
