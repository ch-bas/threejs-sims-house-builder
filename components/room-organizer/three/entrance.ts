import { entranceSteps, type EntranceGeometry } from '../lib/street';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * The recessed porch (#204): the two reveals (side walls of the recess), the
 * soffit over it, and steps up from the street. The front wall's hole is cut
 * by the shell builder (entranceWallCut); the back of the recess is an
 * ordinary interior wall carrying an ordinary door, kept in step by the
 * reducer.
 *
 * Reveals and soffit are tagged as part of the north wall, so the cutaway
 * hides them with it; the steps are ground, tagged with the floor.
 */
const REVEAL_THICKNESS = 0.12;
const SOFFIT_THICKNESS = 0.12;
const STEP_COLOR = 0xb9b4a8;

export interface BuildEntranceOptions {
  geometry: EntranceGeometry;
  wallColor: string;
  wallTag: string;
  floorTag: string;
  ghostOpacity?: number;
}

export function buildEntrance(THREE: ThreeModule, options: BuildEntranceOptions): ThreeNS.Group[] {
  const { geometry: g, ghostOpacity } = options;
  const translucent = (material: ThreeNS.MeshStandardMaterial) => {
    if (ghostOpacity !== undefined) {
      material.transparent = true;
      material.opacity = ghostOpacity;
    }
    return material;
  };

  const shell = new THREE.Group();
  const finish = translucent(new THREE.MeshStandardMaterial({ color: options.wallColor, roughness: 0.9 }));
  const depth = g.backZ - g.frontZ;
  const height = g.topY - g.bottomY;
  const midZ = (g.frontZ + g.backZ) / 2;
  // Reveals sit inside the house, just beyond the hole's edges.
  for (const x of [g.x0 - REVEAL_THICKNESS / 2, g.x1 + REVEAL_THICKNESS / 2]) {
    const reveal = new THREE.Mesh(new THREE.BoxGeometry(REVEAL_THICKNESS, height, depth), finish);
    reveal.position.set(x, g.bottomY + height / 2, midZ);
    shell.add(reveal);
  }
  const soffit = new THREE.Mesh(
    new THREE.BoxGeometry(g.x1 - g.x0 + REVEAL_THICKNESS * 2, SOFFIT_THICKNESS, depth),
    finish
  );
  soffit.position.set((g.x0 + g.x1) / 2, g.topY + SOFFIT_THICKNESS / 2, midZ);
  shell.add(soffit);
  shell.children.forEach((child) => {
    child.castShadow = ghostOpacity === undefined;
    child.receiveShadow = true;
  });
  shell.userData.type = options.wallTag;
  shell.userData.wallId = 'north';

  const groups = [shell];
  const steps = entranceSteps(g);
  if (steps.count > 0) {
    const stairs = new THREE.Group();
    const stone = translucent(new THREE.MeshStandardMaterial({ color: STEP_COLOR, roughness: 0.95 }));
    const width = g.x1 - g.x0;
    // Top step is the porch floor's edge; each one below steps out toward the street.
    for (let i = 0; i < steps.count; i++) {
      const top = g.bottomY - i * steps.rise;
      const blockHeight = top - g.streetY;
      const step = new THREE.Mesh(new THREE.BoxGeometry(width, blockHeight, steps.going), stone);
      step.position.set((g.x0 + g.x1) / 2, g.streetY + blockHeight / 2, g.frontZ - steps.going * (i + 0.5));
      step.castShadow = ghostOpacity === undefined;
      step.receiveShadow = true;
      stairs.add(step);
    }
    stairs.userData.type = options.floorTag;
    groups.push(stairs);
  }
  return groups;
}
