import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { FURNITURE_CATALOG, WINDOW_SILL_HEIGHT } from '../lib/constants';
import { isWallHung, mountBand, pendantBulbY } from '../lib/mount-band';
import { createFurnitureModel } from './furniture-builders';
import type { FurnitureItem } from '../lib/types';

/** Mesh bounds may exceed the catalog box by a cap's tilt or a finial, no more. */
const SLACK = 0.025;

const catalogItem = (type: string): FurnitureItem => {
  const entry = FURNITURE_CATALOG.find((c) => c.type === type);
  if (!entry) throw new Error(`no catalog entry for ${type}`);
  return makeItem({ ...entry, id: type });
};

const build = (item: FurnitureItem, storeyHeight?: number): THREE.Group => {
  const group = createFurnitureModel(THREE, item, false, storeyHeight);
  group.updateMatrixWorld(true);
  return group;
};

const bounds = (object: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(object);

function expectInsideBox(type: string): void {
  const item = catalogItem(type);
  const box = bounds(build(item));
  const band = mountBand(item);
  expect(box.min.x, `${type} min.x`).toBeGreaterThanOrEqual(-item.width / 2 - SLACK);
  expect(box.max.x, `${type} max.x`).toBeLessThanOrEqual(item.width / 2 + SLACK);
  expect(box.min.z, `${type} min.z`).toBeGreaterThanOrEqual(-item.depth / 2 - SLACK);
  expect(box.max.z, `${type} max.z`).toBeLessThanOrEqual(item.depth / 2 + SLACK);
  expect(box.min.y, `${type} min.y`).toBeGreaterThanOrEqual(band.bottom - SLACK);
  expect(box.max.y, `${type} max.y`).toBeLessThanOrEqual(band.top + SLACK);
}

const meshes = (group: THREE.Object3D): THREE.Mesh[] => {
  const found: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) found.push(node);
  });
  return found;
};

const materialOf = (node: THREE.Mesh): THREE.MeshStandardMaterial => node.material as THREE.MeshStandardMaterial;

/** The first mesh a ray straight down from above the item's centre hits. */
function firstHitFromAbove(group: THREE.Group, x = 0, z = 0): THREE.Object3D | undefined {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(group, true)[0]?.object;
}

