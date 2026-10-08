import { GRID_SIZE_METERS } from '../lib/constants';
import { floorPlanCanvasLayout } from '../lib/floor-plan-fit';
import { FLOOR_HEIGHT_METERS } from '../lib/types';
import { BASEBOARD_DEPTH, BASEBOARD_HEIGHT, BASEBOARD_WALL_GAP, baseboardRuns } from './baseboard';
import { removeAndDispose } from './builder-utils';
import { buildFloorMaterial } from './floor-patterns';
import { getMaxAnisotropy } from './texture-settings';
import { mergeHoleRects, openingsForWall, type FloorOpening, type WallOpening } from './wall-openings';
import { buildWallMaterial } from './wall-patterns';
import type { FloorPattern, FloorPlanFitMode, WallId, WallPattern } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

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
  // Owner visibility by "tag:wallId", for the outline sync pass below.
  const wallVisibility = new Map<string, boolean>();

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (tag === 'roof') {
      // Roof only shows in "up" mode — cutaway and down both want the
      // interior visible from above.
      setVisible(obj, mode === 'up');
      continue;
    }
    if (tag === 'interior-wall') {
      const visible = mode !== 'down';
      setVisible(obj, visible);
      const id = obj.userData.wallId as string | undefined;
      if (id) wallVisibility.set(`interior-wall:${id}`, visible);
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
        case 'north': nz = -1; cz = -halfD; break;
        case 'south': nz =  1; cz =  halfD; break;
        case 'east':  nx =  1; cx =  halfW; break;
        case 'west':  nx = -1; cx = -halfW; break;
      }
      const dot = (cameraX - cx) * nx + (cameraZ - cz) * nz;
      visible = dot < 0;
    }
    setVisible(obj, visible);
    wallVisibility.set(`${ROOM_OBJECT_TAGS.Wall}:${wallId}`, visible);
  }

  for (const obj of scene.children) {
    if (obj.userData.type !== 'wall-selection') continue;
    const owner = wallVisibility.get(`${obj.userData.ownerTag as string}:${obj.userData.wallId as string}`);
    if (owner !== undefined) setVisible(obj, owner);
  }

  return changed;
}

// Warm cream — build-mode build mode walls read as tan/cream by default, never
// the neutral mid-grey we used to fall back to.
const DEFAULT_WALL_COLOR = 0xe8dcc4;

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
  wallOpenings?: ReadonlyMap<WallId, WallOpening[]>;
  /** Exterior walls that have been removed (open sides). */ 
  hiddenWalls?: readonly WallId[]; 
  /** Stairwell openings to cut through this floor's plane. */
  floorOpenings?: readonly FloorOpening[];
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

export function buildRoom(THREE: ThreeModule, options: RoomBuilderOptions): void {
  const yOffset = options.yOffset ?? 0;
  const isGhost = options.ghostOpacity !== undefined && options.ghostOpacity < 1;

  const hasFloorOpenings = options.floorOpenings && options.floorOpenings.length > 0;
  const useDisplacement = options.floorPlanImage && options.floorPlan3DEffect;

  // When the floor has stairwell openings we use ShapeGeometry so we can
  // punch rectangular holes. Otherwise keep the simpler PlaneGeometry
  // (which also supports displacement subdivision for floor-plan 3D effect).
  const geometry = hasFloorOpenings && !useDisplacement
    ? buildFloorGeometryWithOpenings(THREE, options.width, options.depth, options.floorOpenings!)
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
  floor.userData.type = ROOM_OBJECT_TAGS.Floor;
  makeStatic(floor);
  options.scene.add(floor);

  // Concrete foundation plinth — only on the ground floor. build-mode houses sit on
  // a low base that extends slightly past the wall plane and grounds the
  // building visually.
  if (yOffset === 0 && !options.floorPlanImage) {
    addFoundation(
      THREE, options.scene, options.width, options.depth, isGhost ? options.ghostOpacity : undefined, options.groundY
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
      options.wallHeight
    );
  }
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
  groundY = 0
): void {
  const plinthHeight = FOUNDATION_HEIGHT + Math.max(0, -groundY);
  const outerW = width + FOUNDATION_OVERHANG * 2;
  const outerD = depth + FOUNDATION_OVERHANG * 2;
  // Hollow rectangle: outer perimeter minus the inner room footprint, so the
  // foundation reads as a ring around the building rather than overlapping
  // the floor mesh.
  const outline = new THREE.Shape();
  outline.moveTo(-outerW / 2, -outerD / 2);
  outline.lineTo(outerW / 2, -outerD / 2);
  outline.lineTo(outerW / 2, outerD / 2);
  outline.lineTo(-outerW / 2, outerD / 2);
  outline.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-width / 2, -depth / 2);
  hole.lineTo(width / 2, -depth / 2);
  hole.lineTo(width / 2, depth / 2);
  hole.lineTo(-width / 2, depth / 2);
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

