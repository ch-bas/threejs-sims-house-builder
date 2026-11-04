import { DisposableLruCache } from './texture-lru';
import { withMaxAnisotropy } from './texture-settings';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

/**
 * Relief for the procedural floor and wall patterns (#757): a pattern paints
 * a greyscale height tile (white = the face of a board, brick or tile, dark =
 * the gap, joint or grout) on the same layout as its colour tile, and this
 * turns it into a tangent-free normal map and a roughness map. CPU work once
 * per pattern and tile size, not per colour: the masters are cached here and
 * every material takes a `.clone()` sharing the image, like the colour tile.
 */
export interface ReliefSpec {
  /** Paints the height tile; the canvas starts black. */
  draw(ctx: CanvasRenderingContext2D, size: number): void;
  /** Roughness at height 0 (gaps, grout) and at height 1 (the faces). */
  roughness: readonly [number, number];
  /** Slope of the normal per unit of height per pixel, at 256 px (scaled with the tile). */
  strength: number;
}

export interface ReliefMaps {
  normal: ThreeNS.CanvasTexture;
  roughness: ThreeNS.CanvasTexture;
}

/** One entry per pattern and size: a handful, so the default cap holds them all. */
const reliefCache = new DisposableLruCache<{ normal: ThreeNS.CanvasTexture; roughness: ThreeNS.CanvasTexture; dispose(): void }>();

export function reliefMaps(THREE: ThreeModule, key: string, size: number, spec: ReliefSpec): ReliefMaps | null {
  const cacheKey = `${key}|${size}`;
  const cached = reliefCache.get(cacheKey);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  spec.draw(ctx, size);
  const height = ctx.getImageData(0, 0, size, size);
  if (!height?.data) return null;

  const normalCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  for (const c of [normalCanvas, roughCanvas]) {
    c.width = size;
    c.height = size;
  }
  const normalCtx = normalCanvas.getContext('2d');
  const roughCtx = roughCanvas.getContext('2d');
  if (!normalCtx || !roughCtx) return null;
  const normal = normalCtx.createImageData(size, size);
  normal.data.set(heightToNormal(height.data, size, spec.strength * (256 / size)));
  normalCtx.putImageData(normal, 0, 0);
  const rough = roughCtx.createImageData(size, size);
  rough.data.set(heightToRoughness(height.data, spec.roughness));
  roughCtx.putImageData(rough, 0, 0);

  const texture = (source: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(source);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    // Data, not colour: left in the default (no) colour space, never sRGB.
    withMaxAnisotropy(t);
    return t;
  };
  const entry = {
    normal: texture(normalCanvas),
    roughness: texture(roughCanvas),
    dispose() {
      this.normal.dispose();
      this.roughness.dispose();
    },
  };
  reliefCache.set(cacheKey, entry);
  return entry;
}

/**
 * A tangent-space normal map (RGBA bytes) from the red channel of a height
 * tile, by central differences that wrap at the edges, so the map tiles like
 * the pattern. Rows run down the canvas, which a CanvasTexture flips to v
 * up, so a height rising down the rows tilts the normal toward −v. Pure.
 */
export function heightToNormal(height: ArrayLike<number>, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => (height[(((y + size) % size) * size + ((x + size) % size)) * 4] ?? 0) / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dv = (at(x, y - 1) - at(x, y + 1)) * strength;
      const nx = -dx;
      const ny = -dv;
      const length = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((nx / length * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Roughness bytes (three reads the green channel) from a height tile: gaps one value, faces another. Pure. */
export function heightToRoughness(height: ArrayLike<number>, [low, high]: readonly [number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(height.length);
  for (let i = 0; i < height.length; i += 4) {
    const h = (height[i] ?? 0) / 255;
    const value = Math.round((low + (high - low) * h) * 255);
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = 255;
  }
  return out;
}

/** The roughness a material had before its relief took it over, for `stripRelief`. */
const flatRoughness = new WeakMap<ThreeNS.Material, number>();

/**
 * Hang a pattern's relief on its material: clones of the cached maps with the
 * colour tile's repeat and offset. The roughness map then carries the whole
 * value, so the material's own roughness goes to 1 (three multiplies them).
 */
export function applyRelief(
  material: ThreeNS.MeshStandardMaterial,
  maps: ReliefMaps,
  colour: ThreeNS.Texture
): void {
  const normal = maps.normal.clone();
  const roughness = maps.roughness.clone();
  for (const t of [normal, roughness]) {
    t.repeat.copy(colour.repeat);
    t.offset.copy(colour.offset);
  }
  flatRoughness.set(material, material.roughness);
  material.normalMap = normal;
  material.roughnessMap = roughness;
  material.roughness = 1;
}

/**
 * Take a pattern's relief off its material again, back to its flat
 * roughness: the GLB export leaves it out, since it would carry two more
 * images per pattern (and a merged metal-rough one) for a lighting detail.
 * Frees the material's own clones; the cached masters stay. Returns whether
 * it had one.
 */
export function stripRelief(material: ThreeNS.Material): boolean {
  const roughness = flatRoughness.get(material);
  if (roughness === undefined) return false;
  const standard = material as ThreeNS.MeshStandardMaterial;
  standard.normalMap?.dispose();
  standard.roughnessMap?.dispose();
  standard.normalMap = null;
  standard.roughnessMap = null;
  standard.roughness = roughness;
  flatRoughness.delete(material);
  return true;
}
