import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clampDormer, dormerPresetFields } from '../lib/dormers';
import { buildDormerWell, dormerWells } from './dormers';
import { buildRoof, removeRoof, ROOF_TAG } from './roof';
import type { DormerSpec } from '../lib/types';

const DORMERS: DormerSpec[] = [
  clampDormer({ id: 'rear', side: 'south', width: 2.4, ...dormerPresetFields('juliet') }),
  { id: 'front', side: 'north', width: 1.6, offset: -2, window: true },
];

const dormerGroups = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.dormerId !== undefined);

describe('dormers on the roof (#203)', () => {
  it('builds one roof-tagged group per dormer on a gable', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'gable', dormers: DORMERS } });
    const groups = dormerGroups(scene);
    expect(groups.map((g) => g.userData.dormerId)).toEqual(['rear', 'front']);
    expect(groups.every((g) => g.userData.type === ROOF_TAG)).toBe(true);
  });

  it('stands each dormer on its own slope, under the ridge', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'gable', dormers: DORMERS } });
    const [rear, front] = dormerGroups(scene).map((g) => new THREE.Box3().setFromObject(g));
    expect(rear!.min.z).toBeGreaterThan(0); // garden (south) side
    expect(front!.max.z).toBeLessThan(0); // street (north) side
    expect(front!.max.x).toBeLessThan(0); // offset −2 along x
    for (const box of [rear!, front!]) {
      expect(box.min.y).toBeGreaterThan(6);
      expect(box.max.y).toBeLessThan(6 + 2.5);
    }
  });

  it('adds a Juliet rail only where asked', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'gable', dormers: DORMERS } });
    const [rear, front] = dormerGroups(scene);
    const balusters = (g: THREE.Object3D) =>
      g.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CylinderGeometry).length;
    expect(balusters(rear!)).toBeGreaterThan(5);
    expect(balusters(front!)).toBe(0);
  });

  it('skips dormers on a flat roof and on gable ends, and removeRoof clears them', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'flat', dormers: DORMERS } });
    expect(dormerGroups(scene)).toHaveLength(0);
    buildRoof(THREE, {
      scene, width: 10, depth: 8, baseY: 6,
      spec: { style: 'gable', dormers: [{ id: 'end', side: 'east', width: 2 }] },
    });
    expect(dormerGroups(scene)).toHaveLength(0);
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'hipped', dormers: DORMERS } });
    expect(dormerGroups(scene)).toHaveLength(2);
    removeRoof(scene);
    expect(scene.children).toHaveLength(0);
  });

  it('glazes the opening on the street side, seen from outside, without a solid shadow (#369)', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'gable', dormers: DORMERS } });
    scene.updateMatrixWorld(true);
    const front = dormerGroups(scene)[1]!;
    const glass = front.children.filter((c) => c.userData.dormerGlass === true) as THREE.Mesh[];
    expect(glass.length).toBeGreaterThan(0);
    for (const pane of glass) {
      expect(pane.castShadow).toBe(false);
      // From the street (north, −z) the first thing a ray meets is the pane.
      const at = pane.getWorldPosition(new THREE.Vector3());
      const { width, height } = (pane.geometry as THREE.PlaneGeometry).parameters;
      // Aim a quarter in from the centre, clear of the mullion and transom.
      const ray = new THREE.Raycaster(new THREE.Vector3(at.x + width / 4, at.y - height / 4, -50), new THREE.Vector3(0, 0, 1));
      expect(ray.intersectObject(front, true)[0]?.object).toBe(pane);
    }
  });
});

describe('dormer wells under the attic ceiling (#487)', () => {
  it('opens one well inside each built dormer, on its own side of the ridge', () => {
    const wells = dormerWells('gable', 10, 8, 6, DORMERS);
    expect(wells).toHaveLength(2);
    const [rear, front] = wells.map((well) => well.rect);
    expect(rear!.z0).toBeGreaterThan(0);
    expect(front!.z1).toBeLessThan(0);
    expect(front!.x1).toBeLessThan(0);
    // Inside the walls, so the plate's hole never meets its outline.
    for (const rect of [rear!, front!]) {
      expect(Math.abs(rect.x0)).toBeLessThan(5);
      expect(Math.abs(rect.x1)).toBeLessThan(5);
      expect(Math.abs(rect.z0)).toBeLessThan(4);
      expect(Math.abs(rect.z1)).toBeLessThan(4);
    }
  });

  it('matches the dormer in plan, its cheeks just outside the well', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 6, spec: { style: 'gable', dormers: DORMERS } });
    const [, front] = dormerGroups(scene).map((g) => new THREE.Box3().setFromObject(g));
    const rect = dormerWells('gable', 10, 8, 6, DORMERS)[1]!.rect;
    expect(rect.x0).toBeGreaterThan(front!.min.x);
    expect(rect.x1).toBeLessThan(front!.max.x);
    expect(rect.x1 - rect.x0).toBeCloseTo(1.6 - 0.02, 5);
  });

  it('skips dormers that do not build and a well overlapping an earlier one', () => {
    expect(dormerWells('flat', 10, 8, 6, DORMERS)).toHaveLength(0);
    expect(dormerWells('gable', 10, 8, 6, [{ id: 'end', side: 'east', width: 2 }])).toHaveLength(0);
    const twin: DormerSpec = { ...DORMERS[1]!, id: 'twin', offset: -1.5 };
    expect(dormerWells('gable', 10, 8, 6, [DORMERS[1]!, twin])).toHaveLength(1);
  });

  it('lines the well from the ceiling to just under the dormer top', () => {
    const [well] = dormerWells('gable', 10, 8, 6, [DORMERS[1]!]);
    const lining = buildDormerWell(THREE, well!.frame, 5.99, new THREE.MeshBasicMaterial());
    lining.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(lining);
    expect(box.min.y).toBeCloseTo(5.99, 5);
    expect(box.max.y).toBeLessThan(well!.frame.topY);
    expect(box.max.y).toBeGreaterThan(well!.frame.topY - 0.05);
    // Two sides, the back, the cap and the strip under the face.
    expect(lining.children).toHaveLength(5);
  });
});
