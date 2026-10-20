import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyOutdoorWeather, mergeStaticGeometries, outdoorGroundColor, setOutdoorVisible } from './outdoor';

const WIDTH = 8;
const DEPTH = 8;
const outdoor = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === 'outdoor');

/** The road: the flat mesh furthest out on the street (north, −z) side. */
function road(scene: THREE.Scene): THREE.Object3D {
  return outdoor(scene)
    .filter((obj) => obj instanceof THREE.Mesh && obj.geometry instanceof THREE.PlaneGeometry)
    .reduce((a, b) => (b.position.z < a.position.z ? b : a));
}

type TreeBase = { x: number; y: number; z: number };
const forest = (scene: THREE.Scene) => outdoor(scene).find((obj) => obj.userData.role === 'trees');
const trees = (scene: THREE.Scene): TreeBase[] => (forest(scene)?.userData.treeBases as TreeBase[] | undefined) ?? [];

describe('outdoor scene on a sloped site (#202)', () => {
  it('keeps the road at y≈0 without a terrain', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    expect(road(scene).position.y).toBeCloseTo(-0.025);
  });

  it('lifts the road to street level and plants trees on the ground line', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { terrain: { frontY: 2.5, backY: 0 } });
    expect(road(scene).position.y).toBeCloseTo(2.5 - 0.025);
    for (const tree of trees(scene)) {
      const { y, z } = tree;
      const expected = z <= -DEPTH / 2 ? 2.5 : z >= DEPTH / 2 ? 0 : 2.5 * (1 - (z + DEPTH / 2) / DEPTH);
      expect(y).toBeCloseTo(expected);
    }
  });

  it('adds the excavation faces only when the house cuts into the ground', () => {
    const flat = new THREE.Scene();
    setOutdoorVisible(THREE, flat, true, WIDTH, DEPTH);
    const hill = new THREE.Scene();
    setOutdoorVisible(THREE, hill, true, WIDTH, DEPTH, { terrain: { frontY: 2.5, backY: 0 } });
    expect(outdoor(hill).length).toBe(outdoor(flat).length + 1);
  });

  it('runs the pavement up to the front wall with no front garden (#204)', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { frontage: 'pavement' });
    const planes = outdoor(scene).filter((obj) => obj instanceof THREE.Mesh && obj.geometry instanceof THREE.PlaneGeometry);
    const nearest = planes.filter((p) => p.position.z < 0).reduce((a, b) => (b.position.z > a.position.z ? b : a));
    expect(nearest.position.z).toBeCloseTo(-(DEPTH / 2 + 0.8)); // pavement, 1.6 m deep, from the wall
    expect(road(scene).position.z).toBeCloseTo(-(DEPTH / 2 + 1.6 + 2.25));
    // No stepping stones or front planting.
    const stones = outdoor(scene).filter(
      (obj) => obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.CylinderGeometry && obj.count > 0 &&
        (obj.geometry as THREE.CylinderGeometry).parameters.radiusTop === 0.32
    );
    expect(stones).toHaveLength(0);
    expect(trees(scene).some((tree) => tree.z < -DEPTH / 2)).toBe(false);
  });

  it('plants no trees on a side with a neighbour', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { neighbours: { east: true } });
    const all = trees(scene);
    expect(all.length).toBeGreaterThan(0);
    // East-side trees stand beside the lot (not the back row, which runs past it).
    const beside = (tree: TreeBase) => tree.z < DEPTH / 2 + 6;
    expect(all.some((tree) => beside(tree) && tree.x > WIDTH / 2 + 6)).toBe(false);
    expect(all.some((tree) => beside(tree) && tree.x < -(WIDTH / 2 + 6))).toBe(true);
  });
});

