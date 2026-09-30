import { ROOF_EAVE_OVERHANG } from '../lib/dormers';
import { WINDOW_WIDTH, windowCount, windowRow, type StreetFinish, type StreetHouseSpec } from '../lib/street-row';
import { removeAndDispose } from './builder-utils';
import { buildRoof, roofPeakHeight } from './roof';
import { buildWallMaterial } from './wall-patterns';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * The street of neighbours (#202, #310): every house in the row is built
 * from its `StreetHouseSpec` (lib/street-row.ts) — a masonry block in its
 * finish, windows derived from each facade's width and the ground line
 * outside it (#280), a door with its step, gutters, a roof in its own style
 * through three/roof.ts, a chimney, and a bay or dormer where the spec asks.
 *
 * Draw calls: one merged masonry mesh per house, the roof builder's one to
 * three meshes per house, and six street-wide InstancedMeshes for every
 * repeated part (frames, panes, doors, steps, chimneys, trim). Materials
 * are shared across houses with the same finish and colour.
 *
 * Tagged apart from the shell, so the wall-display modes never hide them:
 * the party walls read as solid even while ours are cut away (#201).
 */
export const NEIGHBOUR_TAG = 'neighbour';

const GLASS_COLOR = 0x2e3a46;
const TRIM_COLOR = 0xe8e2d6;
const DARK_TRIM_COLOR = 0x3b3f42;
const STONE_COLOR = 0xa9a49b;
/** The block reaches this far below the lowest ground against it. */
const PLINTH = 0.25;
/**
 * Our eaves overhang the party wall, and the neighbours' roofs are the same
 * planes — coplanar where they overlap. Sitting theirs a hair lower lets ours
 * win cleanly while the ridge still reads as one run.
 */
const ROOF_DROP = 0.03;
/** Trim sits this far proud of the wall plane so it never z-fights it. */
const FACE_GAP = 0.01;
const FRAME_MARGIN = 0.14;
const FRAME_DEPTH = 0.05;
const DOOR_WIDTH = 0.95;
const DOOR_HEIGHT = 2.05;
const STEP_WIDTH = 1.4;
/** A storey whose floor is at least this far below the ground outside can't take the door. */
const DOOR_BELOW_GROUND = 0.2;
const GUTTER_HEIGHT = 0.12;
const GUTTER_DEPTH = 0.14;
const CHIMNEY_SIZE = 0.55;
const CHIMNEY_BRICK_COLOR = '#8a5a44';
const CHIMNEY_ABOVE_ROOF = 0.8;
const BAY_DEPTH = 0.6;
const DORMER_WIDTH = 1.3;
const DORMER_DEPTH = 1.6;
/** How far in from the eave the dormer's face stands. */
const DORMER_INSET = 0.9;

/**
 * Build in house-local space with the front at −z; a house facing back at
 * us is turned round. Same order as the generator's `openSides`.
 */
type Face = 'front' | 'back' | 'west' | 'east';

interface InstanceSet {
  matrices: ThreeNS.Matrix4[];
  colors: ThreeNS.Color[] | null;
}

interface StreetParts {
  frames: InstanceSet;
  panes: InstanceSet;
  doors: InstanceSet;
  steps: InstanceSet;
  chimneys: InstanceSet;
  darkTrim: InstanceSet;
}

export function removeNeighbours(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === NEIGHBOUR_TAG)
    .forEach((obj) => {
      // InstancedMesh owns per-instance GPU buffers that the generic
      // geometry/material disposer doesn't free.
      obj.traverse((node) => {
        const inst = node as ThreeNS.InstancedMesh;
        if (inst.isInstancedMesh) inst.dispose();
      });
      removeAndDispose(scene, obj);
    });
}

export function buildNeighbours(THREE: ThreeModule, scene: ThreeNS.Scene, houses: readonly StreetHouseSpec[]): void {
  removeNeighbours(scene);
  if (houses.length === 0) return;

  const facades = new Map<string, ThreeNS.Material>();
  const parts: StreetParts = {
    frames: { matrices: [], colors: null },
    panes: { matrices: [], colors: null },
    doors: { matrices: [], colors: [] },
    steps: { matrices: [], colors: null },
    chimneys: { matrices: [], colors: [] },
    darkTrim: { matrices: [], colors: null },
  };

  for (const spec of houses) {
    const house = buildHouse(THREE, spec, facades, parts);
    house.userData.type = NEIGHBOUR_TAG;
    house.userData.houseId = spec.id;
    if (spec.side) house.userData.side = spec.side;
    scene.add(house);
    house.updateMatrixWorld(true);
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const instanced: ReadonlyArray<[keyof StreetParts, ThreeNS.MeshStandardMaterial]> = [
    ['frames', new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.8 })],
    ['panes', new THREE.MeshStandardMaterial({ color: GLASS_COLOR, roughness: 0.3, metalness: 0.2 })],
    ['doors', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })],
    ['steps', new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 0.95 })],
    ['chimneys', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })],
    ['darkTrim', new THREE.MeshStandardMaterial({ color: DARK_TRIM_COLOR, roughness: 0.7 })],
  ];
  for (const [part, material] of instanced) {
    const set = parts[part];
    if (set.matrices.length === 0) {
      material.dispose();
      continue;
    }
    const mesh = new THREE.InstancedMesh(unitBox, material, set.matrices.length);
    set.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (set.colors) mesh.setColorAt(i, set.colors[i]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The unit box's bounding sphere sits at the origin; bound the real
    // spread so three.js frustum-culls the street instead of blinking it out.
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.type = NEIGHBOUR_TAG;
    mesh.userData.part = part;
    scene.add(mesh);
  }
}

