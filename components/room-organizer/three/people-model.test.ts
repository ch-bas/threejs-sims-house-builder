import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it } from 'vitest';
import { disposeObject } from './builder-utils';
import { buildPerson } from './builders/builders-people';
import {
  PEOPLE_CLIPS,
  type PeopleModel,
  clonePerson,
  findClip,
  preparePeopleModel,
  setPeopleModelForTests,
} from './people-model';
import type { FurnitureItem } from '../lib/types';

async function loadAsset(): Promise<PeopleModel> {
  const bytes = readFileSync(fileURLToPath(new URL('../assets/people.glb', import.meta.url)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return preparePeopleModel(THREE, gltf.scene, gltf.animations, cloneSkinned);
}

const skinnedMeshes = (root: THREE.Object3D) => {
  const found: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) found.push(node as THREE.SkinnedMesh);
  });
  return found;
};

const adult: FurnitureItem = {
  id: 'p1',
  type: 'person',
  name: 'Adult',
  width: 0.5,
  depth: 0.3,
  height: 1.75,
  color: '#8FA3BF',
  position: { x: 0, z: 0 },
} as FurnitureItem;

afterEach(() => setPeopleModelForTests(null));

describe('people.glb', () => {
  it('ships a skinned mannequin with every clip the app plays', async () => {
    const people = await loadAsset();
    expect(skinnedMeshes(people.scene).length).toBeGreaterThan(0);
    for (const name of Object.values(PEOPLE_CLIPS)) expect(findClip(people, name)).not.toBeNull();
    expect(people.height).toBeGreaterThan(1.6);
    expect(people.height).toBeLessThan(2);
  });
});

describe('clonePerson', () => {
  it('copies geometry and materials so disposing a person leaves the cache intact', async () => {
    const people = await loadAsset();
    const [source] = skinnedMeshes(people.scene);
    const person = clonePerson(THREE, people, { body: 0x123456, joints: 0x222222, opacity: 0.7 });
    const [copy] = skinnedMeshes(person);
    expect(copy!.geometry).not.toBe(source!.geometry);
    expect(copy!.material).not.toBe(source!.material);
    expect(copy!.skeleton).not.toBe(source!.skeleton);

    let disposed = false;
    source!.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    disposeObject(person);
    expect(disposed).toBe(false);
  });

  it('paints the body and joint materials and honours collision opacity', async () => {
    const people = await loadAsset();
    const person = clonePerson(THREE, people, { body: 0xff0000, joints: 0x00ff00, opacity: 0.7 });
    const materials = skinnedMeshes(person).map((m) => m.material as THREE.MeshStandardMaterial);
    const body = materials.find((m) => m.name === 'M_Main');
    const joints = materials.find((m) => m.name === 'M_Joints');
    expect(body?.color.getHex()).toBe(0xff0000);
    expect(joints?.color.getHex()).toBe(0x00ff00);
    expect(body?.transparent).toBe(true);
    expect(body?.opacity).toBe(0.7);
  });
});

describe('buildPerson', () => {
  const ctx = (item: FurnitureItem) => ({ THREE, item, hasCollision: false, baseColor: item.color, opacity: 1 });

  it('builds the procedural figure until the model has loaded', () => {
    setPeopleModelForTests(null);
    expect(skinnedMeshes(buildPerson(ctx(adult))).length).toBe(0);
  });

  it('builds the rigged figure, scaled to the item height, once it has', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildPerson(ctx({ ...adult, height: 1.5 }));
    expect(skinnedMeshes(group).length).toBeGreaterThan(0);
    const box = new THREE.Box3().setFromObject(group, true);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.35);
    expect(box.max.y - box.min.y).toBeLessThan(1.6);
  });
});
