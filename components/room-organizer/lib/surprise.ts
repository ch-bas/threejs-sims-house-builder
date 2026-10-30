import { activeWriteOff, budgetBlockedReason, furnitureSpend, hardBudgetLoss, isHardBudgetOn, purchasePrice } from './budget';
import { CURRENCY_SYMBOL, FURNITURE_CATALOG } from './constants';
import { notify } from './editor-notices';
import { floorKeepOut } from './floor-keep-out';
import {
  FURNITURE_SETS,
  WALL_INSET,
  buildFurnitureSet,
  placeSetInFreeSpace,
  setFitsRoom,
  type FurnitureSet,
} from './furniture-sets';
import { hasCollisions, type CollisionContext, type KeepOutRect } from './geometry';
import { randomSuffix } from './ids';
import { isWallMounted, type WallGap } from './opening-snap';
import { storeyHeight } from './storeys';
import { entrancePlanOutline } from './street';
import type { ConfirmOptions } from './confirm-dialog';
import type { SoundCue } from './sounds';
import type { CatalogItem, FurnitureItem, InteriorWall, RoomLayout } from './types';

const DECOR_TYPES = ['plant', 'flowerpot', 'rug', 'painting', 'vase', 'lamp', 'floor-lamp', 'mirror'] as const;

/**
 * Decor built to hang on a wall: thin panels lifted off the floor. Dropped at
 * a random floor spot they stood in the room like a stray partition beside
 * the real wall, so they're hung flush on a wall instead.
 */
const WALL_ART_TYPES: ReadonlySet<string> = new Set(['painting', 'mirror']);

export interface SurpriseOptions {
  roomWidth: number;
  roomDepth: number;
  /** Cost cap for the set and the decor; defaults to a generous budget (#581). */
  maxCost?: number;
  /**
   * When no set is affordable, pick one anyway (the soft budget: the caller
   * asks before going over). Off, an unaffordable room gets decor only.
   */
  allowOverBudgetSet?: boolean;
  /** Stable seed for the RNG; if omitted, uses Date.now(). */
  seed?: number;
  /** What stays on the floor (structure, garden); nothing is generated on top of it (#448). */
  existing?: readonly FurnitureItem[];
  /** The storey's porch and stairwells (`floorKeepOut`). */
  keepOut?: readonly KeepOutRect[];
  /** The storey's partitions: no piece straddles one. */
  interiorWalls?: readonly InteriorWall[];
  /** The recess's span of the north wall: no art hangs across the opening. */
  frontGap?: WallGap | null;
  storeyHeight?: number;
}

/**
 * Generate a plausible furnished layout for a single floor:
 *   1. Pick a furniture set roughly proportioned to the room (lounge for
 *      large rooms, bedroom set for medium, etc.).
 *   2. Sprinkle 3–6 decorative items at non-overlapping random positions.
 *
 * Pure and deterministic when a seed is supplied — easy to test, and the
 * orchestrator can vary the seed each time the user clicks the button.
 */
export function surpriseLayout(options: SurpriseOptions): FurnitureItem[] {
  const { roomWidth, roomDepth, maxCost = 10_000, seed = Date.now() } = options;
  const rng = mulberry32(seed >>> 0);

  // When the caller pins a seed the result must stay reproducible, so ids are
  // keyed on the seed alone. With the default (Date.now) seed, two calls in the
  // same millisecond would otherwise produce identical ids — add a random tag so
  // stamping "Surprise Me" twice in a row yields distinct items.
  const idTag = options.seed === undefined ? `${seed}-${randomSuffix()}` : `${seed}`;

  const existing = options.existing ?? [];
  const interiorWalls = options.interiorWalls ?? [];
  const frontGap = options.frontGap ?? null;
  const context: CollisionContext = {
    keepOut: options.keepOut ?? [],
    interiorWalls,
    ...(options.storeyHeight !== undefined ? { storeyHeight: options.storeyHeight } : {}),
  };
  const room: Room = { width: roomWidth, depth: roomDepth, context, frontGap };

  const set = chooseSet(roomWidth, roomDepth, rng, maxCost, options.allowOverBudgetSet === true);
  // A set is only chosen when at least one fits by size; it lands on the free
  // spot nearest the room centre, clear of what the floor keeps (#448).
  const setItems = set
    ? placeSetInFreeSpace(set, {
        roomWidth,
        roomDepth,
        existing,
        keepOut: context.keepOut ?? [],
        interiorWalls,
        frontGap,
        ...(options.storeyHeight !== undefined ? { storeyHeight: options.storeyHeight } : {}),
        idPrefix: `surprise-set-${idTag}`,
      })
    : [];

  const decor: FurnitureItem[] = [];
  const decorCount = 3 + Math.floor(rng() * 4);
  let remainingBudget = Math.max(0, maxCost - purchasePrice(setItems));

  for (let i = 0; i < decorCount; i++) {
    const choice = pickRandom(rng, eligibleDecor(remainingBudget));
    if (!choice) break;
    const placed = [...existing, ...setItems, ...decor];
    const placement = WALL_ART_TYPES.has(choice.type)
      ? wallPosition(rng, room, choice, placed)
      : floorPosition(rng, room, choice, placed);
    if (!placement) continue;
    decor.push({
      ...choice,
      id: `surprise-decor-${idTag}-${i}`,
      position: placement.position,
      rotation: placement.rotation,
    });
    remainingBudget -= choice.price;
  }

  return [...setItems, ...decor];
}

