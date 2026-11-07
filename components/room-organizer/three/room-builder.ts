import { GRID_SIZE_METERS } from '../lib/constants';
import { floorHoleOutlines, mergeHoleRects } from '../lib/floor-holes';
import { floorPlanCanvasLayout } from '../lib/floor-plan-fit';
import { alongSide, cutoutRect, footprintOutline, shellWalls, shellWallSpan, type ShellWallId } from '../lib/footprint';
import { FLOOR_HEIGHT_METERS } from '../lib/types';
import { BASEBOARD_DEPTH, BASEBOARD_HEIGHT, BASEBOARD_WALL_GAP, baseboardRuns } from './baseboard';
import { removeAndDispose, withOutsideFace } from './builder-utils';
import { buildFloorMaterial } from './floor-patterns';
import { shutOutIndoorLamps, shutOutIndoorLampsOutside } from './outdoor-lamps';
import { buildRevealGeometry, skirtingOpenings } from './reveals';
import { ROOF_OFF_STOREY_KEY } from './roof';
import { revealsEnabled, withMaxAnisotropy } from './texture-settings';
import { openingsForWall, type FloorOpening, type WallOpening } from './wall-openings';
import { DEFAULT_WALL_COLOR, buildWallMaterial } from './wall-patterns';
import type { FloorPattern, FloorPlanFitMode, FootprintCutout, Vec2, WallId, WallPattern } from '../lib/types';
import type { ZoneFloorPatch } from '../lib/zones';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Freeze an object's transform: the room shell (walls, floor, baseboards,
 * foundation, grid) never moves after it's built — a change rebuilds the whole
 * shell, and applyWallDisplay only toggles `.visible`. Disabling matrixAutoUpdate
 * (after a single updateMatrix()) skips the per-frame matrix recompute for every
 * one of these meshes.
 */
function makeStatic(object: ThreeNS.Object3D): void {
  object.updateMatrix();
  object.matrixAutoUpdate = false;
}

export const ROOM_OBJECT_TAGS = {
  Floor: 'floor',
  Wall: 'wall',
  Furniture: 'furniture',
  Signal: 'wifi-signal',
  CameraVision: 'camera-vision',
} as const;

export type RoomObjectTag = (typeof ROOM_OBJECT_TAGS)[keyof typeof ROOM_OBJECT_TAGS];

export type WallDisplay = 'up' | 'cutaway' | 'down';

/**
 * build-mode-style wall cutaway. Reads the active wall-display mode + the camera
 * position and toggles each tagged wall (and the roof) `.visible` so the
 * user sees the interior from any angle without ghostly translucency.
 * Selection outlines (`wall-selection`) mirror their owner wall so a hidden
 * wall can't leave a glowing depth-test-free ghost floating in space (#133).
 *
 * Call this once after rebuilding walls, and again on every orbit-controls
 * change — visibility is cheap to flip, no geometry rebuild required.
 *
 * Returns true when any visibility actually changed: walls cast shadows and
 * the shadow map is static, so a flip needs a one-off shadow refresh — but
 * only a flip, not every orbit frame (#132).
 */
/**
 * userData flag on a top-level object of a storey the walkthrough hides
 * (#446): applyWallDisplay keeps such walls hidden whatever the mode.
 */
export const OFF_STOREY_KEY = 'offStorey';

/** userData key on a top-level object: the storey it was built for (#446). */
export const STOREY_KEY = 'storey';

/**
 * userData key on a notch wall and its baseboards: the shell id (`notch-x`,
 * `notch-z`). `wallId` is the side it shares a colour with, and an opening is
 * owned by the shell wall it is cut into (#659).
 */
const SHELL_WALL_KEY = 'shellWall';

/** Every storey's shell has a `south`: a wall is only known by its storey too (#659). */
function wallDisplayKey(tag: unknown, storey: unknown, id: unknown): string {
  return `${String(tag)}:${String(storey)}:${String(id)}`;
}

/**
 * userData on the shell parts of an L's two new walls (#727): the x or z of
 * their plane. They face the same way as a whole side of the house but stand
 * elsewhere, and the cutaway hides a wall by the side of its plane the camera
 * is on.
 */
const WALL_PLANE_KEY = 'wallPlane';

