import { FURNITURE_CATALOG } from './constants';
import type { CatalogItem, DoorStyle, FurnitureItem, OpeningStyle, WindowStyle } from './types';

/**
 * Door and window types (#922): the style lives on the item, so the furniture
 * build key rebuilds the mesh on a change, and every reader (builder, plan,
 * SVG, DXF, swing clearance, EXPLORE) asks here. An absent style is the one
 * every door and window had before: a single swinging leaf, a four-pane window.
 */

export const DOOR_STYLES: readonly DoorStyle[] = ['single', 'double', 'sliding', 'arch'];
export const WINDOW_STYLES: readonly WindowStyle[] = ['standard', 'tall', 'fixed'];

const DOOR_STYLE_SET: ReadonlySet<string> = new Set(DOOR_STYLES);
const WINDOW_STYLE_SET: ReadonlySet<string> = new Set(WINDOW_STYLES);

/** Whether `style` is any door or window style. */
export function isOpeningStyle(style: unknown): style is OpeningStyle {
  return typeof style === 'string' && (DOOR_STYLE_SET.has(style) || WINDOW_STYLE_SET.has(style));
}

/** Whether `style` is one this item type comes in: what the editor stores. */
export function openingStyleFits(type: string, style: unknown): style is OpeningStyle {
  if (typeof style !== 'string') return false;
  if (type === 'door') return DOOR_STYLE_SET.has(style);
  if (type === 'window') return WINDOW_STYLE_SET.has(style);
  return false;
}

/** A door's style; `single` when it has none or isn't a door. */
export function doorStyle(item: Pick<FurnitureItem, 'type' | 'openingStyle'>): DoorStyle {
  return item.type === 'door' && item.openingStyle !== undefined && DOOR_STYLE_SET.has(item.openingStyle)
    ? (item.openingStyle as DoorStyle)
    : 'single';
}

/** A window's style; `standard` when it has none or isn't a window. */
export function windowStyle(item: Pick<FurnitureItem, 'type' | 'openingStyle'>): WindowStyle {
  return item.type === 'window' && item.openingStyle !== undefined && WINDOW_STYLE_SET.has(item.openingStyle)
    ? (item.openingStyle as WindowStyle)
    : 'standard';
}

/** Whether a door has leaves that swing: sliding doors and archways don't. */
export function hasDoorSwing(item: Pick<FurnitureItem, 'type' | 'openingStyle'>): boolean {
  if (item.type !== 'door') return false;
  const style = doorStyle(item);
  return style === 'single' || style === 'double';
}

/** A door frame's casing width, metres: the jambs and the head (`three/builders`). */
export const DOOR_FRAME = 0.06;
/** How much of a sliding door's opening, inside its frame, each of its two panes covers: they overlap in the middle. */
export const SLIDING_PANE_SHARE = 0.55;

/**
 * The stretch of a door's opening a walker can pass, in its local X:
 * the whole width, except on a sliding door, where the fixed pane (local
 * −X, +X when mirrored) stays shut and only the slid-open part is clear.
 */
export function doorWalkSpan(item: Pick<FurnitureItem, 'type' | 'openingStyle' | 'width' | 'mirrored'>): [number, number] {
  const half = item.width / 2;
  if (doorStyle(item) !== 'sliding') return [-half, half];
  const inner = Math.max(0, item.width - 2 * DOOR_FRAME);
  const from = -inner / 2 + inner * SLIDING_PANE_SHARE;
  const to = inner / 2;
  return item.mirrored ? [-to, -from] : [from, to];
}

/** A door leaf in the opening's local frame: the jamb it hangs on (−1 local −X, +1 local +X) and its width. */
export interface DoorLeafSpan {
  hinge: -1 | 1;
  width: number;
}

/**
 * The swinging leaves of a door, each as wide as its share of the opening:
 * one on a single door (on the +X jamb when mirrored, #386), two meeting in
 * the middle on a double door, none on a sliding door or an archway.
 */