function withFloorPlanImage(THREE: ThreeModule, url: string, onReady: (image: HTMLImageElement) => void): void {
  if (floorPlanImageCache?.url === url) {
    if (floorPlanImageCache.image) onReady(floorPlanImageCache.image);
    else floorPlanImageCache.waiters.push(onReady);
    return;
  }
  const entry: FloorPlanImageEntry = { url, image: null, waiters: [onReady], composites: {} };
  floorPlanImageCache = entry;
  new THREE.ImageLoader().load(
    url,
    (image) => {
      entry.image = image;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const waiter of waiters) waiter(image);
    },
    undefined,
    () => {
      // A broken image must not park every later rebuild's waiter forever.
      entry.waiters = [];
      if (floorPlanImageCache === entry) floorPlanImageCache = null;
    }
  );
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

function buildFloorPlanMaterial(
  THREE: ThreeModule,
  options: RoomBuilderOptions,
  imageUrl: string
): ThreeNS.MeshStandardMaterial {
  // Both textures start empty and receive their composite together once the
  // plan is decoded (synchronously on a warm cache). The map is sRGB like
  // every other albedo texture (#383); the displacement stays linear data.
  const map = new THREE.Texture();
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = getMaxAnisotropy();
  const displacement = options.floorPlan3DEffect ? new THREE.Texture() : null;
  for (const texture of displacement ? [map, displacement] : [map]) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  let decoding = false;
  withFloorPlanImage(THREE, imageUrl, (image) => {
    map.image = fittedFloorPlan(image, 'map', options);
    map.needsUpdate = true;
    if (displacement) {
      displacement.image = fittedFloorPlan(image, 'displacement', options);
      displacement.needsUpdate = true;
    }
    if (decoding) options.onTextureLoaded?.();
  });
  decoding = true;

  // Opaque: the plan opacity is already baked into the map over the floor
  // colour, so the 3D floor shows the same colours as the 2D plan.
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.8,
    metalness: 0.2,
    ...(displacement ? { displacementMap: displacement, displacementScale: 0.3 } : {}),
  });
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
  openings?: ReadonlyMap<WallId, WallOpening[]>,
  hiddenWalls?: readonly WallId[],
  wallHeight = FLOOR_HEIGHT_METERS
): void {
  const centerY = yOffset + wallHeight / 2;

  const wallSpecs: ReadonlyArray<{
    id: WallId;
    width: number;
    rotateY: number;
    position: [number, number, number];
  }> = [
    { id: 'north', width, rotateY: 0, position: [0, centerY, -depth / 2] },
    { id: 'south', width, rotateY: Math.PI, position: [0, centerY, depth / 2] },
    { id: 'west', width: depth, rotateY: Math.PI / 2, position: [-width / 2, centerY, 0] },
    { id: 'east', width: depth, rotateY: -Math.PI / 2, position: [width / 2, centerY, 0] },
  ];

  for (const spec of wallSpecs) {
    if (hiddenWalls?.includes(spec.id)) continue;
    const color = colors?.[spec.id] ?? hexFromInt(DEFAULT_WALL_COLOR);
    const material = buildWallMaterial(THREE, {
      pattern: pattern ?? 'solid',
      color,
      width: spec.width,
      height: wallHeight,
    });

    if (ghostOpacity !== undefined) {
      material.transparent = true;
      material.opacity *= ghostOpacity;
    }

    const wallCutouts = openings ? openingsForWall(openings, spec.id) : [];
    const geometry =
      wallCutouts.length > 0
        ? buildWallGeometryWithCutouts(THREE, spec.width, wallHeight, wallCutouts)
        : new THREE.PlaneGeometry(spec.width, wallHeight);

    const wall = new THREE.Mesh(geometry, material);
    wall.rotation.y = spec.rotateY;
    wall.position.set(spec.position[0], spec.position[1], spec.position[2]);
    wall.userData.type = ROOM_OBJECT_TAGS.Wall;
    wall.userData.wallId = spec.id;
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
    addBaseboard(THREE, scene, spec, yOffset, ghostOpacity, wallCutouts);
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
    // with the floor z-fought through it; lift it clear and keep it out of
    // the depth buffer (#371).
    grid.position.y = SNAP_GRID_FLOOR_GAP;
    grid.material.depthWrite = false;
    grid.userData.type = ROOM_OBJECT_TAGS.Wall;
    makeStatic(grid);
    scene.add(grid);
  }
}

