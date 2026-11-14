import { CURRENCY_SYMBOL, DEFAULT_BUDGET } from './constants';
import { formatMoney } from './format';
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

/** Appended to a confirm that removes furniture while the hard budget is on. */
export const HARD_BUDGET_SELL_BACK_NOTE = ` With the hard budget on, the furniture sells back at ${Math.round(SELL_BACK_RATE * 100)}%.`;

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

/** The lowest and highest funds a house may set (#609), in whole currency units. */
export const MIN_FUNDS = 100;
export const MAX_FUNDS = 100_000_000;

/**
 * The house's funds (#609): what the header, Statistics, Surprise and the
 * hard budget measure spending against. A house that never set them has
 * DEFAULT_BUDGET, so every older save keeps its 25,000.
 */
export function budgetOf(layout: Pick<RoomLayout, 'budget'>): number {
  return layout.budget?.amount ?? DEFAULT_BUDGET;
}

/** `amount` as funds a house may hold: whole units within MIN_FUNDS..MAX_FUNDS, or null when it isn't a number. */
export function clampFunds(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  return Math.min(MAX_FUNDS, Math.max(MIN_FUNDS, Math.round(amount)));
}

/** What the funds field makes of typed text: the funds to set, with a note when they were clamped, or why not. */
export type FundsEntry = { readonly funds: number; readonly note: string | null } | { readonly refusal: string };

/**
 * Typed funds (#609): a plain whole amount, optionally after the currency
 * sign, grouped with commas or spaces ("8,000", "$8 000"). Anything else
 * ("1e20", "5k", "-300", "8000.5") is refused rather than guessed at, and an
 * amount outside MIN_FUNDS..MAX_FUNDS is clamped and says so. Null for an
 * empty field: nothing to set.
 */
export function readFunds(text: string): FundsEntry | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const plain = trimmed.startsWith(CURRENCY_SYMBOL) ? trimmed.slice(CURRENCY_SYMBOL.length).trim() : trimmed;
  if (!/^\d[\d,\s]*$/.test(plain)) return { refusal: `Funds take a plain amount, like ${formatMoney(8000)}` };
  const value = Number(plain.replace(/[,\s]/g, ''));
  if (value > MAX_FUNDS) return { funds: MAX_FUNDS, note: `Funds go up to ${formatMoney(MAX_FUNDS)}` };
  if (value < MIN_FUNDS) return { funds: MIN_FUNDS, note: `Funds start at ${formatMoney(MIN_FUNDS)}` };
  return { funds: value, note: null };
}

/**
 * `layout` with its funds set to `amount` (#609), or `layout` itself when
 * nothing changes. The default is never stored, and a budget field left
 * holding nothing (off, no write-off, default funds) is dropped, so a house
 * that sets 25,000 again looks the way it did before.
 */
