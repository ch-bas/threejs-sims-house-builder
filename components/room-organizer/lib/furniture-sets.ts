import { FURNITURE_CATALOG } from './constants';
import { itemsOverlap, rotatedHalfExtents } from './geometry';
import { remapGroupIds } from './groups';
import { randomSuffix } from './ids';
import { isWallMounted, settleWallMountedItem, type WallGap } from './opening-snap';
import type { FurnitureItem, InteriorWall, Vec2 } from './types';

/**
 * A placed item minus what a set can't carry: its id and floor position
 * (the spec's offset), its rotation (the spec's) and its lock. Custom sets
 * (#302) store one per piece so colour, size and shape overrides survive;
 * `groupId` survives too, remapped to a fresh group at placement (#154).
 */
export type SetItemSnapshot = Omit<FurnitureItem, 'id' | 'position' | 'rotation' | 'locked'>;

export interface FurnitureSetItem {
  type: string;
  offset: Vec2;
  rotation?: number;
  /** Full item to place instead of the catalog entry for `type` (#302). */
  snapshot?: SetItemSnapshot;
}

export interface FurnitureSet {
  key: string;
  label: string;
  icon: string;
  description: string;
  items: ReadonlyArray<FurnitureSetItem>;
}

export const FURNITURE_SETS: readonly FurnitureSet[] = [
  {
    key: 'dining',
    label: 'Dining Set',
    icon: '🍽️',
    description: 'Dining table + 4 chairs',
    items: [
      { type: 'dining-table', offset: { x: 0, z: 0 } },
      { type: 'dining-chair', offset: { x: -1.2, z: 0 }, rotation: Math.PI / 2 },
      { type: 'dining-chair', offset: { x: 1.2, z: 0 }, rotation: -Math.PI / 2 },
      { type: 'dining-chair', offset: { x: 0, z: -0.85 }, rotation: 0 },
      { type: 'dining-chair', offset: { x: 0, z: 0.85 }, rotation: Math.PI },
    ],
  },
  {
    key: 'bedroom',
    label: 'Bedroom Set',
    icon: '🛏️',
    description: 'Bed + two nightstands + lamp',
    items: [
      { type: 'bed', offset: { x: 0, z: 0 } },
      { type: 'nightstand', offset: { x: -1.4, z: 0 } },
      { type: 'nightstand', offset: { x: 1.4, z: 0 } },
      { type: 'lamp', offset: { x: -1.4, z: -0.3 } },
    ],
  },
  {
    key: 'home-office',
    label: 'Office Set',
    icon: '💼',
    description: 'Desk + chair + computer + lamp',
    items: [
      { type: 'desk', offset: { x: 0, z: -0.3 } },
      { type: 'chair', offset: { x: 0, z: 0.4 }, rotation: Math.PI },
      { type: 'computer', offset: { x: 0, z: -0.3 } },
      { type: 'lamp', offset: { x: 0.6, z: -0.3 } },
    ],
  },
  {
    key: 'kitchen-line',
    label: 'Kitchen Line',
    icon: '🍳',
    description: 'Fridge + stove + counter + sink',
    items: [
      { type: 'fridge', offset: { x: -1.5, z: 0 } },
      { type: 'stove', offset: { x: -0.6, z: 0 } },
      { type: 'counter', offset: { x: 0.4, z: 0 } },
      { type: 'kitchen-sink', offset: { x: 1.5, z: 0 } },
    ],
  },
  {
    key: 'lounge',
    label: 'Lounge Set',
    icon: '🛋️',
    description: 'Sofa + coffee table + TV + plant',
    items: [
      { type: 'sofa', offset: { x: 0, z: -0.6 } },
      { type: 'coffee-table', offset: { x: 0, z: 0.6 } },
      { type: 'tv', offset: { x: 0, z: 2.0 }, rotation: Math.PI },
      { type: 'plant', offset: { x: -1.6, z: 1.8 } },
    ],
  },
];