export function applyWallDisplay(
  scene: ThreeNS.Scene,
  cameraX: number,
  cameraZ: number,
  mode: WallDisplay,
  roomWidth: number,
  roomDepth: number
): boolean {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  let changed = false;
  const setVisible = (obj: ThreeNS.Object3D, visible: boolean): void => {
    if (obj.visible !== visible) {
      obj.visible = visible;
      changed = true;
    }
  };
  // Owner visibility by tag, storey and id, for the sync pass below.
  const wallVisibility = new Map<string, boolean>();

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (obj.userData[OFF_STOREY_KEY] === true && (tag === 'interior-wall' || tag === ROOM_OBJECT_TAGS.Wall)) {
      setVisible(obj, false);
      const id = (obj.userData[SHELL_WALL_KEY] ?? obj.userData.wallId) as string | undefined;
      if (id) wallVisibility.set(wallDisplayKey(tag, obj.userData[STOREY_KEY], id), false);
      continue;
    }
    if (tag === 'roof') {
      // Roof only shows in "up" mode — cutaway and down both want the
      // interior visible from above — and only over the top storey.
      setVisible(obj, mode === 'up' && obj.userData[ROOF_OFF_STOREY_KEY] !== true);
      continue;
    }
    if (tag === 'interior-wall') {
      const visible = mode !== 'down';
      setVisible(obj, visible);
      const id = obj.userData.wallId as string | undefined;
      if (id) wallVisibility.set(wallDisplayKey(tag, obj.userData[STOREY_KEY], id), visible);
      continue;
    }
    if (tag !== ROOM_OBJECT_TAGS.Wall) continue;

    // Id-less Wall-tagged helpers (the snap grid) stay visible in EVERY mode
    // — checking this after the mode branches made walls-down hide the floor
    // grid, which Sims-style walls-down is supposed to keep (#122).
    const wallId = obj.userData.wallId as WallId | undefined;
    if (!wallId) {
      setVisible(obj, true);
      continue;
    }
    const plane = obj.userData[WALL_PLANE_KEY] as number | undefined;

    let visible: boolean;
    if (mode === 'down') {
      visible = false;
    } else if (mode === 'up') {
      visible = true;
    } else {
      // Cutaway: hide the wall if the camera is on its outer side.
      let nx = 0;
      let nz = 0;
      let cx = 0;
      let cz = 0;
      switch (wallId) {
        case 'north': nz = -1; cz = plane ?? -halfD; break;
        case 'south': nz =  1; cz = plane ??  halfD; break;
        case 'east':  nx =  1; cx = plane ??  halfW; break;
        case 'west':  nx = -1; cx = plane ?? -halfW; break;
      }
      const dot = (cameraX - cx) * nx + (cameraZ - cz) * nz;
      visible = dot < 0;
    }
    setVisible(obj, visible);
    // A notch wall answers to its shell id, so it never speaks for its side.
    const id = (obj.userData[SHELL_WALL_KEY] ?? wallId) as string;
    wallVisibility.set(wallDisplayKey(tag, obj.userData[STOREY_KEY], id), visible);
  }

  for (const obj of scene.children) {
    const tag = obj.userData.type;
    if (tag === 'wall-selection') {
      const owner = wallVisibility.get(wallDisplayKey(obj.userData.ownerTag, obj.userData.ownerStorey, obj.userData.wallId));
      if (owner !== undefined) setVisible(obj, owner);
      continue;
    }
    // A door or window (a furniture group stamped with its owner wall, #659)
    // follows that wall on its own storey: cutaway and walls-down used to
    // leave every frame standing where the wall was. With no such wall built
    // (a hidden wall, a traced ground floor) it follows the mode; a storey
    // the walkthrough hides stays hidden either way.
    if (tag !== ROOM_OBJECT_TAGS.Furniture || obj.userData.ownerTag === undefined) continue;
    const owner = wallVisibility.get(wallDisplayKey(obj.userData.ownerTag, obj.userData.floorIndex, obj.userData.wallId));
    setVisible(obj, (owner ?? mode !== 'down') && obj.userData[OFF_STOREY_KEY] !== true);
  }

  return changed;
}

export function removeTagged(scene: ThreeNS.Scene, ...tags: RoomObjectTag[]): void {
  const tagSet = new Set<string>(tags);
  const toRemove = scene.children.filter((obj) => tagSet.has(obj.userData.type as string));
  toRemove.forEach((obj) => removeAndDispose(scene, obj));
}

export interface RoomBuilderOptions {
  scene: ThreeNS.Scene;
  width: number;
  depth: number;
  floorColor: string;
  floorPattern?: FloorPattern;
  wallPattern?: WallPattern;
  wallColors?: Partial<Record<WallId, string>>;
  /** Door / window cutouts to punch through the relevant walls. */
  wallOpenings?: ReadonlyMap<ShellWallId, WallOpening[]>;
  /** The corner taken out of the footprint (#727): floor, plinth and walls follow the L. */
  cutout?: FootprintCutout | undefined;
  /** Exterior walls that have been removed (open sides). */ 
  hiddenWalls?: readonly WallId[]; 
  /** Stairwell openings to cut through this floor's plane. */
  floorOpenings?: readonly FloorOpening[];
  /** Rooms with a floor of their own (#720), laid over the slab in order. */
  zonePatches?: readonly ZoneFloorPatch[];
  floorPlanImage: string | null;
  floorPlanOpacity: number;
  floorPlanFitMode: FloorPlanFitMode;
  floorPlan3DEffect: boolean;
  /** Vertical offset for this floor (y in metres). Defaults to 0 (ground). */
  yOffset?: number;
  /** Exterior wall height — the storey height (#202). Defaults to 3 m. */
  wallHeight?: number;
  /**
   * Lowest ground around the house (#202). Below 0 the plinth reaches down
   * to it, so a house on a falling site sits on its base, not in mid-air.
   */
  groundY?: number;
  /** Opacity multiplier for stacked floors below the active one. */
  ghostOpacity?: number;
  onTextureLoaded?: () => void;
}

