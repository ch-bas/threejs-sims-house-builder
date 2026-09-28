import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dormerPresetFields } from '../lib/dormers';
import { buildRoof, removeRoof, ROOF_TAG } from './roof';
import type { DormerSpec } from '../lib/types';

const DORMERS: DormerSpec[] = [
  { id: 'rear', side: 'south', width: 2.4, ...dormerPresetFields('juliet') },
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
});
