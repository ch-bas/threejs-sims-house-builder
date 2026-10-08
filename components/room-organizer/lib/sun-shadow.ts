import { LOT_MARGIN, PAVEMENT_DEPTH, hasNeighbours, lowestGround, roadEdges } from './site';
import { FACING_FRONT_GARDEN, streetHalfLength } from './street-row';
import type { Frontage, NeighbourSpec, TerrainSpec } from './types';

/**
 * Where the sun's shadow camera goes (#282). The directional light used to
 * sit 10 m from the origin with a fixed ±24 m frustum starting 1 m in front
 * of it, so tall houses and sun-side neighbours stood behind its near plane
 * and cast truncated shadows or none. Instead the scene's shadow casters are
 * bounded by a box, the light is pushed out along the sun direction until
 * it clears that box, and the orthographic frustum is fitted to the box as
 * the light sees it.
 */

export type Vec3 = readonly [number, number, number];

export interface ShadowBox {
  min: Vec3;
  max: Vec3;
}

export interface ShadowSite {
  width: number;
  depth: number;
  /** Top of the highest storey (lib/storeys.ts `buildingHeight`). */
  eavesY: number;
  storeys: number;
  terrain?: TerrainSpec;
  frontage?: Frontage;
  neighbours?: NeighbourSpec;
}

/** Highest roof above its eaves: the tallest pitched roof plus a chimney (three/roof.ts, three/neighbours.ts). */
export const ROOF_ALLOWANCE = 4.5;
/** How far the perimeter trees and their crowns reach past the footprint (three/outdoor.ts). */
export const LOT_SCENERY_REACH = LOT_MARGIN + 7;
/** Top of the tallest perimeter tree above its ground. */
export const TREE_TOP = 7;
/** Tallest storey and deepest house the street generator draws (lib/street-row.ts). */
const STREET_STOREY_MAX = 3.2;
const STREET_DEPTH_MAX = 12;
const ACROSS_DEPTH_MAX = 8;
/** The immediate neighbour is at most 14 m wide, off a hair's party-wall gap. */
const PARTY_NEIGHBOUR_MAX_WIDTH = 14.1;

/** Box around everything that casts a shadow from the sun: house, roof, trees, the street. */
export function shadowCasterBounds(site: ShadowSite): ShadowBox {
  const halfW = site.width / 2;
  const halfD = site.depth / 2;
  const highestGround = site.terrain ? Math.max(0, site.terrain.frontY, site.terrain.backY) : 0;

  let halfX = halfW + LOT_SCENERY_REACH;
  // South (+z) is the garden; north (−z) runs to the road's far kerb.
  let maxZ = halfD + LOT_SCENERY_REACH;
  let minZ = -Math.max(halfD + LOT_SCENERY_REACH, roadEdges(halfD, site.frontage).far);
  let top = Math.max(site.eavesY + ROOF_ALLOWANCE, highestGround + TREE_TOP);

  if (hasNeighbours(site.neighbours)) {
    const neighbours = site.neighbours;
    halfX = Math.max(halfX, halfW + PARTY_NEIGHBOUR_MAX_WIDTH, neighbours?.street ? streetHalfLength(site.width, site.depth) : 0);
    maxZ = Math.max(maxZ, -halfD + STREET_DEPTH_MAX);
    // A street house may take one storey more than ours.
    top = Math.max(top, highestGround + (site.storeys + 1) * STREET_STOREY_MAX + ROOF_ALLOWANCE);
    if (neighbours?.across) {
      const road = roadEdges(halfD, site.frontage);
      const facingFront = road.far + PAVEMENT_DEPTH + (site.frontage === 'pavement' ? 0 : FACING_FRONT_GARDEN);
      minZ = Math.min(minZ, -(facingFront + ACROSS_DEPTH_MAX));
    }
  }

  return {
    min: [-halfX, Math.min(0, lowestGround(site.terrain)), minZ],
    max: [halfX, top, maxZ],
  };
}

export interface SunShadowFit {
  /** Light position: the box centre pushed out along the sun direction. */
  position: Vec3;
  /** Light target: the box centre. */
  target: Vec3;
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/** Clearance between the light and the nearest corner of the box. */
const SUN_STANDOFF = 5;
/** Slack around the box in the frustum, so edge texels and PCF taps stay inside. */
const FRUSTUM_PAD = 0.5;

/**
 * Place the light and fit its orthographic shadow camera so the whole box is
 * inside the frustum. The camera basis is three's `lookAt` with +Y up, so
 * the extents match what `DirectionalLightShadow` renders.
 */
export function fitSunShadow(sunDirection: Vec3, box: ShadowBox): SunShadowFit {
  const dir = normalize(sunDirection);
  const centre: Vec3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const radius = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2;
  const distance = radius + SUN_STANDOFF;
  const position: Vec3 = [centre[0] + dir[0] * distance, centre[1] + dir[1] * distance, centre[2] + dir[2] * distance];

  const [xAxis, yAxis, zAxis] = lookAtBasis(dir);
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let near = Infinity;
  let far = -Infinity;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const d: Vec3 = [x - position[0], y - position[1], z - position[2]];
        const vx = dot(d, xAxis);
        const vy = dot(d, yAxis);
        // The camera looks down its −z axis.
        const depth = -dot(d, zAxis);
        left = Math.min(left, vx);
        right = Math.max(right, vx);
        bottom = Math.min(bottom, vy);
        top = Math.max(top, vy);
        near = Math.min(near, depth);
        far = Math.max(far, depth);
      }
    }
  }

  return {
    position,
    target: centre,
    left: left - FRUSTUM_PAD,
    right: right + FRUSTUM_PAD,
    bottom: bottom - FRUSTUM_PAD,
    top: top + FRUSTUM_PAD,
    near: Math.max(0.1, near - FRUSTUM_PAD),
    far: far + FRUSTUM_PAD,
  };
}

/** Rotation basis three's `Matrix4.lookAt(eye, target, +Y)` builds for a camera looking along −dir. */
export function lookAtBasis(dir: Vec3): [Vec3, Vec3, Vec3] {
  let z = normalize(dir);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(...x) === 0) {
    // Straight overhead: three nudges z the same way.
    z = normalize([z[0], z[1], z[2] + 0.0001]);
    x = cross([0, 1, 0], z);
  }
  x = normalize(x);
  return [x, cross(z, x), z];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0 ? [0, 1, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
