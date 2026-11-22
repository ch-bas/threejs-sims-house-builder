import { MAX_ROOM_DIMENSION } from './constants';
import { cutoutRect, trimRectToCutout, type FootprintRect } from './footprint';
import { LOT_MARGIN, hasNeighbourOn } from './site';
import { entranceGeometry, entranceSteps, type EntranceBuilding } from './street';
import type { Frontage, GroundKind, GroundPatch, NeighbourSide, NeighbourSpec, RoomLayout, Vec2 } from './types';

/**
 * Garden surfaces (#924): paving, gravel, a timber deck or a lawn, drawn as
 * rectangles on the lot outside the house. Pure: the validation the schema
 * uses, the rule the reducer and the plan's draw gesture share, and what the
 * plan, the exports and the 3D lot draw.
 *
 * A surface lies on the lot (the house plus `LOT_MARGIN` each way, the
 * front stopping at the wall where the pavement runs up to it), clear of the
 * building (the L's notch is open ground), the porch steps and the houses
 * along a party wall, and clear of every other surface. A rectangle drawn
 * across any of them keeps its largest part beside it, as a zone does across
 * the cut corner.
 */

export const GROUND_KINDS: readonly GroundKind[] = ['paving', 'gravel', 'deck', 'lawn'];

export const GROUND_LABELS: Record<GroundKind, string> = {
  paving: 'Paving',
  gravel: 'Gravel',
  deck: 'Timber deck',
  lawn: 'Lawn',
};

/** The plan's fill and edge per kind: the on-screen plan, the blueprint and the SVG. */
export const GROUND_PLAN_COLORS: Record<GroundKind, { fill: string; edge: string }> = {
  paving: { fill: '#dcd6ca', edge: '#8f887a' },
  gravel: { fill: '#d3c8ae', edge: '#8c7f62' },
  deck: { fill: '#c49a6c', edge: '#7a5634' },
  lawn: { fill: '#b5d79a', edge: '#5f8f45' },
};

export const MAX_GROUNDS = 32;
/** The smallest surface, in either direction (m). */
export const MIN_GROUND_SIZE = 0.3;
/** Corners of a drawn surface round to this grid (m). */
const GROUND_GRID = 0.1;
/** A drawn corner this close to a wall line of the house lands on it, so a patio sits flush. */
const WALL_SNAP = 0.2;
/** The porch steps' start: three/room-builder's FOUNDATION_OVERHANG, the plinth ledge. */
const PLINTH_LEDGE = 0.35;

export type GroundRect = Pick<GroundPatch, 'x' | 'z' | 'w' | 'd'>;

/** What the rule reads of a house: its footprint, porch, party walls and frontage. */
export interface GroundSite extends EntranceBuilding {
  neighbours?: NeighbourSpec | undefined;
  frontage?: Frontage | undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isGroundKind(value: unknown): value is GroundKind {
  return GROUND_KINDS.includes(value as GroundKind);
}

/** A well-formed surface: a known kind and a sane rectangle. Where it lies is `fitGround`'s question. */
export function isGroundPatch(value: unknown): value is GroundPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    isGroundKind(v.kind) &&
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.z) &&
    isFiniteNumber(v.w) &&
    isFiniteNumber(v.d) &&
    Math.abs(v.x) <= MAX_ROOM_DIMENSION * 2 &&
    Math.abs(v.z) <= MAX_ROOM_DIMENSION * 2 &&
    v.w > 0 &&
    v.d > 0 &&
    v.w <= MAX_ROOM_DIMENSION * 2 &&
    v.d <= MAX_ROOM_DIMENSION * 2
  );
}

/** The lot surfaces may cover: the house and `LOT_MARGIN` around it, the front ending at the wall on a pavement frontage. */
export function groundLot(site: Pick<GroundSite, 'width' | 'height' | 'frontage'>): FootprintRect {
  const hw = site.width / 2;
  const hd = site.height / 2;
  return {
    x0: -hw - LOT_MARGIN,
    x1: hw + LOT_MARGIN,
    z0: site.frontage === 'pavement' ? -hd : -hd - LOT_MARGIN,
    z1: hd + LOT_MARGIN,
  };
}

/** The building as rectangles: the whole one, or the two wings of the L. */
export function buildingRects(site: Pick<GroundSite, 'width' | 'height' | 'cutout'>): FootprintRect[] {
  const hw = site.width / 2;
  const hd = site.height / 2;
  const notch = cutoutRect(site);
  if (!notch) return [{ x0: -hw, x1: hw, z0: -hd, z1: hd }];
  const north = notch.z0 <= -hd;
  const east = notch.x1 >= hw;
  const beside = east ? { x0: -hw, x1: notch.x0 } : { x0: notch.x1, x1: hw };
  return north
    ? [{ x0: -hw, x1: hw, z0: notch.z1, z1: hd }, { ...beside, z0: -hd, z1: notch.z1 }]
    : [{ x0: -hw, x1: hw, z0: -hd, z1: notch.z0 }, { ...beside, z0: notch.z0, z1: hd }];
}

