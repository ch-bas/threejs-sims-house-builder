import { describe, expect, it } from 'vitest';
import { makeCatalogItem, makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { FURNITURE_CATALOG, ROOM_TEMPLATES } from '../lib/constants';
import { buildFurnitureSet, FURNITURE_SETS } from '../lib/furniture-sets';
import { surpriseFloorItems } from '../lib/surprise';
import { layoutReducer, type LayoutState } from './layout-reducer';
import type { CatalogItem, FurnitureItem } from '../lib/types';

// A catalogue entry's colour list (#621) belongs to the catalogue: no path
// that puts an item in the house may copy it onto the item.
const carriesVariants = (items: readonly FurnitureItem[]): string[] =>
  items.filter((item) => 'variants' in item).map((item) => `${item.type} ${item.id}`);

const varied: CatalogItem = makeCatalogItem({
  type: 'sofa',
  name: 'Sofa',
  variants: [{ name: 'Slate', color: '#4A5568' }, { name: 'Sand', color: '#C8B49A' }],
});

describe('no placement path copies catalogue variants (#621)', () => {
  it('the catalogue has varied entries to test with', () => {
    expect(FURNITURE_CATALOG.some((entry: CatalogItem) => entry.variants)).toBe(true);
  });

  it('placing, duplicating, pasting and arranging', () => {
    let state: LayoutState = { layout: makeLayout({ floors: [makeFloor({ items: [] })] }), activeFloorIndex: 0 };
    state = layoutReducer(state, { type: 'addCatalogItem', catalogItem: varied, id: 'sofa-1', position: { x: 0, z: 0 } });
    state = layoutReducer(state, { type: 'duplicateItem', sourceId: 'sofa-1', newId: 'sofa-2' });
    const placed = state.layout.floors[0]!.items;
    state = layoutReducer(state, { type: 'addItems', items: placed.map((item) => ({ ...item, id: `${item.id}-copy` })) });
    state = layoutReducer(state, { type: 'bulkSetPositions', positions: new Map([['sofa-1', { x: 1, z: 1 }]]) });
    expect(state.layout.floors[0]!.items.length).toBeGreaterThanOrEqual(2);
    expect(carriesVariants(state.layout.floors[0]!.items)).toEqual([]);
  });

  it('every built-in set', () => {
    for (const set of FURNITURE_SETS) expect(carriesVariants(buildFurnitureSet(set)), set.key).toEqual([]);
  });

  it('Surprise', () => {
    const layout = makeLayout({ width: 10, height: 8, floors: [makeFloor({ items: [] })] });
    for (let seed = 0; seed < 10; seed++) expect(carriesVariants(surpriseFloorItems(layout, 0, 50_000, seed))).toEqual([]);
  });

  it('templates and the porch door', () => {
    for (const template of Object.values(ROOM_TEMPLATES)) {
      for (const floor of template.floors) expect(carriesVariants(floor.items as readonly FurnitureItem[])).toEqual([]);
    }
    let state: LayoutState = { layout: makeLayout({ floors: [makeFloor({ items: [] })] }), activeFloorIndex: 0 };
    state = layoutReducer(state, { type: 'setEntrance', entrance: { width: 1.4, depth: 1.2 } });
    expect(carriesVariants(state.layout.floors[0]!.items)).toEqual([]);
  });
});
