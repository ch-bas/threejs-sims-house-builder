import { describe, expect, it } from 'vitest';
import { itemsOverlap, rotatedHalfExtents } from './geometry';
import { surpriseLayout } from './surprise';

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
