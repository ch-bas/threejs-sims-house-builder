import { totalCost } from './geometry';
import type { RoomLayout } from './types';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  isMet(layout: RoomLayout): boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-steps',
    name: 'First Steps',
    description: 'Placed your first piece of furniture.',
    icon: '👟',
    isMet: (layout) => allItems(layout).length >= 1,
  },
  {
    id: 'furnished',
    name: 'Furnished',
    description: 'Placed 10 or more items in the building.',
    icon: '🪑',
    isMet: (layout) => allItems(layout).length >= 10,
  },
  {
    id: 'overstuffed',
    name: 'Overstuffed',
    description: 'Placed 25 or more items in the building.',
    icon: '📦',
    isMet: (layout) => allItems(layout).length >= 25,
  },
  {
    id: 'big-spender',
    name: 'Big Spender',
    description: 'Spent over §10,000 in total.',
    icon: '💸',
    isMet: (layout) => totalCost(allItems(layout)) >= 10_000,
  },
  {
    id: 'wifi-everywhere',
    name: 'Wi-Fi Everywhere',
    description: 'Placed at least one Wi-Fi access point.',
    icon: '📶',
    isMet: (layout) => allItems(layout).some((item) => item.isWiFiAccessPoint === true),
  },
  {
    id: 'sky-high',
    name: 'Sky High',
    description: 'Added a second floor to your building.',
    icon: '🌤',
    isMet: (layout) => layout.floors.length >= 2,
  },
  {
    id: 'penthouse',
    name: 'Penthouse',
    description: 'Stacked four floors tall.',
    icon: '🏙',
    isMet: (layout) => layout.floors.length >= 4,
  },
  {
    id: 'going-up',
    name: 'Going Up',
    description: 'Placed your first staircase.',
    icon: '🪜',
    isMet: (layout) => allItems(layout).some((item) => item.type === 'stairs'),
  },
  {
    id: 'roof-it',
    name: 'Roof It',
    description: 'Added a roof to your building.',
    icon: '🏠',
    isMet: (layout) => Boolean(layout.roof && layout.roof.style !== 'none'),
  },
  {
    id: 'green-thumb',
    name: 'Green Thumb',
    description: 'Placed three or more plants, trees, or flowerpots.',
    icon: '🌿',
    isMet: (layout) =>
      allItems(layout).filter((item) => ['plant', 'tree', 'flowerpot'].includes(item.type)).length >= 3,
  },
  {
    id: 'door-installer',
    name: 'Door Installer',
    description: 'Placed your first door.',
    icon: '🚪',
    isMet: (layout) => allItems(layout).some((item) => item.type === 'door'),
  },
  {
    id: 'window-watcher',
    name: 'Window Watcher',
    description: 'Placed three or more windows.',
    icon: '🪟',
    isMet: (layout) => allItems(layout).filter((item) => item.type === 'window').length >= 3,
  },
  {
    id: 'wall-whisperer',
    name: 'Wall Whisperer',
    description: 'Drew at least one interior wall.',
    icon: '🧱',
    isMet: (layout) =>
      layout.floors.some((floor) => (floor.interiorWalls?.length ?? 0) > 0),
  },
  {
    id: 'decorator',
    name: 'Decorator',
    description: 'Mixed at least six unique furniture types in one building.',
    icon: '🎨',
    isMet: (layout) => new Set(allItems(layout).map((item) => item.type)).size >= 6,
  },
  {
    id: 'open-plan',
    name: 'Open Plan',
    description: 'Built a layout under §3,000 with at least 5 items.',
    icon: '🪟',
    isMet: (layout) => {
      const items = allItems(layout);
      return items.length >= 5 && totalCost(items) < 3_000;
    },
  },
];

function allItems(layout: RoomLayout): RoomLayout['floors'][number]['items'] {
  return layout.floors.flatMap((floor) => floor.items);
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

export function saveUnlocked(unlocked: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(unlocked)));
  } catch {
    /* ignore */
  }
}
