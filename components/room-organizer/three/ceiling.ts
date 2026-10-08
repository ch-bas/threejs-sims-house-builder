import { floorOpeningOutline } from '../lib/stairs';
import { removeAndDispose } from './builder-utils';
import { buildFloorGeometryWithOpenings } from './room-builder';
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
  /** World Y of the storey above's floor. */
  y: number;
  /** Top of the storey above, where a stairwell's shaft ends. */
  capY: number;
  /** Stairwells cut through the storey above's floor. */
  openings: readonly FloorOpening[];
}

/**
 * The underside of the storey above, seen from inside in walkthrough (#359).
 * Only the active storey's shell is built, so without it a lower floor's
 * rooms are open to the sky. Stairwells are cut so the stairs still lead up,
 * and each gets a shaft to the top of the storey above: without it the view
 * up the stairs runs out over the walls into the sky.
 */
export function buildCeiling(THREE: ThreeModule, options: CeilingOptions): ThreeNS.Group {
  // Laid out like the floor plate (normal up) and drawn double-sided for
  // the walker below; three flips the normal on the back face.
  const material = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.userData.type = CEILING_TAG;

  const geometry =
    options.openings.length > 0
      ? buildFloorGeometryWithOpenings(THREE, options.width, options.depth, options.openings)
      : new THREE.PlaneGeometry(options.width, options.depth);
  const plate = new THREE.Mesh(geometry, material);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = options.y - CEILING_GAP;
  plate.castShadow = true;
  freeze(plate);
  group.add(plate);

  if (options.openings.length > 0) {
    // Seen from inside only: back faces draw the walls and top, and the
    // bottom face, front-facing from below, is culled to leave it open.
    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: CEILING_COLOR,
      roughness: 0.95,
      side: THREE.BackSide,
    });
    const height = options.capY - options.y + CEILING_GAP;
    for (const opening of options.openings) {
      const shape = new THREE.Shape();
      floorOpeningOutline(opening).forEach(([x, z], i) => {
        // Shape Y becomes world -Z once the extrusion is stood up.
        if (i === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();
      const shaftGeometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      shaftGeometry.rotateX(-Math.PI / 2);
      const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
      shaft.position.y = options.y - CEILING_GAP;
      freeze(shaft);
      group.add(shaft);
    }
  }
  options.scene.add(group);
  return group;
}

function freeze(object: ThreeNS.Object3D): void {
  object.updateMatrix();
  object.matrixAutoUpdate = false;
}

export function removeCeiling(scene: ThreeNS.Scene): void {
  const stale = scene.children.filter((obj) => obj.userData.type === CEILING_TAG);
  for (const obj of stale) removeAndDispose(scene, obj);
}
