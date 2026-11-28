import * as THREE from 'three';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureCpuAsync } from '../lib/__testfixtures__/cpu-time';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { ROOM_TEMPLATES } from '../lib/constants';
import { disposeObject } from './builder-utils';
import { buildExportBuilding } from './building-export';
import { USDZ_MODEL_NAME, USDZ_TABLE_SCALE, atTableScale, buildingToUsdz, layoutToUsdz, prepareUsdzGraph } from './usdz-export';
import type { RoomLayout } from '../lib/types';

interface ZipEntry {
  name: string;
  method: number;
  dataOffset: number;
  data: Uint8Array;
}

/** The archive's local file entries, in order, read the way a USDZ reader does. */
function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const compressed = view.getUint32(at + 18, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    // Sizes in the header, no data descriptor: a USDZ is read in place.
    expect(flags & 0x08).toBe(0);
    expect(compressed).toBe(size);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const dataOffset = at + 30 + nameLength + extraLength;
    entries.push({ name, method, dataOffset, data: bytes.subarray(dataOffset, dataOffset + size) });
    at = dataOffset + size;
  }
  // The central directory follows the last entry.
  expect(view.getUint32(at, true)).toBe(0x02014b50);
  return entries;
}

const text = (entry: ZipEntry | undefined) => new TextDecoder().decode(entry!.data);

