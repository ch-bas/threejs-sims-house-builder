import { rotatedHalfExtents } from './footprint';
import { isLowProfile } from './geometry';
import { isWallHung } from './mount-band';
import { isWallMounted } from './opening-snap';
import { doorSwings, itemWorldCorners, type DoorSwing, type PlacedItem, type PlanPoint } from './plan-export/plan-geometry';
import type { FurnitureItem } from './types';

/**
 * Whether a door can swing open (#917): a soft warning, never a collision.
 * A collision turns the item red, blocks Arrange and would turn existing
 * saves red overnight; this only tints the swing on the plan and names the
 * door in the item popover.
 *
 * The swing is the quarter disc the plan draws: centred on the hinge, as
 * wide as the leaf, between the shut leaf and the open one. An item stands
 * in it when its footprint, a centimetre in from each side so a piece
 * flush with the wall or the arc doesn't count, overlaps that quarter.
 */

/** A footprint this far inside the swing's edge, or less, doesn't block it. */
const FLUSH_M = 0.01;

/** Whether `item` is something a door's leaf would hit: furniture standing on the floor. */
function canBlockSwing(item: FurnitureItem): boolean {
  // People and pets step aside for a door.
  if (!item.position || item.category === 'people') return false;
  // In the wall or on it (doors, windows, cameras, pictures, pendants), or
  // flat on the floor (rugs, mats): the leaf passes them.
  return !isWallMounted(item.type) && !isWallHung(item.type) && !isLowProfile(item);
}

/** The swings of a placed door, one per leaf (none for a sliding door or an archway, #922); none for anything else. */
function swingsOf(door: FurnitureItem): DoorSwing[] {
  if (door.type !== 'door' || !door.position) return [];
  return doorSwings(door as PlacedItem);
}

/** The items whose footprint stands in `door`'s swing, in `items` order. */
export function doorSwingBlockedBy(door: FurnitureItem, items: readonly FurnitureItem[]): FurnitureItem[] {
  const swings = swingsOf(door);
  if (swings.length === 0) return [];
  const reach = swingReach(swings);
  return items.filter(
    (item) =>
      item.id !== door.id &&
      canBlockSwing(item) &&
      nearSwing(item as PlacedItem, reach) &&
      swings.some((swing) => footprintInSwing(item as PlacedItem, swing))
  );
}

/** The square round every leaf's hinge, as far as its leaf reaches: nothing outside it can be in the swing. */
function swingReach(swings: readonly DoorSwing[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const reach = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { hinge, strike } of swings) {
    const radius = Math.hypot(strike.x - hinge.x, strike.z - hinge.z);
    reach.minX = Math.min(reach.minX, hinge.x - radius);
    reach.maxX = Math.max(reach.maxX, hinge.x + radius);
    reach.minZ = Math.min(reach.minZ, hinge.z - radius);
    reach.maxZ = Math.max(reach.maxZ, hinge.z + radius);
  }
  return reach;
}

/** A cheap first test (#917): whether the item's bounding box meets the swing's reach. */
function nearSwing(item: PlacedItem, reach: ReturnType<typeof swingReach>): boolean {
  const { halfW: hx, halfD: hz } = rotatedHalfExtents(item);
  const { x, z } = item.position;
  return x + hx > reach.minX && x - hx < reach.maxX && z + hz > reach.minZ && z - hz < reach.maxZ;
}

/** The doors on the storey whose swing `item` stands in, in `items` order. */
export function doorsSwingingInto(item: FurnitureItem, items: readonly FurnitureItem[]): FurnitureItem[] {
  if (!canBlockSwing(item)) return [];
  return items.filter((door) => {
    if (door.id === item.id) return false;
    const swings = swingsOf(door);
    return swings.length > 0 && nearSwing(item as PlacedItem, swingReach(swings)) && swings.some((swing) => footprintInSwing(item as PlacedItem, swing));
  });
}

/** Ids of every door on the storey with something in its swing: what the plan tints. */
export function blockedDoorIds(items: readonly FurnitureItem[]): Set<string> {
  const blocked = new Set<string>();
  for (const door of items) {
    if (door.type === 'door' && doorSwingBlockedBy(door, items).length > 0) blocked.add(door.id);
  }
  return blocked;
}

