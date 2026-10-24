import { CURRENCY_SYMBOL, DEFAULT_BUDGET } from './constants';
import { ENTRANCE_DOOR_ID } from './street';
import type { FurnitureItem, HardBudget, RoomLayout } from './types';

/*
 * Budget as a game (#463e). The hard budget is opt-in per house: with
 * `layout.budget` absent the budget only advises, as it always has. Once
 * switched on, the field stays: switching off keeps the write-off as
 * `{ writeOff, enabled: false }`, so off-and-on again can't wipe the 20 %
 * lost on sales. A house that never sold anything drops the field again.
 *
 * Where the money lives: what you have spent is never stored. It is the
 * price of everything standing in the house, plus `budget.writeOff` — what
 * was lost selling things back at less than their price. That one number
 * is layout state, so it rides undo/redo, autosave, the library, restore
 * points and share links with the rest of the house, and a house that
 * gains furniture by any route (paste, a set, a template) is charged for
 * it without each route having to remember to.
 */

/** Share of an item's price Demolish pays back while the hard budget is on. */
export const SELL_BACK_RATE = 0.8;

/** Cap on the stored write-off: far past any house the editor can hold. */
export const MAX_WRITE_OFF = 1e9;

/**
 * Price of the furniture standing in the house. The porch door is structure,
 * not furniture: older saves still carry its catalog price (#382).
 */
export function furnitureSpend(layout: Pick<RoomLayout, 'floors'>): number {
  let sum = 0;
  for (const floor of layout.floors) {
    for (const item of floor.items) {
      if (item.id !== ENTRANCE_DOOR_ID) sum += item.price ?? 0;
    }
  }
  return sum;
}

/** True while the hard budget is switched on. */
export function isHardBudgetOn(layout: Pick<RoomLayout, 'budget'>): boolean {
  return layout.budget !== undefined && layout.budget.enabled !== false;
}

/** What selling back has lost, counted only while the hard budget is on. */
export function activeWriteOff(layout: Pick<RoomLayout, 'budget'>): number {
  return isHardBudgetOn(layout) ? (layout.budget?.writeOff ?? 0) : 0;
}

/**
 * Money gone: furniture standing plus, while the hard budget is on, what
 * selling back has lost. The header and the library cards both show this.
 */
export function budgetSpent(layout: Pick<RoomLayout, 'floors' | 'budget'>): number {
  return furnitureSpend(layout) + activeWriteOff(layout);
}

/** What is left to spend under the hard budget, or null when it is off. */
export function budgetRemaining(layout: Pick<RoomLayout, 'floors' | 'budget'>): number | null {
  return isHardBudgetOn(layout) ? DEFAULT_BUDGET - budgetSpent(layout) : null;
}

/** Price of buying `items` (copies, a paste, a set); the porch door is free. */
export function purchasePrice(items: readonly Pick<FurnitureItem, 'id' | 'price'>[]): number {
  let sum = 0;
  for (const item of items) {
    if (item.id !== ENTRANCE_DOOR_ID) sum += Math.max(0, item.price ?? 0);
  }
  return sum;
}

/**
 * Why buying something costing `price` is refused under the hard budget,
 * or null when it is affordable (or free, or the budget is off). Callers
 * check this before dispatching, so a refused buy can say why instead of
 * the reducer dropping it silently.
 */
export function purchaseRefusal(layout: Pick<RoomLayout, 'floors' | 'budget'>, price: number): string | null {
  return budgetBlockedReason(price, budgetRemaining(layout));
}

/** What Demolish pays back for an item: whole currency units. */
export function sellBackRefund(price: number): number {
  return Math.round(Math.max(0, price) * SELL_BACK_RATE);
}

/** What selling `items` back loses: the part of their price not refunded. */
export function sellBackLoss(items: readonly Pick<FurnitureItem, 'id' | 'price'>[]): number {
  let loss = 0;
  for (const item of items) {
    if (item.id === ENTRANCE_DOOR_ID) continue;
    const price = Math.max(0, item.price ?? 0);
    loss += price - sellBackRefund(price);
  }
  return loss;
}

/**
 * Why a catalogue tile can't be bought under the hard budget, or null when
 * it can (or the hard budget is off: `remaining` null).
 */
export function budgetBlockedReason(price: number, remaining: number | null): string | null {
  if (remaining === null || price <= 0 || price <= remaining) return null;
  return `Over budget: ${CURRENCY_SYMBOL}${Math.max(0, remaining).toLocaleString()} left`;
}

/** A stored write-off the schema accepts. */
function isWriteOff(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_WRITE_OFF;
}

/**
 * The hard-budget field as loaded from a save, file or link. It REPAIRS,
 * never refuses (see lib/schema.ts): a non-object means never used, a
 * write-off that isn't a sane amount is clamped, `enabled` other than
 * `false` means on, unknown keys are dropped. Returns `value` itself when
 * it is already clean.
 */
export function repairHardBudget(value: unknown): HardBudget | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { writeOff: raw, enabled } = value as { writeOff?: unknown; enabled?: unknown };
  const off = enabled === false;
  const clean = Object.keys(value).length === (off ? 2 : 1) && isWriteOff(raw);
  if (clean) return value as HardBudget;
  const writeOff = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_WRITE_OFF, Math.max(0, raw)) : 0;
  return off ? { writeOff, enabled: false } : { writeOff };
}