function buildHouse(
  THREE: ThreeModule,
  spec: StreetHouseSpec,
  facades: Map<string, ThreeNS.Material>,
  parts: StreetParts
): ThreeNS.Group {
  const { width: w, depth: d, eavesY, floorYs, groundFrontY, groundBackY } = spec;
  const group = new THREE.Group();
  group.position.set(spec.x, 0, spec.frontZ - spec.facing * (d / 2));
  if (spec.facing > 0) group.rotation.y = Math.PI;
  group.updateMatrix();
  const toWorld = group.matrix;
  const dummy = new THREE.Object3D();
  const place = (set: InstanceSet, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0, color?: string) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    set.matrices.push(dummy.matrix.clone().premultiply(toWorld));
    if (set.colors) set.colors.push(new THREE.Color(color ?? '#ffffff'));
  };

  const baseY = Math.min(groundFrontY, groundBackY, floorYs[0] ?? 0) - PLINTH;
  const storeyTop = (i: number) => floorYs[i + 1] ?? eavesY;
  const peak = roofPeakHeight(spec.roof.style, w, d, spec.roof.pitch);
  const ridgeAlongX = w >= d;
  const doorSign = spec.door.offset === 0 ? 1 : -Math.sign(spec.door.offset);
  // Turned-round houses mirror x, so their open sides swap in local space.
  const open = spec.facing < 0 ? spec.openSides : { west: spec.openSides.east, east: spec.openSides.west };

  // ---- Masonry: the block plus any bay and dormer, one merged mesh ----
  const masonry: ThreeNS.BufferGeometry[] = [];
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    scaleBoxUvs(g, sx, sy, sz);
    g.translate(x, y, z);
    masonry.push(g);
  };
  box(w, eavesY - baseY, d, 0, (baseY + eavesY) / 2, 0);

  // Door: the lowest storey whose floor is at (or nearly at) the ground
  // outside — on a hillside that is the one at street level, never a
  // buried one — with a stoop up to it when the floor is above the ground.
  const doorStorey = floorYs.findIndex((y) => y - groundFrontY >= -DOOR_BELOW_GROUND);
  const doorFloorY = doorStorey >= 0 ? floorYs[doorStorey]! : null;
  const frontZ = -d / 2;
  if (doorFloorY !== null) {
    const rise = Math.max(0, doorFloorY - groundFrontY);
    place(parts.frames, spec.door.offset, doorFloorY + DOOR_HEIGHT / 2 + 0.05, frontZ - FACE_GAP - 0.02, DOOR_WIDTH + 0.2, DOOR_HEIGHT + 0.1, 0.03);
    place(parts.doors, spec.door.offset, doorFloorY + DOOR_HEIGHT / 2, frontZ - FACE_GAP - 0.03, DOOR_WIDTH, DOOR_HEIGHT, 0.06, 0, spec.door.color);
    if (rise > 0.05) {
      const depth = 0.4 + rise * 1.2;
      place(parts.steps, spec.door.offset, groundFrontY + rise / 2, frontZ - depth / 2, STEP_WIDTH, rise, depth);
    } else {
      place(parts.steps, spec.door.offset, groundFrontY + 0.03, frontZ - 0.2, STEP_WIDTH - 0.1, 0.06, 0.4);
    }
  }

  // Bay: on the ground floor's street face, only where that row is above ground.
  const groundRow = windowRow(floorYs[0] ?? 0, storeyTop(0), groundFrontY);
  let bay: { x: number; width: number } | null = null;
  if (spec.bay && groundRow) {
    const bw = Math.min(2.4, w * 0.4);
    const bx = doorSign * (w / 4);
    const bottom = Math.max(floorYs[0] ?? 0, groundFrontY) - 0.02;
    const top = storeyTop(0) - 0.3;
    box(bw, top - bottom, BAY_DEPTH, bx, (bottom + top) / 2, frontZ - BAY_DEPTH / 2);
    place(parts.darkTrim, bx, top + 0.05, frontZ - BAY_DEPTH / 2 - 0.05, bw + 0.2, 0.1, BAY_DEPTH + 0.1);
    const bayFace = frontZ - BAY_DEPTH;
    placeWindow(parts, place, bx, groundRow.sillY, bayFace, bw - 0.5, groundRow.height, Math.PI);
    bay = { x: bx, width: bw };
  }

  // Dormer: a box standing on the street slope, tall enough to clear it,
  // its back buried in the roof. Only slopes that face the street take one.
  const slopeFacesStreet = spec.roof.style === 'hipped' || (spec.roof.style === 'gable' && ridgeAlongX);
  if (spec.dormer && slopeFacesStreet && peak > 1) {
    const rise = peak / (d / 2 + ROOF_EAVE_OVERHANG);
    const faceZ = frontZ + DORMER_INSET;
    const roofAtFace = (DORMER_INSET + ROOF_EAVE_OVERHANG) * rise;
    const dx = spec.roof.style === 'hipped' ? 0 : doorSign * (w / 4);
    const dh = roofAtFace + 1.0;
    const roofY = eavesY - ROOF_DROP;
    box(DORMER_WIDTH, dh, DORMER_DEPTH, dx, roofY + dh / 2, faceZ + DORMER_DEPTH / 2);
    place(parts.darkTrim, dx, roofY + dh + 0.04, faceZ + DORMER_DEPTH / 2, DORMER_WIDTH + 0.2, 0.08, DORMER_DEPTH + 0.1);
    const paneHeight = Math.min(0.8, dh - roofAtFace - 0.25);
    if (paneHeight >= 0.4) {
      placeWindow(parts, place, dx, roofY + roofAtFace + 0.12, faceZ, DORMER_WIDTH - 0.4, paneHeight, Math.PI);
    }
  }

  const masonryMesh = new THREE.Mesh(mergeIndexed(THREE, masonry), facadeMaterial(THREE, spec.facade, facades));
  masonryMesh.castShadow = true;
  masonryMesh.receiveShadow = true;
  group.add(masonryMesh);

  // ---- Windows: per storey and face, derived from the facade's width (#280) ----
  const faces: ReadonlyArray<{ face: Face; length: number; groundY: number }> = [
    { face: 'front', length: w, groundY: groundFrontY },
    { face: 'back', length: w, groundY: groundBackY },
    // The ground slopes along the side walls; the higher end governs the row.
    { face: 'west', length: d, groundY: Math.max(groundFrontY, groundBackY) },
    { face: 'east', length: d, groundY: Math.max(groundFrontY, groundBackY) },
  ];
  for (let storey = 0; storey < floorYs.length; storey += 1) {
    const floorY = floorYs[storey]!;
    const top = storeyTop(storey);
    for (const { face, length, groundY } of faces) {
      if ((face === 'west' && !open.west) || (face === 'east' && !open.east)) continue;
      const row = windowRow(floorY, top, groundY);
      const count = windowCount(length);
      if (!row || count === 0) continue;
      const pitch = length / count;
      for (let i = 0; i < count; i += 1) {
        const along = -length / 2 + (i + 0.5) * pitch;
        if (face === 'front') {
          if (storey === doorStorey && overlaps(along, WINDOW_WIDTH, spec.door.offset, DOOR_WIDTH + 0.2)) continue;
          if (storey === 0 && bay && overlaps(along, WINDOW_WIDTH, bay.x, bay.width + 0.2)) continue;
        }
        switch (face) {
          case 'front':
            placeWindow(parts, place, along, row.sillY, frontZ, WINDOW_WIDTH, row.height, Math.PI);
            break;
          case 'back':
            placeWindow(parts, place, along, row.sillY, d / 2, WINDOW_WIDTH, row.height, 0);
            break;
          case 'west':
            placeWindow(parts, place, -w / 2, row.sillY, along, WINDOW_WIDTH, row.height, -Math.PI / 2);
            break;
          case 'east':
            placeWindow(parts, place, w / 2, row.sillY, along, WINDOW_WIDTH, row.height, Math.PI / 2);
            break;
        }
      }
    }
  }

  // ---- Roof, gutters under its eaves, and the chimney ----
  const roofY = eavesY - ROOF_DROP;
  if (spec.roof.style !== 'none') {
    // buildRoof adds to (and clears roof-tagged children of) whatever it is
    // given; a scratch group keeps it off the scene's own roof.
    buildRoof(THREE, {
      scene: group as unknown as ThreeNS.Scene,
      width: w,
      depth: d,
      baseY: roofY,
      spec: { style: spec.roof.style, color: spec.roof.color },
      pitch: spec.roof.pitch,
    });
    const gutterY = roofY - GUTTER_HEIGHT / 2;
    const eaveZ = d / 2 + ROOF_EAVE_OVERHANG - GUTTER_DEPTH / 2;
    const eaveX = w / 2 + ROOF_EAVE_OVERHANG - GUTTER_DEPTH / 2;
    const alongX = spec.roof.style === 'hipped' || (spec.roof.style === 'gable' && ridgeAlongX);
    const alongZ = spec.roof.style === 'hipped' || (spec.roof.style === 'gable' && !ridgeAlongX);
    if (alongX) {
      for (const sign of [-1, 1] as const) {
        place(parts.darkTrim, 0, gutterY, sign * eaveZ, w + ROOF_EAVE_OVERHANG * 2, GUTTER_HEIGHT, GUTTER_DEPTH);
      }
    }
    if (alongZ) {
      for (const sign of [-1, 1] as const) {
        place(parts.darkTrim, sign * eaveX, gutterY, 0, d + ROOF_EAVE_OVERHANG * 2, GUTTER_HEIGHT, GUTTER_DEPTH, Math.PI / 2);
      }
    }
  }
  if (spec.chimney && spec.roof.style !== 'none') {
    const chimney = chimneyPlacement(spec.roof.style, ridgeAlongX, w, d, peak, doorSign);
    const height = chimney.roofBelow + CHIMNEY_ABOVE_ROOF + 0.1;
    place(
      parts.chimneys,
      chimney.x,
      roofY - 0.1 + height / 2,
      chimney.z,
      CHIMNEY_SIZE,
      height,
      CHIMNEY_SIZE,
      0,
      spec.facade.finish === 'brick' ? darken(spec.facade.color, 0.35) : CHIMNEY_BRICK_COLOR
    );
  }

  return group;
}