/** The porch's flight down to the street, from the plinth ledge out (#204). */
function porchStepsRect(site: GroundSite): FootprintRect | null {
  if (!site.entrance) return null;
  const geometry = entranceGeometry(site.entrance, {
    width: site.width,
    depth: site.height,
    cutout: site.cutout,
    floors: site.floors,
    ...(site.terrain ? { terrain: site.terrain } : {}),
  });
  if (!geometry) return null;
  const steps = entranceSteps(geometry);
  if (steps.count === 0) return null;
  const landingZ = geometry.floorIndex === 0 ? geometry.frontZ - PLINTH_LEDGE : geometry.frontZ;
  return { x0: geometry.x0, x1: geometry.x1, z0: landingZ - steps.count * steps.going, z1: geometry.frontZ };
}

/**
 * How far back from the front wall the row of houses beside a party wall
 * reaches: the next-door house matches ours; further along a street they
 * run up to 15 % deeper, between 4 and 12 m (lib/street-row.ts).
 */
function neighbourRowDepth(site: Pick<GroundSite, 'height' | 'neighbours'>): number {
  const depth = site.height;
  return site.neighbours?.street === true ? Math.max(depth, Math.min(12, Math.max(4, depth * 1.15))) : depth;
}

/** What a blocker is, for the reason a drag on it lays nothing. */
type BlockerReason = 'on-house' | 'on-steps' | 'by-neighbour';

function labelledBlockers(site: GroundSite): Array<{ rect: FootprintRect; reason: BlockerReason }> {
  const hw = site.width / 2;
  const hd = site.height / 2;
  const lot = groundLot(site);
  const blockers = buildingRects(site).map((rect) => ({ rect, reason: 'on-house' as const }));
  const steps = porchStepsRect(site);
  const all: Array<{ rect: FootprintRect; reason: BlockerReason }> = [...blockers, ...(steps ? [{ rect: steps, reason: 'on-steps' as const }] : [])];
  const rowBack = -hd + neighbourRowDepth(site);
  for (const side of ['west', 'east'] as const satisfies readonly NeighbourSide[]) {
    if (!hasNeighbourOn(site.neighbours, side)) continue;
    const rect = side === 'east' ? { x0: hw, x1: lot.x1, z0: lot.z0, z1: rowBack } : { x0: lot.x0, x1: -hw, z0: lot.z0, z1: rowBack };
    all.push({ rect, reason: 'by-neighbour' });
  }
  return all;
}

/** Everything a surface keeps clear of: the building, the porch steps, the houses beside ours. */
export function groundBlockers(site: GroundSite): FootprintRect[] {
  return labelledBlockers(site).map(({ rect }) => rect);
}

/** Drops binary float noise (2.9999999999 → 3). */
function trimNoise(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function sameRect(a: GroundRect, b: GroundRect): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.d - b.d) < 1e-9;
}

/**
 * Where a surface can lie: inside the lot, its largest part clear of each
 * blocker in turn, or null when what is left is under `MIN_GROUND_SIZE`. A
 * rectangle that already fits comes back with the same values, so a re-fit
 * changes nothing. Other surfaces are `overlapsGround`'s question.
 */
export function fitGround(rect: GroundRect, site: GroundSite): GroundRect | null {
  const fitted = fitGroundOrWhy(rect, site);
  return 'rect' in fitted ? fitted.rect : null;
}

