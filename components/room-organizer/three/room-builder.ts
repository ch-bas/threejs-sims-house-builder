import type * as ThreeNS from 'three';
import { buildFloorMaterial } from './floor-patterns';
import { buildWallMaterial } from './wall-patterns';
import { openingsForWall, type FloorOpening, type WallOpening } from './wall-openings';
import type { FloorPattern, FloorPlanFitMode, WallId, WallPattern } from '../lib/types';

type ThreeModule = typeof import('three');

export const ROOM_OBJECT_TAGS = {
  Floor: 'floor',
  Wall: 'wall',
  Furniture: 'furniture',
  Signal: 'wifi-signal',
} as const;

export type RoomObjectTag = (typeof ROOM_OBJECT_TAGS)[keyof typeof ROOM_OBJECT_TAGS];

export type WallDisplay = 'up' | 'cutaway' | 'down';

/**
 * build-mode-style wall cutaway. Reads the active wall-display mode + the camera
 * position and toggles each tagged wall (and the roof) `.visible` so the
 * user sees the interior from any angle without ghostly translucency.
 *
 * Call this once after rebuilding walls, and again on every orbit-controls
 * change — visibility is cheap to flip, no geometry rebuild required.
 */
export function applyWallDisplay(
  scene: ThreeNS.Scene,
  cameraX: number,
  cameraZ: number,
  mode: WallDisplay,
  roomWidth: number,
  roomDepth: number
): void {
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  for (const obj of scene.children) {
    const tag = obj.userData.type as string | undefined;
    if (tag === 'roof') {
      // Roof only shows in "up" mode — cutaway and down both want the
      // interior visible from above.
      obj.visible = mode === 'up';
      continue;
    }
    if (tag === 'interior-wall') {
      obj.visible = mode !== 'down';
      continue;
    }
    if (tag !== ROOM_OBJECT_TAGS.Wall) continue;

    if (mode === 'down') {
      obj.visible = false;
      continue;
    }
    if (mode === 'up') {
      obj.visible = true;
      continue;
    }

    // Cutaway: hide the wall if the camera is on its outer side.
    const wallId = obj.userData.wallId as WallId | undefined;
    if (!wallId) {
      // Items without an id (e.g. the GridHelper) stay visible.
      obj.visible = true;
      continue;
    }

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
    obj.visible = dot < 0;
  }
}

// Warm cream — build-mode build mode walls read as tan/cream by default, never
// the neutral mid-grey we used to fall back to.
const DEFAULT_WALL_COLOR = 0xe8dcc4;

export function removeTagged(scene: ThreeNS.Scene, ...tags: RoomObjectTag[]): void {
  const tagSet = new Set<string>(tags);
  const toRemove = scene.children.filter((obj) => tagSet.has(obj.userData.type as string));
  toRemove.forEach((obj) => scene.remove(obj));
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
  /** Stairwell openings to cut through this floor's plane. */
  floorOpenings?: readonly FloorOpening[];
  floorPlanImage: string | null;
  floorPlanOpacity: number;
  floorPlanFitMode: FloorPlanFitMode;
  floorPlan3DEffect: boolean;
  /** Vertical offset for this floor (y in metres). Defaults to 0 (ground). */
  yOffset?: number;
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

  const material = options.floorPlanImage
    ? buildFloorPlanMaterial(THREE, options, options.floorPlanImage)
    : buildFloorMaterial(THREE, {
        pattern: options.floorPattern ?? 'solid',
        color: options.floorColor,
        roomWidth: options.width,
        roomDepth: options.depth,
      });

  if (isGhost) {
    material.transparent = true;
    material.opacity = options.ghostOpacity!;
  }

  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = yOffset;
  floor.receiveShadow = true;
  floor.userData.type = ROOM_OBJECT_TAGS.Floor;
  options.scene.add(floor);

  // Concrete foundation plinth — only on the ground floor. build-mode houses sit on
  // a low base that extends slightly past the wall plane and grounds the
  // building visually.
  if (yOffset === 0 && !options.floorPlanImage) {
    addFoundation(THREE, options.scene, options.width, options.depth, isGhost ? options.ghostOpacity : undefined);
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
      options.wallOpenings
    );
  }
}

const FOUNDATION_OVERHANG = 0.35;
const FOUNDATION_HEIGHT = 0.25;
const FOUNDATION_COLOR = 0xb4afa3;

function addFoundation(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  width: number,
  depth: number,
  ghostOpacity?: number
): void {
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
    depth: FOUNDATION_HEIGHT,
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
  foundation.position.y = -FOUNDATION_HEIGHT;
  foundation.receiveShadow = true;
  foundation.castShadow = true;
  foundation.userData.type = ROOM_OBJECT_TAGS.Floor;
  scene.add(foundation);
}

