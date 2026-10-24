import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Dressing the people.glb mannequin. Its skin is weighted to named bones, so
 * each triangle is assigned the body region of the bone that moves it most,
 * and the shared geometry is sorted into one draw group per region (once, at
 * load). A person is then a material per region — skin, top, bottoms, shoes —
 * plus a hair mesh hung on the head bone: outfits without a second model,
 * and without copying the geometry per person (#284).
 */
export const REGION = {
  head: 0,
  torso: 1,
  upperArm: 2,
  forearm: 3,
  hand: 4,
  hips: 5,
  thigh: 6,
  shin: 7,
  foot: 8,
} as const;
const REGION_COUNT = 9;

/**
 * The order regions are laid out in the index: up the body from the feet,
 * so every outfit's colours come out as at most five contiguous runs (shoes;
 * bottoms, or bare shins; top; skin, taking in bare forearms) and a person
 * draws each mesh in that many calls, not nine (`lookGroups`).
 */
const REGION_ORDER = [
  REGION.foot,
  REGION.shin,
  REGION.thigh,
  REGION.hips,
  REGION.torso,
  REGION.upperArm,
  REGION.forearm,
  REGION.hand,
  REGION.head,
] as const;

export function regionOfBone(name: string): number {
  if (/head|neck/.test(name)) return REGION.head;
  if (/upper_arm/.test(name)) return REGION.upperArm;
  if (/forearm/.test(name)) return REGION.forearm;
  if (/hand|thumb|f_/.test(name)) return REGION.hand;
  if (/thigh/.test(name)) return REGION.thigh;
  if (/shin/.test(name)) return REGION.shin;
  if (/foot|toe/.test(name)) return REGION.foot;
  if (/hips/.test(name)) return REGION.hips;
  // spine001–003 and the shoulders.
  return REGION.torso;
}

/**
 * Sort a skinned mesh's triangles by body region, in `REGION_ORDER`, and give
 * the geometry one group per region (materialIndex = region). Idempotent.
 */
export function partitionByRegion(mesh: ThreeNS.SkinnedMesh): void {
  const geometry = mesh.geometry;
  const index = geometry.index;
  if (!index || geometry.groups.length > 0) return;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight) return;
  const boneRegion = mesh.skeleton.bones.map((bone) => regionOfBone(bone.name));

  const vertexRegion = new Uint8Array(skinIndex.count);
  for (let v = 0; v < skinIndex.count; v++) {
    let best = 0;
    let bestWeight = -1;
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(v, k);
      if (weight > bestWeight) {
        bestWeight = weight;
        best = skinIndex.getComponent(v, k);
      }
    }
    vertexRegion[v] = boneRegion[best] ?? REGION.torso;
  }

  const buckets: number[][] = Array.from({ length: REGION_COUNT }, () => []);
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const ra = vertexRegion[a]!;
    const rb = vertexRegion[b]!;
    const rc = vertexRegion[c]!;
    // Majority vote; a three-way split goes with the first corner.
    const region = rb === rc ? rb : ra;
    buckets[region]!.push(a, b, c);
  }

  const sorted = index.array.slice(0);
  let offset = 0;
  for (const region of REGION_ORDER) {
    const bucket = buckets[region]!;
    sorted.set(bucket, offset);
    if (bucket.length > 0) geometry.addGroup(offset, bucket.length, region);
    offset += bucket.length;
  }
  index.array.set(sorted);
  index.needsUpdate = true;
}

export interface DrawGroup {
  start: number;
  count: number;
  materialIndex: number;
}

/**
 * The region groups merged wherever neighbours wear the same colour, so a
 * person draws one call per colour run instead of one per region. Each
 * merged group keeps its first region's materialIndex; the regions it took
 * in wear the same colour, so either material draws them alike.
 */
export function lookGroups(
  groups: readonly { start: number; count: number; materialIndex?: number | undefined }[],
  colours: readonly number[]
): DrawGroup[] {
  const merged: DrawGroup[] = [];
  for (const group of groups) {
    const materialIndex = group.materialIndex ?? 0;
    const last = merged[merged.length - 1];
    if (last && last.start + last.count === group.start && colours[last.materialIndex] === colours[materialIndex]) {
      last.count += group.count;
    } else {
      merged.push({ start: group.start, count: group.count, materialIndex });
    }
  }
  return merged;
}

export type HairStyle = 'short' | 'buzz' | 'long' | 'bun' | 'bald';
export const HAIR_STYLES: readonly HairStyle[] = ['short', 'buzz', 'long', 'bun', 'bald'];

export interface PersonLook {
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  hair: number;
  hairStyle: HairStyle;
  /** Short sleeves bare the forearms; shorts bare the shins. */
  shortSleeves: boolean;
  shorts: boolean;
}

export const SKIN_TONES = [0xf1c7a5, 0xe0ac8a, 0xc68863, 0xa8714f, 0x8d5a3b, 0x5e3a26] as const;
const TOPS = [0xc62828, 0x2e7d32, 0x1565c0, 0xf9a825, 0x6a1b9a, 0xeceff1, 0x7cb342, 0xef6c00, 0x00838f, 0xad1457] as const;
const BOTTOMS = [0x263238, 0x37474f, 0x1a237e, 0x4e342e, 0x5d4037, 0x9e9d89, 0x212121] as const;
const SHOES = [0x1c1c1c, 0x3e2723, 0xf5f5f5, 0x5d4037] as const;
const HAIR = [0x1a1a1a, 0x2b1d14, 0x5a3825, 0x8d6e4a, 0xc9a66b, 0x6d6d6d] as const;

