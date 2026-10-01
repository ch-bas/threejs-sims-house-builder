import { describe, expect, it } from 'vitest';
import { catalogKey, catalogTileBlockedReason, findCatalogEntry } from './catalog-drag';
import { FURNITURE_CATALOG } from './constants';

describe('catalog drag payload', () => {
  it('round-trips every catalogue entry, including variants that share a type (#370)', () => {
    for (const entry of FURNITURE_CATALOG) {
      expect(findCatalogEntry(FURNITURE_CATALOG, catalogKey(entry))).toBe(entry);
    }
  });

  it('resolves Winder Stairs to the winder, not the first stairs entry', () => {
    const winder = FURNITURE_CATALOG.find((entry) => entry.name === 'Winder Stairs');
    expect(winder?.stairsShape).toBe('winder');
    if (!winder) return;
    expect(findCatalogEntry(FURNITURE_CATALOG, catalogKey(winder))).toBe(winder);
  });

  it('still accepts a bare type from older drags', () => {
    expect(findCatalogEntry(FURNITURE_CATALOG, 'sofa')?.type).toBe('sofa');
  });
});

describe('catalogTileBlockedReason', () => {
  const tree = { category: 'outdoor' };
  const sofa = { category: 'seating' };

  it('blocks garden items on an upper floor only (#347)', () => {
    expect(catalogTileBlockedReason(tree, 0)).toBeNull();
    expect(catalogTileBlockedReason(tree, 1)).toMatch(/ground floor/);
    expect(catalogTileBlockedReason(sofa, 1)).toBeNull();
  });
});
