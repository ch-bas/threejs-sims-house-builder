import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { disposeObject } from './builder-utils';
import { buildExportBuilding } from './building-export';
import { type PeopleModel, preparePeopleModel, releasePeopleGeometry, setPeopleModelForTests } from './people-model';
import { buildingToUsdz, prepareUsdzGraph } from './usdz-export';

async function loadAsset(): Promise<PeopleModel> {
  const bytes = readFileSync(fileURLToPath(new URL('../assets/people.glb', import.meta.url)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return preparePeopleModel(THREE, gltf.scene, gltf.animations, cloneSkinned);
}

function personLayout() {
  return makeLayout({
    name: 'Home',
    floors: [
      makeFloor({
        items: [
          makeItem({ id: 'p1', type: 'person', category: 'people', name: 'Adult', width: 0.5, depth: 0.3, height: 1.75, position: { x: 1, z: 0.5 }, rotation: 0.7 }),
          makeItem({ id: 'p2', type: 'person', category: 'people', name: 'Mirrored', width: 0.5, depth: 0.3, height: 1.75, position: { x: -1, z: 0 }, mirrored: true }),
        ],
      }),
    ],
  });
}

const skinnedIn = (root: THREE.Object3D) => {
  const found: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) found.push(node as THREE.SkinnedMesh);
  });
  return found;
};

/** The world bounds of what a renderer draws: skinned vertices in their pose (precise). */
function drawnBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object, true);
}

afterEach(() => {
  setPeopleModelForTests(null);
  releasePeopleGeometry();
});

describe('people in the USDZ (#937)', () => {
  it('stands each person in the pose the editor shows, not the bind pose', async () => {
    setPeopleModelForTests(await loadAsset());
    const building = buildExportBuilding(THREE, personLayout());
    const people = ['Adult', 'Mirrored'].map((name) => building.getObjectByName(name)!);
    const rigged = skinnedIn(building);
    expect(rigged.length).toBeGreaterThan(0);
    const posed = people.map(drawnBox);
    const pieces = rigged.map((mesh) => ({ name: mesh.name, box: drawnBox(mesh) }));
    // The pose matters: the idle stance is not the bind pose.
    const bind = rigged.map((mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    });
    expect(bind.some((box, index) => box.min.distanceTo(pieces[index]!.box.min) + box.max.distanceTo(pieces[index]!.box.max) > 0.02)).toBe(true);
    // The shared people.glb buffers, as they were.
    const sources = rigged.map((mesh) => ({ geometry: mesh.geometry, position: Float32Array.from(mesh.geometry.getAttribute('position').array) }));

    prepareUsdzGraph(THREE, building);

    expect(skinnedIn(building)).toHaveLength(0);
    people.forEach((person, index) => {
      const box = drawnBox(person);
      expect(box.min.distanceTo(posed[index]!.min)).toBeLessThan(1e-4);
      expect(box.max.distanceTo(posed[index]!.max)).toBeLessThan(1e-4);
    });
    // Each baked piece where its rigged one was drawn.
    const baked: THREE.Mesh[] = [];
    for (const person of people) {
      person.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh && pieces.some((piece) => piece.name === mesh.name)) baked.push(mesh);
      });
    }
    expect(baked).toHaveLength(pieces.length);
    baked.forEach((mesh, index) => {
      const box = drawnBox(mesh);
      expect(box.min.distanceTo(pieces[index]!.box.min)).toBeLessThan(1e-4);
      expect(box.max.distanceTo(pieces[index]!.box.max)).toBeLessThan(1e-4);
      for (const name of Object.keys(mesh.geometry.attributes)) {
        expect(sources.some((source) => source.geometry.getAttribute(name) === mesh.geometry.getAttribute(name))).toBe(false);
      }
      // Normals stay unit length after skinning.
      const normal = mesh.geometry.getAttribute('normal');
      expect(new THREE.Vector3().fromBufferAttribute(normal, 0).length()).toBeCloseTo(1, 5);
    });
    for (const source of sources) {
      expect(Float32Array.from(source.geometry.getAttribute('position').array)).toEqual(source.position);
      expect(source.geometry.getAttribute('skinIndex')).toBeDefined();
    }
    disposeObject(building);
  });

  it('writes a house with people', async () => {
    setPeopleModelForTests(await loadAsset());
    const bytes = await buildingToUsdz(THREE, buildExportBuilding(THREE, personLayout()));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