/**
 * Ids of every item on the storey standing in some door's swing (#917): what
 * the room score's "room to move" check reads. Each door's swings are worked
 * out once, so a storey costs doors × items cheap box tests.
 */
export function swingBlockerIds(items: readonly FurnitureItem[]): Set<string> {
  const blockers = new Set<string>();
  for (const door of items) {
    const swings = swingsOf(door);
    if (swings.length === 0) continue;
    const reach = swingReach(swings);
    for (const item of items) {
      if (item.id === door.id || blockers.has(item.id) || !canBlockSwing(item)) continue;
      const placed = item as PlacedItem;
      if (nearSwing(placed, reach) && swings.some((swing) => footprintInSwing(placed, swing))) blockers.add(item.id);
    }
  }
  return blockers;
}

/** The warning for the item popover, or null when no swing is in the way. */
export function swingClearanceNote(item: FurnitureItem, items: readonly FurnitureItem[]): string | null {
  if (item.type === 'door') {
    const blockers = doorSwingBlockedBy(item, items);
    return blockers.length === 0 ? null : `The ${namesOf(blockers)} ${blockers.length === 1 ? 'stands' : 'stand'} where it swings open.`;
  }
  const doors = doorsSwingingInto(item, items);
  if (doors.length === 0) return null;
  return `It stands where the ${namesOf(doors)} ${doors.length === 1 ? 'swings' : 'swing'} open.`;
}

/** "Sofa", "Sofa and Lamp", "Sofa, Lamp and Desk": each name once. */
function namesOf(items: readonly FurnitureItem[]): string {
  const names = [...new Set(items.map((item) => item.name))];
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** Whether an item's footprint, pulled in by `FLUSH_M`, overlaps the swing's quarter disc. */
export function footprintInSwing(item: PlacedItem, swing: DoorSwing): boolean {
  const hw = item.width / 2 - FLUSH_M;
  const hd = item.depth / 2 - FLUSH_M;
  if (hw <= 0 || hd <= 0) return false;
  const rect = itemWorldCorners({ ...item, width: hw * 2, depth: hd * 2 });
  const { hinge, strike, leafTip } = swing;
  const radius = Math.hypot(strike.x - hinge.x, strike.z - hinge.z);
  if (radius === 0) return false;
  const shut = { x: (strike.x - hinge.x) / radius, z: (strike.z - hinge.z) / radius };
  const open = { x: (leafTip.x - hinge.x) / radius, z: (leafTip.z - hinge.z) / radius };
  const inSwing = (p: PlanPoint): boolean => {
    const dx = p.x - hinge.x;
    const dz = p.z - hinge.z;
    return dx * dx + dz * dz <= radius * radius && dx * shut.x + dz * shut.z >= 0 && dx * open.x + dz * open.z >= 0;
  };
  // Both shapes are convex: they overlap when a corner of one lies in the
  // other, or an edge of the footprint crosses the swing's outline.
  if (rect.some(inSwing)) return true;
  if ([hinge, strike, leafTip].some((p) => inConvex(rect, p))) return true;
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i]!;
    const b = rect[(i + 1) % rect.length]!;
    if (segmentsCross(a, b, hinge, strike) || segmentsCross(a, b, hinge, leafTip)) return true;
    if (segmentCircle(a, b, hinge, radius).some(inSwing)) return true;
  }
  return false;
}

/** Whether `p` lies inside a convex polygon, either winding. */
function inConvex(polygon: readonly PlanPoint[], p: PlanPoint): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function segmentsCross(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const cross = (o: PlanPoint, p: PlanPoint, q: PlanPoint): number => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where segment ab meets the circle about `centre`, nudged a hair inside so the swing test takes them. */
function segmentCircle(a: PlanPoint, b: PlanPoint, centre: PlanPoint, radius: number): PlanPoint[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const fx = a.x - centre.x;
  const fz = a.z - centre.z;
  const qa = dx * dx + dz * dz;
  if (qa === 0) return [];
  const qb = 2 * (fx * dx + fz * dz);
  const qc = fx * fx + fz * fz - radius * radius;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  const points: PlanPoint[] = [];
  for (const t of [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]) {
    if (t < 0 || t > 1) continue;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const scale = 1 - 1e-9;
    points.push({ x: centre.x + (x - centre.x) * scale, z: centre.z + (z - centre.z) * scale });
  }
  return points;
}
