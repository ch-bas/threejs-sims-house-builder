import type { CatalogItem, FurnitureItem, Vec2 } from './types';

/**
 * The placement ghost (#463 d): a catalogue tile picked with the pointer
 * follows the cursor (or the finger) as a see-through preview until a click
 * or tap places it. Pure helpers; the session lives in use-placement-ghost.
 */

/** Id of the preview item; it never enters the layout. */
export const GHOST_ITEM_ID = '__placement-ghost__';

/** Quarter turn the R key gives the ghost. */
export const GHOST_ROTATION_STEP = Math.PI / 2;

/** The catalogue entry as an item at `position`, for snapping and collision tests. */
export function ghostItem(catalogItem: CatalogItem, position: Vec2, rotation: number): FurnitureItem {
  return { ...catalogItem, id: GHOST_ITEM_ID, position, rotation };
}

/**
 * The four world corners of an item's rotated footprint, in order. The axes
 * match lib/geometry's OBBs: three's rotateY maps local +X (width) to
 * (cos, −sin) and local +Z (depth) to (sin, cos).
 */
export function footprintCorners(
  item: Pick<FurnitureItem, 'width' | 'depth'>,
  position: Vec2,
  rotation: number
): [Vec2, Vec2, Vec2, Vec2] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const corner = (u: number, v: number): Vec2 => ({
    x: position.x + u * hw * cos + v * hd * sin,
    z: position.z - u * hw * sin + v * hd * cos,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** A client-space point. */
export interface ClientPoint {
  x: number;
  y: number;
}

/**
 * Invert an affine client → world mapping (the 2D plan's `clientToWorld2D`)
 * by sampling it at three points, so the ghost's outline is drawn with the
 * plan's own transform instead of a re-derived one. Null when the mapping
 * is unavailable or degenerate.
 */
export function invertClientToWorld(
  toWorld: (clientX: number, clientY: number) => Vec2 | null,
  origin: ClientPoint = { x: 0, y: 0 }
): ((world: Vec2) => ClientPoint) | null {
  const o = toWorld(origin.x, origin.y);
  const px = toWorld(origin.x + 100, origin.y);
  const py = toWorld(origin.x, origin.y + 100);
  if (!o || !px || !py) return null;
  // world = o + J · (client − origin), with J's columns per 100 px.
  const a = (px.x - o.x) / 100;
  const c = (px.z - o.z) / 100;
  const b = (py.x - o.x) / 100;
  const d = (py.z - o.z) / 100;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return (world) => {
    const dx = world.x - o.x;
    const dz = world.z - o.z;
    return { x: origin.x + (d * dx - b * dz) / det, y: origin.y + (-c * dx + a * dz) / det };
  };
}

/** The outline's SVG `points`, the footprint mapped to client space. */
export function ghostOutlinePoints(corners: readonly Vec2[], toClient: (world: Vec2) => ClientPoint): string {
  return corners
    .map((corner) => {
      const p = toClient(corner);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
}
