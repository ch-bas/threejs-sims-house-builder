import { DEFAULT_FLOOR_PLAN_OPACITY } from '../lib/constants';
import { floorKeepOut } from '../lib/floor-keep-out';
import { gardenGroundY, lowestGround } from '../lib/site';
import { buildingHeight, floorElevation, interiorWallHeight, itemForStorey, storeyHeight, underRoof } from '../lib/storeys';
import { ENTRANCE_WALL_ID, entranceGeometry, entranceWallCut } from '../lib/street';
import { zoneFloorPatches } from '../lib/zones';
import { disposeObject } from './builder-utils';
import { buildEntrance } from './entrance';
import { createFurnitureModel } from './furniture-builders';
import { stripDetailMaps } from './furniture-materials';
import { renderInteriorWalls } from './interior-walls';
import { OUTSIDE_FACE_ATTRIBUTE } from './outdoor-lamps';
import { revealSetbacks } from './reveals';
import { buildRoof, gableWallsOf } from './roof';
import { ROOM_OBJECT_TAGS, buildRoom, loadFloorPlanImage } from './room-builder';
import { stripRelief } from './surface-maps';
import { classifyOpeningOwners, computeFloorOpenings, computeWallOpenings } from './wall-openings';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Load what `buildExportBuilding` reads asynchronously, so the build that
 * follows is complete: the traced floor plan, which buildRoom would
 * otherwise paint in after the export has been written and disposed.
 */
export async function prepareExportBuilding(THREE: ThreeModule, layout: RoomLayout): Promise<void> {
  if (layout.floorPlanImage) await loadFloorPlanImage(THREE, layout.floorPlanImage);
}

/**
 * The whole building as a standalone graph for the GLB export (#373): every
 * storey's shell, interior walls and furniture, and the roof with its
 * dormers, built from the layout rather than cloned from the live scene. The
 * live scene only holds what the view shows (the active storey, the walls
 * the cutaway left up, the roof in "Up" mode, ghosted storeys in "All
 * floors"); this is the building whatever the view.
 *
 * Built with the same builders and inputs as the scene effects, but solid
 * (no ghosting), uncut, untinted (no collision red) and never added to the
 * live scene. Editor aids — the snap grid — are left out; so are the
 * site and scenery (ground, terrain, neighbours), lights and overlays.
 *
 * Nodes are named: the root after the house, one group per storey after the
 * floor, furniture after the item, and the shell parts by their builders.
 * The caller owns the result and frees it with `disposeObject`.
 */
