import { onFootprintEdge } from '../lib/footprint';
import { INTERIOR_WALL_THICKNESS, interiorWallOpeningSpan } from '../lib/opening-snap';
import { OPENING_HEAD_CLEARANCE, fitOpeningToStorey } from '../lib/storeys';
import { FLOOR_HEIGHT_METERS, type FootprintCutout, type FurnitureItem, type InteriorWall } from '../lib/types';
import { BASEBOARD_HEIGHT, BASEBOARD_WALL_GAP, baseboardRuns } from './baseboard';
import { removeAndDispose } from './builder-utils';
import { classifyOpeningOwners, mergeHoleRects, type OpeningOwner } from './wall-openings';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

const INTERIOR_WALL_TAG = 'interior-wall';
/** Partition height in a classic 3 m storey; see `interiorWallHeight` (#202). */
const DEFAULT_WALL_HEIGHT = 2.6;
/** A partition end on the building's outline stops this short of the shell (#660): twice the baseboard's gap. */
const PARTITION_END_GAP = BASEBOARD_WALL_GAP * 2;

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
  /** The footprint's cut corner: its two walls claim openings too (#727). */
  cutout?: FootprintCutout | undefined;
  /** Partition height for this storey (#202). Defaults to 2.6 m. */
  wallHeight?: number;
  /**
   * Per-wall heights overriding `wallHeight`, by wall id — the porch back
   * wall must reach the soffit, above the partition height (#275).
   */
  wallHeights?: ReadonlyMap<string, number>;
  /**
   * Floor-to-floor height of the storey, which the door and window meshes are
   * fitted to (#277); the holes cut here follow the same fit. Defaults to the
   * classic 3 m storey.
   */
  storeyHeight?: number;
}

