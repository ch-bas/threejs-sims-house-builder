import type { InteriorWall, Vec2 } from './types';

/**
 * The two faces of a partition (#720). Side 'a' faces the wall's left going
 * from (x1, z1) to (x2, z2), in world terms the normal (-dz, dx), and is
 * `color`; side 'b' is the other and is `colorB`, when it differs.
 */
export type WallSide = 'a' | 'b';

/** The wall a click picked: which, and for a partition, the face it was on. */
export interface SelectedWall {
  id: string;
  kind: 'exterior' | 'interior';
  /** Undefined on a partition: both faces take the paint. */
  side?: WallSide;
}

/** The partition colour when none was painted. */
export const DEFAULT_INTERIOR_WALL_COLOR = '#e0e0e0';

/** Which face of the wall looks towards a point. */
export function wallSideAt(wall: InteriorWall, point: Vec2): WallSide {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  return (point.x - wall.x1) * -dz + (point.z - wall.z1) * dx >= 0 ? 'a' : 'b';
}

export function wallSideColor(wall: InteriorWall, side: WallSide): string {
  const front = wall.color ?? DEFAULT_INTERIOR_WALL_COLOR;
  return side === 'b' ? wall.colorB ?? front : front;
}

/**
 * The wall with one face painted, or both when `side` is undefined; the same
 * object when nothing changes. `colorB` exists only while the faces differ,
 * so a wall painted back to one colour is the plain wall it was.
 */
export function paintWallSide(wall: InteriorWall, color: string, side: WallSide | undefined): InteriorWall {
  const { colorB: _colorB, ...plain } = wall;
  const front = side === 'b' ? wallSideColor(wall, 'a') : color;
  const back = side === 'a' ? wallSideColor(wall, 'b') : color;
  const next: InteriorWall = { ...plain, ...(side === 'b' && wall.color === undefined ? {} : { color: front }), ...(front === back ? {} : { colorB: back }) };
  return next.color === wall.color && next.colorB === wall.colorB ? wall : next;
}