export function buildExportBuilding(THREE: ThreeModule, layout: RoomLayout): ThreeNS.Group {
  const root = new THREE.Group();
  root.name = layout.name.trim() || 'House';
  const width = layout.width;
  const depth = layout.height;
  const { cutout } = layout;

  const entrance = layout.entrance
    ? entranceGeometry(layout.entrance, {
        width,
        depth,
        cutout,
        floors: layout.floors,
        ...(layout.terrain ? { terrain: layout.terrain } : {}),
      })
    : null;

  layout.floors.forEach((floor, index) => {
    // The builders add to a Scene; build into a scratch one and move the
    // parts into the storey's group (their transforms are world-space and
    // the group sits at the origin).
    const scratch = new THREE.Scene();
    const floorY = floorElevation(layout.floors, index);
    const storeyH = storeyHeight(floor);

    // Shell, as the shell effect builds it.
    const wallOpenings = computeWallOpenings(floor.items, width, depth, storeyH, floor.interiorWalls ?? [], cutout);
    const entranceCut = entrance ? entranceWallCut(entrance, layout.floors, index) : null;
    if (entranceCut) {
      wallOpenings.set('north', [...(wallOpenings.get('north') ?? []), { id: 'entrance', ...entranceCut }]);
    }
    buildRoom(THREE, {
      scene: scratch,
      width,
      depth,
      cutout,
      floorColor: floor.floorColor,
      ...(floor.floorPattern ? { floorPattern: floor.floorPattern } : {}),
      ...(floor.wallPattern ? { wallPattern: floor.wallPattern } : {}),
      ...(floor.wallColors ? { wallColors: floor.wallColors } : {}),
      wallOpenings,
      ...(floor.hiddenWalls ? { hiddenWalls: floor.hiddenWalls } : {}),
      floorOpenings: computeFloorOpenings(index > 0 ? layout.floors[index - 1] : undefined),
      zonePatches: zoneFloorPatches(floor, floorKeepOut(layout, index)),
      floorPlanImage: index === 0 ? layout.floorPlanImage ?? null : null,
      floorPlanOpacity: layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY,
      floorPlanFitMode: layout.floorPlanFitMode ?? 'stretch',
      // The relief is a view effect; the file gets the flat plan.
      floorPlan3DEffect: false,
      yOffset: floorY,
      wallHeight: storeyH,
      groundY: lowestGround(layout.terrain),
    });
    const tracedGround = index === 0 && !!layout.floorPlanImage;
    if (entrance && index === entrance.floorIndex && !tracedGround) {
      const northHidden = floor.hiddenWalls?.includes('north') ?? false;
      for (const group of buildEntrance(THREE, {
        geometry: entrance,
        wallColor: floor.wallColors?.north ?? '#e8dcc4',
        wallTag: ROOM_OBJECT_TAGS.Wall,
        floorTag: ROOM_OBJECT_TAGS.Floor,
      })) {
        if (northHidden && group.userData.wallId === 'north') disposeObject(group);
        else scratch.add(group);
      }
    }

    // Interior walls, as the interior-wall effect builds them.
    const walls = floor.interiorWalls ?? [];
    if (walls.length > 0) {
      const wallHeight = interiorWallHeight(floor);
      const wallHeights =
        entrance && index === entrance.floorIndex
          ? new Map([[ENTRANCE_WALL_ID, Math.min(storeyH - 0.01, Math.max(wallHeight, entrance.topY - floorY))]])
          : undefined;
      renderInteriorWalls(THREE, scratch, walls, floorY, undefined, {
        openingCandidates: floor.items,
        roomWidth: width,
        roomDepth: depth,
        cutout,
        wallHeight,
        ...(wallHeights ? { wallHeights } : {}),
        storeyHeight: storeyH,
      });
    }

    // Furniture, placed as the furniture effect places it: doors and windows
    // in an outer wall set back into its reveal, curtains in front of it (#758).
    const owners = classifyOpeningOwners(floor.items, width, depth, floor.interiorWalls ?? [], cutout);
    const revealContext = { width, depth, cutout, hiddenWalls: floor.hiddenWalls, noWalls: tracedGround };
    const setbacks = revealSetbacks(floor.items, owners, revealContext, storeyH);
    for (const item of floor.items) {
      const position = item.position;
      if (!position) continue;
      const setback = setbacks.get(item.id) ?? 0;
      const group = createFurnitureModel(THREE, itemForStorey(item, floor, underRoof(layout, index)), false, storeyH, setback);
      stripDetailMaps(group);
      group.name = item.name;
      group.userData.type = ROOM_OBJECT_TAGS.Furniture;
      group.userData.id = item.id;
      group.userData.floorIndex = index;
      // A garden item on the ground under it, as the scene stands it (#665).
      group.position.set(position.x, gardenGroundY(item, index, position, layout) ?? floorY, position.z);
      group.rotation.y = item.rotation ?? 0;
      group.scale.x = item.mirrored ? -1 : 1;
      scratch.add(group);
    }

    const storey = new THREE.Group();
    storey.name = floor.name.trim() || `Floor ${index + 1}`;
    storey.userData.type = 'storey';
    storey.userData.floorIndex = index;
    for (const child of [...scratch.children]) {
      // The snap grid is an editor aid, not part of the house.
      if ((child as ThreeNS.GridHelper).type === 'GridHelper') {
        scratch.remove(child);
        disposeObject(child);
        continue;
      }
      storey.add(child);
    }
    root.add(storey);
  });

  if (layout.roof && layout.roof.style !== 'none') {
    const scratch = new THREE.Scene();
    buildRoof(THREE, {
      scene: scratch, width, depth, cutout, baseY: buildingHeight(layout.floors), spec: layout.roof,
      gableWalls: gableWallsOf(layout.roof.style, layout.floors),
    });
    const roof = new THREE.Group();
    roof.name = 'Roof';
    for (const child of [...scratch.children]) roof.add(child);
    if (roof.children.length > 0) root.add(roof);
  }

  // The patterns' relief maps stay in the view: in the file they would be two
  // more images per pattern for a lighting detail (#757).
  root.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) stripRelief(m);
    // Which face of a wall is outdoors is a lighting detail of the view (#814).
    (node as ThreeNS.Mesh).geometry.deleteAttribute(OUTSIDE_FACE_ATTRIBUTE);
  });

  return root;
}
