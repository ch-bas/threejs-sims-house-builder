import { catalogFields } from './catalog-variants';
import { collisionReason, itemEntersRect, type KeepOutRect } from './geometry';
import { LOT_MARGIN, roadEdges } from './site';
import { WALL_ANGLE_STEP_DEG, WALL_GRID } from './wall-snap';
import type { CatalogItem, Frontage, FurnitureItem, NeighbourSpec, Vec2 } from './types';

/**
 * Runs of garden items (#915): with a fence, a hedge or a stepping stone in
 * hand, a drag lays a line of them in one go. Fence and hedge sections stand
 * end to end, the last one cut to fit; stepping stones keep a fixed pitch.
 * Every section is an ordinary item, so collision, locks, the plan, the
 * exports and undo treat them like any other. Pure: no React, no Three.js.
 */

/** How a run of one type is laid: sections cut to fit, or pieces at a fixed pitch. */
type RunKind = { kind: 'sections' } | { kind: 'pitch'; pitch: number };

const RUN_TYPES: Record<string, RunKind> = {
  fence: { kind: 'sections' },
  hedge: { kind: 'sections' },
  // A 0.6 m stone and a 0.3 m step of grass to the next.
  'stepping-stone': { kind: 'pitch', pitch: 0.9 },
};

/** A drag shorter than this on screen (CSS px) is a click: the one item, placed as usual. */
export const RUN_DRAG_PX = 12;
/** The shortest run (m): one grid step. Shorter, nothing is laid. */
export const MIN_RUN_LENGTH = WALL_GRID;
/** A last section shorter than this (m) isn't laid: the one before stretches over it instead. */
export const MIN_RUN_PIECE = 0.3;
/** An anchor or tip this close (m) to the free end of a section of the same type joins it. */
export const RUN_END_SNAP = 0.3;
/** Directions closer than this (radians) carry straight on rather than turn a corner. */
const STRAIGHT = 1e-3;

/** Whether the type is laid in runs. */
export function isRunItem(type: string): boolean {
  return Object.hasOwn(RUN_TYPES, type);
}

/** The step from one section's centre to the next along a run: the entry's width, or the type's pitch. */
export function runPitch(entry: Pick<CatalogItem, 'type' | 'width'>): number {
  const run = Object.hasOwn(RUN_TYPES, entry.type) ? RUN_TYPES[entry.type] : undefined;
  return run?.kind === 'pitch' ? run.pitch : entry.width;
}

/** The yaw that lays an item's width along the line from `from` to `to` (three turns +X towards -Z). */
export function runRotation(from: Vec2, to: Vec2): number {
  return -Math.atan2(to.z - from.z, to.x - from.x) + 0;
}

export interface RunOptions {
  /** Centre-to-centre step; default `runPitch(entry)`. */
  pitch?: number;
  /** Ids for the sections, in order. Default `run-<i>`. */
  makeId?: (index: number) => string;
  /** How far (m) the first section starts past `from`: clear of the section it turns a corner from. */
  insetStart?: number;
  /** How far (m) the last section stops short of `to`: clear of the section it turns a corner onto. */
  insetEnd?: number;
}

/**
 * The items a run from `from` to `to` lays. Sections (fence, hedge) stand end
 * to end along the line, each `pitch` wide, the last cut to what is left; a
 * stub under MIN_RUN_PIECE is no section of its own, the one before stretches
 * over it. Pitched items (stepping stones) keep
 * their size, one every `pitch` from half a pitch in. Each turned to the line,
 * locked as a placed item is. Empty for a run shorter than MIN_RUN_LENGTH.
 */
export function layRun(from: Vec2, to: Vec2, entry: CatalogItem, options: RunOptions = {}): FurnitureItem[] {
  const pitch = options.pitch ?? runPitch(entry);
  const inset = Math.max(0, options.insetStart ?? 0);
  const total = Math.hypot(to.x - from.x, to.z - from.z);
  if (!(pitch > 0) || !Number.isFinite(total) || total < MIN_RUN_LENGTH) return [];
  const length = total - inset - Math.max(0, options.insetEnd ?? 0);
  if (length < MIN_RUN_LENGTH - 1e-9) return [];
  const ux = (to.x - from.x) / total;
  const uz = (to.z - from.z) / total;
  const rotation = runRotation(from, to);
  const fields = catalogFields(entry);
  const makeId = options.makeId ?? ((index: number) => `run-${index}`);
  const at = (along: number): Vec2 => ({ x: from.x + ux * (inset + along), z: from.z + uz * (inset + along) });

  const pieces: Array<{ along: number; width: number }> = [];
  const run = Object.hasOwn(RUN_TYPES, entry.type) ? RUN_TYPES[entry.type] : undefined;
  if (run?.kind === 'pitch') {
    // Float error must not lose the last stone of an exact multiple.
    const count = Math.max(1, Math.floor(length / pitch + 1e-9));
    for (let i = 0; i < count; i += 1) pieces.push({ along: (i + 0.5) * pitch, width: entry.width });
  } else {
    const whole = Math.floor(length / pitch + 1e-9);
    for (let i = 0; i < whole; i += 1) pieces.push({ along: (i + 0.5) * pitch, width: pitch });
    const rest = length - whole * pitch;
    const last = pieces.at(-1);
    if (last && rest < MIN_RUN_PIECE - 1e-9) {
      // A stub joins the last whole section, which stretches over it.
      if (rest > 1e-9) pieces[pieces.length - 1] = { along: last.along + rest / 2, width: last.width + rest };
    } else if (rest > 1e-9 || !last) {
      pieces.push({ along: whole * pitch + rest / 2, width: rest });
    }
  }

  return pieces.map(({ along, width }, index) => ({
    ...fields,
    id: makeId(index),
    locked: true,
    position: at(along),
    rotation,
    ...(Math.abs(width - entry.width) > 1e-9 ? { width } : {}),
  }));
}