/**
 * Structure and site, which Surprise keeps (#448): doors, windows and
 * cameras (the entrance door among them), stairs, and the garden.
 */
export function keptBySurprise(item: Pick<FurnitureItem, 'type' | 'category'>): boolean {
  return isWallMounted(item.type) || item.type === 'stairs' || item.category === 'outdoor';
}

/** Whether Surprise would replace anything on this floor, i.e. whether to ask first. */
export function surpriseReplacesFurniture(items: readonly FurnitureItem[]): boolean {
  return items.some((item) => !keptBySurprise(item));
}

/** What Surprise generates for a floor, and what it costs against the budget. */
interface SurprisePlan {
  /** The floor's items after Surprise: what it keeps plus the generated pieces. */
  items: FurnitureItem[];
  /** Price of the generated pieces. */
  price: number;
  /** Budget left for them: what the rest of the building and the sell-back leave. */
  remaining: number;
  hard: boolean;
}

function planSurprise(layout: RoomLayout, floorIndex: number, budget: number, seed?: number): SurprisePlan | null {
  const floor = layout.floors[floorIndex];
  if (!floor) return null;
  const kept = floor.items.filter(keptBySurprise);
  const replaced = floor.items.filter((item) => !keptBySurprise(item));
  // The same count as the header (`budgetSpent`): the porch door is free
  // (#382, #600). Under the hard budget, sell-back losses are spent too
  // (#463e), and that includes the loss on the furniture this replaces (#534).
  const spent = furnitureSpend(layout) - purchasePrice(replaced) + activeWriteOff(layout) + hardBudgetLoss(layout, replaced);
  const remaining = budget - spent;
  const hard = isHardBudgetOn(layout);
  const generated = surpriseLayout({
    roomWidth: layout.width,
    roomDepth: layout.height,
    maxCost: Math.max(0, remaining),
    allowOverBudgetSet: !hard,
    ...(seed !== undefined ? { seed } : {}),
    existing: kept,
    keepOut: floorKeepOut(layout, floorIndex),
    interiorWalls: floor.interiorWalls ?? [],
    frontGap: entrancePlanOutline(layout, floorIndex),
    storeyHeight: storeyHeight(floor),
  });
  return { items: [...kept, ...generated], price: purchasePrice(generated), remaining, hard };
}

/**
 * The floor's items after Surprise (#448): its structure and garden kept,
 * plus a generated set and decor fitted around them, the porch, the
 * stairwells and the partitions. The generated pieces spend what the rest
 * of the building leaves of `budget` (#581).
 */
export function surpriseFloorItems(layout: RoomLayout, floorIndex: number, budget: number, seed?: number): FurnitureItem[] {
  return planSurprise(layout, floorIndex, budget, seed)?.items ?? [];
}

/**
 * The Surprise button's whole decision (#581), with the dialogs injected:
 * under the hard budget, a floor with nothing affordable is refused BEFORE
 * any question (the caller plays `refused` and shows the reason); then it
 * asks before replacing furniture (#105); under the soft budget, a result
 * that goes over asks "Place it anyway?" like a catalogue buy (#136).
 * Returns the floor's new items, a refusal, or null when the player said no.
 */
