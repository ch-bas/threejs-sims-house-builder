import { describe, expect, it } from 'vitest';
import { iconForItem } from '../plotcraft/icon';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from './constants';
import { doorSwingBlockedBy } from './door-clearance';
import { archHead, doorLeafSpans, doorWalkSpan, doorStyle, hasDoorSwing, openingStyleFits, storedOpeningStyle, windowStyle, MIN_ARCH_SPRING } from './opening-style';
import { doorSwings, isOnDoorLeaf, openingPlanMarks, planContentBounds, type PlacedItem } from './plan-export/plan-geometry';
import { parseStoredLayout } from './schema';
import type { FurnitureItem } from './types';

// A door in the north wall at z = −2, facing +z.
const door = (patch: Partial<FurnitureItem> = {}): PlacedItem =>
  makeItem({ id: 'door', type: 'door', name: 'Door', width: 1.6, depth: 0.12, height: 2.1, position: { x: 0, z: -2 }, rotation: 0, ...patch }) as PlacedItem;

describe('opening styles (#922)', () => {
  it('reads an absent style as the door and window there always were', () => {
    expect(doorStyle(door())).toBe('single');
    expect(windowStyle(makeItem({ type: 'window' }))).toBe('standard');
    // A style on the wrong type is ignored by every reader.
    expect(doorStyle(door({ openingStyle: 'tall' }))).toBe('single');
    expect(windowStyle(makeItem({ type: 'chair', openingStyle: 'fixed' }))).toBe('standard');
  });

  it('knows which styles each type comes in, and stores the default as nothing', () => {
    expect(openingStyleFits('door', 'arch')).toBe(true);
    expect(openingStyleFits('door', 'tall')).toBe(false);
    expect(openingStyleFits('window', 'fixed')).toBe(true);
    expect(openingStyleFits('sofa', 'double')).toBe(false);
    expect(storedOpeningStyle('door', 'single')).toBeUndefined();
    expect(storedOpeningStyle('window', 'standard')).toBeUndefined();
    expect(storedOpeningStyle('door', 'sliding')).toBe('sliding');
  });

  it('gives a single door one leaf on its hinge jamb, a double door two halves, and the others none', () => {
    expect(doorLeafSpans(door({ width: 0.9 }))).toEqual([{ hinge: -1, width: 0.9 }]);
    expect(doorLeafSpans(door({ width: 0.9, mirrored: true }))).toEqual([{ hinge: 1, width: 0.9 }]);
    expect(doorLeafSpans(door({ openingStyle: 'double' }))).toEqual([
      { hinge: -1, width: 0.8 },
      { hinge: 1, width: 0.8 },
    ]);
    for (const style of ['sliding', 'arch'] as const) {
      expect(doorLeafSpans(door({ openingStyle: style }))).toEqual([]);
      expect(hasDoorSwing(door({ openingStyle: style }))).toBe(false);
    }
  });

  it('springs an arch as a semicircle where it fits, flatter on a wide opening', () => {
    const narrow = archHead(1.2, 2.2);
    expect(narrow.rise).toBeCloseTo(0.6);
    expect(narrow.crown).toBeLessThan(2.2);
    const wide = archHead(3, 2.2);
    expect(wide.rise).toBeLessThan(1.5);
    expect(wide.spring).toBeCloseTo(wide.crown * MIN_ARCH_SPRING);
  });

  it('ships each type in the catalogue at its own size', () => {
    const styled = FURNITURE_CATALOG.filter((entry) => 'openingStyle' in entry);
    expect(styled.map((entry) => entry.name)).toEqual(['Double Door', 'Sliding Door', 'Archway', 'Tall Window', 'Picture Window']);
    for (const entry of styled) expect(openingStyleFits(entry.type, (entry as { openingStyle?: unknown }).openingStyle)).toBe(true);
  });
});

