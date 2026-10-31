import { sameFloor } from './history-floor';
import type { FloorLayout, FurnitureItem, RoomLayout } from './types';

// What an undo or redo step does, for the toolbar's tooltip (#625). Worked out
// from the two snapshots rather than recorded with each action, like the floor
// an undo lands on (lib/history-floor): a history step can merge several
// actions inside the debounce window, and the difference is what it undoes.

type Verb = 'move' | 'turn' | 'resize' | 'recolour' | 'lock' | 'unlock' | 'edit';

/** One verb per item: a drag also locks, a wall settle also turns, and "move" is what the player did. */
function itemVerb(before: FurnitureItem, after: FurnitureItem): Verb {
  if (before.position?.x !== after.position?.x || before.position?.z !== after.position?.z) return 'move';
  if (before.rotation !== after.rotation || before.mirrored !== after.mirrored) return 'turn';
  if (before.width !== after.width || before.depth !== after.depth || before.height !== after.height) return 'resize';
  if (before.color !== after.color) return 'recolour';
  if (before.locked !== after.locked) return after.locked ? 'lock' : 'unlock';
  return 'edit';
}

function named(items: readonly FurnitureItem[]): string {
  const [only] = items;
  return items.length === 1 && only ? only.name : `${items.length} items`;
}

/** The change inside one storey, or null when only its other fields changed. */
function describeItems(before: FloorLayout, after: FloorLayout): string | null {
  if (before.items === after.items) return null;
  const oldById = new Map(before.items.map((item) => [item.id, item]));
  const newIds = new Set(after.items.map((item) => item.id));
  const added = after.items.filter((item) => !oldById.has(item.id));
  const removed = before.items.filter((item) => !newIds.has(item.id));
  const changed = after.items.flatMap((item) => {
    const old = oldById.get(item.id);
    return old && old !== item ? [{ item, verb: itemVerb(old, item) }] : [];
  });
  if (added.length > 0 && removed.length === 0 && changed.length === 0) return `add ${named(added)}`;
  if (removed.length > 0 && added.length === 0 && changed.length === 0) return `remove ${named(removed)}`;
  const [first] = changed;
  if (first && added.length === 0 && removed.length === 0 && changed.every((entry) => entry.verb === first.verb)) {
    return `${first.verb} ${named(changed.map((entry) => entry.item))}`;
  }
  const touched = [...added, ...removed, ...changed.map((entry) => entry.item)];
  return touched.length > 0 ? `edit ${named(touched)}` : null;
}

function describeFloors(before: RoomLayout, after: RoomLayout): string | null {
  const oldIds = new Set(before.floors.map((floor) => floor.id));
  const newIds = new Set(after.floors.map((floor) => floor.id));
  const added = after.floors.filter((floor) => !oldIds.has(floor.id));
  const removed = before.floors.filter((floor) => !newIds.has(floor.id));
  if (added.length === 0 && removed.length === 0) {
    const reordered = after.floors.some((floor, index) => floor.id !== before.floors[index]?.id);
    return reordered ? 'reorder the floors' : null;
  }
  const [one] = added.length === 1 && removed.length === 0 ? added : [];
  if (one) return `add floor “${one.name}”`;
  const [gone] = removed.length === 1 && added.length === 0 ? removed : [];
  return gone ? `remove floor “${gone.name}”` : 'change the floors';
}

/**
 * The step from `before` to `after` as a phrase for "Undo: …": what changed
 * in the house, with the storey named when there are several. Null when the
 * two are the same object.
 */
export function describeLayoutChange(before: RoomLayout, after: RoomLayout): string | null {
  if (before === after) return null;
  if (before.id !== undefined && after.id !== undefined && before.id !== after.id) return `load “${after.name}”`;
  const floors = describeFloors(before, after);
  if (floors) return floors;

  const changed = after.floors.flatMap((floor) => {
    const old = before.floors.find((candidate) => candidate.id === floor.id);
    return old && !sameFloor(old, floor) ? [{ old, floor }] : [];
  });
  const [only] = changed;
  if (only && changed.length === 1) {
    const where = after.floors.length > 1 ? ` on ${only.floor.name}` : '';
    const items = describeItems(only.old, only.floor);
    if (items) return `${items}${where}`;
    if (only.old.interiorWalls !== only.floor.interiorWalls) return `change the walls${where}`;
    return `change the room finish${where}`;
  }
  if (changed.length > 1) return 'change several floors';
  if (before.name !== after.name) return 'rename the house';
  if (before.width !== after.width || before.height !== after.height) return 'resize the house';
  if (before.roof !== after.roof) return 'change the roof';
  return 'change the house';
}