/** `fitGround`, or what left too little: the lot's edge, the pavement, the house, the steps, a neighbour. */
function fitGroundOrWhy(rect: GroundRect, site: GroundSite): { rect: GroundRect } | { refusal: GroundRefusal } {
  if (![rect.x, rect.z, rect.w, rect.d].every(isFiniteNumber) || !(rect.w > 0) || !(rect.d > 0)) return { refusal: 'too-small' };
  const lot = groundLot(site);
  const x0 = Math.max(lot.x0, rect.x);
  const z0 = Math.max(lot.z0, rect.z);
  const x1 = Math.min(lot.x1, rect.x + rect.w);
  const z1 = Math.min(lot.z1, rect.z + rect.d);
  if (!(x1 - x0 >= MIN_GROUND_SIZE) || !(z1 - z0 >= MIN_GROUND_SIZE)) {
    // Past the front wall on a pavement frontage is the street; anywhere else past the lot is off it.
    const street = site.frontage === 'pavement' && rect.z < lot.z0 && x1 - x0 >= MIN_GROUND_SIZE;
    return { refusal: street ? 'on-pavement' : 'off-lot' };
  }
  let fitted: GroundRect | null = { x: trimNoise(x0), z: trimNoise(z0), w: trimNoise(x1 - x0), d: trimNoise(z1 - z0) };
  for (const blocker of labelledBlockers(site)) {
    fitted = trimRectToCutout(fitted, blocker.rect);
    if (!fitted || fitted.w < MIN_GROUND_SIZE || fitted.d < MIN_GROUND_SIZE) return { refusal: blocker.reason };
  }
  const result = { x: trimNoise(fitted.x), z: trimNoise(fitted.z), w: trimNoise(fitted.w), d: trimNoise(fitted.d) };
  return { rect: sameRect(result, rect) ? { x: rect.x, z: rect.z, w: rect.w, d: rect.d } : result };
}

/** Whether a stored surface lies where the rule lets it, unchanged. A resized house or a new porch can cover one. */
export function groundFits(rect: GroundRect, site: GroundSite): boolean {
  const fitted = fitGround(rect, site);
  return fitted !== null && sameRect(fitted, rect);
}

/**
 * Why a stored surface isn't drawn (the house was resized, a porch or a
 * neighbour came, the lot shrank), or null when it fits: what a drag there
 * would be refused for, else what trims it first: the lot's edge, then the
 * blocker it lies on.
 */
export function groundMisfit(rect: GroundRect, site: GroundSite): Exclude<GroundRefusal, 'on-surface' | 'too-many'> | null {
  const fitted = fitGroundOrWhy(rect, site);
  if (!('rect' in fitted)) return fitted.refusal === 'on-surface' || fitted.refusal === 'too-many' ? null : fitted.refusal;
  if (sameRect(fitted.rect, rect)) return null;
  const lot = groundLot(site);
  const eps = 1e-9;
  if (rect.z < lot.z0 - eps && site.frontage === 'pavement') return 'on-pavement';
  if (rect.x < lot.x0 - eps || rect.z < lot.z0 - eps || rect.x + rect.w > lot.x1 + eps || rect.z + rect.d > lot.z1 + eps) return 'off-lot';
  const on = labelledBlockers(site).find(({ rect: b }) => groundsOverlap(rect, { x: b.x0, z: b.z0, w: b.x1 - b.x0, d: b.z1 - b.z0 }));
  return on?.reason ?? 'off-lot';
}

/** `groundMisfit`'s reasons, as the Garden panel lists a surface it doesn't draw. */
export const GROUND_MISFIT_NOTES: Record<NonNullable<ReturnType<typeof groundMisfit>>, string> = {
  'too-small': 'too little of it is left clear',
  'on-house': 'the house covers it',
  'on-steps': 'the porch steps cover it',
  'by-neighbour': 'the house next door stands there',
  'off-lot': `it reaches past the lot, ${LOT_MARGIN} m round the house`,
  'on-pavement': 'it lies on the pavement',
};

/** Whether two rectangles share any area (touching edges don't). */
export function groundsOverlap(a: GroundRect, b: GroundRect): boolean {
  const eps = 1e-9;
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.z < b.z + b.d - eps && b.z < a.z + a.d - eps;
}

/** Whether `rect` lies on another surface than `exceptId`. */
export function overlapsGround(rect: GroundRect, grounds: readonly GroundPatch[], exceptId?: string): boolean {
  return grounds.some((ground) => ground.id !== exceptId && groundsOverlap(rect, ground));
}

/** A corner on the grid, or on a wall line of the house when it's within `WALL_SNAP` of one. */
function snapCorner(value: number, lines: readonly number[]): number {
  for (const line of lines) if (Math.abs(value - line) <= WALL_SNAP) return line;
  return trimNoise(Math.round(value / GROUND_GRID) * GROUND_GRID);
}

/** The house's wall lines along x (`axis` 'x') or z, the L's notch included. */
function wallLines(site: Pick<GroundSite, 'width' | 'height' | 'cutout'>, axis: 'x' | 'z'): number[] {
  const half = axis === 'x' ? site.width / 2 : site.height / 2;
  const notch = cutoutRect(site);
  const lines = [-half, half];
  if (notch) lines.push(...(axis === 'x' ? [notch.x0, notch.x1] : [notch.z0, notch.z1]));
  return lines;
}