describe('door styles on the plan (#922)', () => {
  it('draws a double door as two half-width leaves meeting in the middle', () => {
    const swings = doorSwings(door({ openingStyle: 'double' }));
    expect(swings).toHaveLength(2);
    const [left, right] = swings;
    expect(left!.hinge.x).toBeCloseTo(-0.8);
    expect(left!.strike.x).toBeCloseTo(0);
    expect(left!.leafTip.z).toBeCloseTo(-1.2);
    expect(right!.hinge.x).toBeCloseTo(0.8);
    expect(right!.strike.x).toBeCloseTo(0);
    expect(right!.leafTip.z).toBeCloseTo(-1.2);
    // Opening out turns both.
    expect(doorSwings(door({ openingStyle: 'double', swingOut: true })).map((s) => s.leafTip.z)).toEqual([-2.8, -2.8]);
  });

  it('has no swing for a sliding door or an archway, but marks of their own', () => {
    for (const style of ['sliding', 'arch'] as const) {
      const item = door({ openingStyle: style });
      expect(doorSwings(item)).toEqual([]);
      expect(isOnDoorLeaf(item, -0.8, -1.5, 0.1)).toBe(false);
    }
    const sliding = openingPlanMarks(door({ openingStyle: 'sliding' }), 0.12);
    expect(sliding.overhead).toEqual([]);
    expect(sliding.solid).toHaveLength(2);
    // Two panes, either side of the centre line, overlapping in the middle.
    const [a, b] = sliding.solid;
    expect(a!.from.z).toBeCloseTo(-2.02);
    expect(b!.from.z).toBeCloseTo(-1.98);
    expect(a!.to.x).toBeGreaterThan(b!.from.x);
    const arch = openingPlanMarks(door({ openingStyle: 'arch' }), 0.2);
    expect(arch.solid).toEqual([]);
    expect(arch.overhead.map((line) => [line.from.x, line.from.z, line.to.x, line.to.z])).toEqual([
      [-0.8, -2.1, 0.8, -2.1],
      [-0.8, -1.9, 0.8, -1.9],
    ]);
    expect(openingPlanMarks(door(), 0.2)).toEqual({ solid: [], overhead: [] });
  });

  it('warns about a double door\'s either leaf, and never a sliding door\'s', () => {
    const stool = makeItem({ id: 'stool', name: 'Stool', width: 0.3, depth: 0.3, height: 0.5, position: { x: 0.5, z: -1.7 } });
    expect(doorSwingBlockedBy(door({ openingStyle: 'double' }), [stool]).map((i) => i.id)).toEqual(['stool']);
    expect(doorSwingBlockedBy(door({ openingStyle: 'sliding' }), [stool])).toEqual([]);
    expect(doorSwingBlockedBy(door({ openingStyle: 'arch' }), [stool])).toEqual([]);
  });
});

describe('openingStyle in a save (#922)', () => {
  const load = (item: FurnitureItem) =>
    parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ floors: [makeFloor({ items: [item] })] }))))?.floors[0]?.items[0];

  it('keeps a known style and drops one no door or window comes in', () => {
    expect(load(door({ openingStyle: 'arch' }))?.openingStyle).toBe('arch');
    expect(load({ ...door(), openingStyle: 'revolving' } as unknown as FurnitureItem)).not.toHaveProperty('openingStyle');
  });

  it('refuses a style that is not a string', () => {
    const bad = makeLayout({ floors: [makeFloor({ items: [{ ...door(), openingStyle: 3 } as unknown as FurnitureItem] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(bad)))).toBeNull();
  });
});

describe('sliding door panes on the plan follow the mesh (#922)', () => {
  it('puts the fixed pane on the −Z side at local −X, at +X when mirrored', () => {
    const [fixed, sliding] = openingPlanMarks(door({ width: 2, openingStyle: 'sliding' }), 0.12).solid;
    expect(fixed!.from.x).toBeCloseTo(-0.94);
    expect(fixed!.from.z).toBeCloseTo(-2.02);
    expect(sliding!.to.x).toBeCloseTo(0.94);
    const [mFixed, mSliding] = openingPlanMarks(door({ width: 2, openingStyle: 'sliding', mirrored: true }), 0.12).solid;
    expect(mFixed!.from.x).toBeCloseTo(0.94);
    expect(mFixed!.from.z).toBeCloseTo(-2.02);
    expect(mSliding!.to.x).toBeCloseTo(-0.94);
  });

  it('lets a walker through only the slid-open span', () => {
    expect(doorWalkSpan(door({ width: 2, openingStyle: 'sliding' })).map((v) => +v.toFixed(3))).toEqual([0.094, 0.94]);
    expect(doorWalkSpan(door({ width: 2, openingStyle: 'sliding', mirrored: true })).map((v) => +v.toFixed(3))).toEqual([-0.94, -0.094]);
    expect(doorWalkSpan(door({ width: 0.9 }))).toEqual([-0.45, 0.45]);
  });
});

describe('outward swings on the sheet (#917)', () => {
  it('grows the plan\'s content bounds over a swing past the walls, and only then', () => {
    const at = (patch: Partial<FurnitureItem>) => {
      const floor = makeFloor({ items: [makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, position: { x: 0, z: 4 }, rotation: Math.PI, ...patch })] });
      return planContentBounds(makeLayout({ floors: [floor] }), floor);
    };
    expect(at({}).maxZ).toBe(4);
    expect(at({ swingOut: true }).maxZ).toBeCloseTo(4.9);
    expect(at({ swingOut: true, width: 1.6, openingStyle: 'double' }).maxZ).toBeCloseTo(4.8);
    expect(at({ swingOut: true, openingStyle: 'sliding' }).maxZ).toBe(4);
  });
});

describe('door and window glyphs (#922)', () => {
  it('gives each new type its own catalogue glyph', () => {
    const glyphs = ['double', 'sliding', 'arch'].map((style) => iconForItem('door', 'structure', style));
    expect(new Set([...glyphs, iconForItem('door', 'structure')]).size).toBe(4);
    expect(iconForItem('window', 'structure', 'tall')).not.toBe(iconForItem('window', 'structure'));
    expect(iconForItem('sofa', 'seating', 'arch')).toBe(iconForItem('sofa', 'seating'));
  });
});
