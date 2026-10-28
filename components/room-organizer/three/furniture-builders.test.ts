import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from '../lib/constants';
import { buildFallback } from './builder-utils';
import { createFurnitureModel } from './furniture-builders';
import type { CatalogItem } from '../lib/types';

// The registry falls back to a plain box for a type it has no builder for, so
// a catalog entry added without one renders silently wrong (#455). Spy on the
// fallback and build the whole catalog.
vi.mock('./builder-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./builder-utils')>();
  return { ...actual, buildFallback: vi.fn(actual.buildFallback) };
});

describe('the furniture builder registry (#455)', () => {
  const catalog: readonly CatalogItem[] = FURNITURE_CATALOG;

  it.each(catalog.map((entry) => [`${entry.type} (${entry.name})`, entry] as const))('builds %s with its own builder', (_label, entry) => {
    vi.mocked(buildFallback).mockClear();
    const group = createFurnitureModel(THREE, makeItem({ ...entry, id: entry.type }), false);
    expect(buildFallback).not.toHaveBeenCalled();
    expect(group.children.length).toBeGreaterThan(0);
  });

  it('still builds an unknown type, as the fallback box', () => {
    vi.mocked(buildFallback).mockClear();
    createFurnitureModel(THREE, makeItem({ type: 'no-such-type' }), false);
    expect(buildFallback).toHaveBeenCalledTimes(1);
  });
});

// A saved or imported item can carry any type string: one that names an
// Object.prototype member resolved to that member instead of the fallback
// and crashed the editor on every load (#568).
describe('the furniture builder registry: inherited keys (#568)', () => {
  const inherited = Object.getOwnPropertyNames(Object.prototype);

  it.each(inherited)('builds the type "%s" as the fallback box', (type) => {
    vi.mocked(buildFallback).mockClear();
    const group = createFurnitureModel(THREE, makeItem({ type }), false);
    expect(buildFallback).toHaveBeenCalledTimes(1);
    expect(group.children.length).toBeGreaterThan(0);
  });
});
