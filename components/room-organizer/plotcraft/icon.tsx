/**
 * PlotCraft icon set — 1.5px stroke, currentColor, rounded caps/joins.
 * Mirrors .claude/skills/plotcraft-design/assets/icons/ with a handful of
 * additions (bed, bath, table, mirror, lock, unlock, copy, target, close,
 * delete-bin, save) authored in the same hand-drawn style. Anything outside
 * this set should fall back to lucide-react per the design system rules.
 */

import type { ReactNode, SVGProps } from 'react';

export type PlotcraftIconName =
  // From the kit
  | 'wall'
  | 'window'
  | 'door'
  | 'floor'
  | 'stairs'
  | 'roof'
  | 'fireplace'
  | 'plant'
  | 'light'
  | 'lamp'
  | 'chair'
  | 'brick'
  | 'build'
  | 'buy'
  | 'live'
  | 'sparkle'
  | 'undo'
  | 'rotate'
  | 'fastfwd'
  | 'magnify'
  | 'demolish'
  | 'plusminus'
  | 'chevL'
  | 'chevR'
  | 'arrowL'
  | 'arrowR'
  | 'arrowU'
  | 'arrowD'
  // Local additions (same visual language)
  | 'bed'
  | 'bath'
  | 'table'
  | 'mirror'
  | 'lock'
  | 'unlock'
  | 'copy'
  | 'target'
  | 'close'
  | 'box'
  | 'ruler'
  | 'coin'
  | 'save'
  | 'home'
  | 'panels'
  // Furniture-specific (for distinct catalog tiles)
  | 'sofa'
  | 'armchair'
  | 'bench'
  | 'desk'
  | 'dresser'
  | 'nightstand'
  | 'wardrobe'
  | 'bookshelf'
  | 'cabinet'
  | 'stove'
  | 'fridge'
  | 'sink'
  | 'toilet'
  | 'shower'
  | 'tv'
  | 'computer'
  | 'router'
  | 'wifi'
  | 'cctv'
  | 'painting'
  | 'rug'
  | 'vase'
  | 'tree'
  | 'fence'
  | 'pool'
  | 'person'
  // HUD toggles
  | 'minimap'
  | 'grid'
  | 'sound';

