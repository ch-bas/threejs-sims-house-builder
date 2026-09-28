import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem } from '../lib/__testfixtures__/fixtures';
import { findCatalogEntry, catalogKey } from '../lib/catalog-drag';
import { FURNITURE_CATALOG } from '../lib/constants';
import { STAIR_STEP_COUNT } from '../lib/stairs';
import { buildStairs } from './builders/builders-structure';
import { computeFloorOpenings } from './wall-openings';

const winder = makeItem({ id: 's', type: 'stairs', width: 2, depth: 2.6, height: 3, stairsShape: 'winder', position: { x: 1, z: 2 } });

describe('winder stairs (#205)', () => {
  it('builds every tread within the footprint, climbing to the rise', () => {
    const group = buildStairs({ THREE, item: winder, hasCollision: false, baseColor: 0x8b4513, opacity: 1 });
    const treads = group.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.ExtrudeGeometry);
    expect(treads).toHaveLength(STAIR_STEP_COUNT);
    const box = new THREE.Box3();
    treads.forEach((t) => box.expandByObject(t));
    expect(box.min.x).toBeCloseTo(-1);
    expect(box.max.x).toBeCloseTo(1);
    expect(box.min.z).toBeCloseTo(-1.3);
    expect(box.max.z).toBeCloseTo(1.3);
    expect(box.max.y).toBeCloseTo(3);
  });

  it('cuts the floor above in the stair’s own frame, rotated and mirrored', () => {
    const [plain] = computeFloorOpenings(makeFloor({ items: [winder] }));
    const [turned] = computeFloorOpenings(makeFloor({ items: [{ ...winder, rotation: Math.PI }] }));
    const [mirrored] = computeFloorOpenings(makeFloor({ items: [{ ...winder, mirrored: true }] }));
    // An L: the return flight (+x in the stair frame) is open to its foot,
    // the up flight's foot (−x, −z end) keeps its floor.
    const footOfUpFlight = (o: typeof plain) => {
      const xs = o!.outline!.map(([x]) => x);
      return xs.length === 6 && Math.min(...xs) < 0.1 && Math.max(...xs) > 1.9;
    };
    expect(footOfUpFlight(plain)).toBe(true);
    const lowestZOnSide = (o: typeof plain, side: (x: number) => boolean) =>
      Math.min(...o!.outline!.filter(([x]) => side(x)).map(([, z]) => z));
    // Plain: the +x (world x > 1) side reaches further toward −z than the −x side.
    expect(lowestZOnSide(plain, (x) => x > 1.01)).toBeLessThan(lowestZOnSide(plain, (x) => x < 0.99));
    // A half turn swings the L round; a mirror flips it across x.
    expect(turned!.rotation).toBe(Math.PI);
    // Turned half-way about the stair's position (1, 2): every corner maps to (2 − x, 4 − z).
    turned!.outline!.forEach(([x, z], i) => {
      expect(x).toBeCloseTo(2 - plain!.outline![i]![0]);
      expect(z).toBeCloseTo(4 - plain!.outline![i]![1]);
    });
    expect(lowestZOnSide(mirrored, (x) => x < 0.99)).toBeLessThan(lowestZOnSide(mirrored, (x) => x > 1.01));
  });

  it('cuts a taller storey’s hole to its own rise', () => {
    const straight = makeItem({ id: 'st', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 } });
    const [classic] = computeFloorOpenings(makeFloor({ items: [straight] }));
    const [tall] = computeFloorOpenings(makeFloor({ items: [straight], height: 4 }));
    // A taller storey leaves more headroom over the flight: less floor to cut.
    expect(tall!.depth).toBeLessThan(classic!.depth);
    expect(classic!.outline).toBeUndefined();
  });
});

describe('catalogue keys (#205)', () => {
  it('tells Stairs and Winder Stairs apart, and still reads a bare type', () => {
    const winderEntry = FURNITURE_CATALOG.find((entry) => entry.name === 'Winder Stairs')!;
    expect(findCatalogEntry(FURNITURE_CATALOG, catalogKey(winderEntry))).toBe(winderEntry);
    expect(findCatalogEntry(FURNITURE_CATALOG, 'stairs')!.name).toBe('Stairs');
    const keys = FURNITURE_CATALOG.map(catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
