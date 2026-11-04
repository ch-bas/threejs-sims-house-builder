import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from '../lib/constants';
import { drawDetail, type DetailKind } from '../lib/detail-patterns';
import { disposeObject } from './builder-utils';
import { createFurnitureModel } from './furniture-builders';
import { MATERIAL_CLASSES, releaseDetailTextures, stripDetailMaps, surfaceMaterial } from './furniture-materials';
import type { FurnitureItem } from '../lib/types';

const catalogItem = (type: string): FurnitureItem => {
  const entry = FURNITURE_CATALOG.find((c) => c.type === type);
  if (!entry) throw new Error(`no catalog entry for ${type}`);
  return makeItem({ ...entry, id: type });
};

const parts = (object: THREE.Object3D): Array<{ mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }> => {
  const found: Array<{ mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }> = [];
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) found.push({ mesh: node, material: node.material as THREE.MeshStandardMaterial });
  });
  return found;
};

const context = { THREE, hasCollision: false, opacity: 1 };

describe('furniture material classes (#756)', () => {
  it.each(FURNITURE_CATALOG.map((entry) => entry.type))('%s: every part is a metal or it is not', (type) => {
    for (const { material } of parts(createFurnitureModel(THREE, catalogItem(type), false))) {
      if (material.metalness === undefined) continue;
      expect([0, 1]).toContain(material.metalness);
    }
  });

  it('gives the table its roughness and metalness', () => {
    expect(MATERIAL_CLASSES.fabric).toMatchObject({ roughness: 0.9, metalness: 0 });
    expect(MATERIAL_CLASSES.leather).toMatchObject({ roughness: 0.45, metalness: 0 });
    expect(MATERIAL_CLASSES.woodOiled).toMatchObject({ roughness: 0.5, metalness: 0 });
    expect(MATERIAL_CLASSES.woodLacquered).toMatchObject({ roughness: 0.25, metalness: 0 });
    expect(MATERIAL_CLASSES.ceramic).toMatchObject({ roughness: 0.15, metalness: 0 });
    expect(MATERIAL_CLASSES.painted).toMatchObject({ roughness: 0.5, metalness: 0 });
    expect(MATERIAL_CLASSES.brushedMetal).toMatchObject({ roughness: 0.35, metalness: 1 });
    expect(MATERIAL_CLASSES.plastic).toMatchObject({ roughness: 0.4, metalness: 0 });
  });

  it('keeps the item colour on a detailed part, so colour pickers still work', () => {
    const item = { ...catalogItem('sofa'), color: '#123456' };
    const detailed = parts(createFurnitureModel(THREE, item, false)).filter(({ material }) => material.map);
    expect(detailed.length).toBeGreaterThan(0);
    expect(detailed.some(({ material }) => material.color.getHexString() === '123456')).toBe(true);
  });

  it('keeps the collision tint and fade on a detailed part', () => {
    const tinted = parts(createFurnitureModel(THREE, catalogItem('sofa'), true)).find(({ material }) => material.map)!;
    expect(tinted.material.color.getHexString()).toBe('ff0000');
    expect(tinted.material.transparent).toBe(true);
    expect(tinted.material.opacity).toBeCloseTo(0.7, 5);
  });

  it.each(['sofa', 'armchair', 'dining-table', 'bed', 'bookshelf', 'dresser', 'cabinet'])('%s: detail only sits on UVs in metres', (type) => {
    const all = parts(createFurnitureModel(THREE, catalogItem(type), false));
    expect(all.some(({ material }) => material.map)).toBe(true);
    for (const { mesh, material } of all) {
      if (material.map) expect(mesh.geometry.type, type).toBe('BufferGeometry');
    }
  });
});

describe('shared detail textures (#756, #559)', () => {
  it('shares one texture between items and survives their disposal', () => {
    const material = surfaceMaterial(context, 0xffffff, 'woodOiled', { detailed: true });
    const other = surfaceMaterial(context, 0x123456, 'woodLacquered', { detailed: true });
    expect(other.map).toBe(material.map);
    let disposed = 0;
    material.map!.addEventListener('dispose', () => { disposed += 1; });
    const group = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    disposeObject(group);
    expect(disposed).toBe(0);
    releaseDetailTextures();
    expect(disposed).toBe(1);
  });

  it('redraws after a release', () => {
    // Compare ids: an assertion on the textures themselves formats their
    // pixel arrays, which takes seconds and timed out on CI.
    const first = surfaceMaterial(context, 0xffffff, 'fabric', { detailed: true }).map?.uuid;
    releaseDetailTextures();
    const again = surfaceMaterial(context, 0xffffff, 'fabric', { detailed: true }).map?.uuid;
    expect(first).toBeDefined();
    expect(again).not.toBe(first);
  });

  it('adds no map without asking, and none for a class without detail', () => {
    expect(surfaceMaterial(context, 0xffffff, 'woodOiled').map).toBeNull();
    expect(surfaceMaterial(context, 0xffffff, 'painted', { detailed: true }).map).toBeNull();
  });

  it('strips detail for a GLB, and leaves other maps', () => {
    const detailed = surfaceMaterial(context, 0xffffff, 'fabric', { detailed: true });
    const own = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const group = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), detailed), new THREE.Mesh(new THREE.BoxGeometry(), own));
    stripDetailMaps(group);
    expect(detailed.map).toBeNull();
    expect(own.map).not.toBeNull();
  });
});

describe('detail patterns (#756)', () => {
  const grey = (kind: DetailKind, size = 128): number[] => {
    const { data } = drawDetail(kind, size);
    return Array.from({ length: size * size }, (_, i) => data[i * 4]!);
  };

  it.each(['wood', 'fabric', 'leather'] as const)('%s stays bright enough not to change the colour much', (kind) => {
    const values = grey(kind);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length / 255;
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThanOrEqual(1);
  });

  it.each(['wood', 'leather'] as const)('%s tiles: its edges match as closely as its neighbours do', (kind) => {
    const size = 128;
    const values = grey(kind, size);
    const row = (y: number) => values.slice(y * size, (y + 1) * size);
    const difference = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / size;
    expect(difference(row(0), row(size - 1))).toBeLessThan(difference(row(10), row(11)) * 3 + 2);
  });

  it('is the same every time', () => {
    expect(drawDetail('wood', 32).data).toEqual(drawDetail('wood', 32).data);
  });

  it('costs little to draw at full size', () => {
    const start = performance.now();
    drawDetail('wood', 512);
    drawDetail('fabric', 512);
    drawDetail('leather', 512);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
