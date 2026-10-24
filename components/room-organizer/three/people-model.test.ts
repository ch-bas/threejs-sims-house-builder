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
import { type PersonLook, REGION } from './people-outfits';
import type { FurnitureItem } from '../lib/types';

const LOOK: PersonLook = {
  skin: 0xe0ac8a,
  top: 0xff0000,
  bottom: 0x0000ff,
  shoes: 0x111111,
  hair: 0x5a3825,
  hairStyle: 'short',
  shortSleeves: false,
  shorts: false,
};

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
    const person = clonePerson(THREE, people, LOOK, { opacity: 0.7 });
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
    (copy!.material as THREE.Material[])[REGION.torso]!.addEventListener('dispose', () => {
      materialFreed = true;
    });
    disposeObject(person);
    expect(disposed).toBe(false);
    expect(skeletonFreed).toBe(true);
    expect(materialFreed).toBe(true);
  });

  it('dresses each body region and honours collision opacity', async () => {
    const people = await loadAsset();
    const person = clonePerson(THREE, people, LOOK, { opacity: 0.7, collision: true });
    for (const mesh of skinnedMeshes(person)) {
      expect(mesh.geometry.groups.length).toBeGreaterThan(5);
      const colourOf = (region: number) => {
        const group = mesh.geometry.groups.find((g) => g.materialIndex === region);
        return group ? (mesh.material as THREE.MeshStandardMaterial[])[region]!.color.getHex() : undefined;
      };
      expect(colourOf(REGION.head)).toBe(LOOK.skin);
      expect(colourOf(REGION.torso)).toBe(LOOK.top);
      expect(colourOf(REGION.thigh)).toBe(LOOK.bottom);
      expect(colourOf(REGION.foot)).toBe(LOOK.shoes);
      const torso = (mesh.material as THREE.MeshStandardMaterial[])[REGION.torso]!;
      expect(torso.transparent).toBe(true);
      expect(torso.opacity).toBe(0.7);
      expect(torso.emissive.getHex()).not.toBe(0);
    }
  });

  it('bares the forearms and shins for short sleeves and shorts', async () => {
    const people = await loadAsset();
    const [mesh] = skinnedMeshes(clonePerson(THREE, people, { ...LOOK, shortSleeves: true, shorts: true }));
    const materials = mesh!.material as THREE.MeshStandardMaterial[];
    expect(materials[REGION.forearm]!.color.getHex()).toBe(LOOK.skin);
    expect(materials[REGION.shin]!.color.getHex()).toBe(LOOK.skin);
  });

  it('puts the hair on the head bone, sized to the head, and none when bald', async () => {
    const people = await loadAsset();
    for (const style of ['short', 'buzz', 'long', 'bun'] as const) {
      const person = clonePerson(THREE, people, { ...LOOK, hairStyle: style });
      const hair = person.getObjectsByProperty('name', 'Hair');
      expect(hair.length).toBeGreaterThan(0);
      expect(hair[0]!.parent?.name).toBe('DEF-head');
      person.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const strand of hair) box.expandByObject(strand);
      // On top of a 1.83 m model, no wider than a head and a bit.
      expect(box.max.y).toBeGreaterThan(1.7);
      expect(box.max.y).toBeLessThan(1.95);
      expect(box.max.x - box.min.x).toBeLessThan(0.3);
    }
    const bald = clonePerson(THREE, people, { ...LOOK, hairStyle: 'bald' });
    expect(bald.getObjectsByProperty('name', 'Hair')).toHaveLength(0);
  });

  it('shares the hair geometry between people', async () => {
    const people = await loadAsset();
    const first = clonePerson(THREE, people, LOOK);
    const second = clonePerson(THREE, people, { ...LOOK, hair: 0x111111 });
    const [a] = first.getObjectsByProperty('name', 'Hair') as THREE.Mesh[];
    const [b] = second.getObjectsByProperty('name', 'Hair') as THREE.Mesh[];
    expect(b!.geometry).toBe(a!.geometry);
    expect(b!.material).not.toBe(a!.material);
    let freed = false;
    a!.geometry.addEventListener('dispose', () => {
      freed = true;
    });
    disposeObject(first);
    expect(freed).toBe(false);
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
    const person = clonePerson(THREE, people, LOOK);
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
