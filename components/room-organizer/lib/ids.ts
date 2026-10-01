/**
 * Generate a collision-resistant id with the given prefix.
 *
 * `Date.now()` alone collides for anything created within the same millisecond
 * (e.g. stamping a furniture set, or two clicks in one frame). Appending four
 * random base-36 characters — the same scheme the layout reducer uses for its
 * own ids — makes same-millisecond collisions astronomically unlikely.
 */
export function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Just the 4-char random suffix, for callers that build their own id shape. */
export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * The layout with a house id, minting a random one when it has none (#342).
 * Houses had no dependable identity — every new house is "My Home" — so
 * restore-point cadence couldn't tell two of them apart. The store applies
 * this to every layout it takes in, so each house is labelled once and keeps
 * its id through edits, undo, saves, exports and share links.
 */
export function withHouseId<T extends { id?: string }>(layout: T): T {
  return layout.id ? layout : { ...layout, id: randomId('house') };
}