export function buildRoom(THREE: ThreeModule, input: RoomBuilderOptions): void {
  // The traced plan's relief needs a dense grid plane, which can't be an L.
  const options = input.cutout ? { ...input, floorPlan3DEffect: false } : input;
  const yOffset = options.yOffset ?? 0;
  const isGhost = options.ghostOpacity !== undefined && options.ghostOpacity < 1;

  const hasFloorOpenings = options.floorOpenings && options.floorOpenings.length > 0;
  const useDisplacement = options.floorPlanImage && options.floorPlan3DEffect;

  // When the floor has stairwell openings we use ShapeGeometry so we can
  // punch rectangular holes. Otherwise keep the simpler PlaneGeometry
  // (which also supports displacement subdivision for floor-plan 3D effect).
  const geometry = (hasFloorOpenings || options.cutout) && !useDisplacement
    ? buildFloorGeometryWithOpenings(THREE, options.width, options.depth, options.floorOpenings ?? [], options.cutout)
    : new THREE.PlaneGeometry(options.width, options.depth, useDisplacement ? 100 : 1, useDisplacement ? 100 : 1);

  let material: ThreeNS.Material;
  if (options.floorPlanImage) {
    material = buildFloorPlanMaterial(THREE, options, options.floorPlanImage);
  } else {
    // Note: an image-less call must NOT drop the decoded-image cache here —
    // only floor 0 carries the plan, so in a multi-floor rebuild every upper
    // floor would wipe the cache floor 0 just warmed and the multi-MB data
    // URL would re-decode on every other rebuild (#119). The caller clears
    // the cache via clearFloorPlanImageCache() when the plan is truly gone.
    material = buildFloorMaterial(THREE, {
      pattern: options.floorPattern ?? 'solid',
      color: options.floorColor,
      roomWidth: options.width,
      roomDepth: options.depth,
    });
  }

  if (isGhost) {
    material.transparent = true;
    material.opacity = options.ghostOpacity!;
  }

  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = yOffset;
  floor.receiveShadow = true;
  floor.name = 'Floor';
  floor.userData.type = ROOM_OBJECT_TAGS.Floor;
  makeStatic(floor);
  options.scene.add(floor);

  if (yOffset > 0) addFloorSlab(THREE, options, yOffset, isGhost ? options.ghostOpacity : undefined);

  // A traced ground floor is the drawing: nothing is laid over it.
  if (!options.floorPlanImage) {
    options.zonePatches?.forEach((patch) => addZoneFloorPatch(THREE, options, patch));
  }

  // Concrete foundation plinth — only on the ground floor. build-mode houses sit on
  // a low base that extends slightly past the wall plane and grounds the
  // building visually.
  if (yOffset === 0 && !options.floorPlanImage) {
    addFoundation(
      THREE, options.scene, options.width, options.depth, isGhost ? options.ghostOpacity : undefined, options.groundY, options.cutout
    );
  }

  if (!options.floorPlanImage) {
    buildWalls(
      THREE,
      options.scene,
      options.width,
      options.depth,
      options.wallColors,
      options.wallPattern,
      yOffset,
      isGhost ? options.ghostOpacity : undefined,
      options.wallOpenings,
      options.hiddenWalls,
      options.wallHeight,
      options.cutout
    );
  }
}

/**
 * Depth of an upper storey's slab under its floor (#653). Shallow enough that
 * decor hung to its clearance under the ceiling (`HUNG_CEILING_CLEARANCE`,
 * 5 cm) stays in the room below.
 */
export const FLOOR_SLAB_DEPTH = 0.04;
/** The slab stands this far inside the outer walls, so its edge can't z-fight the storey below's (#276). */
export const FLOOR_SLAB_WALL_GAP = 0.01;
/** Ceiling plaster: the slab's underside, and the walkthrough's ceiling. */
export const CEILING_PLASTER_COLOR = 0xf4f1ea;

/**
 * The slab under an upper storey's floor (#653): its underside and edges, cut
 * by the same stairwells as the floor. The floor was a plane seen only from
 * above, so from below the storey floated with the sky showing through, and
 * the sun lit the storey below through it. No top: the floor is the top, and
 * a coplanar lid would z-fight it. FrontSide, so three's shadow pass draws the
 * back faces, the underside among them: the floor's own top never shadows
 * itself, and the storey below gets the upstairs shade.
 */
function addFloorSlab(THREE: ThreeModule, options: RoomBuilderOptions, yOffset: number, ghostOpacity: number | undefined): void {
  const gap = FLOOR_SLAB_WALL_GAP;
  const shape = new THREE.Shape();
  // In the floor plate's shape space, [x, -z]; the holes are clamped inside
  // the slab's own outline, as the plate's are inside the floor's.
  footprintOutline({ width: options.width, height: options.depth, cutout: options.cutout }, -gap).forEach(({ x, z }, index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  for (const outline of floorHoleOutlines(options.width - 2 * gap, options.depth - 2 * gap, options.floorOpenings ?? [], options.cutout)) {
    const hole = new THREE.Path();
    hole.moveTo(outline[0]![0], outline[0]![1]);
    for (const [x, y] of outline.slice(1)) hole.lineTo(x, y);
    hole.closePath();
    shape.holes.push(hole);
  }
  const solid = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_SLAB_DEPTH, bevelEnabled: false });
  // Stand it up as the plinth is: shape y becomes world −z again.
  solid.rotateX(-Math.PI / 2);
  const geometry = withoutUpwardFaces(THREE, solid);

  const material = new THREE.MeshStandardMaterial({ color: CEILING_PLASTER_COLOR, roughness: 0.95 });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }
  const slab = new THREE.Mesh(geometry, material);
  slab.position.y = yOffset - FLOOR_SLAB_DEPTH;
  // A ghosted storey is translucent scenery and throws no solid shadow.
  slab.castShadow = ghostOpacity === undefined;
  slab.receiveShadow = true;
  slab.name = 'Floor slab';
  slab.userData.type = ROOM_OBJECT_TAGS.Floor;
  makeStatic(slab);
  options.scene.add(slab);
}