const SNAP_GRID_FLOOR_GAP = 0.003;

const BASEBOARD_COLOR = 0x4a3a2a;

function addBaseboard(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  spec: { id: WallId; width: number; rotateY: number; position: readonly [number, number, number] },
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
  const radial = Math.hypot(px, pz);
  const inset = BASEBOARD_DEPTH / 2 + BASEBOARD_WALL_GAP;
  const nx = radial > 0.001 ? px / radial : 0;
  const nz = radial > 0.001 ? pz / radial : 0;
  // The wall-local +x axis in world space, for placing runs along the wall.
  const ax = Math.cos(spec.rotateY);
  const az = -Math.sin(spec.rotateY);

  // North/south boards run the full width; east/west boards stop at the
  // north/south boards' inner faces instead of overlapping them at the
  // corners (#201).
  const endTrim = spec.id === 'east' || spec.id === 'west' ? BASEBOARD_DEPTH + BASEBOARD_WALL_GAP : 0;
  const half = spec.width / 2;
  for (const [from, to] of baseboardRuns(-half + endTrim, half - endTrim, openings)) {
    const mid = (from + to) / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(to - from, BASEBOARD_HEIGHT, BASEBOARD_DEPTH), material);
    base.rotation.y = spec.rotateY;
    base.position.set(px - nx * inset + ax * mid, yOffset + BASEBOARD_HEIGHT / 2, pz - nz * inset + az * mid);
    base.receiveShadow = true;
    base.castShadow = ghostOpacity === undefined;
    base.userData.type = ROOM_OBJECT_TAGS.Wall;
    base.userData.wallId = spec.id;
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
function buildFloorGeometryWithOpenings(
  THREE: ThreeModule,
  roomWidth: number,
  roomDepth: number,
  openings: readonly FloorOpening[]
): ThreeNS.BufferGeometry {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  // ShapeGeometry lives in XY — after rotation X maps to world X, Y maps
  // to world Z (negated by the -90° rotation), so we use depth as the Y
  // axis of the shape.
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, -halfD);
  shape.lineTo(halfW, -halfD);
  shape.lineTo(halfW, halfD);
  shape.lineTo(-halfW, halfD);
  shape.closePath();

  // The -90° X rotation maps shape-Y to world -Z, so negate Z below.
  //
  // Split openings by whether they're axis-aligned (rotation a multiple of 90°)
  // or genuinely rotated. Axis-aligned holes go through mergeHoleRects so two
  // stacked stairwells fuse into one clean rectangle (overlapping holes are
  // illegal for earcut). Rotated holes are cut as individual rotated rectangles
  // matching the stairs' footprint — no over-inflated AABB, so no corner gaps.
  const axisAligned: FloorOpening[] = [];
  const rotated: FloorOpening[] = [];
  const outlined: FloorOpening[] = [];
  for (const o of openings) {
    if (o.outline) outlined.push(o);
    else (isAxisAlignedRotation(o.rotation) ? axisAligned : rotated).push(o);
  }

  // Clamp every hole inside the floor contour, inset by an epsilon: a hole
  // crossing — or even sharing an edge with — the outer ring is illegal for
  // earcut and produces phantom fill on the floor above (#146). Stairs can
  // legally sit at (or past) the room edge, so this is reachable.
  const HOLE_INSET = 0.001;
  const clampX = (v: number) => Math.min(halfW - HOLE_INSET, Math.max(-halfW + HOLE_INSET, v));
  const clampY = (v: number) => Math.min(halfD - HOLE_INSET, Math.max(-halfD + HOLE_INSET, v));
  const rects: Array<[number, number, number, number]> = [];
  for (const o of axisAligned) {
    // At 90°/270° the footprint's width and depth swap in world space.
    const swap = Math.abs(Math.sin(o.rotation)) > 0.5;
    const worldW = swap ? o.depth : o.width;
    const worldD = swap ? o.width : o.depth;
    const x0 = clampX(o.centerX - worldW / 2);
    const y0 = clampY(-(o.centerZ + worldD / 2));
    const x1 = clampX(o.centerX + worldW / 2);
    const y1 = clampY(-(o.centerZ - worldD / 2));
    if (x1 - x0 > 0 && y1 - y0 > 0) rects.push([x0, y0, x1, y1]);
  }
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

  for (const o of rotated) {
    if (o.width <= 0 || o.depth <= 0) continue;
    // Rotate the footprint corners about the opening centre. rotation.y turns
    // local +X toward world -Z, so a world-space point is
    // (cx + lx·cos + lz·sin, cz - lx·sin + lz·cos); shape-Y is world -Z.
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    const hw = o.width / 2;
    const hd = o.depth / 2;
    const localCorners: Array<[number, number]> = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    const corners: Array<[number, number]> = localCorners.map(([lx, lz]) => {
      const worldX = o.centerX + lx * cos + lz * sin;
      const worldZ = o.centerZ - lx * sin + lz * cos;
      return [worldX, -worldZ];
    });
    // A rotated hole with any corner outside the contour falls back to its
    // clamped AABB — a slightly larger hole beats corrupt triangulation (#146).
    if (corners.some(([x, y]) => x <= -halfW || x >= halfW || y <= -halfD || y >= halfD)) {
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const x0 = clampX(Math.min(...xs));
      const x1 = clampX(Math.max(...xs));
      const y0 = clampY(Math.min(...ys));
      const y1 = clampY(Math.max(...ys));
      if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
      const aabb = new THREE.Path();
      aabb.moveTo(x0, y0);
      aabb.lineTo(x1, y0);
      aabb.lineTo(x1, y1);
      aabb.lineTo(x0, y1);
      aabb.closePath();
      shape.holes.push(aabb);
      continue;
    }
    const hole = new THREE.Path();
    hole.moveTo(corners[0]![0], corners[0]![1]);
    hole.lineTo(corners[1]![0], corners[1]![1]);
    hole.lineTo(corners[2]![0], corners[2]![1]);
    hole.lineTo(corners[3]![0], corners[3]![1]);
    hole.closePath();
    shape.holes.push(hole);
  }

  // Outlined holes (a winder's L, #205): cut as given, or — if any corner
  // crosses the floor outline — as their clamped bounding box, like rotated
  // holes above (#146).
  for (const o of outlined) {
    const points = o.outline!.map(([x, z]): [number, number] => [x, -z]);
    if (points.some(([x, y]) => x <= -halfW || x >= halfW || y <= -halfD || y >= halfD)) {
      const x0 = clampX(Math.min(...points.map(([x]) => x)));
      const x1 = clampX(Math.max(...points.map(([x]) => x)));
      const y0 = clampY(Math.min(...points.map(([, y]) => y)));
      const y1 = clampY(Math.max(...points.map(([, y]) => y)));
      if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
      const box = new THREE.Path();
      box.moveTo(x0, y0);
      box.lineTo(x1, y0);
      box.lineTo(x1, y1);
      box.lineTo(x0, y1);
      box.closePath();
      shape.holes.push(box);
      continue;
    }
    const hole = new THREE.Path();
    hole.moveTo(points[0]![0], points[0]![1]);
    for (const [x, y] of points.slice(1)) hole.lineTo(x, y);
    hole.closePath();
    shape.holes.push(hole);
  }

  return normalizeShapeUvs(new THREE.ShapeGeometry(shape), roomWidth, roomDepth);
}

/**
 * True when a rotation is (within a small tolerance) a multiple of 90°, so the
 * footprint stays axis-aligned in world space and can be cut — and merged with
 * neighbours — as an ordinary AABB rectangle.
 */
function isAxisAlignedRotation(rotation: number): boolean {
  const twist = Math.abs(Math.sin(2 * rotation));
  return twist < 1e-3;
}

function hexFromInt(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
