import { describe, expect, it } from 'vitest';
import { iconForItem } from '../plotcraft/icon';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { hasCollisions } from './geometry';
import { isNightLit } from './night-lights';
import { parseStoredLayout } from './schema';
import { applyTheme } from './themes';
import type { FurnitureItem, RoomLayout } from './types';

/** An item as an import or a share link delivers it: plain JSON, any strings. */
function imported(items: Record<string, unknown>[]): RoomLayout | null {
  const layout = makeLayout({ floors: [makeFloor({ items: items as unknown as FurnitureItem[] })] });
  return parseStoredLayout(JSON.parse(JSON.stringify(layout)));
}

function rawItem(overrides: Record<string, unknown>): Record<string, unknown> {
  const { category: _none, ...item } = makeItem();
  return { ...item, ...overrides };
}

// Every Object.prototype member name, as an item's type or category (#568).
const INHERITED = Object.getOwnPropertyNames(Object.prototype);

describe('schema: item strings that name Object.prototype members (#568)', () => {
  it.each(INHERITED)('loads the type "%s" as an unknown item, safe for every lookup', (type) => {
    const layout = imported([rawItem({ type })]);
    expect(layout).not.toBeNull();
    const item = layout!.floors[0]!.items[0]!;
    expect(item.type).toBe(type);
    expect(item.category).toBeUndefined();
    expect(isNightLit(item.type)).toBe(false);
    expect(iconForItem(item.type, item.category)).toBe('box');
    const themed = applyTheme(layout!, 'modern').floors[0]!.items[0]!;
    expect(typeof themed.color).toBe('string');
  });

  it.each(INHERITED)('drops the unknown category "%s" from an unknown type', (category) => {
    const item = imported([rawItem({ type: 'gizmo', category })])!.floors[0]!.items[0]!;
    expect('category' in item).toBe(false);
    expect(typeof applyTheme(makeLayout({ floors: [makeFloor({ items: [item] })] }), 'cozy').floors[0]!.items[0]!.color).toBe('string');
  });
});

describe('schema: a catalogue item without a category gets the catalogue one (#662)', () => {
  const garden = [
    rawItem({ id: 'tree', type: 'tree', width: 1.4, depth: 1.4, position: { x: 6, z: 6 } }),
    rawItem({ id: 'fence', type: 'fence', width: 2, depth: 0.1, position: { x: -6, z: 6 } }),
    rawItem({ id: 'bench', type: 'garden-bench', width: 1.2, depth: 0.5, position: { x: 6, z: -6 } }),
  ];

  it('backfills "outdoor", so the garden is not flagged for leaving the house', () => {
    const items = imported(garden)!.floors[0]!.items;
    expect(items.map((item) => item.category)).toEqual(['outdoor', 'outdoor', 'outdoor']);
    for (const item of items) expect(hasCollisions(item, items, 8, 8)).toBe(false);
  });

  it('replaces an unknown category on a catalogue type, and keeps a known one', () => {
    const [typo, kept] = imported([
      rawItem({ id: 'a', type: 'tree', category: 'outdor' }),
      rawItem({ id: 'b', type: 'chair', category: 'decor' }),
    ])!.floors[0]!.items;
    expect(typo!.category).toBe('outdoor');
    expect(kept!.category).toBe('decor');
  });

  it('leaves an unknown type without a category alone', () => {
    expect('category' in imported([rawItem({ type: 'gizmo' })])!.floors[0]!.items[0]!).toBe(false);
  });

  it('parses a repaired layout back as the same object', () => {
    const once = imported(garden)!;
    expect(parseStoredLayout(once)).toBe(once);
  });
});
