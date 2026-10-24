import { describe, expect, it } from 'vitest';
import { CATEGORIES, FURNITURE_CATALOG } from './constants';
import type { CatalogItem } from './types';

// Catalog integrity (#455): the catalog is hand-edited data that every
// placement, price and builder path trusts.
describe('FURNITURE_CATALOG', () => {
  const catalog: readonly CatalogItem[] = FURNITURE_CATALOG;

  it('names each entry once: a type appears twice only as distinct variants', () => {
    const keys = catalog.map((entry) => `${entry.type}/${entry.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('files every entry under a category the UI lists', () => {
    const known = new Set(CATEGORIES.map((category) => category.key));
    for (const entry of catalog) expect(known.has(entry.category ?? ''), `${entry.type} → ${entry.category}`).toBe(true);
  });

  it('lists no category with nothing in it', () => {
    for (const category of CATEGORIES) {
      expect(catalog.some((entry) => entry.category === category.key), category.key).toBe(true);
    }
  });

  it('prices nothing below zero', () => {
    for (const entry of catalog) expect(entry.price ?? 0, entry.type).toBeGreaterThanOrEqual(0);
  });

  it('gives every entry a positive, finite size', () => {
    for (const entry of catalog) {
      for (const size of [entry.width, entry.depth, entry.height]) {
        expect(Number.isFinite(size) && size > 0, `${entry.type} ${entry.width}×${entry.depth}×${entry.height}`).toBe(true);
      }
    }
  });

  it('colours every entry with a #rrggbb hex', () => {
    for (const entry of catalog) expect(entry.color, entry.type).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
