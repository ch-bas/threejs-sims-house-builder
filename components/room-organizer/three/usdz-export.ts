import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { disposeObject } from './builder-utils';
import { buildExportBuilding, prepareExportBuilding } from './building-export';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * The house in the USDZ file is a model at 1:50 (#937): a 10 m house is
 * 20 cm, the size of a table, and AR Quick Look lets the player pinch it up.
 */
export const USDZ_TABLE_SCALE = 1 / 50;

/** The name of the table-scale node that holds the building. */
export const USDZ_MODEL_NAME = 'TableModel';

/** Texture images the exporter can draw onto a canvas (USDZExporter's imageToCanvas). */
function drawableImage(image: unknown): boolean {
  return (
    (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) ||
    (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
  );
}

// Every map USDZExporter writes into the file.
const TEXTURE_SLOTS = [
  'map',
  'emissiveMap',
  'normalMap',
  'aoMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
] as const;

/** Reverse every triangle of a geometry, keeping its vertices. */
function flipWinding(THREE: ThreeModule, geometry: ThreeNS.BufferGeometry): void {
  const index = geometry.index;
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
    return;
  }
  const count = geometry.getAttribute('position').count;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 3) {
    order[i] = i;
    order[i + 1] = i + 2;
    order[i + 2] = i + 1;
  }
  geometry.setIndex(new THREE.BufferAttribute(order, 1));
}

/**
 * Fold a mirrored item's reflection into its meshes (USD has no negative
 * scale that Quick Look draws the right way out). The node keeps a plain
 * transform; each mesh below it gets a reflected copy of its geometry, in its
 * own frame, with the triangles turned so they face out again. Copies, since
 * a geometry can be shared (two legs of one table, the cached people model).
 */
function unmirror(THREE: ThreeModule, node: ThreeNS.Object3D): void {
  node.scale.x = -node.scale.x;
  node.updateMatrix();
  node.updateMatrixWorld(true);
  const toNode = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const reflect = new THREE.Matrix4().makeScale(-1, 1, 1);
  node.traverse((child) => {
    const mesh = child as ThreeNS.Mesh;
    if (!mesh.isMesh || child === node) return;
    // The mesh's frame in the node's: R. The geometry becomes R⁻¹·S·R.
    const relative = new THREE.Matrix4().multiplyMatrices(toNode, mesh.matrixWorld);
    const conjugate = new THREE.Matrix4().copy(relative).invert().multiply(reflect).multiply(relative);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(conjugate);
    flipWinding(THREE, geometry);
    // The original was never drawn (or belongs to a cache), so it isn't freed here.
    mesh.geometry = geometry;
  });
  if ((node as ThreeNS.Mesh).isMesh) {
    // A mirrored mesh itself (no group around it): reflect its own geometry.
    const mesh = node as ThreeNS.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(reflect);
    flipWinding(THREE, geometry);
    mesh.geometry = geometry;
  }
}

/**
 * A rigged mesh as a plain one in the pose it stands in (USDZExporter writes
 * no skinning: a person would stand in the bind pose, the hair on the head
 * bone floating beside it). Positions and normals are skinned on the CPU,
 * the shader's sum: bindMatrixInverse · Σ wᵢ·boneMatrixᵢ · bindMatrix.
 * Every buffer is a copy: the source is the shared people.glb geometry.
 */
