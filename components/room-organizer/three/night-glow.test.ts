import { describe, expect, it } from 'vitest';
import { applyNightGlow, LIT_PANES_PART } from './night-glow';
import { ROOF_TAG } from './roof';
import * as THREE from './three-runtime';
import type { NightGlowPlan } from '../lib/night-lights';

const PLAN: NightGlowPlan = { windows: { win: 1, far: 0 }, lamps: ['lamp'], dormers: 1 };

function pane(flag: string, opacity = 0.4): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ transparent: true, opacity }));
  mesh.userData[flag] = true;
  return mesh;
}

function furniture(id: string, child: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  group.userData.id = id;
  group.add(child);
  return group;
}

describe('applyNightGlow (#759)', () => {
  it('lights a reached window, leaves a dark one, and restores both by day', () => {
    const lit = pane('litGlass');
    const dark = pane('litGlass');
    const scene = new THREE.Scene();
    scene.add(furniture('win', lit), furniture('far', dark));

    applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: false });
    expect(lit.material.emissiveIntensity).toBeGreaterThan(1);
    expect(lit.material.opacity).toBeGreaterThan(0.8);
    expect(dark.material.emissiveIntensity).toBe(0);
    expect(dark.material.opacity).toBe(0.4);

    applyNightGlow(THREE, scene, { plan: PLAN, level: 0, indoors: false });
    expect(lit.material.emissiveIntensity).toBe(0);
    expect(lit.material.opacity).toBe(0.4);
  });

  it('keeps panes dark seen from inside', () => {
    const lit = pane('litGlass');
    const scene = new THREE.Scene();
    scene.add(furniture('win', lit));
    applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: true });
    expect(lit.material.emissiveIntensity).toBe(0);
    expect(lit.material.opacity).toBe(0.4);
  });

  it('leaves a ghosted window a ghost', () => {
    const ghost = pane('litGlass', 0.2);
    const scene = new THREE.Scene();
    scene.add(furniture('win', ghost));
    applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: false });
    expect(ghost.material.opacity).toBe(0.2);
  });

  it('scales a lamp from what its builder gave it, on repeat too', () => {
    const shade = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0xffff88, emissiveIntensity: 0.3 }));
    const stem = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const lamp = furniture('lamp', shade);
    lamp.add(stem);
    const scene = new THREE.Scene();
    scene.add(lamp);
    applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: false });
    const night = shade.material.emissiveIntensity;
    expect(night).toBeGreaterThan(1);
    applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: false });
    expect(shade.material.emissiveIntensity).toBe(night);
    expect(stem.material.emissiveIntensity).toBe(new THREE.MeshStandardMaterial().emissiveIntensity);
    applyNightGlow(THREE, scene, { plan: PLAN, level: 0, indoors: false });
    expect(shade.material.emissiveIntensity).toBeCloseTo(0.3);
  });

  it('drives the dormers through the roof tag and the street through its part', () => {
    const dormer = new THREE.Group();
    dormer.userData.type = ROOF_TAG;
    const glass = pane('dormerGlass');
    dormer.add(glass);
    const street = pane('unused');
    street.userData.part = LIT_PANES_PART;
    const scene = new THREE.Scene();
    scene.add(dormer, street);
    applyNightGlow(THREE, scene, { plan: PLAN, level: 0.5, indoors: false });
    expect(glass.material.emissiveIntensity).toBeGreaterThan(0);
    expect(street.material.emissiveIntensity).toBeGreaterThan(0);
  });

  it('ignores a key like an Object method for an unknown item', () => {
    const scene = new THREE.Scene();
    scene.add(furniture('constructor', new THREE.Group()));
    expect(() => applyNightGlow(THREE, scene, { plan: PLAN, level: 1, indoors: false })).not.toThrow();
  });
});