interface BuildSetOptions {
  center?: Vec2;
  idPrefix?: string;
  /** Interior room width (m). When given, the set is scaled to fit. */
  roomWidth?: number;
  /** Interior room depth (m). When given, the set is scaled to fit. */
  roomDepth?: number;
  /** The active floor's partitions, so doors and windows settle onto them too. */
  interiorWalls?: readonly InteriorWall[];
  /** The recessed entrance's cut in the north wall (`entrancePlanOutline`). */
  frontGap?: WallGap | null;
}

interface ResolvedSpec {
  spec: FurnitureSetItem;
  /** The piece as it will be placed: the snapshot, or the catalog entry. */
  base: SetItemSnapshot;
}

/**
 * How a piece is placed (#384): `fitted` furniture is laid out around the
 * set's centre and scaled to fit inside the room; `wall` pieces (doors,
 * windows, cameras) keep their offset and settle onto the nearest wall, like
 * a paste; `outdoor` pieces keep their offsets and stay outside the house.
 */
type PieceKind = 'fitted' | 'wall' | 'outdoor';

function pieceKind(base: Pick<SetItemSnapshot, 'type' | 'category'>): PieceKind {
  if (isWallMounted(base.type)) return 'wall';
  return base.category === 'outdoor' ? 'outdoor' : 'fitted';
}

/**
 * Pair each spec with the item it places. A built-in spec resolves through
 * the catalog and is skipped when its type is unknown; a snapshot spec is
 * self-contained, so a custom set outlives catalog renames (#302).
 */
function resolveSpecs(set: FurnitureSet): ResolvedSpec[] {
  const specs: ResolvedSpec[] = [];
  for (const spec of set.items) {
    const base = spec.snapshot ?? FURNITURE_CATALOG.find((entry) => entry.type === spec.type);
    if (base) specs.push({ spec, base });
  }
  return specs;
}

/** World-axis half-extents of a piece at its set rotation, any angle (#384). */
function specHalfExtents({ spec, base }: ResolvedSpec): { halfW: number; halfD: number } {
  return rotatedHalfExtents({ width: base.width, depth: base.depth, rotation: spec.rotation ?? 0 });
}

// Inset from the EXTERIOR half-width used when clamping generated placements.
// The room dimensions are exterior measurements, so ~0.35 m (wall thickness
// plus a small margin) keeps pieces from sitting under or inside the walls.
const WALL_INSET = 0.35;
/** Gap between the south wall and outdoor pieces moved out of the house. */
const GARDEN_GAP = 0.5;

/**
 * Compute the shrink factor (≤ 1) needed for the set's overall footprint —
 * item centres AND their half-extents — to fit inside the room with a small
 * margin. The set is laid out around (0,0), so its extent is symmetric; we
 * measure the farthest reach along each axis and scale offsets (not item
 * sizes) uniformly so items never poke through the walls. Rooms can be as
 * small as 2×2 m while the sets assume up to ~4.4 m, so without this clamp
 * items land through the walls (#73). Only the fitted pieces count.
 */
function fitScale(specs: readonly ResolvedSpec[], roomWidth: number, roomDepth: number): number {
  const usableHalfW = Math.max(0, roomWidth / 2 - WALL_INSET);
  const usableHalfD = Math.max(0, roomDepth / 2 - WALL_INSET);
  // Scale only the offsets: the item half-extents are fixed, so solve
  // s·|offset| + half ≤ usable for the tightest item on each axis.
  let scale = 1;
  for (const resolved of specs) {
    if (pieceKind(resolved.base) !== 'fitted') continue;
    const { offset } = resolved.spec;
    const { halfW, halfD } = specHalfExtents(resolved);
    if (offset.x !== 0) scale = Math.min(scale, (usableHalfW - halfW) / Math.abs(offset.x));
    if (offset.z !== 0) scale = Math.min(scale, (usableHalfD - halfD) / Math.abs(offset.z));
  }
  return Math.max(0, Math.min(1, scale));
}

/**
 * Every fitted piece in a set must itself fit the room even at zero offset;
 * if one doesn't, the set can't be placed here at all. Wall-mounted and
 * outdoor pieces don't go inside, so they never refuse a set.
 */