/**
 * The surface spanned by two dragged corners (any order): each corner on the
 * grid or a wall line, then fitted to the lot (`fitGround`). The plan's draw
 * gesture previews and commits this.
 */
export function groundFromCorners(a: Vec2, b: Vec2, site: GroundSite): GroundRect | null {
  const snapped = snappedCorners(a, b, site);
  return snapped && fitGround(snapped, site);
}

/** The dragged rectangle with its corners snapped, or null when it is under `MIN_GROUND_SIZE`. */
function snappedCorners(a: Vec2, b: Vec2, site: GroundSite): GroundRect | null {
  const xs = wallLines(site, 'x');
  const zs = wallLines(site, 'z');
  const x0 = snapCorner(Math.min(a.x, b.x), xs);
  const x1 = snapCorner(Math.max(a.x, b.x), xs);
  const z0 = snapCorner(Math.min(a.z, b.z), zs);
  const z1 = snapCorner(Math.max(a.z, b.z), zs);
  if (!(x1 - x0 >= MIN_GROUND_SIZE) || !(z1 - z0 >= MIN_GROUND_SIZE)) return null;
  return { x: x0, z: z0, w: trimNoise(x1 - x0), d: trimNoise(z1 - z0) };
}

/** Why a drawn rectangle adds nothing, for the plan to say. */
export type GroundRefusal = 'too-small' | 'on-house' | 'on-steps' | 'by-neighbour' | 'off-lot' | 'on-pavement' | 'on-surface' | 'too-many';

export const GROUND_REFUSAL_MESSAGES: Record<GroundRefusal, string> = {
  'too-small': 'Too small for a garden surface: drag out at least 30 cm each way.',
  'on-house': 'Garden surfaces go on the lot around the house, not on it.',
  'on-steps': 'That’s the porch steps: lay the surface beside them.',
  'by-neighbour': 'The house next door stands there.',
  'off-lot': `Garden surfaces stay on the lot, within ${LOT_MARGIN} m of the house.`,
  'on-pavement': 'The pavement runs up to the front wall: there is no front garden to lay it on.',
  'on-surface': 'That overlaps another garden surface.',
  'too-many': `A lot holds at most ${MAX_GROUNDS} garden surfaces: remove one first.`,
};

/**
 * What the draw gesture commits for corners `a`, `b` on this house: the
 * fitted rectangle, or why there is none. The reducer re-checks the same rule.
 */
export function drawnGround(a: Vec2, b: Vec2, site: GroundSite & { grounds?: readonly GroundPatch[] | undefined }): { rect: GroundRect } | { refusal: GroundRefusal } {
  // The cap counts every stored surface, covered ones too: they are kept in
  // the save and listed in the panel, where they can be removed.
  if ((site.grounds ?? []).length >= MAX_GROUNDS) return { refusal: 'too-many' };
  const snapped = snappedCorners(a, b, site);
  if (!snapped) return { refusal: 'too-small' };
  const fitted = fitGroundOrWhy(snapped, site);
  if (!('rect' in fitted)) return fitted;
  // Only a surface that is drawn blocks: one the house now covers doesn't.
  if (overlapsGround(fitted.rect, shownGrounds(site))) return { refusal: 'on-surface' };
  return fitted;
}

/** The surfaces to draw: those that still fit the house as it stands. Same array when all do. */
export function shownGrounds(layout: GroundSite & { grounds?: readonly GroundPatch[] | undefined }): readonly GroundPatch[] {
  const grounds = layout.grounds ?? [];
  if (grounds.length === 0) return grounds;
  const shown = grounds.filter((ground) => groundFits(ground, layout));
  return shown.length === grounds.length ? grounds : shown;
}

/** The surface under a point, last drawn first, or null. */
export function groundAt(grounds: readonly GroundPatch[], x: number, z: number): GroundPatch | null {
  for (let i = grounds.length - 1; i >= 0; i--) {
    const ground = grounds[i]!;
    if (x >= ground.x && x <= ground.x + ground.w && z >= ground.z && z <= ground.z + ground.d) return ground;
  }
  return null;
}

/** Whether a disc of `radius` at (x, z) reaches onto any of the surfaces. */
export function discOnGround(grounds: readonly GroundRect[], x: number, z: number, radius: number): boolean {
  return grounds.some((g) => x + radius > g.x && x - radius < g.x + g.w && z + radius > g.z && z - radius < g.z + g.d);
}

/** What the 3D lot and the GLB build the surfaces from: kind and rectangle of each shown one. */
export function groundsSceneKey(layout: GroundSite & { grounds?: readonly GroundPatch[] | undefined }): string {
  const shown = shownGrounds(layout);
  return shown.length === 0 ? '' : JSON.stringify(shown.map(({ kind, x, z, w, d }) => [kind, x, z, w, d]));
}

