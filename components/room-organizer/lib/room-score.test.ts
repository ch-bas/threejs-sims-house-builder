import { describe, expect, it } from 'vitest';
import { measureCpu } from './__testfixtures__/cpu-time';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { ROOM_CHECKS, classifyRoom, houseRoomScores, onZoneEdge, scoreZone } from './room-score';
import type { FurnitureItem, RoomZone } from './types';

const at = (id: string, type: string, x: number, z: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id, type, name: type, width: 0.6, depth: 0.6, height: 1, position: { x, z }, ...extra });

const types = (...list: string[]): Array<Pick<FurnitureItem, 'type'>> => list.map((type) => ({ type }));

describe('classifyRoom (#613)', () => {
  it('names the room the furniture makes', () => {
    expect(classifyRoom(types('bed', 'nightstand'))).toBe('bedroom');
    expect(classifyRoom(types('fridge', 'stove', 'counter'))).toBe('kitchen');
    expect(classifyRoom(types('fridge', 'stove', 'kitchen-sink'))).toBe('kitchen');
    expect(classifyRoom(types('toilet', 'bathroom-sink'))).toBe('bathroom');
    expect(classifyRoom(types('sofa', 'tv'))).toBe('living');
    expect(classifyRoom(types('dining-table', 'dining-chair'))).toBe('dining');
    expect(classifyRoom(types('desk', 'computer'))).toBe('study');
  });

  it('needs every part of a room, and the first rule that fits wins', () => {
    expect(classifyRoom(types('fridge', 'stove'))).toBeNull();
    expect(classifyRoom(types('toilet'))).toBeNull();
    // A kitchen sink by a toilet doesn't make a bathroom.
    expect(classifyRoom(types('toilet', 'kitchen-sink'))).toBeNull();
    expect(classifyRoom(types('plant', 'lamp'))).toBeNull();
    expect(classifyRoom([])).toBeNull();
    expect(classifyRoom(types('bed', 'desk', 'sofa'))).toBe('bedroom');
    expect(classifyRoom(types('fridge', 'stove', 'counter', 'dining-table'))).toBe('kitchen');
  });
});

describe('onZoneEdge', () => {
  it('is on an edge within reach and alongside it, not past a corner', () => {
    const rect = { x: 0, z: 0, w: 4, d: 2 };
    expect(onZoneEdge(rect, { x: 2, z: -0.3 }, 0.5)).toBe(true);
    expect(onZoneEdge(rect, { x: 2, z: 0.4 }, 0.5)).toBe(true);
    expect(onZoneEdge(rect, { x: 2, z: 1 }, 0.5)).toBe(false);
    // Past the corner, on the line of the north edge: the neighbour's wall.
    expect(onZoneEdge(rect, { x: 4.3, z: -0.05 }, 0.5)).toBe(false);
    expect(onZoneEdge(rect, { x: -0.2, z: -0.2 }, 0.5)).toBe(false);
    const ring = { x: 0, z: 0, w: 10, d: 10, outline: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], holes: [[{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }]] };
    expect(onZoneEdge(ring, { x: 3.7, z: 5 }, 0.5)).toBe(true);
    expect(onZoneEdge(ring, { x: 3, z: 5 }, 0.5)).toBe(false);
  });
});

describe('scoreZone (#613)', () => {
  // A 4 × 4 m bedroom from (0, 0); 16 m² asks for two pieces of decor.
  const zone = { x: 0, z: 0, w: 4, d: 4 };
  const bed = at('bed', 'bed', 2, 2, { width: 1.6, depth: 2 });
  const lamp = at('lamp', 'lamp', 0.5, 0.5, { category: 'electronics', width: 0.3, depth: 0.3 });
  const plant = at('plant', 'plant', 3.5, 3.5, { category: 'decor', width: 0.4, depth: 0.4 });
  const vase = at('vase', 'vase', 3.5, 0.5, { category: 'decor', width: 0.2, depth: 0.2 });
  const window = at('win', 'window', 2, -0.05, { category: 'structure', width: 1.2, depth: 0.12 });
  const none = (): boolean => false;

  it('a room with everything scores every star', () => {
    const score = scoreZone({ zone, floorItems: [bed, lamp, plant, vase, window], area: 16, collides: none });
    expect(score).toEqual({ type: 'bedroom', stars: ROOM_CHECKS.length, missing: [] });
  });

  it('says what is missing, in order', () => {
    const score = scoreZone({ zone, floorItems: [bed, plant], area: 16, collides: (item) => item.id === 'bed' });
    expect(score.type).toBe('bedroom');
    expect(score.missing).toEqual(['decor', 'window', 'lamp', 'clear']);
    expect(score.stars).toBe(1);
  });

  it('counts a window on the zone edge, not one across the house', () => {
    const far = { ...window, position: { x: 2, z: 6 } };
    expect(scoreZone({ zone, floorItems: [bed, far], area: 16, collides: none }).missing).toContain('window');
    const side = { ...window, position: { x: 4.3, z: 2 } };
    expect(scoreZone({ zone, floorItems: [bed, side], area: 16, collides: none }).missing).not.toContain('window');
    // On the same wall line but past the corner: the next room's window.
    const next = { ...window, position: { x: 4.6, z: -0.05 } };
    expect(scoreZone({ zone, floorItems: [bed, next], area: 16, collides: none }).missing).toContain('window');
  });

  it('a lamppost is not a lamp for the night; a pendant is', () => {
    const post = at('post', 'lamppost', 1, 1, { category: 'outdoor' });
    expect(scoreZone({ zone, floorItems: [bed, post], area: 16, collides: none }).missing).toContain('lamp');
    const pendant = at('p', 'pendant-light', 1, 1, { category: 'decor' });
    expect(scoreZone({ zone, floorItems: [bed, pendant], area: 16, collides: none }).missing).not.toContain('lamp');
  });

  it('a room more than 70% furniture loses the space star', () => {
    const big = at('wardrobe', 'wardrobe', 2, 2, { width: 4, depth: 3 });
    expect(scoreZone({ zone, floorItems: [bed, big], area: 16, collides: none }).missing).toContain('space');
    expect(scoreZone({ zone, floorItems: [bed], area: 0, collides: none }).missing).toContain('space');
    // A rug under the bed takes no room to move.
    const rug = at('rug', 'rug', 2, 2, { category: 'decor', width: 3.8, depth: 3.8 });
    expect(scoreZone({ zone, floorItems: [bed, rug], area: 16, collides: none }).missing).not.toContain('space');
  });

  it('a zone the furniture makes no room of is not scored', () => {
    expect(scoreZone({ zone, floorItems: [plant, lamp, window], area: 16, collides: none })).toEqual({ type: null, stars: 0, missing: [] });
  });
});

