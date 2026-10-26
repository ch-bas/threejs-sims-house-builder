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

describe('applyTheme leaves water, foliage and glowing shades alone (#597)', () => {
  const natural = [
    makeItem({ id: 'pool', type: 'pool', category: 'outdoor', color: '#03A9F4' }),
    makeItem({ id: 'pond', type: 'pond', category: 'outdoor', color: '#0277BD' }),
    makeItem({ id: 'tree', type: 'tree', category: 'outdoor', color: '#2E7D32' }),
    makeItem({ id: 'hedge', type: 'hedge', category: 'outdoor', color: '#388E3C' }),
    makeItem({ id: 'plant', type: 'plant', category: 'decor', color: '#228B22' }),
    makeItem({ id: 'pendant', type: 'pendant-light', category: 'decor', color: '#FFE082' }),
  ];
  // Their colour is only a stand, a frame or a stone basin: the shade, the
  // glass and the water are fixed in the builders, so they restyle.
  const finished = [
    makeItem({ id: 'fence', type: 'fence', category: 'outdoor', color: '#8D6E63' }),
    makeItem({ id: 'lamp', type: 'lamp', category: 'electronics', color: '#FFD700' }),
    makeItem({ id: 'floor-lamp', type: 'floor-lamp', category: 'electronics', color: '#FFD700' }),
    makeItem({ id: 'mirror', type: 'mirror', category: 'decor', color: '#B0BEC5' }),
    makeItem({ id: 'birdbath', type: 'birdbath', category: 'outdoor', color: '#B0BEC5' }),
  ];
  const layout = makeLayout({ floors: [makeFloor({ items: [...natural, ...finished] })] });

  it.each(THEME_LIST.map((theme) => theme.key))('%s keeps the pool blue and the greenery green', (key) => {
    const items = applyTheme(layout, key).floors[0]!.items;
    for (const original of natural) {
      expect(items.find((item) => item.id === original.id)!.color, original.id).toBe(original.color);
    }
  });

  it('still restyles fences, lamp stands, mirror frames and birdbaths', () => {
    const items = applyTheme(layout, 'minimalist').floors[0]!.items;
    const color = (id: string) => items.find((item) => item.id === id)!.color;
    expect(color('fence')).toBe('#bdbdbd');
    expect(color('birdbath')).toBe('#bdbdbd');
    expect(color('lamp')).toBe('#212121');
    expect(color('floor-lamp')).toBe('#212121');
    expect(color('mirror')).toBe('#ff5722');
  });
});
