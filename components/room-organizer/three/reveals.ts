import { shellWalls } from '../lib/footprint';
import { isCeilingHung, isWallHung, mountBand } from '../lib/mount-band';
import { revealsEnabled } from './texture-settings';
import { mergeHoleRects, type OpeningOwner, type WallOpening } from './wall-openings';
import type { FootprintCutout, FurnitureItem, WallId } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Window and door reveals on the shell (#758). The outer walls are planes, so
 * a frame on one is a sticker with no depth for the sun to shade. Each
 * opening cut into an outer wall gets a lining (head, jambs and, under a
 * window, a sill board) running into the house, and the door or window
 * standing in it is set back by `REVEAL_SETBACK` inside its group, never in
 * its saved position: plan, collisions and the walker's door gaps don't move,
 * and saved houses load as they were. A window's own sill stays on the wall
 * plane, so it still projects outside. Hung decor in front of one (curtains)
 * stands out into the room to clear it, also inside its group. Phones get
 * none of it: no linings and nothing set back (texture-settings).
 */

/** How far a door or window frame sits back from the facade, centre to plane. */
export const REVEAL_SETBACK = 0.12;
/** How deep the lining runs from the wall plane: to the inner face of a 12 cm frame. */
export const REVEAL_DEPTH = REVEAL_SETBACK + 0.06;
/** Thickness of the lining boards, outside the hole: wider than a window sill's 4 cm overhang, which then ends inside it. */
export const REVEAL_BOARD = 0.05;
/** The lining starts this far behind the wall plane, so its back never shares the facade's plane (#276). */
export const REVEAL_WALL_GAP = 0.004;
/** userData flag on a part that stays on the wall plane when its window is set back: the outside sill. */
export const EXTERIOR_SILL_KEY = 'exteriorSill';
/** Clearance between hung decor and the set-back frame or lining behind it. */
export const REVEAL_DECOR_GAP = 0.01;

/** The recessed entrance's cut, which three/entrance.ts lines itself. */
const ENTRANCE_OPENING_ID = 'entrance';

/** The inward normal's yaw of each side of the house, as the shell walls face. */
const INWARD_YAW: Record<WallId, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

export interface RevealContext {
  width: number;
  depth: number;
  cutout?: FootprintCutout | undefined;
  /** Sides of this storey with no wall built. */
  hiddenWalls?: readonly WallId[] | undefined;
  /** No shell walls at all on this storey: a traced ground floor. */
  noWalls?: boolean;
}

/**
 * How far to set a door or window back along its own +z, where it stands in
 * an outer wall that is built: ±REVEAL_SETBACK, the sign taking the item's
 * facing (an opening turned round faces out), else 0. Pure.
 */
export function openingSetback(item: FurnitureItem, owner: OpeningOwner | undefined, context: RevealContext): number {
  if ((item.type !== 'door' && item.type !== 'window') || owner?.kind !== 'exterior' || context.noWalls || !revealsEnabled()) return 0;
  const wall = shellWalls({ width: context.width, height: context.depth, cutout: context.cutout }).find((w) => w.id === owner.wall);
  if (!wall || context.hiddenWalls?.includes(wall.side)) return 0;
  const inward = INWARD_YAW[wall.side];
  const rotation = item.rotation ?? 0;
  const facing = Math.sin(rotation) * Math.sin(inward) + Math.cos(rotation) * Math.cos(inward);
  return facing >= 0 ? REVEAL_SETBACK : -REVEAL_SETBACK;
}

/**
 * How far to stand wall-hung decor out into the room, along its own +z, so it
 * clears the frame and lining of a set-back door or window behind it: curtains
 * hung over a window otherwise had the frame through their panels. 0 when
 * nothing set back is behind it. Pure.
 */
export function decorStandOff(
  item: FurnitureItem,
  openings: ReadonlyArray<{ item: FurnitureItem; setback: number }>,
  storeyHeight?: number
): number {
  if (!isWallHung(item.type) || isCeilingHung(item.type) || !item.position) return 0;
  const band = mountBand(item, storeyHeight);
  const facing = { x: Math.sin(item.rotation ?? 0), z: Math.cos(item.rotation ?? 0) };
  let push = 0;
  let side = 1;
  for (const { item: opening, setback } of openings) {
    if (setback === 0 || !opening.position) continue;
    const r = opening.rotation ?? 0;
    // The wall's inward normal and its run, from the opening's facing and set-back.
    const nx = Math.sign(setback) * Math.sin(r);
    const nz = Math.sign(setback) * Math.cos(r);
    const dx = item.position.x - opening.position.x;
    const dz = item.position.z - opening.position.z;
    const off = dx * nx + dz * nz;
    const along = dx * nz - dz * nx;
    const aligned = facing.x * nx + facing.z * nz;
    // On the room side, square to the wall, and over the opening in plan and height.
    if (off < 0 || Math.abs(aligned) < 0.99 || Math.abs(along) >= (item.width + opening.width) / 2) continue;
    const behind = mountBand(opening, storeyHeight);
    if (band.bottom >= behind.top || behind.bottom >= band.top) continue;
    const face = Math.max(REVEAL_DEPTH, Math.abs(setback) + opening.depth / 2) + REVEAL_DECOR_GAP;
    const need = face - (off - item.depth / 2);
    if (need > push) {
      push = need;
      side = Math.sign(aligned);
    }
  }
  return push * side;
}

/**
 * Every set-back on a storey, keyed by item id: doors and windows into their
 * reveals (`openingSetback`), and hung decor out in front of them
 * (`decorStandOff`). Items not listed stay where they are.
 */
export function revealSetbacks(
  items: readonly FurnitureItem[],
  owners: ReadonlyMap<string, OpeningOwner>,
  context: RevealContext,
  storeyHeight?: number
): Map<string, number> {
  const setbacks = new Map<string, number>();
  const openings: Array<{ item: FurnitureItem; setback: number }> = [];
  for (const item of items) {
    const setback = openingSetback(item, owners.get(item.id), context);
    if (setback === 0) continue;
    setbacks.set(item.id, setback);
    openings.push({ item, setback });
  }
  if (openings.length === 0) return setbacks;
  for (const item of items) {
    const standOff = decorStandOff(item, openings, storeyHeight);
    if (standOff !== 0) setbacks.set(item.id, standOff);
  }
  return setbacks;
}

/**
 * Move a door or window's parts back into its reveal, all but the outside
 * sill (or hung decor's out in front of one). Called again on the same group,
 * it moves them by the difference: the placement ghost follows the wall it is over.
 */
export function setBackOpening(group: ThreeNS.Object3D, setback: number): void {
  const current = (group.userData.revealSetback as number | undefined) ?? 0;
  if (setback === current) return;
  for (const child of group.children) {
    if (child.userData[EXTERIOR_SILL_KEY] !== true) child.position.z += setback - current;
  }
  group.userData.revealSetback = setback;
}

/**
 * The openings the skirting along a wall stops at: each lined door is
 * widened by half a lining board a side, so the board ends inside the jamb
 * rather than in the plane of its face (#276). The entrance has no lining.
 */
export function skirtingOpenings(openings: readonly WallOpening[]): WallOpening[] {
  if (!revealsEnabled()) return [...openings];
  return openings.map((o) => (o.id === ENTRANCE_OPENING_ID ? o : { ...o, width: o.width + REVEAL_BOARD }));
}

/** Lining boxes for one wall, in its frame: x along it, y up from its centre, z into the house. */
export function revealBoxes(
  openings: readonly WallOpening[],
  wallWidth: number,
  wallHeight: number
): Array<{ x0: number; x1: number; y0: number; y1: number }> {
  const halfW = wallWidth / 2;
  const halfH = wallHeight / 2;
  const t = REVEAL_BOARD;
  const rects = mergeHoleRects(
    openings
      .filter((o) => o.id !== ENTRANCE_OPENING_ID)
      .map((o) => [o.centerAlongWall - o.width / 2, -halfH + o.bottomFromFloor, o.centerAlongWall + o.width / 2, -halfH + o.bottomFromFloor + o.height] as [number, number, number, number])
  );
  const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const clampX = (x: number) => Math.max(-halfW, Math.min(halfW, x));
  for (const [x0, y0, x1, y1] of rects) {
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    const door = y0 <= -halfH + 1e-6;
    // Jambs between head and sill; head and sill run over both jambs.
    boxes.push({ x0: clampX(x0 - t), x1: x0, y0, y1 });
    boxes.push({ x0: x1, x1: clampX(x1 + t), y0, y1 });
    if (y1 + t <= halfH) boxes.push({ x0: clampX(x0 - t), x1: clampX(x1 + t), y0: y1, y1: y1 + t });
    // A sill board under a window, never through its storey's floor.
    if (!door) boxes.push({ x0: clampX(x0 - t), x1: clampX(x1 + t), y0: Math.max(-halfH, y0 - t), y1: y0 });
  }
  return boxes.filter((b) => b.x1 - b.x0 > 1e-6 && b.y1 - b.y0 > 1e-6);
}

/**
 * One wall's lining as a single geometry in the wall mesh's frame (local +z
 * faces into the house), or null when the wall has no openings to line.
 */
export function buildRevealGeometry(
  THREE: ThreeModule,
  openings: readonly WallOpening[],
  wallWidth: number,
  wallHeight: number
): ThreeNS.BufferGeometry | null {
  const boxes = revealBoxes(openings, wallWidth, wallHeight);
  if (boxes.length === 0) return null;
  const depth = REVEAL_DEPTH - REVEAL_WALL_GAP;
  const positions: number[] = [];
  const normals: number[] = [];
  for (const box of boxes) {
    const geometry = new THREE.BoxGeometry(box.x1 - box.x0, box.y1 - box.y0, depth).toNonIndexed();
    geometry.translate((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, REVEAL_WALL_GAP + depth / 2);
    positions.push(...(geometry.getAttribute('position').array as Float32Array));
    normals.push(...(geometry.getAttribute('normal').array as Float32Array));
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  return merged;
}