function buildFloorPlanMaterial(
  THREE: ThreeModule,
  options: RoomBuilderOptions,
  imageUrl: string
): ThreeNS.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(imageUrl, (loaded) => {
    fitTextureToRoom(loaded, options.width, options.depth, options.floorPlanFitMode);
    options.onTextureLoaded?.();
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const params: ThreeNS.MeshStandardMaterialParameters = {
    map: texture,
    transparent: true,
    opacity: options.floorPlanOpacity,
    roughness: 0.8,
    metalness: 0.2,
  };

  if (options.floorPlan3DEffect) {
    const displacement = loader.load(imageUrl);
    displacement.wrapS = THREE.ClampToEdgeWrapping;
    displacement.wrapT = THREE.ClampToEdgeWrapping;
    params.displacementMap = displacement;
    params.displacementScale = 0.3;
  }

  return new THREE.MeshStandardMaterial(params);
}

function fitTextureToRoom(
  texture: ThreeNS.Texture,
  roomWidth: number,
  roomDepth: number,
  mode: FloorPlanFitMode
): void {
  const image = texture.image as HTMLImageElement | undefined;
  if (!image) return;

  const imageAspect = image.width / image.height;
  const roomAspect = roomWidth / roomDepth;

  if (mode === 'stretch') {
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    return;
  }

  const wider = imageAspect > roomAspect;
  if (mode === 'cover') {
    const scale = wider ? roomAspect / imageAspect : imageAspect / roomAspect;
    if (wider) {
      texture.repeat.set(scale, 1);
      texture.offset.set((1 - scale) / 2, 0);
    } else {
      texture.repeat.set(1, scale);
      texture.offset.set(0, (1 - scale) / 2);
    }
    return;
  }

  const scale = wider ? imageAspect / roomAspect : roomAspect / imageAspect;
  if (wider) {
    texture.repeat.set(1, scale);
    texture.offset.set(0, (1 - scale) / 2);
  } else {
    texture.repeat.set(scale, 1);
    texture.offset.set((1 - scale) / 2, 0);
  }
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
  openings?: ReadonlyMap<WallId, WallOpening[]>
): void {
  const wallHeight = 3;
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
    scene.add(wall);

    // Dark wood baseboard along the floor of every wall — the build-mode-style
    // trim that grounds the room and hides the floor/wall seam. Solid
    // (non-translucent) so the room reads as a real building from outside.
    addBaseboard(THREE, scene, spec, yOffset, ghostOpacity);
  }

  if (yOffset === 0 && ghostOpacity === undefined) {
    const grid = new THREE.GridHelper(Math.max(width, depth) * 1.5, 20);
    grid.userData.type = ROOM_OBJECT_TAGS.Wall;
    scene.add(grid);
  }
}

const BASEBOARD_HEIGHT = 0.12;
const BASEBOARD_DEPTH = 0.04;
const BASEBOARD_COLOR = 0x4a3a2a;

function addBaseboard(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  spec: { id: WallId; width: number; rotateY: number; position: readonly [number, number, number] },
  yOffset: number,
  ghostOpacity?: number
): void {
  const material = new THREE.MeshStandardMaterial({
    color: BASEBOARD_COLOR,
    roughness: 0.7,
  });
  if (ghostOpacity !== undefined) {
    material.transparent = true;
    material.opacity = ghostOpacity;
  }
  const geometry = new THREE.BoxGeometry(spec.width, BASEBOARD_HEIGHT, BASEBOARD_DEPTH);
  const base = new THREE.Mesh(geometry, material);
  base.rotation.y = spec.rotateY;
  // Baseboards offset slightly inward (toward room centre) so they're flush
  // with the inside face of the wall. The wall's outward normal points away
  // from origin, so push along the negative of (position.xz / |position.xz|).
  const [px, , pz] = spec.position;
  const radial = Math.hypot(px, pz);
  if (radial > 0.001) {
    const inset = BASEBOARD_DEPTH / 2;
    const nx = px / radial;
    const nz = pz / radial;
    base.position.set(px - nx * inset, yOffset + BASEBOARD_HEIGHT / 2, pz - nz * inset);
  } else {
    base.position.set(px, yOffset + BASEBOARD_HEIGHT / 2, pz);
  }
  base.receiveShadow = true;
  base.userData.type = ROOM_OBJECT_TAGS.Wall;
  base.userData.wallId = spec.id;
  scene.add(base);
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

  for (const cutout of cutouts) {
    const x0 = cutout.centerAlongWall - cutout.width / 2;
    const x1 = cutout.centerAlongWall + cutout.width / 2;
    const y0 = -halfH + cutout.bottomFromFloor;
    const y1 = y0 + cutout.height;

    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ShapeGeometry(shape);
  return geometry;
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

  for (const opening of openings) {
    const x0 = opening.centerX - opening.width / 2;
    const x1 = opening.centerX + opening.width / 2;
    // The -90° X rotation maps shape-Y to world -Z, so negate Z.
    const y0 = -(opening.centerZ + opening.depth / 2);
    const y1 = -(opening.centerZ - opening.depth / 2);

    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  return new THREE.ShapeGeometry(shape);
}

function hexFromInt(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