describe('hung items are built where mountBand says (#471, #470)', () => {
  const hung = FURNITURE_CATALOG.filter((c) => isWallHung(c.type)).map((c) => c.type);

  it('covers the pendant light as well as the wall decor', () => {
    expect(hung).toEqual(expect.arrayContaining(['painting', 'mirror', 'wall-shelf', 'wall-clock', 'curtains', 'pendant-light']));
  });

  it.each(hung)('%s: mesh bounds match its mount band', (type) => {
    const item = catalogItem(type);
    const box = bounds(build(item));
    const band = mountBand(item);
    expect(box.min.y).toBeCloseTo(band.bottom, 1);
    expect(Math.abs(box.max.y - band.top)).toBeLessThan(SLACK);
  });

  it('hangs the pendant from the ceiling of a 3 m storey by default', () => {
    const box = bounds(build(catalogItem('pendant-light')));
    expect(box.max.y).toBeLessThan(3);
    expect(box.max.y).toBeGreaterThan(2.99);
    expect(box.min.y).toBeCloseTo(2, 5);
  });

  it.each([2.4, 3, 4.5])('hangs the pendant from a %s m ceiling, its canopy just below it', (ceiling) => {
    const item = catalogItem('pendant-light');
    const box = bounds(build(item, ceiling));
    expect(box.max.y).toBeLessThan(ceiling);
    expect(box.max.y).toBeGreaterThan(ceiling - 0.01);
    expect(box.min.y).toBeCloseTo(ceiling - item.height, 5);
  });

  it('draws the bulb at pendantBulbY', () => {
    const item = catalogItem('pendant-light');
    for (const ceiling of [2.4, 3, 4.5]) {
      const bulb = meshes(build(item, ceiling)).find((m) => m.geometry instanceof THREE.SphereGeometry)!;
      const centre = bounds(bulb).getCenter(new THREE.Vector3());
      expect(centre.y).toBeCloseTo(pendantBulbY(item, ceiling), 5);
    }
  });

  it('hangs the pendant from a lower ceiling, and never through the floor', () => {
    const item = catalogItem('pendant-light');
    const low = bounds(build(item, 2.4));
    expect(low.max.y).toBeCloseTo(2.4, 1);
    expect(low.min.y).toBeCloseTo(2.4 - item.height, 5);
    expect(mountBand(item, 2.4)).toEqual({ bottom: 2.4 - item.height, top: 2.4 });
    const tiny = bounds(build({ ...item, height: 1.5 }, 1.2));
    expect(tiny.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(tiny.max.y).toBeCloseTo(1.2, 1);
  });
});

describe('the builders fitted in #388 and #167 stay inside their catalog box', () => {
  it.each(['lamp', 'floor-lamp', 'pendant-light', 'painting', 'bush', 'pet', 'wifi', 'router', 'pool', 'bathtub'])(
    '%s',
    (type) => expectInsideBox(type)
  );

  // Measured with expectInsideBox's 2.5 cm slack; these builders predate the
  // fit and still overflow their catalog box.
  it.todo(
    'fit the rest of the catalog: bed / nightstand / wardrobe / dresser / cabinet / fridge / stove / ' +
      'dishwasher backs (z, 3-6 cm), kitchen-sink and bathroom-sink taps (y), tv and computer stands (y), ' +
      'security-camera (x, y), plant (x 0.8 m in a 0.4 m box), curtains (x), candles (y), tree, pine-tree and ' +
      'hedge canopies (x, z, y), tulips (y), bbq (x, z, y; firebox starts 0.19 m up), mailbox (x, y), ' +
      'lamppost (y), picnic-table (y), pond cattails (y 1.0 m in a 0.25 m box), person (x, y), ' +
      'window frame and ledge (x, z)'
  );

  it.each(['painting', 'mirror'])('keeps the %s off the wall plane and inside its depth', (type) => {
    const item = catalogItem(type);
    const box = bounds(build(item));
    // The back (−z) hangs against the wall: nothing may reach or cross it.
    expect(box.min.z).toBeGreaterThan(-item.depth / 2 + 1e-4);
    expect(box.max.z).toBeLessThanOrEqual(item.depth / 2 + 1e-6);
  });

  it('shows the painted canvas in front of the frame', () => {
    const [frame, canvas, ...blobs] = meshes(build(catalogItem('painting')));
    expect(bounds(canvas!).max.z).toBeGreaterThan(bounds(frame!).max.z);
    for (const blob of blobs) expect(bounds(blob).max.z).toBeGreaterThan(bounds(canvas!).max.z);
  });

  it('stands the bush on the floor', () => {
    expect(bounds(build(catalogItem('bush'))).min.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it('renders both faces of the open lamp shades', () => {
    for (const type of ['lamp', 'floor-lamp', 'pendant-light']) {
      const open = meshes(build(catalogItem(type))).filter(
        (m) => m.geometry instanceof THREE.CylinderGeometry && m.geometry.parameters.openEnded
      );
      expect(open.length, type).toBeGreaterThan(0);
      for (const shade of open) expect(materialOf(shade).side, type).toBe(THREE.DoubleSide);
    }
  });
});

describe('straight stairs handrails (#388)', () => {
  it('stop at the floor above and stay inside the stair width', () => {
    const item = catalogItem('stairs');
    const rails = meshes(build(item)).filter((m) => m.geometry instanceof THREE.CylinderGeometry);
    expect(rails.length).toBeGreaterThan(0);
    for (const rail of rails) {
      const box = bounds(rail);
      expect(box.max.y).toBeLessThanOrEqual(item.height + SLACK);
      expect(Math.abs(box.max.x)).toBeLessThanOrEqual(item.width / 2 + 1e-6);
      expect(Math.abs(box.min.x)).toBeLessThanOrEqual(item.width / 2 + 1e-6);
    }
  });
});

describe('TV screen and bezel (#388)', () => {
  it('do not share a back face', () => {
    const [, screen, bezel] = meshes(build(catalogItem('tv')));
    expect(bounds(screen!).min.z - bounds(bezel!).min.z).toBeGreaterThan(0.005);
  });
});

describe('basins are hollow, so their water shows (#365)', () => {
  it.each(['pool', 'bathtub', 'pond'])('%s: water is the first thing seen from above', (type) => {
    const group = build(catalogItem(type));
    const hit = firstHitFromAbove(group) as THREE.Mesh | undefined;
    expect(hit).toBeDefined();
    expect(materialOf(hit!).transparent).toBe(true);
    expect(materialOf(hit!).opacity).toBeLessThan(1);
  });

  it('shows the pool in its own colour', () => {
    const item = catalogItem('pool');
    const hit = firstHitFromAbove(build(item)) as THREE.Mesh;
    expect(materialOf(hit).color.getHexString()).toBe(new THREE.Color(item.color).getHexString());
  });

  it('keeps a hollow bed in a pond narrower than its rim', () => {
    const item = { ...catalogItem('pond'), width: 0.2, depth: 0.2 };
    const hit = firstHitFromAbove(build(item)) as THREE.Mesh | undefined;
    expect(materialOf(hit!).transparent).toBe(true);
    // The water fills the inner 60 %, inside the rim rather than a 5 cm disc past it.
    const water = bounds(hit!);
    expect(water.max.x - water.min.x).toBeCloseTo(item.width * 0.6, 3);
  });

  it('keeps the water just under the rim', () => {
    for (const type of ['pool', 'pond']) {
      const item = catalogItem(type);
      const hit = firstHitFromAbove(build(item))!;
      const top = bounds(hit).max.y;
      expect(top, type).toBeLessThan(item.height);
      expect(top, type).toBeGreaterThan(item.height - 0.02);
    }
  });
});

describe('window (#362)', () => {
  it('builds nothing under the sill ledge: the wall below is the wall', () => {
    const item = catalogItem('window');
    const box = bounds(build(item));
    // The ledge is centred on the sill; nothing reaches the floor.
    expect(box.min.y).toBeGreaterThan(WINDOW_SILL_HEIGHT - 0.05);
    expect(meshes(build(item)).some((m) => materialOf(m).color.getHex() === 0xcccccc)).toBe(false);
  });
});
