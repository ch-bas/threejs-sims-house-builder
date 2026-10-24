import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { floorKeepOut } from './floor-keep-out';
import { hasCollisions, itemsOverlap, rotatedHalfExtents } from './geometry';
import { entrancePlanOutline } from './street';
import { keptBySurprise, surpriseFloorItems, surpriseLayout, surpriseReplacesFurniture } from './surprise';

describe('surpriseLayout (#123)', () => {
  it('is deterministic for a pinned seed', () => {
    const a = surpriseLayout({ roomWidth: 6, roomDepth: 5, seed: 42 });
    const b = surpriseLayout({ roomWidth: 6, roomDepth: 5, seed: 42 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('different seeds produce different layouts', () => {
    const a = surpriseLayout({ roomWidth: 6, roomDepth: 5, seed: 1 });
    const b = surpriseLayout({ roomWidth: 6, roomDepth: 5, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('never assigns duplicate ids', () => {
    const items = surpriseLayout({ roomWidth: 8, roomDepth: 8, seed: 7 });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('keeps every generated item inside the room across many seeds', () => {
    for (let seed = 0; seed < 25; seed++) {
      const w = 4 + (seed % 5);
      const d = 3 + (seed % 4);
      for (const item of surpriseLayout({ roomWidth: w, roomDepth: d, seed })) {
        const { halfW, halfD } = rotatedHalfExtents(item);
        expect(Math.abs(item.position!.x) + halfW, `seed ${seed}: ${item.id}`).toBeLessThanOrEqual(w / 2 + 1e-9);
        expect(Math.abs(item.position!.z) + halfD, `seed ${seed}: ${item.id}`).toBeLessThanOrEqual(d / 2 + 1e-9);
      }
    }
  });

  it('decor never overlaps the placed set or other decor', () => {
    for (let seed = 0; seed < 10; seed++) {
      const items = surpriseLayout({ roomWidth: 7, roomDepth: 6, seed });
      const decor = items.filter((i) => i.id.startsWith('surprise-decor'));
      for (const piece of decor) {
        for (const other of items) {
          if (other.id === piece.id) continue;
          expect(itemsOverlap(piece, other), `seed ${seed}: ${piece.id} vs ${other.id}`).toBe(false);
        }
      }
    }
  });

  it('a tiny room still yields a usable (possibly decor-only) result without throwing', () => {
    const items = surpriseLayout({ roomWidth: 2.2, roomDepth: 2.2, seed: 3 });
    for (const item of items) {
      const { halfW, halfD } = rotatedHalfExtents(item);
      expect(Math.abs(item.position!.x) + halfW).toBeLessThanOrEqual(1.1 + 1e-9);
      expect(Math.abs(item.position!.z) + halfD).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it('hangs paintings and mirrors flush on a wall, facing into the room', () => {
    let hung = 0;
    for (let seed = 0; seed < 60; seed++) {
      const w = 5 + (seed % 4);
      const d = 4 + (seed % 3);
      for (const item of surpriseLayout({ roomWidth: w, roomDepth: d, seed })) {
        if (item.type !== 'painting' && item.type !== 'mirror') continue;
        hung += 1;
        const { x, z } = item.position!;
        const back = item.depth / 2 + 0.01;
        // Against exactly one wall, face turned toward the room centre.
        const faceX = Math.sin(item.rotation ?? 0);
        const faceZ = Math.cos(item.rotation ?? 0);
        const onWall =
          (Math.abs(z + d / 2 - back) < 1e-9 && faceZ > 0.99) ||
          (Math.abs(z - d / 2 + back) < 1e-9 && faceZ < -0.99) ||
          (Math.abs(x + w / 2 - back) < 1e-9 && faceX > 0.99) ||
          (Math.abs(x - w / 2 + back) < 1e-9 && faceX < -0.99);
        expect(onWall, `seed ${seed}: ${item.id} at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
    expect(hung).toBeGreaterThan(5);
  });
});

describe('surpriseFloorItems keeps the structure and fits around it (#448)', () => {
  const door = makeItem({ id: 'door-1', type: 'door', category: 'structure', width: 0.9, depth: 0.12, position: { x: -4, z: 1 }, rotation: Math.PI / 2 });
  const window = makeItem({ id: 'win-1', type: 'window', category: 'structure', width: 1.2, depth: 0.12, position: { x: 4, z: -1 }, rotation: -Math.PI / 2 });
  const stairs = makeItem({ id: 'stairs-1', type: 'stairs', category: 'structure', width: 1.2, depth: 2.4, height: 3, position: { x: 2.8, z: 2 } });
  const tree = makeItem({ id: 'tree-1', type: 'tree', category: 'outdoor', width: 1.4, depth: 1.4, position: { x: 0, z: 6 } });
  const sofa = makeItem({ id: 'sofa-1', type: 'sofa', category: 'seating', width: 2.2, depth: 0.9, position: { x: 0, z: 0 } });
  const interiorWalls = [{ id: 'iw', x1: -4, z1: 1.5, x2: 0, z2: 1.5 }];
  const layoutWith = (items = [door, window, stairs, tree, sofa]) =>
    makeLayout({
      entrance: { width: 1.4, depth: 1.2 },
      floors: [makeFloor({ items, interiorWalls }), makeFloor({ id: 'upper', items: [] })],
    });

  it('keeps doors, windows, stairs and the garden and replaces only the furniture', () => {
    const items = surpriseFloorItems(layoutWith(), 0, 25_000, 4);
    const ids = items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['door-1', 'win-1', 'stairs-1', 'tree-1']));
    expect(ids).not.toContain('sofa-1');
    expect(items.length).toBeGreaterThan(4);
  });

  it('asks before replacing only when there is furniture to replace', () => {
    expect(surpriseReplacesFurniture([door, window, stairs, tree])).toBe(false);
    expect(surpriseReplacesFurniture([door, sofa])).toBe(true);
    expect(keptBySurprise(door) && keptBySurprise(stairs) && keptBySurprise(tree)).toBe(true);
  });

  it('never drops a generated piece on the kept items, the porch or a partition', () => {
    const layout = layoutWith();
    const keepOut = floorKeepOut(layout, 0);
    expect(keepOut.length).toBeGreaterThan(0);
    for (let seed = 0; seed < 120; seed++) {
      const items = surpriseFloorItems(layout, 0, 25_000, seed);
      const kept = items.filter(keptBySurprise);
      for (const piece of items.filter((item) => item.id.startsWith('surprise'))) {
        expect(hasCollisions(piece, kept, 8, 8, { keepOut, interiorWalls }), `seed ${seed}: ${piece.type}`).toBe(false);
      }
    }
  });

  it('hangs no art across the recessed entrance', () => {
    const layout = layoutWith([]);
    const gap = entrancePlanOutline(layout, 0)!;
    let north = 0;
    for (let seed = 0; seed < 120; seed++) {
      for (const art of surpriseFloorItems(layout, 0, 25_000, seed)) {
        if (art.type !== 'painting' && art.type !== 'mirror') continue;
        const { x, z } = art.position!;
        if (z > -3.5) continue;
        north += 1;
        expect(x + art.width / 2 <= gap.x0 || x - art.width / 2 >= gap.x1, `seed ${seed}: x ${x.toFixed(2)}`).toBe(true);
      }
    }
    expect(north).toBeGreaterThan(5);
  });
});