export function withFunds<T extends Pick<RoomLayout, 'budget'>>(layout: T, amount: number): T {
  const funds = clampFunds(amount);
  if (funds === null || funds === budgetOf(layout)) return layout;
  const { amount: _old, ...base } = layout.budget ?? { writeOff: 0, enabled: false as const };
  const budget: HardBudget = funds === DEFAULT_BUDGET ? base : { ...base, amount: funds };
  if (budget.amount === undefined && budget.enabled === false && budget.writeOff === 0) {
    const { budget: _none, ...rest } = layout;
    return rest as T;
  }
  return { ...layout, budget };
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
  return isHardBudgetOn(layout) ? budgetOf(layout) - budgetSpent(layout) : null;
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

/**
 * What cloning a floor buys (#588): its furniture less the porch door and
 * the garden, which the copy leaves behind (the reducer's duplicateFloor).
 */
export function floorClonePrice(items: readonly Pick<FurnitureItem, 'id' | 'price' | 'category'>[]): number {
  return purchasePrice(items.filter((item) => item.category !== 'outdoor'));
}

/**
 * Why cloning a floor holding `items` is refused under the hard budget, or
 * null when it is affordable or the budget is off.
 */
export function floorCloneRefusal(
  layout: Pick<RoomLayout, 'floors' | 'budget'>,
  floorName: string,
  items: readonly Pick<FurnitureItem, 'id' | 'price' | 'category'>[]
): string | null {
  const price = floorClonePrice(items);
  const refusal = purchaseRefusal(layout, price);
  return refusal === null ? null : `Cloning ${floorName} buys ${CURRENCY_SYMBOL}${price.toLocaleString()} of furniture. ${refusal}`;
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
 * What removing `items` costs under the hard budget: the sell-back loss
 * while it is on, nothing while it is off. Every route that takes furniture
 * out of the house (Demolish, Clear floor, Remove floor, Surprise replacing a
 * floor) sells at the same rate, so clearing and rebuying can't dodge it (#534).
 */
export function hardBudgetLoss(
  layout: Pick<RoomLayout, 'budget'>,
  items: readonly Pick<FurnitureItem, 'id' | 'price'>[]
): number {
  return isHardBudgetOn(layout) ? sellBackLoss(items) : 0;
}

/**
 * `layout` with the sale of `items` booked to the write-off, or `layout`
 * itself when the hard budget is off or the sale loses nothing.
 */
export function bookSale<T extends Pick<RoomLayout, 'budget'>>(
  layout: T,
  items: readonly Pick<FurnitureItem, 'id' | 'price'>[]
): T {
  const loss = hardBudgetLoss(layout, items);
  if (loss === 0 || !layout.budget) return layout;
  return { ...layout, budget: { ...layout.budget, writeOff: Math.min(MAX_WRITE_OFF, layout.budget.writeOff + loss) } };
}

/** A template load under the hard budget (#691): the house to apply, or why not. */
export type TemplateLoad<T> =
  | { readonly layout: T; readonly refusal: null; readonly writtenOff: number }
  | { readonly layout: null; readonly refusal: string; readonly writtenOff: 0 };

/**
 * `template` as it replaces `current` (#691). The budget is the player's, not
 * the template's: `current.budget` carries over, enabled flag, write-off and funds,
 * and a house that never had one gets none. Under the hard budget a template
 * is a purchase like any other: the outgoing furniture sells back at
 * SELL_BACK_RATE, the same as Clear floor (#534), and a template whose
 * furniture costs more than is then left is refused. `writtenOff` is what
 * that sale lost.
 */
export function loadTemplateUnderBudget<T extends RoomLayout>(current: RoomLayout, template: T, label: string): TemplateLoad<T> {
  const { budget: _theirs, ...rest } = template;
  if (!current.budget) return { layout: rest as T, refusal: null, writtenOff: 0 };
  const sold = bookSale(current, current.floors.flatMap((floor) => floor.items));
  const budget = sold.budget ?? current.budget;
  const layout = { ...rest, budget } as T;
  if (!isHardBudgetOn(current)) return { layout, refusal: null, writtenOff: 0 };
  const price = purchasePrice(template.floors.flatMap((floor) => floor.items));
  const left = budgetOf(current) - budget.writeOff;
  if (price > 0 && price > left) {
    return {
      layout: null,
      refusal: `Over budget: the ${label} costs ${CURRENCY_SYMBOL}${price.toLocaleString()}, and ${CURRENCY_SYMBOL}${Math.max(0, left).toLocaleString()} is left once this house sells back`,
      writtenOff: 0,
    };
  }
  return { layout, refusal: null, writtenOff: budget.writeOff - current.budget.writeOff };
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

/** Stored funds the schema accepts as they are (#609). */
function isFunds(value: unknown): value is number {
  return typeof value === 'number' && clampFunds(value) === value;
}

/**
 * The hard-budget field as loaded from a save, file or link. It REPAIRS,
 * never refuses (see lib/schema.ts): a non-object means never used, a
 * write-off that isn't a sane amount is clamped, `enabled` other than
 * `false` means on, funds that aren't a number fall back to the default
 * and are otherwise clamped to whole units in range (#609), unknown keys
 * are dropped. Returns `value` itself when it is already clean.
 */
export function repairHardBudget(value: unknown): HardBudget | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { writeOff: raw, enabled, amount } = value as { writeOff?: unknown; enabled?: unknown; amount?: unknown };
  const off = enabled === false;
  const hasAmount = 'amount' in value;
  const clean =
    Object.keys(value).length === 1 + (off ? 1 : 0) + (hasAmount ? 1 : 0) && isWriteOff(raw) && (!hasAmount || isFunds(amount));
  if (clean) return value as HardBudget;
  const writeOff = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_WRITE_OFF, Math.max(0, raw)) : 0;
  const funds = typeof amount === 'number' ? clampFunds(amount) : null;
  return {
    writeOff,
    ...(off ? { enabled: false as const } : {}),
    ...(funds !== null ? { amount: funds } : {}),
  };
}
