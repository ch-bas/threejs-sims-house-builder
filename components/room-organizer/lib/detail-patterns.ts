/**
 * Greyscale surface detail for furniture (#756): tileable images drawn once,
 * then multiplied by an item's colour, so colour pickers keep working. Pure:
 * bytes in, bytes out, no canvas. Seeded, so every session draws the same grain.
 */

export type DetailKind = 'wood' | 'fabric' | 'leather';

/** A square RGBA image, every channel the same grey. */
export interface DetailImage {
  size: number;
  data: Uint8Array;
}

const LATTICE = 64;
const lattice = (() => {
  // A small LCG: reproducible, and nothing here needs better.
  const values = new Float32Array(LATTICE * LATTICE);
  let seed = 7;
  for (let i = 0; i < values.length; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    values[i] = seed / 2147483648;
  }
  return values;
})();

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise on an fx × fy grid over the unit square, wrapping at its edges. */
function noise(u: number, v: number, fx: number, fy: number, offset = 0): number {
  const x = u * fx;
  const y = v * fy;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const at = (ix: number, iy: number): number =>
    lattice[(((ix % fx) + fx) % fx + offset) % LATTICE + (((iy % fy) + fy) % fy) % LATTICE * LATTICE]!;
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

/** Long fibres running along u: wide bands, then finer and finer streaks. */
function wood(u: number, v: number): number {
  const bands = noise(u, v, 3, 9);
  const streaks = noise(u, v, 6, 37, 11);
  const fibres = noise(u, v, 11, 61, 23);
  const value = bands * 0.42 + streaks * 0.36 + fibres * 0.22;
  return 0.72 + 0.28 * Math.min(1, Math.max(0, (value - 0.25) * 2));
}

const WEAVE_THREADS = 60;

/** A plain weave: threads pass over and under each other, each a little uneven. */
function fabric(u: number, v: number): number {
  const x = u * WEAVE_THREADS;
  const y = v * WEAVE_THREADS;
  const over = (Math.floor(x) + Math.floor(y)) % 2 === 0;
  const across = Math.sin(((over ? y : x) % 1) * Math.PI);
  const along = Math.sin(((over ? x : y) % 1) * Math.PI);
  const slub = noise(u, v, over ? 4 : WEAVE_THREADS, over ? WEAVE_THREADS : 4, 5);
  // The threads vanish in the mipmaps past arm's length; a soft mottle doesn't.
  const mottle = noise(u, v, 5, 5, 31) * 0.5 + noise(u, v, 17, 17, 41) * 0.5;
  return 0.8 + 0.13 * across * (0.55 + 0.45 * along) + 0.03 * slub + 0.05 * mottle;
}

/** Fine creases around soft pebbles, as on a full-grain hide. */
function leather(u: number, v: number): number {
  const crease = (fx: number, offset: number): number => {
    const ridge = 1 - Math.abs(noise(u, v, fx, fx, offset) * 2 - 1);
    return ridge ** 10;
  };
  return 0.96 + 0.04 * noise(u, v, 6, 6, 13) - 0.07 * crease(47, 3) - 0.05 * crease(61, 19);
}

const PATTERNS: Record<DetailKind, (u: number, v: number) => number> = { wood, fabric, leather };

export function drawDetail(kind: DetailKind, size: number): DetailImage {
  const pattern = PATTERNS[kind];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const grey = Math.round(pattern((x + 0.5) / size, (y + 0.5) / size) * 255);
      const i = (y * size + x) * 4;
      data[i] = grey;
      data[i + 1] = grey;
      data[i + 2] = grey;
      data[i + 3] = 255;
    }
  }
  return { size, data };
}
