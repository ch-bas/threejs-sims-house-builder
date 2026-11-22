import { GRASS_DROP, groundHeightAt } from '../lib/site';
import { layGroundSurface, type GroundSurface } from './ground-surfaces';
import type { GroundRect } from '../lib/grounds';
import type { GroundKind, TerrainSpec, Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Garden surfaces in 3D (#924): each kind is one mesh of low slabs on the
 * ground line, every patch of that kind merged into it. A slab's top lies
 * just under the ground line (y = 0 on a flat site), where garden items
 * stand, so a chair on the deck stands on its boards and nothing z-fights the
 * item's base; its sides drop to under the grass, which is `GRASS_DROP` down.
 * On a sloped site the slab follows the slope, rows on its two kinks, as the
 * lawn does (three/terrain.ts).
 */

/** Marks the patch meshes among the lot's scenery. */
export const GROUND_PATCH_ROLE = 'ground-patch';

/** Each kind's top, metres relative to the ground line: all clear of the grass and of each other's edges. */
const TOP: Record<GroundKind, number> = {
  paving: -0.006,
  gravel: -0.016,
  deck: -0.004,
  lawn: -0.034,
};
/** The sides reach this far under the grass, so no gap shows at a slab's foot. */
const FOOT = -GRASS_DROP - 0.01;

const SURFACE: Record<GroundKind, GroundSurface> = { paving: 'paving', gravel: 'gravel', deck: 'deck', lawn: 'grass' };
const TOP_COLOR: Record<GroundKind, number> = { paving: 0xd9cfbe, gravel: 0xd6cdb9, deck: 0xa8764a, lawn: 0x76ab4a };
const SIDE_COLOR: Record<GroundKind, number> = { paving: 0xa49a88, gravel: 0x9c917b, deck: 0x6e4a2c, lawn: 0x4f7a33 };
const SNOW = 0xe4e9ee;

/** A surface's top under the weather: wet reads darker, snow lies over everything but a deck's edge. */
export function groundPatchColor(kind: GroundKind, weather: Weather, part: 'top' | 'side' = 'top'): number {
  const base = part === 'top' ? TOP_COLOR[kind] : SIDE_COLOR[kind];
  if (weather === 'clear') return base;
  const mix = (a: number, b: number, t: number): number => {
    const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  };
  return weather === 'rain' ? mix(base, 0x000000, 0.14) : mix(base, SNOW, part === 'top' ? 0.85 : 0.4);
}

export interface GroundPatchOptions {
  terrain?: TerrainSpec | undefined;
  /** Half the house's depth: where the slope's kinks lie. */
  halfDepth: number;
  weather?: Weather;
  /** Lay the generated tiles (the view); the GLB takes plain colours, its UVs couldn't follow the world. */
  textured?: boolean;
  /** Pixels across a ground tile, by quality tier (#760). */
  groundTile?: number;
}

/** z values a slab's rows must stop at: its edges and any kink of the slope between them. */
function rowStops(z0: number, z1: number, halfDepth: number, sloped: boolean): number[] {
  const stops = [z0];
  if (sloped) for (const kink of [-halfDepth, halfDepth]) if (kink > z0 && kink < z1) stops.push(kink);
  stops.push(z1);
  return stops;
}

/** One kind's slabs as one geometry: group 0 the tops, group 1 the sides. */
export function buildGroundPatchGeometry(
  THREE: ThreeModule,
  rects: readonly GroundRect[],
  kind: GroundKind,
  terrain: TerrainSpec | undefined,
  halfDepth: number
): ThreeNS.BufferGeometry {
  const ground = (z: number) => groundHeightAt(terrain, z, halfDepth);
  const top = TOP[kind];
  const tops: number[] = [];
  const sides: number[] = [];
  const quad = (out: number[], a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const rect of rects) {
    const x0 = rect.x;
    const x1 = rect.x + rect.w;
    const stops = rowStops(rect.z, rect.z + rect.d, halfDepth, terrain !== undefined);
    for (let i = 0; i + 1 < stops.length; i++) {
      const za = stops[i]!;
      const zb = stops[i + 1]!;
      const ya = ground(za) + top;
      const yb = ground(zb) + top;
      // Facing up: wound counter-clockwise seen from above.
      quad(tops, [x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za]);
      // West and east sides, facing out.
      quad(sides, [x0, ground(za) + FOOT, za], [x0, ground(zb) + FOOT, zb], [x0, yb, zb], [x0, ya, za]);
      quad(sides, [x1, ground(zb) + FOOT, zb], [x1, ground(za) + FOOT, za], [x1, ya, za], [x1, yb, zb]);
    }
    const zN = rect.z;
    const zS = rect.z + rect.d;
    // North (−z) and south sides.
    quad(sides, [x1, ground(zN) + FOOT, zN], [x0, ground(zN) + FOOT, zN], [x0, ground(zN) + top, zN], [x1, ground(zN) + top, zN]);
    quad(sides, [x0, ground(zS) + FOOT, zS], [x1, ground(zS) + FOOT, zS], [x1, ground(zS) + top, zS], [x0, ground(zS) + top, zS]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...tops, ...sides], 3));
  geometry.addGroup(0, tops.length / 3, 0);
  geometry.addGroup(tops.length / 3, sides.length / 3, 1);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The surfaces, one mesh per kind present, in a group the caller tags and
 * frees (`disposeObject`: the tiles are shared and skipped). Nothing casts a
 * shadow; everything takes one. They don't take a pointer either: a press goes
 * through to the ground under them, as it did before.
 */
export function buildGroundPatches(
  THREE: ThreeModule,
  grounds: ReadonlyArray<GroundRect & { kind: GroundKind }>,
  options: GroundPatchOptions
): ThreeNS.Group {
  const group = new THREE.Group();
  group.name = 'Garden surfaces';
  const weather = options.weather ?? 'clear';
  const kinds = [...new Set(grounds.map((ground) => ground.kind))];
  for (const kind of kinds) {
    const rects = grounds.filter((ground) => ground.kind === kind);
    const topMaterial = new THREE.MeshStandardMaterial({ color: groundPatchColor(kind, weather), roughness: kind === 'deck' ? 0.75 : 0.95 });
    if (options.textured !== false) {
      layGroundSurface(THREE, topMaterial, SURFACE[kind], { ...(options.groundTile !== undefined ? { pixels: options.groundTile } : {}), macro: false });
    }
    const sideMaterial = new THREE.MeshStandardMaterial({ color: groundPatchColor(kind, weather, 'side'), roughness: 0.95 });
    const mesh = new THREE.Mesh(buildGroundPatchGeometry(THREE, rects, kind, options.terrain, options.halfDepth), [topMaterial, sideMaterial]);
    mesh.name = kind;
    mesh.receiveShadow = true;
    mesh.userData.role = GROUND_PATCH_ROLE;
    mesh.userData.kind = kind;
    mesh.raycast = () => undefined;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.updateMatrix();
  group.matrixAutoUpdate = false;
  return group;
}

/** Re-tint the patches under `root` for the weather. */
export function tintGroundPatches(root: ThreeNS.Object3D, weather: Weather): void {
  root.traverse((node) => {
    if (node.userData.role !== GROUND_PATCH_ROLE) return;
    const kind = node.userData.kind as GroundKind;
    const [top, side] = (node as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial[];
    top?.color.setHex(groundPatchColor(kind, weather));
    side?.color.setHex(groundPatchColor(kind, weather, 'side'));
  });
}
