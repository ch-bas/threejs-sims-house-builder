import { mulberry32 } from './sky';
import { getMaxAnisotropy } from './texture-settings';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

export type GroundSurface = 'grass' | 'paving' | 'asphalt';

/** Metres one tile of each map covers; the macro layer repeats grass far less often. */
const TILE_METRES: Record<GroundSurface, number> = { grass: 6, paving: 3.2, asphalt: 4 };
/** Grass only: the same map read this much larger, so the lawn doesn't show its tile. */
const MACRO_SCALE = 0.137;
const TILE_PIXELS = 512;

const painters: Record<GroundSurface, (ctx: CanvasRenderingContext2D, size: number, random: () => number) => void> = {
  grass: paintGrass,
  paving: paintPaving,
  asphalt: paintAsphalt,
};

const cache = new Map<string, ThreeNS.CanvasTexture>();

/** A light, near-neutral tile: `material.color` keeps the weather tint (#189). */
function groundTexture(THREE: ThreeModule, surface: GroundSurface, pixels: number): ThreeNS.CanvasTexture | null {
  const key = `${surface}:${pixels}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  painters[surface](ctx, pixels, mulberry32(pixels + surface.length));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = getMaxAnisotropy();
  cache.set(key, texture);
  return texture;
}

/** Draw `at` once per side it might cross, so the tile wraps without a seam. */
function wrapped(size: number, x: number, y: number, at: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) at(x + dx, y + dy);
}

function paintGrass(ctx: CanvasRenderingContext2D, size: number, random: () => number): void {
  ctx.fillStyle = '#d6d6d6';
  ctx.fillRect(0, 0, size, size);
  // Soft patches first, the macro layer reads these at lawn scale.
  for (let i = 0; i < 90; i += 1) {
    const r = size * (0.06 + random() * 0.14);
    const light = random() > 0.5;
    wrapped(size, random() * size, random() * size, (x, y) => {
      const patch = ctx.createRadialGradient(x, y, 0, x, y, r);
      patch.addColorStop(0, light ? 'rgba(255, 255, 225, 0.1)' : 'rgba(55, 75, 45, 0.1)');
      patch.addColorStop(1, 'rgba(128, 128, 128, 0)');
      ctx.fillStyle = patch;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  // Then blades, in every direction with a bias, dark ones under light ones.
  const blades = Math.round((size * size) / 8);
  ctx.lineCap = 'round';
  for (let i = 0; i < blades; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = size * (0.008 + random() * 0.012);
    const angle = -Math.PI / 2 + (random() - 0.5) * 1.8;
    const shade = i / blades;
    const v = Math.round(120 + shade * 130 + (random() - 0.5) * 40);
    ctx.strokeStyle = `rgba(${v}, ${Math.min(255, v + 12)}, ${Math.round(v * 0.72)}, 0.55)`;
    ctx.lineWidth = size / 340;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
}

function paintPaving(ctx: CanvasRenderingContext2D, size: number, random: () => number): void {
  const slabs = 4;
  const slab = size / slabs;
  for (let row = 0; row < slabs; row += 1) {
    for (let column = 0; column < slabs; column += 1) {
      const v = Math.round(214 + random() * 34);
      ctx.fillStyle = `rgb(${v}, ${v}, ${v - 3})`;
      ctx.fillRect(column * slab, row * slab, slab, slab);
    }
  }
  speckle(ctx, size, random, Math.round(size * size * 0.05), 90, 0.1);
  ctx.strokeStyle = 'rgb(112, 112, 108)';
  ctx.lineWidth = Math.max(1.5, size / 170);
  ctx.beginPath();
  for (let i = 0; i < slabs; i += 1) {
    ctx.moveTo(i * slab, 0);
    ctx.lineTo(i * slab, size);
    ctx.moveTo(0, i * slab);
    ctx.lineTo(size, i * slab);
  }
  ctx.stroke();
}

function paintAsphalt(ctx: CanvasRenderingContext2D, size: number, random: () => number): void {
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, random, Math.round(size * size * 0.14), 70, 0.5);
  speckle(ctx, size, random, Math.round(size * size * 0.1), 255, 0.28);
  // A few tar repairs, long and thin, so the road isn't one even band.
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i += 1) {
    const x = random() * size;
    const y = random() * size;
    wrapped(size, x, y, (px, py) => {
      ctx.strokeStyle = 'rgba(40, 40, 42, 0.32)';
      ctx.lineWidth = size / 300;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + size * 0.1, py + size * 0.05, px + size * 0.22, py - size * 0.03);
      ctx.stroke();
    });
  }
}

function speckle(ctx: CanvasRenderingContext2D, size: number, random: () => number, count: number, value: number, alpha: number): void {
  ctx.fillStyle = `rgba(${value}, ${value}, ${value}, ${alpha})`;
  for (let i = 0; i < count; i += 1) ctx.fillRect(random() * size, random() * size, 1, 1);
}

/**
 * Lay `surface` on a ground material (#761): a generated map, tiled by world
 * position so a slope, the skirt and the lot line up with no UV work on any of
 * them, and on grass read again far larger to break the tile up. Two lookups
 * at most, no per-frame work. `material.color` keeps the tint.
 */
export function layGroundSurface(
  THREE: ThreeModule,
  material: ThreeNS.MeshStandardMaterial,
  surface: GroundSurface,
  pixels: number = TILE_PIXELS
): void {
  const map = groundTexture(THREE, surface, pixels);
  if (!map) return;
  material.map = map;
  const perMetre = (1 / TILE_METRES[surface]).toFixed(6);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n\tvMapUv = ( modelMatrix * vec4( transformed, 1.0 ) ).xz * ${perMetre};`
    );
    if (surface !== 'grass') return;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n\tdiffuseColor.rgb *= 0.74 + 0.5 * texture2D( map, vMapUv * ${MACRO_SCALE} ).g;`
    );
  };
  material.customProgramCacheKey = () => `ground-${surface}`;
}
