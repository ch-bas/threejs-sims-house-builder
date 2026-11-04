import { applyRelief, reliefMaps, type ReliefSpec } from './surface-maps';
import { DisposableLruCache, PATTERN_CACHE_CAPACITY } from './texture-lru';
import { getPatternSize, patternReliefEnabled, withMaxAnisotropy } from './texture-settings';
import type { WallPattern } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

export const WALL_PATTERN_LABELS: Record<WallPattern, string> = {
  solid: 'Solid',
  brick: 'Brick',
  wallpaper: 'Wallpaper',
  panel: 'Wood Panel',
  plaster: 'Plaster',
  siding: 'Siding',
};

/** An outer wall with no colour of its own: warm cream, never a neutral grey. Gable ends share it. */
export const DEFAULT_WALL_COLOR = '#e8dcc4';

interface PatternRenderer {
  draw(ctx: CanvasRenderingContext2D, size: number, baseColor: string): void;
  /** How many tiles per meter of wall length. */
  repeatPerMeter: number;
  /** Height tile for the normal and roughness maps (#757): joints, laps, grooves. */
  relief?: ReliefSpec;
}

/** Strokes every brick's outline on the brick tile: the mortar joints. */
function strokeBricks(ctx: CanvasRenderingContext2D, size: number, lineWidth: number): void {
  const rows = 16;
  const rowHeight = size / rows;
  const brickWidth = size / 6;
  ctx.lineWidth = lineWidth;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickWidth / 2);
    for (let c = -1; c < 7; c++) ctx.strokeRect(c * brickWidth + offset, r * rowHeight, brickWidth, rowHeight);
  }
}

const SIDING_BOARDS = 12;