/** `geometry` without its upward-facing triangles: an extrusion without its lid. */
export function withoutUpwardFaces(THREE: ThreeModule, geometry: ThreeNS.BufferGeometry): ThreeNS.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = flat.getAttribute('position');
  const kept: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 2 < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);
    const normal = c.clone().sub(b).cross(a.clone().sub(b)).normalize();
    if (normal.y > 0.5) continue;
    kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  result.computeVertexNormals();
  if (flat !== geometry) flat.dispose();
  geometry.dispose();
  return result;
}

/** A zone's floor clears the slab by this much, or the two z-fight (#276). */
const ZONE_PATCH_GAP = 0.003;
/** A patch over another clears it by this much: zones can overlap. */
const ZONE_PATCH_STEP = 0.0005;
/** Stacks stop rising here, 8 mm up: under the 1 cm base of a rug. */
const ZONE_PATCH_MAX_LAYER = 10;

/**
 * One zone's floor over the slab. UVs and texture repeat are the room's, as on
 * the slab, so a tile grid runs on across the room whatever the zone's shape.
 */
function addZoneFloorPatch(THREE: ThreeModule, options: RoomBuilderOptions, patch: ZoneFloorPatch): void {
  const yOffset = options.yOffset ?? 0;
  const toPoints = (ring: readonly Vec2[]) => ring.map((point) => new THREE.Vector2(point.x, -point.z));
  const shapes = patch.regions.map((region) => {
    const shape = new THREE.Shape(toPoints(region.outline));
    for (const hole of region.holes ?? []) shape.holes.push(new THREE.Path(toPoints(hole)));
    return shape;
  });
  if (shapes.length === 0) return;
  const geometry = normalizeShapeUvs(new THREE.ShapeGeometry(shapes), options.width, options.depth);
  const material = buildFloorMaterial(THREE, { pattern: patch.pattern, color: patch.color, roomWidth: options.width, roomDepth: options.depth });
  if (options.ghostOpacity !== undefined && options.ghostOpacity < 1) {
    material.transparent = true;
    material.opacity = options.ghostOpacity;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = yOffset + ZONE_PATCH_GAP + Math.min(patch.layer, ZONE_PATCH_MAX_LAYER) * ZONE_PATCH_STEP;
  mesh.receiveShadow = true;
  mesh.name = `Floor ${patch.id}`;
  mesh.userData.type = ROOM_OBJECT_TAGS.Floor;
  makeStatic(mesh);
  options.scene.add(mesh);
}

/** How far the plinth ring reaches past the wall plane; the porch steps start beyond it (#276). */
export const FOUNDATION_OVERHANG = 0.35;
const FOUNDATION_HEIGHT = 0.25;
const FOUNDATION_COLOR = 0xb4afa3;

function addFoundation(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  width: number,
  depth: number,
  ghostOpacity?: number,
  groundY = 0,
  cutout?: FootprintCutout
): void {
  const plinthHeight = FOUNDATION_HEIGHT + Math.max(0, -groundY);
  // Hollow outline: outer perimeter minus the inner room footprint, so the
  // foundation reads as a ring around the building rather than overlapping
  // the floor mesh. Shape y is world −z, as on the floor plate; a rectangle
  // reads the same either way and keeps its long-standing triangulation.
  const building = { width, height: depth, cutout };
  const shapeY = cutout ? -1 : 1;
  const outline = new THREE.Shape();
  footprintOutline(building, FOUNDATION_OVERHANG).forEach(({ x, z }, index) => {
    if (index === 0) outline.moveTo(x, z * shapeY);
    else outline.lineTo(x, z * shapeY);
  });
  outline.closePath();
  const hole = new THREE.Path();
  footprintOutline(building).forEach(({ x, z }, index) => {
    if (index === 0) hole.moveTo(x, z * shapeY);
    else hole.lineTo(x, z * shapeY);
  });
  hole.closePath();
  outline.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: plinthHeight,
    bevelEnabled: false,
  });
  // Extrude is created along +Z. Rotate to stand up vertically.
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: FOUNDATION_COLOR,
    roughness: 0.92,
  });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }
  const foundation = new THREE.Mesh(geometry, material);
  foundation.position.y = -plinthHeight;
  foundation.receiveShadow = true;
  foundation.castShadow = true;
  foundation.name = 'Foundation';
  // Only its outer faces show, and those are outdoors (#664).
  shutOutIndoorLamps(THREE, material);
  foundation.userData.type = ROOM_OBJECT_TAGS.Floor;
  makeStatic(foundation);
  scene.add(foundation);
}

