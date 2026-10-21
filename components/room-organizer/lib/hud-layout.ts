/**
 * The compact phone HUD (#395, #307): which viewports dock the HUD as a
 * slim bottom bar, and the small decisions the panels make about it. The
 * media queries must match the `@media` blocks in `app/globals.css`.
 */

/** Portrait phones and small tablets: the HUD docks as a bottom bar. */
export const PHONE_DOCK_QUERY = '(max-width: 768px)';

/** Landscape phones: short and not wide enough for the desktop HUD. */
export const SHORT_DOCK_QUERY = '(max-width: 1100px) and (max-height: 500px)';

/** Either compact dock: the catalog becomes one scrolling row of tiles. */
export const COMPACT_DOCK_QUERY = `${PHONE_DOCK_QUERY}, ${SHORT_DOCK_QUERY}`;

/** Touch-first devices get touch wording (#429). */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** The catalog strip's tiles per page: every item on one scrolling row when docked. */
export function catalogPageSize(itemCount: number, compact: boolean, desktopPageSize: number): number {
  return compact ? Math.max(1, itemCount) : desktopPageSize;
}

/**
 * Whether a scrolling column has content hidden below its bottom edge — the
 * cue that it scrolls (#426). A pixel of slack absorbs sub-pixel layout.
 */
export function hasContentBelow(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollTop + clientHeight < scrollHeight - 1;
}

export interface WelcomeTip {
  title: string;
  body: string;
}

const POINTER_TIPS: readonly WelcomeTip[] = [
  { title: 'Drag from catalog', body: 'Drop any catalog item onto the lot to place it exactly where you let go.' },
  { title: 'Move in 3D', body: 'Click and drag furniture, or select and nudge with the arrow keys — hold Shift for 1 m steps.' },
  { title: 'Grid snap', body: 'Press G to snap items you drag to a 0.5 m grid. Doors and windows snap to walls on their own.' },
  { title: 'Themes & sets', body: 'One-click templates rebuild the room. Library saves named layouts.' },
  { title: 'Walkthrough', body: 'Switch to EXPLORE to wander your home with WASD + Shift to sprint.' },
  { title: 'Multi-select', body: 'Ctrl/⌘-click to add items to a selection. Delete removes them all.' },
];

// No keyboard, no modifier keys and no pointer lock on a phone (#429): only
// what a finger can do.
const TOUCH_TIPS: readonly WelcomeTip[] = [
  { title: 'Tap to add', body: 'Tap a catalog tile to drop the item on the lot.' },
  { title: 'Drag to move', body: 'Drag an item with one finger to move it. Tap it to rotate, copy or delete it.' },
  { title: 'Look around', body: 'One finger orbits, pinch zooms, two fingers pan. Center makes one finger pan; Fit frames the house.' },
  { title: 'Grid snap', body: 'The grid button (under ⋯ on a phone) snaps items to 0.5 m. Doors and windows snap to walls on their own.' },
  { title: 'Themes & sets', body: 'Open the panels button for one-click templates, and the Library to save named layouts.' },
];

export function welcomeTips(touch: boolean): readonly WelcomeTip[] {
  return touch ? TOUCH_TIPS : POINTER_TIPS;
}