const PATHS: Record<PlotcraftIconName, ReactNode> = {
  wall: (
    <>
      <path d="M3 8l9 -4 9 4v8l-9 4 -9 -4z" />
      <path d="M3 8l9 4l9 -4" />
      <path d="M12 12v8" />
    </>
  ),
  window: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 4v16M4 12h16" />
    </>
  ),
  door: (
    <>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <circle cx="14.5" cy="13" r=".7" fill="currentColor" />
    </>
  ),
  floor: (
    <>
      <path d="M3 14l9 -5l9 5l-9 5z" />
      <path d="M7.5 11.5l9 5M16.5 11.5l-9 5" />
    </>
  ),
  stairs: (
    <>
      <path d="M3 20h4v-4h4v-4h4v-4h6" />
      <path d="M3 20v0M21 8v0" />
    </>
  ),
  roof: (
    <>
      <path d="M3 16l9 -10l9 10" />
      <path d="M5.5 16h13" />
    </>
  ),
  fireplace: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 9h16" />
      <path d="M9 19c0 -2 1 -3 1 -5c1 1 2 1 2 3c0 1 1 1.5 1 1.5s2 -1 2 -3.5c1 1.5 2 2 2 4" />
    </>
  ),
  plant: (
    <>
      <path d="M12 21v-7" />
      <path d="M12 14c-3 0 -5 -2 -5 -5c3 0 5 2 5 5z" />
      <path d="M12 14c3 0 5 -2 5 -5c-3 0 -5 2 -5 5z" />
      <path d="M12 11c0 -2 1 -4 3 -5" />
    </>
  ),
  light: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M9 14a5 5 0 1 1 6 0c-1 1 -1 2 -1 3h-4c0 -1 0 -2 -1 -3z" />
    </>
  ),
  lamp: (
    <>
      <path d="M9 4h6l2 6H7z" />
      <path d="M12 10v8" />
      <path d="M8 20h8" />
    </>
  ),
  chair: (
    <>
      <path d="M6 11V5a1 1 0 0 1 1 -1h10a1 1 0 0 1 1 1v6" />
      <path d="M5 11h14v3H5z" />
      <path d="M7 14v6M17 14v6" />
    </>
  ),
  brick: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 10h18M3 14h18M9 5v5M15 10v4M9 14v5" />
    </>
  ),
  build: (
    <>
      <path d="M14 4l6 6l-9 9H5v-6z" />
      <path d="M13 7l4 4" />
    </>
  ),
  buy: (
    <>
      <path d="M5 7h14l-1.5 11H6.5z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </>
  ),
  live: (
    <path d="M12 21c-5 -3 -8 -7 -8 -11a4 4 0 0 1 8 -1a4 4 0 0 1 8 1c0 4 -3 8 -8 11z" />
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8 -4.6L6 9l4.2 -1.4z" />
      <path d="M19 16l.8 1.8L21 19l-1.2 .6L19 22l-.8 -2.4L17 19l1.2 -.6z" />
    </>
  ),
  undo: (
    <>
      <path d="M4 8h11a5 5 0 0 1 5 5v0a5 5 0 0 1 -5 5h-7" />
      <path d="M4 8l4 -4M4 8l4 4" />
    </>
  ),
  rotate: (
    <>
      <path d="M4 12a8 8 0 1 1 2.4 5.7" />
      <path d="M4 18v-5h5" />
    </>
  ),
  fastfwd: (
    <>
      <path d="M4 6l7 6l-7 6z" />
      <path d="M13 6l7 6l-7 6z" />
    </>
  ),
  magnify: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.3 -4.3" />
      <path d="M9 11h4M11 9v4" />
    </>
  ),
  demolish: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V5h6v3" />
      <path d="M10 12v5M14 12v5" />
    </>
  ),
  plusminus: (
    <>
      <path d="M5 9h6M8 6v6" />
      <path d="M14 15h5" />
    </>
  ),
  chevL: <path d="M14 7l-5 5l5 5" />,
  chevR: <path d="M10 7l5 5l-5 5" />,
  arrowL: <path d="M15 6l-6 6l6 6" />,
  arrowR: <path d="M9 6l6 6l-6 6" />,
  arrowU: <path d="M6 15l6 -6l6 6" />,
  arrowD: <path d="M6 9l6 6l6 -6" />,

  // ---- local additions (same 1.5px stroke language) ----
  bed: (
    <>
      <path d="M3 18v-8a1 1 0 0 1 1 -1h7v6h10v3" />
      <path d="M3 14h18" />
      <path d="M21 18v-2" />
      <circle cx="6.5" cy="11.5" r="1.2" />
    </>
  ),
  bath: (
    <>
      <path d="M3 12h18v3a3 3 0 0 1 -3 3H6a3 3 0 0 1 -3 -3z" />
      <path d="M5 12V7a2 2 0 0 1 4 0v1" />
      <path d="M4 19l-1 2M20 19l1 2" />
    </>
  ),
  table: (
    <>
      <path d="M3 9h18" />
      <path d="M5 9v10M19 9v10" />
      <path d="M3 9l2 -3h14l2 3" />
    </>
  ),
  mirror: (
    <>
      <path d="M12 4v16" />
      <path d="M9 8l-4 4l4 4" />
      <path d="M15 8l4 4l-4 4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 7 -2.6" />
      <circle cx="12" cy="15.5" r="1.2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M4 16V5a1 1 0 0 1 1 -1h11" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  box: (
    <>
      <path d="M3 7l9 -4l9 4v10l-9 4l-9 -4z" />
      <path d="M3 7l9 4l9 -4M12 11v10" />
    </>
  ),
  ruler: (
    <>
      <path d="M4 15l11 -11l5 5l-11 11z" />
      <path d="M7 12l1.5 1.5M10 9l1.5 1.5M13 6l1.5 1.5" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9h3a1.5 1.5 0 0 1 0 3h-3v3h4" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l4 4v11a1 1 0 0 1 -1 1H5a1 1 0 0 1 -1 -1V5a1 1 0 0 1 1 -1z" />
      <path d="M8 4v5h7V4" />
      <rect x="8" y="13" width="8" height="7" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8 -7l8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  panels: (
    <>
      <rect x="3" y="4" width="6" height="16" rx="1.5" />
      <rect x="11" y="4" width="10" height="7" rx="1.5" />
      <rect x="11" y="13" width="10" height="7" rx="1.5" />
    </>
  ),

  // ---- furniture-specific glyphs ----
  sofa: (
    <>
      <path d="M3 14v3M21 14v3" />
      <path d="M4 14a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v3H4z" />
      <path d="M6 12V8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4" />
      <path d="M5 17v2M19 17v2" />
    </>
  ),
  armchair: (
    <>
      <path d="M6 14V8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v6" />
      <path d="M5 14h14v3H5z" />
      <path d="M6 17v2M18 17v2" />
      <path d="M5 14a2 2 0 0 1 -2 -2v-1M19 14a2 2 0 0 0 2 -2v-1" />
    </>
  ),
  bench: (
    <>
      <path d="M3 11h18v3H3z" />
      <path d="M5 14v6M19 14v6" />
      <path d="M3 17h18" />
    </>
  ),
  desk: (
    <>
      <path d="M3 9h18" />
      <path d="M3 9l1 -2h16l1 2" />
      <path d="M5 9v11" />
      <path d="M19 9v11" />
      <path d="M5 13h6" />
      <path d="M5 17h6" />
    </>
  ),
  dresser: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="1" />
      <path d="M4 10h16M4 15h16" />
      <path d="M10 7.5h4M10 12.5h4M10 17.5h4" />
    </>
  ),
  nightstand: (
    <>
      <rect x="6" y="7" width="12" height="13" rx="1" />
      <path d="M6 12h12" />
      <path d="M10 9.5h4M11 15.5h2" />
    </>
  ),
  wardrobe: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M12 3v18" />
      <circle cx="10.5" cy="12" r=".6" fill="currentColor" />
      <circle cx="13.5" cy="12" r=".6" fill="currentColor" />
    </>
  ),
  bookshelf: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M4 8h16M4 13h16M4 18h16" />
      <path d="M7 4v3M9 4v3M11 4v3M13 4v3" />
      <path d="M7 9v3M9 9v3M14 9v3M16 9v3" />
    </>
  ),
  cabinet: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M12 4v16" />
      <path d="M4 12h16" />
      <circle cx="10.5" cy="8" r=".6" fill="currentColor" />
      <circle cx="13.5" cy="8" r=".6" fill="currentColor" />
      <circle cx="10.5" cy="16" r=".6" fill="currentColor" />
      <circle cx="13.5" cy="16" r=".6" fill="currentColor" />
    </>
  ),
  stove: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 12h16" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="16" cy="8" r="1.5" />
      <path d="M7 15h3M14 15h3" />
      <path d="M7 18h10" />
    </>
  ),
  fridge: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <path d="M6 9h12" />
      <path d="M9 5.5v2" />
      <path d="M9 12v3" />
    </>
  ),
  sink: (
    <>
      <path d="M3 12h18v3a3 3 0 0 1 -3 3H6a3 3 0 0 1 -3 -3z" />
      <path d="M12 5v5" />
      <path d="M10 5h4" />
      <circle cx="12" cy="14.5" r=".7" fill="currentColor" />
    </>
  ),
  toilet: (
    <>
      <path d="M7 4h10v6H7z" />
      <path d="M6 10h12l-1.5 6h-9z" />
      <path d="M9 16v3M15 16v3" />
      <path d="M9 19h6" />
    </>
  ),
  shower: (
    <>
      <path d="M5 6h14l-2 5H7z" />
      <path d="M12 4v2" />
      <path d="M9 14l-1 2M12 14l-1 2M15 14l-1 2" />
      <path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5" width="18" height="11" rx="1.5" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
      <path d="M7 9h6" />
    </>
  ),
  computer: (
    <>
      <rect x="3" y="4" width="18" height="11" rx="1.5" />
      <path d="M9 20h6" />
      <path d="M10 15v5M14 15v5" />
      <path d="M6 7h5" />
    </>
  ),
  router: (
    <>
      <rect x="3" y="12" width="18" height="6" rx="1.5" />
      <circle cx="7" cy="15" r=".6" fill="currentColor" />
      <circle cx="10" cy="15" r=".6" fill="currentColor" />
      <path d="M8 12V8M14 12V6M18 12V9" />
    </>
  ),
  wifi: (
    <>
      <path d="M4 10a14 14 0 0 1 16 0" />
      <path d="M7 13a9 9 0 0 1 10 0" />
      <path d="M10 16a4 4 0 0 1 4 0" />
      <circle cx="12" cy="19" r=".9" fill="currentColor" />
    </>
  ),
  cctv: (
    <>
      <path d="M3 6h12l3 3v3H3z" />
      <path d="M6 12v3a2 2 0 0 0 2 2h4" />
      <path d="M9 17v3" />
      <circle cx="6" cy="9" r="1" />
    </>
  ),
  painting: (
    <>
      <rect x="4" y="4" width="16" height="14" rx="1" />
      <path d="M6 14l4 -5l3 4l2 -2l3 4" />
      <circle cx="9" cy="8" r="1" />
      <path d="M10 21h4" />
    </>
  ),
  rug: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M3 10h18M3 14h18" />
      <path d="M7 6v12M17 6v12" />
    </>
  ),
  vase: (
    <>
      <path d="M9 4h6" />
      <path d="M10 4v3a3 3 0 0 0 -3 3v7a3 3 0 0 0 3 3h4a3 3 0 0 0 3 -3v-7a3 3 0 0 0 -3 -3v-3" />
      <path d="M12 11c-1 -1.5 0 -3 1 -3" />
    </>
  ),
  tree: (
    <>
      <path d="M12 21v-5" />
      <path d="M7 13a5 5 0 0 1 3 -8a5 5 0 0 1 7 0a4 4 0 0 1 -2 7" />
      <path d="M7 13a3 3 0 1 0 1 5h7a3 3 0 0 0 2 -5" />
    </>
  ),
  fence: (
    <>
      <path d="M3 10h18M3 14h18" />
      <path d="M5 6v15l1 -1V7zM10 6v15l1 -1V7zM15 6v15l1 -1V7zM20 6v15l-1 -1V7z" />
    </>
  ),
  pool: (
    <>
      <ellipse cx="12" cy="13" rx="9" ry="5" />
      <path d="M5 11c1 -1 2 -1 3 0s2 1 3 0s2 -1 3 0s2 1 3 0s2 -1 2 0" />
      <path d="M5 15c1 -1 2 -1 3 0s2 1 3 0s2 -1 3 0s2 1 3 0s2 -1 2 0" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="6" r="2.4" />
      <path d="M8 21v-6a4 4 0 0 1 8 0v6" />
      <path d="M10 21v-4M14 21v-4" />
    </>
  ),
  minimap: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="13" y="13" width="6" height="6" rx="1" />
      <path d="M7 7l4 4M7 11l2-2" />
    </>
  ),
  grid: (
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  sound: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a4 4 0 0 1 0 7" />
      <path d="M18 5a8 8 0 0 1 0 14" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: PlotcraftIconName;
  size?: number;
}

