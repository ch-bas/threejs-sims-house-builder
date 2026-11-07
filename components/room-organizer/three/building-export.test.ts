import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { disposeObject } from './builder-utils';
import { buildExportBuilding } from './building-export';
import type { RoomLayout } from '../lib/types';

function twoStoreys(): RoomLayout {
  return makeLayout({
    name: 'Villa',
    width: 8,
    height: 6,
    floors: [
      makeFloor({
        name: 'Ground Floor',
        items: [
          makeItem({ id: 'sofa', type: 'sofa', name: 'Sofa', position: { x: -1, z: 0 }, rotation: Math.PI / 2, mirrored: true }),
          makeItem({ id: 'door', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: -3 } }),
          makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', category: 'outdoor', position: { x: 7, z: 0 } }),
        ],
        interiorWalls: [{ id: 'iw1', x1: 1, z1: -3, x2: 1, z2: 0 }],
      }),
      makeFloor({
        id: 'f1',
        name: 'Upstairs',
        items: [makeItem({ id: 'bed', type: 'bed', name: 'Bed', position: { x: 2, z: 1 } })],
      }),
    ],
    roof: { style: 'gable', color: '#7a4b3a', dormers: [{ id: 'd1', side: 'south', width: 1.6 }] },
  });
}

const storeys = (root: THREE.Object3D) => root.children.filter((child) => child.userData.type === 'storey');

