import { describe, expect, it } from 'vitest';
import { catalogKey } from './catalog-drag';
import { catalogDragKey, catalogFields, catalogItemFromDrag, placedItemVariants, withVariant } from './catalog-variants';
import { FURNITURE_CATALOG } from './constants';
import type { CatalogItem } from './types';

const catalog: readonly CatalogItem[] = FURNITURE_CATALOG;
const entry = (type: string): CatalogItem => {
  const found = catalog.find((candidate) => candidate.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
};

const priced: CatalogItem = {
  type: 'sofa',
  category: 'seating',
  name: 'Test Sofa',
  width: 2,
  depth: 0.9,
  height: 0.8,
  color: '#111111',
  icon: '🛋️',
  price: 600,
  variants: [
    { name: 'Plain', color: '#111111' },
    { name: 'Velvet', color: '#222222', price: 900 },
  ],
};

describe('catalogue variants (#621)', () => {
  it('opens every variant list with the entry in its own colour', () => {
    for (const candidate of catalog) {
      if (!candidate.variants) continue;
      expect(candidate.variants.length, candidate.type).toBeGreaterThanOrEqual(2);
      expect(candidate.variants[0]?.color, candidate.type).toBe(candidate.color);
      for (const variant of candidate.variants) {
        expect(variant.color, `${candidate.type} ${variant.name}`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(variant.price ?? 0).toBeGreaterThanOrEqual(0);
      }
      const names = candidate.variants.map((variant) => variant.name);
      expect(new Set(names).size, candidate.type).toBe(names.length);
    }
  });

  it('offers colours on a handful of entries, the new staples among them', () => {
    const varied = catalog.filter((candidate) => candidate.variants).map((candidate) => candidate.type);
    expect(varied).toEqual(expect.arrayContaining(['sofa', 'bed', 'fridge', 'microwave', 'washer', 'bar-stool', 'ceiling-fan']));
  });

  it('places the entry in the chosen colour and price, without the variant list', () => {
    const velvet = withVariant(priced, 1);
    expect(velvet.color).toBe('#222222');
    expect(velvet.price).toBe(900);
    expect('variants' in velvet).toBe(false);
    const plain = withVariant(priced, 0);
    expect(plain.price).toBe(600);
    expect(plain.color).toBe('#111111');
  });

  it('falls back to the entry for an index it does not have', () => {
    expect(withVariant(priced, 7)).toEqual(catalogFields(priced));
    expect(withVariant(entry('chair'), 2)).toBe(entry('chair'));
  });

  it('round-trips a variant through a drag, and still reads older keys', () => {
    const sofa = entry('sofa');
    expect(catalogDragKey(sofa, 0)).toBe(catalogKey(sofa));
    expect(catalogItemFromDrag(catalog, catalogDragKey(sofa, 2))?.color).toBe(sofa.variants?.[2]?.color);
    expect(catalogItemFromDrag(catalog, catalogKey(sofa))?.color).toBe(sofa.color);
    expect(catalogItemFromDrag(catalog, 'sofa')?.type).toBe('sofa');
    expect(catalogItemFromDrag(catalog, 'sofa:Sofa#x')).toBeUndefined();
    expect(catalogItemFromDrag(catalog, 'no-such-thing')).toBeUndefined();
  });

  it('finds the colours of a placed item by its entry, then by its type', () => {
    expect(placedItemVariants(catalog, { type: 'sofa', name: 'Sofa' })).toBe(entry('sofa').variants);
    expect(placedItemVariants(catalog, { type: 'sofa', name: 'My sofa' })).toBe(entry('sofa').variants);
    expect(placedItemVariants(catalog, { type: 'chair', name: 'Chair' })).toEqual([]);
    expect(placedItemVariants(catalog, { type: 'constructor', name: 'x' })).toEqual([]);
  });
});
