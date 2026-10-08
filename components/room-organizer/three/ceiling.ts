import { removeAndDispose } from './builder-utils';
import { buildFloorGeometryWithOpenings, floorHoleOutlines } from './room-builder';
import type { FloorOpening } from './wall-openings';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

export const CEILING_TAG = 'walkthrough-ceiling';

/** Below the storey above's floor plate, which "show all floors" also draws (#276). */
export const CEILING_GAP = 0.01;

const CEILING_COLOR = 0xf4f1ea;

export interface CeilingOptions {
  scene: ThreeNS.Scene;
  width: number;
  depth: number;
  /**
   * The storey above: the underside of its floor at `y`, cut by `openings`
   * (the active storey's stairwells), each closed by a shaft up to `capY`.
   */
  above: { y: number; capY: number; openings: readonly FloorOpening[] } | null;
  /**
   * The storey below: a pit under each stairwell cut through the active
   * storey's own floor at `topY` (`openings`, from the stairs below), down to
   * a floor in `floorColor` at `y`.
   */
  below: { y: number; topY: number; openings: readonly FloorOpening[]; floorColor: string } | null;
  /** Line the stairwells. Off when "show all floors" builds the real storeys there. */
  shafts: boolean;
}

/**
 * What closes the active storey in walkthrough (#359). Only the active
 * storey's shell is built, so without it a lower floor's rooms are open to
 * the sky and every stairwell looks out over the walls into the garden.
 * Returns null when there is nothing to build.
 */
export function buildCeiling(THREE: ThreeModule, options: CeilingOptions): ThreeNS.Group | null {
  const { above, below, width, depth } = options;
  const pitOpenings = options.shafts && below ? below.openings : [];
  if (!above && pitOpenings.length === 0) return null;

  const group = new THREE.Group();
  group.userData.type = CEILING_TAG;
  const plaster = (side: ThreeNS.Side) =>
    new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.95, side });

  if (above) {
    // Laid out like the floor plate (normal up) and drawn double-sided for
    // the walker below; three flips the normal on the back face.
    const geometry =
      above.openings.length > 0
        ? buildFloorGeometryWithOpenings(THREE, width, depth, above.openings)
        : new THREE.PlaneGeometry(width, depth);
    const plate = new THREE.Mesh(geometry, plaster(THREE.DoubleSide));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = above.y - CEILING_GAP;
    plate.castShadow = true;
    freeze(plate);
    group.add(plate);
    if (options.shafts) {
      const material = plaster(THREE.BackSide);
      addShafts(THREE, group, floorHoleOutlines(width, depth, above.openings), above.y - CEILING_GAP, above.capY, [material, material]);
    }
  }

  if (below && pitOpenings.length > 0) {
    const floor = new THREE.MeshStandardMaterial({ color: below.floorColor, roughness: 0.8, side: THREE.BackSide });
    addShafts(THREE, group, floorHoleOutlines(width, depth, pitOpenings), below.y, below.topY, [floor, plaster(THREE.BackSide)]);
  }

  options.scene.add(group);
  return group;
}

/**
 * One closed prism per hole, seen from inside only: back faces draw the
 * sides and the far cap, and the near cap, front-facing to a walker looking
 * in through the hole, is culled to leave the stairwell open. `materials` is
 * [caps, sides], ExtrudeGeometry's group order.
 */
function addShafts(
  THREE: ThreeModule,
  group: ThreeNS.Group,
  holes: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  bottomY: number,
  topY: number,
  materials: [ThreeNS.Material, ThreeNS.Material]
): void {
  if (topY <= bottomY) return;
  for (const outline of holes) {
    // Hole outlines are in the floor plate's shape space, [x, -z]: standing
    // the extrusion up with the same -90° X rotation puts them back on the hole.
    const shape = new THREE.Shape();
    outline.forEach(([x, y], i) => {
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: topY - bottomY, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const shaft = new THREE.Mesh(geometry, materials);
    shaft.position.y = bottomY;
    // Closes the stairwell to the sun as well: the static shadow map would
    // otherwise light the stairs through it. A BackSide material casts with
    // its front (outside) faces, so the prism is solid to the light.
    shaft.castShadow = true;
    freeze(shaft);
    group.add(shaft);
  }
}

function freeze(object: ThreeNS.Object3D): void {
  object.updateMatrix();
  object.matrixAutoUpdate = false;
}

export function removeCeiling(scene: ThreeNS.Scene): void {
  const stale = scene.children.filter((obj) => obj.userData.type === CEILING_TAG);
  for (const obj of stale) removeAndDispose(scene, obj);
}
