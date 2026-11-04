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

// The shadow pass ignores opacity: a transparent pane that casts throws the
// same solid shadow as a wall, so the hole the wall cuts for a window let no
// sun in and the shower stood in a 2 m block of shade (#551).
describe('glass casts no shadow (#551)', () => {
  const meshes = (group: THREE.Group): THREE.Mesh[] =>
    group.children.filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true);
  const transparent = (mesh: THREE.Mesh): boolean => (mesh.material as THREE.Material).transparent;

  it.each(['window', 'shower'])('%s: the glass does not cast, the rest does', (type) => {
    const entry = FURNITURE_CATALOG.find((c) => c.type === type)!;
    const parts = meshes(createFurnitureModel(THREE, makeItem({ ...entry, id: type }), false));
    const glass = parts.filter(transparent);
    const solid = parts.filter((mesh) => !transparent(mesh));
    expect(glass.length).toBeGreaterThan(0);
    expect(solid.length).toBeGreaterThan(0);
    for (const pane of glass) expect(pane.castShadow).toBe(false);
    for (const part of solid) expect(part.castShadow).toBe(true);
  });
});
