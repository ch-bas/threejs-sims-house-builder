import { budgetOf, budgetRemaining, budgetSpent, isHardBudgetOn } from './budget';
import { DEFAULT_ROOF } from './constants';
import { formatMoney } from './format';
import { INITIAL_GROUND_FLOOR } from './initial-layout';
import { furnishedRooms, ROOM_CHECKS, ROOM_TYPE_LABELS, type KnownCollisions, type RoomType } from './room-score';
import type { FloorLayout, LayoutChallenge, RoomLayout } from './types';

/*
 * Challenge briefs (#909): a lot, funds and a few goals to meet. Pure and
 * static. A brief starts an empty house of its own size with its funds and
 * the hard budget on, and stores `layout.challenge` so the checklist rides
 * undo, saves, the library and share links with the house. Each goal is
 * read from the house as it stands, from the scorers the editor already
 * has: room types and stars (`houseRoomScores`), the money spent
 * (`budgetSpent`) and the storey count. Rooms are scored by zone, so a
 * room counts once a zone is drawn round it (`ZONE_HINT`).
 */

/** What the player must know for the room goals to count (#909). */
export const ZONE_HINT = 'Draw a zone round each room to score it.';

/** One thing a brief asks for, as data, so a goal's label and its check can't drift apart. */
export type ChallengeGoal =
  /** `count` rooms of `type`, each with `minStars` stars or more. */
  | { readonly kind: 'room'; readonly type: RoomType; readonly count: number; readonly minStars: number }
  /** Any room with every star. */
  | { readonly kind: 'five-star' }
  /** Spent (furniture standing plus what selling back lost) under `amount`. */
  | { readonly kind: 'spend-under'; readonly amount: number }
  /** At least `count` storeys. */
  | { readonly kind: 'floors'; readonly count: number }
  /** A lamp in every furnished room, and at least `rooms` of them. */
  | { readonly kind: 'lit-rooms'; readonly rooms: number };

export interface Challenge {
  readonly id: string;
  readonly name: string;
  /** One line on what the brief is about. */
  readonly brief: string;
  /** The lot: width (x) and depth (z) in metres. */
  readonly width: number;
  readonly depth: number;
  /** Storeys the shell starts with. */
  readonly floors: number;
  /** Funds, with the hard budget on. */
  readonly funds: number;
  readonly goals: readonly ChallengeGoal[];
  /** The badge its completion earns in the achievements (#909): an icon no other achievement uses. */
  readonly badge: string;
}

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'starter-home',
    name: 'Starter home',
    brief: 'A first place of your own on a small lot.',
    width: 9,
    depth: 7,
    floors: 1,
    funds: 8_000,
    badge: '🔑',
    goals: [
      { kind: 'room', type: 'bedroom', count: 1, minStars: 3 },
      { kind: 'room', type: 'kitchen', count: 1, minStars: 3 },
      { kind: 'room', type: 'bathroom', count: 1, minStars: 3 },
    ],
  },
  {
    id: 'shoestring-studio',
    name: 'Shoestring studio',
    brief: 'Somewhere to sleep and cook, for very little.',
    width: 6,
    depth: 5,
    floors: 1,
    funds: 4_000,
    badge: '🪙',
    goals: [
      { kind: 'room', type: 'bedroom', count: 1, minStars: 1 },
      { kind: 'room', type: 'kitchen', count: 1, minStars: 1 },
      { kind: 'spend-under', amount: 3_000 },
    ],
  },
  {
    id: 'family-of-four',
    name: 'Family of four',
    brief: 'Two bedrooms, room to cook and wash, over two storeys.',
    width: 10,
    depth: 8,
    floors: 1,
    funds: 20_000,
    badge: '🧸',
    goals: [
      { kind: 'room', type: 'bedroom', count: 2, minStars: 3 },
      { kind: 'room', type: 'kitchen', count: 1, minStars: 3 },
      { kind: 'room', type: 'bathroom', count: 1, minStars: 3 },
      { kind: 'floors', count: 2 },
    ],
  },
  {
    id: 'show-home',
    name: 'Show home',
    brief: 'One perfect room to sell the rest.',
    width: 8,
    depth: 8,
    floors: 1,
    funds: 12_000,
    badge: '🥇',
    goals: [
      { kind: 'five-star' },
      { kind: 'room', type: 'living', count: 1, minStars: 4 },
    ],
  },
  {
    id: 'night-shift',
    name: 'Night shift',
    brief: 'A home that works after dark.',
    width: 9,
    depth: 8,
    floors: 1,
    funds: 10_000,
    badge: '🌃',
    goals: [
      { kind: 'lit-rooms', rooms: 3 },
      { kind: 'room', type: 'study', count: 1, minStars: 3 },
    ],
  },
];

/** The brief with this id, or undefined (an id from a newer version, a typo in a file). */
export function challengeById(id: string): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}

/** The achievement a brief's completion records (#909): one per brief, earned once. */
export function challengeAchievementId(id: string): string {
  return `challenge-${id}`;
}

/** What the checklist says a goal asks for. */
export function goalLabel(goal: ChallengeGoal): string {
  switch (goal.kind) {
    case 'room': {
      const room = ROOM_TYPE_LABELS[goal.type].toLowerCase();
      const rooms = goal.count === 1 ? `A ${room}` : `${goal.count} ${room}s`;
      return `${rooms} at ${goal.minStars}★ or more`;
    }
    case 'five-star':
      return `A room with all ${ROOM_CHECKS.length} stars`;
    case 'spend-under':
      return `Spend under ${formatMoney(goal.amount)}`;
    case 'floors':
      return `${goal.count} storeys`;
    case 'lit-rooms':
      return `${goal.rooms} rooms, every one with a lamp`;
    default:
      return assertNever(goal);
  }
}