export function setFitsRoom(set: FurnitureSet, roomWidth: number, roomDepth: number): boolean {
  for (const resolved of resolveSpecs(set)) {
    if (pieceKind(resolved.base) !== 'fitted') continue;
    const { halfW, halfD } = specHalfExtents(resolved);
    if (2 * halfW > roomWidth - 2 * WALL_INSET || 2 * halfD > roomDepth - 2 * WALL_INSET) return false;
  }
  return true;
}

export function buildFurnitureSet(set: FurnitureSet, options: BuildSetOptions = {}): FurnitureItem[] {
  // The default id prefix includes a random suffix so two sets stamped in the
  // same millisecond don't produce colliding item ids (the per-index suffix
  // only disambiguates within a single set).
  const {
    center = { x: 0, z: 0 },
    idPrefix = `${set.key}-${Date.now()}-${randomSuffix()}`,
    roomWidth,
    roomDepth,
  } = options;

  const specs = resolveSpecs(set);
  const room = roomWidth != null && roomDepth != null ? { width: roomWidth, depth: roomDepth } : null;

  // If the room is known and even a single item can't fit, refuse the set
  // rather than drop pieces through the walls.
  if (room && !setFitsRoom(set, room.width, room.depth)) return [];

  const scale = room ? fitScale(specs, room.width, room.depth) : 1;
  const kinds = specs.map(({ base }) => pieceKind(base));

  // Outdoor pieces keep their offsets as one rigid group; when any would land
  // in or against the house, the whole group moves out past the south wall,
  // the garden side where outdoor catalog items are placed (#384).
  let gardenShift = 0;
  if (room) {
    let intrudes = false;
    let northEdge = Infinity;
    specs.forEach((resolved, index) => {
      if (kinds[index] !== 'outdoor') return;
      const { halfW, halfD } = specHalfExtents(resolved);
      const x = center.x + resolved.spec.offset.x;
      const z = center.z + resolved.spec.offset.z;
      if (Math.abs(x) < room.width / 2 + halfW && Math.abs(z) < room.depth / 2 + halfD) intrudes = true;
      northEdge = Math.min(northEdge, z - halfD);
    });
    if (intrudes) gardenShift = room.depth / 2 + GARDEN_GAP - northEdge;
  }

  // A snapshot set's groups come back as new groups under this stamp's
  // prefix (#154, #302); built-in specs carry no groupId and stay loose.
  const place = (s: number): FurnitureItem[] =>
    remapGroupIds(
      specs.map(({ spec, base }, index) => {
        const kind = kinds[index];
        const k = kind === 'fitted' ? s : 1;
        const position = {
          x: center.x + spec.offset.x * k,
          z: center.z + spec.offset.z * k + (kind === 'outdoor' ? gardenShift : 0),
        };
        const item: FurnitureItem = { ...base, id: `${idPrefix}-${index}`, position, rotation: spec.rotation ?? 0 };
        if (kind !== 'wall' || !room) return item;
        // The same settle as paste and duplicate, so no opening lands off its wall (#116).
        const settled = settleWallMountedItem(
          item,
          position,
          room.width,
          room.depth,
          options.interiorWalls ?? [],
          options.frontGap ?? null
        );
        return settled ? { ...item, ...settled } : item;
      }),
      idPrefix
    );

  const items = place(scale);

  // fitScale shrinks the offsets but not the item sizes, so a tight room can
  // slide pieces into each other. Some overlaps are authored (the office
  // computer and lamp sit ON the desk), so only an overlap that does NOT
  // exist in the unscaled layout means the room is too narrow — refuse the
  // set rather than stamp furniture embedded in furniture (#127). Only the
  // fitted pieces are scaled, so only they are compared.
  if (scale < 1) {
    const authored = place(1);
    for (let i = 0; i < items.length; i++) {
      if (kinds[i] !== 'fitted') continue;
      for (let j = i + 1; j < items.length; j++) {
        if (kinds[j] !== 'fitted') continue;
        if (itemsOverlap(items[i]!, items[j]!) && !itemsOverlap(authored[i]!, authored[j]!)) {
          return [];
        }
      }
    }
  }

  return items;
}