export function renderInteriorWalls(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  walls: readonly InteriorWall[],
  yOffset = 0,
  ghostOpacity?: number,
  options: RenderInteriorWallsOptions = {}
): void {
  const storeyHeight = options.storeyHeight ?? FLOOR_HEIGHT_METERS;
  // Classify every opening to exactly one wall across the whole floor (exterior
  // + interior). An opening this interior wall doesn't own is cut elsewhere, so
  // it never gets double-cut at a junction.
  const owners =
    options.openingCandidates && options.roomWidth !== undefined && options.roomDepth !== undefined
      ? classifyOpeningOwners(options.openingCandidates, options.roomWidth, options.roomDepth, walls, options.cutout)
      : null;

  for (const wall of walls) {
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (length < 0.01) continue;
    const wallHeight = options.wallHeights?.get(wall.id) ?? options.wallHeight ?? DEFAULT_WALL_HEIGHT;

    const openings = options.openingCandidates
      ? computeSegmentOpenings(wall, options.openingCandidates, owners, wallHeight, storeyHeight)
      : [];
    const dirX = (wall.x2 - wall.x1) / length;
    const dirZ = (wall.z2 - wall.z1) / length;
    // An end drawn to the shell (the snap puts it exactly on the outline)
    // stops short of it: a full-length box put a 0.16 × 2.6 m end face in
    // the facade's own plane, a flickering stripe seen from outside (#660).
    // The baseboard keeps its own, smaller gap (#201), so it still tucks
    // under the wall's end rather than sharing a plane with it.
    const building =
      options.roomWidth !== undefined && options.roomDepth !== undefined
        ? { width: options.roomWidth, height: options.roomDepth, cutout: options.cutout }
        : null;
    const trimStart = building && onFootprintEdge(building, wall.x1, wall.z1) ? PARTITION_END_GAP : 0;
    const trimEnd = building && onFootprintEdge(building, wall.x2, wall.z2) ? PARTITION_END_GAP : 0;
    const meshLength = length - trimStart - trimEnd;
    const shift = (trimStart - trimEnd) / 2;
    // Clamp whenever an end is trimmed, even when both are and the shift is 0:
    // a hole flush with the old end would reach past the shorter mesh, the
    // triangulator would drop it, and the door would be walled over.
    const meshOpenings = trimStart || trimEnd ? openings.map((o) => trimmedOpening(o, shift, meshLength)) : openings;

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
        ? buildExtrudedWallGeometry(THREE, meshLength, wallHeight, INTERIOR_WALL_THICKNESS, meshOpenings)
        : new THREE.BoxGeometry(meshLength, wallHeight, INTERIOR_WALL_THICKNESS);

    // Local +z is side 'a' (lib/wall-sides.ts). A second material only when
    // the faces differ, so a plain wall stays one draw call.
    let wallMaterial: ThreeNS.Material | ThreeNS.Material[] = material;
    if (wall.colorB !== undefined) {
      const back = material.clone();
      back.color.set(wall.colorB);
      wallMaterial = openings.length > 0 ? splitExtrudedFaces(geometry, material, back) : [material, material, material, material, material, back];
    }

    const wallMesh = new THREE.Mesh(geometry, wallMaterial);
    wallMesh.position.set(
      (wall.x1 + wall.x2) / 2 + dirX * shift,
      yOffset + (openings.length > 0 ? 0 : wallHeight / 2),
      (wall.z1 + wall.z2) / 2 + dirZ * shift
    );
    wallMesh.rotation.y = -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallMesh.name = `Interior wall ${wall.id}`;
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
    const half = length / 2;
    for (const [from, to] of baseboardRuns(-half + BASEBOARD_WALL_GAP, half - BASEBOARD_WALL_GAP, openings)) {
      const mid = (from + to) / 2;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(to - from, BASEBOARD_HEIGHT, INTERIOR_WALL_THICKNESS + 0.01),
        baseMat
      );
      base.position.set(
        (wall.x1 + wall.x2) / 2 + dirX * mid,
        yOffset + BASEBOARD_HEIGHT / 2,
        (wall.z1 + wall.z2) / 2 + dirZ * mid
      );
      base.rotation.y = wallMesh.rotation.y;
      base.receiveShadow = true;
      base.name = `Baseboard ${wall.id}`;
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

/**
 * An extruded wall's material list with its -z cap on `back`. ExtrudeGeometry
 * puts both caps in its first group, the -z one first, then the sides.
 */
function splitExtrudedFaces(geometry: ThreeNS.BufferGeometry, front: ThreeNS.Material, back: ThreeNS.Material): ThreeNS.Material[] {
  const [caps, sides] = geometry.groups;
  if (!caps || !sides) return [front];
  geometry.clearGroups();
  const half = caps.count / 2;
  geometry.addGroup(caps.start, half, 2);
  geometry.addGroup(caps.start + half, half, 0);
  geometry.addGroup(sides.start, sides.count, 1);
  return [front, front, back];
}

/**
 * An opening in the frame of a trimmed wall. `interiorWallOpeningSpan` lets a
 * door sit flush with the wall's end, so the hole is cut to the trimmed end
 * too: left past it, the triangulator dropped the hole and walled the door
 * over (#660).
 */
function trimmedOpening(opening: SegmentOpening, shift: number, meshLength: number): SegmentOpening {
  const half = meshLength / 2;
  const low = Math.max(opening.centerAlongWall - opening.width / 2 - shift, -half);
  const high = Math.min(opening.centerAlongWall + opening.width / 2 - shift, half);
  return { ...opening, centerAlongWall: (low + high) / 2, width: high - low };
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
  wallHeight: number,
  storeyHeight: number
): SegmentOpening[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 0.05) return [];

  const dx = (wall.x2 - wall.x1) / length;
  const dz = (wall.z2 - wall.z1) / length;
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;

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

    // Shared with the walker's door gaps, so the two can't disagree (#399).
    const span = interiorWallOpeningSpan(wall, { width: item.width, position: item.position });
    if (!span) continue;

    // Same sill and height as the exterior cut and the mesh, fitted to the
    // storey (#212, #204, #277)...
    const fitted = fitOpeningToStorey(item, storeyHeight);
    const bottom = fitted.sill;
    // ...then to this partition, which stops short of the ceiling. A window
    // sill above a low (loft) partition leaves nothing to cut (#202).
    const height = Math.min(fitted.height, wallHeight - bottom - OPENING_HEAD_CLEARANCE);
    if (height <= 0) continue;
    openings.push({
      centerAlongWall: span.centre,
      bottomFromFloor: bottom,
      width: span.width,
      height,
    });
  }
  return openings;
}

