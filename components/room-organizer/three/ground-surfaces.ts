import { markSharedTexture } from './builder-utils';
import { mulberry32 } from './sky';
import { withMaxAnisotropy } from './texture-settings';
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

/**
 * One map per surface and size, shared by every ground material: marked
 * shared, so a rebuilt lot doesn't upload ~1.4 MB a map again. Freed by
 * `releaseGroundTextures` at unmount.
 */
const cache = new Map<string, ThreeNS.CanvasTexture>();

export function releaseGroundTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

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
  const texture = markSharedTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  withMaxAnisotropy(texture);
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

export interface GroundSurfaceOptions {
  /** Pixels across the tile, by quality tier (#760). */
  pixels?: number;
  /** Grass only: read the map again far larger to break the tile up. Off on the low tier. */
  macro?: boolean;
  /**
   * Fade into the sky with distance from the camera: the ground past the lot.
   * The lot's half-diagonal, in metres: the fade starts past its far corner.
   */
  fade?: number;
}

/**
 * Lay `surface` on a ground material (#761): a generated map, tiled by world
 * position so a slope, the skirt and the lot line up with no UV work on any of
 * them, and on grass read again far larger to break the tile up. Two lookups
 * at most, no per-frame work. `material.color` keeps the tint. The tile scale
 * is a uniform, so paving, asphalt and plain grass share one shader program.
 */
export function layGroundSurface(
  THREE: ThreeModule,
  material: ThreeNS.MeshStandardMaterial,
  surface: GroundSurface,
  options: GroundSurfaceOptions = {}
): void {
  const map = groundTexture(THREE, surface, options.pixels ?? TILE_PIXELS);
  if (!map) return;
  material.map = map;
  const macro = surface === 'grass' && options.macro !== false;
  const perMetre = { value: 1 / TILE_METRES[surface] };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundPerMetre = perMetre;
    shader.vertexShader = `uniform float groundPerMetre;\n${shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tvMapUv = ( modelMatrix * vec4( transformed, 1.0 ) ).xz * groundPerMetre;'
    )}`;
    if (macro) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n\tdiffuseColor.rgb *= 0.74 + 0.5 * texture2D( map, vMapUv * ${MACRO_SCALE} ).g;`
      );
    }
    if (options.fade !== undefined) fadeShader(shader, options.fade);
  };
  material.customProgramCacheKey = () => `ground${macro ? '-macro' : ''}${options.fade !== undefined ? '-fade' : ''}`;
}

/** Nearest the camera at which the ground past the lot starts thinning, in metres. */
const FADE_MIN_START = 165;
/** Past the lot's far corner, so the lot itself, which never fades, shows no edge. */
const FADE_LOT_CLEARANCE = 20;
/** The fade ends this many times as far out as it starts... */
const FADE_LENGTH = 1.8;
/** ...but inside the camera's far plane (1000 m), or the plane cuts it off with an edge. */
const FADE_MAX_END = 950;

/**
 * Thin a surface into the sky by its distance from the camera, measured
 * across the ground, so it goes into the horizon haze along a line level with
 * the horizon wherever the camera stands. A fade fixed to the lot drew its
 * round outer edge as a green hump against the sky from far out. It starts
 * past the lot's far corner from the camera, so the lot never shows a square
 * edge. Reads only three's own `cameraPosition`: nothing to update per frame.
 */
function fadeShader(shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }, lotReach: number): void {
  shader.uniforms.groundFadeLot = { value: lotReach };
  shader.vertexShader = `varying vec2 vGroundFadeXZ;\n${shader.vertexShader.replace(
    '#include <project_vertex>',
    '#include <project_vertex>\n\tvGroundFadeXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;'
  )}`;
  shader.fragmentShader = `uniform float groundFadeLot;\nvarying vec2 vGroundFadeXZ;\n${shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    [
      `float groundFadeEnd = min( ${FADE_MAX_END.toFixed(1)}, ${FADE_LENGTH.toFixed(2)} * max( ${FADE_MIN_START.toFixed(1)}, length( cameraPosition.xz ) + groundFadeLot + ${FADE_LOT_CLEARANCE.toFixed(1)} ) );`,
      `diffuseColor.a *= 1.0 - smoothstep( groundFadeEnd / ${FADE_LENGTH.toFixed(2)}, groundFadeEnd, distance( vGroundFadeXZ, cameraPosition.xz ) );`,
      '#include <opaque_fragment>',
    ].join('\n\t')
  )}`;
}

/** The distance fade of the ground past the lot on a material with no map: the road's tails. */
export function fadeWithDistance(material: ThreeNS.Material, lotReach: number): void {
  material.onBeforeCompile = (shader) => fadeShader(shader, lotReach);
  material.customProgramCacheKey = () => 'ground-fade-only';
}

/**
 * How opaque the faded ground is `distance` across the ground from a camera
 * standing `cameraXZ` across the ground from the lot's middle. Mirrors the shader.
 */
export function groundFadeAlpha(distance: number, cameraXZ: number, lotReach: number): number {
  const end = Math.min(FADE_MAX_END, FADE_LENGTH * Math.max(FADE_MIN_START, cameraXZ + lotReach + FADE_LOT_CLEARANCE));
  const start = end / FADE_LENGTH;
  const t = Math.min(1, Math.max(0, (distance - start) / (end - start)));
  return 1 - t * t * (3 - 2 * t);
}