/** Whether a goal reads the room scores, which need zones. */
export function isRoomGoal(goal: ChallengeGoal): boolean {
  return goal.kind === 'room' || goal.kind === 'five-star' || goal.kind === 'lit-rooms';
}

/** Whether the house meets a goal right now. `known`: the editor's collisions on the active storey, as for `houseRoomScores`. */
export function goalMet(goal: ChallengeGoal, layout: RoomLayout, known?: KnownCollisions): boolean {
  switch (goal.kind) {
    case 'room':
      return furnishedRooms(layout, known).filter((room) => room.type === goal.type && room.stars >= goal.minStars).length >= goal.count;
    case 'five-star':
      return furnishedRooms(layout, known).some((room) => room.stars >= ROOM_CHECKS.length);
    case 'spend-under':
      return budgetSpent(layout) < goal.amount;
    case 'floors':
      return layout.floors.length >= goal.count;
    case 'lit-rooms': {
      const rooms = furnishedRooms(layout, known);
      return rooms.length >= goal.rooms && rooms.every((room) => !room.missing.includes('lamp'));
    }
    default:
      return assertNever(goal);
  }
}

/**
 * Why the house no longer keeps to its brief's terms, or null when it does
 * (#909): the hard budget on, funds no higher than the brief's, spent
 * within those funds, the brief's lot. A brief finished outside its terms
 * earns no badge. Spending is checked too: with the funds raised or the
 * budget off, a house can overspend, and lowering the funds or switching
 * the budget back on afterwards must not make it count.
 */
export function briefTermsBroken(layout: RoomLayout, challenge: Challenge): string | null {
  if (!isHardBudgetOn(layout)) return 'the hard budget is off';
  if (budgetOf(layout) > challenge.funds) return `funds raised over ${formatMoney(challenge.funds)}`;
  const remaining = budgetRemaining(layout) ?? 0;
  if (remaining < 0) return `spent ${formatMoney(-remaining)} over the funds`;
  if (layout.width !== challenge.width || layout.height !== challenge.depth) return 'the lot was resized';
  return null;
}

export interface ChallengeProgress {
  challenge: Challenge;
  goals: ReadonlyArray<{ label: string; met: boolean }>;
  met: number;
  /** Every goal met. */
  done: boolean;
  /** Why the house is outside the brief's terms, or null (`briefTermsBroken`). */
  termsBroken: string | null;
}

/** The house's brief and how far along it is, or null for a house with no brief (or one this version doesn't know). */
export function challengeProgress(layout: RoomLayout, known?: KnownCollisions): ChallengeProgress | null {
  const challenge = layout.challenge ? challengeById(layout.challenge.id) : undefined;
  if (!challenge) return null;
  const goals = challenge.goals.map((goal) => ({ label: goalLabel(goal), met: goalMet(goal, layout, known) }));
  const met = goals.filter((goal) => goal.met).length;
  return { challenge, goals, met, done: met === goals.length, termsBroken: briefTermsBroken(layout, challenge) };
}

/**
 * The empty house a brief starts from: its lot, its storeys, its funds with
 * the hard budget on, and the brief itself. `startedAt` is ms since the epoch.
 */
export function challengeLayout(challenge: Challenge, startedAt: number): RoomLayout {
  const floors: FloorLayout[] = Array.from({ length: challenge.floors }, (_, index) =>
    index === 0
      ? { ...INITIAL_GROUND_FLOOR, items: [] }
      : { id: `floor-${index + 1}`, name: `Floor ${index + 1}`, floorColor: INITIAL_GROUND_FLOOR.floorColor, items: [] }
  );
  return {
    name: challenge.name,
    width: challenge.width,
    height: challenge.depth,
    floors,
    roof: DEFAULT_ROOF,
    floorPlanOpacity: 0.5,
    floorPlanFitMode: 'stretch',
    budget: { writeOff: 0, amount: challenge.funds },
    challenge: { id: challenge.id, startedAt },
  };
}

/**
 * Whether `layout` is a brief's lot as it started, nothing done on it yet:
 * starting another brief over it asks nothing, as over the untouched
 * starting house. The house id is a label, not work, and is left out.
 */
export function isUntouchedChallengeLot(layout: RoomLayout): boolean {
  const challenge = layout.challenge ? challengeById(layout.challenge.id) : undefined;
  if (!challenge || !layout.challenge) return false;
  const { id: _id, ...content } = layout;
  return canonicalJson(content) === canonicalJson(challengeLayout(challenge, layout.challenge.startedAt));
}

/** JSON with every object's keys sorted: the schema and the store rebuild objects in their own key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

/**
 * The brief field as loaded from a save, file or link. It REPAIRS, never
 * refuses (see lib/schema.ts): anything that isn't a known brief with a sane
 * start time is dropped, and the house loads without it. Returns `value`
 * itself when it is already clean.
 */
export function repairChallenge(value: unknown): LayoutChallenge | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { id, startedAt } = value as { id?: unknown; startedAt?: unknown };
  if (typeof id !== 'string' || !challengeById(id)) return undefined;
  const start = typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt >= 0 ? startedAt : 0;
  if (start === startedAt && Object.keys(value).length === 2) return value as LayoutChallenge;
  return { id, startedAt: start };
}

function assertNever(value: never): never {
  throw new Error(`Unknown challenge goal: ${JSON.stringify(value)}`);
}
