import { SHARED_GEOMETRY } from './builder-utils';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * Rigged, animated people from Quaternius' Universal Animation Library
 * (CC0). The procedural figure in builders/human-figure.ts stays the
 * fallback: it renders until the model loads, and for good if it fails.
 * See assets/README.md for provenance and how people.glb is rebuilt.
 */
export const PEOPLE_CLIPS = {
  idle: 'Idle_Loop',
  talk: 'Idle_Talking_Loop',
  walk: 'Walk_Loop',
} as const;

/** Ground speed (m/s) at which Walk_Loop's feet don't slide at timeScale 1. */
export const WALK_CLIP_SPEED = 1.1;

export interface PeopleModel {
  scene: ThreeNS.Group;
  animations: ThreeNS.AnimationClip[];
  /** Standing height of the model in its own units (feet at y = 0). */
  height: number;
  /** SkeletonUtils.clone — kept here so cloning stays synchronous. */
  cloneSkinned: (source: ThreeNS.Object3D) => ThreeNS.Object3D;
}

export interface PersonColours {
  body: ThreeNS.ColorRepresentation;
  joints: ThreeNS.ColorRepresentation;
  opacity?: number;
}

let model: PeopleModel | null = null;
let pending: Promise<PeopleModel | null> | null = null;
let failed = false;

export function getPeopleModel(): PeopleModel | null {
  return model;
}

/**
 * Load people.glb once. Resolves null (and never retries) on failure so
 * callers simply keep the procedural figure.
 */
export function loadPeopleModel(THREE: ThreeModule): Promise<PeopleModel | null> {
  if (model) return Promise.resolve(model);
  if (failed) return Promise.resolve(null);
  if (!pending) {
    pending = (async () => {
      try {
        const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/utils/SkeletonUtils.js'),
        ]);
        // webpack emits the file with a content hash and applies the Pages
        // assetPrefix, so this URL is right in dev and on GitHub Pages.
        const url = new URL('../assets/people.glb', import.meta.url).href;
        const gltf = await new GLTFLoader().loadAsync(url);
        model = preparePeopleModel(THREE, gltf.scene, gltf.animations, SkeletonUtils.clone);
        return model;
      } catch (error) {
        failed = true;
        console.warn('People model failed to load; keeping the procedural figure.', error);
        return null;
      } finally {
        pending = null;
      }
    })();
  }
  return pending;
}

/** Tests only: install (or clear) the cached model without fetching it. */
export function setPeopleModelForTests(next: PeopleModel | null): void {
  model = next;
  failed = false;
  pending = null;
}

/** Exposed for tests, which parse the GLB from disk instead of fetching it. */
export function preparePeopleModel(
  THREE: ThreeModule,
  scene: ThreeNS.Group,
  animations: ThreeNS.AnimationClip[],
  cloneSkinned: (source: ThreeNS.Object3D) => ThreeNS.Object3D
): PeopleModel {
  const box = new THREE.Box3().setFromObject(scene);
  const height = box.max.y - Math.min(0, box.min.y);
  return { scene, animations, height: height > 0 ? height : 1.8, cloneSkinned };
}

/**
 * A copy of the model with its own skeleton and materials, drawing the cached
 * source geometry (#284): cloning 7.8k skinned vertices per person on every
 * furniture rebuild re-uploaded them to the GPU each time. The source
 * geometry is flagged shared, so disposing a person never frees it.
 */
export function clonePerson(
  THREE: ThreeModule,
  source: PeopleModel,
  colours: PersonColours
): ThreeNS.Object3D {
  const root = source.cloneSkinned(source.scene);
  const opacity = colours.opacity ?? 1;
  root.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.userData[SHARED_GEOMETRY] = true;
    const original = mesh.material as ThreeNS.MeshStandardMaterial;
    const isJoint = original.name === 'M_Joints';
    const material = new THREE.MeshStandardMaterial({
      name: original.name,
      color: isJoint ? colours.joints : colours.body,
      roughness: isJoint ? 0.55 : 0.7,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
    });
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return root;
}

/**
 * Pick a person by the box it stands in instead of its skinned triangles
 * (#284): three skins every tested vertex on the CPU, ~13.7k triangles per
 * hover move. The box is `box` in `frame`'s local space; the hit reports
 * `frame` as the object, which ascends to the furniture root like any mesh.
 */
export function pickByBox(THREE: ThreeModule, frame: ThreeNS.Object3D, box: ThreeNS.Box3): void {
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const point = new THREE.Vector3();
  frame.raycast = (raycaster, intersects) => {
    inverse.copy(frame.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverse);
    if (!localRay.intersectBox(box, point)) return;
    point.applyMatrix4(frame.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point: point.clone(), object: frame });
  };
  frame.traverse((node) => {
    if (node !== frame && (node as ThreeNS.Mesh).isMesh) node.raycast = () => {};
  });
}

export function findClip(source: PeopleModel, name: string): ThreeNS.AnimationClip | null {
  return source.animations.find((clip) => clip.name === name) ?? null;
}
