import { floorElevation, storeyHeight } from './storeys';
import type { FloorLayout, GameMode, ViewSettings } from './types';

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

/**
 * The walkthrough ceiling hangs this far under the storey above's floor
 * plate, which "show all floors" also draws (#276); the attic ceiling and
 * the partitions built while walking stop at the same line.
 */
export const WALKTHROUGH_CEILING_GAP = 0.01;

/**
 * Partition height while walking (#656). From orbit a partition stops 0.4 m
 * short of the ceiling (`interiorWallHeight`), a room divider built to be
 * seen from above; standing in the room that left an open slot over every
 * wall, through which the next room and its lamp light showed. Walking,
 * partitions reach the ceiling the walker sees, as the porch back wall has
 * since #275.
 */
export function walkthroughPartitionHeight(floor: Pick<FloorLayout, 'height'> | undefined): number {
  return storeyHeight(floor) - WALKTHROUGH_CEILING_GAP;
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

export interface WalkthroughPit {
  /** World Y of the storey below's floor, where a stairwell pit bottoms out. */
  y: number;
  /** World Y of the active storey's floor, which the stairwells cut. */
  topY: number;
}

/**
 * The drop the walker looks down through the active storey's stairwells, or
 * null on the ground floor (#359). The storey below isn't built, so without
 * a lined pit the stairwell looks straight down into the garden.
 */
export function walkthroughPit(
  floors: readonly Pick<FloorLayout, 'height'>[],
  activeFloorIndex: number
): WalkthroughPit | null {
  if (activeFloorIndex < 1 || activeFloorIndex >= floors.length) return null;
  return {
    y: floorElevation(floors, activeFloorIndex - 1),
    topY: floorElevation(floors, activeFloorIndex),
  };
}

/**
 * The mode to come back to when EXPLORE ends (#454): the last mode before it,
 * updated as the game mode changes. EXPLORE itself is never remembered.
 */
export function rememberModeBeforeExplore(remembered: GameMode, current: GameMode): GameMode {
  return current === 'live' ? remembered : current;
}

/** The game mode once the walkthrough is left: back to where EXPLORE was entered from (#454). */
export function modeAfterExplore(current: GameMode, remembered: GameMode): GameMode {
  return current === 'live' ? remembered : current;
}
