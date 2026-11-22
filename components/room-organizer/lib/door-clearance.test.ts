import { describe, expect, it } from 'vitest';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeItem, makeLayout, makeFloor } from './__testfixtures__/fixtures';
import { blockedDoorIds, doorSwingBlockedBy, doorsSwingingInto, swingBlockerIds, swingClearanceNote } from './door-clearance';
import { doorSwing, planContentBounds, type PlacedItem } from './plan-export/plan-geometry';
import { parseStoredLayout } from './schema';
import type { FurnitureItem } from './types';

// A door in the north wall at z = −2, facing +z: hinged at x = −0.45, its
// swing the quarter disc of radius 0.9 between (0.45, −2) and (−0.45, −1.1).
const door = makeItem({ id: 'door', type: 'door', name: 'Door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: -2 }, rotation: 0 });
const at = (id: string, x: number, z: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id, name: id, width: 0.4, depth: 0.4, height: 0.8, position: { x, z }, ...extra });

describe('doorSwing opening out (#917)', () => {
  it('turns the open leaf to the other side of the wall', () => {
    const into = doorSwing(door as PlacedItem);
    const out = doorSwing({ ...door, swingOut: true } as PlacedItem);
    expect(out.hinge).toEqual(into.hinge);
    expect(out.strike).toEqual(into.strike);
    expect(into.leafTip.z).toBeCloseTo(-1.1);
    expect(out.leafTip.z).toBeCloseTo(-2.9);
    expect(out.leafTip.x).toBeCloseTo(-0.45);
  });
});

describe('doorSwingBlockedBy (#917)', () => {
  it('names a piece standing in the swing, and not one clear of it', () => {
    const inSwing = at('stool', 0, -1.6);
    const clear = at('table', 0, -0.5);
    expect(doorSwingBlockedBy(door, [door, inSwing, clear]).map((i) => i.id)).toEqual(['stool']);
  });

  it('reads the side the door opens to', () => {
    const inside = at('inside', 0, -1.6);
    const outside = at('outside', 0, -2.4);
    const out = { ...door, swingOut: true as const };
    expect(doorSwingBlockedBy(out, [out, inside, outside]).map((i) => i.id)).toEqual(['outside']);
  });

  it('follows the hinge when the door is mirrored', () => {
    // Near the strike jamb, past the arc of a door hinged at −X; inside that of one hinged at +X.
    const corner = at('corner', 0.35, -1.25, { width: 0.2, depth: 0.2 });
    expect(doorSwingBlockedBy(door, [corner])).toEqual([]);
    expect(doorSwingBlockedBy({ ...door, mirrored: true }, [corner]).map((i) => i.id)).toEqual(['corner']);
  });

  it('sees a long piece that crosses the swing with every corner outside it', () => {
    const bar = at('bar', 0, -1.75, { width: 0.1, depth: 1.5 });
    expect(doorSwingBlockedBy(door, [bar]).map((i) => i.id)).toEqual(['bar']);
  });

  it('ignores a piece only touching the swing', () => {
    // Its top edge at z = −1.1, the open leaf's tip.
    const flush = at('flush', -0.45, -0.8, { width: 0.4, depth: 0.6 });
    expect(doorSwingBlockedBy(door, [flush])).toEqual([]);
  });

  it('lets the leaf pass over rugs and under what hangs on the walls', () => {
    const rug = at('rug', 0, -1.6, { type: 'rug', height: 0.02 });
    const picture = at('picture', 0, -1.6, { type: 'painting' });
    const window = at('window', 0, -1.6, { type: 'window' });
    expect(doorSwingBlockedBy(door, [rug, picture, window])).toEqual([]);
  });

  it('has no swing for anything but a placed door', () => {
    const stool = at('stool', 0, -1.6);
    expect(doorSwingBlockedBy({ ...door, type: 'window' }, [stool])).toEqual([]);
    const { position: _unplaced, ...unplaced } = door;
    expect(doorSwingBlockedBy(unplaced, [stool])).toEqual([]);
  });

  it('runs a crowded storey in well under a frame', () => {
    const doors = Array.from({ length: 40 }, (_, i) => ({ ...door, id: `d${i}`, position: { x: (i % 8) - 4, z: Math.floor(i / 8) - 2 } }));
    const pieces = Array.from({ length: 400 }, (_, i) => at(`p${i}`, (i % 20) * 0.4 - 4, Math.floor(i / 20) * 0.4 - 4));
    const started = performance.now();
    blockedDoorIds([...doors, ...pieces]);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('swingBlockerIds (#917)', () => {
  it('collects what stands in any door\'s swing, once, and nothing a leaf passes', () => {
    const second = { ...door, id: 'door2', position: { x: 3, z: -2 } };
    const stool = at('stool', 0, -1.6);
    const chair = at('chair', 3, -1.6);
    const clear = at('table', 0, -0.5);
    const rug = at('rug', 3, -1.6, { type: 'rug', height: 0.02 });
    expect([...swingBlockerIds([door, second, stool, chair, clear, rug])].sort()).toEqual(['chair', 'stool']);
    // People and pets step aside for a door.
    const person = at('person', 0, -1.6, { type: 'person', category: 'people' });
    const pet = at('pet', 3, -1.6, { type: 'pet', category: 'people' });
    expect(swingBlockerIds([door, second, person, pet]).size).toBe(0);
    expect(doorSwingBlockedBy(door, [person])).toEqual([]);
    // A door's own leaf is no blocker, nor a door standing beside it.
    expect(swingBlockerIds([door, second]).size).toBe(0);
    expect(swingBlockerIds([stool, chair]).size).toBe(0);
    // The same answer as asking door by door.
    const items = [door, second, stool, chair, clear, rug];
    const perDoor = new Set(items.flatMap((d) => doorSwingBlockedBy(d, items).map((i) => i.id)));
    expect(swingBlockerIds(items)).toEqual(perDoor);
  });

  it('runs a crowded storey in well under a frame of CPU time', () => {
    const doors = Array.from({ length: 40 }, (_, i) => ({ ...door, id: `d${i}`, position: { x: (i % 8) - 4, z: Math.floor(i / 8) - 2 } }));
    const pieces = Array.from({ length: 400 }, (_, i) => at(`p${i}`, (i % 20) * 0.4 - 4, Math.floor(i / 20) * 0.4 - 4));
    const { cpuMs } = measureCpu(() => swingBlockerIds([...doors, ...pieces]));
    expect(cpuMs).toBeLessThan(100);
  }, 30_000);
});

describe('the popover note (#917)', () => {
  it('names what stands in a door\'s swing', () => {
    expect(swingClearanceNote(door, [door, at('Stool', 0, -1.6)])).toBe('The Stool stands where it swings open.');
    expect(swingClearanceNote(door, [door, at('Stool', 0, -1.6), at('Lamp', -0.2, -1.4)])).toBe(
      'The Stool and Lamp stand where it swings open.'
    );
    expect(swingClearanceNote(door, [door])).toBeNull();
  });

  it('names the door a piece stands in the swing of', () => {
    const stool = at('Stool', 0, -1.6);
    expect(doorsSwingingInto(stool, [door, stool]).map((i) => i.id)).toEqual(['door']);
    expect(swingClearanceNote(stool, [door, stool])).toBe('It stands where the Door swings open.');
    expect(swingClearanceNote(at('Far', 3, 3), [door])).toBeNull();
  });

  it('is never a collision: the plan tints only the door', () => {
    expect([...blockedDoorIds([door, at('Stool', 0, -1.6)])]).toEqual(['door']);
  });
});

describe('swingOut in a save (#917)', () => {
  it('loads a door that opens out, and drops a stored false', () => {
    const out = makeLayout({ floors: [makeFloor({ items: [{ ...door, swingOut: true }] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(out)))?.floors[0]?.items[0]?.swingOut).toBe(true);
    const off = makeLayout({ floors: [makeFloor({ items: [{ ...door, swingOut: false } as unknown as FurnitureItem] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(off)))?.floors[0]?.items[0]).not.toHaveProperty('swingOut');
  });

  it('refuses a swingOut that is not a boolean', () => {
    const bad = makeLayout({ floors: [makeFloor({ items: [{ ...door, swingOut: 'yes' } as unknown as FurnitureItem] })] });
    expect(parseStoredLayout(JSON.parse(JSON.stringify(bad)))).toBeNull();
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
  });
});