/** A deterministic outfit for a seed (an NPC index, a hashed item id). */
export function lookForSeed(seed: number): PersonLook {
  // A small integer hash, so consecutive seeds don't pick neighbouring swatches.
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const next = (n: number) => {
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return h % n;
  };
  return {
    skin: SKIN_TONES[next(SKIN_TONES.length)]!,
    top: TOPS[next(TOPS.length)]!,
    bottom: BOTTOMS[next(BOTTOMS.length)]!,
    shoes: SHOES[next(SHOES.length)]!,
    hair: HAIR[next(HAIR.length)]!,
    hairStyle: HAIR_STYLES[next(HAIR_STYLES.length)]!,
    shortSleeves: next(3) === 0,
    shorts: next(5) === 0,
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Which of a look's colours each region wears. */
export function regionColours(look: PersonLook): number[] {
  const colours = new Array<number>(REGION_COUNT);
  colours[REGION.head] = look.skin;
  colours[REGION.hand] = look.skin;
  colours[REGION.torso] = look.top;
  colours[REGION.upperArm] = look.top;
  colours[REGION.forearm] = look.shortSleeves ? look.skin : look.top;
  colours[REGION.hips] = look.bottom;
  colours[REGION.thigh] = look.bottom;
  colours[REGION.shin] = look.shorts ? look.skin : look.bottom;
  colours[REGION.foot] = look.shoes;
  return colours;
}

export const HEAD_BONE = 'DEF-head';

/**
 * Hair for every style, built once against the model's rest pose and baked
 * into the head bone's local space, so a mesh added under any clone's head
 * bone follows the head. The scene must still be in its rest pose.
 */
export function buildHairGeometries(
  THREE: ThreeModule,
  scene: ThreeNS.Object3D
): Map<HairStyle, ThreeNS.BufferGeometry[]> {
  const styles = new Map<HairStyle, ThreeNS.BufferGeometry[]>();
  scene.updateMatrixWorld(true);
  const head = scene.getObjectByName(HEAD_BONE);
  const box = headBox(THREE, scene);
  if (!head || box.isEmpty()) return styles;

  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const rx = (size.x / 2) * 1.12;
  const ry = (size.y / 2) * 0.92;
  const rz = (size.z / 2) * 1.1;
  const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert();

  const place = (geometry: ThreeNS.BufferGeometry, matrix: ThreeNS.Matrix4) => {
    geometry.applyMatrix4(matrix);
    geometry.applyMatrix4(toHead);
    geometry.computeVertexNormals();
    return geometry;
  };
  const compose = (x: number, y: number, z: number, sx: number, sy: number, sz: number, tilt = 0) =>
    new THREE.Matrix4()
      .makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationX(tilt))
      .multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
  // A cap over the crown, tilted back so it covers more of the back of the
  // head than of the forehead.
  const cap = (scale: number, reach: number) =>
    place(
      new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * reach),
      compose(centre.x, centre.y + size.y * 0.08, centre.z - size.z * 0.02, rx * scale, ry * scale, rz * scale, -0.32)
    );

  styles.set('short', [cap(1, 0.47)]);
  styles.set('buzz', [cap(0.97, 0.42)]);
  styles.set('bun', [
    cap(1, 0.47),
    place(new THREE.SphereGeometry(1, 12, 10), compose(centre.x, centre.y + ry * 0.55, centre.z - rz * 1.05, rx * 0.42, rx * 0.42, rx * 0.42)),
  ]);
  styles.set('long', [
    cap(1.02, 0.5),
    // Falls from the crown to the shoulders behind the neck.
    place(
      new THREE.CapsuleGeometry(1, 1, 4, 12),
      compose(centre.x, centre.y - size.y * 0.32, centre.z - rz * 0.72, rx * 0.88, size.y * 0.36, rz * 0.32)
    ),
  ]);
  styles.set('bald', []);
  return styles;
}

/** The rest-pose bounds of every vertex the head bone moves most. */
function headBox(THREE: ThreeModule, scene: ThreeNS.Object3D): ThreeNS.Box3 {
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  scene.traverse((node) => {
    const mesh = node as ThreeNS.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const headIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === HEAD_BONE);
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    if (headIndex < 0 || !position || !skinIndex || !skinWeight) return;
    const bone = mesh.skeleton.bones[headIndex]!;
    // Rest pose: bone world × inverse bind × bind matrix takes a vertex to the world.
    const toWorld = new THREE.Matrix4()
      .copy(bone.matrixWorld)
      .multiply(mesh.skeleton.boneInverses[headIndex]!)
      .multiply(mesh.bindMatrix);
    for (let v = 0; v < position.count; v++) {
      let best = 0;
      let bestWeight = -1;
      for (let k = 0; k < 4; k++) {
        const weight = skinWeight.getComponent(v, k);
        if (weight > bestWeight) {
          bestWeight = weight;
          best = skinIndex.getComponent(v, k);
        }
      }
      if (best !== headIndex) continue;
      box.expandByPoint(vertex.fromBufferAttribute(position, v).applyMatrix4(toWorld));
    }
  });
  return box;
}
