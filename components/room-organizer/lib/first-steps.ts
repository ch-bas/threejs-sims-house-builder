import { welcomeTips, type WelcomeTip } from './hud-layout';
import { safeGetItem, safeSetItem } from './safe-storage';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID } from './street';
import type { LayoutChange } from './achievements';
import type { RoomLayout } from './types';

/**
 * The First steps card (#721): five things to do with a new house, in the
 * order the modes run. Progress is derived like achievements: an edit that
 * raises a step's count does it, a load (template, saved house, undo) does
 * nothing. Walking through and sharing aren't in the house; the editor marks
 * them when they happen. One small key stores whether the card is offered
 * or dismissed and which steps are done, so a reload keeps the ticks.
 */

export type FirstStepId = 'room' | 'door' | 'furnish' | 'walk' | 'share';

export interface FirstStep {
  id: FirstStepId;
  /** What to do, as the checklist says it. */
  title: string;
  /** The button that arms the tool for it. */
  action: string;
  /** How far along the house is, for the steps that live in it. */
  progress?(layout: RoomLayout): number;
}

export const FIRST_STEPS: readonly FirstStep[] = [
  {
    id: 'room',
    title: 'Draw a room',
    action: 'Walls',
    // The porch's back wall comes with the recessed entrance: structure.
    progress: (layout) =>
      layout.floors.reduce(
        (sum, floor) =>
          sum + (floor.interiorWalls ?? []).filter((wall) => wall.id !== ENTRANCE_WALL_ID).length + (floor.zones ?? []).length,
        0
      ),
  },
  {
    id: 'door',
    title: 'Add a door',
    action: 'Door',
    progress: (layout) => placed(layout).filter((item) => item.type === 'door').length,
  },
  {
    id: 'furnish',
    title: 'Furnish it',
    action: 'Furnish',
    progress: (layout) => placed(layout).filter((item) => !NOT_FURNITURE.has(item.category ?? '')).length,
  },
  { id: 'walk', title: 'Walk through it', action: 'Explore' },
  { id: 'share', title: 'Share it', action: 'Share' },
];

/** Openings, stairs, garden and people: placed, but not furnishing. */
const NOT_FURNITURE: ReadonlySet<string> = new Set(['structure', 'outdoor', 'people']);

function placed(layout: RoomLayout): RoomLayout['floors'][number]['items'] {
  return layout.floors.flatMap((floor) => floor.items.filter((item) => item.id !== ENTRANCE_DOOR_ID));
}

/**
 * The house steps a layout change does. An edit does a step when it raises
 * the step's count; a load does none, so a template's rooms and doors are
 * not the player's (#450).
 */
export function firstStepsEarned(
  change: LayoutChange,
  before: RoomLayout | null,
  now: RoomLayout,
  done: ReadonlySet<FirstStepId>
): FirstStepId[] {
  if (change === 'loaded' || before === null) return [];
  return FIRST_STEPS.filter((step) => !done.has(step.id) && step.progress !== undefined && step.progress(now) > step.progress(before)).map(
    (step) => step.id
  );
}

/** The first step not yet done, in order; null when all are. */
export function nextFirstStep(done: ReadonlySet<FirstStepId>): FirstStep | null {
  return FIRST_STEPS.find((step) => !done.has(step.id)) ?? null;
}

/** The step's own tip, then the welcome tips it makes relevant. */
export function firstStepTips(id: FirstStepId, touch: boolean): readonly WelcomeTip[] {
  const own = OWN_TIPS[id];
  const titles = new Set(WELCOME_TIPS_FOR[id]);
  return [...(own ? [touch ? own.touch : own.pointer] : []), ...welcomeTips(touch).filter((tip) => titles.has(tip.title))];
}

const OWN_TIPS: Partial<Record<FirstStepId, { pointer: WelcomeTip; touch: WelcomeTip }>> = {
  room: {
    pointer: { title: 'Walls', body: 'Click corner to corner to draw walls, or stamp a ready-made room shape.' },
    touch: { title: 'Walls', body: 'Tap corner to corner to draw walls, or stamp a ready-made room shape.' },
  },
  share: {
    pointer: { title: 'Share', body: 'The link carries the whole house: whoever opens it can look around.' },
    touch: { title: 'Share', body: 'The link carries the whole house: whoever opens it can look around.' },
  },
};

/** Titles from `welcomeTips`, per step: the old tips, shown when they matter. */
const WELCOME_TIPS_FOR: Readonly<Record<FirstStepId, readonly string[]>> = {
  room: ['Themes & sets'],
  door: ['Drag from the catalogue', 'Tap to add', 'Grid snap'],
  furnish: ['Move in 3D', 'Drag to move', 'Multi-select'],
  walk: ['Walkthrough', 'Look around'],
  share: [],
};

/** Whether the card was offered (by the start chooser) or dismissed. */
export type FirstStepsCardState = 'offered' | 'dismissed';

export const FIRST_STEPS_STORAGE_KEY = 'standalone-room-organizer-first-steps';

export interface FirstStepsRecord {
  card: FirstStepsCardState;
  done: ReadonlySet<FirstStepId>;
}

const STEP_IDS: readonly FirstStepId[] = ['room', 'door', 'furnish', 'walk', 'share'];

/**
 * The stored card; null when it was never offered: a player from before
 * the start chooser (#721) never sees the card. Stored as `{ card, room,
 * door, … }` with a boolean per step; anything else in it is ignored, and a
 * value that isn't such a record reads as never offered.
 */
export function loadFirstSteps(storage?: Storage): FirstStepsRecord | null {
  const raw = safeGetItem(FIRST_STEPS_STORAGE_KEY, storage);
  if (raw === null || raw.length > 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const card = record.card;
  if (card !== 'offered' && card !== 'dismissed') return null;
  return { card, done: new Set(STEP_IDS.filter((id) => Object.hasOwn(record, id) && record[id] === true)) };
}

export function saveFirstSteps(record: FirstStepsRecord, storage?: Storage): void {
  const stored: Record<string, unknown> = { card: record.card };
  for (const id of STEP_IDS) stored[id] = record.done.has(id);
  safeSetItem(FIRST_STEPS_STORAGE_KEY, JSON.stringify(stored), storage);
}