// Data-URL floor plans are multi-MB and decoding them dominates a shell
// rebuild. Cache the decoded image element (not the Texture — textures are
// disposed along with their meshes) keyed on the URL; single entry, since a
// building has one floor plan. `image` is null while the one decode is in
// flight: rebuilds that land meanwhile (opacity slider, fit mode) queue on it
// instead of starting another decode. The fitted composites sit beside it,
// one per texture role.
interface FloorPlanImageEntry {
  url: string;
  image: HTMLImageElement | null;
  waiters: Array<(image: HTMLImageElement) => void>;
  /** Called, once, if the decode fails — so an awaiting export can go on. */
  failures: Array<() => void>;
  composites: Partial<Record<FloorPlanRole, { key: string; canvas: HTMLCanvasElement }>>;
}
type FloorPlanRole = 'map' | 'displacement';

let floorPlanImageCache: FloorPlanImageEntry | null = null;

/**
 * Drop the decoded floor-plan cache. Call when the building no longer has a
 * plan (so a removed multi-MB data URL isn't retained) — not per image-less
 * buildRoom call, which would thrash the cache in multi-floor rebuilds (#119).
 */
export function clearFloorPlanImageCache(): void {
  floorPlanImageCache = null;
}

function withFloorPlanImage(
  THREE: ThreeModule,
  url: string,
  onReady: (image: HTMLImageElement) => void,
  onFail?: () => void
): void {
  if (floorPlanImageCache?.url === url) {
    if (floorPlanImageCache.image) onReady(floorPlanImageCache.image);
    else {
      floorPlanImageCache.waiters.push(onReady);
      if (onFail) floorPlanImageCache.failures.push(onFail);
    }
    return;
  }
  const entry: FloorPlanImageEntry = { url, image: null, waiters: [onReady], failures: onFail ? [onFail] : [], composites: {} };
  floorPlanImageCache = entry;
  new THREE.ImageLoader().load(
    url,
    (image) => {
      entry.image = image;
      const waiters = entry.waiters;
      entry.waiters = [];
      entry.failures = [];
      for (const waiter of waiters) waiter(image);
    },
    undefined,
    () => {
      // A broken image must not park every later rebuild's waiter forever.
      entry.waiters = [];
      const failures = entry.failures;
      entry.failures = [];
      if (floorPlanImageCache === entry) floorPlanImageCache = null;
      for (const failure of failures) failure();
    }
  );
}

/**
 * Decode the floor plan into the shared cache and resolve once it is ready
 * (null if it fails to decode). A buildRoom call made after this resolves
 * gets the plan synchronously. The GLB export awaits it (#373): the cache
 * holds one entry and is only warmed when the ground floor is on screen, so
 * an export built cold would carry the placeholder floor instead.
 */
export function loadFloorPlanImage(THREE: ThreeModule, url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => withFloorPlanImage(THREE, url, resolve, () => resolve(null)));
}

/**
 * The plan fitted to the room on an offscreen canvas that maps 1:1 onto the
 * floor, placed exactly as the 2D plan draws it. UVs outside [0,1] smeared the
 * image's border rows across the contain bands (#191). The colour map paints
 * the bands in the floor colour and blends the image over it at the plan
 * opacity, as the 2D plan does; the displacement copy is the bare fitted image
 * on black, so the bands stay flat and the relief sits under the picture (#227).
 */
