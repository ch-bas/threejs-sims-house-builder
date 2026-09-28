/** Skirting (baseboard) profile shared by the exterior shell and interior walls. */
export const BASEBOARD_HEIGHT = 0.12;
export const BASEBOARD_DEPTH = 0.04;

/**
 * Clearance between a baseboard and a wall plane it runs along or ends at.
 * Flush, the faces were coplanar and z-fought — a dark band flickering
 * through the facade when seen from outside (#201).
 */
export const BASEBOARD_WALL_GAP = 0.003;

/** Shorter leftover pieces (e.g. between two doors) aren't worth a mesh. */
const MIN_RUN = 0.02;

export interface BaseboardOpening {
  /** Centre along the wall, in wall-local metres from its midpoint. */
  centerAlongWall: number;
  width: number;
  bottomFromFloor: number;
}

/**
 * The pieces of baseboard along the wall-local span [start, end], broken
 * wherever an opening reaches the floor — skirting doesn't run across a
 * doorway (#201). Openings that start above the baseboard (windows) don't
 * interrupt it.
 */
export function baseboardRuns(
  start: number,
  end: number,
  openings: readonly BaseboardOpening[]
): Array<[number, number]> {
  const gaps = openings
    .filter((opening) => opening.bottomFromFloor < BASEBOARD_HEIGHT)
    .map((opening): [number, number] => [
      opening.centerAlongWall - opening.width / 2,
      opening.centerAlongWall + opening.width / 2,
    ])
    .sort((a, b) => a[0] - b[0]);

  const runs: Array<[number, number]> = [];
  let cursor = start;
  for (const [gapStart, gapEnd] of gaps) {
    if (gapEnd <= cursor) continue;
    if (gapStart >= end) break;
    if (gapStart > cursor) runs.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (cursor < end) runs.push([cursor, end]);
  return runs.filter(([a, b]) => b - a >= MIN_RUN);
}
