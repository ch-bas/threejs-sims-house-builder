/**
 * What the walkers show of their needs (#906): a thought bubble over a
 * walker whose most pressing need nothing it can reach meets, and the card
 * a tap on a walker opens. Pure: the bubble pick, the needs nothing meets
 * for a walker, and the small store the walk (hooks/use-npcs.ts) publishes
 * the card's snapshot to, twice a second. The card's words (names, lines)
 * live in lib/walker-card-text.ts, loaded with the card.
 */

import { NEED_KINDS, type NeedKind, type NeedSpot, type NpcNeeds, urgency } from './npc-needs';
import type { Rect } from './scene-insets';

/** A need this pressing (`urgency`, 0 to 1) shows a bubble: under a fifth full. */
export const BUBBLE_URGENCY = 0.6;
/** How often the open card's snapshot is published (seconds): 2 Hz, never per frame. */
export const WALKER_CARD_INTERVAL = 0.5;

/** A need's bit in a `strandedNeeds` mask. */
export function needBit(need: NeedKind): number {
  return 1 << NEED_KINDS.indexOf(need);
}

/**
 * The needs nothing meets for one walker, as a mask of `needBit`s: no spot
 * for that need that `canUse` allows (on its storey, reachable from where
 * it stands, a seat only for a walker that sits). A chair at a table is
 * where a meal is eaten, not where food is found, so it counts for nothing.
 * For a stop or a floor edit, not per frame.
 */
export function strandedNeeds(spots: readonly NeedSpot[], canUse: (spot: NeedSpot) => boolean): number {
  let met = 0;
  for (const spot of spots) {
    if (spot.meal || (met & needBit(spot.need)) !== 0) continue;
    if (canUse(spot)) met |= needBit(spot.need);
  }
  let all = 0;
  for (const need of NEED_KINDS) all |= needBit(need);
  return all & ~met;
}

/** What a walker is about: what the card's line and the bubble read. */
export interface WalkerDoing {
  asleep: boolean;
  /** Sitting, or on the way into or out of a seat. */
  seated: boolean;
  seeking: NeedKind | null;
  using: NeedKind | null;
}

/**
 * The need a walker's bubble shows, or null for none: its most pressing
 * need, when that is past `BUBBLE_URGENCY` and nothing the walker can
 * reach meets it (`stranded`, from `strandedNeeds`). None while it sleeps
 * or uses something, nor while it is on its way to meet that need.
 * Allocation-free: called every step.
 */
export function bubbleNeed(needs: NpcNeeds, stranded: number, doing: Readonly<WalkerDoing>): NeedKind | null {
  if (doing.asleep || doing.using !== null) return null;
  let worst: NeedKind | null = null;
  let worstUrgency = BUBBLE_URGENCY;
  for (const need of NEED_KINDS) {
    const pressing = urgency(needs, need);
    if (pressing > worstUrgency) {
      worst = need;
      worstUrgency = pressing;
    }
  }
  if (worst === null || worst === doing.seeking || (stranded & needBit(worst)) === 0) return null;
  return worst;
}

/** What the open card shows: a copy, so the walk can go on changing its own. */
export interface WalkerCardSnapshot {
  id: number;
  /** Picks the name (lib/walker-card-text `walkerName`): unique in the house. */
  seed: number;
  doing: Readonly<WalkerDoing>;
  needs: Readonly<NpcNeeds>;
  /** The bubble's need, if one shows: the card says what is missing. */
  wants: NeedKind | null;
}

/** Where on the page the tap was (client pixels): the card opens beside it. */
export interface CardAnchor {
  x: number;
  y: number;
}

/**
 * The open walker card, per editor: which walker it is for, and the last
 * snapshot the walk published for it. A store for `useSyncExternalStore`
 * (`subscribe`, `snapshot`); the walk reads `selected` and publishes, a
 * scene tap selects, the card's close button, Escape, back and a tap on
 * empty floor close.
 */