export async function decideSurprise(
  layout: RoomLayout,
  floorIndex: number,
  budget: number,
  confirm: (question: ConfirmOptions) => Promise<boolean>,
  seed?: number
): Promise<{ items: FurnitureItem[] } | { refusal: string } | null> {
  const plan = planSurprise(layout, floorIndex, budget, seed);
  if (!plan) return null;
  const { items, price, remaining, hard } = plan;
  if (hard) {
    // Nothing generated because nothing is affordable: say so. The generator
    // never exceeds `remaining` under the hard budget; the price check is a
    // guard so the reducer never drops a confirmed Surprise silently.
    const cheapest = Math.min(...eligibleDecor(Infinity).map((item) => item.price));
    const refusal = price === 0 && remaining < cheapest ? budgetBlockedReason(cheapest, remaining) : budgetBlockedReason(price, remaining);
    if (refusal !== null) return { refusal };
  }
  const floor = layout.floors[floorIndex];
  if (
    floor &&
    surpriseReplacesFurniture(floor.items) &&
    !(await confirm({
      title: 'Replace the furniture on this floor with a surprise layout?',
      body: 'Walls, stairs and the garden stay. Undo brings the furniture back.',
      confirmLabel: 'Surprise me',
    }))
  ) {
    return null;
  }
  if (!hard && price > 0 && price > remaining) {
    const proceed = await confirm({
      title:
        `This ${CURRENCY_SYMBOL}${price.toLocaleString()} surprise puts you over the ` +
        `${CURRENCY_SYMBOL}${budget.toLocaleString()} budget. Place it anyway?`,
      confirmLabel: 'Place it anyway',
    });
    if (!proceed) return null;
  }
  return { items };
}

export interface SurpriseEffects {
  /** The in-app question (`askConfirm`); tests answer it directly. */
  confirm(question: ConfirmOptions): Promise<boolean>;
  playCue(cue: SoundCue): void;
  replaceItems(items: FurnitureItem[]): void;
  /**
   * The house on screen now. Read again after the question: if another
   * tab's version was adopted meanwhile, the surprise built for the old
   * house is dropped rather than applied to the new one.
   */
  current?(): RoomLayout;
}

/**
 * The Surprise button, for every place that shows one (the HUD and Layout
 * actions): `decideSurprise`, then either the refusal (the `refused` cue and
 * the reason as a notice, from here only) or the new floor. True when the
 * floor was replaced, so the caller can clear the selection. The question
 * is modal, so the layout it was asked about is still the one on screen.
 */
export async function runSurprise(layout: RoomLayout, floorIndex: number, budget: number, effects: SurpriseEffects): Promise<boolean> {
  const outcome = await decideSurprise(layout, floorIndex, budget, effects.confirm);
  if (outcome === null) return false;
  if (effects.current && effects.current() !== layout) {
    notify('The house changed while you were asked, so nothing was replaced. Try Surprise me again.', 'info');
    return false;
  }
  if ('refusal' in outcome) {
    effects.playCue('refused');
    notify(outcome.refusal, 'error');
    return false;
  }
  effects.replaceItems(outcome.items);
  return true;
}

function chooseSet(width: number, depth: number, rng: () => number, maxCost: number, allowOverBudget: boolean) {
  const area = width * depth;
  // Prefer the lounge in big rooms, bedroom in medium, office in small.
  const weighted: Array<[string, number]> = [
    ['lounge', area >= 25 ? 3 : 1],
    ['bedroom', area >= 12 && area < 30 ? 3 : 1],
    ['home-office', area < 16 ? 3 : 1],
    ['dining', 1],
    ['kitchen-line', width >= 4 ? 2 : 0.5],
  ];

  // Drop any candidate whose largest item can't fit the room, so a small
  // room never gets a set that would drop pieces through the walls (#73).
  const eligible = weighted
    .map(([key, weight]) => ({ set: FURNITURE_SETS.find((set) => set.key === key), weight }))
    .filter((entry): entry is { set: FurnitureSet; weight: number } =>
      entry.set != null && entry.weight > 0 && setFitsRoom(entry.set, width, depth)
    );
  // Only sets the budget covers (#581); the soft budget falls back to any
  // fitting set and the caller asks before going over.
  const affordable = eligible.filter(({ set }) => setPrice(set) <= maxCost);
  const pool = affordable.length > 0 || !allowOverBudget ? affordable : eligible;
  return pickWeighted(pool, rng);
}

/** A set's catalogue price, before any scaling to the room. */
function setPrice(set: FurnitureSet): number {
  return purchasePrice(buildFurnitureSet(set, { idPrefix: 'price' }));
}

