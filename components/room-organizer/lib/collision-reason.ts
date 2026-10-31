import { collisionReason, type CollisionContext, type CollisionReason } from './geometry';
import type { FurnitureItem } from './types';

/** The sentence for a reason. The rules live in `collisionReason`, the wording here (#627). */
export function describeCollision(reason: CollisionReason, items: readonly FurnitureItem[]): string {
  switch (reason.kind) {
    case 'bounds':
      return 'Part of it is outside the room.';
    case 'building':
      return 'Outdoor items go outside the house.';
    case 'porch':
      return 'It stands in the porch, which is outside the house.';
    case 'stairwell':
      return 'It stands over the stairwell hole.';
    case 'partition':
      return 'It stands inside an interior wall.';
    case 'item': {
      const other = items.find((candidate) => candidate.id === reason.id);
      return other ? `It overlaps the ${other.name}.` : 'It overlaps another item.';
    }
  }
}

/** Why `item` shows red, as a sentence; null when it stands clear. */
export function collisionMessage(
  item: FurnitureItem,
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  context: CollisionContext = {}
): string | null {
  const reason = collisionReason(item, items, roomWidth, roomDepth, context);
  return reason && describeCollision(reason, items);
}
