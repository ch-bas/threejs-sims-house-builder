import { STAIRWELL_RAIL_HEIGHT, type RailSegment } from '../lib/stairwell-rail';
import { mergeParts, removeAndDispose } from './builder-utils';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * The guard rail round a storey's stairwells (#923), from the segments of
 * `lib/stairwell-rail.ts`: posts, a handrail, a bottom rail and balusters,
 * merged into one mesh per storey. Tagged `STAIRWELL_RAIL_TAG`, so it hides
 * with the partitions (walls down, storeys the walkthrough hides).
 */

/** userData.type of a storey's rail mesh. */
export const STAIRWELL_RAIL_TAG = 'stairwell-rail';

// Both narrower than twice the inset, so the rail stands clear of the slab edge (no coplanar faces).
const POST = 0.045;
const HANDRAIL_WIDTH = 0.045;
const HANDRAIL_DEPTH = 0.04;
const BOTTOM_RAIL = 0.04;
const BOTTOM_RAIL_Y = 0.1;
const BALUSTER = 0.02;
/** The widest clear gap (m) between balusters and posts: under the 10 cm a child can't pass. */
export const BALUSTER_MAX_GAP = 0.09;
/** Posts stand at least this often along a run. */
const POST_SPACING = 1.5;
/** The posts run down the edge of the upper storey's 4 cm slab. */
const SLAB_DEPTH = 0.04;
const RAIL_COLOR = 0x424242;

/** Take every storey's rail out of the scene, freeing its geometry and material. */
export function clearStairwellRails(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === STAIRWELL_RAIL_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

/**
 * Where the balusters stand in a bay `bay` long between two post centres,
 * from the first post's centre: as few as leave no clear gap (post face to
 * baluster, baluster to baluster) wider than `BALUSTER_MAX_GAP`, evenly.
 */
export function balusterOffsets(bay: number): number[] {
  const clear = bay - POST;
  if (clear <= BALUSTER_MAX_GAP) return [];
  const count = Math.ceil((clear - BALUSTER_MAX_GAP) / (BALUSTER_MAX_GAP + BALUSTER));
  const gap = (clear - count * BALUSTER) / (count + 1);
  return Array.from({ length: count }, (_unused, j) => POST / 2 + gap * (j + 1) + BALUSTER * (j + 0.5));
}

/** The clear gaps a bay's balusters leave (m), post face to post face: for the tests. */
export function balusterGaps(bay: number): number[] {
  const edges = [POST / 2, ...balusterOffsets(bay).flatMap((at) => [at - BALUSTER / 2, at + BALUSTER / 2]), bay - POST / 2];
  const gaps: number[] = [];
  for (let i = 0; i + 1 < edges.length; i += 2) gaps.push(edges[i + 1]! - edges[i]!);
  return gaps;
}

/**
 * One mesh for the rail of a storey at `floorY`, or null when it has none.
 * `ghostOpacity` fades it with the rest of a ghosted storey.
 */
export function buildStairwellRail(
  THREE: ThreeModule,
  segments: readonly RailSegment[],
  floorY: number,
  ghostOpacity?: number
): ThreeNS.Mesh | null {
  if (segments.length === 0) return null;
  const parts: ThreeNS.BufferGeometry[] = [];
  const height = STAIRWELL_RAIL_HEIGHT;
  // A box `w` along the run, `h` tall and `d` across, centred at (along, y) on the run.
  const box = (segment: RailSegment, w: number, h: number, d: number, along: number, y: number): void => {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    const ux = (segment.x2 - segment.x1) / length;
    const uz = (segment.z2 - segment.z1) / length;
    const geometry = new THREE.BoxGeometry(w, h, d);
    // rotateY turns local +x toward −z: a run along (ux, uz) is turned by −atan2(uz, ux).
    geometry.rotateY(-Math.atan2(uz, ux));
    geometry.translate(segment.x1 + ux * along, floorY + y, segment.z1 + uz * along);
    parts.push(geometry);
  };

  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length < 1e-6) continue;
    // Posts at both ends and evenly between, from the slab's underside to the top.
    const bays = Math.max(1, Math.ceil(length / POST_SPACING));
    const postHeight = height + SLAB_DEPTH;
    for (let i = 0; i <= bays; i++) box(segment, POST, postHeight, POST, (length * i) / bays, postHeight / 2 - SLAB_DEPTH);
    box(segment, length, HANDRAIL_DEPTH, HANDRAIL_WIDTH, length / 2, height - HANDRAIL_DEPTH / 2);
    box(segment, length, BOTTOM_RAIL, BOTTOM_RAIL, length / 2, BOTTOM_RAIL_Y);
    // Balusters between the bottom rail and the handrail, in each bay.
    const balusterHeight = height - HANDRAIL_DEPTH - BOTTOM_RAIL_Y;
    const balusterY = BOTTOM_RAIL_Y + balusterHeight / 2;
    const bay = length / bays;
    for (let i = 0; i < bays; i++) {
      for (const at of balusterOffsets(bay)) box(segment, BALUSTER, balusterHeight, BALUSTER, bay * i + at, balusterY);
    }
  }
  if (parts.length === 0) return null;

  // Satin metal: a full metalness reads flat black with no environment map to reflect.
  const material = new THREE.MeshStandardMaterial({ color: RAIL_COLOR, roughness: 0.45, metalness: 0.4 });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }
  const mesh = new THREE.Mesh(mergeParts(THREE, parts), material);
  mesh.name = 'Stairwell rail';
  mesh.userData.type = STAIRWELL_RAIL_TAG;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