function placeWindow(
  parts: StreetParts,
  place: (set: InstanceSet, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY?: number) => void,
  x: number,
  sillY: number,
  z: number,
  width: number,
  height: number,
  rotY: number
): void {
  // Local +z of the (unrotated) instance is "out of the wall"; the rotation
  // turns that outward for each face. The pane stands a touch proud of the
  // frame so it reads as glass in a frame at orbit distance.
  const out = (dist: number): [number, number] => [Math.sin(rotY) * dist, Math.cos(rotY) * dist];
  const [fx, fz] = out(FACE_GAP + FRAME_DEPTH / 2);
  const [px, pz] = out(FACE_GAP + FRAME_DEPTH / 2 + 0.02);
  const y = sillY + height / 2;
  place(parts.frames, x + fx, y, z + fz, width + FRAME_MARGIN, height + FRAME_MARGIN, FRAME_DEPTH, rotY);
  place(parts.panes, x + px, y, z + pz, width, height, FRAME_DEPTH, rotY);
}

function overlaps(x: number, width: number, otherX: number, otherWidth: number): boolean {
  return Math.abs(x - otherX) < (width + otherWidth) / 2 + 0.1;
}

/** Where the chimney stands on each roof and how much roof is under it. */
function chimneyPlacement(
  style: StreetHouseSpec['roof']['style'],
  ridgeAlongX: boolean,
  w: number,
  d: number,
  peak: number,
  sign: number
): { x: number; z: number; roofBelow: number } {
  switch (style) {
    case 'gable':
      // On the ridge, near one end.
      return ridgeAlongX
        ? { x: sign * (w / 2 - 0.8), z: 0, roofBelow: peak }
        : { x: 0, z: sign * (d / 2 - 0.8), roofBelow: peak };
    case 'hipped': {
      // Off-centre on the pyramid, which is lower there.
      const x = sign * (w / 4);
      return { x, z: 0, roofBelow: peak * (1 - Math.abs(x) / (w / 2 + ROOF_EAVE_OVERHANG)) };
    }
    default:
      // Flat: at a back corner, up through the slab.
      return { x: sign * (w / 2 - 0.6), z: d / 2 - 0.6, roofBelow: peak };
  }
}