/** What makes an archive a USDZ (Pixar's spec, as Quick Look reads it). */
function expectValidUsdz(bytes: Uint8Array): ZipEntry[] {
  const entries = readZip(bytes);
  expect(entries.length).toBeGreaterThan(1);
  // The first file is the stage Quick Look opens.
  expect(entries[0]!.name).toBe('model.usda');
  const names = new Set(entries.map((entry) => entry.name));
  expect(names.size).toBe(entries.length);
  for (const entry of entries) {
    // Stored, never deflated, and each file 64-byte aligned.
    expect(entry.method, entry.name).toBe(0);
    expect(entry.dataOffset % 64, entry.name).toBe(0);
    expect(entry.name).toMatch(/^(model\.usda|geometries\/Geometry_\d+\.usda|textures\/Texture_\d+_(true|false)\.(png|jpg))$/);
  }
  const stage = text(entries[0]);
  expect(stage.startsWith('#usda 1.0')).toBe(true);
  expect(stage).toContain('defaultPrim = "Root"');
  expect(stage).toContain('upAxis = "Y"');
  expect(stage).toContain('metersPerUnit = 1');
  expect(stage).toContain('token preliminary:anchoring:type = "plane"');
  // Every file the stage points at is in the archive, and nothing else is.
  const referenced = new Set([...stage.matchAll(/@\.?\/?([^@]+?)(?:@)/g)].map((match) => match[1]!.replace(/^\.\//, '')));
  for (const path of referenced) expect(names.has(path), path).toBe(true);
  for (const entry of entries.slice(1)) expect(referenced.has(entry.name), entry.name).toBe(true);
  for (const entry of entries.filter((e) => e.name.startsWith('geometries/'))) {
    const geometry = text(entry);
    expect(geometry.startsWith('#usda 1.0')).toBe(true);
    expect(geometry).toContain('def Mesh "Geometry"');
    expect(geometry).not.toContain('NaN');
  }
  return entries;
}

function mirroredLayout(): RoomLayout {
  return makeLayout({
    name: 'Villa',
    width: 8,
    height: 6,
    floors: [
      makeFloor({
        items: [
          makeItem({ id: 'sofa', type: 'sofa', name: 'Sofa', position: { x: -1, z: 0 }, rotation: Math.PI / 2, mirrored: true }),
          makeItem({ id: 'lamp', type: 'lamp', name: 'Lamp', width: 0.3, depth: 0.3, height: 1.5, position: { x: 2, z: 1 } }),
        ],
      }),
    ],
    roof: { style: 'gable', color: '#7a4b3a' },
  });
}

function worldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

describe('USDZ export (#937)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(Object.entries(ROOM_TEMPLATES))('writes the %s template as a valid USDZ', async (_key, template) => {
    const bytes = await layoutToUsdz(THREE, template);
    const entries = expectValidUsdz(bytes);
    const stage = text(entries[0]);
    expect(stage).toContain(`def Xform "${USDZ_MODEL_NAME}"`);
    expect(stage).not.toContain('NaN');
  });

  it('scales the building to 1:50, centred, standing on y = 0', () => {
    const layout = ROOM_TEMPLATES.twoStory;
    const building = buildExportBuilding(THREE, layout);
    const before = worldBox(building);
    const model = atTableScale(THREE, building);
    const after = worldBox(model);
    expect(model.scale.x).toBeCloseTo(USDZ_TABLE_SCALE);
    const size = (box: THREE.Box3) => box.getSize(new THREE.Vector3());
    expect(size(after).x).toBeCloseTo(size(before).x / 50, 6);
    expect(size(after).y).toBeCloseTo(size(before).y / 50, 6);
    expect(after.min.y).toBeCloseTo(0, 9);
    expect((after.min.x + after.max.x) / 2).toBeCloseTo(0, 9);
    expect((after.min.z + after.max.z) / 2).toBeCloseTo(0, 9);
    // Table size: a house of a few metres is a few tens of centimetres.
    expect(size(after).x).toBeLessThan(0.5);
    expect(size(after).x).toBeGreaterThan(0.05);
    disposeObject(model);
  });

  it('writes the 1:50 scale into the stage', async () => {
    const stage = text(readZip(await layoutToUsdz(THREE, ROOM_TEMPLATES.bedroom))[0]);
    const node = stage.slice(stage.indexOf(`def Xform "${USDZ_MODEL_NAME}"`));
    expect(node).toMatch(/matrix4d xformOp:transform = \( \(0\.02, 0, 0, 0\), \(0, 0\.02, 0, 0\), \(0, 0, 0\.02, 0\)/);
  });

  it('folds a mirrored item into its geometry, the same shape facing out', () => {
    const building = buildExportBuilding(THREE, mirroredLayout());
    const sofa = building.getObjectByName('Sofa')!;
    const before = worldBox(sofa);
    const outward = sampleNormals(sofa);
    prepareUsdzGraph(THREE, building);
    building.updateMatrixWorld(true);
    let negative = 0;
    building.traverse((node) => {
      if (node.matrix.determinant() < 0) negative += 1;
    });
    expect(negative).toBe(0);
    const after = worldBox(sofa);
    for (const key of ['min', 'max'] as const) {
      expect(after[key].x).toBeCloseTo(before[key].x, 6);
      expect(after[key].y).toBeCloseTo(before[key].y, 6);
      expect(after[key].z).toBeCloseTo(before[key].z, 6);
    }
    // The triangles still face where their normals point (wound counter-clockwise).
    expect(sampleNormals(sofa)).toEqual(outward);
    disposeObject(building);
  });

  it('turns a two-sided material into a front side and an inside copy', () => {
    const building = buildExportBuilding(THREE, mirroredLayout());
    const doubled: THREE.Mesh[] = [];
    building.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).side === THREE.DoubleSide) doubled.push(mesh);
    });
    expect(doubled.length).toBeGreaterThan(0);
    const parts = doubled.map((mesh) => mesh.parent!.children.length);
    prepareUsdzGraph(THREE, building);
    building.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (material) expect(material.side).not.toBe(THREE.DoubleSide);
    });
    doubled.forEach((mesh, index) => {
      expect(mesh.parent!.children.length).toBe(parts[index]! + 1);
      const inside = mesh.parent!.children.find((child) => child.name === `${mesh.name || 'Part'} inside`) as THREE.Mesh;
      expect(inside.geometry).not.toBe(mesh.geometry);
      const normal = (geometry: THREE.BufferGeometry) => geometry.getAttribute('normal').getX(0);
      expect(normal(inside.geometry)).toBeCloseTo(-normal(mesh.geometry));
    });
    disposeObject(building);
  });

  it('packs drawable textures as PNGs the materials point at, and drops data textures', async () => {
    // No DOM here: what the exporter touches, stubbed (an OffscreenCanvas
    // image, the canvas it redraws it on, and the PNG it encodes).
    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number
      ) {}
    }
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const drawn: Array<{ width: number; height: number }> = [];
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ translate() {}, scale() {}, drawImage: () => drawn.push({ width: canvas.width, height: canvas.height }) }),
          toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob([png], { type })),
        };
        return canvas;
      },
    });
    const building = buildExportBuilding(THREE, ROOM_TEMPLATES.bedroom);
    const floor = building.getObjectByName('Floor') as THREE.Mesh;
    const pattern = new THREE.Texture(new FakeOffscreenCanvas(2048, 512) as unknown as OffscreenCanvas);
    pattern.repeat.set(4, 4);
    (floor.material as THREE.MeshStandardMaterial).map = pattern;
    const dataTextured = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1) }));
    building.add(dataTextured);

    const entries = expectValidUsdz(await buildingToUsdz(THREE, building));
    const textures = entries.filter((entry) => entry.name.startsWith('textures/'));
    expect(textures).toHaveLength(1);
    expect([...textures[0]!.data]).toEqual([...png]);
    expect(text(entries[0])).toContain(`asset inputs:file = @${textures[0]!.name}@`);
    // Scaled to the 1024 px cap, its proportions kept.
    expect(drawn).toEqual([{ width: 1024, height: 256 }]);
    expect((dataTextured.material as THREE.MeshStandardMaterial).map).toBeNull();
  });

  it('reads back through a USD loader as the same house at 1:50, mirrored sofa included', async () => {
    const layout = mirroredLayout();
    const model = atTableScale(THREE, buildExportBuilding(THREE, layout));
    const expected = worldBox(model);
    const bytes = await layoutToUsdz(THREE, layout);
    const loaded = new USDLoader().parse(bytes.buffer);
    const box = worldBox(loaded);
    for (const key of ['min', 'max'] as const) {
      expect(box[key].x).toBeCloseTo(expected[key].x, 5);
      expect(box[key].y).toBeCloseTo(expected[key].y, 5);
      expect(box[key].z).toBeCloseTo(expected[key].z, 5);
    }
    let meshes = 0;
    let negative = 0;
    loaded.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes += 1;
      if (node.matrixWorld.determinant() < 0) negative += 1;
    });
    expect(meshes).toBeGreaterThan(10);
    expect(negative).toBe(0);
    // The mirrored sofa where the editor puts it, the same size.
    const sofa = new THREE.Box3().setFromObject(loaded.getObjectByName('Sofa')!);
    const placed = new THREE.Box3().setFromObject(model.getObjectByName('Sofa')!);
    expect(sofa.min.distanceTo(placed.min)).toBeLessThan(1e-5);
    expect(sofa.max.distanceTo(placed.max)).toBeLessThan(1e-5);
    disposeObject(model);
    disposeObject(loaded);
  });

  it('exports the largest template within a CPU budget', async () => {
    const { result, cpuMs } = await measureCpuAsync(() => layoutToUsdz(THREE, ROOM_TEMPLATES.twoStory));
    expect(result.byteLength).toBeGreaterThan(1000);
    // A file a phone opens without a long wait.
    expect(result.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(cpuMs).toBeLessThan(3000);
  });
});

/** Each triangle's winding normal against its stored normal, in world space: +1 out, -1 in. */
function sampleNormals(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const signs: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.index;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const triangles = Math.min(8, (index ? index.count : position.count) / 3);
    for (let t = 0; t < triangles; t++) {
      const [i, j, k] = [0, 1, 2].map((o) => (index ? index.getX(t * 3 + o) : t * 3 + o)) as [number, number, number];
      a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, j).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, k).applyMatrix4(mesh.matrixWorld);
      const face = b.sub(a).cross(c.sub(a));
      if (face.lengthSq() < 1e-12) continue;
      // The determinant's sign: a mirror turns the triangles inside out.
      const flip = mesh.matrixWorld.determinant() < 0 ? -1 : 1;
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix);
      signs.push(Math.sign(face.dot(n)) * flip);
    }
  });
  return signs;
}