export function doorLeafSpans(item: Pick<FurnitureItem, 'type' | 'openingStyle' | 'width' | 'mirrored'>): DoorLeafSpan[] {
  if (!hasDoorSwing(item)) return [];
  if (doorStyle(item) === 'double') {
    return [
      { hinge: -1, width: item.width / 2 },
      { hinge: 1, width: item.width / 2 },
    ];
  }
  return [{ hinge: item.mirrored ? 1 : -1, width: item.width }];
}

/** The catalogue entry a door or window of `style` comes from: its name, price and size. */
export function openingStyleEntry(type: string, style: OpeningStyle): CatalogItem | undefined {
  if (!openingStyleFits(type, style)) return undefined;
  const stored = storedOpeningStyle(type, style);
  return FURNITURE_CATALOG.find((entry: CatalogItem) => entry.type === type && entry.openingStyle === stored);
}

/** A door or window's current style, whichever it is. */
function currentStyle(item: Pick<FurnitureItem, 'type' | 'openingStyle'>): OpeningStyle {
  return item.type === 'door' ? doorStyle(item) : windowStyle(item);
}

/** The fields a type change sets; an `undefined` one is cleared (the default style, a window's own sill). */
export interface OpeningStylePatch {
  openingStyle: OpeningStyle | undefined;
  name?: string;
  price?: number;
  width?: number;
  height?: number;
  sillHeight?: number | undefined;
}

/**
 * What changing a door or window to `style` changes (#922): the style, and
 * from that type's catalogue entry its price and size, a window's sill, and
 * its name where it still has the old type's. A switch is a new door or
 * window at its usual size, as if bought from that tile; the price on the
 * item is what the budget counts. Null when nothing would change, or the
 * type doesn't come in that style.
 */
export function openingStylePatch(item: FurnitureItem, style: OpeningStyle): OpeningStylePatch | null {
  if (!openingStyleFits(item.type, style) || currentStyle(item) === style) return null;
  const from = openingStyleEntry(item.type, currentStyle(item));
  const to = openingStyleEntry(item.type, style);
  const patch: OpeningStylePatch = {
    openingStyle: storedOpeningStyle(item.type, style),
  };
  if (!to) return patch;
  patch.width = to.width;
  patch.height = to.height;
  patch.price = to.price;
  if (from && item.name === from.name) patch.name = to.name;
  // A window's sill comes with a type that has its own (the tall one), and
  // goes with it when it is still that type's; a sill set by hand stays.
  if (item.type === 'window') {
    if (to.sillHeight !== undefined) patch.sillHeight = to.sillHeight;
    else if (from?.sillHeight !== undefined && item.sillHeight === from.sillHeight) patch.sillHeight = undefined;
  }
  return patch;
}

/** The `openingStyle` to store for a choice: the default is stored as nothing. */
export function storedOpeningStyle(type: string, style: OpeningStyle): OpeningStyle | undefined {
  if (!openingStyleFits(type, style)) return undefined;
  return style === 'single' || style === 'standard' ? undefined : style;
}

/**
 * The archway's head (#922): where its curve springs from the jambs and how
 * high it rises to the crown, under the opening's top. A semicircle where
 * there is headroom for one, flatter (segmental) on a wide opening, so the
 * clear height under the springing stays at least `MIN_ARCH_SPRING` of it.
 */
export const MIN_ARCH_SPRING = 0.7;
/** The band of wall left over the crown, metres. */
export const ARCH_CROWN_BAND = 0.06;

export function archHead(width: number, height: number): { spring: number; crown: number; rise: number } {
  const crown = Math.max(0, height - ARCH_CROWN_BAND);
  const rise = Math.max(0, Math.min(width / 2, crown * (1 - MIN_ARCH_SPRING)));
  return { spring: crown - rise, crown, rise };
}