export function Icon({ name, size = 24, ...props }: IconProps): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * Map a furniture catalog `type` (and an optional category fallback) to a
 * PlotCraft icon. Shared by the catalog tiles, the item-edit popover, and
 * the in-world hover tooltip so the same item always reads as the same glyph.
 */
const TYPE_TO_ICON: Record<string, PlotcraftIconName> = {
  // seating
  chair: 'chair', 'dining-chair': 'chair', armchair: 'armchair',
  sofa: 'sofa', bench: 'bench',
  // tables
  table: 'table', 'dining-table': 'table', 'coffee-table': 'table',
  'side-table': 'table', desk: 'desk',
  // bedroom
  bed: 'bed', dresser: 'dresser', nightstand: 'nightstand', wardrobe: 'wardrobe',
  // storage
  bookshelf: 'bookshelf', cabinet: 'cabinet',
  // kitchen
  stove: 'stove', fridge: 'fridge', dishwasher: 'cabinet',
  'kitchen-sink': 'sink', counter: 'table',
  // bathroom
  toilet: 'toilet', bathtub: 'bath', shower: 'shower', 'bathroom-sink': 'sink',
  // electronics
  tv: 'tv', computer: 'computer', lamp: 'lamp', 'floor-lamp': 'light',
  router: 'router', wifi: 'wifi', cctv: 'cctv',
  // decor
  plant: 'plant', flowerpot: 'vase', vase: 'vase',
  painting: 'painting', mirror: 'mirror', rug: 'rug',
  curtains: 'window', 'pendant-light': 'light', 'wall-shelf': 'box',
  'wall-clock': 'target', candles: 'sparkle', books: 'box',
  // outdoor
  tree: 'tree', 'pine-tree': 'tree', bush: 'plant', hedge: 'fence',
  flowerbed: 'plant', tulips: 'plant', sunflower: 'sparkle', 'rose-bush': 'plant',
  fence: 'fence', pool: 'pool', pond: 'pool',
  bbq: 'fireplace', mailbox: 'box', birdbath: 'bath',
  lamppost: 'light', 'stepping-stone': 'floor',
  'garden-bench': 'bench', 'picnic-table': 'table',
  // people
  person: 'person', pet: 'live',
  // structure
  door: 'door', window: 'window', stairs: 'stairs',
};

const CATEGORY_TO_ICON: Record<string, PlotcraftIconName> = {
  seating: 'chair', tables: 'table', bedroom: 'bed', storage: 'box',
  kitchen: 'fireplace', bathroom: 'bath', electronics: 'light',
  decor: 'plant', outdoor: 'tree', people: 'person', structure: 'window',
};

export function iconForItem(type: string, category?: string): PlotcraftIconName {
  return (
    TYPE_TO_ICON[type] ??
    (category ? CATEGORY_TO_ICON[category] : undefined) ??
    'box'
  );
}