const PREVIEW_TAG = `${INTERIOR_WALL_TAG}-preview`;

/**
 * Preview the wall the user is currently dragging — a translucent ghost.
 * Runs per pointer move, so one unit box is created per draft and only
 * re-posed and scaled after that; clearPreview disposes it (#409).
 */
export function renderInteriorWallPreview(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  start: { x: number; z: number },
  end: { x: number; z: number },
  yOffset = 0,
  wallHeight = DEFAULT_WALL_HEIGHT
): void {
  let mesh = scene.children.find((obj) => obj.userData.type === PREVIEW_TAG);
  if (!mesh) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x42a5f5,
      transparent: true,
      opacity: 0.5,
    });
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.userData.type = PREVIEW_TAG;
    scene.add(mesh);
  }
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  mesh.visible = length >= 0.05;
  if (!mesh.visible) return;
  mesh.scale.set(length, wallHeight, INTERIOR_WALL_THICKNESS);
  mesh.position.set((start.x + end.x) / 2, yOffset + wallHeight / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
}

export function clearPreview(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === PREVIEW_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

const GHOST_TAG = `${INTERIOR_WALL_TAG}-ghost`;
const GHOST_COLOR = 0x42a5f5;
const GHOST_REFUSED_COLOR = 0xef4444;

/**
 * Translucent stand-ins for walls a gesture is holding (#718, #724): one unit box per
 * wall, re-posed per move and scaled, so a held gesture allocates nothing and
 * rebuilds nothing. The boxes stand a hair proud of the wall they follow.
 */
export function renderWallGhosts(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  walls: ReadonlyArray<{ x1: number; z1: number; x2: number; z2: number }>,
  yOffset: number,
  wallHeight: number,
  refused = false
): void {
  const pool = scene.children.filter((obj) => obj.userData.type === GHOST_TAG) as ThreeNS.Mesh[];
  walls.forEach((wall, index) => {
    let mesh = pool[index];
    if (!mesh) {
      const material = new THREE.MeshStandardMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.5 });
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.userData.type = GHOST_TAG;
      scene.add(mesh);
    }
    (mesh.material as ThreeNS.MeshStandardMaterial).color.setHex(refused ? GHOST_REFUSED_COLOR : GHOST_COLOR);
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    mesh.scale.set(length, wallHeight + 0.02, INTERIOR_WALL_THICKNESS + 0.02);
    mesh.position.set((wall.x1 + wall.x2) / 2, yOffset + wallHeight / 2, (wall.z1 + wall.z2) / 2);
    mesh.rotation.y = -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
  });
  for (const extra of pool.slice(walls.length)) removeAndDispose(scene, extra);
}

export function clearWallGhosts(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === GHOST_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

/** drag-handlers finds the selected wall's end handles by this tag. */
const WALL_HANDLE_TAG = `${INTERIOR_WALL_TAG}-handle`;
const WALL_HANDLE_RADIUS = 0.14;

/** A dot on each end of the selected wall, on the floor and drawn over everything (#718). */
export function addWallHandles(THREE: ThreeModule, scene: ThreeNS.Scene, wall: InteriorWall, yOffset: number): void {
  for (const [grip, x, z] of [['start', wall.x1, wall.z1], ['end', wall.x2, wall.z2]] as const) {
    const material = new THREE.MeshStandardMaterial({ color: 0x7ff3ff, emissive: 0x2a8fa0, depthTest: false, transparent: true });
    const handle = new THREE.Mesh(new THREE.SphereGeometry(WALL_HANDLE_RADIUS, 16, 12), material);
    handle.position.set(x, yOffset + WALL_HANDLE_RADIUS, z);
    handle.renderOrder = 1000;
    handle.userData.type = WALL_HANDLE_TAG;
    handle.userData.wallId = wall.id;
    handle.userData.grip = grip;
    scene.add(handle);
  }
}

export function clearWallHandles(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === WALL_HANDLE_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}
