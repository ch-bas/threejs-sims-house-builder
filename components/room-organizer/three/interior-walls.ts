import { WINDOW_SILL_HEIGHT } from '../lib/constants';
import { BASEBOARD_HEIGHT, BASEBOARD_WALL_GAP, baseboardRuns } from './baseboard';
import { removeAndDispose } from './builder-utils';
import { classifyOpeningOwners, mergeHoleRects, type OpeningOwner } from './wall-openings';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const INTERIOR_WALL_TAG = 'interior-wall';
const WALL_THICKNESS = 0.16;
/** Partition height in a classic 3 m storey; see `interiorWallHeight` (#202). */
const DEFAULT_WALL_HEIGHT = 2.6;

interface SegmentOpening {
  /** Centre position along the wall, measured from the segment midpoint (m). */
  centerAlongWall: number;
  bottomFromFloor: number;
  width: number;
  height: number;
}

export function clearInteriorWalls(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === INTERIOR_WALL_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

export interface RenderInteriorWallsOptions {
  /** Door / window items considered for opening cutouts; pass [] to disable. */
  openingCandidates?: readonly FurnitureItem[];
  /**
   * Room footprint, so an opening can be classified across ALL walls (exterior
   * + interior) and cut by exactly one. Omit to fall back to interior-only
   * proximity (legacy behaviour).
   */
  roomWidth?: number;
  roomDepth?: number;
  /** Partition height for this storey (#202). Defaults to 2.6 m. */
  wallHeight?: number;
}

export function renderInteriorWalls(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  walls: readonly InteriorWall[],
  yOffset = 0,
  ghostOpacity?: number,
  options: RenderInteriorWallsOptions = {}
): void {
  const wallHeight = options.wallHeight ?? DEFAULT_WALL_HEIGHT;
  // Classify every opening to exactly one wall across the whole floor (exterior
  // + interior). An opening this interior wall doesn't own is cut elsewhere, so
  // it never gets double-cut at a junction.
  const owners =
    options.openingCandidates && options.roomWidth !== undefined && options.roomDepth !== undefined
      ? classifyOpeningOwners(options.openingCandidates, options.roomWidth, options.roomDepth, walls)
      : null;

  for (const wall of walls) {
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (length < 0.01) continue;

    const openings = options.openingCandidates
      ? computeSegmentOpenings(wall, options.openingCandidates, owners, wallHeight)
      : [];

    const material = new THREE.MeshStandardMaterial({
      color: wall.color ?? 0xe0e0e0,
      roughness: 0.85,
    });
    if (ghostOpacity !== undefined) {
      material.transparent = true;
      material.opacity = ghostOpacity;
    }

    const geometry =
      openings.length > 0
        ? buildExtrudedWallGeometry(THREE, length, wallHeight, WALL_THICKNESS, openings)
        : new THREE.BoxGeometry(length, wallHeight, WALL_THICKNESS);

    const wallMesh = new THREE.Mesh(geometry, material);
    wallMesh.position.set((wall.x1 + wall.x2) / 2, yOffset + (openings.length > 0 ? 0 : wallHeight / 2), (wall.z1 + wall.z2) / 2);
    wallMesh.rotation.y = -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallMesh.userData.type = INTERIOR_WALL_TAG;
    wallMesh.userData.wallId = wall.id;
    scene.add(wallMesh);

    // Matching dark-wood baseboard along the bottom of every interior wall —
    // broken at doorways, and stopping just short of the ends so an end
    // butting an exterior wall isn't coplanar with (and z-fighting through)
    // the facade (#201).
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a,
      roughness: 0.7,
    });
    if (ghostOpacity !== undefined) {
      baseMat.transparent = true;
      baseMat.opacity = ghostOpacity;
    }
    const dirX = (wall.x2 - wall.x1) / length;
    const dirZ = (wall.z2 - wall.z1) / length;
    const half = length / 2;
    for (const [from, to] of baseboardRuns(-half + BASEBOARD_WALL_GAP, half - BASEBOARD_WALL_GAP, openings)) {
      const mid = (from + to) / 2;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(to - from, BASEBOARD_HEIGHT, WALL_THICKNESS + 0.01),
        baseMat
      );
      base.position.set(
        (wall.x1 + wall.x2) / 2 + dirX * mid,
        yOffset + BASEBOARD_HEIGHT / 2,
        (wall.z1 + wall.z2) / 2 + dirZ * mid
      );
      base.rotation.y = wallMesh.rotation.y;
      base.receiveShadow = true;
      base.userData.type = INTERIOR_WALL_TAG;
      base.userData.wallId = wall.id;
      scene.add(base);
    }
  }
}