/** The world bounds of the shown surfaces, or null with none. */
export function groundsBounds(grounds: readonly GroundRect[]): FootprintRect | null {
  if (grounds.length === 0) return null;
  return {
    x0: Math.min(...grounds.map((g) => g.x)),
    x1: Math.max(...grounds.map((g) => g.x + g.w)),
    z0: Math.min(...grounds.map((g) => g.z)),
    z1: Math.max(...grounds.map((g) => g.z + g.d)),
  };
}

/** Area in m². */
export function groundArea(rect: GroundRect): number {
  return rect.w * rect.d;
}

// ---------------------------------------------------------------------------
// The reducer's edits: each returns `layout` itself when refused or unchanged.
// ---------------------------------------------------------------------------

/** What an edit may change: the kind, the rectangle, or both. */
export type GroundPatchEdit = Partial<Omit<GroundPatch, 'id'>>;

function withGrounds(layout: RoomLayout, grounds: GroundPatch[]): RoomLayout {
  if (grounds.length > 0) return { ...layout, grounds };
  const { grounds: _none, ...rest } = layout;
  return rest;
}

/** `layout` with `ground` added where the rule lets it lie, or `layout` itself when it can't. */
export function withGroundAdded(layout: RoomLayout, ground: GroundPatch): RoomLayout {
  const grounds = layout.grounds ?? [];
  if (grounds.length >= MAX_GROUNDS || !isGroundPatch(ground) || grounds.some((entry) => entry.id === ground.id)) return layout;
  const rect = fitGround(ground, layout);
  if (!rect || overlapsGround(rect, shownGrounds(layout))) return layout;
  return withGrounds(layout, [...grounds, { id: ground.id, kind: ground.kind, ...rect }]);
}

/**
 * `layout` with surface `id` changed. A new rectangle is fitted as an added
 * one is; a kind change alone keeps one the house now covers, so it can still
 * be re-laid or removed.
 */
export function withGroundUpdated(layout: RoomLayout, id: string, edit: GroundPatchEdit): RoomLayout {
  const grounds = layout.grounds ?? [];
  const current = grounds.find((ground) => ground.id === id);
  if (!current) return layout;
  const merged: GroundPatch = { ...current, ...edit, id };
  if (!isGroundPatch(merged)) return layout;
  const moved = merged.x !== current.x || merged.z !== current.z || merged.w !== current.w || merged.d !== current.d;
  let next = merged;
  if (moved) {
    const rect = fitGround(merged, layout);
    if (!rect || overlapsGround(rect, shownGrounds(layout), id)) return layout;
    next = { ...merged, ...rect };
  }
  if (next.kind === current.kind && sameRect(next, current)) return layout;
  return withGrounds(layout, grounds.map((ground) => (ground.id === id ? next : ground)));
}

export function withGroundRemoved(layout: RoomLayout, id: string): RoomLayout {
  const grounds = layout.grounds ?? [];
  if (!grounds.some((ground) => ground.id === id)) return layout;
  return withGrounds(layout, grounds.filter((ground) => ground.id !== id));
}

const GROUND_KEYS: readonly string[] =['id', 'kind', 'x', 'z', 'w', 'd'] satisfies readonly (keyof GroundPatch)[];
const MAX_GROUND_ID_LENGTH = 128;

/**
 * The schema's repair: a stored list is never refused, it keeps the
 * well-formed surfaces with only their own keys, the first of each id, up to
 * `MAX_GROUNDS`. Where each lies is not re-fitted: a save loads as stored,
 * and one the house now covers just isn't drawn (`shownGrounds`). Returns
 * the same array when nothing needed repair, undefined when nothing is left.
 */
export function repairGrounds(value: unknown): GroundPatch[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  let changed = false;
  const kept: GroundPatch[] = [];
  for (const entry of value as unknown[]) {
    if (kept.length >= MAX_GROUNDS || !isGroundPatch(entry) || entry.id.length > MAX_GROUND_ID_LENGTH || seen.has(entry.id)) {
      changed = true;
      continue;
    }
    seen.add(entry.id);
    if (Object.keys(entry).every((key) => GROUND_KEYS.includes(key))) {
      kept.push(entry);
    } else {
      changed = true;
      kept.push({ id: entry.id, kind: entry.kind, x: entry.x, z: entry.z, w: entry.w, d: entry.d });
    }
  }
  if (kept.length === 0) return undefined;
  return changed ? kept : (value as GroundPatch[]);
}
