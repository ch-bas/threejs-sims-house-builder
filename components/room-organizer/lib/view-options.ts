import type { ViewSettings } from './types';

/** The view and snapping switches of the HUD's View menu (#341). */
export type ViewOptionKey =
  | 'measurementMode'
  | 'showItemLabels'
  | 'showHeatmap'
  | 'showOutdoor'
  | 'snapToWall'
  | 'snapToItems';

export const VIEW_OPTION_KEYS: readonly ViewOptionKey[] = [
  'measurementMode',
  'showItemLabels',
  'showHeatmap',
  'showOutdoor',
  'snapToWall',
  'snapToItems',
];

/**
 * Flip one View-menu switch. Switching a tool on also puts the editor where
 * the tool works: the distance tool picks points on the 3D floor, so it leaves
 * the 2D view and parks the other floor-click modes (wall and zone drawing),
 * which would otherwise claim the click first; the cost heatmap only exists on
 * the 2D plan, so it switches to it. Switching off changes nothing else.
 */
export function toggleViewOption(view: ViewSettings, key: ViewOptionKey): ViewSettings {
  const on = !view[key];
  if (on && key === 'measurementMode') {
    return { ...view, measurementMode: true, view2D: false, drawWallMode: false, drawZoneMode: false };
  }
  if (on && key === 'showHeatmap') {
    return { ...view, showHeatmap: true, view2D: true };
  }
  return { ...view, [key]: on };
}

/**
 * View invariants every change keeps, applied by the editor's view store:
 * zone drawing works on the 2D plan only, so leaving the plan (the `2` key,
 * the dock's 3D button, walkthrough) also leaves the draw mode, instead of
 * arming the next press on the plan when the user comes back (#439).
 * Returns `view` itself when nothing changes.
 */
export function withViewInvariants(view: ViewSettings): ViewSettings {
  if (view.drawZoneMode && !view.view2D) return { ...view, drawZoneMode: false };
  return view;
}
