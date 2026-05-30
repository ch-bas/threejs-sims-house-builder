import type * as ThreeNS from 'three';
import type { FurnitureItem, InteriorWall } from '../lib/types';

type ThreeModule = typeof import('three');

const INTERIOR_WALL_TAG = 'interior-wall';
const WALL_THICKNESS = 0.16;
const WALL_HEIGHT = 2.6;
const OPENING_DISTANCE_THRESHOLD = 0.4;

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
    .forEach((obj) => scene.remove(obj));
}

export interface RenderInteriorWallsOptions {
  /** Door / window items considered for opening cutouts; pass [] to disable. */
  openingCandidates?: readonly FurnitureItem[];
}

export function renderInteriorWalls(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  walls: readonly InteriorWall[],
  yOffset = 0,
  ghostOpacity?: number,
  options: RenderInteriorWallsOptions = {}
): void {
  for (const wall of walls) {
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (length < 0.01) continue;

    const openings = options.openingCandidates
      ? computeSegmentOpenings(wall, options.openingCandidates)
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
        ? buildExtrudedWallGeometry(THREE, length, WALL_HEIGHT, WALL_THICKNESS, openings)
        : new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS);

    const wallMesh = new THREE.Mesh(geometry, material);
    wallMesh.position.set((wall.x1 + wall.x2) / 2, yOffset + (openings.length > 0 ? 0 : WALL_HEIGHT / 2), (wall.z1 + wall.z2) / 2);
    wallMesh.rotation.y = -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallMesh.userData.type = INTERIOR_WALL_TAG;
    wallMesh.userData.wallId = wall.id;
    scene.add(wallMesh);

    // Matching dark-wood baseboard along the bottom of every interior wall.
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a,
      roughness: 0.7,
    });
    if (ghostOpacity !== undefined) {
      baseMat.transparent = true;
      baseMat.opacity = ghostOpacity;
    }
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.12, WALL_THICKNESS + 0.01),
      baseMat
    );
    base.position.set(
      (wall.x1 + wall.x2) / 2,
      yOffset + 0.06,
      (wall.z1 + wall.z2) / 2
    );
    base.rotation.y = -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);
    base.receiveShadow = true;
    base.userData.type = INTERIOR_WALL_TAG;
    base.userData.wallId = wall.id;
    scene.add(base);
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

  for (const opening of openings) {
    const x0 = opening.centerAlongWall - opening.width / 2;
    const x1 = opening.centerAlongWall + opening.width / 2;
    const y0 = opening.bottomFromFloor;
    const y1 = y0 + opening.height;
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

/** Project doors/windows onto the segment and return any cutouts near it. */
function computeSegmentOpenings(
  wall: InteriorWall,
  items: readonly FurnitureItem[]
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
    const localX = (item.position.x - cx) * dx + (item.position.z - cz) * dz;
    const localPerp = -(item.position.x - cx) * dz + (item.position.z - cz) * dx;
    if (Math.abs(localPerp) > OPENING_DISTANCE_THRESHOLD) continue;

    const halfItem = item.width / 2;
    if (localX + halfItem < -halfLen || localX - halfItem > halfLen) continue;

    const bottom = item.type === 'door' ? 0 : 1.0;
    const clampedCenter = Math.max(-halfLen + halfItem, Math.min(halfLen - halfItem, localX));
    openings.push({
      centerAlongWall: clampedCenter,
      bottomFromFloor: bottom,
      width: Math.min(item.width, length - 0.05),
      height: Math.min(item.height, WALL_HEIGHT - bottom - 0.05),
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
  yOffset = 0
): void {
  clearPreview(scene);
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (length < 0.05) return;
  const material = new THREE.MeshStandardMaterial({
    color: 0x42a5f5,
    transparent: true,
    opacity: 0.5,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS), material);
  mesh.position.set((start.x + end.x) / 2, yOffset + WALL_HEIGHT / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  mesh.userData.type = `${INTERIOR_WALL_TAG}-preview`;
  scene.add(mesh);
}

export function clearPreview(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === `${INTERIOR_WALL_TAG}-preview`)
    .forEach((obj) => scene.remove(obj));
}