/**
 * One material per finish and colour, shared by every house that wears it.
 * Masonry UVs are in metres (see scaleBoxUvs), so the texture repeat is per
 * metre and one material fits every footprint.
 */
function facadeMaterial(
  THREE: ThreeModule,
  facade: { color: string; finish: StreetFinish },
  cache: Map<string, ThreeNS.Material>
): ThreeNS.Material {
  const key = `${facade.finish}|${facade.color}`;
  const cached = cache.get(key);
  if (cached) return cached;
  // The pattern painters need a canvas; without one (tests) the finish is a flat colour.
  const material =
    facade.finish === 'plain' || typeof document === 'undefined'
      ? new THREE.MeshStandardMaterial({ color: facade.color, roughness: 0.9 })
      : buildWallMaterial(THREE, {
          pattern: facade.finish === 'brick' ? 'brick' : 'plaster',
          color: facade.color,
          width: 1,
          height: 1,
        });
  cache.set(key, material);
  return material;
}

/**
 * BoxGeometry maps every face to 0..1; stretch each face's UVs to its size
 * in metres so a shared per-metre texture tiles evenly whatever the box.
 * Faces come in the order +x, −x, +y, −y, +z, −z, four vertices each.
 */
function scaleBoxUvs(geometry: ThreeNS.BufferGeometry, w: number, h: number, d: number): void {
  const uv = geometry.attributes.uv as ThreeNS.BufferAttribute | undefined;
  if (!uv) return;
  const faceSize: ReadonlyArray<readonly [number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i += 1) {
    const [sx, sy] = faceSize[Math.floor(i / 4)] ?? [1, 1];
    uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  }
  uv.needsUpdate = true;
}

/**
 * Concatenate indexed geometries that share the position/normal/uv layout
 * (all BoxGeometry here) into one, and free the parts. A local stand-in for
 * BufferGeometryUtils.mergeGeometries, which would drag three into the
 * static bundle — the scene loads it lazily.
 */
function mergeIndexed(THREE: ThreeModule, parts: readonly ThreeNS.BufferGeometry[]): ThreeNS.BufferGeometry {
  if (parts.length === 1) return parts[0]!;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const position = part.attributes.position as ThreeNS.BufferAttribute;
    const normal = part.attributes.normal as ThreeNS.BufferAttribute;
    const uv = part.attributes.uv as ThreeNS.BufferAttribute;
    const index = part.index;
    if (!index) continue;
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    for (let i = 0; i < index.count; i += 1) indices.push(index.getX(i) + offset);
    offset += position.count;
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}

function darken(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const channel = (from: number) => Math.round(parseInt(normalized.slice(from, from + 2), 16) * (1 - amount));
  const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hex2(channel(0))}${hex2(channel(2))}${hex2(channel(4))}`;
}
