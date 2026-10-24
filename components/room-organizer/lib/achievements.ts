import { CURRENCY_SYMBOL, DEFAULT_ROOF, ROOF_STYLE_DEFAULT_COLORS } from './constants';
import { totalCost } from './geometry';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID } from './street';
import type { RoomLayout } from './types';

// Furniture types that read as "planted greenery" in the catalog — kept in sync
// with the `outdoor`/`decor` plant entries in FURNITURE_CATALOG. Water features
// (pond, pool, birdbath) are intentionally excluded.
const PLANTED_TYPES: ReadonlySet<string> = new Set([
  'plant',
  'flowerpot',
  'tree',
  'pine-tree',
  'bush',
  'hedge',
  'flowerbed',
  'tulips',
  'sunflower',
  'rose-bush',
]);

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  isMet(layout: RoomLayout): boolean;
  /**
   * How far along the goal is, for goals that are counts (items, floors,
   * doors, …). An edit that raises it earns the goal even when a loaded house
   * already met it: placing another access point is doing the thing (#450).
   * Goals that aren't counts ("under §3,000") leave it out.
   */
  progress?(layout: RoomLayout): number;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    description: 'Placed your first piece of furniture.',
    icon: '👟',
    isMet: (layout) => allItems(layout).length >= 1,
    progress: (layout) => allItems(layout).length,
  },
  {
    id: 'furnished',
    name: 'Furnished',
    description: 'Placed 10 or more items in the building.',
    icon: '🪑',
    isMet: (layout) => allItems(layout).length >= 10,
    progress: (layout) => allItems(layout).length,
  },
  {
    id: 'overstuffed',
    name: 'Overstuffed',
    description: 'Placed 25 or more items in the building.',
    icon: '📦',
    isMet: (layout) => allItems(layout).length >= 25,
    progress: (layout) => allItems(layout).length,
  },
  {
    id: 'big-spender',
    name: 'Big Spender',
    description: `Own over ${CURRENCY_SYMBOL}10,000 of furniture.`,
    icon: '💸',
    // "over" means strictly greater than — exactly 10,000 doesn't count.
    isMet: (layout) => totalCost(allItems(layout)) > 10_000,
    progress: (layout) => totalCost(allItems(layout)),
  },
  {
    id: 'wifi-everywhere',
    name: 'Wi-Fi Everywhere',
    description: 'Placed at least one Wi-Fi access point.',
    icon: '📶',
    isMet: (layout) => allItems(layout).some((item) => item.isWiFiAccessPoint === true),
    progress: (layout) => allItems(layout).filter((item) => item.isWiFiAccessPoint === true).length,
  },
  {
    id: 'sky-high',
    name: 'Sky High',
    description: 'Added a second floor to your building.',
    icon: '🌤',
    isMet: (layout) => layout.floors.length >= 2,
    progress: (layout) => layout.floors.length,
  },
  {
    id: 'penthouse',
    name: 'Penthouse',
    description: 'Stacked four floors tall.',
    icon: '🏙',
    isMet: (layout) => layout.floors.length >= 4,
    progress: (layout) => layout.floors.length,
  },
  {
    id: 'going-up',
    name: 'Going Up',
    description: 'Placed your first staircase.',
    icon: '🪜',
    isMet: (layout) => allItems(layout).some((item) => item.type === 'stairs'),
    progress: (layout) => countType(layout, 'stairs'),
  },
  {
    id: 'roof-it',
    name: 'Roof It',
    description: 'Gave your building a roof of your own — a new style or colour.',
    icon: '🏠',
    // Every layout starts with the default roof, so "has a roof" was met before
    // the first click and could never actually be earned (#165).
    isMet: (layout) => {
      const roof = layout.roof;
      if (!roof || roof.style === 'none') return false;
      // Compare what's actually drawn: a colourless roof renders in its
      // style's default, which for a gable is not the starter colour.
      const color = roof.color ?? ROOF_STYLE_DEFAULT_COLORS[roof.style];
      return roof.style !== DEFAULT_ROOF.style || color.toLowerCase() !== DEFAULT_ROOF.color.toLowerCase();
    },
  },
  {
    id: 'green-thumb',
    name: 'Green Thumb',
    description: 'Placed three or more plants, trees, or flowers.',
    icon: '🌿',
    isMet: (layout) =>
      allItems(layout).filter((item) => PLANTED_TYPES.has(item.type)).length >= 3,
    progress: (layout) => allItems(layout).filter((item) => PLANTED_TYPES.has(item.type)).length,
  },
  {
    id: 'door-installer',
    name: 'Door Installer',
    description: 'Placed your first door.',
    icon: '🚪',
    isMet: (layout) => allItems(layout).some((item) => item.type === 'door'),
    progress: (layout) => countType(layout, 'door'),
  },
  {
    id: 'window-watcher',
    name: 'Window Watcher',
    description: 'Placed three or more windows.',
    icon: '🪟',
    isMet: (layout) => allItems(layout).filter((item) => item.type === 'window').length >= 3,
    progress: (layout) => countType(layout, 'window'),
  },
  {
    id: 'wall-whisperer',
    name: 'Wall Whisperer',
    description: 'Drew at least one interior wall.',
    icon: '🧱',
    isMet: (layout) =>
      layout.floors.some((floor) => (floor.interiorWalls ?? []).some((wall) => wall.id !== ENTRANCE_WALL_ID)),
    progress: (layout) =>
      layout.floors.reduce(
        (sum, floor) => sum + (floor.interiorWalls ?? []).filter((wall) => wall.id !== ENTRANCE_WALL_ID).length,
        0
      ),
  },
  {
    id: 'decorator',
    name: 'Decorator',
    description: 'Mixed at least six unique furniture types in one building.',
    icon: '🎨',
    isMet: (layout) => new Set(allItems(layout).map((item) => item.type)).size >= 6,
    progress: (layout) => new Set(allItems(layout).map((item) => item.type)).size,
  },
  {
    id: 'open-plan',
    name: 'Open Plan',
    description: `Built a layout under ${CURRENCY_SYMBOL}3,000 with at least 5 items.`,
    icon: '🏷️',
    isMet: (layout) => {
      const items = allItems(layout);
      return items.length >= 5 && totalCost(items) < 3_000;
    },
  },
];