describe('zone floors in the export (#720)', () => {
  const zone = { id: 'k', name: 'Kitchen', color: '#000', x: -4, z: -3, w: 3, d: 3, floorColor: '#ff0000' };
  const patches = (root: THREE.Object3D) => {
    const found: THREE.Mesh[] = [];
    root.traverse((node) => {
      if (node.name === 'Floor k') found.push(node as THREE.Mesh);
    });
    return found;
  };

  it('lays the zone floor over the slab with a gap, inside its rectangle', () => {
    const layout = twoStoreys();
    const root = buildExportBuilding(THREE, { ...layout, floors: [{ ...layout.floors[0]!, zones: [zone] }, layout.floors[1]!] });
    const [patch] = patches(root);
    expect(patch).toBeDefined();
    expect(patch!.position.y).toBeGreaterThan(0);
    expect((patch!.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    patch!.geometry.computeBoundingBox();
    const box = patch!.geometry.boundingBox!;
    expect([box.min.x, box.max.x, box.min.y + 0, box.max.y]).toEqual([-4, -1, 0, 3]);
    disposeObject(root);
  });

  it('fifteen finished rooms side by side lie at one height, under a rug', () => {
    const layout = twoStoreys();
    const zones = Array.from({ length: 15 }, (_, index) => ({ ...zone, id: `z${index}`, x: -4 + index * 0.5, w: 0.5 }));
    const root = buildExportBuilding(THREE, { ...layout, floors: [{ ...layout.floors[0]!, zones }, layout.floors[1]!] });
    const heights = new Set<number>();
    root.traverse((node) => {
      if (node.name.startsWith('Floor z')) heights.add(node.position.y);
    });
    expect(heights.size).toBe(1);
    disposeObject(root);
  });

  it('a tall stack of overlapping floors stays under the rug too', () => {
    const layout = twoStoreys();
    const zones = Array.from({ length: 32 }, (_, index) => ({ ...zone, id: `z${index}` }));
    const root = buildExportBuilding(THREE, { ...layout, floors: [{ ...layout.floors[0]!, zones }, layout.floors[1]!] });
    let top = 0;
    root.traverse((node) => {
      if (node.name.startsWith('Floor z')) top = Math.max(top, node.position.y);
    });
    expect(top).toBeLessThan(0.01);
    disposeObject(root);
  });

  it('adds no mesh for a zone without a finish', () => {
    const layout = twoStoreys();
    const { floorColor: _none, ...plain } = zone;
    const root = buildExportBuilding(THREE, { ...layout, floors: [{ ...layout.floors[0]!, zones: [plain] }, layout.floors[1]!] });
    expect(patches(root)).toEqual([]);
    disposeObject(root);
  });
});

describe('buildExportBuilding (#373)', () => {
  it('builds every storey and the roof, named, whatever the view', () => {
    const root = buildExportBuilding(THREE, twoStoreys());
    expect(root.name).toBe('Villa');
    expect(storeys(root).map((storey) => storey.name)).toEqual(['Ground Floor', 'Upstairs']);
    expect(root.children.map((child) => child.name)).toContain('Roof');

    const roof = root.children.find((child) => child.name === 'Roof')!;
    const dormers: string[] = [];
    roof.traverse((node) => {
      if (node.userData.dormerId) dormers.push(node.name);
    });
    expect(dormers).toEqual(['Dormer d1']);
    disposeObject(root);
  });

  it('places every item of every floor at its storey, outdoor items included', () => {
    const layout = twoStoreys();
    const root = buildExportBuilding(THREE, layout);
    const furniture: THREE.Object3D[] = [];
    root.traverse((node) => {
      if (node.userData.type === 'furniture') furniture.push(node);
    });
    expect(furniture.map((group) => [group.name, group.userData.floorIndex])).toEqual([
      ['Sofa', 0],
      ['Door', 0],
      ['Oak Tree', 0],
      ['Bed', 1],
    ]);
    const sofa = furniture[0]!;
    expect(sofa.position.toArray()).toEqual([-1, 0, 0]);
    expect(sofa.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(sofa.scale.x).toBe(-1);
    // The upper storey's items stand on its floor.
    expect(furniture[3]!.position.y).toBeGreaterThan(2);
    disposeObject(root);
  });

  it('stands a garden item on a sloped site on the ground, as the scene does (#665)', () => {
    const layout = { ...twoStoreys(), terrain: { frontY: -3, backY: 1 } };
    const root = buildExportBuilding(THREE, layout);
    const tree = root.getObjectByName('Oak Tree')!;
    // Beside the house, half way down its depth: the middle of the slope.
    expect(tree.position.y).toBeCloseTo(-1);
    // Indoors the floor stays the datum.
    expect(root.getObjectByName('Sofa')!.position.y).toBe(0);
    disposeObject(root);
  });

  it('keeps every wall, solid and visible, and leaves out the snap grid', () => {
    const root = buildExportBuilding(THREE, twoStoreys());
    for (const storey of storeys(root)) {
      const walls = storey.children.filter((child) => child.name.startsWith('Wall '));
      expect(walls.map((wall) => wall.name).sort()).toEqual(['Wall east', 'Wall north', 'Wall south', 'Wall west']);
      for (const wall of walls) {
        const material = (wall as THREE.Mesh).material as THREE.MeshStandardMaterial;
        expect(wall.visible).toBe(true);
        expect(material.opacity).toBe(1);
      }
    }
    expect(storeys(root)[0]!.children.some((child) => child.name === 'Interior wall iw1')).toBe(true);
    let grids = 0;
    root.traverse((node) => {
      if (node.type === 'GridHelper') grids += 1;
    });
    expect(grids).toBe(0);
    disposeObject(root);
  });

  it('builds no roof when the house has none', () => {
    const root = buildExportBuilding(THREE, { ...twoStoreys(), roof: { style: 'none' } });
    expect(root.children.map((child) => child.name)).toEqual(['Ground Floor', 'Upstairs']);
    disposeObject(root);
  });

  it('owns everything it builds: disposing it frees the geometries', () => {
    const root = buildExportBuilding(THREE, twoStoreys());
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) geometries.add(mesh.geometry);
    });
    const disposed = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    disposeObject(root);
    expect(disposed.length).toBeGreaterThan(10);
    for (const spy of disposed) expect(spy).toHaveBeenCalled();
  });
});
