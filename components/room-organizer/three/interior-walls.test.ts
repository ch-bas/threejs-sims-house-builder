import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { clearPreview, renderInteriorWallPreview, renderInteriorWalls } from './interior-walls';

/** The partition itself — the tallest mesh tagged with the wall id (baseboards share the tag). */
function wallMesh(scene: THREE.Scene): THREE.Mesh {
  const meshes = scene.children.filter(
    (obj): obj is THREE.Mesh => obj instanceof THREE.Mesh && obj.userData.wallId === 'iw'
  );
  const span = (mesh: THREE.Mesh) => heightOf(mesh).max - heightOf(mesh).min;
  return meshes.reduce((a, b) => (span(b) > span(a) ? b : a));
}

function heightOf(mesh: THREE.Mesh): { min: number; max: number } {
  mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  return { min: box.min.y, max: box.max.y };
}

const WALL = { id: 'iw', x1: -2, z1: 0, x2: 2, z2: 0 };

describe('wall sides (#720)', () => {
  const faces = (mesh: THREE.Mesh, normalZ: number): string[] => {
    const normal = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.getIndex();
    const out = new Set<string>();
    for (const group of mesh.geometry.groups) {
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = index ? index.getX(i) : i;
        if (Math.abs(normal.getZ(vertex) - normalZ) < 1e-6) {
          out.add(((mesh.material as THREE.Material[])[group.materialIndex!] as THREE.MeshStandardMaterial).color.getHexString());
        }
      }
    }
    return [...out];
  };
  const wall = { id: 'iw', x1: -2, z1: 0, x2: 2, z2: 0, color: '#111111', colorB: '#222222' };
  const build = (items: Parameters<typeof renderInteriorWalls>[5] = {}) => {
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [wall], 0, undefined, items);
    return scene.children.find((obj): obj is THREE.Mesh => obj instanceof THREE.Mesh && obj.name === 'Interior wall iw')!;
  };

  it('paints each face of a plain wall its own colour', () => {
    const mesh = build();
    expect(faces(mesh, 1)).toEqual(['111111']);
    expect(faces(mesh, -1)).toEqual(['222222']);
  });

  it('paints each face of a wall with a door hole too', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 0 } });
    const mesh = build({ openingCandidates: [door], roomWidth: 10, roomDepth: 10 });
    expect(mesh.geometry.type).toBe('ExtrudeGeometry');
    expect(faces(mesh, 1)).toEqual(['111111']);
    expect(faces(mesh, -1)).toEqual(['222222']);
  });

  it('a wall with one colour keeps one material', () => {
    const scene = new THREE.Scene();
    const { colorB: _none, ...plain } = wall;
    renderInteriorWalls(THREE, scene, [plain], 0);
    const mesh = scene.children.find((obj): obj is THREE.Mesh => obj instanceof THREE.Mesh && obj.name === 'Interior wall iw')!;
    expect(Array.isArray(mesh.material)).toBe(false);
  });
});

describe('renderInteriorWalls storey heights (#202)', () => {
  it('keeps the classic 2.6 m partition when no height is given', () => {
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 3);
    const wall = wallMesh(scene);
    expect(heightOf(wall).min).toBeCloseTo(3);
    expect(heightOf(wall).max).toBeCloseTo(5.6);
  });

  it('builds partitions to the storey height at its elevation', () => {
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 2.5, undefined, { wallHeight: 2.1 });
    const wall = wallMesh(scene);
    expect(heightOf(wall).min).toBeCloseTo(2.5);
    expect(heightOf(wall).max).toBeCloseTo(4.6);
  });

  it('cuts a doorway no taller than a short partition, and skips a window above it', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.1, height: 2.1, position: { x: 0, z: 0 } });
    const window = makeItem({ id: 'w', type: 'window', width: 1, depth: 0.1, height: 1.2, position: { x: 1.2, z: 0 } });
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 0, undefined, { openingCandidates: [door, window], wallHeight: 0.7 });
    const wall = wallMesh(scene);
    // Extruded with one hole (the door), still exactly the partition height.
    expect(wall.geometry.type).toBe('ExtrudeGeometry');
    expect(heightOf(wall).max).toBeCloseTo(0.7);

    // The window's sill (0.9 m) is above the 0.7 m partition: nothing to cut.
    const windowOnly = new THREE.Scene();
    renderInteriorWalls(THREE, windowOnly, [WALL], 0, undefined, { openingCandidates: [window], wallHeight: 0.7 });
    expect(wallMesh(windowOnly).geometry.type).toBe('BoxGeometry');
  });

  it('cuts a window dropped to the floor of a 1.1 m loft, where its mesh now sits (#277)', () => {
    const window = makeItem({ id: 'w', type: 'window', width: 1, depth: 0.1, height: 1.2, position: { x: 0, z: 0 } });
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 0, undefined, {
      openingCandidates: [window],
      wallHeight: 0.7,
      storeyHeight: 1.1,
    });
    const wall = wallMesh(scene);
    expect(wall.geometry.type).toBe('ExtrudeGeometry');
    expect(heightOf(wall).max).toBeCloseTo(0.7);
  });
});

describe('renderInteriorWalls per-wall heights (#275)', () => {
  it('builds one wall taller than the partition height when told to', () => {
    const back = { id: 'entrance-back', x1: -0.7, z1: -3.3, x2: 0.7, z2: -3.3 };
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL, back], 0, undefined, {
      wallHeight: 2.1,
      wallHeights: new Map([['entrance-back', 2.4]]),
    });
    const partition = wallMesh(scene);
    expect(heightOf(partition).max).toBeCloseTo(2.1);
    const backTop = Math.max(
      ...scene.children
        .filter((obj): obj is THREE.Mesh => obj instanceof THREE.Mesh && obj.userData.wallId === 'entrance-back')
        .map((mesh) => heightOf(mesh).max)
    );
    expect(backTop).toBeCloseTo(2.4);
  });
});

describe('renderInteriorWallPreview (#409)', () => {
  const previews = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === 'interior-wall-preview') as THREE.Mesh[];

  it('re-poses one mesh per draft instead of building one per pointer move', () => {
    const scene = new THREE.Scene();
    renderInteriorWallPreview(THREE, scene, { x: 0, z: 0 }, { x: 2, z: 0 }, 0, 2.6);
    const [mesh] = previews(scene);
    const { geometry, material } = mesh!;
    renderInteriorWallPreview(THREE, scene, { x: 0, z: 0 }, { x: 0, z: 3 }, 3, 2.6);
    expect(previews(scene)).toEqual([mesh]);
    expect(mesh!.geometry).toBe(geometry);
    expect(mesh!.material).toBe(material);
    const box = new THREE.Box3().setFromObject(mesh!);
    expect(box.max.z - box.min.z).toBeCloseTo(3);
    expect(box.min.y).toBeCloseTo(3);
    expect(box.max.y).toBeCloseTo(5.6);
  });

  it('hides a too-short draft and disposes the mesh on clear', () => {
    const scene = new THREE.Scene();
    renderInteriorWallPreview(THREE, scene, { x: 0, z: 0 }, { x: 2, z: 0 });
    const [mesh] = previews(scene);
    renderInteriorWallPreview(THREE, scene, { x: 0, z: 0 }, { x: 0.01, z: 0 });
    expect(mesh!.visible).toBe(false);
    let disposed = false;
    mesh!.geometry.addEventListener('dispose', () => { disposed = true; });
    clearPreview(scene);
    expect(previews(scene)).toEqual([]);
    expect(disposed).toBe(true);
  });
});
