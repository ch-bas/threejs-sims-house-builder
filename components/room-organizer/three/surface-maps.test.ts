import { describe, expect, it } from 'vitest';
import { woodBoards } from './floor-patterns';
import { heightToNormal, heightToRoughness } from './surface-maps';

/** An RGBA height tile from a function of (x, y), in 0..1. */
function tile(size: number, h: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data[(y * size + x) * 4] = Math.round(h(x, y) * 255);
  }
  return data;
}

describe('relief maps (#757)', () => {
  it('leaves a flat height facing straight out', () => {
    const normal = heightToNormal(tile(8, () => 0.5), 8, 3);
    for (let i = 0; i < normal.length; i += 4) {
      expect([normal[i], normal[i + 1], normal[i + 2]]).toEqual([128, 128, 255]);
    }
  });

  it('tilts away from a rise, with rows running down the canvas as v runs up', () => {
    const alongU = heightToNormal(tile(8, (x) => (x === 4 ? 1 : 0)), 8, 3);
    // Left of the ridge the normal leans to −u, right of it to +u.
    expect(alongU[(2 * 8 + 3) * 4]!).toBeLessThan(128);
    expect(alongU[(2 * 8 + 5) * 4]!).toBeGreaterThan(128);
    // A ridge along a row: the row above it (higher v) leans to +v, the one below to −v.
    const ridge = heightToNormal(tile(8, (_x, y) => (y === 4 ? 1 : 0)), 8, 3);
    expect(ridge[(3 * 8 + 2) * 4 + 1]!).toBeGreaterThan(128);
    expect(ridge[(5 * 8 + 2) * 4 + 1]!).toBeLessThan(128);
  });

  it('wraps at the edges, so the map tiles', () => {
    const normal = heightToNormal(tile(8, (x) => (x === 0 ? 1 : 0)), 8, 3);
    expect(normal[(1 * 8 + 7) * 4]!).toBeLessThan(128);
  });

  it('gives the gaps one roughness and the faces another', () => {
    const rough = heightToRoughness(tile(2, (x) => x), [0.9, 0.2]);
    expect(rough[1]).toBe(Math.round(0.9 * 255));
    expect(rough[5]).toBe(Math.round(0.2 * 255));
  });
});

describe('wood boards (#757)', () => {
  const boards = woodBoards();

  it('lays ten 14 cm rows a 1.4 m tile, every row covered once', () => {
    const rows = new Map<number, number>();
    for (const b of boards) rows.set(b.row, (rows.get(b.row) ?? 0) + (b.to - b.from));
    expect([...rows.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const length of rows.values()) expect(length).toBeCloseTo(1);
  });

  it('staggers the end joints of neighbouring rows', () => {
    const joints = (row: number) => boards.filter((b) => b.row === row).map((b) => b.from);
    for (let row = 1; row < 10; row++) {
      for (const a of joints(row)) {
        for (const b of joints(row - 1)) expect(Math.min(Math.abs(a - b), 1 - Math.abs(a - b))).toBeGreaterThanOrEqual(0.19);
      }
    }
  });

  it('tones each board on its own, and draws the same boards every time', () => {
    expect(new Set(boards.map((b) => b.tone.toFixed(3))).size).toBeGreaterThan(boards.length / 2);
    expect(woodBoards()).toEqual(boards);
  });
});