const PATTERNS: Record<Exclude<WallPattern, 'solid'>, PatternRenderer> = {
  brick: {
    // One tile is 1.25 m: six stretchers of 0.21 m by sixteen courses of
    // 0.078 m, about a real brick and its joint (#661). The tile used to
    // be six courses stretched 1.67× up the wall, bricks taller than wide.
    repeatPerMeter: 0.8,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const rows = 16;
      const rowHeight = size / rows;
      const bricksPerRow = 6;
      const brickWidth = size / bricksPerRow;
      for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (brickWidth / 2);
        const y = r * rowHeight;
        for (let c = -1; c < bricksPerRow + 1; c++) {
          // A fixed tone per brick; the column wraps, so the tile still tiles.
          const column = (c + bricksPerRow) % bricksPerRow;
          const tone = ((r * 7 + column * 13) % 17) / 16 - 0.5;
          ctx.fillStyle = tone > 0 ? `rgba(255,255,255,${(tone * 0.12).toFixed(3)})` : `rgba(0,0,0,${(-tone * 0.16).toFixed(3)})`;
          ctx.fillRect(c * brickWidth + offset, y, brickWidth, rowHeight);
        }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      strokeBricks(ctx, size, Math.max(1, size / 192));
    },
    relief: {
      roughness: [0.98, 0.85],
      strength: 2,
      draw(ctx, size) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        // Recessed joints, a little wider than the drawn line.
        ctx.strokeStyle = '#000';
        strokeBricks(ctx, size, Math.max(1.5, size / 128));
      },
    },
  },
  wallpaper: {
    repeatPerMeter: 1.2,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const dots = 7;
      const spacing = size / dots;
      for (let i = 0; i < dots; i++) {
        for (let j = 0; j < dots; j++) {
          const x = i * spacing + spacing / 2;
          const y = j * spacing + spacing / 2 + (i % 2 === 0 ? 0 : spacing / 2);
          ctx.beginPath();
          ctx.arc(x, y, 4 * (size / 256), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  panel: {
    repeatPerMeter: 0.5,
    draw(ctx, size, baseColor) {
      const k = size / 256;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const panels = 4;
      const w = size / panels;
      for (let i = 0; i < panels; i++) {
        const x = i * w;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
        // grain
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = k;
        for (let g = 1; g < 4; g++) {
          const gx = x + (g / 4) * w;
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, size);
          ctx.stroke();
        }
      }
    },
    relief: {
      roughness: [0.9, 0.6],
      strength: 2.5,
      draw(ctx, size) {
        const k = size / 256;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        for (let i = 0; i < 4; i++) ctx.fillRect((i * size) / 4 - k, 0, 3 * k, size);
      },
    },
  },
  plaster: {
    repeatPerMeter: 0.3,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 250 * (size / 256) ** 2; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = (5 + Math.random() * 15) * (size / 256);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${0.04 + Math.random() * 0.05})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  // Horizontal lap siding — the white-board look of classic
  // suburban houses. Boards are wider than they are tall and have a
  // subtle shadow line under each: twelve to a 2 m tile, 17 cm boards.
  siding: {
    repeatPerMeter: 0.5,
    draw(ctx, size, baseColor) {
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const boardHeight = size / SIDING_BOARDS;
      for (let i = 0; i < SIDING_BOARDS; i += 1) {
        const y = i * boardHeight;
        // Soft top highlight on each board.
        const grad = ctx.createLinearGradient(0, y, 0, y + boardHeight);
        grad.addColorStop(0, 'rgba(255,255,255,0.08)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, size, boardHeight);
        // Hard shadow line at the bottom of each board (the lap shadow).
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, y + boardHeight - size / 256, size, 1.5 * (size / 256));
      }
    },
    relief: {
      roughness: [0.85, 0.6],
      strength: 1.5,
      draw(ctx, size) {
        // Each board thickens toward its lower edge, then steps back to the
        // next: a sawtooth down the rows.
        const boardHeight = size / SIDING_BOARDS;
        for (let i = 0; i < SIDING_BOARDS; i += 1) {
          const y = i * boardHeight;
          const grad = ctx.createLinearGradient(0, y, 0, y + boardHeight);
          grad.addColorStop(0, '#202020');
          grad.addColorStop(0.9, '#ffffff');
          grad.addColorStop(1, '#ffffff');
          ctx.fillStyle = grad;
          ctx.fillRect(0, y, size, boardHeight);
        }
      },
    },
  },
};

export interface BuildWallMaterialOptions {
  pattern: WallPattern;
  color: string;
  width: number;
  height: number;
  /**
   * Height of the bottom of the wall above the ground (metres): the pattern
   * is offset by it, so brick courses and siding laps run on from one
   * storey to the next instead of restarting at every floor line (#661).
   */
  yOffset?: number;
}

/**
 * Cache the painted CanvasTexture keyed on (pattern, color, size). Walls are
 * built ×4 per shell rebuild; the canvas drawing depends only on those keys,
 * while the per-wall `repeat` is applied to a clone. Each caller gets a
 * `.clone()` sharing the cached canvas image (cheap) that is independently
 * disposable. The cache is LRU-capped because `color` is user-pickable:
 * evicted masters are disposed, which is safe for live clones (see
 * texture-lru.ts), while cached masters keep the shared GPU image alive.
 */
const wallTextureCache = new DisposableLruCache<ThreeNS.CanvasTexture>(PATTERN_CACHE_CAPACITY);

export function buildWallMaterial(
  THREE: ThreeModule,
  options: BuildWallMaterialOptions
): ThreeNS.MeshStandardMaterial {
  if (options.pattern === 'solid') {
    // Walls are fully opaque — the cutaway view hides the front walls by
    // setting .visible rather than by fading them, so the room reads as an
    // actual building.
    return new THREE.MeshStandardMaterial({
      color: options.color,
      side: THREE.DoubleSide,
      roughness: 0.85,
    });
  }

  const renderer = PATTERNS[options.pattern];
  // Defence in depth: the schema rejects unknown patterns (#208), but data
  // saved before that check may still be in the wild — render solid instead
  // of throwing inside the scene build.
  if (!renderer) {
    return new THREE.MeshStandardMaterial({
      color: options.color,
      side: THREE.DoubleSide,
      roughness: 0.85,
    });
  }
  const size = getPatternSize();
  const master = getWallTexture(THREE, options.pattern, options.color, size, renderer);
  if (!master) {
    return new THREE.MeshStandardMaterial({
      color: options.color,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }

  // Clone per material so each wall owns a disposable copy sharing the cached
  // canvas image; per-wall `repeat` is set on the clone, not the master.
  // (`Texture.clone()` already flags needsUpdate, so no explicit re-upload.)
  const texture = withMaxAnisotropy(master.clone());
  // Square tiles, the same density both ways: the old 0.6 on v stretched
  // every pattern 1.67× up the wall (#661). The geometry's UVs span 0..1
  // over `width` × `height` (or are metres, with both at 1).
  texture.repeat.set(options.width * renderer.repeatPerMeter, options.height * renderer.repeatPerMeter);
  texture.offset.y = ((options.yOffset ?? 0) * renderer.repeatPerMeter) % 1;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  // Joints, laps and grooves catch a raking sun (#757). Not on phones.
  const maps = renderer.relief && patternReliefEnabled() ? reliefMaps(THREE, `wall-${options.pattern}`, size, renderer.relief) : null;
  if (maps) applyRelief(material, maps, texture);
  return material;
}

function getWallTexture(
  THREE: ThreeModule,
  pattern: Exclude<WallPattern, 'solid'>,
  color: string,
  size: number,
  renderer: PatternRenderer
): ThreeNS.CanvasTexture | null {
  const key = `${pattern}|${color}|${size}`;
  const cached = wallTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  renderer.draw(ctx, size, color);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  withMaxAnisotropy(texture);

  wallTextureCache.set(key, texture);
  return texture;
}
