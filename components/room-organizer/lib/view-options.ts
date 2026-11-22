import type { ViewSettings } from './types';

/** The view and snapping switches of the HUD's View menu (#341). */
export type ViewOptionKey =
  | 'measurementMode'
  | 'showItemLabels'
  | 'showHeatmap'
  | 'showFloorBelow'
  | 'showOutdoor'
  | 'snapToWall'
  | 'snapToItems';

export const VIEW_OPTION_KEYS: readonly ViewOptionKey[] = [
  'measurementMode',
  'showItemLabels',
  'showHeatmap',
  'showFloorBelow',
  'showOutdoor',
  'snapToWall',
  'snapToItems',
];

/**
 * Flip one View-menu switch. Switching a tool on also puts the editor where
 * the tool works: the distance tool picks points on the 3D floor or on the
 * plan (#921), so it stays in the view it was picked in and parks the other
 * floor-click modes (wall and zone drawing), which would otherwise claim the
 * click first; the cost heatmap and the floor underlay only exist on the 2D
 * plan, so they switch to it. Switching off changes nothing else.
 */
export function toggleViewOption(view: ViewSettings, key: ViewOptionKey): ViewSettings {
  const on = !view[key];
  if (on && key === 'measurementMode') {
    return { ...view, measurementMode: true, drawWallMode: false, drawZoneMode: false };
  }
  if (on && (key === 'showHeatmap' || key === 'showFloorBelow')) {
    return { ...view, [key]: true, view2D: true };
  }
  return { ...view, [key]: on };
}

/**
 * View invariants every change keeps, applied by the editor's view store:
 * zone drawing works on the 2D plan only, so leaving the plan (the `2` key,
 * the dock's 3D button, walkthrough) also leaves the draw mode, instead of
 * arming the next press on the plan when the user comes back (#439).
 * The distance tool gives way to wall or zone drawing picked after it, which
 * would otherwise share its clicks (#921): picking it parks them, so both on
 * means one of them came later. Returns `view` itself when nothing changes.
 */
export function withViewInvariants(view: ViewSettings): ViewSettings {
  if (view.drawZoneMode && !view.view2D) return withViewInvariants({ ...view, drawZoneMode: false });
  if (view.measurementMode && (view.drawWallMode || view.drawZoneMode)) return { ...view, measurementMode: false };
  return view;
}

/**
 * The dock's sound tile (#911) steps through three settings: off, the UI
 * cues, and the cues with EXPLORE's ambience (rain, footsteps, birds,
 * crickets and the doors). Muting turns
 * both off, so the ambience never plays with the sounds muted.
 */
export function nextSoundSetting(view: ViewSettings): ViewSettings {
  if (!view.soundsEnabled) return { ...view, soundsEnabled: true, ambienceEnabled: false };
  if (!view.ambienceEnabled) return { ...view, ambienceEnabled: true };
  return { ...view, soundsEnabled: false, ambienceEnabled: false };
}

/** What a press on the sound tile does next, for its label. */
export function soundTileLabel(view: Pick<ViewSettings, 'soundsEnabled' | 'ambienceEnabled'>): string {
  if (!view.soundsEnabled) return 'Enable sounds';
  if (!view.ambienceEnabled) return 'Add ambience: rain, footsteps, birds and doors in EXPLORE';
  return 'Mute sounds and ambience';
}