/**
 * How the layout on screen came to be, as far as achievements care (#450).
 *
 * - `loaded`: a house the player didn't build here, or not just now: the
 *   starting house, the saved or shared house the session opens on, a
 *   template, a library house, a restore point, an import, a cross-tab
 *   adopt, an undo/redo step. It earns nothing; what the player really
 *   earned was saved when they earned it.
 * - `edit`: the player changed the house.
 */
export type LayoutChange = 'loaded' | 'edit';

/**
 * The achievements a layout change earns. An edit earns a goal it meets
 * when the goal wasn't met before it, or when the edit raised the goal's
 * own count: a template that already has an access point doesn't hand out
 * "Wi-Fi Everywhere", but placing another one earns it.
 */
export function achievementsEarned(
  change: LayoutChange,
  before: RoomLayout | null,
  now: RoomLayout,
  unlocked: ReadonlySet<string>
): Achievement[] {
  if (change === 'loaded' || before === null) return [];
  return ACHIEVEMENTS.filter((achievement) => {
    if (unlocked.has(achievement.id) || !achievement.isMet(now)) return false;
    if (!achievement.isMet(before)) return true;
    return achievement.progress !== undefined && achievement.progress(now) > achievement.progress(before);
  });
}

/**
 * Everything the player placed. The porch's door and back wall come with the
 * recessed entrance — structure, not furniture — so they earn nothing (#382).
 */
function allItems(layout: RoomLayout): RoomLayout['floors'][number]['items'] {
  return layout.floors.flatMap((floor) => floor.items.filter((item) => item.id !== ENTRANCE_DOOR_ID));
}

function countType(layout: RoomLayout, type: string): number {
  return allItems(layout).filter((item) => item.type === type).length;
}

const STORAGE_KEY = 'standalone-room-organizer-achievements';

export function loadUnlocked(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Persists the unlocks, merged with what is stored: another tab may have
 * unlocked something since this one loaded, and must not lose it.
 */
export function saveUnlocked(unlocked: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const merged = new Set([...loadUnlocked(), ...unlocked]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(merged)));
  } catch {
    /* ignore */
  }
}