function pickWeighted(eligible: ReadonlyArray<{ set: FurnitureSet; weight: number }>, rng: () => number): FurnitureSet | null {
  if (eligible.length === 0) return null;

  const totalWeight = eligible.reduce((sum, { weight }) => sum + weight, 0);
  let pick = rng() * totalWeight;
  for (const { set, weight } of eligible) {
    pick -= weight;
    if (pick <= 0) return set;
  }
  return eligible[eligible.length - 1]!.set;
}

function eligibleDecor(budget: number): readonly CatalogItem[] {
  const types = new Set<string>(DECOR_TYPES);
  return FURNITURE_CATALOG.filter((item) => types.has(item.type) && item.price <= budget);
}

function pickRandom<T>(rng: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

interface Placement {
  position: { x: number; z: number };
  rotation: number;
}

/** The floor decor is generated on: its size and what `hasCollisions` checks. */
interface Room {
  width: number;
  depth: number;
  context: CollisionContext;
  frontGap: WallGap | null;
}

function floorPosition(
  rng: () => number,
  room: Room,
  candidate: CatalogItem,
  existing: readonly FurnitureItem[]
): Placement | null {
  const { width: roomWidth, depth: roomDepth } = room;
  const halfW = candidate.width / 2;
  const halfD = candidate.depth / 2;
  const minX = -roomWidth / 2 + WALL_INSET + halfW;
  const maxX = roomWidth / 2 - WALL_INSET - halfW;
  const minZ = -roomDepth / 2 + WALL_INSET + halfD;
  const maxZ = roomDepth / 2 - WALL_INSET - halfD;
  if (minX > maxX || minZ > maxZ) return null;

  for (let attempt = 0; attempt < 30; attempt++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    if (collides({ x, z, width: candidate.width, depth: candidate.depth }, existing)) continue;
    // The porch, stairwells and partitions too, not just the other items (#448).
    const probe: FurnitureItem = { ...candidate, id: 'surprise-probe', position: { x, z }, rotation: 0 };
    if (!hasCollisions(probe, existing, roomWidth, roomDepth, room.context)) {
      return { position: { x, z }, rotation: 0 };
    }
  }
  return null;
}

/** Keeps hung art clear of the corners. */
const CORNER_CLEARANCE = 0.3;
/** Hairline between the art's back and the wall plane. */
const WALL_GAP = 0.01;

/**
 * Hang a piece of wall art on a random exterior wall: its back flush with
 * the wall, its face (local +z) turned into the room — the same seating a
 * wall-mounted camera gets.
 */
function wallPosition(
  rng: () => number,
  room: Room,
  candidate: CatalogItem,
  existing: readonly FurnitureItem[]
): Placement | null {
  const { width: roomWidth, depth: roomDepth, frontGap } = room;
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const inset = candidate.depth / 2 + WALL_GAP;
  for (let attempt = 0; attempt < 30; attempt++) {
    const wall = Math.floor(rng() * 4);
    const along = rng();
    const span = (wall < 2 ? roomWidth : roomDepth) / 2 - CORNER_CLEARANCE - candidate.width / 2;
    if (span < 0) continue;
    const offset = (along * 2 - 1) * span;
    // North, south, west, east — rotation turns local +z to face the room.
    const placement: Placement =
      wall === 0
        ? { position: { x: offset, z: -halfD + inset }, rotation: 0 }
        : wall === 1
          ? { position: { x: offset, z: halfD - inset }, rotation: Math.PI }
          : wall === 2
            ? { position: { x: -halfW + inset, z: offset }, rotation: Math.PI / 2 }
            : { position: { x: halfW - inset, z: offset }, rotation: -Math.PI / 2 };
    const { x, z } = placement.position;
    // The recess cuts the north wall there: nothing to hang art on (#448).
    if (wall === 0 && frontGap && x + candidate.width / 2 > frontGap.x0 && x - candidate.width / 2 < frontGap.x1) continue;
    if (!collides({ x, z, width: candidate.width, depth: candidate.depth }, existing)) return placement;
  }
  return null;
}

function collides(
  candidate: { x: number; z: number; width: number; depth: number },
  existing: readonly FurnitureItem[]
): boolean {
  const candidateRadius = Math.hypot(candidate.width / 2, candidate.depth / 2);
  for (const item of existing) {
    if (!item.position) continue;
    const itemRadius = Math.hypot(item.width / 2, item.depth / 2);
    const distance = Math.hypot(item.position.x - candidate.x, item.position.z - candidate.z);
    if (distance < candidateRadius + itemRadius + 0.1) return true;
  }
  return false;
}

/** Tiny seeded RNG — Mulberry32. Suits one-shot scene generation. */
function mulberry32(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
