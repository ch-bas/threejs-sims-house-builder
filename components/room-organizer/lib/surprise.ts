import { FURNITURE_CATALOG } from './constants';
import { buildFurnitureSet, FURNITURE_SETS } from './furniture-sets';
import type { CatalogItem, FurnitureItem } from './types';

const DECOR_TYPES = ['plant', 'flowerpot', 'rug', 'painting', 'vase', 'lamp', 'floor-lamp', 'mirror'] as const;

export interface SurpriseOptions {
  roomWidth: number;
  roomDepth: number;
  /** Approximate cost cap for the random pick; defaults to a generous budget. */
  maxCost?: number;
  /** Stable seed for the RNG; if omitted, uses Date.now(). */
  seed?: number;
}

/**
 * Generate a plausible furnished layout for a single floor:
 *   1. Pick a furniture set roughly proportioned to the room (lounge for
 *      large rooms, bedroom set for medium, etc.).
 *   2. Sprinkle 3–6 decorative items at non-overlapping random positions.
 *
 * Pure and deterministic when a seed is supplied — easy to test, and the
 * orchestrator can vary the seed each time the user clicks the button.
 */
export function surpriseLayout(options: SurpriseOptions): FurnitureItem[] {
  const { roomWidth, roomDepth, maxCost = 10_000, seed = Date.now() } = options;
  const rng = mulberry32(seed >>> 0);

  const set = chooseSet(roomWidth, roomDepth, rng);
  const setItems = buildFurnitureSet(set, { center: { x: 0, z: 0 }, idPrefix: `surprise-set-${seed}` });

  const decor: FurnitureItem[] = [];
  const decorCount = 3 + Math.floor(rng() * 4);
  let remainingBudget = Math.max(0, maxCost - sumPrice(setItems));

  for (let i = 0; i < decorCount; i++) {
    const choice = pickRandom(rng, eligibleDecor(remainingBudget));
    if (!choice) break;
    const position = randomPosition(rng, roomWidth, roomDepth, choice, [...setItems, ...decor]);
    if (!position) continue;
    decor.push({
      ...choice,
      id: `surprise-decor-${seed}-${i}`,
      position,
      rotation: 0,
    });
    remainingBudget -= choice.price;
  }

  return [...setItems, ...decor];
}

function chooseSet(width: number, depth: number, rng: () => number) {
  const area = width * depth;
  // Prefer the lounge in big rooms, bedroom in medium, office in small.
  const weighted: Array<[string, number]> = [
    ['lounge', area >= 25 ? 3 : 1],
    ['bedroom', area >= 12 && area < 30 ? 3 : 1],
    ['home-office', area < 16 ? 3 : 1],
    ['dining', 1],
    ['kitchen-line', width >= 4 ? 2 : 0.5],
  ];

  const totalWeight = weighted.reduce((sum, [, w]) => sum + w, 0);
  let pick = rng() * totalWeight;
  for (const [key, weight] of weighted) {
    pick -= weight;
    if (pick <= 0) {
      const found = FURNITURE_SETS.find((set) => set.key === key);
      if (found) return found;
    }
  }
  return FURNITURE_SETS[0]!;
}

function eligibleDecor(budget: number): readonly CatalogItem[] {
  const types = new Set<string>(DECOR_TYPES);
  return FURNITURE_CATALOG.filter((item) => types.has(item.type) && item.price <= budget);
}

function pickRandom<T>(rng: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

function sumPrice(items: readonly FurnitureItem[]): number {
  return items.reduce((sum, item) => sum + (item.price ?? 0), 0);
}

function randomPosition(
  rng: () => number,
  roomWidth: number,
  roomDepth: number,
  candidate: CatalogItem,
  existing: readonly FurnitureItem[]
): { x: number; z: number } | null {
  const halfW = candidate.width / 2;
  const halfD = candidate.depth / 2;
  const minX = -roomWidth / 2 + halfW;
  const maxX = roomWidth / 2 - halfW;
  const minZ = -roomDepth / 2 + halfD;
  const maxZ = roomDepth / 2 - halfD;
  if (minX > maxX || minZ > maxZ) return null;

  for (let attempt = 0; attempt < 30; attempt++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    if (!collides({ x, z, width: candidate.width, depth: candidate.depth }, existing)) {
      return { x, z };
    }
  }
  return null;
}

function collides(
  candidate: { x: number; z: number; width: number; depth: number },
  existing: readonly FurnitureItem[]
): boolean {
  const candidateRadius = Math.hypot(candidate.width / 2, candidate.depth / 2);
  for (const item of existing) {
    if (!item.position) continue;
    const itemRadius = Math.hypot(item.width / 2, item.depth / 2);
    const distance = Math.hypot(item.position.x - candidate.x, item.position.z - candidate.z);
    if (distance < candidateRadius + itemRadius + 0.1) return true;
  }
  return false;
}

/** Tiny seeded RNG — Mulberry32. Suits one-shot scene generation. */
function mulberry32(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
