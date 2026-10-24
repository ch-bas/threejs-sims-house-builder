import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { CATEGORIES } from './constants';
import { THEME_LIST, applyTheme } from './themes';

describe('applyTheme (#455)', () => {
  const layout = makeLayout({
    floors: [
      makeFloor({
        id: 'ground',
        items: [
          makeItem({ id: 'sofa', type: 'sofa', category: 'seating', color: '#123456' }),
          makeItem({ id: 'door', type: 'door', category: 'structure', color: '#654321' }),
          makeItem({ id: 'loose', color: '#abcdef' }),
        ],
      }),
      makeFloor({ id: 'first', name: 'First Floor', items: [makeItem({ id: 'bed', type: 'bed', category: 'bedroom', color: '#111111' })] }),
    ],
  });

  it('refinishes every floor, not just the active one', () => {
    const themed = applyTheme(layout, 'rustic');
    const [ground, first] = themed.floors;
    expect(first!.floorColor).toBe(ground!.floorColor);
    expect(first!.floorPattern).toBe(ground!.floorPattern);
    expect(first!.wallPattern).toBe(ground!.wallPattern);
    expect(first!.wallColors).toEqual(ground!.wallColors);
    expect(ground!.floorColor).not.toBe(layout.floors[0]!.floorColor);
  });

  it('recolours items by category on every floor and leaves the rest alone', () => {
    const themed = applyTheme(layout, 'modern');
    const items = themed.floors.flatMap((floor) => floor.items);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get('sofa')!.color).not.toBe('#123456');
    expect(byId.get('bed')!.color).not.toBe('#111111');
    // No palette entry for structure, and no category at all: untouched.
    expect(byId.get('door')!.color).toBe('#654321');
    expect(byId.get('loose')!.color).toBe('#abcdef');
  });

  it('keeps everything but the finishes: ids, positions, floor ids, the building', () => {
    const themed = applyTheme(layout, 'cozy');
    expect(themed.floors.map((floor) => floor.id)).toEqual(['ground', 'first']);
    expect(themed.floors.map((floor) => floor.items.map((item) => [item.id, item.position]))).toEqual(
      layout.floors.map((floor) => floor.items.map((item) => [item.id, item.position]))
    );
    expect({ ...themed, floors: [] }).toEqual({ ...layout, floors: [] });
  });

  it('does not share wall colours between floors (a later edit to one must not leak)', () => {
    const themed = applyTheme(layout, 'tropical');
    expect(themed.floors[0]!.wallColors).not.toBe(themed.floors[1]!.wallColors);
  });

  it('gives every theme a palette for the catalog’s categories', () => {
    const known = new Set(CATEGORIES.map((category) => category.key));
    for (const { key } of THEME_LIST) {
      const probe = makeLayout({
        floors: [makeFloor({ items: [...known].map((category) => makeItem({ id: category, category, color: '#000001' })) })],
      });
      const recoloured = applyTheme(probe, key).floors[0]!.items.filter((item) => item.color !== '#000001');
      expect(recoloured.length, key).toBeGreaterThan(0);
    }
  });
});
