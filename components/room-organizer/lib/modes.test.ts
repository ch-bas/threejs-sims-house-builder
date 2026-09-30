import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './constants';
import {
  BUILD_TOOLS,
  catalogCategoryForTool,
  categoriesForMode,
  isStructureCategory,
  resolveToolForMode,
} from './modes';

describe('categoriesForMode (#151)', () => {
  it('DESIGN shows only structure tools, walls included', () => {
    const design = categoriesForMode('build');
    expect(design).toContain('walls');
    expect(design).toContain('structure');
    expect(design.every(isStructureCategory)).toBe(true);
  });

  it('FURNISH shows only furniture tools, no wall tool', () => {
    const furnish = categoriesForMode('buy');
    expect(furnish).not.toContain('walls');
    expect(furnish).not.toContain('structure');
    expect(furnish.some(isStructureCategory)).toBe(false);
    expect(furnish.length).toBeGreaterThan(0);
  });

  it('EXPLORE has no build tools', () => {
    expect(categoriesForMode('live')).toEqual([]);
  });

  it('DESIGN and FURNISH partition every tool exactly once', () => {
    const all = [...categoriesForMode('build'), ...categoriesForMode('buy')];
    expect([...all].sort()).toEqual([...BUILD_TOOLS].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('every catalog category is reachable from some mode', () => {
    const reachable = new Set([...categoriesForMode('build'), ...categoriesForMode('buy')]);
    for (const category of CATEGORIES) {
      expect(reachable.has(category.key), category.key).toBe(true);
    }
  });

  it("a mode's first tool has catalog items, so a fresh mode is never on the wall toggle", () => {
    expect(categoriesForMode('build')[0]).not.toBe('walls');
    expect(categoriesForMode('buy')[0]).not.toBe('walls');
  });
});

describe('resolveToolForMode (#151)', () => {
  it('keeps a selection the mode offers', () => {
    expect(resolveToolForMode('buy', 'kitchen')).toBe('kitchen');
    expect(resolveToolForMode('build', 'walls')).toBe('walls');
  });

  it("falls back to the mode's first tool when the selection belongs to the other mode", () => {
    expect(resolveToolForMode('buy', 'walls')).toBe(categoriesForMode('buy')[0]);
    expect(resolveToolForMode('build', 'seating')).toBe(categoriesForMode('build')[0]);
  });

  it('leaves the selection alone in EXPLORE, which has no tools', () => {
    expect(resolveToolForMode('live', 'decor')).toBe('decor');
  });
});

describe('catalogCategoryForTool (#151)', () => {
  it('maps the wall tool to the openings that go on walls', () => {
    expect(catalogCategoryForTool('walls')).toBe('structure');
  });

  it('passes catalog categories through', () => {
    expect(catalogCategoryForTool('bedroom')).toBe('bedroom');
  });
});
