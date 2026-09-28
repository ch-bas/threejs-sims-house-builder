import { groundHeightAt } from '../lib/site';
import type { TerrainSpec } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const EARTH_COLOR = 0x7a5b3e;
/** Keeps the excavation faces just proud of the wall planes (no z-fighting). */
const EARTH_WALL_GAP = 0.01;

/**
 * The ground of a sloped site (#202): flat at `frontY` north of the house,
 * flat at `backY` south of it, and sloping along the house's depth either
 * side. The house footprint itself is left open — the lot is excavated
 * there, so a basement cut into the hill shows its floor, not grass.
 *
 * Built from quads whose rows sit exactly on the slope's two kinks
 * (z = ±halfDepth), so the piecewise-linear ground is exact.
 */
export function buildTerrainGeometry(
  THREE: ThreeModule,
  terrain: TerrainSpec,
  groundSize: number,
  halfWidth: number,
  halfDepth: number,
  yOffset: number
): ThreeNS.BufferGeometry {
  const g = groundSize / 2;
  const positions: number[] = [];
  const y = (z: number) => groundHeightAt(terrain, z, halfDepth) + yOffset;
  // One up-facing quad over [x0, x1] × [z0, z1].
  const quad = (x0: number, x1: number, z0: number, z1: number) => {
    const a = [x0, y(z0), z0];
    const b = [x0, y(z1), z1];
    const c = [x1, y(z1), z1];
    const d = [x1, y(z0), z0];
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  quad(-g, g, -g, -halfDepth); // street side
  quad(-g, g, halfDepth, g); // garden side
  quad(-g, -halfWidth, -halfDepth, halfDepth); // west slope
  quad(halfWidth, g, -halfDepth, halfDepth); // east slope

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Earth faces where the ground stands above the ground floor against the
 * house — the sides of the excavation. Just outside each wall, from y = 0 up
 * to the ground line, so they cover the buried part of the facade and still
 * read as a cut through the hill when the wall itself is cut away. Returns
 * null when nothing is buried.
 */
export function buildExcavationGeometry(
  THREE: ThreeModule,
  terrain: TerrainSpec,
  halfWidth: number,
  halfDepth: number
): ThreeNS.BufferGeometry | null {
  const positions: number[] = [];
  const x = halfWidth + EARTH_WALL_GAP;
  const z = halfDepth + EARTH_WALL_GAP;
  // Vertical face under the ground line from (x0, z0) at height top0 to
  // (x1, z1) at top1, down to y = 0. Where the line crosses y = 0 the face
  // stops there, so it never pokes above a slope that dips below the floor.
  const face = (x0: number, z0: number, top0: number, x1: number, z1: number, top1: number) => {
    if (top0 <= 0 && top1 <= 0) return;
    if (top0 < 0 || top1 < 0) {
      const t = top0 / (top0 - top1);
      const xc = x0 + (x1 - x0) * t;
      const zc = z0 + (z1 - z0) * t;
      if (top0 > 0) positions.push(x0, 0, z0, xc, 0, zc, x0, top0, z0);
      else positions.push(xc, 0, zc, x1, 0, z1, x1, top1, z1);
      return;
    }
    positions.push(x0, 0, z0, x1, 0, z1, x1, top1, z1, x0, 0, z0, x1, top1, z1, x0, top0, z0);
  };
  const { frontY, backY } = terrain;
  face(-x, -z, frontY, x, -z, frontY); // north wall
  face(x, z, backY, -x, z, backY); // south wall
  face(x, -z, frontY, x, z, backY); // east wall
  face(-x, z, backY, -x, -z, frontY); // west wall
  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function earthMaterial(THREE: ThreeModule): ThreeNS.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: EARTH_COLOR, roughness: 1, side: THREE.DoubleSide });
}
