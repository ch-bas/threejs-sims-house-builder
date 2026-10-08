import { floorElevation } from './storeys';
import type { FloorLayout, ViewSettings } from './types';

type WallDisplay = ViewSettings['wallDisplay'];

/**
 * The wall display the 3D scene uses. Walkthrough is its own display mode
 * (#359): the walker stands inside the house, so the orbit cutaway, which
 * hides the walls facing an outside camera, and walls-down would leave holes
 * in the rooms. Every wall and the roof are up while walking; the chosen
 * mode is left untouched and comes back on exit.
 */
export function sceneWallDisplay(mode: WallDisplay, walkthroughActive: boolean): WallDisplay {
  return walkthroughActive ? 'up' : mode;
}

export interface WalkthroughCeiling {
  /** World Y of the storey above's floor. */
  y: number;
  /** Top of the storey above: what the walker sees up a stairwell. */
  capY: number;
}

/**
 * The ceiling the walker sees on the active storey, or null when none is
 * needed (#359). Only the active storey is built, so on a lower floor nothing
 * renders the plate of the storey above; the top storey is covered by the
 * roof (or deliberately has none).
 */
export function walkthroughCeiling(
  floors: readonly Pick<FloorLayout, 'height'>[],
  activeFloorIndex: number
): WalkthroughCeiling | null {
  if (activeFloorIndex < 0 || activeFloorIndex >= floors.length - 1) return null;
  return {
    y: floorElevation(floors, activeFloorIndex + 1),
    capY: floorElevation(floors, activeFloorIndex + 2),
  };
}