describe('houseRoomScores (#613)', () => {
  it('scores every zone on every storey, with the editor collision check', () => {
    const kitchen: RoomZone = { id: 'k', name: 'Kitchen', color: '#fff', x: -4, z: -4, w: 4, d: 3 };
    const bedroom: RoomZone = { id: 'b', name: 'Bedroom', color: '#fff', x: -3, z: -3, w: 4, d: 4 };
    const layout = makeLayout({
      width: 8,
      height: 8,
      floors: [
        makeFloor({
          zones: [kitchen],
          // The stove and fridge overlap: the kitchen is not clear.
          items: [at('f', 'fridge', -3.5, -3.5), at('s', 'stove', -3.3, -3.5), at('c', 'counter', -1.5, -3.5)],
        }),
        makeFloor({ id: 'up', name: 'Upstairs', zones: [bedroom], items: [at('bed', 'bed', -1, -1, { width: 1.6, depth: 2 })] }),
      ],
    });
    const scores = houseRoomScores(layout);
    expect(scores.map((row) => [row.floorIndex, row.zone.id, row.type])).toEqual([
      [0, 'k', 'kitchen'],
      [1, 'b', 'bedroom'],
    ]);
    expect(scores[0]!.missing).toContain('clear');
    expect(scores[1]!.missing).not.toContain('clear');
  });

  it('answers a storey the edit did not touch from the cache, and re-scores one whose context changed', () => {
    // A full storey: 2,000 chairs under one zone, nothing colliding.
    const items = Array.from({ length: 2000 }, (_, i) =>
      at(`i${i}`, i === 0 ? 'bed' : 'chair', -9 + (i % 45) * 0.4, -9 + Math.floor(i / 45) * 0.4, { width: 0.3, depth: 0.3 })
    );
    const busy = makeFloor({ id: 'busy', items, zones: [{ id: 'z', name: 'Z', color: '#fff', x: -10, z: -10, w: 20, d: 20 }] });
    const layout = makeLayout({ width: 20, height: 20, floors: [busy, makeFloor({ id: 'up', name: 'Up' })] });
    const first = houseRoomScores(layout);
    expect(first[0]!.type).toBe('bedroom');
    // An edit upstairs leaves the busy storey's object as it was.
    const edited = { ...layout, floors: [busy, makeFloor({ id: 'up', name: 'Up', items: [at('x', 'plant', 0, 0)] })] };
    const { result, cpuMs } = measureCpu(() => houseRoomScores(edited));
    expect(result[0]).toBe(first[0]);
    expect(cpuMs).toBeLessThan(50);
    // A narrower house puts the east column through the wall: scored again.
    const narrower = houseRoomScores({ ...layout, width: 17 });
    expect(narrower[0]).not.toBe(first[0]);
    expect(narrower[0]!.missing).toContain('clear');
  }, 30_000);

  it("takes the active storey's collisions from the editor instead of a collision pass", () => {
    const items = Array.from({ length: 2000 }, (_, i) =>
      at(`i${i}`, i === 0 ? 'bed' : 'chair', -9 + (i % 45) * 0.4, -9 + Math.floor(i / 45) * 0.4, { width: 0.3, depth: 0.3 })
    );
    const busy = makeFloor({ id: 'busy', items, zones: [{ id: 'z', name: 'Z', color: '#fff', x: -10, z: -10, w: 20, d: 20 }] });
    const layout = makeLayout({ width: 20, height: 20, floors: [busy] });
    const said = new Set(['i5']);
    // A fresh storey object each time, so no cache answers.
    const { result, cpuMs } = measureCpu(() => houseRoomScores({ ...layout, floors: [{ ...busy }] }, { floorIndex: 0, ids: said }));
    expect(result[0]!.missing).toContain('clear');
    expect(cpuMs).toBeLessThan(50);
  }, 30_000);

  it('a house with no zones has no scores', () => {
    expect(houseRoomScores(makeLayout())).toEqual([]);
  });
});
