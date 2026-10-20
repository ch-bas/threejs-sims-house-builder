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
  releasePeopleGeometry,
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
  it('shares the cached geometry but owns its skeleton and materials; disposing a person leaves the cache intact (#284)', async () => {
    const people = await loadAsset();
    const [source] = skinnedMeshes(people.scene);
    const person = clonePerson(THREE, people, { body: 0x123456, joints: 0x222222, opacity: 0.7 });
    const [copy] = skinnedMeshes(person);
    expect(copy!.geometry).toBe(source!.geometry);
    expect(copy!.material).not.toBe(source!.material);
    expect(copy!.skeleton).not.toBe(source!.skeleton);

    let disposed = false;
    source!.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    let skeletonFreed = false;
    const skeleton = copy!.skeleton;
    const disposeSkeleton = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => {
      skeletonFreed = true;
      disposeSkeleton();
    };
    let materialFreed = false;
    (copy!.material as THREE.Material).addEventListener('dispose', () => {
      materialFreed = true;
    });
    disposeObject(person);
    expect(disposed).toBe(false);
    expect(skeletonFreed).toBe(true);
    expect(materialFreed).toBe(true);
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

describe('picking a rigged person (#284)', () => {
  const ctx = (item: FurnitureItem) => ({ THREE, item, hasCollision: false, baseColor: item.color, opacity: 1 });

  const place = (group: THREE.Object3D, x: number, rotation = 0) => {
    const root = new THREE.Group();
    root.add(group);
    group.position.set(x, 0, 0);
    group.rotation.y = rotation;
    root.updateMatrixWorld(true);
    return root;
  };
  const rayAt = (x: number, y: number) => new THREE.Raycaster(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1));

  it('hits the item box, reports the builder group, and never tests skinned triangles', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildPerson(ctx(adult));
    const root = place(group, 2);
    for (const mesh of skinnedMeshes(group)) expect(mesh.raycast).not.toBe(THREE.SkinnedMesh.prototype.raycast);
    const hits = rayAt(2, 1).intersectObjects(root.children, true);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(group);
    expect(hits[0]!.distance).toBeCloseTo(10 - adult.depth / 2);
    // Beside the box, above the head, and to the person's side: misses.
    expect(rayAt(2 + adult.width, 1).intersectObjects(root.children, true)).toHaveLength(0);
    expect(rayAt(2, adult.height + 0.05).intersectObjects(root.children, true)).toHaveLength(0);
  });

  it('follows the item rotation', async () => {
    setPeopleModelForTests(await loadAsset());
    const group = buildPerson(ctx(adult));
    const root = place(group, 0, Math.PI / 2);
    // Turned a quarter, the 0.5 m width runs along z and the 0.3 m depth along x.
    expect(rayAt(0.2, 1).intersectObjects(root.children, true)).toHaveLength(0);
    expect(rayAt(0.1, 1).intersectObjects(root.children, true)).toHaveLength(1);
  });
});

describe('the shared people geometry (#284)', () => {
  it('is not marked in userData, so GLB extras stay clean', async () => {
    const people = await loadAsset();
    const person = clonePerson(THREE, people, { body: 0x123456, joints: 0x222222 });
    for (const mesh of skinnedMeshes(person)) expect(mesh.geometry.userData).toEqual({});
  });

  it('releasePeopleGeometry frees the cached buffers once the renderer goes, and keeps the model cached', async () => {
    const people = await loadAsset();
    setPeopleModelForTests(people);
    const freed: THREE.BufferGeometry[] = [];
    for (const mesh of skinnedMeshes(people.scene)) {
      mesh.geometry.addEventListener('dispose', () => freed.push(mesh.geometry));
    }
    releasePeopleGeometry();
    expect(freed).toHaveLength(skinnedMeshes(people.scene).length);
    // Still cached: the next renderer uploads it again on first draw.
    expect(skinnedMeshes(buildPerson({ THREE, item: adult, hasCollision: false, baseColor: adult.color, opacity: 1 })).length).toBeGreaterThan(0);
  });

  it('releasePeopleGeometry is a no-op before the model has loaded', () => {
    setPeopleModelForTests(null);
    expect(() => releasePeopleGeometry()).not.toThrow();
  });
});