function fittedFloorPlan(
  image: HTMLImageElement,
  role: FloorPlanRole,
  options: RoomBuilderOptions
): HTMLCanvasElement | HTMLImageElement {
  const roomAspect = options.width / options.depth;
  const mode = options.floorPlanFitMode;
  if (role === 'displacement' && mode === 'stretch') return image;

  const key = role === 'map'
    ? `${mode}|${roomAspect}|${options.floorColor}|${options.floorPlanOpacity}`
    : `${mode}|${roomAspect}`;
  const cache = floorPlanImageCache?.image === image ? floorPlanImageCache : null;
  const cached = cache?.composites[role];
  if (cached?.key === key) return cached.canvas;

  const { width, height, source, dest } = floorPlanCanvasLayout(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    roomAspect,
    mode
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image;
  ctx.fillStyle = role === 'map' ? options.floorColor : '#000';
  ctx.fillRect(0, 0, width, height);
  if (role === 'map') ctx.globalAlpha = options.floorPlanOpacity;
  ctx.drawImage(image, source.x, source.y, source.w, source.h, dest.x, dest.y, dest.w, dest.h);
  if (cache) cache.composites[role] = { key, canvas };
  return canvas;
}

/** A 1×1 canvas of `color`, or null outside a browser. */
function solidCanvas(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

function buildFloorPlanMaterial(
  THREE: ThreeModule,
  options: RoomBuilderOptions,
  imageUrl: string
): ThreeNS.MeshStandardMaterial {
  // Both textures start empty and receive their composite together once the
  // plan is decoded (synchronously on a warm cache). The map is sRGB like
  // every other albedo texture (#383); the displacement stays linear data.
  // Until the plan decodes the map is the floor colour: an empty texture
  // samples as black on this opaque material, a black flash on every load.
  const map = new THREE.Texture();
  const placeholder = solidCanvas(options.floorColor);
  if (placeholder) {
    map.image = placeholder;
    map.needsUpdate = true;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  withMaxAnisotropy(map);
  const displacement = options.floorPlan3DEffect ? new THREE.Texture() : null;
  for (const texture of displacement ? [map, displacement] : [map]) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  // A decode that lands after the floor was rebuilt or exported away must
  // not paint into its disposed textures. Whoever disposes the floor
  // disposes the material's current map, so the flag follows the map.
  let disposed = false;
  const onDispose = () => {
    disposed = true;
  };
  map.addEventListener('dispose', onDispose);
  let material: ThreeNS.MeshStandardMaterial | null = null;
  withFloorPlanImage(THREE, imageUrl, (image) => {
    if (disposed) return;
    const fitted = fittedFloorPlan(image, 'map', options);
    if (material && placeholder) {
      // The decode landed after the floor was built, so the placeholder may
      // already be on the GPU: three allocates immutable storage at the
      // placeholder's 1×1 size, and the plan can't be written into it (#521).
      // Swap in a fresh texture, then dispose the placeholder one.
      const previous = material.map ?? map;
      const fresh = withMaxAnisotropy(previous.clone());
      fresh.source = new THREE.TextureSource(fitted);
      fresh.needsUpdate = true;
      previous.removeEventListener('dispose', onDispose);
      fresh.addEventListener('dispose', onDispose);
      material.map = fresh;
      previous.dispose();
    } else {
      // Not drawn yet: the placeholder never reached the GPU.
      map.image = fitted;
      map.needsUpdate = true;
    }
    if (displacement) {
      // Never uploaded before this: an imageless texture stays at version 0.
      displacement.image = fittedFloorPlan(image, 'displacement', options);
      displacement.needsUpdate = true;
    }
    if (material) options.onTextureLoaded?.();
  });

  // Opaque: the plan opacity is already baked into the map over the floor
  // colour, so the 3D floor shows the same colours as the 2D plan.
  material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.8,
    metalness: 0,
    ...(displacement ? { displacementMap: displacement, displacementScale: 0.3 } : {}),
  });
  return material;
}

function buildWalls(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  width: number,
  depth: number,
  colors?: Partial<Record<WallId, string>>,
  pattern?: WallPattern,
  yOffset = 0,
  ghostOpacity?: number,
  openings?: ReadonlyMap<ShellWallId, WallOpening[]>,
  hiddenWalls?: readonly WallId[],
  wallHeight = FLOOR_HEIGHT_METERS,
  cutout?: FootprintCutout
): void {
  const centerY = yOffset + wallHeight / 2;
  const building = { width, height: depth, cutout };
  const notch = cutoutRect(building);

  const wallSpecs: ReadonlyArray<WallSpec> = shellWalls(building).map((wall) => {
    const { from, to, length } = shellWallSpan(wall);
    const alongZ = wall.side === 'east' || wall.side === 'west';
    const isNotchWall = wall.id === 'notch-x' || wall.id === 'notch-z';
    // The notch's z wall rounds the L's outer corner, so its board runs past
    // that end to meet the x wall's, where every other east/west board stops.
    const outerCorner =
      wall.id === 'notch-z' && notch && cutout
        ? alongSide(wall.side, 0, cutout.corner.startsWith('n') ? notch.z1 : notch.z0)
        : null;
    return {
      id: wall.id,
      side: wall.side,
      width: length,
      rotateY: WALL_ROTATIONS[wall.side],
      position: [(wall.x1 + wall.x2) / 2, centerY, (wall.z1 + wall.z2) / 2],
      frameOffset: (from + to) / 2,
      ...(isNotchWall ? { plane: alongZ ? wall.x1 : wall.z1 } : {}),
      ...(outerCorner !== null ? { outerEnd: outerCorner > (from + to) / 2 ? 'high' as const : 'low' as const } : {}),
    };
  });

  for (const spec of wallSpecs) {
    if (hiddenWalls?.includes(spec.side)) continue;
    const color = colors?.[spec.side] ?? DEFAULT_WALL_COLOR;
    const material = buildWallMaterial(THREE, {
      pattern: pattern ?? 'solid',
      color,
      width: spec.width,
      height: wallHeight,
      yOffset,
    });

    if (ghostOpacity !== undefined) {
      material.transparent = true;
      material.opacity *= ghostOpacity;
    }

    // Into the wall's own frame: a shortened wall's middle isn't the side's.
    const wallCutouts = (openings ? openingsForWall(openings, spec.id) : []).map((opening) =>
      spec.frameOffset === 0 ? opening : { ...opening, centerAlongWall: opening.centerAlongWall - spec.frameOffset }
    );
    const geometry = withOutsideFace(
      THREE,
      wallCutouts.length > 0
        ? buildWallGeometryWithCutouts(THREE, spec.width, wallHeight, wallCutouts)
        : new THREE.PlaneGeometry(spec.width, wallHeight)
    );
    // Single-sided, so each face keeps its own normal; see withOutsideFace.
    // The shadow pass still has to draw whichever face the light meets.
    material.side = THREE.FrontSide;
    material.shadowSide = THREE.DoubleSide;
    // The lamps indoors light the inside face only: an L's notch wall faces
    // the lamp in the other wing across the corner (#814).
    shutOutIndoorLampsOutside(THREE, material);

    const wall = new THREE.Mesh(geometry, material);
    wall.rotation.y = spec.rotateY;
    wall.position.set(spec.position[0], spec.position[1], spec.position[2]);
    wall.name = `Wall ${spec.id}`;
    wall.userData.type = ROOM_OBJECT_TAGS.Wall;
    wall.userData.wallId = spec.side;
    if (spec.plane !== undefined) {
      wall.userData[WALL_PLANE_KEY] = spec.plane;
      wall.userData[SHELL_WALL_KEY] = spec.id;
    }
    // Solid walls block the sun like the roof, foundation, and interior walls
    // already do — without this, dawn/dusk light fell on furniture straight
    // through the shell (#132). Ghosted floors (show-all-floors) are
    // translucent scenery and must not throw solid shadows.
    if (ghostOpacity === undefined) {
      wall.castShadow = true;
      wall.receiveShadow = true;
    }
    makeStatic(wall);
    scene.add(wall);

    // Dark wood baseboard along the floor of every wall — the build-mode-style
    // trim that grounds the room and hides the floor/wall seam.
    addBaseboard(THREE, scene, spec, yOffset, ghostOpacity, skirtingOpenings(wallCutouts));
    addReveals(THREE, scene, spec, color, wallHeight, ghostOpacity, wallCutouts);
  }

  if (yOffset === 0 && ghostOpacity === undefined) {
    // Match the snap grid: `snapToGrid` rounds world coordinates to multiples of
    // GRID_SIZE_METERS about the origin. A GridHelper centres its divisions on
    // the origin, so as long as each cell is exactly GRID_SIZE_METERS the drawn
    // lines coincide with the snap positions. Size up to a whole number of cells
    // that covers the room (with a little margin), then derive the divisions.
    const span = Math.max(width, depth) * 1.5;
    const divisions = Math.max(2, Math.ceil(span / GRID_SIZE_METERS));
    const size = divisions * GRID_SIZE_METERS;
    const grid = new THREE.GridHelper(size, divisions);
    // Lines and triangles rasterise depth differently, so a grid coplanar
    // with the floor z-fought through it; lift it clear (#371). It still
    // writes depth: without that, ground meshes drawn after it painted over
    // its lines outside the house.
    grid.position.y = SNAP_GRID_FLOOR_GAP;
    grid.userData.type = ROOM_OBJECT_TAGS.Wall;
    makeStatic(grid);
    scene.add(grid);
  }
}

const SNAP_GRID_FLOOR_GAP = 0.003;

/** Each side's wall mesh turned to face into the house. */
const WALL_ROTATIONS: Record<WallId, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

/** One exterior wall mesh: `side` owns its colour, visibility and tag; `id` its openings. */
interface WallSpec {
  id: ShellWallId;
  side: WallId;
  width: number;
  rotateY: number;
  position: [number, number, number];
  /** The wall's middle in its side's frame, where its openings are measured. */
  frameOffset: number;
  /** The plane of a notch wall; see WALL_PLANE_KEY. */
  plane?: number;
  /** Which end of the notch's z wall rounds the outer corner of the L. */
  outerEnd?: 'low' | 'high';
}

const BASEBOARD_COLOR = 0x4a3a2a;

/**
 * The lining of every door and window cut into this wall (#758): one mesh in
 * the wall's colour, tagged like the wall so cutaway and walls-down hide it
 * with the wall, and a shadow caster, since the shade it throws on the frame
 * is the point.
 */
function addReveals(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  spec: WallSpec,
  color: string,
  wallHeight: number,
  ghostOpacity: number | undefined,
  openings: readonly WallOpening[]
): void {
  const geometry = revealsEnabled() ? buildRevealGeometry(THREE, openings, spec.width, wallHeight) : null;
  if (!geometry) return;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }
  const lining = new THREE.Mesh(geometry, material);
  lining.rotation.y = spec.rotateY;
  lining.position.set(spec.position[0], spec.position[1], spec.position[2]);
  lining.name = `Reveal ${spec.id}`;
  lining.castShadow = ghostOpacity === undefined;
  lining.receiveShadow = true;
  lining.userData.type = ROOM_OBJECT_TAGS.Wall;
  lining.userData.wallId = spec.side;
  if (spec.plane !== undefined) {
    lining.userData[WALL_PLANE_KEY] = spec.plane;
    lining.userData[SHELL_WALL_KEY] = spec.id;
  }
  makeStatic(lining);
  scene.add(lining);
}

