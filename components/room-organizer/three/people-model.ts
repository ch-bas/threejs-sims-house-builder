import { markSharedGeometry } from './builder-utils';
import {
  HEAD_BONE,
  type HairStyle,
  type PersonLook,
  buildHairGeometries,
  lookGroups,
  partitionByRegion,
  regionColours,
} from './people-outfits';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

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
  dance: 'Dance_Loop',
  interact: 'Interact',
  pickUp: 'PickUp_Table',
  sitDown: 'Sitting_Enter',
  sitIdle: 'Sitting_Idle_Loop',
  sitTalk: 'Sitting_Talking_Loop',
  standUp: 'Sitting_Exit',
} as const;

/**
 * Sitting_Idle_Loop, measured for a figure scaled to 1.75 m: the hips end up
 * this far behind the spot the feet stood on, and the pose suits a seat
 * surface this high.
 */
export const SIT_HIP_BACK = 0.23;
export const SIT_SURFACE_HEIGHT = 0.42;

/** Ground speed (m/s) at which Walk_Loop's feet don't slide at timeScale 1. */
export const WALK_CLIP_SPEED = 1.1;

export interface PeopleModel {
  scene: ThreeNS.Group;
  animations: ThreeNS.AnimationClip[];
  /** Standing height of the model in its own units (feet at y = 0). */
  height: number;
  /** SkeletonUtils.clone — kept here so cloning stays synchronous. */
  cloneSkinned: (source: ThreeNS.Object3D) => ThreeNS.Object3D;
  /** Hair meshes per style, in the head bone's space; shared by every person. */
  hair: Map<HairStyle, ThreeNS.BufferGeometry[]>;
  /**
   * Per source geometry, the views of it with merged draw groups, keyed by
   * group layout (`lookGeometry`). Shared by every person.
   */
  lookGeometries: Map<ThreeNS.BufferGeometry, Map<string, ThreeNS.BufferGeometry>>;
}

export interface PersonOptions {
  opacity?: number;
  /** Placed people overlapping something glow red, like other furniture. */
  collision?: boolean;
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
  scene.traverse((node) => {
    const mesh = node as ThreeNS.SkinnedMesh;
    if (mesh.isSkinnedMesh) partitionByRegion(mesh);
  });
  const hair = buildHairGeometries(THREE, scene);
  for (const parts of hair.values()) parts.forEach(markSharedGeometry);
  return { scene, animations, height: height > 0 ? height : 1.8, cloneSkinned, hair, lookGeometries: new Map() };
}

/**
 * The source geometry as a look draws it: the same index and attribute
 * objects (so the GPU holds them once, #284), with the region groups merged
 * into one per colour run (`lookGroups`). Cached per group layout, so
 * people whose colours fall into runs alike share one; flagged shared, so
 * disposing a person never frees it.
 */
function lookGeometry(
  THREE: ThreeModule,
  source: PeopleModel,
  geometry: ThreeNS.BufferGeometry,
  colours: readonly number[]
): ThreeNS.BufferGeometry {
  if (geometry.groups.length === 0) return geometry;
  const groups = lookGroups(geometry.groups, colours);
  const key = groups.map((group) => `${group.start}:${group.count}:${group.materialIndex}`).join(',');
  let views = source.lookGeometries.get(geometry);
  if (!views) {
    views = new Map();
    source.lookGeometries.set(geometry, views);
  }
  let view = views.get(key);
  if (!view) {
    view = new THREE.BufferGeometry();
    view.name = geometry.name;
    view.setIndex(geometry.index);
    for (const [name, attribute] of Object.entries(geometry.attributes)) view.setAttribute(name, attribute);
    for (const group of groups) view.addGroup(group.start, group.count, group.materialIndex);
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    view.boundingBox = geometry.boundingBox;
    view.boundingSphere = geometry.boundingSphere;
    markSharedGeometry(view);
    views.set(key, view);
  }
  return view;
}

/**
 * A copy of the model with its own skeleton, dressed in `look`, drawing the
 * cached source geometry (#284): cloning 7.8k skinned vertices per person on
 * every furniture rebuild re-uploaded them to the GPU each time. The source
 * geometry and the hair are flagged shared, so disposing a person never frees
 * them; the materials are the person's own.
 */
export function clonePerson(
  THREE: ThreeModule,
  source: PeopleModel,
  look: PersonLook,
  options: PersonOptions = {}
): ThreeNS.Object3D {
  const root = source.cloneSkinned(source.scene);
  const opacity = options.opacity ?? 1;
  const cache = new Map<number, ThreeNS.MeshStandardMaterial>();
  const paint = (colour: number, roughness: number) => {
    const key = colour * 4 + Math.round(roughness * 3);
    let made = cache.get(key);
    if (!made) {
      made = new THREE.MeshStandardMaterial({
        color: colour,
        roughness,
        metalness: 0,
        transparent: opacity < 1,
        opacity,
        emissive: options.collision ? 0x7f1d1d : 0x000000,
      });
      cache.set(key, made);
    }
    return made;
  };
  // Cloth is matte, skin a little less so.
  const colours = regionColours(look);
  const regions = colours.map((colour) => paint(colour, colour === look.skin ? 0.6 : 0.8));
  root.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    markSharedGeometry(mesh.geometry);
    const grouped = mesh.geometry.groups.length > 0;
    if (grouped) mesh.geometry = lookGeometry(THREE, source, mesh.geometry, colours);
    mesh.material = grouped ? regions : paint(look.top, 0.8);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  const head = root.getObjectByName(HEAD_BONE);
  const hair = source.hair.get(look.hairStyle) ?? [];
  if (head && hair.length > 0) {
    const hairMaterial = paint(look.hair, 0.9);
    for (const geometry of hair) {
      const strand = new THREE.Mesh(geometry, hairMaterial);
      strand.name = 'Hair';
      strand.castShadow = true;
      head.add(strand);
    }
  }
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

/**
 * Free the cached model's GPU buffers when the editor's renderer goes away
 * (#284): people share them, so no person's disposal ever does. The model
 * stays cached; the next renderer uploads it again on first draw.
 */
export function releasePeopleGeometry(): void {
  model?.scene.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  for (const parts of model?.hair.values() ?? []) parts.forEach((geometry) => geometry.dispose());
  for (const views of model?.lookGeometries.values() ?? []) views.forEach((geometry) => geometry.dispose());
}

export function findClip(source: PeopleModel, name: string): ThreeNS.AnimationClip | null {
  return source.animations.find((clip) => clip.name === name) ?? null;
}
