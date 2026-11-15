import { ENTRANCE_WALL_ID } from './street';
import { paintWallSide, wallSideAt } from './wall-sides';
import type { FacadeFinish, FloorLayout, InteriorWall, Vec2, WallId, WallPattern } from './types';

/**
 * The outside of the outer walls (#918). A storey's `wallPattern` and
 * `wallColors` are the rooms' side; `facade` holds what differs outside, field
 * by field, so a facade with only a pattern keeps the inside colours and a
 * storey without one wears the inside finish both ways, as it always did.
 */

/** An outer wall the house never painted: warm cream (`DEFAULT_WALL_COLOR` in three/wall-patterns). */
const UNPAINTED_WALL = '#e8dcc4';

type FinishFields = Pick<FloorLayout, 'wallPattern' | 'wallColors' | 'facade'>;

/** What the outside faces wear: the facade's own fields, the inside finish for the rest. */
export function outsideFinish(floor: FinishFields): { pattern?: WallPattern; colors?: Partial<Record<WallId, string>> } {
  const pattern = floor.facade?.pattern ?? floor.wallPattern;
  const own = floor.facade?.colors;
  const colors = own && Object.keys(own).length > 0 ? { ...floor.wallColors, ...own } : floor.wallColors;
  return { ...(pattern ? { pattern } : {}), ...(colors ? { colors } : {}) };
}

export function outsidePattern(floor: FinishFields): WallPattern {
  return floor.facade?.pattern ?? floor.wallPattern ?? 'solid';
}

export function outsideColor(floor: FinishFields, wall: WallId): string {
  return floor.facade?.colors?.[wall] ?? floor.wallColors?.[wall] ?? UNPAINTED_WALL;
}

/** The facade with the empty parts dropped, or none at all: a storey back to one finish is the plain storey it was. */
function withFacade<T extends FinishFields>(floor: T, facade: FacadeFinish): T {
  const colors = facade.colors && Object.keys(facade.colors).length > 0 ? facade.colors : undefined;
  const { facade: _old, ...rest } = floor;
  if (!facade.pattern && !colors) return rest as T;
  return { ...rest, facade: { ...(facade.pattern ? { pattern: facade.pattern } : {}), ...(colors ? { colors } : {}) } } as T;
}

/**
 * The storey with its outside pattern set; `null` hands the outside back to
 * the inside pattern. The same object when the outside already shows it.
 */
export function setFacadePattern<T extends FinishFields>(floor: T, pattern: WallPattern | null): T {
  if (pattern === null) {
    if (floor.facade?.pattern === undefined) return floor;
    const { pattern: _dropped, ...rest } = floor.facade;
    return withFacade(floor, rest);
  }
  if (outsidePattern(floor) === pattern) return floor;
  return withFacade(floor, { ...floor.facade, pattern });
}

/**
 * The storey with one side's outside colour set; `null` hands that side back
 * to its inside colour. The same object when the outside already shows it.
 */
export function setFacadeColor<T extends FinishFields>(floor: T, wall: WallId, color: string | null): T {
  const own = floor.facade?.colors;
  if (color === null) {
    if (own?.[wall] === undefined) return floor;
    const { [wall]: _dropped, ...colors } = own;
    return withFacade(floor, { ...floor.facade, colors });
  }
  if (outsideColor(floor, wall).toLowerCase() === color.toLowerCase()) return floor;
  return withFacade(floor, { ...floor.facade, colors: { ...own, [wall]: color } });
}

/** The storey with the outside back on the inside finish. */
export function clearFacade<T extends FinishFields>(floor: T): T {
  if (floor.facade === undefined) return floor;
  const { facade: _dropped, ...rest } = floor;
  return rest as T;
}

/** The outside finish of one side, or null when it is the inside one. */
export function facadeFinish(
  facade: FacadeFinish | undefined,
  side: WallId,
  insidePattern: WallPattern,
  insideColor: string
): { pattern: WallPattern; color: string } | null {
  if (!facade) return null;
  const pattern = facade.pattern ?? insidePattern;
  const color = facade.colors?.[side] ?? insideColor;
  return pattern === insidePattern && color.toLowerCase() === insideColor.toLowerCase() ? null : { pattern, color };
}

/** The facade's colour on one side, or undefined when it is the inside one. */
export function facadeColorOf(floor: FinishFields, wall: WallId): string | undefined {
  const outside = outsideColor(floor, wall);
  const inside = floor.wallColors?.[wall] ?? UNPAINTED_WALL;
  return outside.toLowerCase() === inside.toLowerCase() ? undefined : outside;
}

/**
 * The porch is outdoors (#918): its back wall wears the facade's north colour
 * on the face toward the street, `toward`, unless that face was painted on
 * its own (a `colorB`). The walls unchanged when there is no such colour.
 */
export function withPorchFacade(walls: readonly InteriorWall[], facadeColor: string | undefined, toward: Vec2): readonly InteriorWall[] {
  if (facadeColor === undefined) return walls;
  return walls.map((wall) => {
    if (wall.id !== ENTRANCE_WALL_ID || wall.colorB !== undefined) return wall;
    return paintWallSide(wall, facadeColor, wallSideAt(wall, toward));
  });
}