/**
 * The two ends of a laid section's centre line: its width, or for a pitched
 * item (a stepping stone) its pitch, so a run joined straight on keeps the step.
 */
export function sectionEnds(item: Pick<FurnitureItem, 'type' | 'width' | 'rotation' | 'position'>): [Vec2, Vec2] | null {
  if (!item.position) return null;
  const angle = item.rotation ?? 0;
  const length = runPitch(item);
  const hx = (Math.cos(angle) * length) / 2;
  const hz = (-Math.sin(angle) * length) / 2;
  return [
    { x: item.position.x - hx, z: item.position.z - hz },
    { x: item.position.x + hx, z: item.position.z + hz },
  ];
}

export interface RunSnap {
  point: Vec2;
  /** The section whose end it joined, if any. */
  joined: FurnitureItem | null;
}

/** The garden a run stays in (world metres): the lot round the house, short of the street. */
export interface RunLot {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface RunSite {
  width: number;
  height: number;
  frontage?: Frontage | undefined;
  neighbours?: NeighbourSpec | undefined;
}

/**
 * The lot a run is drawn in: LOT_MARGIN past the house on each side, none on
 * a side with a party-wall neighbour, and to the north (the street side) no
 * further than the pavement's near edge, so a run never reaches the road.
 */
export function runLot(site: RunSite): RunLot {
  const halfW = site.width / 2;
  const halfD = site.height / 2;
  return {
    x0: site.neighbours?.west === true ? -halfW : -halfW - LOT_MARGIN,
    x1: site.neighbours?.east === true ? halfW : halfW + LOT_MARGIN,
    z0: -Math.min(halfD + LOT_MARGIN, roadEdges(halfD, site.frontage).near),
    z1: halfD + LOT_MARGIN,
  };
}

function clampToLot(point: Vec2, lot: RunLot): Vec2 {
  return { x: Math.min(lot.x1, Math.max(lot.x0, point.x)), z: Math.min(lot.z1, Math.max(lot.z0, point.z)) };
}

/** How far a ray from a point in the lot runs before it leaves it. */
function reachInRunLot(from: Vec2, dirX: number, dirZ: number, lot: RunLot): number {
  const along = (start: number, dir: number, low: number, high: number): number =>
    dir > 1e-9 ? (high - start) / dir : dir < -1e-9 ? (low - start) / dir : Infinity;
  return Math.max(0, Math.min(along(from.x, dirX, lot.x0, lot.x1), along(from.z, dirZ, lot.z0, lot.z1)));
}

/**
 * Where a run's anchor or tip lands, inside `lot` when one is given. On the
 * end of a section of the same type within RUN_END_SNAP, so runs chain; else,
 * with an anchor, turned to the nearest 15° step at a length on the 0.1 m
 * grid (the wall tool's steps), stopped at the lot's edge; else on the grid.
 */
export function snapRunPoint(
  point: Vec2,
  anchor: Vec2 | null,
  type: string,
  items: readonly FurnitureItem[],
  lot: RunLot | null = null
): RunSnap {
  let joined: FurnitureItem | null = null;
  let best: Vec2 | null = null;
  let bestDist = RUN_END_SNAP;
  for (const item of items) {
    if (item.type !== type) continue;
    for (const end of sectionEnds(item) ?? []) {
      // The anchor's own end is no target for the tip.
      if (anchor && Math.hypot(end.x - anchor.x, end.z - anchor.z) < 1e-6) continue;
      const distance = Math.hypot(end.x - point.x, end.z - point.z);
      if (distance < bestDist) {
        bestDist = distance;
        best = end;
        joined = item;
      }
    }
  }
  if (best) return { point: lot ? clampToLot(best, lot) : best, joined };
  if (anchor) {
    const length = Math.hypot(point.x - anchor.x, point.z - anchor.z);
    if (length > 1e-9) {
      const step = (WALL_ANGLE_STEP_DEG * Math.PI) / 180;
      const steps = Math.round(Math.atan2(point.z - anchor.z, point.x - anchor.x) / step);
      // Rounded so the axes are exact: cos(90°) is 6e-17.
      const dirX = Math.round(Math.cos(steps * step) * 1e12) / 1e12;
      const dirZ = Math.round(Math.sin(steps * step) * 1e12) / 1e12;
      const room = lot ? reachInRunLot(anchor, dirX, dirZ, lot) : Infinity;
      // Within the lot, still on the grid.
      const reach = Math.min(onGrid(length), Math.floor(room / WALL_GRID + 1e-9) / 10);
      return { point: { x: anchor.x + dirX * reach, z: anchor.z + dirZ * reach }, joined: null };
    }
  }
  const gridded = { x: onGrid(point.x), z: onGrid(point.z) };
  return { point: lot ? clampToLot(gridded, lot) : gridded, joined: null };
}

/** Divides by 10, as 3 * 0.1 is 0.30000000000000004; + 0 turns -0 into 0. */
function onGrid(value: number): number {
  return Math.round(value / WALL_GRID) / 10 + 0;
}

/** Clearance (m) added to a corner inset, so float error never reads as an overlap. */
const INSET_SLACK = 1e-3;

/**
 * How far a run starting at `end`, the free end of the section `joined`, and
 * heading for `toward` must start past `end` to clear that section when it
 * turns a corner there: the new first section then meets the old one's side
 * or end instead of overlapping it. None carrying straight on, or with
 * nothing joined. The same holds for a run's last section ending on one.
 */
export function cornerInset(end: Vec2, toward: Vec2, joined: Pick<FurnitureItem, 'depth' | 'position'> | null): number {
  if (!joined?.position) return 0;
  const outX = end.x - joined.position.x;
  const outZ = end.z - joined.position.z;
  const out = Math.hypot(outX, outZ);
  const run = Math.hypot(toward.x - end.x, toward.z - end.z);
  if (out < 1e-9 || run < 1e-9) return 0;
  // The turn from the old section's outward direction to the new run's.
  const cos = (outX * (toward.x - end.x) + outZ * (toward.z - end.z)) / (out * run);
  const sin = Math.abs(outX * (toward.z - end.z) - outZ * (toward.x - end.x)) / (out * run);
  if (sin < STRAIGHT && cos > 0) return 0;
  const half = Math.max(joined.depth, 0) / 2;
  // Clear of its side (across the old section), or past its end (along it).
  const acrossSide = sin < STRAIGHT ? Infinity : (half * (1 + Math.abs(cos))) / sin;
  const pastEnd = cos > STRAIGHT ? (half * sin) / cos : Infinity;
  const inset = Math.min(acrossSide, pastEnd);
  return Number.isFinite(inset) ? inset + INSET_SLACK : 0;
}

/** What a run costs: every section at the entry's price. */
export function runPrice(items: readonly Pick<FurnitureItem, 'price'>[]): number {
  return items.reduce((sum, item) => sum + (item.price ?? 0), 0);
}

/** What a drawn run can lay. */
export interface RunFit {
  /** The sections that will be laid. */
  sections: FurnitureItem[];
  /** How many were left out: in the house or on the porch. */
  dropped: number;
  /** An item already there that a section would stand in: the run is refused as a whole. */
  blocker: FurnitureItem | null;
}

export interface RunFitContext {
  /** The ground floor's items. */
  items: readonly FurnitureItem[];
  roomWidth: number;
  roomDepth: number;
  /** The ground floor's keep-out (`floorKeepOut`): the porch and the cut corner. */
  keepOut: readonly KeepOutRect[];
}

/**
 * Fits a drawn run to the site (#915): a section that would stand in the
 * house or on the porch is left out, a gap in the run (a fence drawn across
 * the house goes round it). Any other section standing in an item already
 * there names it as the blocker, and the run is laid whole or not at all.
 */
export function fitRun(sections: readonly FurnitureItem[], context: RunFitContext): RunFit {
  const porches = context.keepOut.filter((rect) => !rect.hole && !rect.cutout);
  const kept: FurnitureItem[] = [];
  let blocker: FurnitureItem | null = null;
  for (const section of sections) {
    if (porches.some((rect) => itemEntersRect(section, rect))) continue;
    const reason = collisionReason(section, context.items, context.roomWidth, context.roomDepth, { keepOut: context.keepOut });
    if (reason?.kind === 'building') continue;
    kept.push(section);
    if (!blocker && reason?.kind === 'item') blocker = context.items.find((item) => item.id === reason.id) ?? null;
  }
  return { sections: kept, dropped: sections.length - kept.length, blocker };
}
