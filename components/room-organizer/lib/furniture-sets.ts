import { FURNITURE_CATALOG } from './constants';
import { itemsOverlap } from './geometry';
import { randomSuffix } from './ids';
import type { CatalogItem, FurnitureItem, Vec2 } from './types';

export interface FurnitureSet {
  key: string;
  label: string;
  icon: string;
  description: string;
  items: ReadonlyArray<{ type: string; offset: Vec2; rotation?: number }>;
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
}

interface ResolvedSpec {
  spec: FurnitureSet['items'][number];
  catalog: CatalogItem;
}

/**
 * Compute the shrink factor (≤ 1) needed for the set's overall footprint —
 * item centres AND their half-extents — to fit inside the room with a small
 * margin. The set is laid out around (0,0), so its extent is symmetric; we
 * measure the farthest reach along each axis and scale offsets (not item
 * sizes) uniformly so items never poke through the walls. Rooms can be as
 * small as 2×2 m while the sets assume up to ~4.4 m, so without this clamp
 * items land through the walls (#73).
 */
// Inset from the EXTERIOR half-width used when clamping generated placements.
// The room dimensions are exterior measurements, so ~0.35 m (wall thickness
// plus a small margin) keeps pieces from sitting under or inside the walls.
const WALL_INSET = 0.35;

function fitScale(specs: readonly ResolvedSpec[], roomWidth: number, roomDepth: number): number {
  const MARGIN = WALL_INSET;
  const usableHalfW = Math.max(0, roomWidth / 2 - MARGIN);
  const usableHalfD = Math.max(0, roomDepth / 2 - MARGIN);
  // Scale only the offsets: the item half-extents are fixed, so solve
  // s·|offset| + half ≤ usable for the tightest item on each axis.
  let scale = 1;
  for (const { spec, catalog } of specs) {
    const rotated = Math.abs(Math.round(((spec.rotation ?? 0) / (Math.PI / 2)) % 2)) === 1;
    const halfW = (rotated ? catalog.depth : catalog.width) / 2;
    const halfD = (rotated ? catalog.width : catalog.depth) / 2;
    if (spec.offset.x !== 0) {
      scale = Math.min(scale, (usableHalfW - halfW) / Math.abs(spec.offset.x));
    }
    if (spec.offset.z !== 0) {
      scale = Math.min(scale, (usableHalfD - halfD) / Math.abs(spec.offset.z));
    }
  }
  return Math.max(0, Math.min(1, scale));
}

/**
 * The largest item in a set must itself fit the room even at zero offset;
 * if it doesn't, the set can't be placed here at all.
 */
export function setFitsRoom(set: FurnitureSet, roomWidth: number, roomDepth: number): boolean {
  const MARGIN = WALL_INSET;
  for (const spec of set.items) {
    const catalog = FURNITURE_CATALOG.find((entry) => entry.type === spec.type);
    if (!catalog) continue;
    const rotated = Math.abs(Math.round(((spec.rotation ?? 0) / (Math.PI / 2)) % 2)) === 1;
    const w = rotated ? catalog.depth : catalog.width;
    const d = rotated ? catalog.width : catalog.depth;
    if (w > roomWidth - 2 * MARGIN || d > roomDepth - 2 * MARGIN) return false;
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

  const specs: ResolvedSpec[] = [];
  set.items.forEach((spec) => {
    const catalog = FURNITURE_CATALOG.find((entry) => entry.type === spec.type) as CatalogItem | undefined;
    if (!catalog) return;
    specs.push({ spec, catalog });
  });

  // If the room is known and even a single item can't fit, refuse the set
  // rather than drop pieces through the walls.
  if (roomWidth != null && roomDepth != null && !setFitsRoom(set, roomWidth, roomDepth)) {
    return [];
  }

  const scale = roomWidth != null && roomDepth != null ? fitScale(specs, roomWidth, roomDepth) : 1;

  const place = (s: number): FurnitureItem[] =>
    specs.map(({ spec, catalog }, index) => ({
      ...catalog,
      id: `${idPrefix}-${index}`,
      position: { x: center.x + spec.offset.x * s, z: center.z + spec.offset.z * s },
      rotation: spec.rotation ?? 0,
    }));

  const items = place(scale);

  // fitScale shrinks the offsets but not the item sizes, so a tight room can
  // slide pieces into each other. Some overlaps are authored (the office
  // computer and lamp sit ON the desk), so only an overlap that does NOT
  // exist in the unscaled layout means the room is too narrow — refuse the
  // set rather than stamp furniture embedded in furniture (#127).
  if (scale < 1) {
    const authored = place(1);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (itemsOverlap(items[i]!, items[j]!) && !itemsOverlap(authored[i]!, authored[j]!)) {
          return [];
        }
      }
    }
  }

  return items;
}