export interface WalkerCards {
  /** The walker the card is for, null while closed. */
  selected(): number | null;
  snapshot(): WalkerCardSnapshot | null;
  /** Where the tap that opened the card was. */
  anchor(): CardAnchor | null;
  subscribe(listener: () => void): () => void;
  /** Open the card for walker `id` (a tap on it at `at`); the walk fills it in. */
  select(id: number, at?: CardAnchor): void;
  /** The walk's latest for the selected walker; ignored for any other. */
  publish(card: WalkerCardSnapshot): void;
  close(): void;
}

export function createWalkerCards(): WalkerCards {
  let selected: number | null = null;
  let current: WalkerCardSnapshot | null = null;
  let anchor: CardAnchor | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    selected: () => selected,
    snapshot: () => current,
    anchor: () => anchor,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(id, at) {
      if (selected === id && !at) return;
      selected = id;
      current = null;
      anchor = at ?? null;
      emit();
    },
    publish(card) {
      if (card.id !== selected || sameCard(card, current)) return;
      current = card;
      emit();
    },
    close() {
      if (selected === null) return;
      selected = null;
      current = null;
      anchor = null;
      emit();
    },
  };
}

/** Bars move in whole percents: a publish that changes nothing the card shows re-renders nothing. */
function sameCard(a: WalkerCardSnapshot, b: WalkerCardSnapshot | null): boolean {
  if (!b || a.id !== b.id || a.seed !== b.seed || a.wants !== b.wants) return false;
  const da = a.doing;
  const db = b.doing;
  if (da.asleep !== db.asleep || da.seated !== db.seated || da.seeking !== db.seeking || da.using !== db.using) return false;
  return NEED_KINDS.every((need) => Math.round(a.needs[need] * 100) === Math.round(b.needs[need] * 100));
}

/** The card keeps this far (px) from the tap, the page's edges and the HUD. */
export const CARD_GAP = 14;
export const CARD_EDGE = 8;

/**
 * Where the walker card goes (#906): beside the tap at (x, y), above and
 * to the right by choice, on the page and clear of the HUD panels that
 * cover the scene (`occluders`, the scene occluders' rects). Tried: above
 * or below, right or left of the tap, and flush against each panel's
 * edges; the first clear of every panel, then of the tap itself, nearest
 * the first choice, wins. With no place clear of the HUD, the one that
 * covers least of it.
 */
export function placeWalkerCard(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  occluders: readonly Rect[]
): { left: number; top: number } {
  const { width, height } = size;
  const clampLeft = (left: number) => Math.min(Math.max(CARD_EDGE, left), viewport.width - width - CARD_EDGE);
  const clampTop = (top: number) => Math.min(Math.max(CARD_EDGE, top), viewport.height - height - CARD_EDGE);
  const above = anchor.y - CARD_GAP - height;
  const preferred = { left: clampLeft(anchor.x + CARD_GAP), top: clampTop(above >= CARD_EDGE ? above : anchor.y + CARD_GAP) };
  const lefts = [preferred.left, clampLeft(anchor.x - CARD_GAP - width)];
  const tops = [preferred.top, clampTop(anchor.y + CARD_GAP), clampTop(above)];
  for (const r of occluders) {
    lefts.push(clampLeft(r.right + CARD_EDGE), clampLeft(r.left - CARD_EDGE - width));
    tops.push(clampTop(r.bottom + CARD_EDGE), clampTop(r.top - CARD_EDGE - height));
  }
  let best = preferred;
  let bestScore = [Infinity, Infinity, Infinity];
  for (const left of lefts) {
    for (const top of tops) {
      let covered = 0;
      for (const r of occluders) {
        const w = Math.min(left + width, r.right) - Math.max(left, r.left);
        const h = Math.min(top + height, r.bottom) - Math.max(top, r.top);
        if (w > 0 && h > 0) covered += w * h;
      }
      const overTap = anchor.x > left && anchor.x < left + width && anchor.y > top && anchor.y < top + height ? 1 : 0;
      const score = [covered, overTap, Math.hypot(left - preferred.left, top - preferred.top)];
      if (score[0]! < bestScore[0]! || (score[0] === bestScore[0] && (score[1]! < bestScore[1]! || (score[1] === bestScore[1] && score[2]! < bestScore[2]!)))) {
        best = { left, top };
        bestScore = score;
      }
    }
  }
  return best;
}
