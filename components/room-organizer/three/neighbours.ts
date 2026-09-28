import { removeAndDispose } from './builder-utils';
import { buildRoof } from './roof';
import type { NeighbourSide, RoofSpec } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/**
 * Party-wall neighbours (#202): a terrace house either side, the same
 * footprint as ours, sized off our eaves and roofed in our style so the
 * ridge runs on along the street.
 *
 * Tagged apart from the shell, so the wall-display modes never hide them:
 * the party walls read as solid even while ours are cut away (#201).
 */
export const NEIGHBOUR_TAG = 'neighbour';

const FACADE_COLORS: Record<NeighbourSide, number> = { west: 0xc9a27e, east: 0xb8735a };
const WINDOW_COLOR = 0x2e3a46;
const TRIM_COLOR = 0xe8e2d6;
/** Clearance off our wall plane so the party walls don't z-fight it. */
const PARTY_WALL_GAP = 0.02;
const WINDOW_WIDTH = 1.1;
/**
 * Our eaves overhang the party wall, and the neighbours' roofs are the same
 * planes — coplanar where they overlap. Sitting theirs a hair lower lets ours
 * win cleanly while the ridge still reads as one run.
 */
const ROOF_DROP = 0.03;
const MIN_STOREY_FOR_WINDOWS = 1.8;

export interface NeighbourOptions {
  width: number;
  depth: number;
  /** Top of our highest storey — where the neighbours' roofs start too. */
  eavesY: number;
  /** Lowest ground around the house; the blocks reach down to it. */
  baseY: number;
  /** Each storey's floor Y and height, for the neighbours' window rows. */
  storeys: ReadonlyArray<{ y: number; height: number }>;
  roof?: RoofSpec;
  sides: readonly NeighbourSide[];
}

export function removeNeighbours(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === NEIGHBOUR_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

export function buildNeighbours(THREE: ThreeModule, scene: ThreeNS.Scene, options: NeighbourOptions): void {
  removeNeighbours(scene);
  for (const side of options.sides) {
    const house = buildNeighbour(THREE, options, side);
    const sign = side === 'east' ? 1 : -1;
    house.position.x = sign * (options.width + PARTY_WALL_GAP);
    house.userData.type = NEIGHBOUR_TAG;
    house.userData.side = side;
    house.updateMatrixWorld(true);
    scene.add(house);
  }
}

function buildNeighbour(THREE: ThreeModule, options: NeighbourOptions, side: NeighbourSide): ThreeNS.Group {
  const { width, depth, eavesY, baseY } = options;
  const group = new THREE.Group();

  const height = eavesY - baseY;
  const facade = new THREE.MeshStandardMaterial({ color: FACADE_COLORS[side], roughness: 0.9 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), facade);
  block.position.y = baseY + height / 2;
  block.castShadow = true;
  block.receiveShadow = true;
  group.add(block);

  // A window pair per storey on the street and garden faces, so the blocks
  // read as houses rather than slabs.
  const glass = new THREE.MeshStandardMaterial({ color: WINDOW_COLOR, roughness: 0.3, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.8 });
  for (const storey of options.storeys) {
    if (storey.height < MIN_STOREY_FOR_WINDOWS) continue;
    const windowHeight = Math.min(1.4, storey.height - 1.2);
    const centerY = storey.y + 0.9 + windowHeight / 2;
    for (const face of [-1, 1] as const) {
      for (const offset of [-width / 4, width / 4]) {
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_WIDTH + 0.12, windowHeight + 0.12), trim);
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_WIDTH, windowHeight), glass);
        frame.position.set(offset, centerY, face * (depth / 2 + 0.005));
        pane.position.set(offset, centerY, face * (depth / 2 + 0.01));
        // Planes face +z; turn the street-side (north, −z) ones outward.
        if (face < 0) {
          frame.rotation.y = Math.PI;
          pane.rotation.y = Math.PI;
        }
        group.add(frame, pane);
      }
    }
  }

  // buildRoof adds to (and clears roof-tagged children of) whatever it is
  // given; a scratch group keeps it off the scene's own roof.
  if (options.roof && options.roof.style !== 'none') {
    buildRoof(THREE, {
      scene: group as unknown as ThreeNS.Scene,
      width,
      depth,
      baseY: eavesY - ROOF_DROP,
      spec: options.roof,
    });
  }
  return group;
}
