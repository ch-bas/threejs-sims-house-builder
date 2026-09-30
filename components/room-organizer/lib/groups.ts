/**
 * Persistent furniture groups (#154). A group is nothing more than items on
 * one floor sharing a `groupId`; these helpers turn that into selection
 * behaviour. Pure — the reducer owns the writes (`setGroup` / `clearGroup`)
 * and the orchestrator's `handleSelect` owns the expansion.
 */

import type { FurnitureItem } from './types';

/** Ids of every item on the floor in `groupId`'s group. */
export function groupMemberIds(items: readonly FurnitureItem[], groupId: string): Set<string> {
  const members = new Set<string>();
  for (const item of items) {
    if (item.groupId === groupId) members.add(item.id);
  }
  return members;
}

/**
 * What a click on `id` selects: the whole group when the item is grouped,
 * otherwise the item alone. A group with a single surviving member (the
 * rest were deleted) behaves like an ungrouped item. An unknown id maps to
 * itself so callers never end up with an empty selection.
 */
export function expandSelection(items: readonly FurnitureItem[], id: string): Set<string> {
  const item = items.find((entry) => entry.id === id);
  if (!item?.groupId) return new Set([id]);
  const members = groupMemberIds(items, item.groupId);
  members.add(id);
  return members;
}

/** Distinct group ids among the selected items (ungrouped items contribute none). */
export function groupIdsIn(items: readonly FurnitureItem[], ids: ReadonlySet<string>): Set<string> {
  const groups = new Set<string>();
  for (const item of items) {
    if (item.groupId && ids.has(item.id)) groups.add(item.groupId);
  }
  return groups;
}

/**
 * True when `ids` is exactly one complete group — every selected item shares
 * one groupId and no member of that group is left out. That selection is
 * already a group, so the chip offers Ungroup instead of Group.
 */
export function isWholeGroup(items: readonly FurnitureItem[], ids: ReadonlySet<string>): boolean {
  if (ids.size < 2) return false;
  let groupId: string | undefined;
  for (const item of items) {
    if (!ids.has(item.id)) continue;
    if (!item.groupId) return false;
    if (groupId === undefined) groupId = item.groupId;
    else if (item.groupId !== groupId) return false;
  }
  if (groupId === undefined) return false;
  return groupMemberIds(items, groupId).size === ids.size;
}

/**
 * Rewrite the group ids of a batch of copies so they form NEW groups that
 * mirror the originals' structure instead of aliasing them (#154): a pasted
 * dining group is its own group, not five more members of the source. Each
 * distinct source group maps to `${tag}-g<n>`; ungrouped items stay
 * ungrouped. Copies are returned in order; untouched items keep identity.
 */
export function remapGroupIds<T extends Pick<FurnitureItem, 'groupId'>>(items: readonly T[], tag: string): T[] {
  const fresh = new Map<string, string>();
  return items.map((item) => {
    if (!item.groupId) return item;
    let next = fresh.get(item.groupId);
    if (next === undefined) {
      next = `${tag}-g${fresh.size}`;
      fresh.set(item.groupId, next);
    }
    return { ...item, groupId: next };
  });
}