export function bakeSkinnedMesh(THREE: ThreeModule, skinned: ThreeNS.SkinnedMesh): ThreeNS.Mesh {
  skinned.updateMatrixWorld(true);
  skinned.skeleton.update();
  const source = skinned.geometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal') as ThreeNS.BufferAttribute | undefined;
  const skinIndex = source.getAttribute('skinIndex');
  const skinWeight = source.getAttribute('skinWeight');
  const bones = skinned.skeleton.boneMatrices!;
  const positions = new Float32Array(position.count * 3);
  const normals = normal ? new Float32Array(position.count * 3) : null;
  const sum = new THREE.Matrix4();
  const bone = new THREE.Matrix4();
  const skin = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    sum.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(i, k);
      if (weight === 0) continue;
      bone.fromArray(bones, skinIndex.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) sum.elements[e] = sum.elements[e]! + bone.elements[e]! * weight;
    }
    skin.multiplyMatrices(skinned.bindMatrixInverse, sum).multiply(skinned.bindMatrix);
    v.fromBufferAttribute(position, i).applyMatrix4(skin).toArray(positions, i * 3);
    if (normal && normals) {
      normalMatrix.copy(skin).invert().transpose();
      v.fromBufferAttribute(normal, i).transformDirection(normalMatrix).toArray(normals, i * 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  for (const name of ['uv', 'uv1', 'uv2', 'uv3', 'color']) {
    const attribute = source.getAttribute(name) as ThreeNS.BufferAttribute | undefined;
    if (attribute) geometry.setAttribute(name, attribute.clone());
  }
  if (source.index) geometry.setIndex(source.index.clone());
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  const mesh = new THREE.Mesh(geometry, skinned.material);
  mesh.name = skinned.name;
  mesh.visible = skinned.visible;
  mesh.position.copy(skinned.position);
  mesh.quaternion.copy(skinned.quaternion);
  mesh.scale.copy(skinned.scale);
  return mesh;
}

/** Swap every rigged mesh under `root` for its baked pose, in place. */
function bakeSkinnedMeshes(THREE: ThreeModule, root: ThreeNS.Object3D): void {
  const rigged: ThreeNS.SkinnedMesh[] = [];
  root.traverse((node) => {
    if ((node as ThreeNS.SkinnedMesh).isSkinnedMesh) rigged.push(node as ThreeNS.SkinnedMesh);
  });
  for (const skinned of rigged) {
    const parent = skinned.parent;
    if (!parent) continue;
    const baked = bakeSkinnedMesh(THREE, skinned);
    for (const child of [...skinned.children]) baked.add(child);
    parent.children.splice(parent.children.indexOf(skinned), 1, baked);
    baked.parent = parent;
    skinned.parent = null;
    // The person's own bone texture (never uploaded here); the geometry is shared.
    skinned.skeleton.dispose();
  }
}

/**
 * Get the export graph ready for USDZ, in place:
 * - rigged people are baked into their pose;
 * - mirrored items are unmirrored into their geometry;
 * - a two-sided material becomes one-sided with a turned-round copy of the
 *   mesh beside it (USD's Quick Look draws one side only), so a lamp shade
 *   still shows its inside;
 * - a texture whose image isn't drawable (a data texture) is dropped, the
 *   material keeps its colour: the exporter would refuse the whole file.
 * The building's own materials are mutated: they belong to this export.
 */
export function prepareUsdzGraph(THREE: ThreeModule, root: ThreeNS.Object3D): void {
  root.updateMatrixWorld(true);
  bakeSkinnedMeshes(THREE, root);
  root.updateMatrixWorld(true);
  const mirrored: ThreeNS.Object3D[] = [];
  root.traverse((node) => {
    if (node.matrix.determinant() < 0) mirrored.push(node);
  });
  // Outermost first: unmirroring a parent changes its children's frame.
  for (const node of mirrored) {
    node.updateMatrix();
    if (node.matrix.determinant() < 0) unmirror(THREE, node);
  }

  const doubleSided: ThreeNS.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const slots = material as unknown as Record<string, ThreeNS.Texture | null | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const texture = slots[slot];
        if (texture && !drawableImage(texture.image)) {
          slots[slot] = null;
          material.needsUpdate = true;
        }
      }
    }
    if (materials.some((material) => material.side === THREE.DoubleSide)) doubleSided.push(mesh);
  });
  for (const mesh of doubleSided) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) if (material.side === THREE.DoubleSide) material.side = THREE.FrontSide;
    const geometry = mesh.geometry.clone();
    const normal = geometry.getAttribute('normal') as ThreeNS.BufferAttribute | undefined;
    if (normal) {
      for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    flipWinding(THREE, geometry);
    const back = new THREE.Mesh(geometry, mesh.material);
    back.name = `${mesh.name || 'Part'} inside`;
    back.position.copy(mesh.position);
    back.quaternion.copy(mesh.quaternion);
    back.scale.copy(mesh.scale);
    mesh.parent?.add(back);
  }
  // The exporter writes each node's `matrix` as it stands.
  root.updateMatrixWorld(true);
}

/**
 * The building at table size: a node scaled to `USDZ_TABLE_SCALE`, centred
 * over the origin with its lowest point on y = 0, so Quick Look stands it on
 * the table where the player taps. Returns the new root.
 */
export function atTableScale(THREE: ThreeModule, building: ThreeNS.Object3D): ThreeNS.Group {
  const model = new THREE.Group();
  model.name = USDZ_MODEL_NAME;
  building.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(building);
  if (!box.isEmpty()) {
    const centre = box.getCenter(new THREE.Vector3());
    building.position.set(building.position.x - centre.x, building.position.y - box.min.y, building.position.z - centre.z);
  }
  model.scale.setScalar(USDZ_TABLE_SCALE);
  model.add(building);
  return model;
}

/**
 * The whole building as a USDZ archive at table size (#937): the GLB's
 * layout-built graph (detail and relief maps already stripped), prepared for
 * USD and written by three's USDZExporter. Everything built is disposed.
 */
export async function layoutToUsdz(THREE: ThreeModule, layout: RoomLayout): Promise<Uint8Array<ArrayBuffer>> {
  await prepareExportBuilding(THREE, layout);
  return buildingToUsdz(THREE, buildExportBuilding(THREE, layout));
}

/**
 * An export building (from `buildExportBuilding`) as a USDZ archive at table
 * size. Takes ownership of the building and disposes it.
 */
export async function buildingToUsdz(THREE: ThreeModule, building: ThreeNS.Object3D): Promise<Uint8Array<ArrayBuffer>> {
  const model = atTableScale(THREE, building);
  try {
    prepareUsdzGraph(THREE, model);
    return await new USDZExporter().parseAsync(model, {
      // Quick Look reads texture repeats its own way.
      quickLookCompatible: true,
      // Pattern tiles are smaller; a traced plan above this is scaled down.
      maxTextureSize: 1024,
    });
  } finally {
    disposeObject(model);
  }
}
