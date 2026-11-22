import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildTV } from './builders/builders-electronics';
import { ROOM_OBJECT_TAGS } from './room-builder';
import { TV_GLOW_COLOR, TV_GLOW_INTENSITY, applyTvScreens } from './tv-screens';
import type { BuilderContext } from './builder-utils';
import type { FurnitureItem } from '../lib/types';

const TV: FurnitureItem = { id: 'tv', type: 'tv', name: 'TV Stand', width: 1.5, depth: 0.4, height: 0.5, color: '#2C3E50', icon: '', position: { x: 0, z: 0 } };

function placed(id: string): THREE.Group {
  const context = { THREE, item: { ...TV, id }, hasCollision: false, baseColor: 0x2c3e50, opacity: 1 } as unknown as BuilderContext;
  const group = buildTV(context);
  group.userData.type = ROOM_OBJECT_TAGS.Furniture;
  group.userData.id = id;
  return group;
}

function materials(group: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found: THREE.MeshStandardMaterial[] = [];
  group.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    if (material && !Array.isArray(material)) found.push(material as THREE.MeshStandardMaterial);
  });
  return found;
}

const glowing = (group: THREE.Object3D) => materials(group).filter((material) => material.emissive.getHex() !== 0);

describe('applyTvScreens (#910)', () => {
  it('lights only the screen of a TV switched on, with no light added', () => {
    const scene = new THREE.Scene();
    const on = placed('on');
    const off = placed('off');
    scene.add(on, off);
    const programs = materials(on).map((material) => material.version);
    expect(applyTvScreens(scene, new Set(['on']))).toBe(true);
    const lit = glowing(on);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.emissive.getHex()).toBe(TV_GLOW_COLOR);
    expect(lit[0]!.emissiveIntensity).toBe(TV_GLOW_INTENSITY);
    expect(glowing(off)).toHaveLength(0);
    // Uniforms only: no material asks for a new program, no light joins.
    expect(materials(on).map((material) => material.version)).toEqual(programs);
    let lights = 0;
    scene.traverse((node) => {
      if ((node as THREE.Light).isLight) lights += 1;
    });
    expect(lights).toBe(0);
  });

  it('writes absolutely: switching off restores the built screen, and a repeat changes nothing', () => {
    const scene = new THREE.Scene();
    const tv = placed('tv');
    scene.add(tv);
    const before = materials(tv).map((material) => [material.emissive.getHex(), material.emissiveIntensity]);
    applyTvScreens(scene, new Set(['tv']));
    expect(applyTvScreens(scene, new Set(['tv']))).toBe(false);
    expect(applyTvScreens(scene, new Set())).toBe(true);
    expect(materials(tv).map((material) => [material.emissive.getHex(), material.emissiveIntensity])).toEqual(before);
  });

  it('walks nothing while no TV is on and none is lit', () => {
    const scene = new THREE.Scene();
    const tv = placed('tv');
    scene.add(tv);
    const traverse = vi.spyOn(tv, 'traverse');
    expect(applyTvScreens(scene, new Set())).toBe(false);
    expect(traverse).not.toHaveBeenCalled();
    // Lit once, switching off walks the screens to darken them, then stops again.
    applyTvScreens(scene, new Set(['tv']));
    expect(applyTvScreens(scene, new Set())).toBe(true);
    expect(glowing(tv)).toHaveLength(0);
    traverse.mockClear();
    expect(applyTvScreens(scene, new Set())).toBe(false);
    expect(traverse).not.toHaveBeenCalled();
  });

  it('leaves every other item alone, whatever its id', () => {
    const scene = new THREE.Scene();
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0x222222 }));
    const group = new THREE.Group();
    group.add(lamp);
    group.userData.type = ROOM_OBJECT_TAGS.Furniture;
    group.userData.id = 'lamp';
    scene.add(group);
    expect(applyTvScreens(scene, new Set(['lamp']))).toBe(false);
    expect((lamp.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x222222);
  });
});
