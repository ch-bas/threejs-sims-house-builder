import { describe, expect, it } from 'vitest';
import { FURNITURE_CATALOG } from './constants';
import { FURNITURE_SETS, buildFurnitureSet, setFitsRoom, type FurnitureSet, type SetItemSnapshot } from './furniture-sets';
import { itemInBounds, itemsOverlap, rotatedHalfExtents } from './geometry';

const setByKey = (key: string) => FURNITURE_SETS.find((s) => s.key === key)!;

/** Overlapping pairs the authored (unscaled) layout does not contain. */
function scalingIntroducedOverlaps(items: ReturnType<typeof buildFurnitureSet>, authored: ReturnType<typeof buildFurnitureSet>) {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (itemsOverlap(items[i]!, items[j]!) && !itemsOverlap(authored[i]!, authored[j]!)) {
        pairs.push([items[i]!.id, items[j]!.id]);
      }
    }
  }
  return pairs;
}

describe('buildFurnitureSet — scaled sets must not self-collide (#127)', () => {
  it('places the dining set unscaled in a large room with no new overlaps', () => {
    const set = setByKey('dining');
    const items = buildFurnitureSet(set, { idPrefix: 'd', roomWidth: 8, roomDepth: 8 });
    expect(items).toHaveLength(set.items.length);
    const authored = buildFurnitureSet(set, { idPrefix: 'd' });
    expect(scalingIntroducedOverlaps(items, authored)).toEqual([]);
  });

  it('refuses the dining set in a 3×3 room instead of embedding the chairs in the table', () => {
    expect(buildFurnitureSet(setByKey('dining'), { idPrefix: 'd', roomWidth: 3, roomDepth: 3 })).toEqual([]);
  });

  it('refuses the bedroom set in a room narrow enough to embed the nightstands in the bed', () => {
    expect(buildFurnitureSet(setByKey('bedroom'), { idPrefix: 'b', roomWidth: 3.2, roomDepth: 4 })).toEqual([]);
  });

  it('keeps the office set placeable despite its authored on-desk overlaps', () => {
    // The computer and lamp sit ON the desk by design; those overlaps must
    // never trigger the refusal, even when the set is scaled down a little.
    const items = buildFurnitureSet(setByKey('home-office'), { idPrefix: 'o', roomWidth: 4, roomDepth: 4 });
    expect(items.length).toBeGreaterThan(0);
  });

  it('every shipped set either fits or is refused — no set ever returns a self-colliding layout', () => {
    for (const set of FURNITURE_SETS) {
      for (const size of [2.5, 3, 3.5, 4, 5, 8]) {
        if (!setFitsRoom(set, size, size)) continue;
        const items = buildFurnitureSet(set, { idPrefix: set.key, roomWidth: size, roomDepth: size });
        if (items.length === 0) continue; // refused: acceptable
        const authored = buildFurnitureSet(set, { idPrefix: set.key });
        expect(scalingIntroducedOverlaps(items, authored)).toEqual([]);
      }
    }
  });
});

describe('buildFurnitureSet — placement rules of a saved set (#384)', () => {
  const custom = (items: FurnitureSet['items']): FurnitureSet => ({
    key: 'custom:t',
    label: 'T',
    icon: '⭐',
    description: '',
    items,
  });
  const snapshot = (type: string): SetItemSnapshot => {
    const { price: _price, ...entry } = FURNITURE_CATALOG.find((c) => c.type === type)!;
    return entry;
  };

  it('settles a saved door back onto its wall instead of mid-room', () => {
    // Door on the north wall (z = -4) and a chair at z = 0: offsets ∓2 from the centroid.
    const set = custom([
      { type: 'door', offset: { x: 0, z: -2 }, rotation: 0, snapshot: snapshot('door') },
      { type: 'chair', offset: { x: 0, z: 2 }, snapshot: snapshot('chair') },
    ]);
    const [door, chair] = buildFurnitureSet(set, { idPrefix: 's', roomWidth: 8, roomDepth: 8 });
    expect(door!.position).toEqual({ x: 0, z: -4 });
    expect(chair!.position).toEqual({ x: 0, z: 2 });
  });

  it('settles onto an interior wall when given the floor’s partitions', () => {
    const set = custom([{ type: 'door', offset: { x: 0, z: 0.2 }, rotation: 0, snapshot: snapshot('door') }]);
    const interiorWalls = [{ id: 'p', x1: -2, z1: 0, x2: 2, z2: 0 }];
    const [door] = buildFurnitureSet(set, { idPrefix: 's', roomWidth: 8, roomDepth: 8, interiorWalls });
    expect(door!.position).toEqual({ x: 0, z: 0 });
  });

  it('keeps a garden set outside the house', () => {
    const set = custom([
      { type: 'tree', offset: { x: -1.5, z: 0 }, snapshot: snapshot('tree') },
      { type: 'tree', offset: { x: 1.5, z: 0 }, snapshot: snapshot('tree') },
      { type: 'garden-bench', offset: { x: 0, z: 0.5 }, snapshot: snapshot('garden-bench') },
    ]);
    // A 3×3 house is far too small to hold it; outdoor pieces never refuse a set.
    expect(setFitsRoom(set, 3, 3)).toBe(true);
    const items = buildFurnitureSet(set, { idPrefix: 'g', roomWidth: 8, roomDepth: 8 });
    expect(items).toHaveLength(3);
    for (const item of items) {
      const { halfD } = rotatedHalfExtents(item);
      // Clear of the south wall, offsets kept as authored.
      expect(item.position!.z - halfD).toBeGreaterThanOrEqual(4 - 1e-9);
    }
    expect(items[1]!.position!.x - items[0]!.position!.x).toBeCloseTo(3);
    expect(items[2]!.position!.z - items[0]!.position!.z).toBeCloseTo(0.5);
  });

  it('leaves outdoor pieces that are already outside where they are', () => {
    const set = custom([{ type: 'tree', offset: { x: 0, z: 6 }, snapshot: snapshot('tree') }]);
    expect(buildFurnitureSet(set, { idPrefix: 'g', roomWidth: 8, roomDepth: 8 })[0]!.position).toEqual({ x: 0, z: 6 });
  });

  it('fits rotated pieces by their rotated footprint', () => {
    const sofa = snapshot('sofa');
    const diagonal = custom([
      { type: 'sofa', offset: { x: -0.6, z: 0 }, rotation: Math.PI / 4, snapshot: { ...sofa, width: 2, depth: 0.9 } },
      { type: 'sofa', offset: { x: 0.6, z: 0 }, rotation: Math.PI / 4, snapshot: { ...sofa, width: 2, depth: 0.9 } },
    ]);
    // Each sofa's AABB is ~2.05 m square, not the 0.9 m a 0°/90° swap assumed.
    expect(setFitsRoom(diagonal, 2.72, 2.72)).toBe(false);
    expect(buildFurnitureSet(diagonal, { idPrefix: 'r', roomWidth: 2.72, roomDepth: 2.72 })).toEqual([]);
    // Where it fits, the offsets shrink until every piece is in bounds.
    for (const size of [2.8, 4.5]) {
      for (const item of buildFurnitureSet(diagonal, { idPrefix: 'r', roomWidth: size, roomDepth: size })) {
        expect(itemInBounds(item, size, size)).toBe(true);
      }
    }
  });
});