describe('weather ground tint (#189)', () => {
  const grass = (scene: THREE.Scene) =>
    outdoor(scene).find((obj) => obj.userData.role === 'ground') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const roadColor = (scene: THREE.Scene) => ((road(scene) as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex();
  const luma = (hex: number) => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff);

  it('the lot is built with the untouched grass colour by default', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    expect(grass(scene).material.color.getHex()).toBe(0x7cb04a);
    expect(outdoorGroundColor('clear')).toBe(0x7cb04a);
  });

  it('snow lightens the grass, rain darkens it, clear restores it', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    applyOutdoorWeather(scene, 'snow');
    expect(grass(scene).material.color.getHex()).toBe(outdoorGroundColor('snow'));
    expect(luma(outdoorGroundColor('snow'))).toBeGreaterThan(luma(outdoorGroundColor('clear')));
    applyOutdoorWeather(scene, 'rain');
    expect(luma(grass(scene).material.color.getHex())).toBeLessThan(luma(outdoorGroundColor('clear')));
    applyOutdoorWeather(scene, 'clear');
    expect(grass(scene).material.color.getHex()).toBe(0x7cb04a);
  });

  it('a lot rebuilt after the weather was set comes back tinted (the lighting effect does not re-run)', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    applyOutdoorWeather(scene, 'snow');
    setOutdoorVisible(THREE, scene, true, WIDTH + 2, DEPTH, { terrain: { frontY: 1, backY: 0 } });
    expect(grass(scene).material.color.getHex()).toBe(outdoorGroundColor('snow'));
  });

  it('tints the grass only, never the road', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    const before = roadColor(scene);
    applyOutdoorWeather(scene, 'snow');
    expect(roadColor(scene)).toBe(before);
  });
});

describe('merged perimeter trees (#407)', () => {
  const treeMeshes = (scene: THREE.Scene) => (forest(scene)?.children ?? []) as THREE.Mesh[];

  it('draws the 14 trees as one mesh per kind, part and shade', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    expect(trees(scene)).toHaveLength(14);
    const meshes = treeMeshes(scene);
    // birch + oak: trunk, flare, branches, two leaf shades; pine: trunk, two needle shades.
    expect(meshes).toHaveLength(13);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(13);
    // Trunks, branches, leaves and needles cast; the root flare only receives.
    expect(meshes.filter((m) => m.castShadow)).toHaveLength(11);
    expect(outdoor(scene).filter((obj) => obj instanceof THREE.Group)).toHaveLength(1);
  });

  it('keeps the seeded look: the same lot bakes the same vertices', () => {
    const build = () => {
      const scene = new THREE.Scene();
      setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
      return treeMeshes(scene).map((m) => Array.from((m.geometry.getAttribute('position') as THREE.BufferAttribute).array));
    };
    expect(build()).toEqual(build());
  });

  it('bakes every tree in place: each base has a trunk standing on it', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { terrain: { frontY: 2.5, backY: 0 } });
    const box = new THREE.Box3();
    for (const mesh of treeMeshes(scene)) box.expandByObject(mesh);
    for (const tree of trees(scene)) {
      expect(box.containsPoint(new THREE.Vector3(tree.x, tree.y + 0.5, tree.z))).toBe(true);
    }
    expect(box.min.y).toBeGreaterThan(-0.1);
  });

  it('frees the merged meshes when the lot is rebuilt', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    let disposed = 0;
    for (const mesh of treeMeshes(scene)) {
      mesh.geometry.addEventListener('dispose', () => { disposed += 1; });
      (mesh.material as THREE.Material).addEventListener('dispose', () => { disposed += 1; });
    }
    setOutdoorVisible(THREE, scene, false, WIDTH, DEPTH);
    expect(disposed).toBe(26);
    expect(forest(scene)).toBeUndefined();
  });
});

describe('mergeStaticGeometries', () => {
  it('concatenates indexed geometries and offsets their indices', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1).translate(5, 0, 0);
    const merged = mergeStaticGeometries(THREE, [a, b]);
    expect(merged.getAttribute('position').count).toBe(48);
    expect(merged.index?.count).toBe(72);
    expect(merged.index?.getX(36)).toBe(24);
    merged.computeBoundingBox();
    expect(merged.boundingBox?.max.x).toBeCloseTo(5.5);
    expect(merged.hasAttribute('normal')).toBe(true);
    expect(merged.hasAttribute('uv')).toBe(true);
  });

  it('merges non-indexed geometries without an index', () => {
    const merged = mergeStaticGeometries(THREE, [new THREE.IcosahedronGeometry(1, 1), new THREE.IcosahedronGeometry(1, 1)]);
    expect(merged.index).toBeNull();
    expect(merged.getAttribute('position').count).toBe(2 * 240);
  });

  it('normalises a mix of indexed and non-indexed inputs', () => {
    const merged = mergeStaticGeometries(THREE, [new THREE.BoxGeometry(), new THREE.IcosahedronGeometry(1, 0)]);
    expect(merged.index).toBeNull();
    expect(merged.getAttribute('position').count).toBe(36 + 60);
  });
});