function addBaseboard(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  spec: WallSpec,
  yOffset: number,
  ghostOpacity: number | undefined,
  openings: readonly WallOpening[]
): void {
  const material = new THREE.MeshStandardMaterial({
    color: BASEBOARD_COLOR,
    roughness: 0.7,
  });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }

  // Sit just inside the wall plane (inward = toward the room centre), not
  // flush with it: a flush back face z-fought the double-sided wall (#201).
  const [px, , pz] = spec.position;
  const inset = BASEBOARD_DEPTH / 2 + BASEBOARD_WALL_GAP;
  const nx = spec.side === 'east' ? 1 : spec.side === 'west' ? -1 : 0;
  const nz = spec.side === 'south' ? 1 : spec.side === 'north' ? -1 : 0;
  // The wall-local +x axis in world space, for placing runs along the wall.
  const ax = Math.cos(spec.rotateY);
  const az = -Math.sin(spec.rotateY);

  // North/south boards run the full width; east/west boards stop at the
  // north/south boards' inner faces instead of overlapping them at the
  // corners (#201).
  const endTrim = spec.side === 'east' || spec.side === 'west' ? BASEBOARD_DEPTH + BASEBOARD_WALL_GAP : 0;
  const half = spec.width / 2;
  const lowEnd = -half + (spec.outerEnd === 'low' ? -endTrim : endTrim);
  const highEnd = half + (spec.outerEnd === 'high' ? endTrim : -endTrim);
  for (const [from, to] of baseboardRuns(lowEnd, highEnd, openings)) {
    const mid = (from + to) / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(to - from, BASEBOARD_HEIGHT, BASEBOARD_DEPTH), material);
    base.rotation.y = spec.rotateY;
    base.position.set(px - nx * inset + ax * mid, yOffset + BASEBOARD_HEIGHT / 2, pz - nz * inset + az * mid);
    base.receiveShadow = true;
    base.castShadow = ghostOpacity === undefined;
    base.name = `Baseboard ${spec.id}`;
    base.userData.type = ROOM_OBJECT_TAGS.Wall;
    base.userData.wallId = spec.side;
    if (spec.plane !== undefined) {
      base.userData[WALL_PLANE_KEY] = spec.plane;
      base.userData[SHELL_WALL_KEY] = spec.id;
    }
    makeStatic(base);
    scene.add(base);
  }
}

