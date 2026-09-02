import { describe, expect, it } from 'vitest';
import { FURNITURE_SETS, buildFurnitureSet, setFitsRoom } from './furniture-sets';
import { itemsOverlap } from './geometry';

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