function buildExtrudedWallGeometry(
  THREE: ThreeModule,
  length: number,
  height: number,
  thickness: number,
  openings: readonly SegmentOpening[]
): ThreeNS.BufferGeometry {
  const halfLen = length / 2;

  // Wall is built lying flat: 2D shape spans (x = along wall, y = vertical),
  // then extruded `thickness` deep. After extrusion we recentre on Z.
  const shape = new THREE.Shape();
  shape.moveTo(-halfLen, 0);
  shape.lineTo(halfLen, 0);
  shape.lineTo(halfLen, height);
  shape.lineTo(-halfLen, height);
  shape.closePath();

  // Merge overlapping openings before punching holes — earcut rejects
  // overlapping holes and yields phantom fill / self-intersecting triangles.
  const rects = openings.map(
    (o) =>
      [
        o.centerAlongWall - o.width / 2,
        o.bottomFromFloor,
        o.centerAlongWall + o.width / 2,
        o.bottomFromFloor + o.height,
      ] as [number, number, number, number]
  );
  for (const [x0, y0, x1, y1] of mergeHoleRects(rects)) {
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Centre the extrude on Z so the wall sits symmetrically around its line.
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** Perpendicular distance for the legacy interior-only proximity fallback. */
const OPENING_DISTANCE_THRESHOLD = 0.4;

/**
 * Project doors/windows onto the segment and return any cutouts this wall owns.
 * When an `owners` map is given (the floor-wide single-wall classification),
 * only openings assigned to THIS wall are cut, so an opening at a junction is
 * never double-cut. Without it, fall back to a local proximity test.
 */
function computeSegmentOpenings(
  wall: InteriorWall,
  items: readonly FurnitureItem[],
  owners: ReadonlyMap<string, OpeningOwner> | null,
  wallHeight: number
): SegmentOpening[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 0.05) return [];

  const dx = (wall.x2 - wall.x1) / length;
  const dz = (wall.z2 - wall.z1) / length;
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  const halfLen = length / 2;

  const openings: SegmentOpening[] = [];
  for (const item of items) {
    if (item.type !== 'door' && item.type !== 'window') continue;
    if (!item.position) continue;

    if (owners) {
      // Authoritative: only cut openings the classifier assigned to this wall.
      const owner = owners.get(item.id);
      if (!owner || owner.kind !== 'interior' || owner.wallId !== wall.id) continue;
    } else {
      // Legacy proximity fallback (no room dims supplied).
      const localPerp = -(item.position.x - cx) * dz + (item.position.z - cz) * dx;
      if (Math.abs(localPerp) > OPENING_DISTANCE_THRESHOLD) continue;
    }

    const localX = (item.position.x - cx) * dx + (item.position.z - cz) * dz;
    if (localX + item.width / 2 < -halfLen || localX - item.width / 2 > halfLen) continue;

    // Same sill datum as the exterior cut and the window mesh (#212).
    const bottom = item.type === 'door' ? 0 : WINDOW_SILL_HEIGHT;
    // Clamp the width to the segment first, then clamp the centre using the
    // clamped half-width so an oversized opening can't extend past the wall.
    const width = Math.min(item.width, Math.max(0, length - 0.05));
    const halfItem = width / 2;
    const clampedCenter = Math.max(-halfLen + halfItem, Math.min(halfLen - halfItem, localX));
    // A window sill above a low (loft) partition leaves nothing to cut (#202).
    const height = Math.min(item.height, wallHeight - bottom - 0.05);
    if (height <= 0) continue;
    openings.push({
      centerAlongWall: clampedCenter,
      bottomFromFloor: bottom,
      width,
      height,
    });
  }
  return openings;
}

/** Preview the wall the user is currently dragging — a translucent ghost. */
export function renderInteriorWallPreview(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  start: { x: number; z: number },
  end: { x: number; z: number },
  yOffset = 0,
  wallHeight = DEFAULT_WALL_HEIGHT
): void {
  clearPreview(scene);
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (length < 0.05) return;
  const material = new THREE.MeshStandardMaterial({
    color: 0x42a5f5,
    transparent: true,
    opacity: 0.5,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, wallHeight, WALL_THICKNESS), material);
  mesh.position.set((start.x + end.x) / 2, yOffset + wallHeight / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  mesh.userData.type = `${INTERIOR_WALL_TAG}-preview`;
  scene.add(mesh);
}

export function clearPreview(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === `${INTERIOR_WALL_TAG}-preview`)
    .forEach((obj) => removeAndDispose(scene, obj));
}