/**
 * ShapeGeometry emits UVs equal to the raw shape vertex coordinates, while the
 * pattern materials calibrate `texture.repeat` for PlaneGeometry's [0,1] UV
 * span — feeding one into the other multiplies the tiling by the shape's size
 * (#125). Rescale an origin-centred span×span shape to the plane convention so
 * both geometry types tile identically.
 */
function normalizeShapeUvs(
  geometry: ThreeNS.BufferGeometry,
  spanX: number,
  spanY: number
): ThreeNS.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / spanX + 0.5, uv.getY(i) / spanY + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}

function buildWallGeometryWithCutouts(
  THREE: ThreeModule,
  wallWidth: number,
  wallHeight: number,
  cutouts: readonly WallOpening[]
): ThreeNS.BufferGeometry {
  const halfW = wallWidth / 2;
  const halfH = wallHeight / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-halfW, -halfH);
  shape.lineTo(halfW, -halfH);
  shape.lineTo(halfW, halfH);
  shape.lineTo(-halfW, halfH);
  shape.closePath();

  // Merge overlapping cutouts before building holes — overlapping holes are
  // illegal for earcut and produce phantom fill / self-intersecting triangles.
  const rects = cutouts.map(
    (c) =>
      [
        c.centerAlongWall - c.width / 2,
        -halfH + c.bottomFromFloor,
        c.centerAlongWall + c.width / 2,
        -halfH + c.bottomFromFloor + c.height,
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

  return normalizeShapeUvs(new THREE.ShapeGeometry(shape), wallWidth, wallHeight);
}

/**
 * Build a floor plane with rectangular holes cut out for stairwells.
 * The geometry lies in the XY plane (like PlaneGeometry) and must be
 * rotated -90° on X to become horizontal.
 */
export function buildFloorGeometryWithOpenings(
  THREE: ThreeModule,
  roomWidth: number,
  roomDepth: number,
  openings: readonly FloorOpening[],
  cutout?: FootprintCutout
): ThreeNS.BufferGeometry {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  // ShapeGeometry lives in XY — after rotation X maps to world X, Y maps
  // to world Z (negated by the -90° rotation), so we use depth as the Y
  // axis of the shape.
  const shape = new THREE.Shape();
  if (cutout) {
    footprintOutline({ width: roomWidth, height: roomDepth, cutout }).forEach(({ x, z }, index) => {
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
  } else {
    shape.moveTo(-halfW, -halfD);
    shape.lineTo(halfW, -halfD);
    shape.lineTo(halfW, halfD);
    shape.lineTo(-halfW, halfD);
  }
  shape.closePath();

  for (const outline of floorHoleOutlines(roomWidth, roomDepth, openings, cutout)) {
    const hole = new THREE.Path();
    hole.moveTo(outline[0]![0], outline[0]![1]);
    for (const [x, y] of outline.slice(1)) hole.lineTo(x, y);
    hole.closePath();
    shape.holes.push(hole);
  }

  return normalizeShapeUvs(new THREE.ShapeGeometry(shape), roomWidth, roomDepth);
}

/** Re-exported for the walkthrough shafts and older importers; it lives in lib now (#559). */
export { floorHoleOutlines };
